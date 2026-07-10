import { describe, expect, it } from "vitest";
import { getSkillFxMotionProfile, skillFxPalette, type SkillFxKind } from "./skillFx";

describe("skill FX accessibility profiles", () => {
  const kinds: readonly SkillFxKind[] = ["cast", "projectile", "impact", "aura"];

  it("removes travel, rotation, and shards when reduced motion is requested", () => {
    for (const kind of kinds) {
      const profile = getSkillFxMotionProfile(kind, true);
      expect(profile.translateProjectile).toBe(false);
      expect(profile.rotate).toBe(false);
      expect(profile.shardCount).toBe(0);
      expect(profile.ringCount).toBe(1);
      expect(profile.durationMs).toBeLessThanOrEqual(420);
    }
  });

  it("retains readable full-motion silhouettes for normal play", () => {
    expect(getSkillFxMotionProfile("projectile", false).translateProjectile).toBe(true);
    expect(getSkillFxMotionProfile("impact", false).ringCount).toBe(2);
    expect(getSkillFxMotionProfile("aura", false).durationMs).toBeGreaterThan(1_000);
  });

  it("shares the same deterministic palette as the action icon", () => {
    expect(skillFxPalette("orc_whirlwind", "orc warrior")).toEqual({
      style: "steel",
      primary: "#f2e4bd",
      glow: "#9cd9e8",
    });
    expect(skillFxPalette("dark_elf_fireball", "dark elf mage").style).toBe("ember");
  });
});
