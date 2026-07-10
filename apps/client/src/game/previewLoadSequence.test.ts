import { describe, expect, it } from "vitest";
import { PreviewLoadSequence } from "./previewLoadSequence.js";

describe("character preview load sequencing", () => {
  it("allows only the newest asynchronous selection to commit", () => {
    const sequence = new PreviewLoadSequence();
    const first = sequence.begin();
    const second = sequence.begin();

    expect(sequence.isCurrent(first)).toBe(false);
    expect(sequence.isCurrent(second)).toBe(true);
  });

  it("does not let stale cleanup cancel a newer load and supports retry", () => {
    const sequence = new PreviewLoadSequence();
    const stale = sequence.begin();
    const current = sequence.begin();

    sequence.cancel(stale);
    expect(sequence.isCurrent(current)).toBe(true);

    sequence.cancel(current);
    expect(sequence.isCurrent(current)).toBe(false);
    const retry = sequence.begin();
    expect(sequence.isCurrent(retry)).toBe(true);

    sequence.cancelAll();
    expect(sequence.isCurrent(retry)).toBe(false);
  });
});
