import { randomInt, randomUUID } from "node:crypto";
import type {
  CharacterSummary,
  ClassId,
  EquipmentLoadout,
  EquipmentSlot,
  GenderId,
  InventoryStack,
  InventoryView,
  ItemId,
  ItemInstance,
  QuestProgress,
  RaceId,
} from "@neivara/shared";
import {
  canEquipItem,
  getEnhancementCost,
  getClass,
  getItem,
  getOccupiedEquipmentSlots,
  getStarterItemGrants,
  isEquippableItem,
  normalizeClassId,
  normalizeGenderId,
  normalizeRaceId,
  resolveEnhancementAttempt,
} from "@neivara/shared";
import { Pool, type PoolClient } from "pg";
import { MIGRATIONS } from "./migrations.js";
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
  INVENTORY_CAPACITY,
  consumableEffect,
  equipmentSlotFor,
  equipmentStats,
  isStackable,
} from "./item-rules.js";
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
  type EconomyLedgerEntry,
  type EnhanceItemResult,
  type GameStore,
  type InventoryState,
  type NewCharacter,
  type QuestAdvanceResult,
  type SavedCharacterState,
  type UseItemResult,
} from "./types.js";

interface AccountRow {
  id: string;
  username: string;
  username_key: string;
  password_hash: string;
  created_at: Date;
}

interface CharacterRow {
  id: string;
  account_id: string;
  name: string;
  race: RaceId;
  gender: GenderId;
  class_id: ClassId;
  level: number;
  xp: number;
  hp: number;
  mp: number;
  gold: number;
  position_x: number;
  position_y: number;
  position_z: number;
  created_at: Date;
  last_seen_at: Date;
}

interface PersistedCharacterRow extends Omit<CharacterRow, "race" | "gender" | "class_id"> {
  race: string;
  gender: string | null;
  class_id: string;
}

interface ItemInstanceRow {
  id: string;
  item_id: ItemId;
  quantity: number;
  enhance_level: number;
  bound: boolean;
  created_at: Date;
  equipped_slot: EquipmentSlot | null;
}

