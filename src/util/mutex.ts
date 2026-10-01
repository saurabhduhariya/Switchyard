/**
 * Simple Promise-chain async mutex for serializing critical sections.
 */
export class Mutex {
  private current: Promise<void> = Promise.resolve();

  /**
   * Acquire lock. Resolves to a release function that must be called when done.
   */
  async acquire(): Promise<() => void> {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previous = this.current;
    this.current = previous.then(() => wait);

    await previous;
    return release;
  }

  /**
   * Run a function exclusively under the lock.
   */
  async runExclusive<T>(task: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }
}
