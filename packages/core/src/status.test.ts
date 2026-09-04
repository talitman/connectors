import { describe, expect, it } from 'vitest';
import { healthFromStatus } from './status.js';

describe('healthFromStatus', () => {
  const at = new Date();
  it.each([
    ['connected', 'healthy'],
    ['connecting', 'degraded'],
    ['pairing', 'degraded'],
    ['reconnecting', 'degraded'],
    ['disconnected', 'unhealthy'],
    ['logged_out', 'unhealthy'],
  ] as const)('%s -> %s', (state, health) => {
    expect(healthFromStatus({ state, since: at })).toBe(health);
  });
});
