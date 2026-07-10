import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_INVENTORY_MUTATION_TTL_MS,
  canApplyInventoryMutationResponse,
  inventoryMutationFingerprint,
  isAmbiguousMutationFailure,
  isCurrentInventoryRead,
  isInventoryMutationReplayable,
  prepareInventoryMutation,
  readPersistedInventoryMutation,
  retryAmbiguousMutation,
  writePersistedInventoryMutation,
  type InventoryMutationScope,
  type InventoryMutationStorage,
} from "./inventoryReliability";

class MemoryStorage implements InventoryMutationStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const scope: InventoryMutationScope = { accountId: "account-a", characterId: "character-a" };

describe("inventory mutation reliability", () => {
  it("reuses the complete replay descriptor for a bounded ambiguous retry", async () => {
    const mutation = prepareInventoryMutation(
      null,
      { action: "use", instanceId: "item-1" },
      () => "stable-idempotency-key",
    ).mutation;
    const descriptors: typeof mutation[] = [];
    const operation = vi.fn(async (received: typeof mutation, attempt: number) => {
      descriptors.push(received);
      if (attempt === 1) throw { status: 0 };
      return "committed";
    });

    await expect(retryAmbiguousMutation(mutation, operation)).resolves.toBe("committed");
    expect(descriptors).toEqual([mutation, mutation]);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry a definitive HTTP response and bounds ambiguous failures", async () => {
    const mutation = prepareInventoryMutation(
      null,
      { action: "enhance", instanceId: "item-2" },
      () => "stable-idempotency-key",
    ).mutation;
    const rejected = vi.fn(async () => {
      throw { status: 409 };
    });
    await expect(retryAmbiguousMutation(mutation, rejected)).rejects.toEqual({ status: 409 });
    expect(rejected).toHaveBeenCalledTimes(1);

    const unavailable = vi.fn(async () => {
      throw { status: 503 };
    });
    await expect(retryAmbiguousMutation(mutation, unavailable, undefined, 2)).rejects.toEqual({ status: 503 });
    expect(unavailable).toHaveBeenCalledTimes(2);
    expect(isAmbiguousMutationFailure({ status: 503 })).toBe(true);
  });

  it("preserves a pending descriptor for the same intent and blocks a different intent", () => {
    const first = prepareInventoryMutation(
      null,
      { action: "use", instanceId: "item-1" },
      () => "created-once-idempotency-key",
    );
    const repeat = prepareInventoryMutation(
      first.mutation,
      { action: "use", instanceId: "item-1" },
      () => "must-not-run-idempotency-key",
    );
    const different = prepareInventoryMutation(
      first.mutation,
      { action: "enhance", instanceId: "item-2" },
      () => "must-not-run-idempotency-key",
    );

    expect(first.mutation).toMatchObject({
      action: "use",
      instanceId: "item-1",
      fingerprint: inventoryMutationFingerprint({ action: "use", instanceId: "item-1" }),
      key: "created-once-idempotency-key",
    });
    expect(repeat).toEqual({ blocked: false, mutation: first.mutation });
    expect(different).toEqual({ blocked: true, mutation: first.mutation });
  });
});

describe("persisted inventory mutation scope", () => {
  it("round-trips only within the same account and character scope", () => {
    const storage = new MemoryStorage();
    const now = 1_800_000_000_000;
    const mutation = prepareInventoryMutation(
      null,
      { action: "enhance", instanceId: "weapon-7" },
      () => "persisted-idempotency-key",
      now,
    ).mutation;

    expect(writePersistedInventoryMutation(storage, scope, mutation)).toBe(true);
    expect(readPersistedInventoryMutation(storage, scope, now + 1)).toEqual({
      status: "ready",
      mutation,
    });
    const serialized = JSON.parse([...storage.values.values()][0]!) as Record<string, unknown>;
    expect(serialized).toMatchObject({
      version: 2,
      accountId: scope.accountId,
      characterId: scope.characterId,
      action: "enhance",
      instanceId: "weapon-7",
      fingerprint: "enhance:weapon-7",
      key: "persisted-idempotency-key",
      createdAt: now,
      expiresAt: now + CLIENT_INVENTORY_MUTATION_TTL_MS,
    });
    expect(readPersistedInventoryMutation(
      storage,
      { ...scope, accountId: "account-b" },
      now + 1,
    )).toEqual({ status: "missing", mutation: null });
    expect(readPersistedInventoryMutation(
      storage,
      { ...scope, characterId: "character-b" },
      now + 1,
    )).toEqual({ status: "missing", mutation: null });
  });

  it("ignores and removes corrupt or internally mismatched records", () => {
    const storage = new MemoryStorage();
    const mutation = prepareInventoryMutation(
      null,
      { action: "use", instanceId: "potion-1" },
      () => "persisted-idempotency-key",
    ).mutation;
    writePersistedInventoryMutation(storage, scope, mutation);
    const [storageKey] = storage.values.keys();
    expect(storageKey).toBeDefined();

    storage.values.set(storageKey!, "{not-json");
    expect(readPersistedInventoryMutation(storage, scope)).toEqual({
      status: "invalid",
      mutation: null,
    });
    expect(storage.values.has(storageKey!)).toBe(false);

    writePersistedInventoryMutation(storage, scope, mutation);
    const serialized = JSON.parse(storage.values.get(storageKey!)!) as Record<string, unknown>;
    storage.values.set(storageKey!, JSON.stringify({ ...serialized, accountId: "account-b" }));
    expect(readPersistedInventoryMutation(storage, scope)).toEqual({
      status: "invalid",
      mutation: null,
    });
  });
});

