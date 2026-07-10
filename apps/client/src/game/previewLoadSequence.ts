/**
 * Monotonic guard for asynchronous preview swaps. A stale load may finish, but
 * it can never replace the model selected by a newer request or a remounted scene.
 */
export class PreviewLoadSequence {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(ticket: number): boolean {
    return ticket === this.generation;
  }

  cancel(ticket: number): void {
    if (this.isCurrent(ticket)) this.generation += 1;
  }

  cancelAll(): void {
    this.generation += 1;
  }
}
