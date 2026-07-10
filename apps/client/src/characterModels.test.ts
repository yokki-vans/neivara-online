import { CLASS_IDS, GENDER_IDS, RACE_IDS } from "@neivara/shared";
import { describe, expect, it } from "vitest";
import {
  CHARACTER_MODEL_VARIANTS,
  characterModelPath,
  characterPreviewLabel,
} from "./characterModels.js";

describe("character model matrix", () => {
  it("covers all 20 race, gender and class combinations with unique GLB paths", () => {
    expect(CHARACTER_MODEL_VARIANTS).toHaveLength(20);
    expect(new Set(CHARACTER_MODEL_VARIANTS.map(({ path }) => path))).toHaveLength(20);

    for (const race of RACE_IDS) {
      for (const gender of GENDER_IDS) {
        for (const classId of CLASS_IDS) {
          const path = characterModelPath(race, gender, classId);
          expect(path).toBe(`assets/models/humanoids/${race}/${gender}-${classId}.glb`);
          expect(CHARACTER_MODEL_VARIANTS).toContainEqual({ race, gender, classId, path });
        }
      }
    }
  });

  it("provides a descriptive accessible label for every model", () => {
    for (const { race, gender, classId } of CHARACTER_MODEL_VARIANTS) {
      const label = characterPreviewLabel(race, gender, classId);
      expect(label).toMatch(/^Предпросмотр:/);
      expect(label.length).toBeGreaterThan(25);
    }
  });
});
