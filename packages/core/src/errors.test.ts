import { describe, expect, it } from 'vitest';
import {
  AuthError,
  ConfigError,
  ConnectorError,
  isRetryable,
  nonRetryable,
  retryable,
} from './errors.js';

describe('ConnectorError', () => {
  it('carries code, retryable and cause', () => {
    const cause = new Error('boom');
    const err = new ConnectorError('failed', { code: 'X', retryable: true, cause });
    expect(err.message).toBe('failed');
    expect(err.code).toBe('X');
    expect(err.retryable).toBe(true);
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('ConnectorError');
    expect(err).toBeInstanceOf(Error);
  });

  it('subclasses default their codes and are non-retryable', () => {
    expect(new AuthError('need pairing').code).toBe('AUTH_REQUIRED');
    expect(new AuthError('bad', { code: 'BAD_SESSION' }).code).toBe('BAD_SESSION');
    expect(new AuthError('x').retryable).toBe(false);
    expect(new ConfigError('x').code).toBe('CONFIG_INVALID');
    expect(new AuthError('x').name).toBe('AuthError');
  });

  it('helpers build errors and isRetryable inspects them', () => {
    expect(isRetryable(retryable('a', 'A'))).toBe(true);
    expect(isRetryable(nonRetryable('b', 'B'))).toBe(false);
    expect(isRetryable(new Error('plain'))).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
  });
});
