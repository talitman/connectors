import { describe, expect, it } from 'vitest';
import { EventDeduplicator } from './dedupe.js';

describe('EventDeduplicator', () => {
  it('reports the first sight as new and later sights as duplicates', () => {
    const d = new EventDeduplicator();
    expect(d.isDuplicate('a')).toBe(false);
    expect(d.isDuplicate('a')).toBe(true);
    expect(d.isDuplicate('b')).toBe(false);
  });

  it('expires entries after ttlMs', () => {
    let now = 0;
    const d = new EventDeduplicator({ ttlMs: 100, now: () => now });
    expect(d.isDuplicate('a')).toBe(false);
    now = 99;
    expect(d.isDuplicate('a')).toBe(true);
    now = 250;
    expect(d.isDuplicate('a')).toBe(false);
  });

  it('evicts the least recently seen entry beyond maxEntries', () => {
    const d = new EventDeduplicator({ maxEntries: 2 });
    d.isDuplicate('a');
    d.isDuplicate('b');
    d.isDuplicate('a'); // refresh a, b is now oldest
    d.isDuplicate('c'); // evicts b
    expect(d.size).toBe(2);
    expect(d.isDuplicate('b')).toBe(false);
    expect(d.isDuplicate('a')).toBe(true);
  });
});
