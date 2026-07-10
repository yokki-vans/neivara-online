import { randomInt, randomUUID } from "node:crypto";
import {
  canEquipItem,
  getEnhancementCost,
  getClass,
  getItem,
  getOccupiedEquipmentSlots,
  getStarterItemGrants,
  isEquippableItem,
  resolveEnhancementAttempt,
  type CharacterSummary,
  type EquipmentLoadout,
  type EquipmentSlot,
  type InventoryStack,
  type InventoryView,
  type ItemId,
  type ItemInstance,
  type QuestProgress,
} from "@neivara/shared";
import {
  INVENTORY_CAPACITY,
  consumableEffect,
  equipmentSlotFor,
  equipmentStats,
  isStackable,
} from "./item-rules.js";
import {
  assertIdempotencyKey,
  assertIdempotencyScope,
  compactEnhanceItemResult,
  compactUseItemResult,
  enhanceItemFingerprint,
  hydrateEnhanceItemResult,
  hydrateUseItemResult,
  useItemFingerprint,
  type StoredEnhanceItemOutcome,
  type StoredUseItemOutcome,
} from "./idempotency.js";
import {
  CooldownError,
  ConflictError,
  IdempotencyConflictError,
  InsufficientFundsError,
  InvalidOperationError,
  InventoryFullError,
  LimitError,
  NotFoundError,
  inventoryStacks,
  type AccountRecord,
  type CharacterRecord,
  type EconomyEventType,
  type EconomyLedgerEntry,
  type EnhanceItemResult,
  type GameStore,
  type InventoryState,
  type NewCharacter,
  type QuestAdvanceResult,
  type SavedCharacterState,
  type UseItemResult,
} from "./types.js";

interface MemoryIdempotencyRecord {
  action: "use_item" | "enhance_item";
  fingerprint: string;
  outcome: StoredUseItemOutcome | StoredEnhanceItemOutcome;
  expiresAt: number;
}

interface MemoryWorldStateOperation {
  characterId: string;
  goldDelta: number;
  expiresAt: number;
}

interface MemoryLootClaim {
  characterId: string;
  itemId: ItemId;
  quantity: number;
  expiresAt: number;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

function cloneCharacter(record: CharacterRecord): CharacterRecord {
  return { ...record, position: { ...record.position } };
}

function cloneItem(item: ItemInstance): ItemInstance {
  return { ...item };
}

function toSummary(record: CharacterRecord): CharacterSummary {
  const { id, name, race, gender, classId, level, xp, gold, lastSeenAt } = record;
  return { id, name, race, gender, classId, level, xp, gold, lastSeenAt };
}

export class MemoryGameStore implements GameStore {
  readonly kind = "memory" as const;
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly accountByUsername = new Map<string, string>();
  private readonly characters = new Map<string, CharacterRecord>();
  private readonly characterByName = new Map<string, string>();
  private readonly inventories = new Map<string, Map<string, ItemInstance>>();
  private readonly quests = new Map<string, QuestProgress>();
  private readonly ledger = new Map<string, EconomyLedgerEntry[]>();
  private readonly consumableCooldowns = new Map<string, number>();
  private readonly idempotencyRecords = new Map<string, MemoryIdempotencyRecord>();
  private readonly worldStateOperations = new Map<string, MemoryWorldStateOperation>();
  private readonly lootClaims = new Map<string, MemoryLootClaim>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly enhancementRoll: () => number = () => randomInt(10_000),
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}

  async checkReadiness(): Promise<boolean> {
    return true;
  }

  async createAccount(username: string, passwordHash: string): Promise<AccountRecord> {
    const usernameKey = username.toLocaleLowerCase("ru");
    if (this.accountByUsername.has(usernameKey)) {
      throw new ConflictError("Аккаунт с таким логином уже существует");
    }

    const account: AccountRecord = {
      id: randomUUID(),
      username,
      usernameKey,
      passwordHash,
      createdAt: new Date(),
    };
    this.accounts.set(account.id, account);
    this.accountByUsername.set(usernameKey, account.id);
    return { ...account };
  }

