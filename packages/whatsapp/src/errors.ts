import { AuthError, ConnectorError } from '@talitman/core';

export class ConnectionReplacedError extends ConnectorError {
  constructor(cause?: unknown) {
    super('Connection replaced by another WhatsApp Web session', {
      code: 'CONNECTION_REPLACED',
      retryable: false,
      cause,
    });
  }
}

export type MediaUnavailableReason = 'expired' | 'not-cached' | 'no-media';

export class MediaUnavailableError extends ConnectorError {
  readonly reason: MediaUnavailableReason;
  constructor(reason: MediaUnavailableReason, message: string, cause?: unknown) {
    super(message, { code: 'MEDIA_UNAVAILABLE', retryable: false, cause, details: { reason } });
    this.reason = reason;
  }
}

export class NotConnectedError extends ConnectorError {
  constructor(state: string) {
    super(`WhatsApp connector is not connected (state: ${state})`, {
      code: 'NOT_CONNECTED',
      retryable: false,
      details: { state },
    });
  }
}

/** Reads a Boom-style HTTP status code from a provider error without depending on Boom. */
export function statusCodeOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const output = (err as { output?: { statusCode?: unknown } }).output;
  return typeof output?.statusCode === 'number' ? output.statusCode : undefined;
}

export function mapDisconnectError(
  statusCode: number | undefined,
  cause?: unknown,
): ConnectorError {
  switch (statusCode) {
    case 401:
    case 403:
    case 419:
      return new AuthError('WhatsApp session is logged out; pairing is required', { cause });
    case 500:
      return new AuthError('WhatsApp session is invalid (bad session); pairing is required', {
        code: 'BAD_SESSION',
        cause,
      });
    case 440:
      return new ConnectionReplacedError(cause);
    case 515:
      return new ConnectorError('WhatsApp requested a restart', {
        code: 'RESTART_REQUIRED',
        retryable: true,
        cause,
      });
    case undefined:
    case 408:
    case 428:
    case 503:
      return new ConnectorError('WhatsApp connection lost', {
        code: 'CONNECTION_LOST',
        retryable: true,
        cause,
      });
    default:
      // policyFor() reconnects with backoff on unknown codes, so the error must say retryable.
      return new ConnectorError(`WhatsApp connection closed with status ${statusCode}`, {
        code: 'UNKNOWN',
        retryable: true,
        cause,
        details: { statusCode },
      });
  }
}
