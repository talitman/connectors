/**
 * JSON encoding that preserves binary values, compatible with the provider's own
 * { type: 'Buffer', data: <base64> } convention. Kept isolated so a future auth-format
 * migration only touches this file.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function replacer(this: unknown, _key: string, value: unknown): unknown {
  // JSON.stringify already ran Buffer#toJSON, producing { type: 'Buffer', data: number[] }.
  if (typeof value === 'object' && value !== null) {
    const v = value as { type?: unknown; data?: unknown };
    if (v.type === 'Buffer' && Array.isArray(v.data)) {
      return { type: 'Buffer', data: Buffer.from(v.data as number[]).toString('base64') };
    }
    if (value instanceof Uint8Array) {
      return { type: 'Buffer', data: Buffer.from(value).toString('base64') };
    }
  }
  return value;
}

function reviver(this: unknown, _key: string, value: unknown): unknown {
  if (typeof value === 'object' && value !== null) {
    const v = value as { type?: unknown; data?: unknown };
    if (v.type === 'Buffer') {
      if (typeof v.data === 'string') return Buffer.from(v.data, 'base64');
      if (Array.isArray(v.data)) return Buffer.from(v.data as number[]);
    }
  }
  return value;
}

export function encodeAuthValue(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value, replacer));
}

export function decodeAuthValue(bytes: Uint8Array): unknown {
  return JSON.parse(decoder.decode(bytes), reviver) as unknown;
}
