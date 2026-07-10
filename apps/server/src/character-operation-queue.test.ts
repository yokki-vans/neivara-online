import { describe, expect, it } from "vitest";
import { CharacterOperationQueue } from "./character-operation-queue.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("CharacterOperationQueue", () => {
  it("runs one character in FIFO order while allowing another character to progress", async () => {
    const queue = new CharacterOperationQueue();
    const gate = deferred();
    const order: string[] = [];

    const first = queue.run("same", async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
    });
    const second = queue.run("same", () => {
      order.push("second");
    });
    const other = queue.run("other", () => {
      order.push("other");
    });

    await other;
    expect(order).toEqual(["first:start", "other"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "other", "first:end", "second"]);
  });

  it("continues the character queue after a rejected operation", async () => {
    const queue = new CharacterOperationQueue();
    const failed = queue.run("character", () => {
      throw new Error("expected");
    });
    const next = queue.run("character", () => "completed");

    await expect(failed).rejects.toThrow("expected");
    await expect(next).resolves.toBe("completed");
  });
});
