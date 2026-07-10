import {
  CLASS_IDS,
  GENDER_IDS,
  RACE_IDS,
  getClass,
  getGender,
  getRace,
  type ClassId,
  type GenderId,
  type RaceId,
} from "@neivara/shared";

export interface CharacterModelVariant {
  race: RaceId;
  gender: GenderId;
  classId: ClassId;
  path: string;
}

export function characterModelPath(
  race: RaceId,
  gender: GenderId,
  classId: ClassId,
): string {
  return `assets/models/humanoids/${race}/${gender}-${classId}.glb`;
}

export function characterPreviewLabel(
  race: RaceId,
  gender: GenderId,
  classId: ClassId,
): string {
  return `Предпросмотр: ${getRace(race).name}, ${getGender(gender).name.toLocaleLowerCase("ru")} пол, ${getClass(classId).name.toLocaleLowerCase("ru")}`;
}

export const CHARACTER_MODEL_VARIANTS: readonly CharacterModelVariant[] = RACE_IDS.flatMap(
  (race) =>
    GENDER_IDS.flatMap((gender) =>
      CLASS_IDS.map((classId) => ({
        race,
        gender,
        classId,
        path: characterModelPath(race, gender, classId),
      })),
    ),
);
