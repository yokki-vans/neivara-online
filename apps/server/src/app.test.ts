import { getClass } from "@neivara/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication, type Application } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryGameStore } from "./store/index.js";

const applications: Application[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function testApp(store: MemoryGameStore = new MemoryGameStore()): Promise<Application> {
  const application = await createApplication({
    config: loadConfig({
      NODE_ENV: "test",
      STORAGE_MODE: "memory",
      JWT_SECRET: "test-secret-that-is-longer-than-thirty-two-characters",
      CLIENT_ORIGINS: "http://localhost:5173",
    }),
    store,
    startWorld: false,
  });
  applications.push(application);
  return application;
}

async function productionTestApp(): Promise<Application> {
  const store = new MemoryGameStore();
  // The production guard checks the runtime store kind. Reuse the deterministic
  // in-memory implementation here while exercising the real production error handler.
  Object.defineProperty(store, "kind", { value: "postgres" });
  const application = await createApplication({
    config: loadConfig({
      NODE_ENV: "production",
      STORAGE_MODE: "postgres",
      DATABASE_URL: "postgresql://example.invalid/neivara",
      JWT_SECRET: "production-secret-that-is-longer-than-thirty-two-characters",
      CLIENT_ORIGINS: "https://game.neivara.example",
      LOG_LEVEL: "silent",
    }),
    store,
    startWorld: false,
    clientDistPath: null,
  });
  applications.push(application);
  return application;
}

describe("account and character API", () => {
  it("reports dependency readiness and fails with 503 when the store is unavailable", async () => {
    class CountingReadyStore extends MemoryGameStore {
      readinessChecks = 0;

      override async checkReadiness(): Promise<boolean> {
        this.readinessChecks += 1;
        return true;
      }
    }
    class UnreadyStore extends MemoryGameStore {
      override async checkReadiness(): Promise<boolean> {
        return false;
      }
    }
    class ThrowingStore extends MemoryGameStore {
      override async checkReadiness(): Promise<boolean> {
        throw new Error("dependency unavailable");
      }
    }
    const readyStore = new CountingReadyStore();
    const readyApplication = await testApp(readyStore);
    const unavailableApplication = await testApp(new UnreadyStore());
    const throwingApplication = await testApp(new ThrowingStore());

    const firstReady = await readyApplication.app.inject({ method: "GET", url: "/readyz" });
    const cachedReady = await readyApplication.app.inject({ method: "GET", url: "/readyz" });
    expect(firstReady.statusCode).toBe(200);
    expect(cachedReady.statusCode).toBe(200);
    expect(firstReady.headers["x-ratelimit-limit"]).toBe("300");
    expect(readyStore.readinessChecks).toBe(1);
    const unavailable = await unavailableApplication.app.inject({ method: "GET", url: "/readyz" });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({ status: "not_ready" });
    const throwing = await throwingApplication.app.inject({ method: "GET", url: "/readyz" });
    expect(throwing.statusCode).toBe(503);
    expect(throwing.json()).toEqual({ status: "not_ready" });
  });

  it("returns a stable production 403 for a disallowed HTTP Origin", async () => {
    const { app } = await productionTestApp();
    const rejected = await app.inject({
      method: "GET",
      url: "/v1/catalog",
      headers: { origin: "https://evil.example" },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toEqual({
      error: "request_error",
      message: "Доступ запрещён",
    });

    const allowed = await app.inject({
      method: "GET",
      url: "/v1/catalog",
      headers: { origin: "https://game.neivara.example" },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://game.neivara.example",
    );
  });

  it("publishes the Dawnmere zone and six monster definitions in the catalog", async () => {
    const { app } = await testApp();
    const response = await app.inject({ method: "GET", url: "/v1/catalog" });
    expect(response.statusCode).toBe(200);
    const catalog = response.json<{
      zone: { id: string; name: string };
      monsters: Array<{ kind: string; name: string; elite: boolean }>;
    }>();
    expect(catalog.zone).toMatchObject({
      id: "dawnmere_crossing",
      name: "Переправа Донмер",
    });
    expect(catalog.monsters).toHaveLength(6);
    expect(catalog.monsters.map(({ kind }) => kind)).toEqual([
      "thorn_prowler",
      "moss_mauler",
      "cave_shrieker",
      "ruin_sentinel",
      "bramble_boar",
      "ember_drake",
    ]);
  });

  it("registers, authenticates and creates a character", async () => {
    const { app } = await testApp();
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "RiverFox", password: "strong-password" },
    });
    expect(registration.statusCode).toBe(201);
    const auth = registration.json<{ token: string }>();

    const created = await app.inject({
      method: "POST",
      url: "/v1/characters",
      headers: { authorization: `Bearer ${auth.token}` },
      payload: { name: "Тайра", race: "human", gender: "female", classId: "warrior" },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<{ character: { hp: number; classId: string; gender: string } }>();
    expect(body.character.classId).toBe("warrior");
    expect(body.character.gender).toBe("female");
    expect(body.character.hp).toBe(getClass("warrior").baseHp);

    const list = await app.inject({
      method: "GET",
      url: "/v1/characters",
      headers: { authorization: `Bearer ${auth.token}` },
    });
    expect(list.statusCode).toBe(200);
    const listed = list.json<{ characters: Array<{ gender: string }> }>().characters;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.gender).toBe("female");
  });

  it("rejects duplicate account names case-insensitively", async () => {
    const { app } = await testApp();
    const first = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "Witness", password: "strong-password" },
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "witness", password: "strong-password" },
    });
    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(409);
  });

  it("serves authenticated inventory and item action routes", async () => {
    const { app } = await testApp();
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "LoadoutUser", password: "strong-password" },
    });
    const { token } = registration.json<{ token: string }>();
    const created = await app.inject({
      method: "POST",
      url: "/v1/characters",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Нейра", race: "light_elf", gender: "female", classId: "mage" },
    });
    const characterId = created.json<{ character: { id: string } }>().character.id;

    const inventory = await app.inject({
      method: "GET",
      url: `/v1/characters/${characterId}/inventory`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(inventory.statusCode).toBe(200);
    const body = inventory.json<{
      inventory: { items: Array<{ instanceId: string; itemId: string; quantity: number }> };
      equipment: { main_hand?: { itemId: string }; head?: { instanceId: string } };
      derivedStats: { maxHp: number; armor: number };
    }>();
    expect(body.inventory.items).toHaveLength(8);
    expect(body.equipment.main_hand?.itemId).toBe("emberglyph_staff");
    expect(body.derivedStats.armor).toBeGreaterThan(0);

    const tonic = body.inventory.items.find((item) => item.itemId === "field_tonic")!;
    const missingKey = await app.inject({
      method: "POST",
      url: `/v1/characters/${characterId}/inventory/${tonic.instanceId}/use`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json<{ error: string }>().error).toBe("idempotency_key_required");

    const invalidKey = await app.inject({
      method: "POST",
      url: `/v1/characters/${characterId}/inventory/${tonic.instanceId}/use`,
      headers: { authorization: `Bearer ${token}`, "idempotency-key": "short" },
      payload: {},
    });
    expect(invalidKey.statusCode).toBe(400);
    expect(invalidKey.json<{ error: string }>().error).toBe("invalid_idempotency_key");

    const used = await app.inject({
      method: "POST",
      url: `/v1/characters/${characterId}/inventory/${tonic.instanceId}/use`,
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "api-use-idempotency-0001",
      },
      payload: {},
    });
    expect(used.statusCode).toBe(200);
    expect(
      used
        .json<{ inventory: { items: Array<{ instanceId: string; quantity: number }> } }>()
        .inventory.items.find((item) => item.instanceId === tonic.instanceId)?.quantity,
    ).toBe(4);

    const replayed = await app.inject({
      method: "POST",
      url: `/v1/characters/${characterId}/inventory/${tonic.instanceId}/use`,
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "api-use-idempotency-0001",
      },
      payload: {},
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toEqual(used.json());

    const conflicting = await app.inject({
      method: "POST",
      url: `/v1/characters/${characterId}/inventory/${tonic.instanceId}/use`,
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "api-use-idempotency-0001",
      },
      payload: { quantity: 2 },
    });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json<{ error: string }>().error).toBe("idempotency_conflict");

    const coolingDown = await app.inject({
      method: "POST",
      url: `/v1/characters/${characterId}/inventory/${tonic.instanceId}/use`,
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "api-use-idempotency-0002",
      },
      payload: {},
    });
    expect(coolingDown.statusCode).toBe(429);
    expect(Number(coolingDown.headers["retry-after"])).toBeGreaterThanOrEqual(11);
    expect(Number(coolingDown.headers["retry-after"])).toBeLessThanOrEqual(12);
    expect(coolingDown.json<{ error: string; retryAfterMs: number }>()).toMatchObject({
      error: "cooldown_active",
      retryAfterMs: expect.any(Number),
    });

    const unequipped = await app.inject({
      method: "POST",
      url: `/v1/characters/${characterId}/equipment/head/unequip`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(unequipped.statusCode).toBe(200);
    expect(unequipped.json<{ equipment: { head?: unknown } }>().equipment.head).toBeUndefined();

    const preflight = await app.inject({
      method: "OPTIONS",
      url: `/v1/characters/${characterId}/inventory/${tonic.instanceId}/use`,
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type,idempotency-key",
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-headers"]).toContain("Idempotency-Key");
  });

  it("rate-limits high-value item mutation routes before expensive store work", async () => {
    const { app } = await testApp();
    const statusCodes: number[] = [];
    for (let index = 0; index < 13; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/characters/character-id/inventory/item-id/enhance",
      });
      statusCodes.push(response.statusCode);
    }

    expect(statusCodes.filter((statusCode) => statusCode === 401)).toHaveLength(12);
    expect(statusCodes.filter((statusCode) => statusCode === 429)).toHaveLength(1);
  });
});
