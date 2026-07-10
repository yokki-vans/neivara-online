import { IdempotencyConflictError, InvalidIdempotencyKeyError } from "./types.js";
import type {
  EnhanceItemResult,
  InventoryState,
  UseItemResult,
} from "./types.js";

export const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function assertIdempotencyKey(value: string): void {
  if (
    value.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    value.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !IDEMPOTENCY_KEY_PATTERN.test(value)
  ) {
    throw new InvalidIdempotencyKeyError(
      `Idempotency-Key должен содержать ${IDEMPOTENCY_KEY_MIN_LENGTH}–${IDEMPOTENCY_KEY_MAX_LENGTH} символов: латиницу, цифры, '.', '_', ':' или '-'`,
    );
  }
}

export function assertIdempotencyScope(
  storedAction: string,
  storedFingerprint: string,
  action: string,
  fingerprint: string,
): void {
  if (storedAction !== action || storedFingerprint !== fingerprint) {
    throw new IdempotencyConflictError(
      "Этот Idempotency-Key уже использован для другой операции или другого набора параметров",
    );
  }
}

export function useItemFingerprint(instanceId: string, quantity: number): string {
  return `instance=${instanceId};quantity=${quantity}`;
}

export function enhanceItemFingerprint(instanceId: string): string {
  return `instance=${instanceId}`;
}

export type StoredUseItemOutcome = Omit<UseItemResult, keyof InventoryState>;
export type StoredEnhanceItemOutcome = Omit<EnhanceItemResult, keyof InventoryState>;

export function compactUseItemResult(result: UseItemResult): StoredUseItemOutcome {
  const outcome: Partial<UseItemResult> = { ...result };
  delete outcome.inventory;
  delete outcome.equipmentStats;
  return outcome as StoredUseItemOutcome;
}

export function compactEnhanceItemResult(result: EnhanceItemResult): StoredEnhanceItemOutcome {
  const outcome: Partial<EnhanceItemResult> = { ...result };
  delete outcome.inventory;
  delete outcome.equipmentStats;
  return outcome as StoredEnhanceItemOutcome;
}

export function hydrateUseItemResult(
  outcome: StoredUseItemOutcome,
  state: InventoryState,
): UseItemResult {
  return { ...outcome, ...state };
}

export function hydrateEnhanceItemResult(
  outcome: StoredEnhanceItemOutcome,
  state: InventoryState,
): EnhanceItemResult {
  return { ...outcome, ...state };
}
