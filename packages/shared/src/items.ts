import { z } from "zod";
import { CLASS_IDS, type ClassId } from "./content.js";
import { MAX_LEVEL } from "./progression.js";

export const ITEM_IDS = [
  "tideworn_sabre",
  "bridgewatch_greatblade",
  "whisperbranch_bow",
  "stormglass_longbow",
  "emberglyph_staff",
  "wellspring_scepter",
  "duskneedle_dagger",
  "oathforge_hammer",
  "horizon_spear",
  "riverguard_helm",
  "riverguard_cuirass",
  "riverguard_gauntlets",
  "riverguard_greaves",
  "riverguard_boots",
  "reedwoven_hood",
  "reedwoven_coat",
  "reedwoven_wraps",
  "reedwoven_trousers",
  "reedwoven_boots",
  "memoryglass_buckler",
  "moonsilt_amulet",
  "twinned_current_ring",
  "wayfinder_ear_cuff",
  "rootbound_charm",
  "field_tonic",
  "clarity_draught",
  "swiftstep_elixir",
  "warding_salve",
  "returning_stone",
  "mire_shard",
  "resonant_dust",
  "riversteel_ingot",
  "whisperwood_limb",
  "skyweave_thread",
] as const;

export type ItemId = (typeof ITEM_IDS)[number];

export const ITEM_CATEGORIES = ["weapon", "armor", "accessory", "consumable", "material"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const ITEM_GRADES = ["wayfarer", "pathbound", "oathforged", "sourceborn", "starwoven"] as const;
export type ItemGrade = (typeof ITEM_GRADES)[number];

export const ITEM_RARITIES = ["common", "fine", "rare", "epic", "relic"] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];

export const EQUIPMENT_SLOTS = [
  "main_hand",
  "off_hand",
  "head",
  "chest",
  "hands",
  "legs",
  "feet",
  "neck",
  "ring_left",
  "ring_right",
  "ear_left",
  "ear_right",
  "charm",
] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

export const WEAPON_TYPES = ["sabre", "greatblade", "bow", "staff", "scepter", "dagger", "hammer", "spear"] as const;
export type WeaponType = (typeof WEAPON_TYPES)[number];

export const ARMOR_WEIGHTS = ["cloth", "light", "medium", "heavy", "shield"] as const;
export type ArmorWeight = (typeof ARMOR_WEIGHTS)[number];

export const ITEM_VISUAL_KEYS = [
  "sabre",
  "greatblade",
  "bow",
  "staff",
  "scepter",
  "dagger",
  "hammer",
  "spear",
  "helmet",
  "chest",
  "gloves",
  "legs",
  "boots",
  "shield",
  "amulet",
  "ring",
  "earring",
  "charm",
  "potion",
  "stone",
  "shard",
  "dust",
  "ingot",
  "wood",
  "thread",
] as const;
export type ItemVisualKey = (typeof ITEM_VISUAL_KEYS)[number];

export interface ItemGradeDefinition {
  id: ItemGrade;
  name: string;
  minimumLevel: number;
  maximumEnhancement: number;
  enhancementBaseChanceBps: number;
}

export const ITEM_GRADE_DEFINITIONS: Readonly<Record<ItemGrade, ItemGradeDefinition>> = {
  wayfarer: {
    id: "wayfarer",
    name: "Путевой",
    minimumLevel: 1,
    maximumEnhancement: 6,
    enhancementBaseChanceBps: 9_400,
  },
  pathbound: {
    id: "pathbound",
    name: "Страннический",
    minimumLevel: 10,
    maximumEnhancement: 8,
    enhancementBaseChanceBps: 9_000,
  },
  oathforged: {
    id: "oathforged",
    name: "Кованый клятвой",
    minimumLevel: 22,
    maximumEnhancement: 10,
    enhancementBaseChanceBps: 8_600,
  },
  sourceborn: {
    id: "sourceborn",
    name: "Истоковый",
    minimumLevel: 38,
    maximumEnhancement: 12,
    enhancementBaseChanceBps: 8_200,
  },
  starwoven: {
    id: "starwoven",
    name: "Звёзднотканый",
    minimumLevel: 52,
    maximumEnhancement: 14,
    enhancementBaseChanceBps: 7_800,
  },
};

export interface ItemRarityDefinition {
  id: ItemRarity;
  name: string;
  color: string;
  levelOffset: number;
  enhancementPenaltyBps: number;
  priceMultiplierBps: number;
}

export const ITEM_RARITY_DEFINITIONS: Readonly<Record<ItemRarity, ItemRarityDefinition>> = {
  common: {
    id: "common",
    name: "Обычный",
    color: "#c8d0d6",
    levelOffset: 0,
    enhancementPenaltyBps: 0,
    priceMultiplierBps: 10_000,
  },
  fine: {
    id: "fine",
    name: "Добротный",
    color: "#70d99b",
    levelOffset: 1,
    enhancementPenaltyBps: 150,
    priceMultiplierBps: 12_500,
  },
  rare: {
    id: "rare",
    name: "Редкий",
    color: "#67aef7",
    levelOffset: 2,
    enhancementPenaltyBps: 300,
    priceMultiplierBps: 16_000,
  },
  epic: {
    id: "epic",
    name: "Эпический",
    color: "#b987ff",
    levelOffset: 3,
    enhancementPenaltyBps: 500,
    priceMultiplierBps: 22_000,
  },
  relic: {
    id: "relic",
    name: "Реликтовый",
    color: "#ffc963",
    levelOffset: 4,
    enhancementPenaltyBps: 750,
    priceMultiplierBps: 30_000,
  },
};

export const EQUIPMENT_SLOT_LABELS: Readonly<Record<EquipmentSlot, string>> = {
  main_hand: "Основная рука",
  off_hand: "Вторая рука",
  head: "Голова",
  chest: "Корпус",
  hands: "Кисти",
  legs: "Ноги",
  feet: "Ступни",
  neck: "Шея",
  ring_left: "Левое кольцо",
  ring_right: "Правое кольцо",
  ear_left: "Левая серьга",
  ear_right: "Правая серьга",
  charm: "Оберег",
};

export interface ItemStatBlock {
  maxHp: number;
  maxMp: number;
  physicalAttack: number;
  spellPower: number;
  armor: number;
  resistance: number;
  accuracy: number;
  evasion: number;
  criticalRating: number;
  hasteRating: number;
  movementSpeedBps: number;
}

export type ItemStats = Readonly<{
  [Key in keyof ItemStatBlock]?: ItemStatBlock[Key] | undefined;
}>;
export type ItemStatKey = keyof ItemStatBlock;

export const ITEM_STAT_LABELS: Readonly<Record<ItemStatKey, string>> = {
  maxHp: "Здоровье",
  maxMp: "Энергия",
  physicalAttack: "Сила атаки",
  spellPower: "Сила чар",
  armor: "Броня",
  resistance: "Сопротивление",
  accuracy: "Точность",
  evasion: "Уклонение",
  criticalRating: "Критический рейтинг",
  hasteRating: "Рейтинг скорости",
  movementSpeedBps: "Скорость движения",
};

export interface DerivedCharacterStats {
  maxHp: number;
  maxMp: number;
  physicalAttack: number;
  spellPower: number;
  armor: number;
  resistance: number;
  accuracy: number;
  evasion: number;
  criticalChance: number;
  hastePercent: number;
  moveSpeed: number;
  basicRange: number;
  basicAttackIntervalMs: number;
}

export interface ItemRequirements {
  level: number;
  classes: readonly ClassId[];
}

export interface ItemVisual {
  icon: ItemVisualKey;
  model: ItemVisualKey;
  primaryColor: string;
  accentColor: string;
  scale: number;
}

interface BaseItemDefinition {
  id: ItemId;
  name: string;
  description: string;
  lore: string;
  category: ItemCategory;
  grade: ItemGrade;
  rarity: ItemRarity;
  color: string;
  stackLimit: number;
  sellPrice: number;
  tradeable: boolean;
  usable: boolean;
  stats: ItemStats;
  requirements: ItemRequirements;
  visual: ItemVisual;
}

