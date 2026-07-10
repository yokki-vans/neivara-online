import { STARTER_ZONE, getClass } from "@neivara/shared";
import { describe, expect, it } from "vitest";
import {
  displayZoneName,
  normalizeCharacterSummary,
  normalizeClassId,
} from "./contentCompatibility.js";

const BASE_CHARACTER = {
  id: "8f744808-2a88-4c3d-97cc-e58fe773bf6e",
  name: "Искатель",
  race: "human",
  gender: "female",
  classId: "mage",
  level: 1,
  xp: 0,
  gold: 0,
  lastSeenAt: "2026-07-10T00:00:00.000Z",
} as const;

describe("rolling content compatibility", () => {
  it("maps every v0.2 identity and supplies the safe legacy gender default", () => {
    const cases = [
      ["erim", "warbound", "human", "warrior"],
      ["vaeli", "pathfinder", "light_elf", "warrior"],
      ["narai", "runesmith", "dark_elf", "mage"],
      ["kerran", "lifewarden", "dwarf", "mage"],
      ["dairi", "oathweaver", "orc", "mage"],
    ] as const;
    for (const [race, classId, expectedRace, expectedClass] of cases) {
      const normalized = normalizeCharacterSummary({
        ...BASE_CHARACTER,
        race,
        classId,
        gender: undefined,
      } as never);
      expect(normalized).toMatchObject({
        race: expectedRace,
        classId: expectedClass,
        gender: "male",
      });
    }
  });

  it("does not silently fabricate unknown identities", () => {
    expect(() => normalizeClassId("unknown_class")).toThrow(/unknown class identity/iu);
  });

  it("renders every mage legacy alias with the requested Маг label", () => {
    for (const legacy of ["runesmith", "lifewarden", "oathweaver"]) {
      expect(getClass(normalizeClassId(legacy)).name).toBe("Маг");
    }
    expect(getClass("mage").name).toBe("Маг");
  });

  it("migrates the old starter-zone title but preserves future zone names", () => {
    expect(displayZoneName("Долина Тихих Истоков")).toBe(STARTER_ZONE.name);
    expect(displayZoneName(undefined)).toBe("Переправа Донмер");
    expect(displayZoneName("Гавань Семи Ветров")).toBe("Гавань Семи Ветров");
  });
});
