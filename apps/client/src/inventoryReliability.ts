export type IdempotentInventoryAction = "use" | "enhance";

export interface InventoryMutationScope {
  accountId: string;
  characterId: string;
}

export interface InventoryMutationIntent {
  action: IdempotentInventoryAction;
  instanceId: string;
}

export interface UncertainInventoryMutation extends InventoryMutationIntent {
  fingerprint: string;
  key: string;
  createdAt: number;
  expiresAt: number;
}

interface PersistedInventoryMutation extends UncertainInventoryMutation, InventoryMutationScope {
  version: 2;
}

export type PersistedInventoryMutationRead =
  | { status: "ready"; mutation: UncertainInventoryMutation }
  | { status: "missing" | "expired" | "invalid"; mutation: null };

export interface PreparedInventoryMutation {
  blocked: boolean;
  mutation: UncertainInventoryMutation;
}

export interface InventoryReadToken {
  requestId: number;
  revision: number;
}

export interface InventoryMutationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// The server currently retains idempotency results for 24 hours. The client stops
// replaying after 18 hours, leaving a six-hour margin for clock drift and rollout lag.
export const CLIENT_INVENTORY_MUTATION_TTL_MS = 18 * 60 * 60 * 1_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const INVENTORY_MUTATION_STORAGE_PREFIX = "neivara.inventory-mutation.v2";

export function inventoryMutationFingerprint(intent: InventoryMutationIntent): string {
  return `${intent.action}:${intent.instanceId}`;
}

function inventoryMutationStorageKey(scope: InventoryMutationScope): string {
  return [
    INVENTORY_MUTATION_STORAGE_PREFIX,
    encodeURIComponent(scope.accountId),
    encodeURIComponent(scope.characterId),
  ].join(":");
}

function isNonEmptyIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function parsePersistedInventoryMutation(
  value: unknown,
  scope: InventoryMutationScope,
): UncertainInventoryMutation | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<PersistedInventoryMutation>;
  if (
    candidate.version !== 2
    || candidate.accountId !== scope.accountId
    || candidate.characterId !== scope.characterId
    || (candidate.action !== "use" && candidate.action !== "enhance")
    || !isNonEmptyIdentifier(candidate.instanceId)
    || typeof candidate.key !== "string"
    || candidate.key.length < 16
    || candidate.key.length > 128
    || !Number.isSafeInteger(candidate.createdAt)
    || !Number.isSafeInteger(candidate.expiresAt)
    || candidate.createdAt! < 0
    || candidate.expiresAt! - candidate.createdAt! !== CLIENT_INVENTORY_MUTATION_TTL_MS
  ) return null;

  const intent: InventoryMutationIntent = {
    action: candidate.action,
    instanceId: candidate.instanceId,
  };
  const fingerprint = inventoryMutationFingerprint(intent);
  if (candidate.fingerprint !== fingerprint) return null;
  return {
    ...intent,
    fingerprint,
    key: candidate.key,
    createdAt: candidate.createdAt!,
    expiresAt: candidate.expiresAt!,
  };
}

export function isInventoryMutationReplayable(
  mutation: UncertainInventoryMutation,
  now = Date.now(),
): boolean {
  return Number.isSafeInteger(now)
    && Number.isSafeInteger(mutation.createdAt)
    && Number.isSafeInteger(mutation.expiresAt)
    && mutation.createdAt >= 0
    && mutation.expiresAt - mutation.createdAt === CLIENT_INVENTORY_MUTATION_TTL_MS
    && mutation.createdAt <= now + MAX_FUTURE_CLOCK_SKEW_MS
    && now < mutation.expiresAt;
}

export function readPersistedInventoryMutation(
  storage: InventoryMutationStorage,
  scope: InventoryMutationScope,
  now = Date.now(),
): PersistedInventoryMutationRead {
  const storageKey = inventoryMutationStorageKey(scope);
  try {
    const serialized = storage.getItem(storageKey);
    if (!serialized) return { status: "missing", mutation: null };
    const mutation = parsePersistedInventoryMutation(JSON.parse(serialized), scope);
    if (!mutation || mutation.createdAt > now + MAX_FUTURE_CLOCK_SKEW_MS) {
      storage.removeItem(storageKey);
      return { status: "invalid", mutation: null };
    }
    if (!isInventoryMutationReplayable(mutation, now)) {
      storage.removeItem(storageKey);
      return { status: "expired", mutation: null };
    }
    return { status: "ready", mutation };
  } catch {
    try {
      storage.removeItem(storageKey);
    } catch {
      // Storage may be unavailable; treat the record as not safely replayable.
    }
    return { status: "invalid", mutation: null };
  }
}

export function writePersistedInventoryMutation(
  storage: InventoryMutationStorage,
  scope: InventoryMutationScope,
  mutation: UncertainInventoryMutation | null,
): boolean {
  try {
    const storageKey = inventoryMutationStorageKey(scope);
    if (!mutation) {
      storage.removeItem(storageKey);
      return true;
    }
    storage.setItem(storageKey, JSON.stringify({
      version: 2,
      ...scope,
      ...mutation,
    } satisfies PersistedInventoryMutation));
    return true;
  } catch {
    return false;
  }
}

export function prepareInventoryMutation(
  current: UncertainInventoryMutation | null,
  intent: InventoryMutationIntent,
  createKey: () => string,
  now = Date.now(),
): PreparedInventoryMutation {
  const fingerprint = inventoryMutationFingerprint(intent);
  if (current) {
    return {
      blocked: current.fingerprint !== fingerprint,
      mutation: current,
    };
  }

  return {
    blocked: false,
    mutation: {
      ...intent,
      fingerprint,
      key: createKey(),
      createdAt: now,
      expiresAt: now + CLIENT_INVENTORY_MUTATION_TTL_MS,
    },
  };
}

export function isAmbiguousMutationFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && (status === 0 || status >= 500);
}

export async function retryAmbiguousMutation<T>(
  mutation: UncertainInventoryMutation,
  operation: (mutation: UncertainInventoryMutation, attempt: number) => Promise<T>,
  isAmbiguous: (error: unknown) => boolean = isAmbiguousMutationFailure,
  maxAttempts = 2,
): Promise<T> {
  const attempts = Number.isFinite(maxAttempts)
    ? Math.max(1, Math.floor(maxAttempts))
    : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(mutation, attempt);
    } catch (error) {
      if (!isAmbiguous(error) || attempt === attempts) throw error;
    }
  }

  throw new Error("Недостижимое состояние повторной операции");
}

export function isCurrentInventoryRead(
  token: InventoryReadToken,
  latestRequestId: number,
  currentRevision: number,
): boolean {
  return token.requestId === latestRequestId && token.revision === currentRevision;
}

export function canApplyInventoryMutationResponse(
  revisionAtRequestStart: number,
  currentRevision: number,
): boolean {
  return revisionAtRequestStart === currentRevision;
}
