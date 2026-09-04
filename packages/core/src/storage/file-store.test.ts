import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileStore, decodeSegment, encodeSegment } from './file-store.js';
import { runStoreContractTests } from '../testing/store-contract.js';

const freshDir = () => mkdtemp(join(tmpdir(), 'connectors-filestore-'));

runStoreContractTests('FileStore', async () => new FileStore(await freshDir()));

describe('FileStore specifics', () => {
  it('encodes segments to safe file names and decodes them back', () => {
    for (const s of ['plain', 'a b', '..', 'x@y.z', '%', 'ü', '1234@g.us::5:1']) {
      const enc = encodeSegment(s);
      expect(enc).toMatch(/^[A-Za-z0-9_%-]+$/);
      expect(decodeSegment(enc)).toBe(s);
    }
  });

  it('writes files with 0600 and directories with 0700', async () => {
    const dir = await freshDir();
    const store = new FileStore(dir);
    await store.set('auth/creds', new Uint8Array([1]));
    const file = await stat(join(dir, 'auth', 'creds'));
    const folder = await stat(join(dir, 'auth'));
    expect(file.mode & 0o777).toBe(0o600);
    expect(folder.mode & 0o777).toBe(0o700);
  });

  it('leaves no temp files behind and persists across instances', async () => {
    const dir = await freshDir();
    await new FileStore(dir).set('a/b', new Uint8Array([9]));
    expect(await readdir(join(dir, 'a'))).toEqual(['b']);
    expect(await new FileStore(dir).get('a/b')).toEqual(new Uint8Array([9]));
  });

  it('lists nothing for a missing root', async () => {
    const store = new FileStore(join(await freshDir(), 'does-not-exist'));
    expect(await store.list('')).toEqual([]);
    await store.clear('');
  });
});
