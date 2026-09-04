import type { KeyValueStore } from '@connectors/core';
import type { AuthStore } from '../client/types.js';
import { decodeAuthValue, encodeAuthValue } from './serializer.js';

export const CREDS_KEY = 'creds';
export const KEYS_PREFIX = 'keys/';

export function keyPath(type: string, id: string): string {
  return `${KEYS_PREFIX}${type}/${id}`;
}

/** Adapts a KeyValueStore to the provider's auth persistence needs. Never logs values. */
export function createAuthStore(store: KeyValueStore): AuthStore {
  return {
    async loadCreds() {
      const bytes = await store.get(CREDS_KEY);
      return bytes === undefined ? undefined : (decodeAuthValue(bytes) as Record<string, unknown>);
    },
    async saveCreds(creds) {
      await store.set(CREDS_KEY, encodeAuthValue(creds));
    },
    async getKeys(type, ids) {
      const out: Record<string, unknown> = {};
      await Promise.all(
        ids.map(async (id) => {
          const bytes = await store.get(keyPath(type, id));
          if (bytes !== undefined) out[id] = decodeAuthValue(bytes);
        }),
      );
      return out;
    },
    async setKeys(data) {
      const writes: Promise<void>[] = [];
      for (const [type, entries] of Object.entries(data)) {
        for (const [id, value] of Object.entries(entries)) {
          writes.push(
            value === null
              ? store.delete(keyPath(type, id))
              : store.set(keyPath(type, id), encodeAuthValue(value)),
          );
        }
      }
      await Promise.all(writes);
    },
    async clearKeys() {
      await store.clear(KEYS_PREFIX);
    },
    async clear() {
      await store.clear('');
    },
  };
}
