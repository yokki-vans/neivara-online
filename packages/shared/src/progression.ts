export const MAX_LEVEL = 60;

export function xpRequiredForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return Math.floor(100 * safeLevel ** 1.65);
}

export function levelFromTotalXp(totalXp: number): number {
  let remaining = Math.max(0, Math.floor(totalXp));
  let level = 1;

  while (level < MAX_LEVEL) {
    const required = xpRequiredForLevel(level);
    if (remaining < required) break;
    remaining -= required;
    level += 1;
  }

  return level;
}

export function xpProgress(totalXp: number): {
  level: number;
  current: number;
  required: number;
} {
  let current = Math.max(0, Math.floor(totalXp));
  let level = 1;

  while (level < MAX_LEVEL) {
    const required = xpRequiredForLevel(level);
    if (current < required) return { level, current, required };
    current -= required;
    level += 1;
  }

  return { level: MAX_LEVEL, current: 0, required: 0 };
}
