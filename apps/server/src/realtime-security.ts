export type RealtimeEventName =
  | "world:input"
  | "world:target"
  | "combat:use"
  | "loot:pickup"
  | "chat:send";

interface BucketDefinition {
  capacity: number;
  refillPerSecond: number;
}

const EVENT_BUCKETS: Record<RealtimeEventName, BucketDefinition> = {
  "world:input": { capacity: 50, refillPerSecond: 25 },
  "world:target": { capacity: 20, refillPerSecond: 10 },
  "combat:use": { capacity: 12, refillPerSecond: 6 },
  "loot:pickup": { capacity: 10, refillPerSecond: 4 },
  "chat:send": { capacity: 4, refillPerSecond: 0.5 },
};

export class TokenBucket {
  private tokens: number;
  private lastRefillAt: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.lastRefillAt = now();
  }

  take(cost = 1): boolean {
    const currentTime = this.now();
    const elapsedSeconds = Math.max(0, currentTime - this.lastRefillAt) / 1_000;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedSeconds * this.refillPerSecond,
    );
    this.lastRefillAt = currentTime;

    if (cost <= 0 || this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

export interface RateLimitDecision {
  allowed: boolean;
  disconnect: boolean;
}

export class RealtimeRateGuard {
  private readonly aggregate: TokenBucket;
  private readonly events: Record<RealtimeEventName, TokenBucket>;
  private violationWindowStartedAt: number;
  private violationCount = 0;

  constructor(private readonly now: () => number = Date.now) {
    this.aggregate = new TokenBucket(120, 60, now);
    this.events = Object.fromEntries(
      Object.entries(EVENT_BUCKETS).map(([event, definition]) => [
        event,
        new TokenBucket(definition.capacity, definition.refillPerSecond, now),
      ]),
    ) as Record<RealtimeEventName, TokenBucket>;
    this.violationWindowStartedAt = now();
  }

  check(event: RealtimeEventName): RateLimitDecision {
    const allowed = this.aggregate.take() && this.events[event].take();
    if (allowed) return { allowed: true, disconnect: false };

    const currentTime = this.now();
    if (currentTime - this.violationWindowStartedAt >= 10_000) {
      this.violationWindowStartedAt = currentTime;
      this.violationCount = 0;
    }
    this.violationCount += 1;
    return { allowed: false, disconnect: this.violationCount >= 8 };
  }
}

export interface SocketReservation {
  accepted: boolean;
  replacesSocketId: string | null;
}

interface SocketOwner {
  accountId: string;
  characterId: string;
}

export class ActiveSocketRegistry {
  private readonly accountSockets = new Map<string, Set<string>>();
  private readonly characterSockets = new Map<string, string>();
  private readonly socketOwners = new Map<string, SocketOwner>();

  reserve(
    socketId: string,
    accountId: string,
    characterId: string,
    maxSocketsPerAccount: number,
  ): SocketReservation {
    const replacesSocketId = this.characterSockets.get(characterId) ?? null;
    const accountSockets = this.accountSockets.get(accountId) ?? new Set<string>();
    const activeCount = accountSockets.size - (replacesSocketId ? 1 : 0);
    if (activeCount >= maxSocketsPerAccount) {
      return { accepted: false, replacesSocketId: null };
    }

    if (replacesSocketId) this.release(replacesSocketId);
    const currentAccountSockets = this.accountSockets.get(accountId) ?? new Set<string>();
    currentAccountSockets.add(socketId);
    this.accountSockets.set(accountId, currentAccountSockets);
    this.characterSockets.set(characterId, socketId);
    this.socketOwners.set(socketId, { accountId, characterId });
    return { accepted: true, replacesSocketId };
  }

  release(socketId: string): void {
    const owner = this.socketOwners.get(socketId);
    if (!owner) return;
    this.socketOwners.delete(socketId);

    const accountSockets = this.accountSockets.get(owner.accountId);
    accountSockets?.delete(socketId);
    if (accountSockets?.size === 0) this.accountSockets.delete(owner.accountId);
    if (this.characterSockets.get(owner.characterId) === socketId) {
      this.characterSockets.delete(owner.characterId);
    }
  }
}
