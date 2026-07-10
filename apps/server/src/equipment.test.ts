import { getClass, getEnhancementCost } from "@neivara/shared";
import { describe, expect, it } from "vitest";
import {
  CooldownError,
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  InvalidOperationError,
  MemoryGameStore,
} from "./store/index.js";

const key = (suffix: string) => `test-idempotency-${suffix}`;

async function createCharacter(store: MemoryGameStore, classId: "warrior" | "mage" = "warrior") {
  const account = await store.createAccount(`user-${classId}`, "hash");
  const definition = getClass(classId);
  return store.createCharacter({
    accountId: account.id,
    name: classId === "warrior" ? "Ратник" : "Эфирник",
    race: "human",
    classId,
    hp: definition.baseHp,
    mp: definition.baseMp,
  });
}

describe("equipment and economy store", () => {
  it("creates a complete starter loadout and applies its stat bonuses", async () => {
    const store = new MemoryGameStore();
    const character = await createCharacter(store);
    const state = await store.getInventoryState(character.id);

    expect(state.inventory.items).toHaveLength(8);
    expect(Object.keys(state.inventory.equipment)).toEqual(
      expect.arrayContaining(["main_hand", "head", "chest", "hands", "legs", "feet"]),
    );
    expect(state.equipmentStats.physicalAttack).toBeGreaterThan(0);
    expect(state.equipmentStats.armor).toBeGreaterThan(0);
    expect(state.inventory.usedSlots).toBe(8);
  });

  it("atomically equips, unequips and validates class restrictions", async () => {
    const store = new MemoryGameStore();
    const character = await createCharacter(store);
    await store.addInventoryItem(character.id, "emberglyph_staff", 1);
    const state = await store.getInventoryState(character.id);
    const staff = state.inventory.items.find((item) => item.itemId === "emberglyph_staff");
    expect(staff).toBeDefined();

    await expect(store.equipItem(character.id, staff!.instanceId)).rejects.toBeInstanceOf(
      InvalidOperationError,
    );

    const mainHand = state.inventory.equipment.main_hand!;
    const unequipped = await store.unequipItem(character.id, "main_hand");
    expect(unequipped.inventory.equipment.main_hand).toBeUndefined();
    const equipped = await store.equipItem(character.id, mainHand.instanceId);
    expect(equipped.inventory.equipment.main_hand?.instanceId).toBe(mainHand.instanceId);
  });

  it("consumes restorative items without trusting a client-provided effect", async () => {
    let now = 10_000;
    const store = new MemoryGameStore(() => 0, () => now);
    const character = await createCharacter(store);
    await store.saveCharacterState({
      id: character.id,
      operationId: null,
      position: character.position,
      hp: 20,
      mp: character.mp,
      xp: 0,
      level: 1,
      goldDelta: 0,
    });
    const before = await store.getInventoryState(character.id);
    const tonic = before.inventory.items.find((item) => item.itemId === "field_tonic")!;

    const first = await store.useItem(character.id, tonic.instanceId, key("restore-first"));
    const result = first.result;
    expect(first.replayed).toBe(false);
    expect(result.effect).toEqual({ kind: "restore", resource: "hp", amount: 70 });
    expect(result.restoredHp).toBe(70);
    expect(result.cooldownReadyAt).toBe(now + 12_000);
    expect(result.inventory.items.find((item) => item.instanceId === tonic.instanceId)?.quantity).toBe(4);

    const replay = await store.useItem(character.id, tonic.instanceId, key("restore-first"));
    expect(replay.replayed).toBe(true);
    expect(replay.result.quantityUsed).toBe(result.quantityUsed);
    expect(replay.result.cooldownReadyAt).toBe(result.cooldownReadyAt);
    expect(replay.result.inventory.items.find((item) => item.instanceId === tonic.instanceId)?.quantity).toBe(4);

    await expect(
      store.useItem(character.id, tonic.instanceId, key("restore-cooldown")),
    ).rejects.toMatchObject({
      name: "CooldownError",
      retryAfterMs: 12_000,
    });
    expect(
      (await store.getInventoryState(character.id)).inventory.items.find(
        (item) => item.instanceId === tonic.instanceId,
      )?.quantity,
    ).toBe(4);

    now += 12_000;
    await expect(
      store.useItem(character.id, tonic.instanceId, key("restore-second")),
    ).resolves.toMatchObject({
      result: { quantityUsed: 1 },
    });
    const delayedReplay = await store.useItem(
      character.id,
      tonic.instanceId,
      key("restore-first"),
    );
    expect(delayedReplay.result.inventory.items.find(
      (item) => item.instanceId === tonic.instanceId,
    )?.quantity).toBe(3);
    expect(delayedReplay.result.cooldownReadyAt).toBe(result.cooldownReadyAt);

    const otherCharacter = await createCharacter(store, "mage");
    const otherTonic = (await store.getInventoryState(otherCharacter.id)).inventory.items.find(
      (item) => item.itemId === "field_tonic",
    )!;
    const sameKeyDifferentOwner = await store.useItem(
      otherCharacter.id,
      otherTonic.instanceId,
      key("restore-first"),
    );
    expect(sameKeyDifferentOwner.replayed).toBe(false);
    expect(sameKeyDifferentOwner.result.inventory.items.find(
      (item) => item.instanceId === otherTonic.instanceId,
    )?.quantity).toBe(4);
  });

  it("allows only one buff per use and enforces its authoritative cooldown", async () => {
    let now = 50_000;
    const store = new MemoryGameStore(() => 0, () => now);
    const character = await createCharacter(store);
    await store.saveCharacterState({
      id: character.id,
      operationId: null,
      position: character.position,
      hp: character.hp,
      mp: character.mp,
      xp: 1_000_000,
      level: 60,
      goldDelta: 0,
    });
    await store.addInventoryItem(character.id, "swiftstep_elixir", 2);
    const elixir = (await store.getInventoryState(character.id)).inventory.items.find(
      (item) => item.itemId === "swiftstep_elixir",
    )!;

    await expect(
      store.useItem(character.id, elixir.instanceId, key("buff-quantity"), 2, true),
    ).rejects.toBeInstanceOf(InvalidOperationError);
    expect(
      (await store.getInventoryState(character.id)).inventory.items.find(
        (item) => item.instanceId === elixir.instanceId,
      )?.quantity,
    ).toBe(2);

    await expect(
      store.useItem(character.id, elixir.instanceId, key("buff-online-guard"), 1, false),
    ).rejects.toThrow(/только когда персонаж находится в игровом мире/i);
    expect(
      (await store.getInventoryState(character.id)).inventory.items.find(
        (item) => item.instanceId === elixir.instanceId,
      )?.quantity,
    ).toBe(2);

    const used = (
      await store.useItem(
        character.id,
        elixir.instanceId,
        key("buff-online-guard"),
        1,
        true,
      )
    ).result;
    expect(used.effect.kind).toBe("buff");
    expect(used.cooldownReadyAt).toBe(now + 30_000);
    await expect(
      store.useItem(character.id, elixir.instanceId, key("buff-cooldown"), 1, true),
    ).rejects.toBeInstanceOf(CooldownError);
    now += 30_000;
    await expect(
      store.useItem(character.id, elixir.instanceId, key("buff-second"), 1, true),
    ).resolves.toMatchObject({
      result: { quantityUsed: 1 },
    });
  });

  it("refuses to execute a cast-time return as an instant REST action", async () => {
    const store = new MemoryGameStore();
    const character = await createCharacter(store);
    await store.saveCharacterState({
      id: character.id,
      operationId: null,
      position: character.position,
      hp: character.hp,
      mp: character.mp,
      xp: 1_000_000,
      level: 60,
      goldDelta: 0,
    });
    await store.addInventoryItem(character.id, "returning_stone", 1);
    const stone = (await store.getInventoryState(character.id)).inventory.items.find(
      (item) => item.itemId === "returning_stone",
    )!;

    await expect(store.useItem(character.id, stone.instanceId, key("return-first"))).rejects.toThrow(
      /недоступен как мгновенное действие/i,
    );
    expect(
      (await store.getInventoryState(character.id)).inventory.items.find(
        (item) => item.instanceId === stone.instanceId,
      )?.quantity,
    ).toBe(1);
    await expect(
      store.useItem(character.id, stone.instanceId, key("return-first")),
    ).rejects.toBeInstanceOf(InvalidOperationError);
  });

  it("idempotently serializes enhancements, spends once and audits the secure roll", async () => {
    let rngCalls = 0;
    const store = new MemoryGameStore(() => {
      rngCalls += 1;
      return 0;
    });
    const character = await createCharacter(store);
    const initial = await store.getInventoryState(character.id);
    const weapon = initial.inventory.equipment.main_hand!;
    const cost = getEnhancementCost(weapon.itemId, weapon.enhancementLevel);
    await store.addInventoryItem(character.id, cost.catalystItemId, cost.catalystQuantity);
    await store.saveCharacterState({
      id: character.id,
      operationId: "equipment-enhance-funding-0001",
      position: character.position,
      hp: character.hp,
      mp: character.mp,
      xp: 0,
      level: 1,
      goldDelta: cost.gold * 2,
    });

    const attempts = await Promise.all([
      store.enhanceItem(character.id, weapon.instanceId, key("enhance-same")),
      store.enhanceItem(character.id, weapon.instanceId, key("enhance-same")),
    ]);
    expect(attempts.map((attempt) => attempt.replayed).sort()).toEqual([false, true]);
    expect(attempts[1]!.result.success).toBe(attempts[0]!.result.success);
    expect(rngCalls).toBe(1);

    const after = await store.getInventoryState(character.id);
    expect(after.inventory.equipment.main_hand?.enhancementLevel).toBe(1);
    expect(after.inventory.gold).toBe(cost.gold);
    const ledger = await store.listEconomyLedger(character.id);
    expect(ledger.filter((entry) => entry.eventType === "item_enhanced")).toHaveLength(1);
    expect(ledger.find((entry) => entry.eventType === "item_enhanced")?.goldDelta).toBe(-cost.gold);
    expect(ledger.find((entry) => entry.eventType === "item_enhanced")?.metadata).toMatchObject({
      roll: 0,
      chanceBps: expect.any(Number),
    });
    await expect(
      store.useItem(character.id, initial.inventory.items.find((item) => item.itemId === "field_tonic")!.instanceId, key("enhance-same")),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(
      store.enhanceItem(character.id, weapon.instanceId, "short"),
    ).rejects.toBeInstanceOf(InvalidIdempotencyKeyError);
  });

  it("applies concurrent world rewards as deltas without overwriting an enhancement debit", async () => {
    const store = new MemoryGameStore(() => 0);
    const character = await createCharacter(store);
    const initial = await store.getInventoryState(character.id);
    const weapon = initial.inventory.equipment.main_hand!;
    const cost = getEnhancementCost(weapon.itemId, weapon.enhancementLevel);
    await store.addInventoryItem(character.id, cost.catalystItemId, cost.catalystQuantity);
    await store.saveCharacterState({
      id: character.id,
      operationId: "equipment-world-funding-0001",
      position: character.position,
      hp: character.hp,
      mp: character.mp,
      xp: 0,
      level: 1,
      goldDelta: cost.gold + 100,
    });

    await Promise.all([
      store.enhanceItem(character.id, weapon.instanceId, key("enhance-world-reward")),
      store.saveCharacterState({
        id: character.id,
        operationId: "equipment-world-reward-0002",
        position: character.position,
        hp: character.hp,
        mp: character.mp,
        xp: 42,
        level: 1,
        goldDelta: 25,
      }),
    ]);

    expect((await store.getInventoryState(character.id)).inventory.gold).toBe(125);
    const goldEntries = (await store.listEconomyLedger(character.id)).filter(
      (entry) => entry.goldDelta !== 0,
    );
    expect(goldEntries.reduce((sum, entry) => sum + entry.goldDelta, 0)).toBe(125);
  });

  it("completes a quest and grants its reward exactly once under concurrent progress", async () => {
    const store = new MemoryGameStore();
    const character = await createCharacter(store);

    const attempts = await Promise.all(
      Array.from({ length: 6 }, () => store.advanceQuest(character.id, "first_echoes", 1)),
    );

    expect(attempts.filter(({ rewarded }) => rewarded)).toHaveLength(1);
    expect(await store.getQuest(character.id)).toEqual({
      questId: "first_echoes",
      status: "completed",
      current: 3,
      required: 3,
    });
    expect((await store.getInventoryState(character.id)).inventory.gold).toBe(25);
    const rewards = (await store.listEconomyLedger(character.id)).filter(
      ({ eventType }) => eventType === "quest_reward",
    );
    expect(rewards).toHaveLength(1);
    expect(rewards[0]).toMatchObject({ goldDelta: 25, balanceAfter: 25 });
  });

  it("scopes durable world operations and loot claims against conflicting reuse", async () => {
    const store = new MemoryGameStore();
    const character = await createCharacter(store);
    const state = {
      id: character.id,
      operationId: "memory-world-operation-0001",
      position: character.position,
      hp: character.hp,
      mp: character.mp,
      xp: character.xp,
      level: character.level,
      goldDelta: 10,
    };

    await store.saveCharacterState(state);
    await store.saveCharacterState(state);
    expect((await store.getInventoryState(character.id)).inventory.gold).toBe(10);
    await expect(
      store.saveCharacterState({ ...state, goldDelta: 11 }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    await store.addInventoryItem(
      character.id,
      "mire_shard",
      1,
      {},
      "memory-loot-claim-0001",
    );
    await store.addInventoryItem(
      character.id,
      "mire_shard",
      1,
      {},
      "memory-loot-claim-0001",
    );
    expect(
      (await store.getInventoryState(character.id)).inventory.items.find(
        ({ itemId }) => itemId === "mire_shard",
      )?.quantity,
    ).toBe(1);
    await expect(
      store.addInventoryItem(
        character.id,
        "resonant_dust",
        1,
        {},
        "memory-loot-claim-0001",
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
