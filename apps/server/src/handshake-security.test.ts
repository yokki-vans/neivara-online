import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  HandshakeAdmissionController,
  createRequestIpResolver,
  type HandshakeAdmissionOptions,
} from "./handshake-security.js";

function request(remoteAddress: string, forwardedFor?: string): IncomingMessage {
  return {
    socket: { remoteAddress },
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
  } as unknown as IncomingMessage;
}

const limits: HandshakeAdmissionOptions = {
  burst: 3,
  refillPerSecond: 1,
  maxPendingPerIp: 1,
  maxSessionsPerIp: 2,
  maxPendingGlobal: 2,
  maxSessionsGlobal: 3,
  pendingTtlMs: 60_000,
  ipStateTtlMs: 60_000,
  maxTrackedIps: 10,
};

describe("Engine.IO client IP resolution", () => {
  it("ignores spoofed forwarding headers when no proxy is trusted", () => {
    const resolve = createRequestIpResolver(false);
    expect(resolve(request("203.0.113.10", "198.51.100.2"))).toBe("203.0.113.10");
  });

  it("uses the same trusted-hop semantics as Fastify", () => {
    const resolve = createRequestIpResolver(1);
    expect(resolve(request("10.0.0.5", "198.51.100.99, 203.0.113.8"))).toBe(
      "203.0.113.8",
    );
  });
});

describe("pre-auth handshake admission", () => {
  it("bounds pending and active sessions per IP and globally", () => {
    const controller = new HandshakeAdmissionController(limits);
    const first = controller.admit("ip-a");
    expect(first.accepted).toBe(true);
    expect(controller.admit("ip-a").accepted).toBe(false);
    expect(controller.activate(first.reservationId!)).toBe(true);

    const second = controller.admit("ip-a");
    expect(second.accepted).toBe(true);
    expect(controller.activate(second.reservationId!)).toBe(true);
    expect(controller.admit("ip-a").accepted).toBe(false);

    const third = controller.admit("ip-b");
    expect(third.accepted).toBe(true);
    expect(controller.activate(third.reservationId!)).toBe(true);
    expect(controller.admit("ip-c").reason).toBe("capacity");

    controller.release(first.reservationId!);
    expect(controller.admit("ip-c").accepted).toBe(true);
    controller.close();
  });

  it("rate-limits repeated handshakes even when capacity is released", () => {
    let now = 1_000;
    const controller = new HandshakeAdmissionController(limits, () => now);
    for (let index = 0; index < 3; index += 1) {
      const decision = controller.admit("ip-a");
      expect(decision.accepted).toBe(true);
      controller.release(decision.reservationId!);
    }
    expect(controller.admit("ip-a").reason).toBe("rate_limited");
    now += 1_000;
    expect(controller.admit("ip-a").accepted).toBe(true);
    controller.close();
  });
});
