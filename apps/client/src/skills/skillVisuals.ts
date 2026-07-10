export type SkillIconName =
  | "blade"
  | "arcane_bolt"
  | "iron_vow"
  | "far_mark"
  | "ember_sigil"
  | "mending_current"
  | "echo_companion"
  | "shield_bash"
  | "whirlwind"
  | "frost_nova"
  | "meteor"
  | "magic_barrier";

export type SkillFxStyle = "steel" | "verdant" | "ember" | "tide" | "spirit" | "frost" | "arcane";

export interface SkillVisualDefinition {
  icon: SkillIconName;
  primary: string;
  secondary: string;
  glow: string;
  fxStyle: SkillFxStyle;
}

const VISUALS = {
  blade: {
    icon: "blade",
    primary: "#f3dfad",
    secondary: "#8a4937",
    glow: "#f7b85f",
    fxStyle: "steel",
  },
  arcane_bolt: {
    icon: "arcane_bolt",
    primary: "#c8b2ff",
    secondary: "#4569a8",
    glow: "#8ce8ff",
    fxStyle: "arcane",
  },
  iron_vow: {
    icon: "iron_vow",
    primary: "#ffd17d",
    secondary: "#884f37",
    glow: "#ff9d55",
    fxStyle: "steel",
  },
  far_mark: {
    icon: "far_mark",
    primary: "#dff09b",
    secondary: "#356c50",
    glow: "#8cea83",
    fxStyle: "verdant",
  },
  ember_sigil: {
    icon: "ember_sigil",
    primary: "#ffd184",
    secondary: "#8b315a",
    glow: "#ff6d50",
    fxStyle: "ember",
  },
  mending_current: {
    icon: "mending_current",
    primary: "#c8fff0",
    secondary: "#26758a",
    glow: "#5ce7cf",
    fxStyle: "tide",
  },
  echo_companion: {
    icon: "echo_companion",
    primary: "#ffc7e9",
    secondary: "#694887",
    glow: "#dc78d4",
    fxStyle: "spirit",
  },
  shield_bash: {
    icon: "shield_bash",
    primary: "#f0d7a1",
    secondary: "#59687a",
    glow: "#e9a44e",
    fxStyle: "steel",
  },
  whirlwind: {
    icon: "whirlwind",
    primary: "#f2e4bd",
    secondary: "#5e7081",
    glow: "#9cd9e8",
    fxStyle: "steel",
  },
  frost_nova: {
    icon: "frost_nova",
    primary: "#e7fbff",
    secondary: "#477eb3",
    glow: "#75dfff",
    fxStyle: "frost",
  },
  meteor: {
    icon: "meteor",
    primary: "#ffe3a0",
    secondary: "#9b3d34",
    glow: "#ff7145",
    fxStyle: "ember",
  },
  magic_barrier: {
    icon: "magic_barrier",
    primary: "#e2d4ff",
    secondary: "#5060a4",
    glow: "#a690ff",
    fxStyle: "arcane",
  },
} as const satisfies Record<SkillIconName, SkillVisualDefinition>;

const EXACT_SKILL_ICONS: Readonly<Record<string, SkillIconName>> = {
  basic: "blade",
  vanguard_strike: "blade",
  aether_bolt: "arcane_bolt",
  iron_vow: "iron_vow",
  far_mark: "far_mark",
  ember_sigil: "ember_sigil",
  mending_current: "mending_current",
  echo_companion: "echo_companion",
  shield_bash: "shield_bash",
  whirlwind: "whirlwind",
  frost_nova: "frost_nova",
  meteor: "meteor",
  magic_barrier: "magic_barrier",
  arcane_bolt: "arcane_bolt",
};

const MAGE_HINT = /mage|magic|wizard|sorcer|warlock|spell|arcane|mystic|маг|чарод|волшеб|колдун/i;
const WARRIOR_HINT = /warrior|fighter|knight|guard|blade|sword|warbound|воин|рыцар|ратобор|меч/i;

/**
 * Resolves both current protocol IDs and future race/class-prefixed IDs without
 * coupling the presentation layer to a particular server content version.
 */
export function resolveSkillVisual(abilityId: string, roleHint = ""): SkillVisualDefinition {
  const normalized = abilityId.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const exact = EXACT_SKILL_ICONS[normalized];
  if (exact && normalized !== "basic") return VISUALS[exact];

  const searchable = `${normalized} ${roleHint}`;
  if (/heal|mend|restore|renew|life|леч|исцел/.test(searchable)) return VISUALS.mending_current;
  if (/summon|companion|spirit|echo|familiar|призыв|дух/.test(searchable)) return VISUALS.echo_companion;
  if (/frost|ice|cold|nova|лед|мороз/.test(searchable)) return VISUALS.frost_nova;
  if (/meteor|fireball|flame|ember|burn|огн|плам|метеор/.test(searchable)) return VISUALS.meteor;
  if (/barrier|ward|magic_shield|aegis|барьер|оберег/.test(searchable)) return VISUALS.magic_barrier;
  if (/shield|bash|slam|guard|щит/.test(searchable)) return VISUALS.shield_bash;
  if (/whirl|spin|cyclone|cleave|вихр|кругов/.test(searchable)) return VISUALS.whirlwind;
  if (/arrow|shot|mark|bow|выстр|лук|метк/.test(searchable)) return VISUALS.far_mark;
  if (MAGE_HINT.test(searchable)) return VISUALS.arcane_bolt;
  if (WARRIOR_HINT.test(searchable)) return VISUALS.blade;
  return exact ? VISUALS[exact] : VISUALS.blade;
}

export function skillVisualCatalog(): readonly SkillVisualDefinition[] {
  return Object.values(VISUALS);
}
