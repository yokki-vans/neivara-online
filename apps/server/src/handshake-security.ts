import type { IncomingMessage } from "node:http";
import proxyAddr from "@fastify/proxy-addr";
import type { TrustProxyConfig } from "./config.js";
import { TokenBucket } from "./realtime-security.js";

const RESERVATION = Symbol("neivara-engine-handshake-reservation");

export interface HandshakeAdmissionOptions {
  burst: number;
  refillPerSecond: number;
  maxPendingPerIp: number;
  maxSessionsPerIp: number;
  maxPendingGlobal: number;
  maxSessionsGlobal: number;
  pendingTtlMs: number;
  ipStateTtlMs: number;
  maxTrackedIps: number;
}

export const DEFAULT_HANDSHAKE_ADMISSION: HandshakeAdmissionOptions = {
  burst: 30,
  refillPerSecond: 10,
  maxPendingPerIp: 4,
  maxSessionsPerIp: 8,
  maxPendingGlobal: 128,
  maxSessionsGlobal: 2_000,
  pendingTtlMs: 10_000,
  ipStateTtlMs: 2 * 60_000,
  maxTrackedIps: 10_000,
};

interface IpState {
  bucket: TokenBucket;
  pending: number;
  active: number;
  lastSeenAt: number;
}

interface ReservationState {
  ip: string;
  phase: "pending" | "active";
  timeout: ReturnType<typeof setTimeout> | null;
}

export interface HandshakeAdmissionDecision {
  accepted: boolean;
  reason: "accepted" | "rate_limited" | "capacity";
  reservationId: number | null;
}

export function createRequestIpResolver(
  trustProxy: TrustProxyConfig,
): (request: IncomingMessage) => string {
  if (trustProxy === false) {
    return (request) => request.socket.remoteAddress ?? "unknown";
  }

  const trust =
    typeof trustProxy === "number"
      ? (_address: string, hop: number) => hop < trustProxy
      : proxyAddr.compile(trustProxy);
  return (request) => proxyAddr(request, trust);
}

export class HandshakeAdmissionController {
  private readonly ipStates = new Map<string, IpState>();
  private readonly reservations = new Map<number, ReservationState>();
  private nextReservationId = 1;
  private globalPending = 0;
  private globalActive = 0;
  private admissionCount = 0;

  constructor(
    private readonly options: HandshakeAdmissionOptions = DEFAULT_HANDSHAKE_ADMISSION,
    private readonly now: () => number = Date.now,
  ) {}

  admit(ip: string): HandshakeAdmissionDecision {
    const currentTime = this.now();
    this.admissionCount += 1;
    if (this.admissionCount % 256 === 0) this.prune(currentTime);

    let state = this.ipStates.get(ip);
    if (!state) {
      if (this.ipStates.size >= this.options.maxTrackedIps) {
        this.prune(currentTime);
        if (this.ipStates.size >= this.options.maxTrackedIps) {
          return { accepted: false, reason: "capacity", reservationId: null };
        }
      }
      state = {
        bucket: new TokenBucket(
          this.options.burst,
          this.options.refillPerSecond,
          this.now,
        ),
        pending: 0,
        active: 0,
        lastSeenAt: currentTime,
      };
      this.ipStates.set(ip, state);
    }
    state.lastSeenAt = currentTime;

    if (!state.bucket.take()) {
      return { accepted: false, reason: "rate_limited", reservationId: null };
    }
    if (
      state.pending >= this.options.maxPendingPerIp ||
      state.active + state.pending >= this.options.maxSessionsPerIp ||
      this.globalPending >= this.options.maxPendingGlobal ||
      this.globalActive + this.globalPending >= this.options.maxSessionsGlobal
    ) {
      return { accepted: false, reason: "capacity", reservationId: null };
    }

    const reservationId = this.nextReservationId;
    this.nextReservationId += 1;
    state.pending += 1;
    this.globalPending += 1;
    const timeout = setTimeout(() => this.release(reservationId), this.options.pendingTtlMs);
    timeout.unref?.();
    this.reservations.set(reservationId, { ip, phase: "pending", timeout });
    return { accepted: true, reason: "accepted", reservationId };
  }

  activate(reservationId: number): boolean {
    const reservation = this.reservations.get(reservationId);
    const state = reservation ? this.ipStates.get(reservation.ip) : undefined;
    if (!reservation || !state || reservation.phase !== "pending") return false;

    if (reservation.timeout) clearTimeout(reservation.timeout);
    reservation.timeout = null;
    reservation.phase = "active";
    state.pending -= 1;
    state.active += 1;
    state.lastSeenAt = this.now();
    this.globalPending -= 1;
    this.globalActive += 1;
    return true;
  }

  release(reservationId: number): void {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return;
    this.reservations.delete(reservationId);
    if (reservation.timeout) clearTimeout(reservation.timeout);

    const state = this.ipStates.get(reservation.ip);
    if (!state) return;
    if (reservation.phase === "pending") {
      state.pending -= 1;
      this.globalPending -= 1;
    } else {
      state.active -= 1;
      this.globalActive -= 1;
    }
    state.lastSeenAt = this.now();
  }

  close(): void {
    for (const reservation of this.reservations.values()) {
      if (reservation.timeout) clearTimeout(reservation.timeout);
    }
    this.reservations.clear();
    this.ipStates.clear();
    this.globalPending = 0;
    this.globalActive = 0;
  }

  private prune(currentTime: number): void {
    for (const [ip, state] of this.ipStates) {
      if (
        state.pending === 0 &&
        state.active === 0 &&
        currentTime - state.lastSeenAt >= this.options.ipStateTtlMs
      ) {
        this.ipStates.delete(ip);
      }
    }
  }
}

export class EngineHandshakeSecurity {
  private readonly resolveIp: (request: IncomingMessage) => string;
  private readonly admission: HandshakeAdmissionController;

  constructor(
    trustProxy: TrustProxyConfig,
    options: HandshakeAdmissionOptions = DEFAULT_HANDSHAKE_ADMISSION,
  ) {
    this.resolveIp = createRequestIpResolver(trustProxy);
    this.admission = new HandshakeAdmissionController(options);
  }

  allowRequest(
    request: IncomingMessage,
    callback: (error: string | null, accepted: boolean) => void,
  ): void {
    try {
      const decision = this.admission.admit(this.resolveIp(request));
      if (!decision.accepted || decision.reservationId === null) {
        callback("Слишком много игровых соединений", false);
        return;
      }
      Reflect.set(request, RESERVATION, decision.reservationId);
      callback(null, true);
    } catch {
      callback("Некорректный адрес игрового соединения", false);
    }
  }

  activate(request: IncomingMessage): boolean {
    const reservationId = Reflect.get(request, RESERVATION);
    return typeof reservationId === "number" && this.admission.activate(reservationId);
  }

  release(request: IncomingMessage): void {
    const reservationId = Reflect.get(request, RESERVATION);
    if (typeof reservationId === "number") this.admission.release(reservationId);
  }

  close(): void {
    this.admission.close();
  }
}
