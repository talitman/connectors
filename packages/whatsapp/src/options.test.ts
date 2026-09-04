import { ConfigError, MemoryStore } from '@connectors/core';
import { describe, expect, it } from 'vitest';
import { resolveOptions } from './options.js';

describe('resolveOptions', () => {
  it('fills defaults', () => {
    const r = resolveOptions({ accountId: 'a', storage: { auth: new MemoryStore() } });
    expect(r.pairing).toEqual({ method: 'qr' });
    expect(r.reconnect).toEqual({ initialDelayMs: 1000, maxDelayMs: 60_000, maxAttempts: null });
    expect(r.includeOwnMessages).toBe(true);
    expect(r.includeHistory).toBe(false);
    expect(r.includeRaw).toBe(false);
    expect(r.dedupe).toEqual({ maxEntries: 5000, ttlMs: 600_000 });
    expect(r.mediaCache).toEqual({ maxEntries: 5000, ttlMs: 86_400_000 });
    expect(r.markOnlineOnConnect).toBe(false);
    expect(r.fetchLatestVersion).toBe(false);
    expect(r.providerLogLevel).toBe('warn');
    expect(r.storage.auth).toBeInstanceOf(MemoryStore);
  });

  it('keeps explicit values and partial nested objects', () => {
    const r = resolveOptions({
      accountId: 'a',
      storage: { auth: new MemoryStore() },
      pairing: { method: 'code', phoneNumber: '972501234567' },
      reconnect: { maxAttempts: 3 },
      waWebVersion: [2, 3000, 1],
    });
    expect(r.pairing).toEqual({ method: 'code', phoneNumber: '972501234567' });
    expect(r.reconnect).toEqual({ initialDelayMs: 1000, maxDelayMs: 60_000, maxAttempts: 3 });
    expect(r.waWebVersion).toEqual([2, 3000, 1]);
  });

  it('rejects bad input with ConfigError', () => {
    expect(() => resolveOptions({ accountId: '', storage: { auth: new MemoryStore() } })).toThrow(
      ConfigError,
    );
    expect(() =>
      resolveOptions({
        accountId: 'a',
        storage: { auth: new MemoryStore() },
        pairing: { method: 'code', phoneNumber: '+972 50' },
      }),
    ).toThrow(ConfigError);
    expect(() => resolveOptions({ accountId: 'a', storage: { auth: {} as never } })).toThrow(
      ConfigError,
    );
  });
});
