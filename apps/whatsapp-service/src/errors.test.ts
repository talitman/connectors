import { AuthError, ConfigError, ConnectorError } from '@connectors/core';
import { MediaUnavailableError, NotConnectedError } from '@connectors/whatsapp';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError, parseWith, toHttpError } from './errors.js';

describe('toHttpError', () => {
  it.each([
    [new NotFoundError('instance'), 404, 'NOT_FOUND'],
    [new ConflictError('exists'), 409, 'CONFLICT'],
    [new ValidationError('bad'), 400, 'VALIDATION'],
    [new NotConnectedError('pairing'), 409, 'NOT_CONNECTED'],
    [new MediaUnavailableError('not-cached', 'x'), 404, 'MEDIA_UNAVAILABLE'],
    [new AuthError('x'), 409, 'AUTH_REQUIRED'],
    [new ConfigError('x'), 400, 'CONFIG_INVALID'],
    [
      new ConnectorError('x', { code: 'INVALID_CHAT_ID', retryable: false }),
      400,
      'INVALID_CHAT_ID',
    ],
    [new ConnectorError('x', { code: 'SOMETHING', retryable: true }), 500, 'SOMETHING'],
    [new Error('plain'), 500, 'INTERNAL'],
  ])('%s -> %i %s', (err, status, code) => {
    const http = toHttpError(err);
    expect(http.statusCode).toBe(status);
    expect(http.code).toBe(code);
  });

  it('hides internal error messages', () => {
    expect(toHttpError(new Error('secret detail')).message).toBe('Internal error');
  });
});

describe('parseWith', () => {
  it('returns parsed data or throws ValidationError with field details', () => {
    const schema = z.object({ to: z.string().min(1) });
    expect(parseWith(schema, { to: 'x' })).toEqual({ to: 'x' });
    expect(() => parseWith(schema, { to: '' })).toThrow(ValidationError);
    expect(() => parseWith(schema, {})).toThrow(/to/);
  });
});
