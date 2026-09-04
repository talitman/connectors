import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../storage/store.js';

export function runStoreContractTests(
  name: string,
  factory: () => Promise<KeyValueStore> | KeyValueStore,
): void {
  describe(`${name} contract`, () => {
    it('returns undefined for missing keys', async () => {
      const store = await factory();
      expect(await store.get('missing')).toBeUndefined();
    });

    it('round-trips binary values', async () => {
      const store = await factory();
      const bytes = new Uint8Array([0, 1, 2, 255, 128]);
      await store.set('a/b', bytes);
      expect(Buffer.from((await store.get('a/b')) ?? [])).toEqual(Buffer.from(bytes));
    });

    it('overwrites and deletes', async () => {
      const store = await factory();
      await store.set('k', new Uint8Array([1]));
      await store.set('k', new Uint8Array([2]));
      expect(await store.get('k')).toEqual(new Uint8Array([2]));
      await store.delete('k');
      expect(await store.get('k')).toBeUndefined();
      await store.delete('k'); // idempotent
    });

    it('lists keys by prefix and clears by prefix', async () => {
      const store = await factory();
      await store.set('auth/creds', new Uint8Array([1]));
      await store.set('auth/keys/pre-key/1', new Uint8Array([1]));
      await store.set('auth/keys/session/x@y', new Uint8Array([1]));
      await store.set('other/thing', new Uint8Array([1]));
      expect((await store.list('auth/')).sort()).toEqual([
        'auth/creds',
        'auth/keys/pre-key/1',
        'auth/keys/session/x@y',
      ]);
      expect((await store.list('auth/keys/')).sort()).toEqual([
        'auth/keys/pre-key/1',
        'auth/keys/session/x@y',
      ]);
      await store.clear('auth/keys/');
      expect((await store.list('auth/')).sort()).toEqual(['auth/creds']);
      expect(await store.get('other/thing')).toBeDefined();
      await store.clear('');
      expect(await store.list('')).toEqual([]);
    });

    it('handles keys with special characters in segments', async () => {
      const store = await factory();
      const key = 'keys/sender-key/1234@g.us::5551234:1/weird %20 .. name';
      await store.set(key, new Uint8Array([7]));
      expect(await store.get(key)).toEqual(new Uint8Array([7]));
      expect(await store.list('keys/')).toEqual([key]);
    });

    it('rejects invalid keys', async () => {
      const store = await factory();
      await expect(store.set('', new Uint8Array())).rejects.toThrow('Invalid store key');
      await expect(store.set('/leading', new Uint8Array())).rejects.toThrow('Invalid store key');
      await expect(store.set('a//b', new Uint8Array())).rejects.toThrow('Invalid store key');
      await expect(store.get('trailing/')).rejects.toThrow('Invalid store key');
    });
  });
}
