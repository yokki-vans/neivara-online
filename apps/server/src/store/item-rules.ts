import {
  aggregateEquipmentStats,
  createEmptyItemStats,
  getEnhancedItemStats,
  getItem,
  isConsumableItem,
  isEquippableItem,
  type ConsumableEffect,
  type EquipmentLoadout,
  type EquipmentSlot,
  type ItemDefinition,
  type ItemId,
  type ItemInstance,
  type ItemStatBlock,
} from "@neivara/shared";
import { InvalidOperationError } from "./types.js";

export const INVENTORY_CAPACITY = 48;

export function emptyItemStats(): ItemStatBlock {
  return createEmptyItemStats();
}

export function itemStatsForInstance(instance: ItemInstance): ItemStatBlock {
  return getEnhancedItemStats(instance.itemId, instance.enhancementLevel);
}

export function equipmentStats(loadout: EquipmentLoadout): ItemStatBlock {
  return aggregateEquipmentStats(loadout);
}

export function equipmentSlotFor(
  definition: ItemDefinition,
  preferredSlot?: EquipmentSlot,
): EquipmentSlot {
  if (!isEquippableItem(definition)) {
    throw new InvalidOperationError("Этот предмет нельзя экипировать");
  }
  const allowed = definition.allowedSlots;
  if (preferredSlot && !allowed.includes(preferredSlot)) {
    throw new InvalidOperationError("Предмет нельзя поместить в выбранный слот");
  }
  return preferredSlot ?? definition.slot;
}

export function isStackable(itemId: ItemId): boolean {
  return getItem(itemId).stackLimit > 1;
}

export function consumableRestoration(itemId: ItemId): { hp: number; mp: number } | null {
  const definition = getItem(itemId);
  if (!isConsumableItem(definition) || definition.effect.kind !== "restore") return null;
  return definition.effect.resource === "hp"
    ? { hp: definition.effect.amount, mp: 0 }
    : { hp: 0, mp: definition.effect.amount };
}

export function consumableEffect(itemId: ItemId): ConsumableEffect | null {
  const definition = getItem(itemId);
  return isConsumableItem(definition) ? definition.effect : null;
}
