/**
 * Per-file write queue to prevent race conditions.
 * Ensures only one write operation per file at a time.
 */
export class FileWriteQueue {
  private queues = new Map<string, Promise<void>>();

  async enqueue(path: string, op: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(path) ?? Promise.resolve();

    // Chain the new operation after the previous one
    // Run even if previous failed to avoid deadlock
    const next = prev.then(op, op);

    this.queues.set(path, next);

    try {
      await next;
    } finally {
      // Clean up if this is still the current promise
      if (this.queues.get(path) === next) {
        this.queues.delete(path);
      }
    }
  }
}