interface EconomyLedgerRow {
  id: string;
  character_id: string;
  event_type: EconomyLedgerEntry["eventType"];
  gold_delta: number;
  balance_after: number;
  item_instance_id: string | null;
  item_id: ItemId | null;
  quantity_delta: number;
  enhance_level: number | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

interface IdempotencyRecordRow {
  action: "use_item" | "enhance_item";
  request_fingerprint: string;
  response: StoredUseItemOutcome | StoredEnhanceItemOutcome;
}

const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;
const MIGRATION_LOCK_KEYS = [1_314_272_118, 1_295_526_721] as const;

function mapAccount(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    username: row.username,
    usernameKey: row.username_key,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

function normalizeCharacterRow(row: PersistedCharacterRow): CharacterRow {
  return {
    ...row,
    race: normalizeRaceId(row.race),
    gender: normalizeGenderId(row.gender),
    class_id: normalizeClassId(row.class_id),
  };
}

function mapCharacter(persisted: PersistedCharacterRow): CharacterRecord {
  const row = normalizeCharacterRow(persisted);
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    race: row.race,
    gender: row.gender,
    classId: row.class_id,
    level: row.level,
    xp: row.xp,
    hp: row.hp,
    mp: row.mp,
    gold: row.gold,
    position: { x: row.position_x, y: row.position_y, z: row.position_z },
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
  };
}

function toSummary(row: PersistedCharacterRow): CharacterSummary {
  const record = mapCharacter(row);
  return {
    id: record.id,
    name: record.name,
    race: record.race,
    gender: record.gender,
    classId: record.classId,
    level: record.level,
    xp: record.xp,
    gold: record.gold,
    lastSeenAt: record.lastSeenAt,
  };
}

function mapItem(row: ItemInstanceRow): ItemInstance {
  return {
    instanceId: row.id,
    itemId: row.item_id,
    quantity: row.quantity,
    enhancementLevel: row.enhance_level,
    equippedSlot: row.equipped_slot,
    bound: row.bound,
    acquiredAt: row.created_at.toISOString(),
  };
}

function mapLedger(row: EconomyLedgerRow): EconomyLedgerEntry {
  return {
    id: row.id,
    characterId: row.character_id,
    eventType: row.event_type,
    goldDelta: row.gold_delta,
    balanceAfter: row.balance_after,
    itemInstanceId: row.item_instance_id,
    itemId: row.item_id,
    quantityDelta: row.quantity_delta,
    enhancementLevel: row.enhance_level,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export class PostgresGameStore implements GameStore {
  readonly kind = "postgres" as const;
  private readonly pool: Pool;

  constructor(
    connectionString: string,
    ssl: boolean,
    private readonly autoMigrate: boolean,
    private readonly enhancementRoll: () => number = () => randomInt(10_000),
    private readonly migrationLockTimeoutMs = 10_000,
  ) {
    this.pool = new Pool({
      connectionString,
      ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 1_500,
    });
  }

  async initialize(): Promise<void> {
    await this.pool.query("SELECT 1");
    if (this.autoMigrate) await this.runMigrations();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async checkReadiness(): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.pool.query<{ version: number }>(
          `SELECT COALESCE(MAX(version), 0)::integer AS version
           FROM schema_migrations`,
        ),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("PostgreSQL readiness timeout")), 1_000);
          timeout.unref?.();
        }),
      ]);
      return result.rows[0]?.version === LATEST_SCHEMA_VERSION;
    } catch {
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async runMigrations(): Promise<void> {
    const client = await this.pool.connect();
    let migrationLockHeld = false;
    let migrationTimeoutsConfigured = false;
    try {
      await this.acquireMigrationLock(client);
      migrationLockHeld = true;
      await this.configureMigrationTimeouts(client);
      migrationTimeoutsConfigured = true;
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      const result = await client.query<{ version: number }>("SELECT version FROM schema_migrations");
      const applied = new Set(result.rows.map((row) => row.version));

      for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        await client.query("BEGIN");
        try {
          await client.query(migration.sql);
          await client.query(
            "INSERT INTO schema_migrations(version, name) VALUES($1, $2)",
            [migration.version, migration.name],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      let releaseError: Error | undefined;
      if (migrationLockHeld) {
        try {
          await client.query("SELECT pg_advisory_unlock($1, $2)", [
            ...MIGRATION_LOCK_KEYS,
          ]);
        } catch (error) {
          releaseError = error instanceof Error ? error : new Error("Migration unlock failed");
        }
      }
      if (migrationTimeoutsConfigured) {
        try {
          await client.query("RESET lock_timeout; RESET statement_timeout");
        } catch (error) {
          releaseError ??=
            error instanceof Error ? error : new Error("Migration timeout reset failed");
        }
      }
      client.release(releaseError);
    }
  }

  private async configureMigrationTimeouts(client: PoolClient): Promise<void> {
    const statementTimeoutMs = Math.min(
      300_000,
      Math.max(5_000, this.migrationLockTimeoutMs * 6),
    );
    await client.query(
      `SELECT
         set_config('lock_timeout', $1, false),
         set_config('statement_timeout', $2, false)`,
      [`${this.migrationLockTimeoutMs}ms`, `${statementTimeoutMs}ms`],
    );
  }

  private async acquireMigrationLock(client: PoolClient): Promise<void> {
    const deadline = Date.now() + this.migrationLockTimeoutMs;
    while (true) {
      const result = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1, $2) AS locked",
        [...MIGRATION_LOCK_KEYS],
      );
      if (result.rows[0]?.locked) return;

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(
          `Timed out waiting ${this.migrationLockTimeoutMs}ms for the database migration lock`,
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, remainingMs)));
    }
  }

  async createAccount(username: string, passwordHash: string): Promise<AccountRecord> {
    try {
      const result = await this.pool.query<AccountRow>(
        `INSERT INTO accounts(id, username, username_key, password_hash)
         VALUES($1, $2, $3, $4)
         RETURNING *`,
        [randomUUID(), username, username.toLocaleLowerCase("ru"), passwordHash],
      );
      return mapAccount(result.rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("Аккаунт с таким логином уже существует");
      }
      throw error;
    }
  }

  async findAccountByUsername(username: string): Promise<AccountRecord | null> {
    const result = await this.pool.query<AccountRow>(
      "SELECT * FROM accounts WHERE username_key = $1",
      [username.toLocaleLowerCase("ru")],
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }

  async listCharacters(accountId: string): Promise<CharacterSummary[]> {
    const result = await this.pool.query<PersistedCharacterRow>(
      "SELECT * FROM characters WHERE account_id = $1 ORDER BY last_seen_at DESC",
      [accountId],
    );
    return result.rows.map(toSummary);
  }

  async createCharacter(input: NewCharacter): Promise<CharacterRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [input.accountId]);
      const count = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM characters WHERE account_id = $1",
        [input.accountId],
      );
      if (Number(count.rows[0]?.count ?? 0) >= 7) {
        throw new LimitError("Достигнут лимит в 7 персонажей");
      }

      const result = await client.query<PersistedCharacterRow>(
        `INSERT INTO characters(
           id, account_id, name, name_key, race, gender, class_id, hp, mp
         ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          randomUUID(),
          input.accountId,
          input.name,
          input.name.toLocaleLowerCase("ru"),
          input.race,
          input.gender ?? "male",
          input.classId,
          input.hp,
          input.mp,
        ],
      );
      const character = mapCharacter(result.rows[0]!);
      await client.query(
        `INSERT INTO quest_progress(
           character_id, quest_id, status, current_value, required_value
         ) VALUES($1, 'first_echoes', 'active', 0, 3)`,
        [character.id],
      );
      for (const grant of getStarterItemGrants(character.classId)) {
        const instanceId = randomUUID();
        await client.query(
          `INSERT INTO item_instances(
             id, character_id, item_id, quantity, stackable, bound
           ) VALUES($1, $2, $3, $4, $5, FALSE)`,
          [instanceId, character.id, grant.itemId, grant.quantity, isStackable(grant.itemId)],
        );
        if (grant.autoEquipSlot) {
          await client.query(
            `INSERT INTO character_equipment(character_id, slot, item_instance_id)
             VALUES($1, $2, $3)`,
            [character.id, grant.autoEquipSlot, instanceId],
          );
        }
        await this.insertLedger(client, {
          characterId: character.id,
          eventType: "starter_grant",
          goldDelta: 0,
          balanceAfter: 0,
          itemInstanceId: instanceId,
          itemId: grant.itemId,
          quantityDelta: grant.quantity,
          enhancementLevel: 0,
          metadata: { autoEquipSlot: grant.autoEquipSlot },
        });
      }
      await client.query("COMMIT");
      return character;
    } catch (error) {
      await this.safeRollback(client);
      if (isUniqueViolation(error)) throw new ConflictError("Это имя уже занято");
      throw error;
    } finally {
      client.release();
    }
  }

  private async safeRollback(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original transaction error.
    }
  }

  async getCharacterForAccount(
    characterId: string,
    accountId: string,
  ): Promise<CharacterRecord | null> {
    const result = await this.pool.query<PersistedCharacterRow>(
      "SELECT * FROM characters WHERE id = $1 AND account_id = $2",
      [characterId, accountId],
    );
    return result.rows[0] ? mapCharacter(result.rows[0]) : null;
  }

  async saveCharacterState(state: SavedCharacterState): Promise<{ gold: number }> {
    if (!Number.isSafeInteger(state.goldDelta)) {
      throw new InvalidOperationError("Некорректное изменение баланса персонажа");
    }
    if (state.goldDelta !== 0 && (!state.operationId || state.operationId.length > 128)) {
      throw new InvalidOperationError("Для изменения золота требуется корректный operationId");
    }
    if (state.goldDelta !== 0) await this.deleteExpiredEconomyOperations();
    return this.transaction(async (client) => {
      await this.lockCharacter(client, state.id);
      let appliedGoldDelta = state.goldDelta;
      if (state.goldDelta !== 0) {
        const inserted = await client.query(
          `INSERT INTO world_state_operations(operation_id, character_id, gold_delta)
           VALUES($1, $2, $3)
           ON CONFLICT(operation_id) DO NOTHING
           RETURNING operation_id`,
          [state.operationId, state.id, state.goldDelta],
        );
        if (inserted.rowCount === 0) {
          const existing = await client.query<{ character_id: string; gold_delta: number }>(
            `SELECT character_id, gold_delta
             FROM world_state_operations
             WHERE operation_id = $1`,
            [state.operationId],
          );
          const operation = existing.rows[0];
          if (
            !operation ||
            operation.character_id !== state.id ||
            operation.gold_delta !== state.goldDelta
          ) {
            throw new IdempotencyConflictError(
              "operationId сохранения уже использован с другим персонажем или изменением золота",
            );
          }
          appliedGoldDelta = 0;
        }
      }
      const updated = await client.query<{ gold: number }>(
        `UPDATE characters SET
           position_x = $2, position_y = $3, position_z = $4,
           hp = $5, mp = $6, xp = $7, level = $8, gold = gold + $9,
           last_seen_at = NOW()
         WHERE id = $1 AND gold + $9 >= 0
         RETURNING gold`,
        [
          state.id,
          state.position.x,
          state.position.y,
          state.position.z,
          state.hp,
          state.mp,
          state.xp,
          state.level,
          appliedGoldDelta,
        ],
      );
      const gold = updated.rows[0]?.gold;
      if (gold === undefined) {
        throw new InvalidOperationError("Персонаж не найден или изменение баланса недопустимо");
      }
      if (appliedGoldDelta !== 0) {
        await this.insertLedger(client, {
          characterId: state.id,
          eventType: "world_reward",
          goldDelta: appliedGoldDelta,
          balanceAfter: gold,
          itemInstanceId: null,
          itemId: null,
          quantityDelta: 0,
          enhancementLevel: null,
          metadata: { operationId: state.operationId },
        });
      }
      return { gold };
    });
  }

  async getInventoryState(characterId: string): Promise<InventoryState> {
    return this.readTransaction((client) => this.inventoryState(client, characterId));
  }

  async getInventory(characterId: string): Promise<InventoryStack[]> {
    return inventoryStacks((await this.getInventoryState(characterId)).inventory.items);
  }

  async addInventoryItem(
    characterId: string,
    itemId: ItemId,
    quantity: number,
    metadata: Record<string, unknown> = {},
    lootClaimId?: string,
  ): Promise<InventoryStack[]> {
    if (lootClaimId) await this.deleteExpiredEconomyOperations();
    const state = await this.transaction(async (client) => {
      const character = await this.lockCharacter(client, characterId);
      if (!Number.isInteger(quantity) || quantity === 0) {
        throw new InvalidOperationError("Количество предметов должно быть целым и ненулевым");
      }
      if (lootClaimId) {
        if (lootClaimId.length > 128 || quantity < 1) {
          throw new InvalidOperationError("Некорректный идентификатор или количество добычи");
        }
        const insertedClaim = await client.query(
          `INSERT INTO loot_claims(loot_claim_id, character_id, item_id, quantity)
           VALUES($1, $2, $3, $4)
           ON CONFLICT(loot_claim_id) DO NOTHING
           RETURNING loot_claim_id`,
          [lootClaimId, characterId, itemId, quantity],
        );
        if (insertedClaim.rowCount === 0) {
          const existing = await client.query<{
            character_id: string;
            item_id: ItemId;
            quantity: number;
          }>(
            `SELECT character_id, item_id, quantity
             FROM loot_claims
             WHERE loot_claim_id = $1`,
            [lootClaimId],
          );
          const claim = existing.rows[0];
          if (
            !claim ||
            claim.character_id !== characterId ||
            claim.item_id !== itemId ||
            claim.quantity !== quantity
          ) {
            throw new IdempotencyConflictError("Эта добыча уже была получена");
          }
          return this.inventoryState(client, characterId);
        }
      }
      if (quantity < 0) {
        await this.removeItemQuantity(client, characterId, itemId, Math.abs(quantity));
        return this.inventoryState(client, characterId);
      }

      const count = await this.inventorySlotCount(client, characterId);
      let ledgerInstanceId: string | null = null;
      if (isStackable(itemId)) {
        if (quantity > getItem(itemId).stackLimit) {
          throw new InventoryFullError("Количество превышает максимальный размер стека");
        }
        const existing = await client.query<ItemInstanceRow>(
          `SELECT i.*, e.slot AS equipped_slot
           FROM item_instances i
           LEFT JOIN character_equipment e ON e.item_instance_id = i.id
           WHERE i.character_id = $1 AND i.item_id = $2 AND i.stackable = TRUE
           FOR UPDATE OF i`,
          [characterId, itemId],
        );
        const row = existing.rows[0];
        if (row) {
          if (row.quantity + quantity > getItem(itemId).stackLimit) {
            throw new InventoryFullError("Стек предмета достиг максимального размера");
          }
          await client.query(
            "UPDATE item_instances SET quantity = quantity + $2, updated_at = NOW() WHERE id = $1",
            [row.id, quantity],
          );
          ledgerInstanceId = row.id;
        } else {
          if (count >= INVENTORY_CAPACITY) throw new InventoryFullError("В инвентаре недостаточно места");
          const id = randomUUID();
          await client.query(
            `INSERT INTO item_instances(id, character_id, item_id, quantity, stackable)
             VALUES($1, $2, $3, $4, TRUE)`,
            [id, characterId, itemId, quantity],
          );
          ledgerInstanceId = id;
        }
      } else {
        if (count + quantity > INVENTORY_CAPACITY) {
          throw new InventoryFullError("В инвентаре недостаточно места");
        }
        for (let index = 0; index < quantity; index += 1) {
          const id = randomUUID();
          await client.query(
            `INSERT INTO item_instances(id, character_id, item_id, quantity, stackable)
             VALUES($1, $2, $3, 1, FALSE)`,
            [id, characterId, itemId],
          );
          ledgerInstanceId ??= id;
        }
      }
      await this.insertLedger(client, {
        characterId,
        eventType: "loot_acquired",
        goldDelta: 0,
        balanceAfter: character.gold,
        itemInstanceId: ledgerInstanceId,
        itemId,
        quantityDelta: quantity,
        enhancementLevel: 0,
        metadata: lootClaimId ? { ...metadata, lootClaimId } : metadata,
      });
      return this.inventoryState(client, characterId);
    });
    return inventoryStacks(state.inventory.items);
  }

  async equipItem(
    characterId: string,
    instanceId: string,
    preferredSlot?: EquipmentSlot,
  ): Promise<InventoryState> {
    return this.transaction(async (client) => {
      const character = await this.lockCharacter(client, characterId);
      const row = await this.lockItem(client, characterId, instanceId);
      const definition = getItem(row.item_id);
      if (!isEquippableItem(definition)) {
        throw new InvalidOperationError("Этот предмет нельзя экипировать");
      }
      if (
        !canEquipItem(
          definition,
          { level: character.level, classId: character.class_id },
          preferredSlot,
        )
      ) {
        throw new InvalidOperationError(
          character.level < definition.requirements.level
            ? `Для предмета требуется ${definition.requirements.level} уровень`
            : "Предмет недоступен этому классу или слоту",
        );
      }
      const slot = equipmentSlotFor(definition, preferredSlot);
      const occupiedSlots = new Set(getOccupiedEquipmentSlots(definition, slot));
      const equippedRows = await client.query<ItemInstanceRow>(
        `SELECT i.*, e.slot AS equipped_slot
         FROM character_equipment e
         JOIN item_instances i ON i.id = e.item_instance_id
         WHERE e.character_id = $1
         FOR UPDATE OF i`,
        [characterId],
      );
      const conflictingIds = equippedRows.rows
        .filter((equipped) => {
          if (!equipped.equipped_slot || equipped.id === instanceId) return false;
          return getOccupiedEquipmentSlots(getItem(equipped.item_id), equipped.equipped_slot).some(
            (occupied) => occupiedSlots.has(occupied),
          );
        })
        .map((equipped) => equipped.id);
      await client.query(
        `DELETE FROM character_equipment
         WHERE character_id = $1
           AND (slot = $2 OR item_instance_id = $3 OR item_instance_id = ANY($4::uuid[]))`,
        [characterId, slot, instanceId, conflictingIds],
      );
      await client.query(
        `INSERT INTO character_equipment(character_id, slot, item_instance_id)
         VALUES($1, $2, $3)`,
        [characterId, slot, instanceId],
      );
      return this.inventoryState(client, characterId);
    });
  }

  async unequipItem(characterId: string, slot: EquipmentSlot): Promise<InventoryState> {
    return this.transaction(async (client) => {
      await this.lockCharacter(client, characterId);
      const removed = await client.query(
        "DELETE FROM character_equipment WHERE character_id = $1 AND slot = $2 RETURNING item_instance_id",
        [characterId, slot],
      );
      if (removed.rowCount === 0) {
        throw new NotFoundError("В этом слоте нет экипированного предмета");
      }
      return this.inventoryState(client, characterId);
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
    await this.deleteExpiredIdempotencyRecords();
    return this.transaction(async (client) => {
      const character = await this.lockCharacter(client, characterId);
      const replay = await this.idempotencyReplay<UseItemResult>(
        client,
        characterId,
        idempotencyKey,
        "use_item",
        fingerprint,
        character.class_id,
        character.level,
      );
      if (replay) return { result: replay, replayed: true };
      const row = await this.lockItem(client, characterId, instanceId);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > row.quantity) {
        throw new InvalidOperationError("Некорректное количество предметов");
      }
      const effect = consumableEffect(row.item_id);
      if (!effect) throw new InvalidOperationError("Этот предмет нельзя использовать");
      const definition = getItem(row.item_id);
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
      const cooldown = await client.query<{ retry_after_ms: number }>(
        `SELECT GREATEST(
           0,
           CEIL(EXTRACT(EPOCH FROM (ready_at - clock_timestamp())) * 1000)
         )::integer AS retry_after_ms
         FROM consumable_cooldowns
         WHERE character_id = $1 AND item_id = $2
         FOR UPDATE`,
        [characterId, row.item_id],
      );
      const retryAfterMs = cooldown.rows[0]?.retry_after_ms ?? 0;
      if (retryAfterMs > 0) {
        throw new CooldownError("Предмет ещё восстанавливается", retryAfterMs);
      }

      const before = await this.inventoryState(client, characterId);
      const classDefinition = getClass(character.class_id);
      const maxHp = classDefinition.baseHp + (character.level - 1) * 14 + before.equipmentStats.maxHp;
      const maxMp = classDefinition.baseMp + (character.level - 1) * 9 + before.equipmentStats.maxMp;
      const hp =
        effect.kind === "restore" && effect.resource === "hp"
          ? Math.min(maxHp, character.hp + effect.amount * quantity)
          : character.hp;
      const mp =
        effect.kind === "restore" && effect.resource === "mp"
          ? Math.min(maxMp, character.mp + effect.amount * quantity)
          : character.mp;
      await client.query(
        `UPDATE characters SET
           hp = $2,
           mp = $3
         WHERE id = $1`,
        [characterId, hp, mp],
      );
      if (row.quantity === quantity) {
        await client.query("DELETE FROM item_instances WHERE id = $1", [row.id]);
      } else {
        await client.query(
          "UPDATE item_instances SET quantity = quantity - $2, updated_at = NOW() WHERE id = $1",
          [row.id, quantity],
        );
      }
      await this.insertLedger(client, {
        characterId,
        eventType: "item_consumed",
        goldDelta: 0,
        balanceAfter: character.gold,
        itemInstanceId: row.quantity === quantity ? null : row.id,
        itemId: row.item_id,
        quantityDelta: -quantity,
        enhancementLevel: row.enhance_level,
        metadata: {},
      });
      const cooldownResult = await client.query<{ ready_at: Date; used_at: Date }>(
        `INSERT INTO consumable_cooldowns(character_id, item_id, ready_at)
         VALUES($1, $2, clock_timestamp() + ($3 * INTERVAL '1 millisecond'))
         ON CONFLICT(character_id, item_id) DO UPDATE SET ready_at = EXCLUDED.ready_at
         RETURNING ready_at, clock_timestamp() AS used_at`,
        [characterId, row.item_id, definition.cooldownMs],
      );
      const cooldownReadyAt = cooldownResult.rows[0]!.ready_at.getTime();
      const operationResult: UseItemResult = {
        ...(await this.inventoryState(client, characterId)),
        instanceId,
        sourceItemId: row.item_id,
        characterClassId: character.class_id,
        characterLevel: character.level,
        quantityUsed: quantity,
        restoredHp: hp - character.hp,
        restoredMp: mp - character.mp,
        hp,
        mp,
        effect,
        cooldownReadyAt,
        effectExpiresAt:
          effect.kind === "buff"
            ? cooldownResult.rows[0]!.used_at.getTime() + effect.durationMs
            : null,
      };
      await this.rememberIdempotency(
        client,
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
    await this.deleteExpiredIdempotencyRecords();
    return this.transaction(async (client) => {
      const character = await this.lockCharacter(client, characterId);
      const replay = await this.idempotencyReplay<EnhanceItemResult>(
        client,
        characterId,
        idempotencyKey,
        "enhance_item",
        fingerprint,
        character.class_id,
        character.level,
      );
      if (replay) return { result: replay, replayed: true };
      const row = await this.lockItem(client, characterId, instanceId);
      if (!isEquippableItem(getItem(row.item_id))) {
        throw new InvalidOperationError("Улучшать можно только экипировку");
      }
      const roll = this.nextEnhancementRoll();
      const result = resolveEnhancementAttempt(row.item_id, row.enhance_level, roll);
      if (!result.eligible) {
        throw new LimitError("Достигнут максимальный уровень улучшения");
      }
      const cost = getEnhancementCost(row.item_id, row.enhance_level);
      if (character.gold < cost.gold) {
        throw new InsufficientFundsError(`Для улучшения требуется ${cost.gold} марок`);
      }
      try {
        await this.removeItemQuantity(
          client,
          characterId,
          cost.catalystItemId,
          cost.catalystQuantity,
        );
      } catch (error) {
        if (error instanceof InvalidOperationError) {
          throw new InvalidOperationError(
            `Для улучшения требуется: ${getItem(cost.catalystItemId).name} ×${cost.catalystQuantity}`,
          );
        }
        throw error;
      }
      await client.query("UPDATE characters SET gold = gold - $2 WHERE id = $1", [
        characterId,
        cost.gold,
      ]);
      await client.query(
        "UPDATE item_instances SET enhance_level = $2, updated_at = NOW() WHERE id = $1",
        [instanceId, result.newLevel],
      );
      await this.insertLedger(client, {
        characterId,
        eventType: "item_enhanced",
        goldDelta: -cost.gold,
        balanceAfter: character.gold - cost.gold,
        itemInstanceId: instanceId,
        itemId: row.item_id,
        quantityDelta: 0,
        enhancementLevel: result.newLevel,
        metadata: {
          success: result.success,
          previousLevel: result.previousLevel,
          catalystItemId: cost.catalystItemId,
          catalystQuantity: cost.catalystQuantity,
          downgraded: result.downgraded,
          roll,
          chanceBps: result.chanceBps,
        },
      });
      const operationResult: EnhanceItemResult = {
        ...(await this.inventoryState(client, characterId)),
        instanceId,
        characterClassId: character.class_id,
        characterLevel: character.level,
        success: result.success,
        cost,
        previousLevel: result.previousLevel,
        enhancementLevel: result.newLevel,
        chanceBps: result.chanceBps,
        downgraded: result.downgraded,
      };
      await this.rememberIdempotency(
        client,
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
    const result = await this.pool.query<EconomyLedgerRow>(
      `SELECT * FROM economy_ledger
       WHERE character_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [characterId, Math.max(1, Math.min(200, limit))],
    );
    return result.rows.map(mapLedger);
  }

  async getQuest(characterId: string): Promise<QuestProgress> {
    const result = await this.pool.query<{
      status: "active" | "completed";
      current_value: number;
      required_value: number;
    }>(
      `SELECT status, current_value, required_value
       FROM quest_progress WHERE character_id = $1 AND quest_id = 'first_echoes'`,
      [characterId],
    );
    const row = result.rows[0];
    return {
      questId: "first_echoes",
      status: row?.status ?? "active",
      current: row?.current_value ?? 0,
      required: row?.required_value ?? 3,
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
    return this.transaction(async (client) => {
      const character = await this.lockCharacter(client, characterId);
      await client.query(
        `INSERT INTO quest_progress(
           character_id, quest_id, status, current_value, required_value
         ) VALUES($1, $2, 'active', 0, 3)
         ON CONFLICT(character_id, quest_id) DO NOTHING`,
        [characterId, questId],
      );
      const questResult = await client.query<{
        status: "active" | "completed";
        current_value: number;
        required_value: number;
      }>(
        `SELECT status, current_value, required_value
         FROM quest_progress
         WHERE character_id = $1 AND quest_id = $2
         FOR UPDATE`,
        [characterId, questId],
      );
      const quest = questResult.rows[0];
      if (!quest) throw new NotFoundError("Задание не найдено");
      if (quest.status === "completed") {
        return {
          progress: {
            questId,
            status: "completed",
            current: quest.current_value,
            required: quest.required_value,
          },
          rewarded: false,
          rewardGold: 0,
          gold: character.gold,
        };
      }

      const current = Math.min(quest.required_value, quest.current_value + amount);
      const rewarded = current >= quest.required_value;
      await client.query(
        `UPDATE quest_progress SET
           status = $3,
           current_value = $4,
           updated_at = clock_timestamp()
         WHERE character_id = $1 AND quest_id = $2`,
        [characterId, questId, rewarded ? "completed" : "active", current],
      );
      let gold = character.gold;
      if (rewarded) {
        const goldResult = await client.query<{ gold: number }>(
          "UPDATE characters SET gold = gold + 25 WHERE id = $1 RETURNING gold",
          [characterId],
        );
        gold = goldResult.rows[0]!.gold;
        await this.insertLedger(client, {
          characterId,
          eventType: "quest_reward",
          goldDelta: 25,
          balanceAfter: gold,
          itemInstanceId: null,
          itemId: null,
          quantityDelta: 0,
          enhancementLevel: null,
          metadata: { questId },
        });
      }
      return {
        progress: {
          questId,
          status: rewarded ? "completed" : "active",
          current,
          required: quest.required_value,
        },
        rewarded,
        rewardGold: rewarded ? 25 : 0,
        gold,
      };
    });
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await this.safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private async readTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await this.safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private async idempotencyReplay<T extends UseItemResult | EnhanceItemResult>(
    client: PoolClient,
    characterId: string,
    idempotencyKey: string,
    action: IdempotencyRecordRow["action"],
    fingerprint: string,
    characterClassId: ClassId,
    characterLevel: number,
  ): Promise<T | null> {
    await client.query(
      `DELETE FROM idempotency_records
       WHERE character_id = $1 AND idempotency_key = $2 AND expires_at <= clock_timestamp()`,
      [characterId, idempotencyKey],
    );
    const stored = await client.query<IdempotencyRecordRow>(
      `SELECT action, request_fingerprint, response
       FROM idempotency_records
       WHERE character_id = $1 AND idempotency_key = $2`,
      [characterId, idempotencyKey],
    );
    const record = stored.rows[0];
    if (!record) return null;
    assertIdempotencyScope(
      record.action,
      record.request_fingerprint,
      action,
      fingerprint,
    );
    const state = await this.inventoryState(client, characterId);
    const hydrated =
      action === "use_item"
        ? hydrateUseItemResult(
            structuredClone(record.response) as StoredUseItemOutcome,
            state,
          )
        : hydrateEnhanceItemResult(
            structuredClone(record.response) as StoredEnhanceItemOutcome,
            state,
          );
    hydrated.characterClassId = characterClassId;
    hydrated.characterLevel = characterLevel;
    return hydrated as T;
  }

  private async deleteExpiredIdempotencyRecords(): Promise<void> {
    await this.pool.query(
      `WITH expired AS (
         SELECT ctid FROM idempotency_records
         WHERE expires_at <= clock_timestamp()
         ORDER BY expires_at
         LIMIT 100
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM idempotency_records records
       USING expired
       WHERE records.ctid = expired.ctid`,
    );
  }

  private async deleteExpiredEconomyOperations(): Promise<void> {
    await this.pool.query(
      `WITH expired AS (
         SELECT ctid FROM loot_claims
         WHERE expires_at <= clock_timestamp()
         ORDER BY expires_at
         LIMIT 100
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM loot_claims claims
       USING expired
       WHERE claims.ctid = expired.ctid`,
    );
    await this.pool.query(
      `WITH expired AS (
         SELECT ctid FROM world_state_operations
         WHERE expires_at <= clock_timestamp()
         ORDER BY expires_at
         LIMIT 100
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM world_state_operations operations
       USING expired
       WHERE operations.ctid = expired.ctid`,
    );
  }

  private async rememberIdempotency(
    client: PoolClient,
    characterId: string,
    idempotencyKey: string,
    action: IdempotencyRecordRow["action"],
    fingerprint: string,
    result: UseItemResult | EnhanceItemResult,
  ): Promise<void> {
    await client.query(
      `INSERT INTO idempotency_records(
         character_id, idempotency_key, action, request_fingerprint, response
       ) VALUES($1, $2, $3, $4, $5::jsonb)`,
      [
        characterId,
        idempotencyKey,
        action,
        fingerprint,
        JSON.stringify(
          action === "use_item"
            ? compactUseItemResult(result as UseItemResult)
            : compactEnhanceItemResult(result as EnhanceItemResult),
        ),
      ],
    );
  }

  private nextEnhancementRoll(): number {
    const roll = this.enhancementRoll();
    if (!Number.isInteger(roll) || roll < 0 || roll >= 10_000) {
      throw new Error("Enhancement RNG must return an integer from 0 through 9999");
    }
    return roll;
  }

  private async lockCharacter(client: PoolClient, characterId: string): Promise<CharacterRow> {
    const result = await client.query<PersistedCharacterRow>(
      "SELECT * FROM characters WHERE id = $1 FOR UPDATE",
      [characterId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError("Персонаж не найден");
    return normalizeCharacterRow(row);
  }

  private async lockItem(
    client: PoolClient,
    characterId: string,
    instanceId: string,
  ): Promise<ItemInstanceRow> {
    const result = await client.query<ItemInstanceRow>(
      `SELECT i.*, e.slot AS equipped_slot
       FROM item_instances i
       LEFT JOIN character_equipment e ON e.item_instance_id = i.id
       WHERE i.character_id = $1 AND i.id = $2
       FOR UPDATE OF i`,
      [characterId, instanceId],
    );
    if (!result.rows[0]) throw new NotFoundError("Предмет не найден в инвентаре персонажа");
    return result.rows[0];
  }

  private async inventoryState(
    queryable: Pool | PoolClient,
    characterId: string,
  ): Promise<InventoryState> {
    const [characterResult, itemResult] = await Promise.all([
      queryable.query<{ gold: number }>("SELECT gold FROM characters WHERE id = $1", [characterId]),
      queryable.query<ItemInstanceRow>(
        `SELECT i.*, e.slot AS equipped_slot
         FROM item_instances i
         LEFT JOIN character_equipment e ON e.item_instance_id = i.id
         WHERE i.character_id = $1
         ORDER BY i.created_at, i.id`,
        [characterId],
      ),
    ]);
    const character = characterResult.rows[0];
    if (!character) throw new NotFoundError("Персонаж не найден");
    const items = itemResult.rows.map(mapItem);
    const equipment: EquipmentLoadout = {};
    for (const item of items) {
      if (item.equippedSlot) equipment[item.equippedSlot] = { ...item };
    }
    const inventory: InventoryView = {
      items,
      equipment,
      gold: character.gold,
      capacity: INVENTORY_CAPACITY,
      usedSlots: items.length,
    };
    return { inventory, equipmentStats: equipmentStats(equipment) };
  }

  private async inventorySlotCount(client: PoolClient, characterId: string): Promise<number> {
    const result = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM item_instances WHERE character_id = $1",
      [characterId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async removeItemQuantity(
    client: PoolClient,
    characterId: string,
    itemId: ItemId,
    quantity: number,
  ): Promise<void> {
    const result = await client.query<ItemInstanceRow>(
      `SELECT i.*, e.slot AS equipped_slot
       FROM item_instances i
       LEFT JOIN character_equipment e ON e.item_instance_id = i.id
       WHERE i.character_id = $1 AND i.item_id = $2
       ORDER BY i.created_at DESC
       FOR UPDATE OF i`,
      [characterId, itemId],
    );
    const available = result.rows.reduce((sum, row) => sum + row.quantity, 0);
    if (available < quantity) throw new InvalidOperationError("Недостаточно предметов");
    let remaining = quantity;
    for (const row of result.rows) {
      const removed = Math.min(row.quantity, remaining);
      if (removed === row.quantity) {
        await client.query("DELETE FROM item_instances WHERE id = $1", [row.id]);
      } else {
        await client.query(
          "UPDATE item_instances SET quantity = quantity - $2, updated_at = NOW() WHERE id = $1",
          [row.id, removed],
        );
      }
      remaining -= removed;
      if (remaining === 0) break;
    }
  }

  private async insertLedger(
    client: PoolClient,
    entry: Omit<EconomyLedgerEntry, "id" | "createdAt">,
  ): Promise<void> {
    await client.query(
      `INSERT INTO economy_ledger(
         id, character_id, event_type, gold_delta, balance_after,
         item_instance_id, item_id, quantity_delta, enhance_level, metadata
       ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        randomUUID(),
        entry.characterId,
        entry.eventType,
        entry.goldDelta,
        entry.balanceAfter,
        entry.itemInstanceId,
        entry.itemId,
        entry.quantityDelta,
        entry.enhancementLevel,
        JSON.stringify(entry.metadata),
      ],
    );
  }
}
