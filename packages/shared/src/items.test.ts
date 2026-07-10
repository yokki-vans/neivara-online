import { describe, expect, it } from "vitest";
import { CLASS_IDS } from "./content.js";
import {
  CONSUMABLE_ITEM_IDS,
  EQUIPMENT_SLOTS,
  ITEM_CATALOG,
  ITEM_GRADE_DEFINITIONS,
  ITEM_GRADES,
  ITEM_IDS,
  ITEM_RARITIES,
  ITEMS,
  MATERIAL_ITEM_IDS,
  SAFE_ENHANCEMENT_LEVEL,
  aggregateEquipmentStats,
  canEquipItem,
  checkItemRequirements,
  createEmptyItemStats,
  derivedCharacterStatsSchema,
  equipmentLoadoutSchema,
  getEnhancedItemStats,
  getEnhancementCost,
  getEnhancementSuccessChanceBps,
  getItemLevelRequirement,
  getMaxEnhancementLevel,
  getOccupiedEquipmentSlots,
  getStarterItemGrants,
  inventoryViewSchema,
  itemDefinitionSchema,
  itemInstanceSchema,
  resolveEnhancementAttempt,
  validateItemCatalog,
  type EquipmentLoadout,
  type ItemInstance,
} from "./items.js";

const ACQUIRED_AT = "2026-07-10T10:00:00.000Z";

function instance(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    instanceId: "9d762203-0278-4eb5-965f-16b854f40ed8",
    itemId: "tideworn_sabre",
    quantity: 1,
    enhancementLevel: 0,
    equippedSlot: null,
    bound: false,
    acquiredAt: ACQUIRED_AT,
    ...overrides,
  };
}

describe("item catalog", () => {
  it("contains a schema-valid, diverse 34 item launch catalog", () => {
    expect(ITEM_IDS).toHaveLength(34);
    expect(ITEM_CATALOG).toHaveLength(ITEM_IDS.length);
    expect(validateItemCatalog()).toHaveLength(ITEM_IDS.length);
    expect(new Set(ITEM_CATALOG.map((item) => item.id)).size).toBe(ITEM_IDS.length);
    expect(new Set(ITEM_CATALOG.map((item) => item.name)).size).toBe(ITEM_IDS.length);

    for (const item of ITEM_CATALOG) {
      expect(itemDefinitionSchema.safeParse(item).success, item.id).toBe(true);
      expect(item.requirements.level).toBe(getItemLevelRequirement(item));
      expect(item.sellPrice).toBeGreaterThanOrEqual(0);
      expect(item.stackLimit).toBeGreaterThan(0);
    }

    expect(new Set(ITEM_CATALOG.map((item) => item.category))).toEqual(
      new Set(["weapon", "armor", "accessory", "consumable", "material"]),
    );
    expect(new Set(ITEM_CATALOG.map((item) => item.grade))).toEqual(new Set(ITEM_GRADES));
    expect(new Set(ITEM_CATALOG.map((item) => item.rarity))).toEqual(new Set(ITEM_RARITIES));
    expect(CONSUMABLE_ITEM_IDS).toHaveLength(5);
    expect(MATERIAL_ITEM_IDS).toHaveLength(5);
  });

  it("keeps grade and rarity requirement formulas monotonic and bounded", () => {
    let previousGradeLevel = 0;
    for (const grade of ITEM_GRADES) {
      const common = getItemLevelRequirement({ ...ITEMS.tideworn_sabre, grade, rarity: "common" });
      expect(common).toBeGreaterThan(previousGradeLevel);
      previousGradeLevel = common;

      let previousRarityLevel = 0;
      for (const rarity of ITEM_RARITIES) {
        const requirement = getItemLevelRequirement({ ...ITEMS.tideworn_sabre, grade, rarity });
        expect(requirement).toBeGreaterThanOrEqual(previousRarityLevel);
        expect(requirement).toBeGreaterThanOrEqual(1);
        expect(requirement).toBeLessThanOrEqual(60);
        previousRarityLevel = requirement;
      }
    }
  });

  it("provides a valid starter kit for every class", () => {
    for (const classId of CLASS_IDS) {
      const grants = getStarterItemGrants(classId);
      expect(grants).toHaveLength(8);
      expect(new Set(grants.map((grant) => grant.itemId)).size).toBe(grants.length);
      for (const grant of grants) {
        expect(ITEM_IDS).toContain(grant.itemId);
        expect(grant.quantity).toBeGreaterThan(0);
        expect(ITEMS[grant.itemId].requirements.level).toBe(1);
        if (grant.autoEquipSlot !== null) {
          expect(canEquipItem(grant.itemId, { level: 1, classId }, grant.autoEquipSlot)).toBe(true);
        }
      }
    }
  });
});

