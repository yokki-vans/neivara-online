import {
  MONSTER_DEFINITIONS,
  MONSTER_KINDS,
  STARTER_QUEST_MONSTER_KINDS,
  STARTER_ZONE,
  getClass,
  type MonsterKind,
  type QuestProgress,
  type WorldSnapshot,
} from "@neivara/shared";
import { describe, expect, it } from "vitest";
import { MemoryGameStore } from "./store/index.js";
import { GameWorld, type GameIo, type GameSocket } from "./world.js";

interface TestMonster {
  kind: MonsterKind;
  name: string;
  position: { x: number; y: number; z: number };
  level: number;
  hp: number;
  maxHp: number;
  elite: boolean;
  speed: number;
  attackPower: number;
  aggroRange: number;
  attackRange: number;
  attackCooldownMs: number;
}

interface TestPlayer {
  id: string;
  quest: QuestProgress;
}

interface WorldInternals {
  monsters: Map<string, TestMonster>;
  players: Map<string, TestPlayer>;
  defeatMonster(monster: TestMonster, killer: TestPlayer): void;
  sendSnapshots(): void;
}

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

function fakeSocket(id = "world-content-socket"): GameSocket {
  return { id, emit: () => true } as unknown as GameSocket;
}

async function joinedWorld(events: Array<{ event: string; payload: unknown }>) {
  const store = new MemoryGameStore(() => 9_999);
  const account = await store.createAccount("world-content-user", "hash");
  const classDefinition = getClass("warrior");
  const character = await store.createCharacter({
    accountId: account.id,
    name: "СледопытДонмер",
    race: "human",
    gender: "female",
    classId: "warrior",
    hp: classDefinition.baseHp,
    mp: classDefinition.baseMp,
  });
  const world = new GameWorld(fakeIo(events), store, () => 9_999);
  await world.join(fakeSocket(), character);
  return { store, character, world, internals: world as unknown as WorldInternals };
}

describe("Dawnmere world population", () => {
  it("builds compact spawn pockets for every configured creature", async () => {
    const events: Array<{ event: string; payload: unknown }> = [];
    const { world, internals } = await joinedWorld(events);
    const monsters = [...internals.monsters.values()];
    const counts = Object.fromEntries(
      MONSTER_KINDS.map((kind) => [
        kind,
        monsters.filter((monster) => monster.kind === kind).length,
      ]),
    );
    expect(counts).toEqual({
      thorn_prowler: 4,
      moss_mauler: 3,
      cave_shrieker: 3,
      ruin_sentinel: 1,
      bramble_boar: 4,
      ember_drake: 1,
    });
    expect(new Set(monsters.map(({ position }) => `${position.x}:${position.z}`)).size).toBe(monsters.length);

    for (const monster of monsters) {
      const definition = MONSTER_DEFINITIONS[monster.kind];
      expect(monster).toMatchObject({
        name: definition.name,
        level: definition.level,
        hp: definition.maxHp,
        maxHp: definition.maxHp,
        elite: definition.elite,
        speed: definition.speed,
        attackPower: definition.attackPower,
        aggroRange: definition.aggroRange,
        attackRange: definition.attackRange,
        attackCooldownMs: definition.attackCooldownMs,
      });
    }

    await world.stop();
  });

  it("publishes the Dawnmere zone identity in world snapshots", async () => {
    const events: Array<{ event: string; payload: unknown }> = [];
    const { world, internals } = await joinedWorld(events);
    events.length = 0;
    internals.sendSnapshots();
    const snapshot = events.find(({ event }) => event === "world:snapshot")?.payload as WorldSnapshot;
    expect(snapshot.zoneId).toBe(STARTER_ZONE.id);
    expect(snapshot.zoneName).toBe(STARTER_ZONE.name);
    expect(new Set(snapshot.monsters.map(({ kind }) => kind))).toEqual(new Set(MONSTER_KINDS));
    await world.stop();
  });

  it("advances first_echoes for several normal kinds but not elite guardians", async () => {
    const events: Array<{ event: string; payload: unknown }> = [];
    const { store, character, world, internals } = await joinedWorld(events);
    const player = internals.players.get(character.id)!;
    const byKind = (kind: MonsterKind) =>
      [...internals.monsters.values()].find((monster) => monster.kind === kind)!;

    internals.defeatMonster(byKind("ruin_sentinel"), player);
    await world.runCharacterOperation(character.id, async () => undefined);
    expect((await store.getQuest(character.id)).current).toBe(0);

    for (const kind of STARTER_QUEST_MONSTER_KINDS.slice(0, 3)) {
      internals.defeatMonster(byKind(kind), player);
      await world.runCharacterOperation(character.id, async () => undefined);
    }

    expect(await store.getQuest(character.id)).toEqual({
      questId: "first_echoes",
      status: "completed",
      current: 3,
      required: 3,
    });
    expect(player.quest).toMatchObject({ status: "completed", current: 3 });
    await world.stop();
  });
});
