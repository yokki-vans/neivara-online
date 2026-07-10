export type StorageMode = "memory" | "postgres";
export type TrustProxyConfig = false | number | string[];

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: string;
  jwtSecret: string;
  clientOrigins: string[];
  storageMode: StorageMode;
  databaseUrl: string | null;
  databaseSsl: boolean;
  autoMigrate: boolean;
  migrationLockTimeoutMs: number;
  trustProxy: TrustProxyConfig;
  realtimeMaxSocketsPerAccount: number;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function intValue(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedIntValue(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function trustProxyValue(
  value: string | undefined,
  nodeEnv: AppConfig["nodeEnv"],
): TrustProxyConfig {
  if (value === undefined || value.trim() === "") {
    // Railway terminates public traffic at one proxy hop. Limiting trust to that
    // hop prevents a client-supplied left-most X-Forwarded-For from becoming IP.
    return nodeEnv === "production" ? 1 : false;
  }

  const normalized = value.trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (["true", "yes", "on"].includes(normalized)) {
    throw new Error("TRUST_PROXY=true is unsafe; use a hop count or trusted IP/CIDR list");
  }
  if (/^\d+$/.test(normalized)) {
    return boundedIntValue("TRUST_PROXY", normalized, 1, 1, 10);
  }

  const trusted = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (trusted.length === 0 || trusted.length > 32) {
    throw new Error("TRUST_PROXY must contain 1 to 32 trusted IP/CIDR entries");
  }
  return trusted;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawNodeEnv = env.NODE_ENV ?? "development";
  if (
    rawNodeEnv !== "development" &&
    rawNodeEnv !== "test" &&
    rawNodeEnv !== "production"
  ) {
    throw new Error("NODE_ENV must be development, test or production");
  }
  const nodeEnv = rawNodeEnv;
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  const storageMode = (env.STORAGE_MODE ?? (databaseUrl ? "postgres" : "memory")) as StorageMode;

  if (storageMode !== "memory" && storageMode !== "postgres") {
    throw new Error("STORAGE_MODE must be either memory or postgres");
  }
  if (storageMode === "postgres" && !databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_MODE=postgres");
  }
  if (nodeEnv === "production" && storageMode !== "postgres") {
    throw new Error("Production requires STORAGE_MODE=postgres and a durable DATABASE_URL");
  }

  const developmentSecret = "neivara-local-development-secret-change-me";
  const jwtSecret = env.JWT_SECRET ?? (nodeEnv === "production" ? "" : developmentSecret);
  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }

  const clientOrigins = (env.CLIENT_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);

  return {
    nodeEnv,
    host: env.HOST ?? "0.0.0.0",
    port: intValue(env.PORT, 3001),
    logLevel: env.LOG_LEVEL ?? (nodeEnv === "test" ? "silent" : "info"),
    jwtSecret,
    clientOrigins,
    storageMode,
    databaseUrl,
    databaseSsl: booleanValue(env.DATABASE_SSL, false),
    autoMigrate: booleanValue(env.AUTO_MIGRATE, true),
    migrationLockTimeoutMs: boundedIntValue(
      "MIGRATION_LOCK_TIMEOUT_MS",
      env.MIGRATION_LOCK_TIMEOUT_MS,
      10_000,
      500,
      120_000,
    ),
    trustProxy: trustProxyValue(env.TRUST_PROXY, nodeEnv),
    realtimeMaxSocketsPerAccount: boundedIntValue(
      "WS_MAX_SOCKETS_PER_ACCOUNT",
      env.WS_MAX_SOCKETS_PER_ACCOUNT,
      3,
      1,
      10,
    ),
  };
}
