export type StorageMode = "memory" | "postgres";

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
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function intValue(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawNodeEnv = env.NODE_ENV ?? "development";
  const nodeEnv =
    rawNodeEnv === "production" || rawNodeEnv === "test" ? rawNodeEnv : "development";
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  const storageMode = (env.STORAGE_MODE ?? (databaseUrl ? "postgres" : "memory")) as StorageMode;

  if (storageMode !== "memory" && storageMode !== "postgres") {
    throw new Error("STORAGE_MODE must be either memory or postgres");
  }
  if (storageMode === "postgres" && !databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_MODE=postgres");
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
  };
}
