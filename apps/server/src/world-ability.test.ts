import { getClass, type AbilityUseResult } from "@neivara/shared";
import { describe, expect, it } from "vitest";
import { MemoryGameStore } from "./store/index.js";
import { GameWorld, type GameIo, type GameSocket } from "./world.js";

function fakeIo(events: Array<{ event: string; payload: unknown }>): GameIo {
  const target = {
    emit: (event: string, payload: unknown) => {
      events.push({ event, payload });
      return true;
    },
  };
  return {
    sockets: { sockets: new Map() },
    to: () => target,
    emit: () => true,
  } as unknown as GameIo;
}

function fakeSocket(): GameSocket {
  return {
    id: "ability-socket",
    emit: () => true,
  } as unknown as GameSocket;
}

describe("authoritative ability acknowledgement", () => {
  it("uses equipped weapon range and interval, then rejects the cooldown retry", async () => {
    const store = new MemoryGameStore();
    const account = await store.createAccount("ability-user", "hash");
    const classDefinition = getClass("pathfinder");
    const character = await store.createCharacter({
      accountId: account.id,
      name: "Дальнозор",
      race: "vaeli",
      classId: "pathfinder",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    const events: Array<{ event: string; payload: unknown }> = [];
    const world = new GameWorld(fakeIo(events), store);
    await world.join(fakeSocket(), character);

    const monsters = (world as unknown as {
      monsters: Map<string, { id: string; position: { x: number; y: number; z: number } }>;
    }).monsters;
    const target = [...monsters.values()][0]!;
    target.position = { x: 12.5, y: 0, z: 0 };
    events.length = 0;

    world.useAbility("ability-socket", { seq: 1, abilityId: "basic", targetId: target.id });
    world.useAbility("ability-socket", { seq: 2, abilityId: "basic", targetId: target.id });

    const results = events
      .filter(({ event }) => event === "combat:ability-result")
      .map(({ payload }) => payload as AbilityUseResult);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ seq: 1, abilityId: "basic", accepted: true });
    expect(results[0]!.cooldownReadyAt - results[0]!.serverTime).toBe(1_018);
    expect(results[1]).toMatchObject({
      seq: 2,
      abilityId: "basic",
      accepted: false,
      reason: "Умение ещё восстанавливается.",
    });

    await world.stop();
  });
});
