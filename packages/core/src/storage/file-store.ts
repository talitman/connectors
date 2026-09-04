import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { assertValidKey, assertValidPrefix, type KeyValueStore } from './store.js';

const SAFE = /^[A-Za-z0-9_-]$/;
const TMP_SUFFIX = /\.[0-9a-f]{16}\.tmp$/;

export function encodeSegment(segment: string): string {
  let out = '';
  for (const ch of segment) {
    if (SAFE.test(ch)) {
      out += ch;
    } else {
      for (const byte of Buffer.from(ch, 'utf8')) {
        out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
      }
    }
  }
  return out;
}

export function decodeSegment(segment: string): string {
  return decodeURIComponent(segment);
}

/**
 * One file per key under rootDir. Segments are percent-encoded so any key is a safe path.
 * Writes are atomic (temp file + rename). Files are 0600, directories 0700.
 */
export class FileStore implements KeyValueStore {
  constructor(private readonly rootDir: string) {}

  private pathFor(key: string): string {
    assertValidKey(key);
    return join(this.rootDir, ...key.split('/').map(encodeSegment));
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(this.pathFor(key)));
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const tmp = `${target}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, value, { mode: 0o600 });
      await rename(tmp, target);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    assertValidPrefix(prefix);
    const keys: string[] = [];
    await this.walk(this.rootDir, keys);
    return keys.filter((k) => k.startsWith(prefix));
  }

  async clear(prefix: string): Promise<void> {
    assertValidPrefix(prefix);
    if (prefix === '') {
      await rm(this.rootDir, { recursive: true, force: true });
      return;
    }
    for (const key of await this.list(prefix)) await this.delete(key);
  }

  private async walk(dir: string, out: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(full, out);
      } else if (entry.isFile() && !TMP_SUFFIX.test(entry.name)) {
        out.push(relative(this.rootDir, full).split(sep).map(decodeSegment).join('/'));
      }
    }
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
