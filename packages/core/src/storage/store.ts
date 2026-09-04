export interface KeyValueStore {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  /** All keys starting with prefix (empty prefix = everything). */
  list(prefix: string): Promise<string[]>;
  /** Delete all keys starting with prefix. */
  clear(prefix: string): Promise<void>;
}

/** Role alias: credentials and other secrets. */
export type SecretStore = KeyValueStore;
/** Role alias: non-secret connector state. */
export type StateStore = KeyValueStore;

/** Keys are '/'-separated paths with non-empty segments and no leading/trailing slash. */
export function assertValidKey(key: string): void {
  if (key.length === 0 || key.startsWith('/') || key.endsWith('/') || key.includes('//')) {
    throw new Error(`Invalid store key: ${JSON.stringify(key)}`);
  }
}

/** Prefixes are either empty or valid keys optionally ending with '/'. */
export function assertValidPrefix(prefix: string): void {
  if (prefix === '') return;
  const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  assertValidKey(trimmed);
}

export function namespaced(store: KeyValueStore, prefix: string): KeyValueStore {
  assertValidKey(prefix);
  const base = `${prefix}/`;
  const full = (key: string) => {
    assertValidKey(key);
    return base + key;
  };
  const fullPrefix = (p: string) => {
    assertValidPrefix(p);
    return base + p;
  };
  return {
    get: async (key) => store.get(full(key)),
    set: async (key, value) => store.set(full(key), value),
    delete: async (key) => store.delete(full(key)),
    list: async (p) => (await store.list(fullPrefix(p))).map((k) => k.slice(base.length)),
    clear: async (p) => store.clear(fullPrefix(p)),
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const jsonCodec = {
  encode(value: unknown): Uint8Array {
    return encoder.encode(JSON.stringify(value));
  },
  decode<T>(bytes: Uint8Array): T {
    return JSON.parse(decoder.decode(bytes)) as T;
  },
};