interface EquippableDefinition extends BaseItemDefinition {
  slot: EquipmentSlot;
  allowedSlots: readonly EquipmentSlot[];
}

export interface WeaponItemDefinition extends EquippableDefinition {
  category: "weapon";
  usable: false;
  slot: "main_hand";
  allowedSlots: readonly EquipmentSlot[];
  weaponType: WeaponType;
  handedness: "one_handed" | "two_handed";
  range: number;
  attackIntervalMs: number;
}

export interface ArmorItemDefinition extends EquippableDefinition {
  category: "armor";
  usable: false;
  armorWeight: ArmorWeight;
}

export interface AccessoryItemDefinition extends EquippableDefinition {
  category: "accessory";
  usable: false;
}

export type ConsumableEffect =
  | { kind: "restore"; resource: "hp" | "mp"; amount: number }
  | { kind: "buff"; stats: ItemStats; durationMs: number }
  | { kind: "return"; destinationId: "silent_wellspring_vale"; castTimeMs: number };

export interface ConsumableItemDefinition extends BaseItemDefinition {
  category: "consumable";
  usable: true;
  cooldownMs: number;
  effect: ConsumableEffect;
}

export interface MaterialItemDefinition extends BaseItemDefinition {
  category: "material";
  usable: false;
}

export type EquippableItemDefinition = WeaponItemDefinition | ArmorItemDefinition | AccessoryItemDefinition;
export type ItemDefinition = EquippableItemDefinition | ConsumableItemDefinition | MaterialItemDefinition;

export function calculateItemLevelRequirement(grade: ItemGrade, rarity: ItemRarity): number {
  const baseLevel = ITEM_GRADE_DEFINITIONS[grade].minimumLevel;
  const offset = ITEM_RARITY_DEFINITIONS[rarity].levelOffset;
  return Math.max(1, Math.min(MAX_LEVEL, baseLevel + offset));
}

function requirements(
  grade: ItemGrade,
  rarity: ItemRarity,
  classes: readonly ClassId[] = [],
): ItemRequirements {
  return { level: calculateItemLevelRequirement(grade, rarity), classes };
}

function visual(
  model: ItemVisualKey,
  primaryColor: string,
  accentColor: string,
  scale = 1,
): ItemVisual {
  return { icon: model, model, primaryColor, accentColor, scale };
}

const EMPTY_STATS: ItemStats = {};
const MAIN_HAND = ["main_hand"] as const;
const RING_SLOTS = ["ring_left", "ring_right"] as const;
const EAR_SLOTS = ["ear_left", "ear_right"] as const;

