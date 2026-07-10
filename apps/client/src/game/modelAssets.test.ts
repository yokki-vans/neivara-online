import type { Scene } from "@babylonjs/core/scene.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NeivaraModelLibrary } from "./modelAssets.js";

describe("Neivara model manifest loading", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("revalidates the manifest once per library instead of force-caching a release", async () => {
    vi.stubGlobal("window", {
      location: {
        href: "https://play.neivara.example/characters/create",
        origin: "https://play.neivara.example",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "test", assets: [] }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const library = new NeivaraModelLibrary(
      {} as Scene,
      "https://play.neivara.example/assets/models/",
    );
    await library.getManifest();
    await library.getManifest();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://play.neivara.example/assets/models/manifest.json"),
      { cache: "no-cache" },
    );
  });

  it("does not pin a failed manifest request, allowing preview retry", async () => {
    vi.stubGlobal("window", {
      location: {
        href: "https://play.neivara.example/characters/create",
        origin: "https://play.neivara.example",
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "retry", assets: [] })));
    vi.stubGlobal("fetch", fetchMock);
    const library = new NeivaraModelLibrary(
      {} as Scene,
      "https://play.neivara.example/assets/models/",
    );

    await expect(library.getManifest()).rejects.toThrow("HTTP 503");
    await expect(library.getManifest()).resolves.toMatchObject({ version: "retry" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
