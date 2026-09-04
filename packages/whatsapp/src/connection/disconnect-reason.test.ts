import { describe, expect, it } from 'vitest';
import { policyFor } from './disconnect-reason.js';

describe('policyFor', () => {
  it.each([
    [515, 'reconnect-now'],
    [401, 'logged-out'],
    [403, 'logged-out'],
    [419, 'logged-out'],
    [500, 'logged-out'],
    [440, 'stop'],
    [408, 'reconnect-backoff'],
    [428, 'reconnect-backoff'],
    [503, 'reconnect-backoff'],
    [418, 'reconnect-backoff'],
    [undefined, 'reconnect-backoff'],
  ] as const)('%s -> %s', (code, policy) => {
    expect(policyFor(code)).toBe(policy);
  });
});