export const ITEMS = {
  tideworn_sabre: {
    id: "tideworn_sabre",
    name: "Сабля Приливной тропы",
    description: "Лёгкий клинок для быстрых связок в ближнем бою.",
    lore: "Такими саблями речные проводники расчищали путь сквозь камышовые протоки.",
    category: "weapon",
    grade: "wayfarer",
    rarity: "common",
    color: "#b9d8dc",
    stackLimit: 1,
    sellPrice: 85,
    tradeable: true,
    usable: false,
    stats: { physicalAttack: 14, accuracy: 2 },
    requirements: requirements("wayfarer", "common"),
    visual: visual("sabre", "#a7c8d0", "#4c7e8b", 0.96),
    slot: "main_hand",
    allowedSlots: MAIN_HAND,
    weaponType: "sabre",
    handedness: "one_handed",
    range: 2.8,
    attackIntervalMs: 880,
  },
  bridgewatch_greatblade: {
    id: "bridgewatch_greatblade",
    name: "Двуручник Дозора мостов",
    description: "Тяжёлый клинок с широкой гардой для сокрушительных ударов.",
    lore: "Дозорные выковывают гарду в форме разведённых мостовых ферм — знака открытого пути.",
    category: "weapon",
    grade: "pathbound",
    rarity: "fine",
    color: "#dca86d",
    stackLimit: 1,
    sellPrice: 620,
    tradeable: true,
    usable: false,
    stats: { physicalAttack: 38, criticalRating: 7 },
    requirements: requirements("pathbound", "fine", ["warbound"]),
    visual: visual("greatblade", "#c9b08d", "#c26c3d", 1.12),
    slot: "main_hand",
    allowedSlots: MAIN_HAND,
    weaponType: "greatblade",
    handedness: "two_handed",
    range: 3.4,
    attackIntervalMs: 1_180,
  },
  whisperbranch_bow: {
    id: "whisperbranch_bow",
    name: "Лук Шепчущей ветви",
    description: "Гибкий походный лук, сохраняющий точность на ходу.",
    lore: "Ваэли выбирают ветвь, которая первой отвечает шелестом на имя будущего владельца.",
    category: "weapon",
    grade: "wayfarer",
    rarity: "common",
    color: "#8fcf8b",
    stackLimit: 1,
    sellPrice: 90,
    tradeable: true,
    usable: false,
    stats: { physicalAttack: 12, accuracy: 5 },
    requirements: requirements("wayfarer", "common", ["pathfinder"]),
    visual: visual("bow", "#7f9f5f", "#d9cf85"),
    slot: "main_hand",
    allowedSlots: MAIN_HAND,
    weaponType: "bow",
    handedness: "two_handed",
    range: 13,
    attackIntervalMs: 1_020,
  },
  stormglass_longbow: {
    id: "stormglass_longbow",
    name: "Длинный лук Грозового стекла",
    description: "Дальний лук с минерализованными плечами и ровным натяжением.",
    lore: "Тонкие стеклянные жилы вспыхивают перед грозой, предупреждая стрелка о перемене ветра.",
    category: "weapon",
    grade: "oathforged",
    rarity: "rare",
    color: "#72b8e8",
    stackLimit: 1,
    sellPrice: 2_450,
    tradeable: true,
    usable: false,
    stats: { physicalAttack: 62, accuracy: 14, criticalRating: 12 },
    requirements: requirements("oathforged", "rare", ["pathfinder"]),
    visual: visual("bow", "#718b9f", "#72d6f2", 1.1),
    slot: "main_hand",
    allowedSlots: MAIN_HAND,
    weaponType: "bow",
    handedness: "two_handed",
    range: 15.5,
    attackIntervalMs: 1_080,
  },
  emberglyph_staff: {
    id: "emberglyph_staff",
    name: "Посох Тлеющего знака",
    description: "Учебный проводник, усиливающий первые печати и чары.",
    lore: "Его навершие хранит лишь тёплый след Истока, безопасный для неопытных рук.",
    category: "weapon",
    grade: "wayfarer",
    rarity: "common",
    color: "#bc8ff1",
    stackLimit: 1,
    sellPrice: 95,
    tradeable: true,
    usable: false,
    stats: { spellPower: 15, maxMp: 12 },
    requirements: requirements("wayfarer", "common", ["runesmith", "lifewarden", "oathweaver"]),
    visual: visual("staff", "#77518e", "#f09a66", 1.04),
    slot: "main_hand",
    allowedSlots: MAIN_HAND,
    weaponType: "staff",
    handedness: "two_handed",
    range: 10.5,
    attackIntervalMs: 980,
  },
  wellspring_scepter: {
    id: "wellspring_scepter",
    name: "Скипетр Тихого родника",
    description: "Одноручный фокус для направленного лечения и защитных потоков.",
    lore: "Камень в навершии мутнеет рядом с испорченной водой и светлеет после очищения.",
    category: "weapon",
    grade: "wayfarer",
    rarity: "common",
    color: "#6ed7c8",
    stackLimit: 1,
    sellPrice: 92,
    tradeable: true,
    usable: false,
    stats: { spellPower: 13, maxMp: 14, resistance: 2 },
    requirements: requirements("wayfarer", "common", ["lifewarden", "oathweaver"]),
    visual: visual("scepter", "#5d8e91", "#7ae6d0", 0.92),
    slot: "main_hand",
    allowedSlots: MAIN_HAND,
    weaponType: "scepter",
    handedness: "one_handed",
    range: 10,
    attackIntervalMs: 920,
  },
  duskneedle_dagger: {
    id: "duskneedle_dagger",
    name: "Кинжал Сумеречной иглы",
    description: "Узкий клинок, рассчитанный на точность и внезапный выпад.",
    lore: "Нарай отмечают на обухе пройденные караваном созвездия, но никогда — поверженных врагов.",
    category: "weapon",
    grade: "wayfarer",
    rarity: "common",
    color: "#b4a7df",
    stackLimit: 1,
    sellPrice: 82,
    tradeable: true,
    usable: false,
    stats: { physicalAttack: 10, criticalRating: 6, hasteRating: 4 },
    requirements: requirements("wayfarer", "common", ["pathfinder", "oathweaver"]),
    visual: visual("dagger", "#9d9ab2", "#b98ae8", 0.88),
    slot: "main_hand",
    allowedSlots: MAIN_HAND,
    weaponType: "dagger",
    handedness: "one_handed",
    range: 2.4,
    attackIntervalMs: 720,
  },
  oathforge_hammer: {
    id: "oathforge_hammer",
    name: "Молот Клятвенной кузни",
    description: "Боевой молот с сердечником, отзывающимся на крепкие обещания.",
    lore: "Керранские кузнецы прекращают работу, если владелец нарушает клятву, данную при закалке.",
    category: "weapon",
    grade: "oathforged",
    rarity: "epic",
    color: "#c58bf0",
    stackLimit: 1,
    sellPrice: 3_100,
    tradeable: true,
    usable: false,
    stats: { physicalAttack: 70, armor: 10, accuracy: 6 },
    requirements: requirements("oathforged", "epic", ["warbound"]),
    visual: visual("hammer", "#767f8b", "#e1995d", 1.08),
    slot: "main_hand",
    allowedSlots: MAIN_HAND,
    weaponType: "hammer",
    handedness: "one_handed",
    range: 3,
    attackIntervalMs: 1_140,
  },
  horizon_spear: {
    id: "horizon_spear",
    name: "Копьё Дальнего горизонта",
    description: "Длинное степное копьё для удержания врага на границе досягаемости.",
    lore: "Полированное древко отражает линию небосвода даже в беззвёздную ночь.",
    category: "weapon",
    grade: "sourceborn",
    rarity: "rare",
    color: "#6aaee6",
    stackLimit: 1,
    sellPrice: 7_800,
    tradeable: true,
    usable: false,
    stats: { physicalAttack: 94, accuracy: 12, criticalRating: 10 },
    requirements: requirements("sourceborn", "rare", ["warbound", "pathfinder"]),
    visual: visual("spear", "#6e5948", "#8ee0ef", 1.16),
    slot: "main_hand",
    allowedSlots: MAIN_HAND,
    weaponType: "spear",
    handedness: "two_handed",
    range: 4.2,
    attackIntervalMs: 1_100,
  },
  riverguard_helm: {
    id: "riverguard_helm",
    name: "Шлем Речного дозора",
    description: "Закрытый шлем с водоотводящим гребнем.",
    lore: "Гребень направляет дождь за спину, чтобы часовой не терял обзор в бурю.",
    category: "armor",
    grade: "pathbound",
    rarity: "fine",
    color: "#c9a977",
    stackLimit: 1,
    sellPrice: 330,
    tradeable: true,
    usable: false,
    stats: { armor: 14, maxHp: 10 },
    requirements: requirements("pathbound", "fine", ["warbound"]),
    visual: visual("helmet", "#78858b", "#c8894b"),
    slot: "head",
    allowedSlots: ["head"],
    armorWeight: "heavy",
  },
  riverguard_cuirass: {
    id: "riverguard_cuirass",
    name: "Кираса Речного дозора",
    description: "Сегментный панцирь, распределяющий силу тяжёлого удара.",
    lore: "Каждая пластина закалена водой из другой реки — карта республики, которую можно носить.",
    category: "armor",
    grade: "pathbound",
    rarity: "fine",
    color: "#c9a977",
    stackLimit: 1,
    sellPrice: 520,
    tradeable: true,
    usable: false,
    stats: { armor: 27, resistance: 5, maxHp: 22 },
    requirements: requirements("pathbound", "fine", ["warbound"]),
    visual: visual("chest", "#69787f", "#ca8750", 1.03),
    slot: "chest",
    allowedSlots: ["chest"],
    armorWeight: "heavy",
  },
  riverguard_gauntlets: {
    id: "riverguard_gauntlets",
    name: "Рукавицы Речного дозора",
    description: "Пластинчатые рукавицы с подвижными сочленениями.",
    lore: "На внутренней стороне выгравированы сигналы дозорных башен.",
    category: "armor",
    grade: "pathbound",
    rarity: "common",
    color: "#b6c0c4",
    stackLimit: 1,
    sellPrice: 280,
    tradeable: true,
    usable: false,
    stats: { armor: 11, accuracy: 2 },
    requirements: requirements("pathbound", "common", ["warbound"]),
    visual: visual("gloves", "#718088", "#b77745"),
    slot: "hands",
    allowedSlots: ["hands"],
    armorWeight: "heavy",
  },
  riverguard_greaves: {
    id: "riverguard_greaves",
    name: "Поножи Речного дозора",
    description: "Тяжёлые поножи, не мешающие держать устойчивую стойку.",
    lore: "Пластины перекрываются, словно чешуя старых речных шлюзов.",
    category: "armor",
    grade: "pathbound",
    rarity: "common",
    color: "#b6c0c4",
    stackLimit: 1,
    sellPrice: 390,
    tradeable: true,
    usable: false,
    stats: { armor: 19, maxHp: 14 },
    requirements: requirements("pathbound", "common", ["warbound"]),
    visual: visual("legs", "#65757c", "#b77745"),
    slot: "legs",
    allowedSlots: ["legs"],
    armorWeight: "heavy",
  },
  riverguard_boots: {
    id: "riverguard_boots",
    name: "Сапоги Речного дозора",
    description: "Высокие сапоги с усиленным носком и цепкой подошвой.",
    lore: "Подошва оставляет след в форме волны — старый знак безопасной переправы.",
    category: "armor",
    grade: "pathbound",
    rarity: "common",
    color: "#b6c0c4",
    stackLimit: 1,
    sellPrice: 270,
    tradeable: true,
    usable: false,
    stats: { armor: 10, movementSpeedBps: 60 },
    requirements: requirements("pathbound", "common", ["warbound"]),
    visual: visual("boots", "#59676d", "#aa7145"),
    slot: "feet",
    allowedSlots: ["feet"],
    armorWeight: "heavy",
  },
  reedwoven_hood: {
    id: "reedwoven_hood",
    name: "Капюшон Камышового плетения",
    description: "Лёгкий непромокаемый капюшон для первых путешествий.",
    lore: "Тонкие волокна поют на ветру, если впереди начинается ливень.",
    category: "armor",
    grade: "wayfarer",
    rarity: "common",
    color: "#9bc48b",
    stackLimit: 1,
    sellPrice: 45,
    tradeable: true,
    usable: false,
    stats: { armor: 4, resistance: 2 },
    requirements: requirements("wayfarer", "common"),
    visual: visual("helmet", "#687b55", "#b4d681", 0.94),
    slot: "head",
    allowedSlots: ["head"],
    armorWeight: "light",
  },
  reedwoven_coat: {
    id: "reedwoven_coat",
    name: "Куртка Камышового плетения",
    description: "Мягкая дорожная куртка с усиленной грудной вставкой.",
    lore: "Её плетут у воды, чтобы волокна запомнили гибкость течения.",
    category: "armor",
    grade: "wayfarer",
    rarity: "common",
    color: "#9bc48b",
    stackLimit: 1,
    sellPrice: 70,
    tradeable: true,
    usable: false,
    stats: { armor: 8, resistance: 4, maxHp: 6 },
    requirements: requirements("wayfarer", "common"),
    visual: visual("chest", "#657a51", "#c6d78a"),
    slot: "chest",
    allowedSlots: ["chest"],
    armorWeight: "light",
  },
  reedwoven_wraps: {
    id: "reedwoven_wraps",
    name: "Обмотки Камышового плетения",
    description: "Гибкие защитные обмотки для ладоней и предплечий.",
    lore: "Путники вплетают в них узелок на память о каждом надёжном спутнике.",
    category: "armor",
    grade: "wayfarer",
    rarity: "common",
    color: "#9bc48b",
    stackLimit: 1,
    sellPrice: 38,
    tradeable: true,
    usable: false,
    stats: { armor: 3, hasteRating: 2 },
    requirements: requirements("wayfarer", "common"),
    visual: visual("gloves", "#71805c", "#bdcd82"),
    slot: "hands",
    allowedSlots: ["hands"],
    armorWeight: "light",
  },
  reedwoven_trousers: {
    id: "reedwoven_trousers",
    name: "Штаны Камышового плетения",
    description: "Прочные походные штаны, не стесняющие движения.",
    lore: "Внутренний шов прокладывают нитью небесного цвета — на удачу в дороге.",
    category: "armor",
    grade: "wayfarer",
    rarity: "common",
    color: "#9bc48b",
    stackLimit: 1,
    sellPrice: 56,
    tradeable: true,
    usable: false,
    stats: { armor: 5, evasion: 2 },
    requirements: requirements("wayfarer", "common"),
    visual: visual("legs", "#60724f", "#aeba78"),
    slot: "legs",
    allowedSlots: ["legs"],
    armorWeight: "light",
  },
  reedwoven_boots: {
    id: "reedwoven_boots",
    name: "Башмаки Камышового плетения",
    description: "Тихая лёгкая обувь с нескользящей подошвой.",
    lore: "Высушенный камыш не впитывает болотную воду и почти не оставляет следов.",
    category: "armor",
    grade: "wayfarer",
    rarity: "common",
    color: "#9bc48b",
    stackLimit: 1,
    sellPrice: 42,
    tradeable: true,
    usable: false,
    stats: { armor: 3, movementSpeedBps: 40 },
    requirements: requirements("wayfarer", "common"),
    visual: visual("boots", "#596b4b", "#a8bd72"),
    slot: "feet",
    allowedSlots: ["feet"],
    armorWeight: "light",
  },
  memoryglass_buckler: {
    id: "memoryglass_buckler",
    name: "Баклер Зеркальной памяти",
    description: "Небольшой щит, рассеивающий часть удара и чужих чар.",
    lore: "На поверхности на миг проступает последний отражённый удар, но никогда — лицо нападавшего.",
    category: "armor",
    grade: "pathbound",
    rarity: "rare",
    color: "#68b8e2",
    stackLimit: 1,
    sellPrice: 760,
    tradeable: true,
    usable: false,
    stats: { armor: 18, resistance: 16, maxHp: 12 },
    requirements: requirements("pathbound", "rare", ["warbound", "lifewarden"]),
    visual: visual("shield", "#7399a8", "#74d8ed", 0.94),
    slot: "off_hand",
    allowedSlots: ["off_hand"],
    armorWeight: "shield",
  },
  moonsilt_amulet: {
    id: "moonsilt_amulet",
    name: "Амулет Лунного ила",
    description: "Прохладный амулет, укрепляющий тело и защиту от чар.",
    lore: "Серебристый ил собирают только там, где полная луна касается неподвижной воды.",
    category: "accessory",
    grade: "pathbound",
    rarity: "rare",
    color: "#6db8ef",
    stackLimit: 1,
    sellPrice: 680,
    tradeable: true,
    usable: false,
    stats: { maxHp: 24, resistance: 12 },
    requirements: requirements("pathbound", "rare"),
    visual: visual("amulet", "#8798a9", "#8edcf4"),
    slot: "neck",
    allowedSlots: ["neck"],
  },
  twinned_current_ring: {
    id: "twinned_current_ring",
    name: "Кольцо Сдвоенного течения",
    description: "Кольцо с двумя подвижными дорожками, усиливающее точность.",
    lore: "Дорожки вращаются навстречу друг другу и останавливаются только рядом с близким союзником.",
    category: "accessory",
    grade: "oathforged",
    rarity: "epic",
    color: "#bb86f2",
    stackLimit: 1,
    sellPrice: 2_100,
    tradeable: true,
    usable: false,
    stats: { accuracy: 10, criticalRating: 8, spellPower: 8 },
    requirements: requirements("oathforged", "epic"),
    visual: visual("ring", "#8797a0", "#c18aef"),
    slot: "ring_left",
    allowedSlots: RING_SLOTS,
  },
  wayfinder_ear_cuff: {
    id: "wayfinder_ear_cuff",
    name: "Кафф Искателя дорог",
    description: "Лёгкая серьга, помогающая различать движение и опасность.",
    lore: "В безветрие тонкая подвеска сама указывает в сторону ближайшей открытой дороги.",
    category: "accessory",
    grade: "wayfarer",
    rarity: "fine",
    color: "#68d79c",
    stackLimit: 1,
    sellPrice: 150,
    tradeable: true,
    usable: false,
    stats: { evasion: 4, accuracy: 3 },
    requirements: requirements("wayfarer", "fine"),
    visual: visual("earring", "#b6a774", "#7bdcb4", 0.9),
    slot: "ear_left",
    allowedSlots: EAR_SLOTS,
  },
  rootbound_charm: {
    id: "rootbound_charm",
    name: "Оберег Связанных корней",
    description: "Живой деревянный знак, поддерживающий запас жизненной силы.",
    lore: "Две половины корня продолжают расти друг к другу, сколько бы дорог их ни разделяло.",
    category: "accessory",
    grade: "starwoven",
    rarity: "relic",
    color: "#f1bd62",
    stackLimit: 1,
    sellPrice: 9_200,
    tradeable: false,
    usable: false,
    stats: { maxHp: 90, maxMp: 55, resistance: 18, hasteRating: 12 },
    requirements: requirements("starwoven", "relic"),
    visual: visual("charm", "#6f5740", "#d5ed83", 1.05),
    slot: "charm",
    allowedSlots: ["charm"],
  },
  field_tonic: {
    id: "field_tonic",
    name: "Походный настой",
    description: "Быстро восстанавливает 70 единиц здоровья.",
    lore: "Терпкий состав Совета мостов; его рецепт открыт для любого дорожного лекаря.",
    category: "consumable",
    grade: "wayfarer",
    rarity: "common",
    color: "#e98970",
    stackLimit: 50,
    sellPrice: 12,
    tradeable: true,
    usable: true,
    stats: EMPTY_STATS,
    requirements: requirements("wayfarer", "common"),
    visual: visual("potion", "#b43d34", "#f3ad76", 0.88),
    cooldownMs: 12_000,
    effect: { kind: "restore", resource: "hp", amount: 70 },
  },
  clarity_draught: {
    id: "clarity_draught",
    name: "Настой ясного русла",
    description: "Быстро восстанавливает 55 единиц энергии.",
    lore: "Капля не смешивается с мутной водой, пока та не станет прозрачной.",
    category: "consumable",
    grade: "wayfarer",
    rarity: "common",
    color: "#6fa7ec",
    stackLimit: 50,
    sellPrice: 16,
    tradeable: true,
    usable: true,
    stats: EMPTY_STATS,
    requirements: requirements("wayfarer", "common"),
    visual: visual("potion", "#426fbd", "#87d5ed", 0.88),
    cooldownMs: 12_000,
    effect: { kind: "restore", resource: "mp", amount: 55 },
  },
  swiftstep_elixir: {
    id: "swiftstep_elixir",
    name: "Эликсир Быстрого шага",
    description: "На 90 секунд увеличивает скорость движения на 8%.",
    lore: "В пузырьках настоя слышен ритм копыт, даже когда флакон неподвижен.",
    category: "consumable",
    grade: "pathbound",
    rarity: "rare",
    color: "#76d4a6",
    stackLimit: 20,
    sellPrice: 65,
    tradeable: true,
    usable: true,
    stats: EMPTY_STATS,
    requirements: requirements("pathbound", "rare"),
    visual: visual("potion", "#3b976c", "#c7ef85"),
    cooldownMs: 30_000,
    effect: { kind: "buff", stats: { movementSpeedBps: 800 }, durationMs: 90_000 },
  },
  warding_salve: {
    id: "warding_salve",
    name: "Защитная мазь камнероста",
    description: "На 120 секунд повышает броню и сопротивление.",
    lore: "Застывает тончайшей коркой и осыпается серым песком, когда действие заканчивается.",
    category: "consumable",
    grade: "pathbound",
    rarity: "fine",
    color: "#b4a083",
    stackLimit: 20,
    sellPrice: 52,
    tradeable: true,
    usable: true,
    stats: EMPTY_STATS,
    requirements: requirements("pathbound", "fine"),
    visual: visual("potion", "#81705f", "#d1b778"),
    cooldownMs: 30_000,
    effect: { kind: "buff", stats: { armor: 18, resistance: 12 }, durationMs: 120_000 },
  },
  returning_stone: {
    id: "returning_stone",
    name: "Камень Возвратного круга",
    description: "После восьмисекундного сосредоточения возвращает к Тихому Истоку.",
    lore: "Его вытачивают из камня, взятого у порога дома, и оставляют одну грань необработанной.",
    category: "consumable",
    grade: "wayfarer",
    rarity: "rare",
    color: "#7dbbe7",
    stackLimit: 10,
    sellPrice: 95,
    tradeable: true,
    usable: true,
    stats: EMPTY_STATS,
    requirements: requirements("wayfarer", "rare"),
    visual: visual("stone", "#607d8d", "#8ce2ef"),
    cooldownMs: 120_000,
    effect: { kind: "return", destinationId: "silent_wellspring_vale", castTimeMs: 8_000 },
  },
  mire_shard: {
    id: "mire_shard",
    name: "Осколок топкого отголоска",
    description: "Холодный фрагмент памяти, оставшийся от болотного существа.",
    lore: "Если поднести его к уху, можно услышать дождь, прошедший над болотом много лет назад.",
    category: "material",
    grade: "wayfarer",
    rarity: "common",
    color: "#78d5bb",
    stackLimit: 999,
    sellPrice: 4,
    tradeable: true,
    usable: false,
    stats: EMPTY_STATS,
    requirements: requirements("wayfarer", "common"),
    visual: visual("shard", "#4a9a85", "#8be4ca", 0.86),
  },
  resonant_dust: {
    id: "resonant_dust",
    name: "Резонансная пыль",
    description: "Стабилизирующий порошок для безопасного усиления снаряжения.",
    lore: "Пылинки поднимаются над ладонью, когда рядом звучит искренне произнесённая клятва.",
    category: "material",
    grade: "pathbound",
    rarity: "fine",
    color: "#bca4e8",
    stackLimit: 999,
    sellPrice: 18,
    tradeable: true,
    usable: false,
    stats: EMPTY_STATS,
    requirements: requirements("pathbound", "fine"),
    visual: visual("dust", "#8b70b2", "#e2bcff"),
  },
  riversteel_ingot: {
    id: "riversteel_ingot",
    name: "Слиток речной стали",
    description: "Упругий сплав для оружия и тяжёлых доспехов.",
    lore: "Его охлаждают в проточной воде; рисунок течения навсегда остаётся на металле.",
    category: "material",
    grade: "pathbound",
    rarity: "common",
    color: "#9bafb8",
    stackLimit: 999,
    sellPrice: 14,
    tradeable: true,
    usable: false,
    stats: EMPTY_STATS,
    requirements: requirements("pathbound", "common"),
    visual: visual("ingot", "#71848d", "#b9d5d9"),
  },
  whisperwood_limb: {
    id: "whisperwood_limb",
    name: "Плечо шепчущего дерева",
    description: "Выдержанная древесина для луков, посохов и оберегов.",
    lore: "Срубленная без разрешения рощи ветвь немеет и рассыпается ещё до обработки.",
    category: "material",
    grade: "oathforged",
    rarity: "rare",
    color: "#7fc68c",
    stackLimit: 999,
    sellPrice: 36,
    tradeable: true,
    usable: false,
    stats: EMPTY_STATS,
    requirements: requirements("oathforged", "rare"),
    visual: visual("wood", "#6f4f39", "#92cf7e", 1.08),
  },
  skyweave_thread: {
    id: "skyweave_thread",
    name: "Нить небесного плетения",
    description: "Почти невесомое волокно для лёгкого снаряжения высокого качества.",
    lore: "При закате нить принимает цвет самой яркой полосы неба и хранит его до рассвета.",
    category: "material",
    grade: "sourceborn",
    rarity: "epic",
    color: "#b58ce9",
    stackLimit: 999,
    sellPrice: 82,
    tradeable: true,
    usable: false,
    stats: EMPTY_STATS,
    requirements: requirements("sourceborn", "epic"),
    visual: visual("thread", "#7faac8", "#d5a5ed"),
  },
} satisfies Record<ItemId, ItemDefinition>;

