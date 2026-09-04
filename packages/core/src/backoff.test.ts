import { describe, expect, it } from 'vitest';
import { exponentialBackoff } from './backoff.js';

describe('exponentialBackoff', () => {
  it('grows by factor and caps at maxMs (no jitter)', () => {
    const b = exponentialBackoff({ initialMs: 100, maxMs: 1000, factor: 2, jitter: 0 });
    expect([1, 2, 3, 4, 5].map((n) => b.delayFor(n))).toEqual([100, 200, 400, 800, 1000]);
  });

  it('applies bounded jitter', () => {
    const low = exponentialBackoff({ initialMs: 100, jitter: 0.5, random: () => 0 });
    const high = exponentialBackoff({ initialMs: 100, jitter: 0.5, random: () => 1 });
    const mid = exponentialBackoff({ initialMs: 100, jitter: 0.5, random: () => 0.5 });
    expect(low.delayFor(1)).toBe(50);
    expect(high.delayFor(1)).toBe(150);
    expect(mid.delayFor(1)).toBe(100);
  });

  it('never exceeds maxMs even with jitter', () => {
    const b = exponentialBackoff({ initialMs: 1000, maxMs: 1000, jitter: 0.5, random: () => 1 });
    expect(b.delayFor(10)).toBe(1000);
  });
});
