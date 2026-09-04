import type { RawMessage } from '../client/types.js';

export interface RawMessageCacheOptions {
  maxEntries: number;
  ttlMs: number;
  now?: () => number;
}

/** Bounded LRU + TTL cache of raw messages. Memory only; never persisted. */
export class RawMessageCache {
  private readonly entries = new Map<string, { raw: RawMessage; expiresAt: number }>();
  private readonly now: () => number;

  constructor(private readonly options: RawMessageCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  set(id: string, raw: RawMessage): void {
    this.entries.delete(id);
    this.entries.set(id, { raw, expiresAt: this.now() + this.options.ttlMs });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get(id: string): RawMessage | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    if (entry.expiresAt <= this.now()) return undefined;
    this.entries.set(id, entry);
    return entry.raw;
  }

  get size(): number {
    return this.entries.size;
  }
}