describe("equipment requirements", () => {
  it("rejects wrong classes, insufficient levels, slots, and non-equipment", () => {
    expect(canEquipItem("stormglass_longbow", { level: 60, classId: "warbound" })).toBe(false);
    expect(canEquipItem("stormglass_longbow", { level: 1, classId: "pathfinder" })).toBe(false);
    expect(canEquipItem("stormglass_longbow", { level: 60, classId: "pathfinder" }, "head")).toBe(false);
    expect(canEquipItem("field_tonic", { level: 60, classId: "lifewarden" })).toBe(false);

    const check = checkItemRequirements("stormglass_longbow", { level: 1, classId: "warbound" }, "head");
    expect(check.allowed).toBe(false);
    expect(check.failures.map((failure) => failure.code)).toEqual(["level", "class", "slot"]);
  });

  it("accounts for the off hand occupied by two-handed weapons", () => {
    expect(getOccupiedEquipmentSlots("stormglass_longbow")).toEqual(["main_hand", "off_hand"]);
    expect(getOccupiedEquipmentSlots("tideworn_sabre")).toEqual(["main_hand"]);
    expect(getOccupiedEquipmentSlots("twinned_current_ring", "ring_right")).toEqual(["ring_right"]);
  });
});

describe("enhancement", () => {
  it("guarantees the safety band and never exceeds grade caps", () => {
    for (let level = 0; level < SAFE_ENHANCEMENT_LEVEL; level += 1) {
      expect(getEnhancementSuccessChanceBps("tideworn_sabre", level)).toBe(10_000);
    }

    for (const grade of ITEM_GRADES) {
      expect(getMaxEnhancementLevel(grade)).toBe(ITEM_GRADE_DEFINITIONS[grade].maximumEnhancement);
    }

    const maximum = getMaxEnhancementLevel("tideworn_sabre");
    const result = resolveEnhancementAttempt("tideworn_sabre", maximum, 0);
    expect(result).toMatchObject({ eligible: false, success: false, newLevel: maximum });
    expect(result.cost).toMatchObject({ gold: 0, catalystQuantity: 0 });
  });

  it("uses deterministic safe failure behavior without destroying items", () => {
    const failed = resolveEnhancementAttempt("bridgewatch_greatblade", 5, 9_999);
    expect(failed).toMatchObject({
      eligible: true,
      success: false,
      previousLevel: 5,
      newLevel: 4,
      downgraded: true,
      destroyed: false,
    });

    const malformedRoll = resolveEnhancementAttempt("bridgewatch_greatblade", 5, Number.NaN);
    expect(malformedRoll.success).toBe(false);
    expect(getEnhancementCost("bridgewatch_greatblade", 5).gold).toBeGreaterThan(0);
    expect(getEnhancementCost("field_tonic", 0)).toMatchObject({ gold: 0, catalystQuantity: 0 });
  });

  it("scales and aggregates stats while deduplicating equipment instances", () => {
    const base = getEnhancedItemStats("tideworn_sabre", 0);
    const enhanced = getEnhancedItemStats("tideworn_sabre", 3);
    expect(enhanced.physicalAttack).toBeGreaterThan(base.physicalAttack);

    const weapon = instance({ equippedSlot: "main_hand", enhancementLevel: 3 });
    const equipment = {
      main_hand: weapon,
      off_hand: weapon,
      chest: instance({
        instanceId: "8cf290c6-f840-4c9d-a8d6-8fa3bc338017",
        itemId: "reedwoven_coat",
        equippedSlot: "chest",
      }),
    } satisfies EquipmentLoadout;
    const total = aggregateEquipmentStats(equipment);
    expect(total.physicalAttack).toBe(enhanced.physicalAttack);
    expect(total.armor).toBe(ITEMS.reedwoven_coat.stats.armor);
    expect(total).not.toEqual(createEmptyItemStats());
  });
});

