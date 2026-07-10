import { describe, expect, it } from "vitest";
import { levelFromTotalXp, xpProgress, xpRequiredForLevel } from "./progression.js";

describe("progression", () => {
  it("starts at level one", () => {
    expect(levelFromTotalXp(0)).toBe(1);
    expect(xpProgress(0)).toEqual({ level: 1, current: 0, required: 100 });
  });

  it("advances exactly at the threshold", () => {
    const first = xpRequiredForLevel(1);
    expect(levelFromTotalXp(first - 1)).toBe(1);
    expect(levelFromTotalXp(first)).toBe(2);
  });

  it("does not accept negative XP", () => {
    expect(levelFromTotalXp(-500)).toBe(1);
  });
});
