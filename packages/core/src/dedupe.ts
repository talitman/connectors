export interface EventDeduplicatorOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

/** Bounded LRU set with TTL. No timers; expiry is checked on access. */
export class EventDeduplicator {
  private readonly entries = new Map<string, [number, boolean]>(); // [expiresAt, wasRefreshed]
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: EventDeduplicatorOptions = {}) {
    this.maxEntries = options.maxEntries ?? 5000;
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
  }

  /** Records the id. Returns false the first time it is seen within the TTL, true afterwards. */
  isDuplicate(id: string): boolean {
    const now = this.now();
    const entry = this.entries.get(id);
    if (entry !== undefined) {
      const [expiresAt] = entry;
      if (expiresAt > now) {
        this.entries.set(id, [now + this.ttlMs, true]);
        return true;
      }
    }
    this.entries.set(id, [now + this.ttlMs, false]);
    while (this.entries.size > this.maxEntries) {
      let toEvict: string | undefined;
      for (const [key, [, wasRefreshed]] of this.entries) {
        if (!wasRefreshed) {
          toEvict = key;
          break;
        }
      }
      if (toEvict === undefined) {
        toEvict = this.entries.keys().next().value;
      }
      if (toEvict === undefined) break;
      this.entries.delete(toEvict);
    }
    return false;
  }

  get size(): number {
    return this.entries.size;
  }
}
