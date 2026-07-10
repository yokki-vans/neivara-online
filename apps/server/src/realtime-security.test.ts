import { describe, expect, it } from "vitest";
import {
  ActiveSocketRegistry,
  RealtimeRateGuard,
  TokenBucket,
} from "./realtime-security.js";

describe("realtime token buckets", () => {
  it("caps bursts and refills according to elapsed time", () => {
    let now = 1_000;
    const bucket = new TokenBucket(2, 2, () => now);
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    now += 500;
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  it("disconnects repeated event spam while allowing the configured burst", () => {
    let now = 5_000;
    const guard = new RealtimeRateGuard(() => now);
    for (let index = 0; index < 4; index += 1) {
      expect(guard.check("chat:send")).toEqual({ allowed: true, disconnect: false });
    }
    for (let violation = 1; violation <= 8; violation += 1) {
      expect(guard.check("chat:send")).toEqual({
        allowed: false,
        disconnect: violation === 8,
      });
    }

    now += 10_000;
    expect(guard.check("chat:send")).toEqual({ allowed: true, disconnect: false });
  });
});

describe("active realtime socket quotas", () => {
  it("limits sockets per account and atomically replaces the same character socket", () => {
    const registry = new ActiveSocketRegistry();
    expect(registry.reserve("s1", "a1", "c1", 2)).toEqual({
      accepted: true,
      replacesSocketId: null,
    });
    expect(registry.reserve("s2", "a1", "c2", 2).accepted).toBe(true);
    expect(registry.reserve("s3", "a1", "c3", 2).accepted).toBe(false);
    expect(registry.reserve("s4", "a1", "c1", 2)).toEqual({
      accepted: true,
      replacesSocketId: "s1",
    });

    registry.release("s1");
    expect(registry.reserve("s5", "a1", "c3", 2).accepted).toBe(false);
    registry.release("s4");
    expect(registry.reserve("s5", "a1", "c3", 2).accepted).toBe(true);
  });
});
