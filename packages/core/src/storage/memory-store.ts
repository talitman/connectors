/* eslint-disable @typescript-eslint/require-await -- interface methods return promises */
import { assertValidKey, assertValidPrefix, type KeyValueStore } from './store.js';

export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, Uint8Array>();

  async get(key: string): Promise<Uint8Array | undefined> {
    assertValidKey(key);
    const value = this.data.get(key);
    return value === undefined ? undefined : new Uint8Array(value);
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    assertValidKey(key);
    this.data.set(key, new Uint8Array(value));
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    this.data.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    assertValidPrefix(prefix);
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }

  async clear(prefix: string): Promise<void> {
    for (const key of await this.list(prefix)) this.data.delete(key);
  }
}
