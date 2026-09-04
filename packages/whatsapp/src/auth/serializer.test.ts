import { describe, expect, it } from 'vitest';
import { decodeAuthValue, encodeAuthValue } from './serializer.js';

describe('auth serializer', () => {
  it('round-trips Buffers and Uint8Arrays nested in objects', () => {
    const value = {
      noiseKey: { private: Buffer.from([1, 2, 3]), public: new Uint8Array([4, 5]) },
      list: [Buffer.from('ab')],
      n: 7,
      s: 'str',
      nested: { deep: { b: Buffer.alloc(0) } },
      nil: null,
    };
    const decoded = decodeAuthValue(encodeAuthValue(value)) as typeof value;
    expect(Buffer.isBuffer(decoded.noiseKey.private)).toBe(true);
    expect(Buffer.from(decoded.noiseKey.private)).toEqual(Buffer.from([1, 2, 3]));
    expect(Buffer.from(decoded.noiseKey.public)).toEqual(Buffer.from([4, 5]));
    expect(Buffer.from(decoded.list[0]!)).toEqual(Buffer.from('ab'));
    expect(decoded.n).toBe(7);
    expect(decoded.s).toBe('str');
    expect(Buffer.from(decoded.nested.deep.b)).toEqual(Buffer.alloc(0));
    expect(decoded.nil).toBeNull();
  });

  it('uses the { type: "Buffer", data: base64 } wire format', () => {
    const json = JSON.parse(Buffer.from(encodeAuthValue({ k: Buffer.from([255]) })).toString()) as {
      k: { type: string; data: string };
    };
    expect(json.k).toEqual({ type: 'Buffer', data: '/w==' });
  });

  it('revives legacy numeric-array Buffer JSON', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ k: { type: 'Buffer', data: [1, 2] } }));
    const decoded = decodeAuthValue(bytes) as { k: Buffer };
    expect(Buffer.from(decoded.k)).toEqual(Buffer.from([1, 2]));
  });
});
