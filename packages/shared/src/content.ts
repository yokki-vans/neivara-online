export const PROTOCOL_VERSION = 3;
export const CONTENT_VERSION = "0.3.0";

export const RACE_IDS = ["human", "light_elf", "dark_elf", "dwarf", "orc"] as const;
export type RaceId = (typeof RACE_IDS)[number];

export const GENDER_IDS = ["male", "female"] as const;
export type GenderId = (typeof GENDER_IDS)[number];

export const CLASS_IDS = ["warrior", "mage"] as const;
export type ClassId = (typeof CLASS_IDS)[number];

/**
 * Persistence aliases from the 0.2 catalog. Keep these readers until a later,
 * separately deployed contract migration has backfilled every legacy row.
 */
export const LEGACY_RACE_ID_MAP: Readonly<Record<string, RaceId>> = {
  erim: "human",
  vaeli: "light_elf",
  narai: "dark_elf",
  kerran: "dwarf",
  dairi: "orc",
};

export const LEGACY_CLASS_ID_MAP: Readonly<Record<string, ClassId>> = {
  warbound: "warrior",
  pathfinder: "warrior",
  runesmith: "mage",
  lifewarden: "mage",
  oathweaver: "mage",
};

function isIdentityId<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function normalizeRaceId(value: unknown): RaceId {
  if (isIdentityId(RACE_IDS, value)) return value;
  if (typeof value === "string") {
    const canonical = LEGACY_RACE_ID_MAP[value];
    if (canonical) return canonical;
  }
  throw new Error(`Unknown race identity: ${String(value)}`);
}

export function normalizeClassId(value: unknown): ClassId {
  if (isIdentityId(CLASS_IDS, value)) return value;
  if (typeof value === "string") {
    const canonical = LEGACY_CLASS_ID_MAP[value];
    if (canonical) return canonical;
  }
  throw new Error(`Unknown class identity: ${String(value)}`);
}

export function normalizeGenderId(value: unknown): GenderId {
  if (value === undefined || value === null) return "male";
  if (isIdentityId(GENDER_IDS, value)) return value;
  throw new Error(`Unknown gender identity: ${String(value)}`);
}

export interface RaceDefinition {
  id: RaceId;
  name: string;
  summary: string;
  color: string;
  accent: string;
}

export interface GenderDefinition {
  id: GenderId;
  name: string;
}

export interface ClassDefinition {
  id: ClassId;
  name: string;
  role: string;
  summary: string;
  color: string;
  baseHp: number;
  baseMp: number;
  moveSpeed: number;
  basicRange: number;
  signatureAbilityId: AbilityId;
}

export type AbilityId = "basic" | "vanguard_strike" | "aether_bolt";

export interface AbilityDefinition {
  id: AbilityId;
  name: string;
  description: string;
  cooldownMs: number;
  manaCost: number;
  range: number;
  color: string;
  hotkey: string;
}

export const MONSTER_KINDS = [
  "thorn_prowler",
  "moss_mauler",
  "cave_shrieker",
  "ruin_sentinel",
  "bramble_boar",
  "ember_drake",
] as const;
export type MonsterKind = (typeof MONSTER_KINDS)[number];

export type StarterZoneId = "dawnmere_crossing";

export interface MonsterDefinition {
  kind: MonsterKind;
  name: string;
  level: number;
  maxHp: number;
  elite: boolean;
  speed: number;
  attackPower: number;
  aggroRange: number;
  attackRange: number;
  attackCooldownMs: number;
  respawnMs: number;
  xpReward: number;
  goldMin: number;
  goldMax: number;
  starterQuestEligible: boolean;
}

export const STARTER_ZONE: Readonly<{
  id: StarterZoneId;
  name: string;
  description: string;
}> = {
  id: "dawnmere_crossing",
  name: "Переправа Донмер",
  description: "Пограничная речная переправа с безопасным двором, охотничьими тропами, руинами и Кругом Спора.",
};

export const MONSTER_DEFINITIONS: Readonly<Record<MonsterKind, MonsterDefinition>> = {
  thorn_prowler: {
    kind: "thorn_prowler",
    name: "Терновый рыскач",
    level: 1,
    maxHp: 82,
    elite: false,
    speed: 2.35,
    attackPower: 8,
    aggroRange: 8,
    attackRange: 1.8,
    attackCooldownMs: 2_000,
    respawnMs: 12_000,
    xpReward: 42,
    goldMin: 5,
    goldMax: 9,
    starterQuestEligible: true,
  },
  moss_mauler: {
    kind: "moss_mauler",
    name: "Мшистый громила",
    level: 2,
    maxHp: 118,
    elite: false,
    speed: 1.8,
    attackPower: 11,
    aggroRange: 8.5,
    attackRange: 2.1,
    attackCooldownMs: 2_350,
    respawnMs: 14_000,
    xpReward: 58,
    goldMin: 6,
    goldMax: 10,
    starterQuestEligible: true,
  },
  cave_shrieker: {
    kind: "cave_shrieker",
    name: "Пещерный крикун",
    level: 2,
    maxHp: 94,
    elite: false,
    speed: 2.65,
    attackPower: 12,
    aggroRange: 10.5,
    attackRange: 4.8,
    attackCooldownMs: 2_100,
    respawnMs: 14_000,
    xpReward: 62,
    goldMin: 6,
    goldMax: 11,
    starterQuestEligible: true,
  },
  ruin_sentinel: {
    kind: "ruin_sentinel",
    name: "Страж руин",
    level: 4,
    maxHp: 330,
    elite: true,
    speed: 2.05,
    attackPower: 21,
    aggroRange: 13,
    attackRange: 2.5,
    attackCooldownMs: 1_700,
    respawnMs: 24_000,
    xpReward: 375,
    goldMin: 18,
    goldMax: 18,
    starterQuestEligible: false,
  },
  bramble_boar: {
    kind: "bramble_boar",
    name: "Ежевичный вепрь",
    level: 3,
    maxHp: 146,
    elite: false,
    speed: 2.45,
    attackPower: 14,
    aggroRange: 9.5,
    attackRange: 1.9,
    attackCooldownMs: 1_850,
    respawnMs: 16_000,
    xpReward: 78,
    goldMin: 8,
    goldMax: 13,
    starterQuestEligible: true,
  },
  ember_drake: {
    kind: "ember_drake",
    name: "Пепельный дрейк",
    level: 6,
    maxHp: 460,
    elite: true,
    speed: 2.75,
    attackPower: 27,
    aggroRange: 14,
    attackRange: 5.4,
    attackCooldownMs: 1_900,
    respawnMs: 32_000,
    xpReward: 650,
    goldMin: 30,
    goldMax: 30,
    starterQuestEligible: false,
  },
};

