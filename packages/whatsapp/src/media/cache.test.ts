import { describe, expect, it } from 'vitest';
import type { RawMessage } from '../client/types.js';
import { RawMessageCache } from './cache.js';

const raw = (id: string): RawMessage => ({ key: { id, remoteJid: '1@s.whatsapp.net' } });

describe('RawMessageCache', () => {
  it('stores and retrieves by id', () => {
    const c = new RawMessageCache({ maxEntries: 10, ttlMs: 1000 });
    c.set('a', raw('a'));
    expect(c.get('a')?.key.id).toBe('a');
    expect(c.get('b')).toBeUndefined();
  });

  it('expires by ttl and evicts by LRU', () => {
    let now = 0;
    const c = new RawMessageCache({ maxEntries: 2, ttlMs: 100, now: () => now });
    c.set('a', raw('a'));
    c.set('b', raw('b'));
    c.get('a');
    c.set('c', raw('c'));
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBeDefined();
    now = 150;
    expect(c.get('a')).toBeUndefined();
    expect(c.size).toBe(1);
  });
});
