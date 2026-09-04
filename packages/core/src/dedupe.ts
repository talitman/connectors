export interface EventDeduplicatorOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

/** Bounded LRU set with TTL. No timers; expiry is checked on access. */
export class EventDeduplicator {
  private readonly entries = new Map<string, number>();
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
    const expiresAt = this.entries.get(id);
    if (expiresAt !== undefined) {
      this.entries.delete(id);
      if (expiresAt > now) {
        this.entries.set(id, now + this.ttlMs);
        return true;
      }
    }
    this.entries.set(id, now + this.ttlMs);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return false;
  }

  get size(): number {
    return this.entries.size;
  }
}
