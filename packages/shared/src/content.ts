export const PROTOCOL_VERSION = 2;
export const CONTENT_VERSION = "0.2.0";

export const RACE_IDS = ["erim", "vaeli", "kerran", "narai", "dairi"] as const;
export type RaceId = (typeof RACE_IDS)[number];

export const CLASS_IDS = [
  "warbound",
  "pathfinder",
  "runesmith",
  "lifewarden",
  "oathweaver",
] as const;
export type ClassId = (typeof CLASS_IDS)[number];

export interface RaceDefinition {
  id: RaceId;
  name: string;
  summary: string;
  color: string;
  accent: string;
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

export type AbilityId =
  | "basic"
  | "iron_vow"
  | "far_mark"
  | "ember_sigil"
  | "mending_current"
  | "echo_companion";

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

export const RACES: readonly RaceDefinition[] = [
  {
    id: "erim",
    name: "Эримы",
    summary: "Жители речных республик, мастера торговли, навигации и ремёсел.",
    color: "#d39a63",
    accent: "#7de5d2",
  },
  {
    id: "vaeli",
    name: "Ваэли",
    summary: "Народ живых рощ, читающий память мира по узорам корней.",
    color: "#8ccf9d",
    accent: "#f0d77f",
  },
  {
    id: "kerran",
    name: "Керраны",
    summary: "Горные кланы с минерализованными костями и традицией клятв.",
    color: "#9ca9b8",
    accent: "#e39f64",
  },
  {
    id: "narai",
    name: "Нарай",
    summary: "Караванные жители сумеречных пустошей, хранители звёздных карт.",
    color: "#ad96d8",
    accent: "#9ee7ff",
  },
  {
    id: "dairi",
    name: "Дайри",
    summary: "Степные союзы, связывающие боевые клятвы с духами зверей.",
    color: "#c68167",
    accent: "#d6ed83",
  },
] as const;

export const CLASSES: readonly ClassDefinition[] = [
  {
    id: "warbound",
    name: "Ратоборец",
    role: "Защита / ближний бой",
    summary: "Удерживает противников и прикрывает союзников тяжёлым оружием.",
    color: "#eeaa5b",
    baseHp: 180,
    baseMp: 70,
    moveSpeed: 5.2,
    basicRange: 2.8,
    signatureAbilityId: "iron_vow",
  },
  {
    id: "pathfinder",
    name: "Следопыт",
    role: "Дальний урон / мобильность",
    summary: "Отмечает цель, держит дистанцию и наносит точные выстрелы.",
    color: "#8fd36f",
    baseHp: 130,
    baseMp: 100,
    moveSpeed: 5.8,
    basicRange: 12,
    signatureAbilityId: "far_mark",
  },
  {
    id: "runesmith",
    name: "Рунник",
    role: "Магический урон / контроль",
    summary: "Создаёт печати Истоков и взрывает их накопленную память.",
    color: "#a882ff",
    baseHp: 110,
    baseMp: 180,
    moveSpeed: 5.3,
    basicRange: 10,
    signatureAbilityId: "ember_sigil",
  },
  {
    id: "lifewarden",
    name: "Жизневед",
    role: "Лечение / поддержка",
    summary: "Направляет живую воду Истоков, исцеляя и укрепляя группу.",
    color: "#58d5c7",
    baseHp: 125,
    baseMp: 170,
    moveSpeed: 5.4,
    basicRange: 9,
    signatureAbilityId: "mending_current",
  },
  {
    id: "oathweaver",
    name: "Клятвопряд",
    role: "Призыв / ослабление",
    summary: "Придаёт клятвам форму и призывает отголоски верных существ.",
    color: "#dc6fa7",
    baseHp: 120,
    baseMp: 160,
    moveSpeed: 5.4,
    basicRange: 9,
    signatureAbilityId: "echo_companion",
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
  iron_vow: {
    id: "iron_vow",
    name: "Железная клятва",
    description: "Сильный удар; временно снижает входящий урон.",
    cooldownMs: 6_000,
    manaCost: 18,
    range: 3.2,
    color: "#eeaa5b",
    hotkey: "2",
  },
  far_mark: {
    id: "far_mark",
    name: "Дальняя метка",
    description: "Точный выстрел с повышенным шансом критического урона.",
    cooldownMs: 4_500,
    manaCost: 16,
    range: 15,
    color: "#8fd36f",
    hotkey: "2",
  },
  ember_sigil: {
    id: "ember_sigil",
    name: "Тлеющая печать",
    description: "Вспышка памяти Истока наносит тяжёлый магический урон.",
    cooldownMs: 5_000,
    manaCost: 24,
    range: 12,
    color: "#a882ff",
    hotkey: "2",
  },
  mending_current: {
    id: "mending_current",
    name: "Целебное течение",
    description: "Восстанавливает здоровье себе или выбранному союзнику.",
    cooldownMs: 4_000,
    manaCost: 22,
    range: 12,
    color: "#58d5c7",
    hotkey: "2",
  },
  echo_companion: {
    id: "echo_companion",
    name: "Верный отголосок",
    description: "Посылает духа-клятву атаковать выбранную цель.",
    cooldownMs: 5_500,
    manaCost: 20,
    range: 11,
    color: "#dc6fa7",
    hotkey: "2",
  },
};

export function getRace(id: RaceId): RaceDefinition {
  const value = RACES.find((race) => race.id === id);
  if (!value) throw new Error(`Unknown race: ${id}`);
  return value;
}

export function getClass(id: ClassId): ClassDefinition {
  const value = CLASSES.find((entry) => entry.id === id);
  if (!value) throw new Error(`Unknown class: ${id}`);
  return value;
}
