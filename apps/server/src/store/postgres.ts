import { randomUUID } from "node:crypto";
import type {
  CharacterSummary,
  ClassId,
  InventoryStack,
  ItemId,
  QuestProgress,
  RaceId,
} from "@neivara/shared";
import { Pool, type PoolClient } from "pg";
import { MIGRATIONS } from "./migrations.js";
import {
  ConflictError,
  LimitError,
  type AccountRecord,
  type CharacterRecord,
  type GameStore,
  type NewCharacter,
  type SavedCharacterState,
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

function mapAccount(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    username: row.username,
    usernameKey: row.username_key,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

function mapCharacter(row: CharacterRow): CharacterRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    race: row.race,
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

function toSummary(row: CharacterRow): CharacterSummary {
  const record = mapCharacter(row);
  return {
    id: record.id,
    name: record.name,
    race: record.race,
    classId: record.classId,
    level: record.level,
    xp: record.xp,
    gold: record.gold,
    lastSeenAt: record.lastSeenAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export class PostgresGameStore implements GameStore {
  private readonly pool: Pool;

  constructor(
    connectionString: string,
    ssl: boolean,
    private readonly autoMigrate: boolean,
  ) {
    this.pool = new Pool({
      connectionString,
      ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }

  async initialize(): Promise<void> {
    await this.pool.query("SELECT 1");
    if (this.autoMigrate) await this.runMigrations();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async runMigrations(): Promise<void> {
    const client = await this.pool.connect();
    try {
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
      client.release();
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
    const result = await this.pool.query<CharacterRow>(
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

      const result = await client.query<CharacterRow>(
        `INSERT INTO characters(
           id, account_id, name, name_key, race, class_id, hp, mp
         ) VALUES($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          randomUUID(),
          input.accountId,
          input.name,
          input.name.toLocaleLowerCase("ru"),
          input.race,
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
    const result = await this.pool.query<CharacterRow>(
      "SELECT * FROM characters WHERE id = $1 AND account_id = $2",
      [characterId, accountId],
    );
    return result.rows[0] ? mapCharacter(result.rows[0]) : null;
  }

  async saveCharacterState(state: SavedCharacterState): Promise<void> {
    await this.pool.query(
      `UPDATE characters SET
         position_x = $2, position_y = $3, position_z = $4,
         hp = $5, mp = $6, xp = $7, level = $8, gold = $9,
         last_seen_at = NOW()
       WHERE id = $1`,
      [
        state.id,
        state.position.x,
        state.position.y,
        state.position.z,
        state.hp,
        state.mp,
        state.xp,
        state.level,
        state.gold,
      ],
    );
  }

  async getInventory(characterId: string): Promise<InventoryStack[]> {
    const result = await this.pool.query<{ item_id: ItemId; quantity: number }>(
      "SELECT item_id, quantity FROM inventory_stacks WHERE character_id = $1 AND quantity > 0",
      [characterId],
    );
    return result.rows.map((row) => ({ itemId: row.item_id, quantity: row.quantity }));
  }

  async addInventoryItem(
    characterId: string,
    itemId: ItemId,
    quantity: number,
  ): Promise<InventoryStack[]> {
    await this.pool.query(
      `INSERT INTO inventory_stacks(character_id, item_id, quantity)
       VALUES($1, $2, $3)
       ON CONFLICT(character_id, item_id)
       DO UPDATE SET quantity = GREATEST(0, inventory_stacks.quantity + EXCLUDED.quantity)`,
      [characterId, itemId, quantity],
    );
    return this.getInventory(characterId);
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

  async saveQuest(characterId: string, progress: QuestProgress): Promise<void> {
    await this.pool.query(
      `INSERT INTO quest_progress(
         character_id, quest_id, status, current_value, required_value, updated_at
       ) VALUES($1, $2, $3, $4, $5, NOW())
       ON CONFLICT(character_id, quest_id) DO UPDATE SET
         status = EXCLUDED.status,
         current_value = EXCLUDED.current_value,
         required_value = EXCLUDED.required_value,
         updated_at = NOW()`,
      [characterId, progress.questId, progress.status, progress.current, progress.required],
    );
  }
}