export const ITEM_CATALOG: readonly ItemDefinition[] = ITEM_IDS.map((id) => ITEMS[id]);

export const STARTER_WEAPON_BY_CLASS: Readonly<Record<ClassId, ItemId>> = {
  warbound: "tideworn_sabre",
  pathfinder: "whisperbranch_bow",
  runesmith: "emberglyph_staff",
  lifewarden: "wellspring_scepter",
  oathweaver: "duskneedle_dagger",
};

export const STARTER_ARMOR_ITEM_IDS = [
  "reedwoven_hood",
  "reedwoven_coat",
  "reedwoven_wraps",
  "reedwoven_trousers",
  "reedwoven_boots",
] as const satisfies readonly ItemId[];

export const STARTER_CONSUMABLE_ITEM_IDS = ["field_tonic", "clarity_draught"] as const satisfies readonly ItemId[];
export const CONSUMABLE_ITEM_IDS = [
  "field_tonic",
  "clarity_draught",
  "swiftstep_elixir",
  "warding_salve",
  "returning_stone",
] as const satisfies readonly ItemId[];
export const MATERIAL_ITEM_IDS = [
  "mire_shard",
  "resonant_dust",
  "riversteel_ingot",
  "whisperwood_limb",
  "skyweave_thread",
] as const satisfies readonly ItemId[];
export const ENHANCEMENT_CATALYST_ITEM_ID = "resonant_dust" as const satisfies ItemId;

