import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const productionBase = {
  NODE_ENV: "production",
  JWT_SECRET: "production-secret-that-is-longer-than-thirty-two-characters",
};

describe("production storage configuration", () => {
  it("fails closed without durable PostgreSQL storage", () => {
    expect(() =>
      loadConfig({ ...productionBase, NODE_ENV: "prodution" }),
    ).toThrow(/node_env must be/i);
    expect(() => loadConfig(productionBase)).toThrow(/production requires.*postgres/i);
    expect(() =>
      loadConfig({
        ...productionBase,
        STORAGE_MODE: "memory",
        DATABASE_URL: "postgresql://example.invalid/neivara",
      }),
    ).toThrow(/production requires.*postgres/i);
    expect(() =>
      loadConfig({ ...productionBase, STORAGE_MODE: "postgres" }),
    ).toThrow(/database_url is required/i);
  });

  it("accepts explicit PostgreSQL production configuration", () => {
    const config = loadConfig({
      ...productionBase,
      STORAGE_MODE: "postgres",
      DATABASE_URL: "postgresql://example.invalid/neivara",
    });

    expect(config.storageMode).toBe("postgres");
    expect(config.databaseUrl).toBe("postgresql://example.invalid/neivara");
    expect(config.trustProxy).toBe(1);
    expect(config.realtimeMaxSocketsPerAccount).toBe(3);
    expect(config.migrationLockTimeoutMs).toBe(10_000);
  });

  it("configures trusted proxies without accepting trust-all mode", () => {
    const base = {
      ...productionBase,
      STORAGE_MODE: "postgres",
      DATABASE_URL: "postgresql://example.invalid/neivara",
    };

    expect(loadConfig({ ...base, TRUST_PROXY: "2" }).trustProxy).toBe(2);
    expect(loadConfig({ ...base, TRUST_PROXY: "10.0.0.0/8,127.0.0.1" }).trustProxy).toEqual([
      "10.0.0.0/8",
      "127.0.0.1",
    ]);
    expect(loadConfig({ ...base, TRUST_PROXY: "false" }).trustProxy).toBe(false);
    expect(() => loadConfig({ ...base, TRUST_PROXY: "true" })).toThrow(/unsafe/i);
  });

  it("validates websocket and migration safety bounds", () => {
    const base = {
      ...productionBase,
      STORAGE_MODE: "postgres",
      DATABASE_URL: "postgresql://example.invalid/neivara",
    };
    expect(() => loadConfig({ ...base, WS_MAX_SOCKETS_PER_ACCOUNT: "0" })).toThrow(
      /ws_max_sockets_per_account/i,
    );
    expect(() => loadConfig({ ...base, MIGRATION_LOCK_TIMEOUT_MS: "100" })).toThrow(
      /migration_lock_timeout_ms/i,
    );
  });
});
