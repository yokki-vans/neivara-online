import { getClass, getEnhancementCost, type ItemId } from "@neivara/shared";
import { describe, expect, it } from "vitest";
import {
  MemoryGameStore,
  type SavedCharacterResult,
  type SavedCharacterState,
} from "./store/index.js";
import { GameWorld, type GameIo, type GameSocket } from "./world.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class TrackingMemoryStore extends MemoryGameStore {
  readonly saveCalls: SavedCharacterState[] = [];

  override async saveCharacterState(state: SavedCharacterState): Promise<SavedCharacterResult> {
    this.saveCalls.push({ ...state, position: { ...state.position } });
    return super.saveCharacterState(state);
  }
}

class DelayedInventoryStore extends TrackingMemoryStore {
  readonly loadStarted = deferred();
  readonly allowLoad = deferred();

  override async getInventoryState(characterId: string) {
    this.loadStarted.resolve();
    await this.allowLoad.promise;
    return super.getInventoryState(characterId);
  }
}

class PostCommitAckFailureStore extends TrackingMemoryStore {
  private readonly failedStateOperations = new Set<string>();
  private readonly failedLootClaims = new Set<string>();

  override async saveCharacterState(state: SavedCharacterState): Promise<SavedCharacterResult> {
    const result = await super.saveCharacterState(state);
    if (state.operationId && !this.failedStateOperations.has(state.operationId)) {
      this.failedStateOperations.add(state.operationId);
      throw new Error("simulated state ACK loss after commit");
    }
    return result;
  }

  override async addInventoryItem(
    characterId: string,
    itemId: ItemId,
    quantity: number,
    metadata: Record<string, unknown> = {},
    lootClaimId?: string,
  ) {
    const result = await super.addInventoryItem(
      characterId,
      itemId,
      quantity,
      metadata,
      lootClaimId,
    );
    if (lootClaimId && !this.failedLootClaims.has(lootClaimId)) {
      this.failedLootClaims.add(lootClaimId);
      throw new Error("simulated loot ACK loss after commit");
    }
    return result;
  }
}

function fakeIo(targetEvents?: Array<{ event: string; payload: unknown }>): GameIo {
  const target = {
    emit: (event: string, payload: unknown) => {
      targetEvents?.push({ event, payload });
      return true;
    },
  };
  return {
    sockets: { sockets: new Map() },
    to: () => target,
    emit: () => true,
  } as unknown as GameIo;
}

function fakeSocket(
  events?: Array<{ event: string; payload: unknown }>,
  id = "socket-1",
): GameSocket {
  return {
    id,
    emit: (event: string, payload: unknown) => {
      events?.push({ event, payload });
      return true;
    },
  } as unknown as GameSocket;
}