export interface StarterItemGrant {
  itemId: ItemId;
  quantity: number;
  autoEquipSlot: EquipmentSlot | null;
}

export function getStarterItemGrants(classId: ClassId): readonly StarterItemGrant[] {
  const armorSlots: readonly EquipmentSlot[] = ["head", "chest", "hands", "legs", "feet"];
  const armor = STARTER_ARMOR_ITEM_IDS.map((itemId, index): StarterItemGrant => ({
    itemId,
    quantity: 1,
    autoEquipSlot: armorSlots[index] ?? null,
  }));

  return [
    { itemId: STARTER_WEAPON_BY_CLASS[classId], quantity: 1, autoEquipSlot: "main_hand" },
    ...armor,
    { itemId: "field_tonic", quantity: 5, autoEquipSlot: null },
    { itemId: "clarity_draught", quantity: 3, autoEquipSlot: null },
  ];
}

export interface ItemInstance {
  instanceId: string;
  itemId: ItemId;
  quantity: number;
  enhancementLevel: number;
  equippedSlot: EquipmentSlot | null;
  bound: boolean;
  acquiredAt: string;
}

export type EquipmentLoadout = Partial<Record<EquipmentSlot, ItemInstance>>;
export type Equipment = EquipmentLoadout;

export interface InventoryView {
  items: ItemInstance[];
  equipment: EquipmentLoadout;
  gold: number;
  capacity: number;
  usedSlots: number;
}

