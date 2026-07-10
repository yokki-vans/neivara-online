import type {
  CharacterSummary,
  ClassId,
  ConsumableEffect,
  EnhancementCost,
  EquipmentSlot,
  GenderId,
  InventoryView,
  InventoryStack,
  ItemInstance,
  ItemId,
  ItemStatBlock,
  QuestProgress,
  RaceId,
  Vec3,
} from "@neivara/shared";

export interface AccountRecord {
  id: string;
  username: string;
  usernameKey: string;
  passwordHash: string;
  createdAt: Date;
}

export interface CharacterRecord extends CharacterSummary {
  accountId: string;
  position: Vec3;
  hp: number;
  mp: number;
  createdAt: string;
}

export interface NewCharacter {
  accountId: string;
  name: string;
  race: RaceId;
  /** Defaults to male for trusted legacy import callers; the public API requires it. */
  gender?: GenderId;
  classId: ClassId;
  hp: number;
  mp: number;
}

export interface SavedCharacterState {
  id: string;
  operationId: string | null;
  position: Vec3;
  hp: number;
  mp: number;
  xp: number;
  level: number;
  /**
   * World-earned currency since the last successful persistence. Inventory/economy
   * mutations own the durable balance, so persistence must apply a delta rather
   * than replace it with a potentially stale runtime snapshot.
   */
  goldDelta: number;
}

export interface SavedCharacterResult {
  gold: number;
}

export interface InventoryState {
  inventory: InventoryView;
  equipmentStats: ItemStatBlock;
}

export interface UseItemResult extends InventoryState {
  instanceId: string;
  sourceItemId: ItemId;
  characterClassId: ClassId;
  characterLevel: number;
  quantityUsed: number;
  restoredHp: number;
  restoredMp: number;
  hp: number;
  mp: number;
  effect: ConsumableEffect;
  cooldownReadyAt: number;
  effectExpiresAt: number | null;
}

export interface EnhanceItemResult extends InventoryState {
  instanceId: string;
  characterClassId: ClassId;
  characterLevel: number;
  success: boolean;
  cost: EnhancementCost;
  previousLevel: number;
  enhancementLevel: number;
  chanceBps: number;
  downgraded: boolean;
}

export interface IdempotentOperationResult<T> {
  result: T;
  replayed: boolean;
}

export interface QuestAdvanceResult {
  progress: QuestProgress;
  rewarded: boolean;
  rewardGold: number;
  gold: number;
}

export type EconomyEventType =
  | "starter_grant"
  | "loot_acquired"
  | "item_consumed"
  | "item_enhanced"
  | "quest_reward"
  | "world_reward"
  | "admin_adjustment";

export interface EconomyLedgerEntry {
  id: string;
  characterId: string;
  eventType: EconomyEventType;
  goldDelta: number;
  balanceAfter: number;
  itemInstanceId: string | null;
  itemId: ItemId | null;
  quantityDelta: number;
  enhancementLevel: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface GameStore {
  readonly kind: "memory" | "postgres";
  initialize(): Promise<void>;
  close(): Promise<void>;
  checkReadiness(): Promise<boolean>;
  createAccount(username: string, passwordHash: string): Promise<AccountRecord>;
  findAccountByUsername(username: string): Promise<AccountRecord | null>;
  listCharacters(accountId: string): Promise<CharacterSummary[]>;
  createCharacter(input: NewCharacter): Promise<CharacterRecord>;
  getCharacterForAccount(characterId: string, accountId: string): Promise<CharacterRecord | null>;
  saveCharacterState(state: SavedCharacterState): Promise<SavedCharacterResult>;
  getInventoryState(characterId: string): Promise<InventoryState>;
  getInventory(characterId: string): Promise<InventoryStack[]>;
  addInventoryItem(
    characterId: string,
    itemId: ItemId,
    quantity: number,
    metadata?: Record<string, unknown>,
    lootClaimId?: string,
  ): Promise<InventoryStack[]>;
  equipItem(
    characterId: string,
    instanceId: string,
    preferredSlot?: EquipmentSlot,
  ): Promise<InventoryState>;
  unequipItem(characterId: string, slot: EquipmentSlot): Promise<InventoryState>;
  useItem(
    characterId: string,
    instanceId: string,
    idempotencyKey: string,
    quantity?: number,
    runtimeEffectsAvailable?: boolean,
  ): Promise<IdempotentOperationResult<UseItemResult>>;
  enhanceItem(
    characterId: string,
    instanceId: string,
    idempotencyKey: string,
  ): Promise<IdempotentOperationResult<EnhanceItemResult>>;
  listEconomyLedger(characterId: string, limit?: number): Promise<EconomyLedgerEntry[]>;
  getQuest(characterId: string): Promise<QuestProgress>;
  advanceQuest(
    characterId: string,
    questId: QuestProgress["questId"],
    amount?: number,
  ): Promise<QuestAdvanceResult>;
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class InvalidOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOperationError";
  }
}

export class InsufficientFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientFundsError";
  }
}

export class InventoryFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryFullError";
  }
}

export class CooldownError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = "CooldownError";
  }
}

export class InvalidIdempotencyKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidIdempotencyKeyError";
  }
}

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export function inventoryStacks(items: readonly ItemInstance[]): InventoryStack[] {
  const totals = new Map<ItemId, number>();
  for (const item of items) totals.set(item.itemId, (totals.get(item.itemId) ?? 0) + item.quantity);
  return [...totals].map(([itemId, quantity]) => ({ itemId, quantity }));
}
