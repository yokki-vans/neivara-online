import {
  SAFE_ENHANCEMENT_LEVEL,
  checkItemRequirements,
  getClass,
  getEnhancementCost,
  getEnhancementSuccessChanceBps,
  getItem,
  getMaxEnhancementLevel,
  type ClassId,
  type InventoryView,
  type ItemDefinition,
  type ItemInstance,
} from "@neivara/shared";

export interface EquipAvailability {
  allowed: boolean;
  reasons: readonly string[];
}

export function getEquipAvailability(
  definition: ItemDefinition,
  character: { level: number; classId: ClassId },
): EquipAvailability {
  const result = checkItemRequirements(definition, character);
  const reasons: string[] = [];

  if (result.failures.some((failure) => failure.code === "level")) {
    reasons.push(`Нужен ${definition.requirements.level} уровень`);
  }
  if (result.failures.some((failure) => failure.code === "class")) {
    const classNames = definition.requirements.classes.map((classId) => getClass(classId).name);
    reasons.push(`Подходит только: ${classNames.join(", ")}`);
  }
  if (result.failures.some((failure) => failure.code === "slot")) {
    reasons.push("Предмет нельзя поместить в выбранный слот");
  }
  if (result.failures.some((failure) => failure.code === "not_equippable")) {
    reasons.push("Этот предмет нельзя экипировать");
  }

  return { allowed: result.allowed, reasons };
}

export interface EnhancementPreview {
  currentLevel: number;
  nextLevel: number;
  maximumLevel: number;
  chanceBps: number;
  goldCost: number;
  catalystName: string;
  catalystRequired: number;
  catalystOwned: number;
  affordable: boolean;
  atMaximum: boolean;
  failureDescription: string;
}

export function getEnhancementPreview(
  item: ItemInstance,
  inventory: InventoryView,
): EnhancementPreview {
  const definition = getItem(item.itemId);
  const maximumLevel = getMaxEnhancementLevel(definition);
  const atMaximum = item.enhancementLevel >= maximumLevel;
  const cost = getEnhancementCost(definition, item.enhancementLevel);
  const catalystOwned = inventory.items
    .filter((candidate) => candidate.itemId === cost.catalystItemId)
    .reduce((total, candidate) => total + candidate.quantity, 0);

  return {
    currentLevel: item.enhancementLevel,
    nextLevel: Math.min(maximumLevel, item.enhancementLevel + 1),
    maximumLevel,
    chanceBps: getEnhancementSuccessChanceBps(definition, item.enhancementLevel),
    goldCost: cost.gold,
    catalystName: getItem(cost.catalystItemId).name,
    catalystRequired: cost.catalystQuantity,
    catalystOwned,
    affordable: !atMaximum
      && inventory.gold >= cost.gold
      && catalystOwned >= cost.catalystQuantity,
    atMaximum,
    failureDescription: item.enhancementLevel > SAFE_ENHANCEMENT_LEVEL
      ? `При неудаче уровень снизится до +${item.enhancementLevel - 1}; предмет не разрушится.`
      : "При неудаче уровень сохранится; предмет не разрушится.",
  };
}