export function isItemId(value: unknown): value is ItemId {
  return typeof value === "string" && Object.hasOwn(ITEMS, value);
}

export function findItem(value: unknown): ItemDefinition | undefined {
  return isItemId(value) ? ITEMS[value] : undefined;
}

export function getItem(id: ItemId): ItemDefinition {
  return ITEMS[id];
}

export function isEquippableItem(item: ItemDefinition): item is EquippableItemDefinition {
  return item.category === "weapon" || item.category === "armor" || item.category === "accessory";
}

export function isConsumableItem(item: ItemDefinition): item is ConsumableItemDefinition {
  return item.category === "consumable";
}

function resolveItem(item: ItemId | ItemDefinition): ItemDefinition {
  return typeof item === "string" ? getItem(item) : item;
}

export function getItemLevelRequirement(item: ItemId | ItemDefinition): number {
  const definition = resolveItem(item);
  return calculateItemLevelRequirement(definition.grade, definition.rarity);
}

export function getAllowedEquipmentSlots(item: ItemId | ItemDefinition): readonly EquipmentSlot[] {
  const definition = resolveItem(item);
  return isEquippableItem(definition) ? definition.allowedSlots : [];
}

export function getOccupiedEquipmentSlots(
  item: ItemId | ItemDefinition,
  selectedSlot?: EquipmentSlot,
): readonly EquipmentSlot[] {
  const definition = resolveItem(item);
  if (!isEquippableItem(definition)) return [];

  const slot = selectedSlot ?? definition.slot;
  const allowedSlots: readonly EquipmentSlot[] = definition.allowedSlots;
  if (!allowedSlots.includes(slot)) return [];
  if (definition.category === "weapon" && definition.handedness === "two_handed") {
    return ["main_hand", "off_hand"];
  }
  return [slot];
}

export interface EquipRequirementContext {
  level: number;
  classId: ClassId;
}

export type EquipRequirementFailureCode = "not_equippable" | "level" | "class" | "slot";

export interface EquipRequirementFailure {
  code: EquipRequirementFailureCode;
  requiredLevel: number | null;
}

export interface EquipRequirementCheck {
  allowed: boolean;
  failures: readonly EquipRequirementFailure[];
}

export function checkItemRequirements(
  item: ItemId | ItemDefinition,
  character: EquipRequirementContext,
  selectedSlot?: EquipmentSlot,
): EquipRequirementCheck {
  const definition = resolveItem(item);
  const failures: EquipRequirementFailure[] = [];

  if (!isEquippableItem(definition)) {
    failures.push({ code: "not_equippable", requiredLevel: null });
    return { allowed: false, failures };
  }

  const level = Number.isFinite(character.level) ? Math.max(1, Math.floor(character.level)) : 1;
  if (level < definition.requirements.level) {
    failures.push({ code: "level", requiredLevel: definition.requirements.level });
  }
  if (
    definition.requirements.classes.length > 0 &&
    !definition.requirements.classes.includes(character.classId)
  ) {
    failures.push({ code: "class", requiredLevel: null });
  }
  const allowedSlots: readonly EquipmentSlot[] = definition.allowedSlots;
  if (selectedSlot !== undefined && !allowedSlots.includes(selectedSlot)) {
    failures.push({ code: "slot", requiredLevel: null });
  }

  return { allowed: failures.length === 0, failures };
}

export function canEquipItem(
  item: ItemId | ItemDefinition,
  character: EquipRequirementContext,
  selectedSlot?: EquipmentSlot,
): boolean {
  return checkItemRequirements(item, character, selectedSlot).allowed;
}

export function createEmptyItemStats(): ItemStatBlock {
  return {
    maxHp: 0,
    maxMp: 0,
    physicalAttack: 0,
    spellPower: 0,
    armor: 0,
    resistance: 0,
    accuracy: 0,
    evasion: 0,
    criticalRating: 0,
    hasteRating: 0,
    movementSpeedBps: 0,
  };
}

export function normalizeItemStats(stats: ItemStats): ItemStatBlock {
  const normalized = createEmptyItemStats();
  for (const key of Object.keys(normalized) as ItemStatKey[]) {
    const raw = stats[key] ?? 0;
    normalized[key] = Number.isFinite(raw) ? Math.trunc(raw) : 0;
  }
  return normalized;
}

function safeInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

export const SAFE_ENHANCEMENT_LEVEL = 3;
export const MAX_ENHANCEMENT_LEVEL = Math.max(
  ...ITEM_GRADES.map((grade) => ITEM_GRADE_DEFINITIONS[grade].maximumEnhancement),
);

export function getMaxEnhancementLevel(item: ItemId | ItemDefinition | ItemGrade): number {
  const grade = typeof item === "string" && ITEM_GRADES.includes(item as ItemGrade)
    ? (item as ItemGrade)
    : resolveItem(item as ItemId | ItemDefinition).grade;
  return ITEM_GRADE_DEFINITIONS[grade].maximumEnhancement;
}

export function normalizeEnhancementLevel(item: ItemId | ItemDefinition, level: number): number {
  const definition = resolveItem(item);
  if (!isEquippableItem(definition)) return 0;
  return safeInteger(level, 0, getMaxEnhancementLevel(definition));
}

export function getEnhancementMultiplierBps(item: ItemId | ItemDefinition, level: number): number {
  const definition = resolveItem(item);
  if (!isEquippableItem(definition)) return 10_000;
  const safeLevel = normalizeEnhancementLevel(definition, level);
  const perLevel = definition.category === "weapon" ? 500 : definition.category === "armor" ? 400 : 300;
  const levelsPastSafety = Math.max(0, safeLevel - SAFE_ENHANCEMENT_LEVEL);
  return 10_000 + safeLevel * perLevel + levelsPastSafety * levelsPastSafety * 45;
}

export function getEnhancedItemStats(item: ItemId | ItemDefinition, level: number): ItemStatBlock {
  const definition = resolveItem(item);
  const base = normalizeItemStats(definition.stats);
  if (!isEquippableItem(definition)) return base;
  const multiplierBps = getEnhancementMultiplierBps(definition, level);

  for (const key of Object.keys(base) as ItemStatKey[]) {
    base[key] = Math.round((base[key] * multiplierBps) / 10_000);
  }
  return base;
}

export function getEnhancementSuccessChanceBps(item: ItemId | ItemDefinition, currentLevel: number): number {
  const definition = resolveItem(item);
  if (!isEquippableItem(definition)) return 0;
  const level = normalizeEnhancementLevel(definition, currentLevel);
  if (level >= getMaxEnhancementLevel(definition)) return 0;
  if (level < SAFE_ENHANCEMENT_LEVEL) return 10_000;

  const grade = ITEM_GRADE_DEFINITIONS[definition.grade];
  const rarityPenalty = ITEM_RARITY_DEFINITIONS[definition.rarity].enhancementPenaltyBps;
  const curvePenalty = (level - SAFE_ENHANCEMENT_LEVEL) * 575 + level * level * 18;
  return Math.max(1_000, Math.min(9_500, grade.enhancementBaseChanceBps - rarityPenalty - curvePenalty));
}

export interface EnhancementCost {
  gold: number;
  catalystItemId: typeof ENHANCEMENT_CATALYST_ITEM_ID;
  catalystQuantity: number;
}

