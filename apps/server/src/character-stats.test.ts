import { createEmptyItemStats, getClass } from "@neivara/shared";
import { describe, expect, it } from "vitest";
import { deriveCharacterStats } from "./character-stats.js";

describe("derived character stats", () => {
  it("uses the equipped weapon range instead of the class default", () => {
    const equipment = createEmptyItemStats();
    expect(deriveCharacterStats("warrior", 1, equipment).basicRange).toBe(
      getClass("warrior").basicRange,
    );
    expect(
      deriveCharacterStats("warrior", 1, equipment, "whisperbranch_bow").basicRange,
    ).toBe(13);
    expect(
      deriveCharacterStats("warrior", 1, equipment, "horizon_spear").basicRange,
    ).toBe(4.2);
    expect(
      deriveCharacterStats("warrior", 1, equipment, "duskneedle_dagger")
        .basicAttackIntervalMs,
    ).toBe(720);
    expect(
      deriveCharacterStats("warrior", 1, equipment, "bridgewatch_greatblade")
        .basicAttackIntervalMs,
    ).toBe(1_180);
  });
});
