import { describe, expect, it } from "vitest";
import { resolveApiUrl } from "./api.js";

describe("API URL resolution", () => {
  it("uses the browser origin for the unified production service", () => {
    expect(resolveApiUrl(undefined, true, "https://neivara.example/")).toBe(
      "https://neivara.example",
    );
  });

  it("keeps the local API default during Vite development", () => {
    expect(resolveApiUrl(undefined, false, "http://localhost:5173")).toBe(
      "http://localhost:3001",
    );
  });

  it("honors an explicit override for exceptional deployments", () => {
    expect(resolveApiUrl("https://api.example.test/", true, "https://game.example.test")).toBe(
      "https://api.example.test",
    );
  });

  it("permits HTTP only for local production previews", () => {
    expect(resolveApiUrl(undefined, true, "http://127.0.0.1:4173")).toBe(
      "http://127.0.0.1:4173",
    );
    expect(() => resolveApiUrl(undefined, true, "http://game.example.test")).toThrow(
      /https.*production/iu,
    );
  });

  it("requires a browser origin when production has no explicit override", () => {
    expect(() => resolveApiUrl(undefined, true, undefined)).toThrow(/browser origin/iu);
  });

  it.each([
    "ftp://api.example.test",
    "https://api.example.test/v1",
    "https://api.example.test?region=eu",
    "https://api.example.test#v1",
    "https://user:secret@api.example.test",
    "not a url",
  ])("rejects a non-origin API override: %s", (configured) => {
    expect(() => resolveApiUrl(configured, false, undefined)).toThrow(
      /origin-only http\(s\) url/iu,
    );
  });

  it("rejects an insecure explicit production API on a public host", () => {
    expect(() =>
      resolveApiUrl("http://api.example.test", true, "https://game.example.test"),
    ).toThrow(/https.*production/iu);
  });
});
