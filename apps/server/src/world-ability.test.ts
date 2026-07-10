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

function fakeSocket(id = "ability-socket"): GameSocket {
  return {
    id,
    emit: () => true,
  } as unknown as GameSocket;
}

describe("authoritative ability acknowledgement", () => {
  it("uses equipped weapon range and interval, then rejects the cooldown retry", async () => {
    const store = new MemoryGameStore();
    const account = await store.createAccount("ability-user", "hash");
    const classDefinition = getClass("warrior");
    const character = await store.createCharacter({
      accountId: account.id,
      name: "Дальнозор",
      race: "light_elf",
      classId: "warrior",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    await store.addInventoryItem(character.id, "whisperbranch_bow", 1);
    const bow = (await store.getInventoryState(character.id)).inventory.items.find(
      (item) => item.itemId === "whisperbranch_bow",
    )!;
    await store.equipItem(character.id, bow.instanceId);
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

  it("authorizes only the coherent warrior and mage signature abilities", async () => {
    for (const setup of [
      {
        username: "warrior-ability-user",
        socketId: "warrior-socket",
        name: "Авангард",
        race: "orc" as const,
        classId: "warrior" as const,
        acceptedAbility: "vanguard_strike" as const,
        rejectedAbility: "aether_bolt" as const,
        distance: 3,
      },
      {
        username: "mage-ability-user",
        socketId: "mage-socket",
        name: "Эфирница",
        race: "dark_elf" as const,
        classId: "mage" as const,
        acceptedAbility: "aether_bolt" as const,
        rejectedAbility: "vanguard_strike" as const,
        distance: 10,
      },
    ]) {
      const store = new MemoryGameStore();
      const account = await store.createAccount(setup.username, "hash");
      const definition = getClass(setup.classId);
      const character = await store.createCharacter({
        accountId: account.id,
        name: setup.name,
        race: setup.race,
        gender: "female",
        classId: setup.classId,
        hp: definition.baseHp,
        mp: definition.baseMp,
      });
      const events: Array<{ event: string; payload: unknown }> = [];
      const world = new GameWorld(fakeIo(events), store);
      await world.join(fakeSocket(setup.socketId), character);
      const monsters = (world as unknown as {
        monsters: Map<string, { id: string; position: { x: number; y: number; z: number } }>;
      }).monsters;
      const target = [...monsters.values()][0]!;
      target.position = { x: setup.distance, y: 0, z: 0 };
      events.length = 0;

      world.useAbility(setup.socketId, {
        seq: 1,
        abilityId: setup.rejectedAbility,
        targetId: target.id,
      });
      world.useAbility(setup.socketId, {
        seq: 2,
        abilityId: setup.acceptedAbility,
        targetId: target.id,
      });

      const results = events
        .filter(({ event }) => event === "combat:ability-result")
        .map(({ payload }) => payload as AbilityUseResult);
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        seq: 1,
        abilityId: setup.rejectedAbility,
        accepted: false,
        reason: "Это умение недоступно вашему классу.",
      });
      expect(results[1]).toMatchObject({
        seq: 2,
        abilityId: setup.acceptedAbility,
        accepted: true,
      });
      await world.stop();
    }
  });
});