describe("persisted inventory mutation replay window", () => {
  const now = 1_800_000_000_000;

  function persistedAt(createdAt: number): {
    storage: MemoryStorage;
    mutation: ReturnType<typeof prepareInventoryMutation>["mutation"];
  } {
    const storage = new MemoryStorage();
    const mutation = prepareInventoryMutation(
      null,
      { action: "use", instanceId: "single-potion" },
      () => "time-bounded-idempotency-key",
      createdAt,
    ).mutation;
    writePersistedInventoryMutation(storage, scope, mutation);
    return { storage, mutation };
  }

  it("allows replay before, but never at or after, the 18-hour deadline", () => {
    const before = persistedAt(now);
    expect(readPersistedInventoryMutation(
      before.storage,
      scope,
      now + CLIENT_INVENTORY_MUTATION_TTL_MS - 1,
    )).toEqual({ status: "ready", mutation: before.mutation });
    expect(isInventoryMutationReplayable(
      before.mutation,
      now + CLIENT_INVENTORY_MUTATION_TTL_MS - 1,
    )).toBe(true);

    const atDeadline = persistedAt(now);
    expect(readPersistedInventoryMutation(
      atDeadline.storage,
      scope,
      now + CLIENT_INVENTORY_MUTATION_TTL_MS,
    )).toEqual({ status: "expired", mutation: null });
    expect(isInventoryMutationReplayable(
      atDeadline.mutation,
      now + CLIENT_INVENTORY_MUTATION_TTL_MS,
    )).toBe(false);
    expect(atDeadline.storage.values.size).toBe(0);

    const after = persistedAt(now);
    expect(readPersistedInventoryMutation(
      after.storage,
      scope,
      now + CLIENT_INVENTORY_MUTATION_TTL_MS + 1,
    )).toEqual({ status: "expired", mutation: null });
    expect(after.storage.values.size).toBe(0);
  });

  it("quarantines malformed future timestamps instead of exposing a replay descriptor", () => {
    const future = persistedAt(now + 24 * 60 * 60 * 1_000);
    expect(readPersistedInventoryMutation(future.storage, scope, now)).toEqual({
      status: "invalid",
      mutation: null,
    });
    expect(future.storage.values.size).toBe(0);

    const malformedExpiry = persistedAt(now);
    const [storageKey] = malformedExpiry.storage.values.keys();
    const serialized = JSON.parse(malformedExpiry.storage.values.get(storageKey!)!) as Record<string, unknown>;
    malformedExpiry.storage.values.set(storageKey!, JSON.stringify({
      ...serialized,
      expiresAt: now + 30 * 24 * 60 * 60 * 1_000,
    }));
    expect(readPersistedInventoryMutation(malformedExpiry.storage, scope, now)).toEqual({
      status: "invalid",
      mutation: null,
    });
  });
});

describe("inventory response ordering", () => {
  it("rejects an older read and a read superseded by a state revision", () => {
    expect(isCurrentInventoryRead({ requestId: 1, revision: 3 }, 2, 3)).toBe(false);
    expect(isCurrentInventoryRead({ requestId: 2, revision: 3 }, 2, 4)).toBe(false);
    expect(isCurrentInventoryRead({ requestId: 2, revision: 4 }, 2, 4)).toBe(true);
  });

  it("allows a mutation response only while its starting revision is current", () => {
    expect(canApplyInventoryMutationResponse(7, 7)).toBe(true);
    expect(canApplyInventoryMutationResponse(7, 8)).toBe(false);
  });
});
