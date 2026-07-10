import { PROTOCOL_VERSION } from "@neivara/shared";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication, type Application } from "./app.js";
import { loadConfig } from "./config.js";

const applications: Application[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function listeningApplication(): Promise<{ application: Application; origin: string }> {
  const application = await createApplication({
    config: loadConfig({
      NODE_ENV: "test",
      STORAGE_MODE: "memory",
      JWT_SECRET: "test-secret-that-is-longer-than-thirty-two-characters",
      CLIENT_ORIGINS: "http://localhost:5173",
      TRUST_PROXY: "false",
    }),
    startWorld: false,
  });
  applications.push(application);
  await application.app.listen({ host: "127.0.0.1", port: 0 });
  const address = application.app.server.address() as AddressInfo;
  return { application, origin: `http://127.0.0.1:${address.port}` };
}

describe("pre-auth Engine.IO handshake gate", () => {
  it("rejects an unauthenticated 185-request polling flood before sessions accumulate", async () => {
    const { origin } = await listeningApplication();
    const statuses = await Promise.all(
      Array.from({ length: 185 }, async (_unused, index) => {
        const response = await fetch(
          `${origin}/socket.io/?EIO=4&transport=polling&t=${index}`,
          {
            headers: {
              origin: "http://localhost:5173",
              // Must not create 185 independent buckets when TRUST_PROXY=false.
              "x-forwarded-for": `198.51.100.${(index % 250) + 1}`,
            },
          },
        );
        return response.status;
      }),
    );

    expect(statuses.filter((status) => status === 200).length).toBeLessThanOrEqual(8);
    expect(statuses.filter((status) => status === 403).length).toBeGreaterThan(0);
    expect(statuses).not.toEqual(Array.from({ length: 185 }, () => 200));
  }, 15_000);

  it("still admits and authenticates a normal websocket client", async () => {
    const { application, origin } = await listeningApplication();
    const registration = await application.app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "HandshakeUser", password: "strong-password" },
    });
    const { token } = registration.json<{ token: string }>();
    const created = await application.app.inject({
      method: "POST",
      url: "/v1/characters",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "СтражРубежа", race: "erim", classId: "warbound" },
    });
    const characterId = created.json<{ character: { id: string } }>().character.id;

    const socket = connect(origin, {
      autoConnect: false,
      transports: ["websocket"],
      auth: { token, characterId, protocolVersion: PROTOCOL_VERSION },
      extraHeaders: { origin: "http://localhost:5173" },
    });
    sockets.push(socket);
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("world:ready timeout")), 3_000);
      socket.once("world:ready", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("connect_error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    socket.connect();
    await expect(ready).resolves.toBeUndefined();
    expect(socket.connected).toBe(true);
  });
});