export function getEnhancementCost(item: ItemId | ItemDefinition, currentLevel: number): EnhancementCost {
  const definition = resolveItem(item);
  if (!isEquippableItem(definition)) {
    return { gold: 0, catalystItemId: ENHANCEMENT_CATALYST_ITEM_ID, catalystQuantity: 0 };
  }

  const normalizedLevel = normalizeEnhancementLevel(definition, currentLevel);
  if (normalizedLevel >= getMaxEnhancementLevel(definition)) {
    return { gold: 0, catalystItemId: ENHANCEMENT_CATALYST_ITEM_ID, catalystQuantity: 0 };
  }

  const nextLevel = Math.min(
    getMaxEnhancementLevel(definition),
    normalizedLevel + 1,
  );
  const rarity = ITEM_RARITY_DEFINITIONS[definition.rarity];
  const baseCost = Math.max(25, Math.round(definition.sellPrice * 0.2));
  const scaledCost = baseCost * nextLevel ** 1.45 * (rarity.priceMultiplierBps / 10_000);
  const rarityRank = ITEM_RARITIES.indexOf(definition.rarity);

  return {
    gold: safeInteger(Math.round(scaledCost), 0, Number.MAX_SAFE_INTEGER),
    catalystItemId: ENHANCEMENT_CATALYST_ITEM_ID,
    catalystQuantity: Math.max(1, Math.ceil(nextLevel / 2) + rarityRank),
  };
}

export interface EnhancementResult {
  eligible: boolean;
  success: boolean;
  previousLevel: number;
  newLevel: number;
  chanceBps: number;
  downgraded: boolean;
  destroyed: false;
  cost: EnhancementCost;
}

export function resolveEnhancementAttempt(
  item: ItemId | ItemDefinition,
  currentLevel: number,
  rollBps: number,
): EnhancementResult {
  const definition = resolveItem(item);
  const previousLevel = normalizeEnhancementLevel(definition, currentLevel);
  const chanceBps = getEnhancementSuccessChanceBps(definition, previousLevel);
  const cost = getEnhancementCost(definition, previousLevel);
  const eligible = isEquippableItem(definition) && previousLevel < getMaxEnhancementLevel(definition);
  if (!eligible) {
    return {
      eligible: false,
      success: false,
      previousLevel,
      newLevel: previousLevel,
      chanceBps: 0,
      downgraded: false,
      destroyed: false,
      cost,
    };
  }

  const roll = Number.isInteger(rollBps) && rollBps >= 0 && rollBps <= 9_999 ? rollBps : 9_999;
  const success = roll < chanceBps;
  const newLevel = success
    ? previousLevel + 1
    : previousLevel > SAFE_ENHANCEMENT_LEVEL
      ? previousLevel - 1
      : previousLevel;

  return {
    eligible: true,
    success,
    previousLevel,
    newLevel,
    chanceBps,
    downgraded: newLevel < previousLevel,
    destroyed: false,
    cost,
  };
}

export function aggregateEquipmentStats(equipment: EquipmentLoadout): ItemStatBlock {
  const total = createEmptyItemStats();
  const seenInstances = new Set<string>();

  for (const instance of Object.values(equipment)) {
    if (!instance || seenInstances.has(instance.instanceId)) continue;
    seenInstances.add(instance.instanceId);
    const definition = getItem(instance.itemId);
    if (!isEquippableItem(definition)) continue;
    const stats = getEnhancedItemStats(definition, instance.enhancementLevel);
    for (const key of Object.keys(total) as ItemStatKey[]) {
      total[key] += stats[key];
    }
  }

  return total;
}

const nonnegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

export const itemIdSchema = z.enum(ITEM_IDS);
export const itemCategorySchema = z.enum(ITEM_CATEGORIES);
export const itemGradeSchema = z.enum(ITEM_GRADES);
export const itemRaritySchema = z.enum(ITEM_RARITIES);
export const equipmentSlotSchema = z.enum(EQUIPMENT_SLOTS);
export const weaponTypeSchema = z.enum(WEAPON_TYPES);
export const armorWeightSchema = z.enum(ARMOR_WEIGHTS);
export const itemVisualKeySchema = z.enum(ITEM_VISUAL_KEYS);

export const itemStatsSchema = z
  .object({
    maxHp: z.number().int().min(-100_000).max(100_000),
    maxMp: z.number().int().min(-100_000).max(100_000),
    physicalAttack: z.number().int().min(-100_000).max(100_000),
    spellPower: z.number().int().min(-100_000).max(100_000),
    armor: z.number().int().min(-100_000).max(100_000),
    resistance: z.number().int().min(-100_000).max(100_000),
    accuracy: z.number().int().min(-100_000).max(100_000),
    evasion: z.number().int().min(-100_000).max(100_000),
    criticalRating: z.number().int().min(-100_000).max(100_000),
    hasteRating: z.number().int().min(-100_000).max(100_000),
    movementSpeedBps: z.number().int().min(-9_000).max(20_000),
  })
  .partial()
  .strict();

export const itemStatBlockSchema = z.object({
  maxHp: z.number().int().min(-100_000).max(100_000),
  maxMp: z.number().int().min(-100_000).max(100_000),
  physicalAttack: z.number().int().min(-100_000).max(100_000),
  spellPower: z.number().int().min(-100_000).max(100_000),
  armor: z.number().int().min(-100_000).max(100_000),
  resistance: z.number().int().min(-100_000).max(100_000),
  accuracy: z.number().int().min(-100_000).max(100_000),
  evasion: z.number().int().min(-100_000).max(100_000),
  criticalRating: z.number().int().min(-100_000).max(100_000),
  hasteRating: z.number().int().min(-100_000).max(100_000),
  movementSpeedBps: z.number().int().min(-9_000).max(20_000),
});

export const derivedCharacterStatsSchema = z.object({
  maxHp: z.number().finite().nonnegative().max(10_000_000),
  maxMp: z.number().finite().nonnegative().max(10_000_000),
  physicalAttack: z.number().finite().nonnegative().max(10_000_000),
  spellPower: z.number().finite().nonnegative().max(10_000_000),
  armor: z.number().finite().nonnegative().max(10_000_000),
  resistance: z.number().finite().nonnegative().max(10_000_000),
  accuracy: z.number().finite().nonnegative().max(1_000_000),
  evasion: z.number().finite().nonnegative().max(1_000_000),
  criticalChance: z.number().finite().min(0).max(1),
  hastePercent: z.number().finite().min(-0.9).max(10),
  moveSpeed: z.number().finite().positive().max(100),
  basicRange: z.number().finite().positive().max(100),
  basicAttackIntervalMs: z.number().finite().int().min(100).max(10_000),
});

export const itemRequirementsSchema = z.object({
  level: z.number().int().min(1).max(MAX_LEVEL),
  classes: z.array(z.enum(CLASS_IDS)).max(CLASS_IDS.length),
});

export const itemVisualSchema = z.object({
  icon: itemVisualKeySchema,
  model: itemVisualKeySchema,
  primaryColor: hexColorSchema,
  accentColor: hexColorSchema,
  scale: z.number().finite().min(0.25).max(4),
});

const baseDefinitionShape = {
  id: itemIdSchema,
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(4).max(240),
  lore: z.string().trim().min(4).max(320),
  grade: itemGradeSchema,
  rarity: itemRaritySchema,
  color: hexColorSchema,
  stackLimit: z.number().int().min(1).max(999),
  sellPrice: nonnegativeSafeInteger,
  tradeable: z.boolean(),
  stats: itemStatsSchema,
  requirements: itemRequirementsSchema,
  visual: itemVisualSchema,
};

const equippableShape = {
  slot: equipmentSlotSchema,
  allowedSlots: z.array(equipmentSlotSchema).min(1).max(2),
};

export const weaponItemDefinitionSchema = z.object({
  ...baseDefinitionShape,
  ...equippableShape,
  category: z.literal("weapon"),
  usable: z.literal(false),
  slot: z.literal("main_hand"),
  allowedSlots: z.tuple([z.literal("main_hand")]),
  weaponType: weaponTypeSchema,
  handedness: z.enum(["one_handed", "two_handed"]),
  range: z.number().finite().min(0.5).max(30),
  attackIntervalMs: z.number().int().min(250).max(5_000),
});

