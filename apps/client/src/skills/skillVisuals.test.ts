import { describe, expect, it } from "vitest";
import { resolveSkillVisual, skillVisualCatalog } from "./skillVisuals";

describe("skill visual catalog", () => {
  it("maps every currently shipped ability to an intentional icon", () => {
    expect(resolveSkillVisual("basic", "warrior").icon).toBe("blade");
    expect(resolveSkillVisual("vanguard_strike", "warrior").icon).toBe("blade");
    expect(resolveSkillVisual("aether_bolt", "mage").icon).toBe("arcane_bolt");
    // Legacy IDs remain safe while existing sessions cross the content upgrade.
    expect(resolveSkillVisual("iron_vow").icon).toBe("iron_vow");
    expect(resolveSkillVisual("far_mark").icon).toBe("far_mark");
    expect(resolveSkillVisual("ember_sigil").icon).toBe("ember_sigil");
    expect(resolveSkillVisual("mending_current").icon).toBe("mending_current");
    expect(resolveSkillVisual("echo_companion").icon).toBe("echo_companion");
  });

  it("defensively resolves future race-prefixed warrior and mage abilities", () => {
    expect(resolveSkillVisual("orc-whirlwind", "orc warrior").icon).toBe("whirlwind");
    expect(resolveSkillVisual("dwarf_shield_slam", "dwarf fighter").icon).toBe("shield_bash");
    expect(resolveSkillVisual("light_elf_frost_nova", "light elf mage").icon).toBe("frost_nova");
    expect(resolveSkillVisual("dark_elf_fireball", "dark elf mage").icon).toBe("meteor");
    expect(resolveSkillVisual("human_basic", "human mage").icon).toBe("arcane_bolt");
    expect(resolveSkillVisual("human_basic", "human warrior").icon).toBe("blade");
  });

  it("keeps every original icon palette complete and valid", () => {
    const catalog = skillVisualCatalog();
    expect(catalog).toHaveLength(12);
    expect(new Set(catalog.map((entry) => entry.icon)).size).toBe(catalog.length);
    for (const entry of catalog) {
      expect(entry.primary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(entry.secondary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(entry.glow).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
