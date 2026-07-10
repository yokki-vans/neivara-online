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
  {
    version: 2,
    name: "item_instances_equipment_economy",
    sql: `
      CREATE TABLE IF NOT EXISTS item_instances (
        id UUID PRIMARY KEY,
        character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        item_id VARCHAR(64) NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
        stackable BOOLEAN NOT NULL DEFAULT FALSE,
        enhance_level INTEGER NOT NULL DEFAULT 0 CHECK (enhance_level BETWEEN 0 AND 20),
        bound BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (character_id, id)
      );

      CREATE INDEX IF NOT EXISTS item_instances_character_id_idx
        ON item_instances(character_id);
      CREATE UNIQUE INDEX IF NOT EXISTS item_instances_stack_idx
        ON item_instances(character_id, item_id)
        WHERE stackable = TRUE;

      CREATE TABLE IF NOT EXISTS character_equipment (
        character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        slot VARCHAR(32) NOT NULL,
        item_instance_id UUID NOT NULL,
        equipped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (character_id, slot),
        UNIQUE (item_instance_id),
        FOREIGN KEY (character_id, item_instance_id)
          REFERENCES item_instances(character_id, id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS character_equipment_character_id_idx
        ON character_equipment(character_id);

      CREATE TABLE IF NOT EXISTS economy_ledger (
        id UUID PRIMARY KEY,
        character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        event_type VARCHAR(48) NOT NULL,
        gold_delta INTEGER NOT NULL DEFAULT 0,
        balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
        item_instance_id UUID NULL REFERENCES item_instances(id) ON DELETE SET NULL,
        item_id VARCHAR(64) NULL,
        quantity_delta INTEGER NOT NULL DEFAULT 0,
        enhance_level INTEGER NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        idempotency_key VARCHAR(128) NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS economy_ledger_character_id_created_at_idx
        ON economy_ledger(character_id, created_at DESC);

      INSERT INTO item_instances(id, character_id, item_id, quantity, stackable)
      SELECT gen_random_uuid(), character_id, item_id, quantity, TRUE
      FROM inventory_stacks
      WHERE quantity > 0
      ON CONFLICT (character_id, item_id) WHERE stackable = TRUE
      DO UPDATE SET
        quantity = EXCLUDED.quantity,
        updated_at = NOW();
    `,
  },
  {
    version: 3,
    name: "backfill_starter_loadouts",
    sql: `
      WITH missing_equipment AS (
        SELECT
          gen_random_uuid() AS id,
          c.id AS character_id,
          starter.item_id,
          starter.slot
        FROM characters c
        CROSS JOIN LATERAL (
          VALUES
            (CASE c.class_id
              WHEN 'warbound' THEN 'tideworn_sabre'
              WHEN 'pathfinder' THEN 'whisperbranch_bow'
              WHEN 'runesmith' THEN 'emberglyph_staff'
              WHEN 'lifewarden' THEN 'wellspring_scepter'
              ELSE 'duskneedle_dagger'
            END, 'main_hand'),
            ('reedwoven_hood', 'head'),
            ('reedwoven_coat', 'chest'),
            ('reedwoven_wraps', 'hands'),
            ('reedwoven_trousers', 'legs'),
            ('reedwoven_boots', 'feet')
        ) AS starter(item_id, slot)
        WHERE NOT EXISTS (
          SELECT 1 FROM item_instances existing
          WHERE existing.character_id = c.id
            AND existing.item_id = starter.item_id
        )
      ), inserted AS (
        INSERT INTO item_instances(
          id, character_id, item_id, quantity, stackable, enhance_level, bound
        )
        SELECT id, character_id, item_id, 1, FALSE, 0, FALSE
        FROM missing_equipment
        RETURNING id, character_id, item_id
      )
      INSERT INTO character_equipment(character_id, slot, item_instance_id)
      SELECT inserted.character_id, missing.slot, inserted.id
      FROM inserted
      JOIN missing_equipment missing ON missing.id = inserted.id
      ON CONFLICT (character_id, slot) DO NOTHING;

      INSERT INTO item_instances(
        id, character_id, item_id, quantity, stackable, enhance_level, bound
      )
      SELECT gen_random_uuid(), c.id, consumable.item_id, consumable.quantity, TRUE, 0, FALSE
      FROM characters c
      CROSS JOIN (
        VALUES ('field_tonic', 5), ('clarity_draught', 3)
      ) AS consumable(item_id, quantity)
      WHERE NOT EXISTS (
        SELECT 1 FROM item_instances existing
          WHERE existing.character_id = c.id
          AND existing.item_id = consumable.item_id
      )
      ON CONFLICT (character_id, item_id) WHERE stackable = TRUE DO NOTHING;

      INSERT INTO economy_ledger(
        id, character_id, event_type, gold_delta, balance_after,
        item_instance_id, item_id, quantity_delta, enhance_level, metadata
      )
      SELECT
        gen_random_uuid(),
        instance.character_id,
        'starter_grant',
        0,
        c.gold,
        instance.id,
        instance.item_id,
        instance.quantity,
        instance.enhance_level,
        '{"source":"starter_backfill_v3"}'::jsonb
      FROM item_instances instance
      JOIN characters c ON c.id = instance.character_id
      WHERE instance.item_id IN (
        'tideworn_sabre', 'whisperbranch_bow', 'emberglyph_staff',
        'wellspring_scepter', 'duskneedle_dagger', 'reedwoven_hood',
        'reedwoven_coat', 'reedwoven_wraps', 'reedwoven_trousers',
        'reedwoven_boots', 'field_tonic', 'clarity_draught'
      )
      AND NOT EXISTS (
        SELECT 1 FROM economy_ledger ledger
        WHERE ledger.character_id = instance.character_id
          AND ledger.item_instance_id = instance.id
          AND ledger.event_type = 'starter_grant'
      );
    `,
  },
  {
    version: 4,
    name: "authoritative_consumable_cooldowns",
    sql: `
      CREATE TABLE IF NOT EXISTS consumable_cooldowns (
        character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        item_id VARCHAR(64) NOT NULL,
        ready_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (character_id, item_id)
      );

      CREATE INDEX IF NOT EXISTS consumable_cooldowns_ready_at_idx
        ON consumable_cooldowns(ready_at);
    `,
  },
  {
    version: 5,
    name: "scoped_idempotency_records",
    sql: `
      CREATE TABLE IF NOT EXISTS idempotency_records (
        character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        idempotency_key VARCHAR(128) NOT NULL,
        action VARCHAR(32) NOT NULL,
        request_fingerprint VARCHAR(256) NOT NULL,
        response JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + INTERVAL '24 hours',
        PRIMARY KEY (character_id, idempotency_key),
        CHECK (action IN ('use_item', 'enhance_item'))
      );

      CREATE INDEX IF NOT EXISTS idempotency_records_expires_at_idx
        ON idempotency_records(expires_at);
    `,
  },
  {
    version: 6,
    name: "durable_loot_claims_world_gold_operations",
    sql: `
      CREATE TABLE IF NOT EXISTS loot_claims (
        loot_claim_id VARCHAR(128) PRIMARY KEY,
        character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        item_id VARCHAR(64) NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + INTERVAL '24 hours'
      );

      CREATE INDEX IF NOT EXISTS loot_claims_character_id_idx
        ON loot_claims(character_id);
      CREATE INDEX IF NOT EXISTS loot_claims_expires_at_idx
        ON loot_claims(expires_at);

      CREATE TABLE IF NOT EXISTS world_state_operations (
        operation_id VARCHAR(128) PRIMARY KEY,
        character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        gold_delta INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + INTERVAL '24 hours'
      );

      CREATE INDEX IF NOT EXISTS world_state_operations_character_id_idx
        ON world_state_operations(character_id);
      CREATE INDEX IF NOT EXISTS world_state_operations_expires_at_idx
        ON world_state_operations(expires_at);
    `,
  },
  {
    version: 7,
    name: "expand_character_identity_catalog",
    sql: `
      ALTER TABLE characters
        ADD COLUMN IF NOT EXISTS gender VARCHAR(16) NOT NULL DEFAULT 'male';

      DO $migration$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'characters_race_valid'
            AND conrelid = 'characters'::regclass
        ) THEN
          ALTER TABLE characters ADD CONSTRAINT characters_race_valid
            CHECK (race IN (
              'erim', 'vaeli', 'narai', 'kerran', 'dairi',
              'human', 'light_elf', 'dark_elf', 'dwarf', 'orc'
            ));
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'characters_gender_valid'
            AND conrelid = 'characters'::regclass
        ) THEN
          ALTER TABLE characters ADD CONSTRAINT characters_gender_valid
            CHECK (gender IN ('male', 'female'));
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'characters_class_id_valid'
            AND conrelid = 'characters'::regclass
        ) THEN
          ALTER TABLE characters ADD CONSTRAINT characters_class_id_valid
            CHECK (class_id IN (
              'warbound', 'pathfinder', 'runesmith', 'lifewarden', 'oathweaver',
              'warrior', 'mage'
            ));
        END IF;
      END
      $migration$;
    `,
  },
];
