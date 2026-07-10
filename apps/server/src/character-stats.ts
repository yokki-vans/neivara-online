import {
  ABILITIES,
  ITEMS,
  getClass,
  type ClassId,
  type DerivedCharacterStats,
  type ItemId,
  type ItemStatBlock,
} from "@neivara/shared";

export type { DerivedCharacterStats } from "@neivara/shared";

const CLASS_COMBAT_BASE: Readonly<
  Record<
    ClassId,
    Pick<
      DerivedCharacterStats,
      "physicalAttack" | "spellPower" | "armor" | "resistance" | "accuracy" | "evasion"
    >
  >
> = {
  warrior: {
    physicalAttack: 20,
    spellPower: 5,
    armor: 20,
    resistance: 10,
    accuracy: 85,
    evasion: 7,
  },
  mage: {
    physicalAttack: 7,
    spellPower: 23,
    armor: 7,
    resistance: 18,
    accuracy: 86,
    evasion: 7,
  },
};

export function deriveCharacterStats(
  classId: ClassId,
  level: number,
  equipment: ItemStatBlock,
  mainHandItemId?: ItemId | null,
): DerivedCharacterStats {
  const definition = getClass(classId);
  const base = CLASS_COMBAT_BASE[classId];
  const mainHand = mainHandItemId ? ITEMS[mainHandItemId] : null;
  const hastePercent = Math.min(0.35, equipment.hasteRating / 1_000);
  const baseAttackIntervalMs =
    mainHand?.category === "weapon" ? mainHand.attackIntervalMs : ABILITIES.basic.cooldownMs;
  return {
    maxHp: definition.baseHp + (level - 1) * 14 + equipment.maxHp,
    maxMp: definition.baseMp + (level - 1) * 9 + equipment.maxMp,
    physicalAttack: base.physicalAttack + level * 3 + equipment.physicalAttack,
    spellPower: base.spellPower + level * 3 + equipment.spellPower,
    armor: base.armor + level * 2 + equipment.armor,
    resistance: base.resistance + level * 2 + equipment.resistance,
    accuracy: base.accuracy + level + equipment.accuracy,
    evasion: base.evasion + Math.floor(level / 2) + equipment.evasion,
    criticalChance: Math.min(0.5, 0.08 + equipment.criticalRating / 1_000),
    hastePercent,
    moveSpeed: definition.moveSpeed * (1 + equipment.movementSpeedBps / 10_000),
    basicRange: mainHand?.category === "weapon" ? mainHand.range : definition.basicRange,
    basicAttackIntervalMs: Math.round(baseAttackIntervalMs / (1 + hastePercent)),
  };
}
