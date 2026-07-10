import { randomUUID } from "node:crypto";
import {
  getClass,
  getEnhancementCost,
  getStarterItemGrants,
} from "@neivara/shared";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS } from "./store/migrations.js";
import { PostgresGameStore } from "./store/postgres.js";

const configuredDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseUrl = configuredDatabaseUrl ?? "postgresql://integration-test.invalid/neivara";
const integrationDescribe = configuredDatabaseUrl ? describe : describe.skip;
const schemaName = `neivara_integration_${randomUUID().replaceAll("-", "")}`;
const quotedSchemaName = `"${schemaName}"`;

function connectionStringForSchema(connectionString: string): string {
  return connectionStringForNamedSchema(connectionString, schemaName);
}

function connectionStringForNamedSchema(connectionString: string, targetSchema: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${targetSchema},public`);
  return url.toString();
}

integrationDescribe("PostgreSQL equipment and economy integration", () => {
  const adminPool = new Pool({ connectionString: databaseUrl });
  const store = new PostgresGameStore(
    connectionStringForSchema(databaseUrl),
    false,
    true,
    () => 0,
  );
  const concurrentMigrator = new PostgresGameStore(
    connectionStringForSchema(databaseUrl),
    false,
    true,
    () => 0,
  );

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${quotedSchemaName}`);
    await Promise.all([store.initialize(), concurrentMigrator.initialize()]);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([store.close(), concurrentMigrator.close()]);
    try {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`);
    } finally {
      await adminPool.end();
    }
  }, 30_000);

  it("migrates a fresh schema and persists serialized inventory operations", async () => {
    const appliedMigrations = await adminPool.query<{ version: number; name: string }>(
      `SELECT version, name FROM ${quotedSchemaName}.schema_migrations ORDER BY version`,
    );
    expect(appliedMigrations.rows).toEqual(
      MIGRATIONS.map(({ version, name }) => ({ version, name })),
    );
    await expect(store.checkReadiness()).resolves.toBe(true);

    const account = await store.createAccount("PostgresGate", "integration-password-hash");
    const classDefinition = getClass("warrior");
    const character = await store.createCharacter({
      accountId: account.id,
      name: "СтражГрани",
      race: "human",
      classId: "warrior",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });

    const starterGrants = getStarterItemGrants(character.classId);
    const starterState = await store.getInventoryState(character.id);
    expect(starterState.inventory.items).toHaveLength(starterGrants.length);
    expect(starterState.inventory.items.map(({ itemId }) => itemId)).toEqual(
      expect.arrayContaining(starterGrants.map(({ itemId }) => itemId)),
    );
    expect(Object.keys(starterState.inventory.equipment)).toEqual(
      expect.arrayContaining(["main_hand", "head", "chest", "hands", "legs", "feet"]),
    );
    expect(starterState.equipmentStats.physicalAttack).toBeGreaterThan(0);
    expect(starterState.equipmentStats.armor).toBeGreaterThan(0);

    const starterWeapon = starterState.inventory.equipment.main_hand!;
    const unequipped = await store.unequipItem(character.id, "main_hand");
    expect(unequipped.inventory.equipment.main_hand).toBeUndefined();
    const reequipped = await store.equipItem(character.id, starterWeapon.instanceId);
    expect(reequipped.inventory.equipment.main_hand?.instanceId).toBe(
      starterWeapon.instanceId,
    );

    await store.saveCharacterState({
      id: character.id,
      operationId: null,
      position: character.position,
      hp: 20,
      mp: character.mp,
      xp: character.xp,
      level: character.level,
      goldDelta: 0,
    });
    const tonic = reequipped.inventory.items.find(({ itemId }) => itemId === "field_tonic")!;
    const firstUse = await store.useItem(
      character.id,
      tonic.instanceId,
      "postgres-use-idempotency-0001",
    );
    const used = firstUse.result;
    expect(used.restoredHp).toBe(70);
    expect(
      used.inventory.items.find(({ instanceId }) => instanceId === tonic.instanceId)?.quantity,
    ).toBe(4);
    const replayedUse = await store.useItem(
      character.id,
      tonic.instanceId,
      "postgres-use-idempotency-0001",
    );
    expect(replayedUse.replayed).toBe(true);
    expect(replayedUse.result.quantityUsed).toBe(used.quantityUsed);
    expect(replayedUse.result.inventory.items.find(
      ({ instanceId }) => instanceId === tonic.instanceId,
    )?.quantity).toBe(4);
    await expect(
      store.useItem(character.id, tonic.instanceId, "postgres-use-cooldown-0002"),
    ).rejects.toMatchObject({
      name: "CooldownError",
      retryAfterMs: expect.any(Number),
    });
    await store.addInventoryItem(
      character.id,
      "mire_shard",
      1,
      { sourceMonsterId: "postgres-monster-1" },
      "postgres-loot-claim-0001",
    );
    const replayedLoot = await store.addInventoryItem(
      character.id,
      "mire_shard",
      1,
      { sourceMonsterId: "postgres-monster-1" },
      "postgres-loot-claim-0001",
    );
    expect(replayedLoot.find(({ itemId }) => itemId === "mire_shard")?.quantity).toBe(1);
    await expect(
      store.addInventoryItem(
        character.id,
        "resonant_dust",
        1,
        {},
        "postgres-loot-claim-0001",
      ),
    ).rejects.toMatchObject({ name: "IdempotencyConflictError" });

    const enhancementCost = getEnhancementCost(
      starterWeapon.itemId,
      starterWeapon.enhancementLevel,
    );
    await store.addInventoryItem(
      character.id,
      enhancementCost.catalystItemId,
      enhancementCost.catalystQuantity,
    );
    await store.saveCharacterState({
      id: character.id,
      operationId: "postgres-enhance-funding-0001",
      position: character.position,
      hp: used.hp,
      mp: used.mp,
      xp: character.xp,
      level: character.level,
      goldDelta: enhancementCost.gold * 2,
    });

    const [attempts] = await Promise.all([
      Promise.all([
        store.enhanceItem(
          character.id,
          starterWeapon.instanceId,
          "postgres-enhance-idempotency-0001",
        ),
        store.enhanceItem(
          character.id,
          starterWeapon.instanceId,
          "postgres-enhance-idempotency-0001",
        ),
      ]),
      store.saveCharacterState({
        id: character.id,
        operationId: "postgres-world-reward-0002",
        position: character.position,
        hp: used.hp,
        mp: used.mp,
        xp: character.xp + 42,
        level: character.level,
        goldDelta: 25,
      }),
    ]);
    expect(attempts.map(({ replayed }) => replayed).sort()).toEqual([false, true]);
    expect(attempts[0]!.result.enhancementLevel).toBe(
      attempts[1]!.result.enhancementLevel,
    );
    await store.saveCharacterState({
      id: character.id,
      operationId: "postgres-world-reward-0002",
      position: character.position,
      hp: used.hp,
      mp: used.mp,
      xp: character.xp + 42,
      level: character.level,
      goldDelta: 25,
    });
    await expect(
      store.saveCharacterState({
        id: character.id,
        operationId: "postgres-world-reward-0002",
        position: character.position,
        hp: used.hp,
        mp: used.mp,
        xp: character.xp + 42,
        level: character.level,
        goldDelta: 26,
      }),
    ).rejects.toMatchObject({ name: "IdempotencyConflictError" });

    const otherCharacter = await store.createCharacter({
      accountId: account.id,
      name: "ДругойСтраж",
      race: "human",
      classId: "warrior",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    await expect(
      store.addInventoryItem(
        otherCharacter.id,
        "mire_shard",
        1,
        {},
        "postgres-loot-claim-0001",
      ),
    ).rejects.toMatchObject({ name: "IdempotencyConflictError" });
    await expect(
      store.saveCharacterState({
        id: otherCharacter.id,
        operationId: "postgres-world-reward-0002",
        position: otherCharacter.position,
        hp: otherCharacter.hp,
        mp: otherCharacter.mp,
        xp: otherCharacter.xp,
        level: otherCharacter.level,
        goldDelta: 25,
      }),
    ).rejects.toMatchObject({ name: "IdempotencyConflictError" });

    const finalState = await store.getInventoryState(character.id);
    expect(finalState.inventory.equipment.main_hand?.enhancementLevel).toBe(1);
    expect(finalState.inventory.gold).toBe(enhancementCost.gold + 25);
    expect(
      finalState.inventory.items.find(
        ({ itemId }) => itemId === enhancementCost.catalystItemId,
      ),
    ).toBeUndefined();

    const ledger = await store.listEconomyLedger(character.id, 200);
    expect(ledger.filter(({ eventType }) => eventType === "starter_grant")).toHaveLength(
      starterGrants.length,
    );
    expect(ledger.filter(({ eventType }) => eventType === "item_consumed")).toHaveLength(1);
    expect(ledger.filter(({ eventType }) => eventType === "item_enhanced")).toHaveLength(1);
    expect(
      ledger.filter(
        ({ eventType, metadata }) =>
          eventType === "loot_acquired" && metadata.lootClaimId === "postgres-loot-claim-0001",
      ),
    ).toHaveLength(1);
    expect(ledger.find(({ eventType }) => eventType === "item_enhanced")).toMatchObject({
      goldDelta: -enhancementCost.gold,
      enhancementLevel: 1,
      metadata: {
        success: true,
        previousLevel: 0,
        roll: 0,
        chanceBps: expect.any(Number),
      },
    });
    expect(ledger.reduce((sum, entry) => sum + entry.goldDelta, 0)).toBe(
      enhancementCost.gold + 25,
    );
    const idempotencyPayload = await adminPool.query<{
      action: string;
      has_inventory: boolean;
    }>(
      `SELECT action, response ? 'inventory' AS has_inventory
       FROM ${quotedSchemaName}.idempotency_records
       WHERE character_id = $1
       ORDER BY action`,
      [character.id],
    );
    expect(idempotencyPayload.rows).toEqual([
      { action: "enhance_item", has_inventory: false },
      { action: "use_item", has_inventory: false },
    ]);
    const durableOperations = await adminPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM ${quotedSchemaName}.world_state_operations
       WHERE character_id = $1`,
      [character.id],
    );
    expect(durableOperations.rows[0]?.count).toBe("2");
    const lootClaims = await adminPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM ${quotedSchemaName}.loot_claims
       WHERE character_id = $1`,
      [character.id],
    );
    expect(lootClaims.rows[0]?.count).toBe("1");
  }, 30_000);

  it("expands v7 without rewriting v0.2 identities and normalizes every store read", async () => {
    const legacySchema = `neivara_legacy_${randomUUID().replaceAll("-", "")}`;
    const quotedLegacySchema = `"${legacySchema}"`;
    const legacyDatabaseUrl = connectionStringForNamedSchema(databaseUrl, legacySchema);
    const legacyPool = new Pool({
      connectionString: legacyDatabaseUrl,
    });
    const legacyStore = new PostgresGameStore(legacyDatabaseUrl, false, true, () => 0);
    try {
      await adminPool.query(`CREATE SCHEMA ${quotedLegacySchema}`);
      await legacyPool.query(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      for (const migration of MIGRATIONS.slice(0, -1)) {
        await legacyPool.query(migration.sql);
        await legacyPool.query(
          "INSERT INTO schema_migrations(version, name) VALUES($1, $2)",
          [migration.version, migration.name],
        );
      }
      const accountId = randomUUID();
      await legacyPool.query(
        `INSERT INTO accounts(id, username, username_key, password_hash)
         VALUES($1, 'LegacyGate', 'legacygate', 'hash')`,
        [accountId],
      );
      const legacyIdentities = [
        ["erim", "warbound", "human", "warrior"],
        ["vaeli", "pathfinder", "light_elf", "warrior"],
        ["narai", "runesmith", "dark_elf", "mage"],
        ["kerran", "lifewarden", "dwarf", "mage"],
        ["dairi", "oathweaver", "orc", "mage"],
      ] as const;
      const legacyCharacterIds: string[] = [];
      for (const [index, [race, classId]] of legacyIdentities.entries()) {
        const characterId = randomUUID();
        legacyCharacterIds.push(characterId);
        await legacyPool.query(
          `INSERT INTO characters(
             id, account_id, name, name_key, race, class_id, hp, mp
           ) VALUES($1, $2, $3, $4, $5, $6, 100, 100)`,
          [characterId, accountId, `Legacy${index}`, `legacy${index}`, race, classId],
        );
      }

      await legacyStore.initialize();
      const persisted = await legacyPool.query<{
        name: string;
        race: string;
        gender: string;
        class_id: string;
      }>("SELECT name, race, gender, class_id FROM characters ORDER BY name");
      expect(persisted.rows).toEqual([
        { name: "Legacy0", race: "erim", gender: "male", class_id: "warbound" },
        { name: "Legacy1", race: "vaeli", gender: "male", class_id: "pathfinder" },
        { name: "Legacy2", race: "narai", gender: "male", class_id: "runesmith" },
        { name: "Legacy3", race: "kerran", gender: "male", class_id: "lifewarden" },
        { name: "Legacy4", race: "dairi", gender: "male", class_id: "oathweaver" },
      ]);

      const roster = (await legacyStore.listCharacters(accountId)).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      for (const [index, [, , expectedRace, expectedClass]] of legacyIdentities.entries()) {
        expect(roster[index]).toMatchObject({
          name: `Legacy${index}`,
          race: expectedRace,
          gender: "male",
          classId: expectedClass,
        });
      }

      await expect(
        legacyStore.getCharacterForAccount(legacyCharacterIds[2]!, accountId),
      ).resolves.toMatchObject({
        race: "dark_elf",
        gender: "male",
        classId: "mage",
      });

      const postExpandLegacyId = randomUUID();
      await legacyPool.query(
        `INSERT INTO characters(
           id, account_id, name, name_key, race, class_id, hp, mp
         ) VALUES($1, $2, 'LegacyAfterExpand', 'legacyafterexpand', 'erim', 'pathfinder', 100, 100)`,
        [postExpandLegacyId, accountId],
      );
      await expect(
        legacyStore.getCharacterForAccount(postExpandLegacyId, accountId),
      ).resolves.toMatchObject({
        race: "human",
        gender: "male",
        classId: "warrior",
      });

      const mage = getClass("mage");
      const canonicalCharacter = await legacyStore.createCharacter({
        accountId,
        name: "CanonicalAfterExpand",
        race: "orc",
        gender: "female",
        classId: "mage",
        hp: mage.baseHp,
        mp: mage.baseMp,
      });
      const coexistenceRows = await legacyPool.query<{
        name: string;
        race: string;
        gender: string;
        class_id: string;
      }>(
        `SELECT name, race, gender, class_id
         FROM characters
         WHERE id IN ($1, $2)
         ORDER BY name`,
        [postExpandLegacyId, canonicalCharacter.id],
      );
      expect(coexistenceRows.rows).toEqual([
        {
          name: "CanonicalAfterExpand",
          race: "orc",
          gender: "female",
          class_id: "mage",
        },
        {
          name: "LegacyAfterExpand",
          race: "erim",
          gender: "male",
          class_id: "pathfinder",
        },
      ]);

      await legacyStore.addInventoryItem(legacyCharacterIds[2]!, "field_tonic", 1);
      const legacyInventory = await legacyStore.getInventoryState(legacyCharacterIds[2]!);
      const tonic = legacyInventory.inventory.items.find(({ itemId }) => itemId === "field_tonic")!;
      const used = await legacyStore.useItem(
        legacyCharacterIds[2]!,
        tonic.instanceId,
        "legacy-identity-use-0001",
      );
      expect(used.result).toMatchObject({
        characterClassId: "mage",
        restoredHp: 15,
      });

      const identityAfterLockedOperations = await legacyPool.query<{
        race: string;
        class_id: string;
      }>("SELECT race, class_id FROM characters WHERE id = $1", [legacyCharacterIds[2]]);
      expect(identityAfterLockedOperations.rows[0]).toEqual({
        race: "narai",
        class_id: "runesmith",
      });

      await expect(
        legacyPool.query("UPDATE characters SET race = 'unknown_race' WHERE id = $1", [
          legacyCharacterIds[0],
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await legacyStore.close();
      await legacyPool.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedLegacySchema} CASCADE`);
    }
  }, 30_000);

  it("reports unready when the latest schema version is not recorded", async () => {
    const latestMigration = MIGRATIONS.at(-1)!;
    await adminPool.query(
      `DELETE FROM ${quotedSchemaName}.schema_migrations WHERE version = $1`,
      [latestMigration.version],
    );
    await expect(store.checkReadiness()).resolves.toBe(false);
    await adminPool.query(
      `INSERT INTO ${quotedSchemaName}.schema_migrations(version, name) VALUES($1, $2)`,
      [latestMigration.version, latestMigration.name],
    );
    await expect(store.checkReadiness()).resolves.toBe(true);
  });

  it("times out instead of waiting forever for the migration advisory lock", async () => {
    const lockClient = await adminPool.connect();
    const blockedStore = new PostgresGameStore(
      connectionStringForSchema(databaseUrl),
      false,
      true,
      () => 0,
      500,
    );
    try {
      await lockClient.query("SELECT pg_advisory_lock($1, $2)", [
        1_314_272_118,
        1_295_526_721,
      ]);
      await expect(blockedStore.initialize()).rejects.toThrow(/timed out waiting 500ms/i);
    } finally {
      await blockedStore.close();
      await lockClient.query("SELECT pg_advisory_unlock($1, $2)", [
        1_314_272_118,
        1_295_526_721,
      ]);
      lockClient.release();
    }
  });

  it("bounds migration DDL waits with PostgreSQL lock and statement timeouts", async () => {
    const lockClient = await adminPool.connect();
    const latestMigration = MIGRATIONS.at(-1)!;
    const blockedStore = new PostgresGameStore(
      connectionStringForSchema(databaseUrl),
      false,
      true,
      () => 0,
      500,
    );
    try {
      await adminPool.query(
        `DELETE FROM ${quotedSchemaName}.schema_migrations WHERE version = $1`,
        [latestMigration.version],
      );
      await lockClient.query("BEGIN");
      await lockClient.query(
        `LOCK TABLE ${quotedSchemaName}.characters IN ACCESS EXCLUSIVE MODE`,
      );
      const startedAt = Date.now();
      await expect(blockedStore.initialize()).rejects.toThrow(/lock timeout/i);
      expect(Date.now() - startedAt).toBeLessThan(3_000);
    } finally {
      await blockedStore.close();
      await lockClient.query("ROLLBACK");
      lockClient.release();
      await adminPool.query(
        `INSERT INTO ${quotedSchemaName}.schema_migrations(version, name)
         VALUES($1, $2)
         ON CONFLICT(version) DO UPDATE SET name = EXCLUDED.name`,
        [latestMigration.version, latestMigration.name],
      );
    }
  }, 10_000);

  it("reads gold and item instances from one repeatable snapshot", async () => {
    const account = await store.createAccount("SnapshotGate", "integration-password-hash");
    const classDefinition = getClass("warrior");
    const character = await store.createCharacter({
      accountId: account.id,
      name: "ХранительСнимка",
      race: "human",
      classId: "warrior",
      hp: classDefinition.baseHp,
      mp: classDefinition.baseMp,
    });
    const initial = await store.getInventoryState(character.id);
    const weapon = initial.inventory.equipment.main_hand!;
    const costs = [0, 1, 2].map((level) =>
      getEnhancementCost(weapon.itemId, level),
    );
    const catalysts = new Map<string, number>();
    for (const cost of costs) {
      catalysts.set(
        cost.catalystItemId,
        (catalysts.get(cost.catalystItemId) ?? 0) + cost.catalystQuantity,
      );
    }
    for (const [itemId, quantity] of catalysts) {
      await store.addInventoryItem(
        character.id,
        itemId as (typeof costs)[number]["catalystItemId"],
        quantity,
      );
    }
    const totalGold = costs.reduce((sum, cost) => sum + cost.gold, 0);
    await store.saveCharacterState({
      id: character.id,
      operationId: "postgres-snapshot-funding-0003",
      position: character.position,
      hp: character.hp,
      mp: character.mp,
      xp: character.xp,
      level: character.level,
      goldDelta: totalGold,
    });
    const expectedGold = new Map<number, number>([[0, totalGold]]);
    let balance = totalGold;
    for (let index = 0; index < costs.length; index += 1) {
      balance -= costs[index]!.gold;
      expectedGold.set(index + 1, balance);
    }

    const mutations = (async () => {
      for (let index = 0; index < costs.length; index += 1) {
        await store.enhanceItem(
          character.id,
          weapon.instanceId,
          `snapshot-enhancement-${String(index).padStart(4, "0")}`,
        );
      }
    })();
    const reads = Promise.all(
      Array.from({ length: 40 }, () => store.getInventoryState(character.id)),
    );
    const [, snapshots] = await Promise.all([mutations, reads]);

    for (const snapshot of snapshots) {
      const level = snapshot.inventory.equipment.main_hand!.enhancementLevel;
      expect(snapshot.inventory.gold).toBe(expectedGold.get(level));
    }
    const final = await store.getInventoryState(character.id);
    expect(final.inventory.equipment.main_hand!.enhancementLevel).toBe(3);
    expect(final.inventory.gold).toBe(0);

    const questAttempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        store.advanceQuest(character.id, "first_echoes", 1),
      ),
    );
    expect(questAttempts.filter(({ rewarded }) => rewarded)).toHaveLength(1);
    expect(await store.getQuest(character.id)).toMatchObject({
      status: "completed",
      current: 3,
    });
    expect((await store.getInventoryState(character.id)).inventory.gold).toBe(25);
    expect(
      (await store.listEconomyLedger(character.id, 200)).filter(
        ({ eventType }) => eventType === "quest_reward",
      ),
    ).toHaveLength(1);
  }, 30_000);
});
