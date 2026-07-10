import { getClass } from "@neivara/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication, type Application } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryGameStore } from "./store/index.js";

const applications: Application[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function testApp(): Promise<Application> {
  const application = await createApplication({
    config: loadConfig({
      NODE_ENV: "test",
      STORAGE_MODE: "memory",
      JWT_SECRET: "test-secret-that-is-longer-than-thirty-two-characters",
      CLIENT_ORIGINS: "http://localhost:5173",
    }),
    store: new MemoryGameStore(),
    startWorld: false,
  });
  applications.push(application);
  return application;
}

describe("account and character API", () => {
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
      payload: { name: "Тайра", race: "erim", classId: "warbound" },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<{ character: { hp: number; classId: string } }>();
    expect(body.character.classId).toBe("warbound");
    expect(body.character.hp).toBe(getClass("warbound").baseHp);

    const list = await app.inject({
      method: "GET",
      url: "/v1/characters",
      headers: { authorization: `Bearer ${auth.token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ characters: unknown[] }>().characters).toHaveLength(1);
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
});
