import { MemoryStore } from '@talitman/core';
import { describe, expect, it } from 'vitest';
import { createAuthStore } from './auth-state.js';

describe('createAuthStore', () => {
  it('returns undefined creds when nothing is stored', async () => {
    const auth = createAuthStore(new MemoryStore());
    expect(await auth.loadCreds()).toBeUndefined();
  });

  it('saves and loads creds with Buffers intact', async () => {
    const store = new MemoryStore();
    const auth = createAuthStore(store);
    await auth.saveCreds({ registered: true, noiseKey: { private: Buffer.from([9]) } });
    const creds = (await createAuthStore(store).loadCreds()) as {
      registered: boolean;
      noiseKey: { private: Buffer };
    };
    expect(creds.registered).toBe(true);
    expect(Buffer.from(creds.noiseKey.private)).toEqual(Buffer.from([9]));
    expect(await store.list('')).toEqual(['creds']);
  });

  it('sets, gets and deletes keys of any type', async () => {
    const store = new MemoryStore();
    const auth = createAuthStore(store);
    await auth.setKeys({
      'pre-key': { '1': { public: Buffer.from([1]) }, '2': { public: Buffer.from([2]) } },
      'lid-mapping': { '5551@s.whatsapp.net': '123@lid' },
      'some-future-type': { x: { anything: true } },
    });
    const pre = await auth.getKeys('pre-key', ['1', '2', '3']);
    expect(Object.keys(pre).sort()).toEqual(['1', '2']);
    expect(Buffer.from((pre['1'] as { public: Buffer }).public)).toEqual(Buffer.from([1]));
    expect(await auth.getKeys('lid-mapping', ['5551@s.whatsapp.net'])).toEqual({
      '5551@s.whatsapp.net': '123@lid',
    });
    expect(await auth.getKeys('some-future-type', ['x'])).toEqual({ x: { anything: true } });

    await auth.setKeys({ 'pre-key': { '1': null } });
    expect(await auth.getKeys('pre-key', ['1', '2'])).toEqual({
      '2': { public: expect.anything() as unknown },
    });
    expect((await store.list('keys/pre-key/')).sort()).toEqual(['keys/pre-key/2']);
  });

  it('clearKeys keeps creds; clear removes everything', async () => {
    const store = new MemoryStore();
    const auth = createAuthStore(store);
    await auth.saveCreds({ registered: true });
    await auth.setKeys({ session: { 'a@lid': Buffer.from([1]) } });
    await auth.clearKeys();
    expect(await store.list('')).toEqual(['creds']);
    await auth.setKeys({ session: { 'a@lid': Buffer.from([1]) } });
    await auth.clear();
    expect(await store.list('')).toEqual([]);
    expect(await auth.loadCreds()).toBeUndefined();
  });
});