  async findAccountByUsername(username: string): Promise<AccountRecord | null> {
    const id = this.accountByUsername.get(username.toLocaleLowerCase("ru"));
    const value = id ? this.accounts.get(id) : undefined;
    return value ? { ...value } : null;
  }

  async listCharacters(accountId: string): Promise<CharacterSummary[]> {
    return [...this.characters.values()]
      .filter((character) => character.accountId === accountId)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .map(toSummary);
  }

  async createCharacter(input: NewCharacter): Promise<CharacterRecord> {
    const owned = [...this.characters.values()].filter(
      (character) => character.accountId === input.accountId,
    );
    if (owned.length >= 7) throw new LimitError("Достигнут лимит в 7 персонажей");

    const nameKey = input.name.toLocaleLowerCase("ru");
    if (this.characterByName.has(nameKey)) {
      throw new ConflictError("Это имя уже занято");
    }

    const now = new Date().toISOString();
    const record: CharacterRecord = {
      id: randomUUID(),
      accountId: input.accountId,
      name: input.name,
      race: input.race,
      gender: input.gender ?? "male",
      classId: input.classId,
      level: 1,
      xp: 0,
      hp: input.hp,
      mp: input.mp,
      gold: 0,
      position: { x: 0, y: 0, z: 0 },
      createdAt: now,
      lastSeenAt: now,
    };

    this.characters.set(record.id, record);
    this.characterByName.set(nameKey, record.id);
    this.inventories.set(record.id, new Map());
    this.ledger.set(record.id, []);
    this.quests.set(record.id, {
      questId: "first_echoes",
      status: "active",
      current: 0,
      required: 3,
    });
    this.grantStarterItems(record);
    return cloneCharacter(record);
  }

  async getCharacterForAccount(
    characterId: string,
    accountId: string,
  ): Promise<CharacterRecord | null> {
    const record = this.characters.get(characterId);
    return record?.accountId === accountId ? cloneCharacter(record) : null;
  }

  async saveCharacterState(state: SavedCharacterState): Promise<{ gold: number }> {
    return this.withCharacterLock(state.id, () => {
      const record = this.characters.get(state.id);
      if (!record) return { gold: 0 };
      let appliedGoldDelta = state.goldDelta;
      if (!Number.isSafeInteger(state.goldDelta)) {
        throw new InvalidOperationError("Некорректное изменение баланса персонажа");
      }
      if (state.goldDelta !== 0) {
        this.deleteExpiredEconomyOperations();
        if (!state.operationId || state.operationId.length > 128) {
          throw new InvalidOperationError("Для изменения золота требуется корректный operationId");
        }
        const existing = this.worldStateOperations.get(state.operationId);
        if (existing) {
          if (existing.characterId !== state.id || existing.goldDelta !== state.goldDelta) {
            throw new IdempotencyConflictError(
              "operationId сохранения уже использован с другим персонажем или изменением золота",
            );
          }
          appliedGoldDelta = 0;
        }
      }
      if (record.gold + appliedGoldDelta < 0) {
        throw new InvalidOperationError("Некорректное изменение баланса персонажа");
      }
      const gold = record.gold + appliedGoldDelta;
      Object.assign(record, {
        position: { ...state.position },
        hp: state.hp,
        mp: state.mp,
        xp: state.xp,
        level: state.level,
        gold,
        lastSeenAt: new Date().toISOString(),
      });
      if (appliedGoldDelta !== 0) {
        this.worldStateOperations.set(state.operationId!, {
          characterId: state.id,
          goldDelta: state.goldDelta,
          expiresAt: this.now() + IDEMPOTENCY_TTL_MS,
        });
        this.appendLedger(
          record.id,
          "world_reward",
          appliedGoldDelta,
          null,
          null,
          0,
          null,
          { operationId: state.operationId },
        );
      }
      return { gold };
    });
  }

  async getInventoryState(characterId: string): Promise<InventoryState> {
    return this.inventoryStateUnsafe(characterId);
  }

  async getInventory(characterId: string): Promise<InventoryStack[]> {
    return inventoryStacks(this.inventoryViewUnsafe(characterId).items);
  }

