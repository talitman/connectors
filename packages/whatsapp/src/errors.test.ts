import { AuthError } from '@connectors/core';
import { describe, expect, it } from 'vitest';
import { ConnectionReplacedError, mapDisconnectError, statusCodeOf } from './errors.js';

describe('mapDisconnectError', () => {
  it.each([
    [401, AuthError, 'AUTH_REQUIRED', false],
    [403, AuthError, 'AUTH_REQUIRED', false],
    [419, AuthError, 'AUTH_REQUIRED', false],
    [500, AuthError, 'BAD_SESSION', false],
    [440, ConnectionReplacedError, 'CONNECTION_REPLACED', false],
    [515, undefined, 'RESTART_REQUIRED', true],
    [408, undefined, 'CONNECTION_LOST', true],
    [428, undefined, 'CONNECTION_LOST', true],
    [503, undefined, 'CONNECTION_LOST', true],
    [undefined, undefined, 'CONNECTION_LOST', true],
    [418, undefined, 'UNKNOWN', false],
  ])('maps %s', (code, cls, expectedCode, retryable) => {
    const err = mapDisconnectError(code, new Error('x'));
    if (cls) expect(err).toBeInstanceOf(cls);
    expect(err.code).toBe(expectedCode);
    expect(err.retryable).toBe(retryable);
    expect(err.cause).toBeInstanceOf(Error);
  });
});

describe('statusCodeOf', () => {
  it('reads Boom-style output.statusCode', () => {
    expect(statusCodeOf({ output: { statusCode: 515 } })).toBe(515);
    expect(statusCodeOf(new Error('x'))).toBeUndefined();
    expect(statusCodeOf(undefined)).toBeUndefined();
  });
});
