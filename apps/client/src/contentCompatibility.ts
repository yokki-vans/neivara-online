import {
  STARTER_ZONE,
  normalizeClassId,
  normalizeGenderId,
  normalizeRaceId,
  type CharacterSummary,
} from "@neivara/shared";

const LEGACY_STARTER_ZONE_NAMES = new Set(["Долина Тихих Истоков"]);

export { normalizeClassId, normalizeGenderId, normalizeRaceId };

/** Normalizes v0.2 roster payloads while a rolling server migration is in progress. */
export function normalizeCharacterSummary(character: CharacterSummary): CharacterSummary {
  const wire = character as CharacterSummary & { gender?: unknown };
  return {
    ...character,
    race: normalizeRaceId(wire.race),
    gender: normalizeGenderId(wire.gender),
    classId: normalizeClassId(wire.classId),
  };
}

/** Keeps a stale v0.2 snapshot from overriding the canonical Dawnmere HUD label. */
export function displayZoneName(zoneName: unknown): string {
  if (typeof zoneName !== "string" || zoneName.trim() === "") return STARTER_ZONE.name;
  const normalized = zoneName.trim();
  return LEGACY_STARTER_ZONE_NAMES.has(normalized) ? STARTER_ZONE.name : normalized;
}
