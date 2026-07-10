import { describe, expect, it } from "vitest";
import { getItem, type InventoryView, type ItemInstance } from "@neivara/shared";
import { getEnhancementPreview, getEquipAvailability } from "./inventoryPresentation";

function item(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    instanceId: "weapon-1",
    itemId: "tideworn_sabre",
    quantity: 1,
    enhancementLevel: 0,
    equippedSlot: null,
    bound: false,
    acquiredAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

function inventory(items: ItemInstance[], gold: number): InventoryView {
  return { items, equipment: {}, gold, capacity: 48, usedSlots: items.length };
}

describe("equipment presentation rules", () => {
  it("explains both level and class restrictions", () => {
    const availability = getEquipAvailability(
      getItem("bridgewatch_greatblade"),
      { level: 1, classId: "pathfinder" },
    );

    expect(availability.allowed).toBe(false);
    expect(availability.reasons).toContain("Нужен 11 уровень");
    expect(availability.reasons.join(" ")).toContain("Ратоборец");
  });

  it("allows a matching class at the required level", () => {
    expect(getEquipAvailability(
      getItem("bridgewatch_greatblade"),
      { level: 11, classId: "warbound" },
    )).toEqual({ allowed: true, reasons: [] });
  });
});

describe("enhancement confirmation preview", () => {
  it("reports exact resources, safe failure and affordability", () => {
    const weapon = item();
    const catalyst = item({
      instanceId: "dust-1",
      itemId: "resonant_dust",
      quantity: 5,
    });
    const preview = getEnhancementPreview(weapon, inventory([weapon, catalyst], 1_000));

    expect(preview.chanceBps).toBe(10_000);
    expect(preview.affordable).toBe(true);
    expect(preview.catalystRequired).toBeGreaterThan(0);
    expect(preview.failureDescription).toContain("уровень сохранится");
    expect(preview.failureDescription).toContain("не разрушится");
  });

  it("discloses downgrade risk above the safe threshold", () => {
    const weapon = item({ enhancementLevel: 4 });
    const preview = getEnhancementPreview(weapon, inventory([weapon], 0));

    expect(preview.chanceBps).toBeLessThan(10_000);
    expect(preview.affordable).toBe(false);
    expect(preview.failureDescription).toContain("снизится до +3");
  });
});