  async addInventoryItem(
    characterId: string,
    itemId: ItemId,
    quantity: number,
    metadata: Record<string, unknown> = {},
    lootClaimId?: string,
  ): Promise<InventoryStack[]> {
    return this.withCharacterLock(characterId, () => {
      this.requireCharacter(characterId);
      if (lootClaimId) {
        this.deleteExpiredEconomyOperations();
        if (lootClaimId.length > 128) {
          throw new InvalidOperationError("Некорректный идентификатор добычи");
        }
        const existingClaim = this.lootClaims.get(lootClaimId);
        if (existingClaim) {
          if (
            existingClaim.characterId !== characterId ||
            existingClaim.itemId !== itemId ||
            existingClaim.quantity !== quantity
          ) {
            throw new IdempotencyConflictError("Эта добыча уже была получена");
          }
          return inventoryStacks(this.inventoryViewUnsafe(characterId).items);
        }
      }
      if (!Number.isInteger(quantity) || quantity === 0) {
        throw new InvalidOperationError("Количество предметов должно быть целым и ненулевым");
      }
      const items = this.requireInventory(characterId);
      if (quantity < 0) {
        this.removeByItemId(items, itemId, Math.abs(quantity));
        return inventoryStacks(this.inventoryViewUnsafe(characterId).items);
      }

      const stackable = isStackable(itemId);
      let ledgerInstanceId: string | null = null;
      if (stackable) {
        const existing = [...items.values()].find((item) => item.itemId === itemId);
        const definition = getItem(itemId);
        if (quantity > definition.stackLimit) {
          throw new InventoryFullError("Количество превышает максимальный размер стека");
        }
        if (existing) {
          if (existing.quantity + quantity > definition.stackLimit) {
            throw new InventoryFullError("Стек предмета достиг максимального размера");
          }
          existing.quantity += quantity;
          ledgerInstanceId = existing.instanceId;
        } else {
          this.ensureCapacity(items, 1);
          const item = this.newItem(itemId, quantity);
          items.set(item.instanceId, item);
          ledgerInstanceId = item.instanceId;
        }
      } else {
        this.ensureCapacity(items, quantity);
        for (let index = 0; index < quantity; index += 1) {
          const item = this.newItem(itemId, 1);
          items.set(item.instanceId, item);
          ledgerInstanceId ??= item.instanceId;
        }
      }

      this.appendLedger(
        characterId,
        "loot_acquired",
        0,
        ledgerInstanceId,
        itemId,
        quantity,
        0,
        lootClaimId ? { ...metadata, lootClaimId } : metadata,
      );
      if (lootClaimId) {
        this.lootClaims.set(lootClaimId, {
          characterId,
          itemId,
          quantity,
          expiresAt: this.now() + IDEMPOTENCY_TTL_MS,
        });
      }
      return inventoryStacks(this.inventoryViewUnsafe(characterId).items);
    });
  }

  async equipItem(
    characterId: string,
    instanceId: string,
    preferredSlot?: EquipmentSlot,
  ): Promise<InventoryState> {
    return this.withCharacterLock(characterId, () => {
      const character = this.requireCharacter(characterId);
      const items = this.requireInventory(characterId);
      const item = items.get(instanceId);
      if (!item) throw new NotFoundError("Предмет не найден в инвентаре персонажа");
      const definition = getItem(item.itemId);
      if (!isEquippableItem(definition)) {
        throw new InvalidOperationError("Этот предмет нельзя экипировать");
      }
      if (!canEquipItem(definition, character, preferredSlot)) {
        throw new InvalidOperationError(
          character.level < definition.requirements.level
            ? `Для предмета требуется ${definition.requirements.level} уровень`
            : "Предмет недоступен этому классу или слоту",
        );
      }
      const slot = equipmentSlotFor(definition, preferredSlot);
      const occupiedSlots = new Set(getOccupiedEquipmentSlots(definition, slot));
      for (const equipped of items.values()) {
        if (!equipped.equippedSlot || equipped.instanceId === item.instanceId) continue;
        const equippedDefinition = getItem(equipped.itemId);
        const existingOccupied = getOccupiedEquipmentSlots(
          equippedDefinition,
          equipped.equippedSlot,
        );
        if (existingOccupied.some((occupied) => occupiedSlots.has(occupied))) {
          equipped.equippedSlot = null;
        }
      }
      item.equippedSlot = slot;
      return this.inventoryStateUnsafe(characterId);
    });
  }