export const STARTER_QUEST_MONSTER_KINDS = MONSTER_KINDS.filter(
  (kind) => MONSTER_DEFINITIONS[kind].starterQuestEligible,
);

/**
 * Original Neivara peoples. Their silhouettes support familiar fantasy roles,
 * while names, cultures, colors and descriptions remain clean-room material.
 */
export const RACES: readonly RaceDefinition[] = [
  {
    id: "human",
    name: "Люди",
    summary: "Союзы свободных городов, чьи искатели одинаково уверенно владеют сталью и эфиром.",
    color: "#c98f68",
    accent: "#72d4d0",
  },
  {
    id: "light_elf",
    name: "Светлые эльфы",
    summary: "Хранители солнечных рощ, связывающие боевую выучку с песнями живых источников.",
    color: "#e8c8a7",
    accent: "#8be8cb",
  },
  {
    id: "dark_elf",
    name: "Тёмные эльфы",
    summary: "Обитатели сумеречных анклавов, закаляющие волю в свете подземных кристаллов.",
    color: "#7f6c9f",
    accent: "#cf79df",
  },
  {
    id: "dwarf",
    name: "Гномы",
    summary: "Горные артели мастеров, превращающие руду, механизмы и руны в надёжные инструменты.",
    color: "#c58b61",
    accent: "#f0bd55",
  },
  {
    id: "orc",
    name: "Орки",
    summary: "Крепкие степные кланы, почитающие дисциплину, память предков и силу данного слова.",
    color: "#6f9962",
    accent: "#e4864c",
  },
] as const;

export const GENDERS: readonly GenderDefinition[] = [
  { id: "male", name: "Мужской" },
  { id: "female", name: "Женский" },
] as const;

export const CLASSES: readonly ClassDefinition[] = [
  {
    id: "warrior",
    name: "Воин",
    role: "Стойкость / физический урон",
    summary: "Вступает в ближний бой, удерживает натиск и раскрывает силу оружия.",
    color: "#e9a557",
    baseHp: 175,
    baseMp: 75,
    moveSpeed: 5.3,
    basicRange: 2.8,
    signatureAbilityId: "vanguard_strike",
  },
  {
    id: "mage",
    name: "Маг",
    role: "Эфирный урон / контроль",
    summary: "Направляет эфир Истоков и поражает противников на расстоянии.",
    color: "#9c83ed",
    baseHp: 115,
    baseMp: 180,
    moveSpeed: 5.25,
    basicRange: 10,
    signatureAbilityId: "aether_bolt",
  },
] as const;

export const ABILITIES: Readonly<Record<AbilityId, AbilityDefinition>> = {
  basic: {
    id: "basic",
    name: "Основная атака",
    description: "Надёжная атака выбранным оружием.",
    cooldownMs: 900,
    manaCost: 0,
    range: 0,
    color: "#f1e2bd",
    hotkey: "1",
  },
  vanguard_strike: {
    id: "vanguard_strike",
    name: "Удар авангарда",
    description: "Мощный выпад, после которого воин ненадолго укрепляет защиту.",
    cooldownMs: 6_000,
    manaCost: 18,
    range: 3.4,
    color: "#e9a557",
    hotkey: "2",
  },
  aether_bolt: {
    id: "aether_bolt",
    name: "Эфирный импульс",
    description: "Сгусток энергии Истока наносит усиленный магический урон на расстоянии.",
    cooldownMs: 5_000,
    manaCost: 24,
    range: 12,
    color: "#9c83ed",
    hotkey: "2",
  },
};

export function getRace(id: RaceId): RaceDefinition {
  const value = RACES.find((race) => race.id === id);
  if (!value) throw new Error(`Unknown race: ${id}`);
  return value;
}

export function getGender(id: GenderId): GenderDefinition {
  const value = GENDERS.find((gender) => gender.id === id);
  if (!value) throw new Error(`Unknown gender: ${id}`);
  return value;
}

export function getClass(id: ClassId): ClassDefinition {
  const value = CLASSES.find((entry) => entry.id === id);
  if (!value) throw new Error(`Unknown class: ${id}`);
  return value;
}
