/**
 * A small keyed FIFO used to serialize every durable operation for one character.
 * Different characters still run concurrently. Rejections never poison the tail.
 */
export class CharacterOperationQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(characterId: string, operation: () => T | Promise<T>): Promise<T> {
    const previous = this.tails.get(characterId) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current, () => current);
    this.tails.set(characterId, tail);

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(characterId) === tail) this.tails.delete(characterId);
    }
  }

  async drain(): Promise<void> {
    while (this.tails.size > 0) {
      await Promise.all([...this.tails.values()]);
    }
  }
}
