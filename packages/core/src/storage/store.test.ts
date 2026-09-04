import { describe, expect, it } from 'vitest';
import { MemoryStore } from './memory-store.js';
import { jsonCodec, namespaced } from './store.js';

describe('namespaced', () => {
  it('prefixes keys and strips the prefix on list', async () => {
    const base = new MemoryStore();
    const ns = namespaced(base, 'instances/abc');
    await ns.set('auth/creds', new Uint8Array([1]));
    expect(await base.get('instances/abc/auth/creds')).toEqual(new Uint8Array([1]));
    expect(await ns.list('')).toEqual(['auth/creds']);
    expect(await ns.list('auth/')).toEqual(['auth/creds']);
    await base.set('instances/other/x', new Uint8Array([2]));
    expect(await ns.list('')).toEqual(['auth/creds']);
    await ns.clear('');
    expect(await base.list('')).toEqual(['instances/other/x']);
  });

  it('nests', async () => {
    const base = new MemoryStore();
    const inner = namespaced(namespaced(base, 'a'), 'b');
    await inner.set('c', new Uint8Array([1]));
    expect(await base.list('')).toEqual(['a/b/c']);
  });
});

describe('jsonCodec', () => {
  it('round-trips JSON values as UTF-8 bytes', () => {
    const bytes = jsonCodec.encode({ a: 1, b: 'ü' });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(jsonCodec.decode<{ a: number; b: string }>(bytes)).toEqual({ a: 1, b: 'ü' });
  });
});
