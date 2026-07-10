import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const productionBase = {
  NODE_ENV: "production",
  JWT_SECRET: "production-secret-that-is-longer-than-thirty-two-characters",
};

const durableProductionBase = {
  ...productionBase,
  STORAGE_MODE: "postgres",
  DATABASE_URL: "postgresql://example.invalid/neivara",
  RAILWAY_PUBLIC_DOMAIN: "neivara-production.up.railway.app",
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
    const config = loadConfig(durableProductionBase);

    expect(config.storageMode).toBe("postgres");
    expect(config.databaseUrl).toBe("postgresql://example.invalid/neivara");
    expect(config.trustProxy).toBe(1);
    expect(config.realtimeMaxSocketsPerAccount).toBe(3);
    expect(config.migrationLockTimeoutMs).toBe(10_000);
    expect(config.clientOrigins).toEqual([
      "https://neivara-production.up.railway.app",
    ]);
  });

  it("configures trusted proxies without accepting trust-all mode", () => {
    const base = durableProductionBase;

    expect(loadConfig({ ...base, TRUST_PROXY: "2" }).trustProxy).toBe(2);
    expect(loadConfig({ ...base, TRUST_PROXY: "10.0.0.0/8,127.0.0.1" }).trustProxy).toEqual([
      "10.0.0.0/8",
      "127.0.0.1",
    ]);
    expect(loadConfig({ ...base, TRUST_PROXY: "false" }).trustProxy).toBe(false);
    expect(() => loadConfig({ ...base, TRUST_PROXY: "true" })).toThrow(/unsafe/i);
  });

  it("automatically allows the Railway same-origin public domain", () => {
    const base = {
      ...productionBase,
      STORAGE_MODE: "postgres",
      DATABASE_URL: "postgresql://example.invalid/neivara",
      CLIENT_ORIGINS: "https://preview.example",
    };
    expect(
      loadConfig({
        ...base,
        RAILWAY_PUBLIC_DOMAIN: "neivara-production.up.railway.app",
      }).clientOrigins,
    ).toEqual([
      "https://preview.example",
      "https://neivara-production.up.railway.app",
    ]);
    expect(() =>
      loadConfig({ ...base, RAILWAY_PUBLIC_DOMAIN: "https://invalid.example" }),
    ).toThrow(/hostname without a url scheme/iu);
    expect(() =>
      loadConfig({ ...base, RAILWAY_PUBLIC_DOMAIN: "invalid.example:443" }),
    ).toThrow(/plain public hostname/iu);
  });

  it("uses localhost only outside production and fails closed without a public origin", () => {
    expect(loadConfig({ NODE_ENV: "development" }).clientOrigins).toEqual([
      "http://localhost:5173",
    ]);
    expect(loadConfig({ NODE_ENV: "test" }).clientOrigins).toEqual([
      "http://localhost:5173",
    ]);
    expect(() =>
      loadConfig({
        ...productionBase,
        STORAGE_MODE: "postgres",
        DATABASE_URL: "postgresql://example.invalid/neivara",
      }),
    ).toThrow(/production requires client_origins or railway_public_domain/iu);
  });

  it("normalizes, validates and deduplicates explicit client origins", () => {
    expect(
      loadConfig({
        ...durableProductionBase,
        CLIENT_ORIGINS:
          "https://GAME.example/, https://game.example, http://localhost:5173/",
      }).clientOrigins,
    ).toEqual([
      "https://game.example",
      "http://localhost:5173",
      "https://neivara-production.up.railway.app",
    ]);

    for (const invalidOrigin of [
      "*",
      "ftp://game.example",
      "https://game.example/client",
      "https://game.example?preview=1",
      "https://game.example#client",
      "https://user:password@game.example",
    ]) {
      expect(() =>
        loadConfig({ ...durableProductionBase, CLIENT_ORIGINS: invalidOrigin }),
      ).toThrow(/origin-only http\(s\) url/iu);
    }
  });

  it("validates websocket and migration safety bounds", () => {
    const base = durableProductionBase;
    expect(() => loadConfig({ ...base, WS_MAX_SOCKETS_PER_ACCOUNT: "0" })).toThrow(
      /ws_max_sockets_per_account/i,
    );
    expect(() => loadConfig({ ...base, MIGRATION_LOCK_TIMEOUT_MS: "100" })).toThrow(
      /migration_lock_timeout_ms/i,
    );
  });
});
