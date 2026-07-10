import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplication, type Application } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryGameStore } from "./store/index.js";

const INDEX_MARKER = "<main id=\"railway-client\">Neivara unified hosting</main>";
const COMPRESSIBLE_PADDING = "x".repeat(4_096);

describe("same-origin Railway client hosting", () => {
  let root = "";
  let application: Application;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "neivara-client-"));
    await mkdir(path.join(root, "assets"));
    await mkdir(path.join(root, "assets", "models"));
    await writeFile(
      path.join(root, "index.html"),
      `<!doctype html><html><body>${INDEX_MARKER}<!--${COMPRESSIBLE_PADDING}--></body></html>`,
      "utf8",
    );
    await writeFile(
      path.join(root, "assets", "app-a1b2c3d4.js"),
      `export const ready=true;/*${COMPRESSIBLE_PADDING}*/`,
      "utf8",
    );
    await writeFile(path.join(root, "assets", "models", "manifest.json"), "{\"version\":1}", "utf8");
    await writeFile(path.join(root, "assets", "models", "human.glb"), "stable-model-path", "utf8");
    application = await createApplication({
      config: loadConfig({
        NODE_ENV: "test",
        STORAGE_MODE: "memory",
        JWT_SECRET: "test-secret-that-is-longer-than-thirty-two-characters",
        CLIENT_ORIGINS: "http://localhost:5173",
      }),
      store: new MemoryGameStore(),
      startWorld: false,
      clientDistPath: root,
    });
  });

  afterAll(async () => {
    await application.app.close();
    await rm(root, { recursive: true, force: true });
  });

  it("serves the Vite root and direct browser routes with security and no-cache headers", async () => {
    for (const url of ["/", "/characters/create", "/play/returning-hero"]) {
      const response = await application.app.inject({
        method: "GET",
        url,
        headers: { accept: "text/html,application/xhtml+xml" },
      });
      expect(response.statusCode, url).toBe(200);
      expect(response.body, url).toContain(INDEX_MARKER);
      expect(response.headers["content-type"], url).toMatch(/^text\/html/iu);
      expect(response.headers["cache-control"], url).toBe(
        "no-cache, no-store, must-revalidate",
      );
      expect(response.headers["x-content-type-options"], url).toBe("nosniff");
      expect(response.headers["content-security-policy"], url).toContain(
        "connect-src 'self' ws://localhost:5173",
      );
      expect(response.headers["content-security-policy"], url).not.toMatch(
        /connect-src[^;]*(?:\sws:|\swss:)(?:\s|;)/u,
      );
      expect(response.headers["content-security-policy"], url).toContain("worker-src 'self' blob:");
      expect(response.headers["x-ratelimit-limit"], url).toBeUndefined();
    }
  });

  it("serves immutable assets without consuming the API rate-limit budget", async () => {
    const asset = await application.app.inject({
      method: "GET",
      url: "/assets/app-a1b2c3d4.js",
    });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("ready=true");
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(asset.headers["x-ratelimit-limit"]).toBeUndefined();

    const catalog = await application.app.inject({ method: "GET", url: "/v1/catalog" });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.headers["x-ratelimit-limit"]).toBe("180");
  });

  it("compresses HTML and JavaScript but leaves GLB model payloads alone", async () => {
    for (const url of ["/", "/assets/app-a1b2c3d4.js"]) {
      const response = await application.app.inject({
        method: "GET",
        url,
        headers: { accept: "text/html,*/*", "accept-encoding": "gzip" },
      });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers["content-encoding"], url).toBe("gzip");
      expect(response.headers.vary, url).toContain("accept-encoding");
    }

    const model = await application.app.inject({
      method: "GET",
      url: "/assets/models/human.glb",
      headers: { "accept-encoding": "gzip" },
    });
    expect(model.statusCode).toBe(200);
    expect(model.headers["content-encoding"]).toBeUndefined();
  });

  it("revalidates mutable manifests and stable model paths instead of caching them forever", async () => {
    for (const url of ["/assets/models/manifest.json", "/assets/models/human.glb"]) {
      const response = await application.app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers["cache-control"], url).not.toContain("immutable");
      expect(response.headers["etag"], url).toBeDefined();
    }
    const manifest = await application.app.inject({
      method: "GET",
      url: "/assets/models/manifest.json",
    });
    expect(manifest.headers["cache-control"]).toBe("no-cache, no-store, must-revalidate");
    const model = await application.app.inject({
      method: "GET",
      url: "/assets/models/human.glb",
    });
    expect(model.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
  });

  it("never turns API, health, socket or asset misses into the SPA shell", async () => {
    for (const url of [
      "/v1/not-a-route",
      "/healthz/not-a-route",
      "/readyz/not-a-route",
      "/socket.io/not-a-route",
      "/assets/missing.js",
    ]) {
      const response = await application.app.inject({
        method: "GET",
        url,
        headers: { accept: "text/html" },
      });
      expect(response.statusCode, url).toBe(404);
      expect(response.headers["content-type"], url).toMatch(/^application\/json/iu);
      expect(response.json(), url).toEqual({
        error: "not_found",
        message: "Ресурс не найден",
      });
      expect(response.body, url).not.toContain(INDEX_MARKER);
    }

    const nonBrowser = await application.app.inject({
      method: "GET",
      url: "/characters/create",
      headers: { accept: "application/json" },
    });
    expect(nonBrowser.statusCode).toBe(404);
    expect(nonBrowser.headers["content-type"]).toMatch(/^application\/json/iu);
  });
});