describe("item DTO schemas", () => {
  it("requires a bounded authoritative basic attack interval", () => {
    const derived = {
      maxHp: 100,
      maxMp: 50,
      physicalAttack: 20,
      spellPower: 10,
      armor: 12,
      resistance: 8,
      accuracy: 80,
      evasion: 6,
      criticalChance: 0.08,
      hastePercent: 0.1,
      moveSpeed: 5.4,
      basicRange: 3.2,
      basicAttackIntervalMs: 800,
    };
    expect(derivedCharacterStatsSchema.safeParse(derived).success).toBe(true);
    expect(
      derivedCharacterStatsSchema.safeParse({ ...derived, basicAttackIntervalMs: 0 }).success,
    ).toBe(false);
    const missingInterval = Object.fromEntries(
      Object.entries(derived).filter(([key]) => key !== "basicAttackIntervalMs"),
    );
    expect(derivedCharacterStatsSchema.safeParse(missingInterval).success).toBe(false);
  });

  it("accepts valid instances and rejects impossible stack/equipment state", () => {
    expect(itemInstanceSchema.safeParse(instance()).success).toBe(true);
    expect(
      itemInstanceSchema.safeParse(
        instance({ itemId: "field_tonic", quantity: ITEMS.field_tonic.stackLimit + 1 }),
      ).success,
    ).toBe(false);
    expect(itemInstanceSchema.safeParse(instance({ quantity: 2 })).success).toBe(false);
    expect(itemInstanceSchema.safeParse(instance({ equippedSlot: "head" })).success).toBe(false);
    expect(
      itemInstanceSchema.safeParse(
        instance({ itemId: "field_tonic", enhancementLevel: 1, equippedSlot: null }),
      ).success,
    ).toBe(false);
  });

  it("validates equipment slot consistency and inventory limits", () => {
    const equipped = instance({ equippedSlot: "main_hand" });
    expect(equipmentLoadoutSchema.safeParse({ main_hand: equipped }).success).toBe(true);
    expect(equipmentLoadoutSchema.safeParse({ head: equipped }).success).toBe(false);

    const twoHanded = instance({ itemId: "whisperbranch_bow", equippedSlot: "main_hand" });
    const shield = instance({
      instanceId: "1784b059-8a04-474d-ae75-470570d17fce",
      itemId: "memoryglass_buckler",
      equippedSlot: "off_hand",
    });
    expect(equipmentLoadoutSchema.safeParse({ main_hand: twoHanded, off_hand: shield }).success).toBe(false);

    const inventory = {
      items: [equipped],
      equipment: { main_hand: equipped },
      gold: 100,
      capacity: 48,
      usedSlots: 1,
    };
    expect(inventoryViewSchema.safeParse(inventory).success).toBe(true);
    expect(inventoryViewSchema.safeParse({ ...inventory, usedSlots: 49 }).success).toBe(false);
  });

  it("publishes every equipment slot exactly once", () => {
    expect(EQUIPMENT_SLOTS).toHaveLength(new Set(EQUIPMENT_SLOTS).size);
  });
});
