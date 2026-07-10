import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations.js";

describe("character identity migration", () => {
  it("keeps v7 as a rolling-deploy-safe expand migration", () => {
    expect(MIGRATIONS.map(({ version }) => version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const migration = MIGRATIONS.at(-1)!;
    expect(migration.name).toBe("expand_character_identity_catalog");
    expect(migration.sql).not.toMatch(/\bUPDATE\s+characters\b/iu);
    for (const acceptedId of [
      "erim",
      "vaeli",
      "narai",
      "kerran",
      "dairi",
      "human",
      "light_elf",
      "dark_elf",
      "dwarf",
      "orc",
      "warbound",
      "pathfinder",
      "runesmith",
      "lifewarden",
      "oathweaver",
      "warrior",
      "mage",
    ]) {
      expect(migration.sql).toContain(`'${acceptedId}'`);
    }
    expect(migration.sql).toContain("gender VARCHAR(16) NOT NULL DEFAULT 'male'");
    expect(migration.sql).toContain("characters_race_valid");
    expect(migration.sql).toContain("characters_gender_valid");
    expect(migration.sql).toContain("characters_class_id_valid");
  });
});
