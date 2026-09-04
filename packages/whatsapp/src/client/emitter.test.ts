import { describe, expect, it } from 'vitest';
import { TypedEmitter } from './emitter.js';

describe('TypedEmitter', () => {
  it('dispatches to handlers and supports unsubscribe', () => {
    const e = new TypedEmitter<{ a: number; b: string }>();
    const seen: number[] = [];
    const off = e.on('a', (n) => seen.push(n));
    e.emit('a', 1);
    off();
    e.emit('a', 2);
    expect(seen).toEqual([1]);
  });

  it('isolates handler errors', () => {
    const e = new TypedEmitter<{ a: number }>();
    const seen: number[] = [];
    e.on('a', () => {
      throw new Error('bad');
    });
    e.on('a', (n) => seen.push(n));
    expect(() => e.emit('a', 1)).not.toThrow();
    expect(seen).toEqual([1]);
  });

  it('removeAll clears everything', () => {
    const e = new TypedEmitter<{ a: number }>();
    let n = 0;
    e.on('a', () => n++);
    e.removeAll();
    e.emit('a', 1);
    expect(n).toBe(0);
  });
});