describe("world persistence serialization", () => {
  it("keeps a periodic flush outside the inventory mutation/reconciliation window", async () => {
    const store = new TrackingMemoryStore(() => 0);
    const account = await store.createAccount("queue-user", "hash");
    const classDefinition = getClass("warbound");
    const created = await store.createCharacter({
      accountId: account.id,
      name: "Очередник",
      race: "erim",
      classId: "warbound",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    const initial = await store.getInventoryState(created.id);
    const weapon = initial.inventory.equipment.main_hand!;
    const cost = getEnhancementCost(weapon.itemId, 0);
    await store.addInventoryItem(created.id, cost.catalystItemId, cost.catalystQuantity);
    await store.saveCharacterState({
      id: created.id,
      operationId: "world-persistence-funding-0001",
      position: created.position,
      hp: created.hp,
      mp: created.mp,
      xp: 0,
      level: 1,
      goldDelta: cost.gold * 2,
    });
    const world = new GameWorld(fakeIo(), store);
    const socketEvents: Array<{ event: string; payload: unknown }> = [];
    // Deliberately pass the pre-reward record. join() must reload it after its queue barrier.
    await world.join(fakeSocket(socketEvents), created);
    const ready = socketEvents.find((entry) => entry.event === "world:ready")?.payload as {
      character: { gold: number };
    };
    expect(ready.character.gold).toBe(cost.gold * 2);
    store.saveCalls.length = 0;

    const reconcilerGate = deferred();
    const durableMutationFinished = deferred();
    const mutation = world.runCharacterOperation(created.id, async () => {
      const outcome = await store.enhanceItem(
        created.id,
        weapon.instanceId,
        "world-persist-enhance-0001",
      );
      durableMutationFinished.resolve();
      await reconcilerGate.promise;
      world.applyInventoryState(created.id, outcome.result);
      return outcome.result;
    });

    await durableMutationFinished.promise;
    expect(store.saveCalls).toHaveLength(1);
    const periodicFlush = world.flushCharacter(created.id);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.saveCalls).toHaveLength(1);

    reconcilerGate.resolve();
    await Promise.all([mutation, periodicFlush]);

    expect(store.saveCalls).toHaveLength(2);
    expect(store.saveCalls.map((call) => call.goldDelta)).toEqual([0, 0]);
    expect((await store.getInventoryState(created.id)).inventory.gold).toBe(cost.gold);
  });

  it("reuses a gold operation id after a committed flush loses its ACK", async () => {
    const store = new PostCommitAckFailureStore();
    const account = await store.createAccount("gold-ack-user", "hash");
    const classDefinition = getClass("warbound");
    const character = await store.createCharacter({
      accountId: account.id,
      name: "НадёжныйСчёт",
      race: "erim",
      classId: "warbound",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    const world = new GameWorld(fakeIo(), store);
    await world.join(fakeSocket(), character);
    const runtimePlayer = (world as unknown as {
      players: Map<string, { gold: number }>;
    }).players.get(character.id)!;
    runtimePlayer.gold += 25;

    await expect(world.flushCharacter(character.id)).rejects.toThrow(/ACK loss/);
    expect((await store.getInventoryState(character.id)).inventory.gold).toBe(25);
    await world.flushCharacter(character.id);

    runtimePlayer.gold += 5;
    await expect(world.flushCharacter(character.id)).rejects.toThrow(/ACK loss/);
    await world.flushCharacter(character.id);

    expect((await store.getInventoryState(character.id)).inventory.gold).toBe(30);
    const operationIds = store.saveCalls
      .map(({ operationId }) => operationId)
      .filter((operationId): operationId is string => Boolean(operationId));
    expect(operationIds[0]).toBe(operationIds[1]);
    expect(operationIds[2]).toBe(operationIds[3]);
    expect(operationIds[2]).not.toBe(operationIds[0]);
    expect(
      (await store.listEconomyLedger(character.id)).filter(
        ({ eventType }) => eventType === "world_reward",
      ),
    ).toHaveLength(2);
  });

  it("emits one inventory update for a realtime loot pickup", async () => {
    const store = new TrackingMemoryStore();
    const account = await store.createAccount("pickup-user", "hash");
    const classDefinition = getClass("warbound");
    const character = await store.createCharacter({
      accountId: account.id,
      name: "Сборщик",
      race: "erim",
      classId: "warbound",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    const targetEvents: Array<{ event: string; payload: unknown }> = [];
    const world = new GameWorld(fakeIo(targetEvents), store);
    await world.join(fakeSocket(), character);
    const loot = (world as unknown as {
      loot: Map<
        string,
        {
          id: string;
          itemId: "mire_shard";
          name: string;
          quantity: number;
          position: { x: number; y: number; z: number };
          ownerId: string;
          publicAt: number;
          expiresAt: number;
          audit: Record<string, unknown>;
        }
      >;
    }).loot;
    loot.set("loot-1", {
      id: "loot-1",
      itemId: "mire_shard",
      name: "Осколок",
      quantity: 1,
      position: { x: 0, y: 0, z: 0 },
      ownerId: character.id,
      publicAt: Date.now(),
      expiresAt: Date.now() + 10_000,
      audit: {
        sourceMonsterId: "monster-1",
        sourceMonsterKind: "mireling",
        sourceMonsterElite: false,
        rareRoll: 4_321,
        rareChanceBps: 0,
        quantityRoll: 7_654,
        quantityBonusChanceBps: 1_000,
      },
    });

    await world.pickup("socket-1", "loot-1");

    expect(targetEvents.filter(({ event }) => event === "inventory:update")).toHaveLength(1);
    expect(
      (await store.listEconomyLedger(character.id)).find(
        ({ eventType }) => eventType === "loot_acquired",
      )?.metadata,
    ).toMatchObject({
      sourceMonsterId: "monster-1",
      rareRoll: 4_321,
      quantityRoll: 7_654,
    });
  });

  it("does not duplicate loot after commit succeeds but the pickup ACK is lost", async () => {
    const store = new PostCommitAckFailureStore();
    const account = await store.createAccount("loot-ack-user", "hash");
    const classDefinition = getClass("warbound");
    const character = await store.createCharacter({
      accountId: account.id,
      name: "НадёжныйСбор",
      race: "erim",
      classId: "warbound",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    const world = new GameWorld(fakeIo(), store);
    await world.join(fakeSocket(), character);
    const loot = (world as unknown as {
      loot: Map<string, Record<string, unknown>>;
    }).loot;
    loot.set("ack-loot-1", {
      id: "ack-loot-1",
      itemId: "mire_shard",
      name: "Осколок",
      quantity: 1,
      position: { x: 0, y: 0, z: 0 },
      ownerId: character.id,
      publicAt: Date.now(),
      expiresAt: Date.now() + 10_000,
      audit: { sourceMonsterId: "monster-ack" },
    });

    await world.pickup("socket-1", "ack-loot-1");
    expect(loot.has("ack-loot-1")).toBe(true);
    await world.pickup("socket-1", "ack-loot-1");

    expect(loot.has("ack-loot-1")).toBe(false);
    const inventory = await store.getInventoryState(character.id);
    expect(inventory.inventory.items.find(({ itemId }) => itemId === "mire_shard")?.quantity).toBe(1);
    expect(
      (await store.listEconomyLedger(character.id)).filter(
        ({ eventType }) => eventType === "loot_acquired",
      ),
    ).toHaveLength(1);
  });

  it("refreshes a buff from the same source item instead of stacking it", async () => {
    const store = new TrackingMemoryStore();
    const account = await store.createAccount("buff-user", "hash");
    const classDefinition = getClass("warbound");
    const character = await store.createCharacter({
      accountId: account.id,
      name: "Освежитель",
      race: "erim",
      classId: "warbound",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    const world = new GameWorld(fakeIo(), store);
    await world.join(fakeSocket(), character);
    const firstExpiry = Date.now() + 60_000;
    const refreshedExpiry = firstExpiry + 30_000;
    const effect = {
      kind: "buff" as const,
      stats: { movementSpeedBps: 800 },
      durationMs: 90_000,
    };

    world.applyConsumableEffect(character.id, "swiftstep_elixir", effect, firstExpiry);
    world.applyConsumableEffect(character.id, "swiftstep_elixir", effect, refreshedExpiry);
    world.applyConsumableEffect(character.id, "swiftstep_elixir", effect, firstExpiry);

    const runtimePlayer = (world as unknown as {
      players: Map<
        string,
        { activeBuffs: Array<{ sourceItemId: string; expiresAt: number }> }
      >;
    }).players.get(character.id)!;
    expect(runtimePlayer.activeBuffs).toEqual([
      { sourceItemId: "swiftstep_elixir", stats: effect.stats, expiresAt: refreshedExpiry },
    ]);
  });

  it("applies restorative deltas without overwriting newer combat damage", async () => {
    const store = new TrackingMemoryStore();
    const account = await store.createAccount("vital-race-user", "hash");
    const classDefinition = getClass("warbound");
    const character = await store.createCharacter({
      accountId: account.id,
      name: "Живучий",
      race: "erim",
      classId: "warbound",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    const world = new GameWorld(fakeIo(), store);
    await world.join(fakeSocket(), character);
    const runtimePlayer = (world as unknown as {
      players: Map<string, { hp: number; mp: number }>;
    }).players.get(character.id)!;
    runtimePlayer.hp = 10;
    const state = await store.getInventoryState(character.id);

    world.applyInventoryState(character.id, state, { hp: 70, mp: 0 });

    expect(runtimePlayer.hp).toBe(80);
  });

  it("does not create a ghost when a socket disconnects during join", async () => {
    const store = new DelayedInventoryStore();
    const account = await store.createAccount("join-race-user", "hash");
    const classDefinition = getClass("warbound");
    const character = await store.createCharacter({
      accountId: account.id,
      name: "Исчезающий",
      race: "erim",
      classId: "warbound",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    const world = new GameWorld(fakeIo(), store);
    const socket = fakeSocket();
    Reflect.set(socket, "connected", true);

    const joining = world.join(socket, character);
    await store.loadStarted.promise;
    Reflect.set(socket, "connected", false);
    store.allowLoad.resolve();
    await joining;

    expect(world.isCharacterOnline(character.id)).toBe(false);
  });

  it("resumes cooldowns, buffs, mitigation and death state during reconnect grace", async () => {
    const store = new TrackingMemoryStore();
    const account = await store.createAccount("resume-user", "hash");
    const classDefinition = getClass("warbound");
    const character = await store.createCharacter({
      accountId: account.id,
      name: "Возвращающийся",
      race: "erim",
      classId: "warbound",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    const world = new GameWorld(fakeIo(), store);
    await world.join(fakeSocket(), character);
    const now = Date.now();
    const runtime = (world as unknown as {
      players: Map<
        string,
        {
          hp: number;
          alive: boolean;
          respawnAt: number | null;
          cooldowns: Map<string, number>;
          damageReductionUntil: number;
          activeBuffs: Array<{
            sourceItemId: string;
            stats: { armor?: number };
            expiresAt: number;
          }>;
        }
      >;
    }).players.get(character.id)!;
    runtime.cooldowns.set("iron_vow", now + 45_000);
    runtime.damageReductionUntil = now + 3_000;
    runtime.activeBuffs.push({
      sourceItemId: "warding_salve",
      stats: { armor: 18 },
      expiresAt: now + 60_000,
    });
    runtime.alive = false;
    runtime.hp = 0;
    runtime.respawnAt = now + 4_000;

    await world.leave("socket-1");
    const persisted = await store.getCharacterForAccount(character.id, account.id);
    await world.join(fakeSocket(undefined, "socket-2"), persisted!);

    const resumed = (world as unknown as {
      players: Map<string, typeof runtime>;
    }).players.get(character.id)!;
    expect(resumed.alive).toBe(false);
    expect(resumed.hp).toBe(0);
    expect(resumed.respawnAt).toBe(now + 4_000);
    expect(resumed.cooldowns.get("iron_vow")).toBe(now + 45_000);
    expect(resumed.damageReductionUntil).toBe(now + 3_000);
    expect(resumed.activeBuffs).toEqual([
      {
        sourceItemId: "warding_salve",
        stats: { armor: 18 },
        expiresAt: now + 60_000,
      },
    ]);
  });

  it("preserves resume state when a new socket replaces an active socket", async () => {
    const store = new TrackingMemoryStore();
    const account = await store.createAccount("replace-socket-user", "hash");
    const classDefinition = getClass("warbound");
    const character = await store.createCharacter({
      accountId: account.id,
      name: "СменяющийСвязь",
      race: "erim",
      classId: "warbound",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    const world = new GameWorld(fakeIo(), store);
    await world.join(fakeSocket(), character);
    const readyAt = Date.now() + 30_000;
    const original = (world as unknown as {
      players: Map<string, { cooldowns: Map<string, number> }>;
    }).players.get(character.id)!;
    original.cooldowns.set("iron_vow", readyAt);

    await world.join(fakeSocket(undefined, "socket-2"), character);

    const replacement = (world as unknown as {
      players: Map<string, { socketId: string; cooldowns: Map<string, number> }>;
    }).players.get(character.id)!;
    expect(replacement.socketId).toBe("socket-2");
    expect(replacement.cooldowns.get("iron_vow")).toBe(readyAt);
  });

  it("joins a persisted zero-HP character as dead when no resume state exists", async () => {
    const store = new TrackingMemoryStore();
    const account = await store.createAccount("dead-load-user", "hash");
    const classDefinition = getClass("warbound");
    const character = await store.createCharacter({
      accountId: account.id,
      name: "Павший",
      race: "erim",
      classId: "warbound",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    await store.saveCharacterState({
      id: character.id,
      operationId: null,
      position: character.position,
      hp: 0,
      mp: character.mp,
      xp: character.xp,
      level: character.level,
      goldDelta: 0,
    });
    const persisted = await store.getCharacterForAccount(character.id, account.id);
    const world = new GameWorld(fakeIo(), store);
    const beforeJoin = Date.now();
    await world.join(fakeSocket(), persisted!);
    const runtime = (world as unknown as {
      players: Map<string, { hp: number; alive: boolean; respawnAt: number | null }>;
    }).players.get(character.id)!;

    expect(runtime.alive).toBe(false);
    expect(runtime.hp).toBe(0);
    expect(runtime.respawnAt).toBeGreaterThanOrEqual(beforeJoin + 5_000);
    expect(runtime.respawnAt).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it("quiesces and clears runtime players before the store is closed", async () => {
    const store = new TrackingMemoryStore();
    const account = await store.createAccount("shutdown-user", "hash");
    const classDefinition = getClass("warbound");
    const character = await store.createCharacter({
      accountId: account.id,
      name: "Завершающий",
      race: "erim",
      classId: "warbound",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    const world = new GameWorld(fakeIo(), store);
    await world.join(fakeSocket(), character);
    expect(world.isCharacterOnline(character.id)).toBe(true);

    await world.stop();

    expect(world.isCharacterOnline(character.id)).toBe(false);
    await expect(world.leave("socket-1")).resolves.toBeUndefined();
  });
});