  async unequipItem(characterId: string, slot: EquipmentSlot): Promise<InventoryState> {
    return this.withCharacterLock(characterId, () => {
      this.requireCharacter(characterId);
      const item = [...this.requireInventory(characterId).values()].find(
        (candidate) => candidate.equippedSlot === slot,
      );
      if (!item) throw new NotFoundError("В этом слоте нет экипированного предмета");
      item.equippedSlot = null;
      return this.inventoryStateUnsafe(characterId);
    });
  }

  async useItem(
    characterId: string,
    instanceId: string,
    idempotencyKey: string,
    quantity = 1,
    runtimeEffectsAvailable = false,
  ) {
    assertIdempotencyKey(idempotencyKey);
    const fingerprint = useItemFingerprint(instanceId, quantity);
    return this.withCharacterLock(characterId, () => {
      const character = this.requireCharacter(characterId);
      const replay = this.idempotencyReplay<UseItemResult>(
        characterId,
        idempotencyKey,
        "use_item",
        fingerprint,
      );
      if (replay) return { result: replay, replayed: true };
      const items = this.requireInventory(characterId);
      const item = items.get(instanceId);
      if (!item) throw new NotFoundError("Предмет не найден в инвентаре персонажа");
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > item.quantity) {
        throw new InvalidOperationError("Некорректное количество предметов");
      }
      const effect = consumableEffect(item.itemId);
      if (!effect) throw new InvalidOperationError("Этот предмет нельзя использовать");
      const definition = getItem(item.itemId);
      if (definition.category !== "consumable") {
        throw new InvalidOperationError("Этот предмет нельзя использовать");
      }
      if (character.level < definition.requirements.level) {
        throw new InvalidOperationError(`Для предмета требуется ${definition.requirements.level} уровень`);
      }
      if ((effect.kind === "buff" || effect.kind === "return") && quantity !== 1) {
        throw new InvalidOperationError("Этот расходуемый предмет можно использовать только по одному");
      }
      if (effect.kind === "return" && effect.castTimeMs > 0) {
        throw new InvalidOperationError(
          `Возврат требует непрерывного сосредоточения ${effect.castTimeMs / 1_000} сек. и недоступен как мгновенное действие`,
        );
      }
      if (effect.kind === "buff" && !runtimeEffectsAvailable) {
        throw new InvalidOperationError(
          "Этот эффект можно применить только когда персонаж находится в игровом мире",
        );
      }
      const now = this.now();
      const cooldownKey = `${characterId}:${item.itemId}`;
      const readyAt = this.consumableCooldowns.get(cooldownKey) ?? 0;
      if (readyAt > now) {
        throw new CooldownError("Предмет ещё восстанавливается", readyAt - now);
      }

      const classDefinition = getClass(character.classId);
      const stateBefore = this.inventoryStateUnsafe(characterId);
      const maxHp = classDefinition.baseHp + (character.level - 1) * 14 + stateBefore.equipmentStats.maxHp;
      const maxMp = classDefinition.baseMp + (character.level - 1) * 9 + stateBefore.equipmentStats.maxMp;
      const hpBefore = character.hp;
      const mpBefore = character.mp;
      if (effect.kind === "restore") {
        if (effect.resource === "hp") {
          character.hp = Math.min(maxHp, character.hp + effect.amount * quantity);
        } else {
          character.mp = Math.min(maxMp, character.mp + effect.amount * quantity);
        }
      }
      item.quantity -= quantity;
      if (item.quantity === 0) items.delete(item.instanceId);
      const cooldownReadyAt = now + definition.cooldownMs;
      this.consumableCooldowns.set(cooldownKey, cooldownReadyAt);

      this.appendLedger(
        characterId,
        "item_consumed",
        0,
        item.instanceId,
        item.itemId,
        -quantity,
        item.enhancementLevel,
        {},
      );
      const operationResult: UseItemResult = {
        ...this.inventoryStateUnsafe(characterId),
        instanceId,
        sourceItemId: item.itemId,
        characterClassId: character.classId,
        characterLevel: character.level,
        quantityUsed: quantity,
        restoredHp: character.hp - hpBefore,
        restoredMp: character.mp - mpBefore,
        hp: character.hp,
        mp: character.mp,
        effect,
        cooldownReadyAt,
        effectExpiresAt: effect.kind === "buff" ? now + effect.durationMs : null,
      };
      this.rememberIdempotency(
        characterId,
        idempotencyKey,
        "use_item",
        fingerprint,
        operationResult,
      );
      return { result: operationResult, replayed: false };
    });
  }

  async enhanceItem(characterId: string, instanceId: string, idempotencyKey: string) {
    assertIdempotencyKey(idempotencyKey);
    const fingerprint = enhanceItemFingerprint(instanceId);
    return this.withCharacterLock(characterId, () => {
      const character = this.requireCharacter(characterId);
      const replay = this.idempotencyReplay<EnhanceItemResult>(
        characterId,
        idempotencyKey,
        "enhance_item",
        fingerprint,
      );
      if (replay) return { result: replay, replayed: true };
      const item = this.requireInventory(characterId).get(instanceId);
      if (!item) throw new NotFoundError("Предмет не найден в инвентаре персонажа");
      if (!isEquippableItem(getItem(item.itemId))) {
        throw new InvalidOperationError("Улучшать можно только экипировку");
      }
      const roll = this.nextEnhancementRoll();
      const result = resolveEnhancementAttempt(item.itemId, item.enhancementLevel, roll);
      if (!result.eligible) {
        throw new LimitError("Достигнут максимальный уровень улучшения");
      }
      const cost = getEnhancementCost(item.itemId, item.enhancementLevel);
      if (character.gold < cost.gold) {
        throw new InsufficientFundsError(`Для улучшения требуется ${cost.gold} марок`);
      }
      const catalystAvailable = [...this.requireInventory(characterId).values()]
        .filter((candidate) => candidate.itemId === cost.catalystItemId)
        .reduce((sum, candidate) => sum + candidate.quantity, 0);
      if (catalystAvailable < cost.catalystQuantity) {
        throw new InvalidOperationError(
          `Для улучшения требуется: ${getItem(cost.catalystItemId).name} ×${cost.catalystQuantity}`,
        );
      }
      character.gold -= cost.gold;
      this.removeByItemId(
        this.requireInventory(characterId),
        cost.catalystItemId,
        cost.catalystQuantity,
      );
      item.enhancementLevel = result.newLevel;
      this.appendLedger(
        characterId,
        "item_enhanced",
        -cost.gold,
        item.instanceId,
        item.itemId,
        0,
        item.enhancementLevel,
        {
          success: result.success,
          previousLevel: result.previousLevel,
          catalystItemId: cost.catalystItemId,
          catalystQuantity: cost.catalystQuantity,
          downgraded: result.downgraded,
          roll,
          chanceBps: result.chanceBps,
        },
      );
      const operationResult: EnhanceItemResult = {
        ...this.inventoryStateUnsafe(characterId),
        instanceId,
        characterClassId: character.classId,
        characterLevel: character.level,
        success: result.success,
        cost,
        previousLevel: result.previousLevel,
        enhancementLevel: item.enhancementLevel,
        chanceBps: result.chanceBps,
        downgraded: result.downgraded,
      };
      this.rememberIdempotency(
        characterId,
        idempotencyKey,
        "enhance_item",
        fingerprint,
        operationResult,
      );
      return { result: operationResult, replayed: false };
    });
  }

  async listEconomyLedger(characterId: string, limit = 50): Promise<EconomyLedgerEntry[]> {
    this.requireCharacter(characterId);
    return (this.ledger.get(characterId) ?? [])
      .slice(-Math.max(1, Math.min(200, limit)))
      .reverse()
      .map((entry) => ({ ...entry, metadata: { ...entry.metadata } }));
  }

  async getQuest(characterId: string): Promise<QuestProgress> {
    return {
      ...(this.quests.get(characterId) ?? {
        questId: "first_echoes",
        status: "active",
        current: 0,
        required: 3,
      }),
    };
  }

  async advanceQuest(
    characterId: string,
    questId: QuestProgress["questId"],
    amount = 1,
  ): Promise<QuestAdvanceResult> {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidOperationError("Прогресс задания должен быть положительным целым числом");
    }
    return this.withCharacterLock(characterId, () => {
      const character = this.requireCharacter(characterId);
      const current = this.quests.get(characterId) ?? {
        questId,
        status: "active" as const,
        current: 0,
        required: 3,
      };
      if (current.questId !== questId) throw new NotFoundError("Задание не найдено");
      if (current.status === "completed") {
        return { progress: { ...current }, rewarded: false, rewardGold: 0, gold: character.gold };
      }

      const progress: QuestProgress = {
        ...current,
        current: Math.min(current.required, current.current + amount),
      };
      const rewarded = progress.current >= progress.required;
      if (rewarded) {
        progress.status = "completed";
        character.gold += 25;
        this.appendLedger(
          characterId,
          "quest_reward",
          25,
          null,
          null,
          0,
          null,
          { questId },
        );
      }
      this.quests.set(characterId, progress);
      return {
        progress: { ...progress },
        rewarded,
        rewardGold: rewarded ? 25 : 0,
        gold: character.gold,
      };
    });
  }

  private requireCharacter(characterId: string): CharacterRecord {
    const character = this.characters.get(characterId);
    if (!character) throw new NotFoundError("Персонаж не найден");
    return character;
  }

  private requireInventory(characterId: string): Map<string, ItemInstance> {
    const inventory = this.inventories.get(characterId);
    if (!inventory) throw new NotFoundError("Инвентарь персонажа не найден");
    return inventory;
  }

  private newItem(itemId: ItemId, quantity: number): ItemInstance {
    return {
      instanceId: randomUUID(),
      itemId,
      quantity,
      enhancementLevel: 0,
      equippedSlot: null,
      bound: false,
      acquiredAt: new Date().toISOString(),
    };
  }

  private grantStarterItems(character: CharacterRecord): void {
    const items = this.requireInventory(character.id);
    for (const grant of getStarterItemGrants(character.classId)) {
      const item = this.newItem(grant.itemId, grant.quantity);
      item.equippedSlot = grant.autoEquipSlot;
      items.set(item.instanceId, item);
      this.appendLedger(
        character.id,
        "starter_grant",
        0,
        item.instanceId,
        item.itemId,
        item.quantity,
        0,
        { autoEquipSlot: grant.autoEquipSlot },
      );
    }
  }

  private inventoryViewUnsafe(characterId: string): InventoryView {
    const character = this.requireCharacter(characterId);
    const items = [...this.requireInventory(characterId).values()]
      .map(cloneItem)
      .sort((a, b) => a.acquiredAt.localeCompare(b.acquiredAt));
    const equipment: EquipmentLoadout = {};
    for (const item of items) {
      if (item.equippedSlot) equipment[item.equippedSlot] = cloneItem(item);
    }
    return {
      items,
      equipment,
      gold: character.gold,
      capacity: INVENTORY_CAPACITY,
      usedSlots: items.length,
    };
  }

  private inventoryStateUnsafe(characterId: string): InventoryState {
    const inventory = this.inventoryViewUnsafe(characterId);
    return { inventory, equipmentStats: equipmentStats(inventory.equipment) };
  }

  private removeByItemId(items: Map<string, ItemInstance>, itemId: ItemId, quantity: number): void {
    const matching = [...items.values()].filter((item) => item.itemId === itemId);
    const available = matching.reduce((sum, item) => sum + item.quantity, 0);
    if (available < quantity) throw new InvalidOperationError("Недостаточно предметов");
    let remaining = quantity;
    for (const item of matching) {
      const removed = Math.min(item.quantity, remaining);
      item.quantity -= removed;
      remaining -= removed;
      if (item.quantity === 0) items.delete(item.instanceId);
      if (remaining === 0) break;
    }
  }

  private ensureCapacity(items: Map<string, ItemInstance>, additionalSlots: number): void {
    if (items.size + additionalSlots > INVENTORY_CAPACITY) {
      throw new InventoryFullError("В инвентаре недостаточно места");
    }
  }

  private appendLedger(
    characterId: string,
    eventType: EconomyEventType,
    goldDelta: number,
    itemInstanceId: string | null,
    itemId: ItemId | null,
    quantityDelta: number,
    enhancementLevel: number | null,
    metadata: Record<string, unknown>,
  ): void {
    const character = this.requireCharacter(characterId);
    const entries = this.ledger.get(characterId) ?? [];
    entries.push({
      id: randomUUID(),
      characterId,
      eventType,
      goldDelta,
      balanceAfter: character.gold,
      itemInstanceId,
      itemId,
      quantityDelta,
      enhancementLevel,
      metadata: { ...metadata },
      createdAt: new Date().toISOString(),
    });
    this.ledger.set(characterId, entries);
  }

  private idempotencyReplay<T extends UseItemResult | EnhanceItemResult>(
    characterId: string,
    idempotencyKey: string,
    action: MemoryIdempotencyRecord["action"],
    fingerprint: string,
  ): T | null {
    this.deleteExpiredIdempotencyRecords();
    const storageKey = `${characterId}:${idempotencyKey}`;
    const record = this.idempotencyRecords.get(storageKey);
    if (!record) return null;
    if (record.expiresAt <= this.now()) {
      this.idempotencyRecords.delete(storageKey);
      return null;
    }
    assertIdempotencyScope(record.action, record.fingerprint, action, fingerprint);
    const state = this.inventoryStateUnsafe(characterId);
    const character = this.requireCharacter(characterId);
    const hydrated =
      action === "use_item"
        ? hydrateUseItemResult(structuredClone(record.outcome) as StoredUseItemOutcome, state)
        : hydrateEnhanceItemResult(
            structuredClone(record.outcome) as StoredEnhanceItemOutcome,
            state,
          );
    hydrated.characterClassId = character.classId;
    hydrated.characterLevel = character.level;
    return hydrated as T;
  }

  private rememberIdempotency(
    characterId: string,
    idempotencyKey: string,
    action: MemoryIdempotencyRecord["action"],
    fingerprint: string,
    result: UseItemResult | EnhanceItemResult,
  ): void {
    this.idempotencyRecords.set(`${characterId}:${idempotencyKey}`, {
      action,
      fingerprint,
      outcome: structuredClone(
        action === "use_item"
          ? compactUseItemResult(result as UseItemResult)
          : compactEnhanceItemResult(result as EnhanceItemResult),
      ),
      expiresAt: this.now() + IDEMPOTENCY_TTL_MS,
    });
  }

  private deleteExpiredIdempotencyRecords(): void {
    const now = this.now();
    let deleted = 0;
    for (const [key, record] of this.idempotencyRecords) {
      if (record.expiresAt <= now) {
        this.idempotencyRecords.delete(key);
        deleted += 1;
        if (deleted >= 100) break;
      }
    }
  }

  private deleteExpiredEconomyOperations(): void {
    const now = this.now();
    let deleted = 0;
    for (const [operationId, operation] of this.worldStateOperations) {
      if (operation.expiresAt <= now) {
        this.worldStateOperations.delete(operationId);
        deleted += 1;
        if (deleted >= 100) break;
      }
    }
    deleted = 0;
    for (const [claimId, claim] of this.lootClaims) {
      if (claim.expiresAt <= now) {
        this.lootClaims.delete(claimId);
        deleted += 1;
        if (deleted >= 100) break;
      }
    }
  }

  private nextEnhancementRoll(): number {
    const roll = this.enhancementRoll();
    if (!Number.isInteger(roll) || roll < 0 || roll >= 10_000) {
      throw new Error("Enhancement RNG must return an integer from 0 through 9999");
    }
    return roll;
  }

  private async withCharacterLock<T>(characterId: string, operation: () => T | Promise<T>): Promise<T> {
    const previous = this.locks.get(characterId) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = previous.then(() => current);
    this.locks.set(characterId, queue);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(characterId) === queue) this.locks.delete(characterId);
    }
  }
}