export const armorItemDefinitionSchema = z.object({
  ...baseDefinitionShape,
  ...equippableShape,
  category: z.literal("armor"),
  usable: z.literal(false),
  armorWeight: armorWeightSchema,
});

export const accessoryItemDefinitionSchema = z.object({
  ...baseDefinitionShape,
  ...equippableShape,
  category: z.literal("accessory"),
  usable: z.literal(false),
});

export const consumableEffectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("restore"),
    resource: z.enum(["hp", "mp"]),
    amount: z.number().int().positive().max(100_000),
  }),
  z.object({
    kind: z.literal("buff"),
    stats: itemStatsSchema,
    durationMs: z.number().int().min(1_000).max(86_400_000),
  }),
  z.object({
    kind: z.literal("return"),
    destinationId: z.literal("silent_wellspring_vale"),
    castTimeMs: z.number().int().min(1_000).max(60_000),
  }),
]);

export const consumableItemDefinitionSchema = z.object({
  ...baseDefinitionShape,
  category: z.literal("consumable"),
  usable: z.literal(true),
  cooldownMs: z.number().int().nonnegative().max(86_400_000),
  effect: consumableEffectSchema,
});

export const materialItemDefinitionSchema = z.object({
  ...baseDefinitionShape,
  category: z.literal("material"),
  usable: z.literal(false),
});

export const itemDefinitionSchema = z
  .discriminatedUnion("category", [
    weaponItemDefinitionSchema,
    armorItemDefinitionSchema,
    accessoryItemDefinitionSchema,
    consumableItemDefinitionSchema,
    materialItemDefinitionSchema,
  ])
  .superRefine((definition, context) => {
    const expectedLevel = calculateItemLevelRequirement(definition.grade, definition.rarity);
    if (definition.requirements.level !== expectedLevel) {
      context.addIssue({
        code: "custom",
        path: ["requirements", "level"],
        message: `Для грейда и редкости требуется уровень ${expectedLevel}`,
      });
    }
    if (new Set(definition.requirements.classes).size !== definition.requirements.classes.length) {
      context.addIssue({ code: "custom", path: ["requirements", "classes"], message: "Классы не должны повторяться" });
    }
    if (
      definition.category === "weapon" ||
      definition.category === "armor" ||
      definition.category === "accessory"
    ) {
      const allowedSlots: readonly EquipmentSlot[] = definition.allowedSlots;
      if (definition.stackLimit !== 1) {
        context.addIssue({ code: "custom", path: ["stackLimit"], message: "Снаряжение не складывается в стопки" });
      }
      if (!allowedSlots.includes(definition.slot)) {
        context.addIssue({ code: "custom", path: ["allowedSlots"], message: "Основной слот должен быть разрешён" });
      }
      if (new Set(allowedSlots).size !== allowedSlots.length) {
        context.addIssue({ code: "custom", path: ["allowedSlots"], message: "Слоты не должны повторяться" });
      }
    }
  });

export const itemInstanceSchema = z
  .object({
    instanceId: z.string().uuid(),
    itemId: itemIdSchema,
    quantity: positiveSafeInteger,
    enhancementLevel: z.number().int().min(0).max(MAX_ENHANCEMENT_LEVEL),
    equippedSlot: equipmentSlotSchema.nullable(),
    bound: z.boolean(),
    acquiredAt: z.string().datetime({ offset: true }),
  })
  .superRefine((instance, context) => {
    const definition = getItem(instance.itemId);
    if (instance.quantity > definition.stackLimit) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: `Количество превышает лимит стопки (${definition.stackLimit})`,
      });
    }
    if (isEquippableItem(definition)) {
      const allowedSlots: readonly EquipmentSlot[] = definition.allowedSlots;
      if (instance.quantity !== 1) {
        context.addIssue({ code: "custom", path: ["quantity"], message: "Снаряжение не складывается в стопки" });
      }
      if (instance.enhancementLevel > getMaxEnhancementLevel(definition)) {
        context.addIssue({
          code: "custom",
          path: ["enhancementLevel"],
          message: "Уровень усиления недоступен для этого грейда",
        });
      }
      if (instance.equippedSlot !== null && !allowedSlots.includes(instance.equippedSlot)) {
        context.addIssue({ code: "custom", path: ["equippedSlot"], message: "Предмет нельзя экипировать в этот слот" });
      }
    } else if (instance.enhancementLevel !== 0 || instance.equippedSlot !== null) {
      context.addIssue({
        code: "custom",
        path: instance.enhancementLevel !== 0 ? ["enhancementLevel"] : ["equippedSlot"],
        message: "Этот предмет нельзя экипировать или усиливать",
      });
    }
  });

export const equipmentLoadoutSchema = z
  .partialRecord(equipmentSlotSchema, itemInstanceSchema)
  .superRefine((equipment, context) => {
    const seen = new Set<string>();
    for (const [slot, instance] of Object.entries(equipment)) {
      if (!instance) continue;
      if (seen.has(instance.instanceId)) {
        context.addIssue({ code: "custom", path: [slot], message: "Экземпляр уже занимает другой слот" });
      }
      seen.add(instance.instanceId);
      if (instance.equippedSlot !== slot) {
        context.addIssue({ code: "custom", path: [slot], message: "Слот экипировки экземпляра не совпадает" });
      }
    }

    const mainHand = equipment.main_hand;
    if (mainHand) {
      const definition = getItem(mainHand.itemId);
      if (
        definition.category === "weapon" &&
        definition.handedness === "two_handed" &&
        equipment.off_hand
      ) {
        context.addIssue({
          code: "custom",
          path: ["off_hand"],
          message: "Вторая рука занята двуручным оружием",
        });
      }
    }
  });

export const inventoryViewSchema = z
  .object({
    items: z.array(itemInstanceSchema).max(300),
    equipment: equipmentLoadoutSchema,
    gold: nonnegativeSafeInteger,
    capacity: z.number().int().min(1).max(300),
    usedSlots: z.number().int().min(0).max(300),
  })
  .superRefine((inventory, context) => {
    if (inventory.usedSlots > inventory.capacity) {
      context.addIssue({ code: "custom", path: ["usedSlots"], message: "Инвентарь переполнен" });
    }
    const ids = new Set<string>();
    for (let index = 0; index < inventory.items.length; index += 1) {
      const instance = inventory.items[index];
      if (!instance) continue;
      if (ids.has(instance.instanceId)) {
        context.addIssue({ code: "custom", path: ["items", index, "instanceId"], message: "Дубликат экземпляра" });
      }
      ids.add(instance.instanceId);
    }
  });

export const equipItemInputSchema = z.object({
  instanceId: z.string().uuid(),
  slot: equipmentSlotSchema.optional(),
});
export type EquipItemInput = z.infer<typeof equipItemInputSchema>;

export const unequipItemInputSchema = z.object({
  slot: equipmentSlotSchema,
});
export type UnequipItemInput = z.infer<typeof unequipItemInputSchema>;

export const useItemInputSchema = z.object({
  instanceId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100).optional(),
});
export type UseItemInput = z.infer<typeof useItemInputSchema>;

export const enhanceItemInputSchema = z.object({
  instanceId: z.string().uuid(),
});
export type EnhanceItemInput = z.infer<typeof enhanceItemInputSchema>;

export const equipItemSchema = equipItemInputSchema;
export const unequipItemSchema = unequipItemInputSchema;
export const useItemSchema = useItemInputSchema;
export const enhanceItemSchema = enhanceItemInputSchema;

export function validateItemCatalog(catalog: readonly unknown[] = ITEM_CATALOG): ItemDefinition[] {
  return z.array(itemDefinitionSchema).parse(catalog);
}
