import { describe, expect, it } from "vitest";
import { isSceneDisposalError, shouldIgnoreDisposedSceneLoad } from "./sceneLoadErrors.js";

describe("Babylon asynchronous teardown errors", () => {
  it("recognizes direct and wrapped scene-disposal errors", () => {
    expect(isSceneDisposalError(new Error("Scene has been disposed"))).toBe(true);
    expect(
      isSceneDisposalError(new Error("GLB load failed", { cause: new Error("Scene is disposed") })),
    ).toBe(true);
    expect(isSceneDisposalError("Cannot attach mesh: scene was disposed")).toBe(true);
  });

  it("ignores disposal only after intentional teardown", () => {
    const disposal = new Error("Scene has been disposed");
    expect(shouldIgnoreDisposedSceneLoad(disposal, true)).toBe(true);
    expect(shouldIgnoreDisposedSceneLoad(disposal, false)).toBe(false);
    expect(shouldIgnoreDisposedSceneLoad(new Error("HTTP 503"), true)).toBe(false);
  });
});
