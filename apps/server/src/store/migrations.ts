export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial_accounts_characters",
    sql: `
      CREATE TABLE IF NOT EXISTS accounts (
        id UUID PRIMARY KEY,
        username VARCHAR(24) NOT NULL,
        username_key VARCHAR(24) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS characters (
        id UUID PRIMARY KEY,
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name VARCHAR(20) NOT NULL,
        name_key VARCHAR(20) NOT NULL UNIQUE,
        race VARCHAR(24) NOT NULL,
        class_id VARCHAR(24) NOT NULL,
        level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 60),
        xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
        hp INTEGER NOT NULL,
        mp INTEGER NOT NULL,
        gold INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
        position_x DOUBLE PRECISION NOT NULL DEFAULT 0,
        position_y DOUBLE PRECISION NOT NULL DEFAULT 0,
        position_z DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS characters_account_id_idx ON characters(account_id);

      CREATE TABLE IF NOT EXISTS inventory_stacks (
        character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        item_id VARCHAR(64) NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        PRIMARY KEY (character_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS quest_progress (
        character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        quest_id VARCHAR(64) NOT NULL,
        status VARCHAR(24) NOT NULL,
        current_value INTEGER NOT NULL DEFAULT 0,
        required_value INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (character_id, quest_id)
      );
    `,
  },
];
