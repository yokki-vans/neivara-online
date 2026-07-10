import { describe, expect, it } from "vitest";
import {
  ITEMS,
  LEGACY_CLASS_ID_MAP,
  LEGACY_RACE_ID_MAP,
  MONSTER_DEFINITIONS,
  MONSTER_KINDS,
  STARTER_QUEST_MONSTER_KINDS,
  STARTER_ZONE,
  normalizeClassId,
  normalizeGenderId,
  normalizeRaceId,
} from "./index.js";

describe("character identity compatibility", () => {
  it("normalizes every legacy persistence alias and preserves canonical IDs", () => {
    for (const [legacy, canonical] of Object.entries(LEGACY_RACE_ID_MAP)) {
      expect(normalizeRaceId(legacy)).toBe(canonical);
      expect(normalizeRaceId(canonical)).toBe(canonical);
    }
    for (const [legacy, canonical] of Object.entries(LEGACY_CLASS_ID_MAP)) {
      expect(normalizeClassId(legacy)).toBe(canonical);
      expect(normalizeClassId(canonical)).toBe(canonical);
    }
  });

  it("supplies the v0.2 gender default but rejects unknown identities", () => {
    expect(normalizeGenderId(undefined)).toBe("male");
    expect(normalizeGenderId(null)).toBe("male");
    expect(normalizeGenderId("female")).toBe("female");
    expect(() => normalizeRaceId("unknown_race")).toThrow(/unknown race identity/iu);
    expect(() => normalizeClassId("unknown_class")).toThrow(/unknown class identity/iu);
    expect(() => normalizeGenderId("unknown_gender")).toThrow(/unknown gender identity/iu);
  });
});

describe("Dawnmere starter-zone content", () => {
  it("publishes six unique, fully data-driven monster archetypes", () => {
    expect(MONSTER_KINDS).toEqual([
      "thorn_prowler",
      "moss_mauler",
      "cave_shrieker",
      "ruin_sentinel",
      "bramble_boar",
      "ember_drake",
    ]);
    expect(Object.keys(MONSTER_DEFINITIONS)).toEqual([...MONSTER_KINDS]);

    for (const kind of MONSTER_KINDS) {
      const definition = MONSTER_DEFINITIONS[kind];
      expect(definition.kind).toBe(kind);
      expect(definition.name.length).toBeGreaterThan(3);
      expect(definition.level).toBeGreaterThan(0);
      expect(definition.maxHp).toBeGreaterThan(0);
      expect(definition.speed).toBeGreaterThan(0);
      expect(definition.attackPower).toBeGreaterThan(0);
      expect(definition.attackRange).toBeGreaterThan(0);
      expect(definition.attackCooldownMs).toBeGreaterThanOrEqual(1_000);
      expect(definition.respawnMs).toBeGreaterThanOrEqual(10_000);
      expect(definition.goldMax).toBeGreaterThanOrEqual(definition.goldMin);
    }
  });

  it("limits the first quest to several non-elite starter creatures", () => {
    expect(STARTER_QUEST_MONSTER_KINDS).toEqual([
      "thorn_prowler",
      "moss_mauler",
      "cave_shrieker",
      "bramble_boar",
    ]);
    for (const kind of STARTER_QUEST_MONSTER_KINDS) {
      expect(MONSTER_DEFINITIONS[kind].elite).toBe(false);
      expect(MONSTER_DEFINITIONS[kind].starterQuestEligible).toBe(true);
    }
  });

  it("uses the renamed zone consistently for snapshots and return items", () => {
    expect(STARTER_ZONE).toMatchObject({
      id: "dawnmere_crossing",
      name: "Переправа Донмер",
    });
    expect(ITEMS.returning_stone.effect).toMatchObject({
      kind: "return",
      destinationId: STARTER_ZONE.id,
    });
  });
});
