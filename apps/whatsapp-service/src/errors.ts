import { ConnectorError } from '@connectors/core';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = new.target.name;
  }

  toBody(): { error: { code: string; message: string; retryable: boolean } } {
    return { error: { code: this.code, message: this.message, retryable: this.retryable } };
  }
}

export class NotFoundError extends HttpError {
  constructor(what: string) {
    super(404, 'NOT_FOUND', `${what} not found`);
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

export class ValidationError extends HttpError {
  constructor(message: string) {
    super(400, 'VALIDATION', message);
  }
}

export class UnauthorizedError extends HttpError {
  constructor() {
    super(401, 'UNAUTHORIZED', 'Missing or invalid API key');
  }
}

const CONNECTOR_STATUS: Record<string, number> = {
  NOT_CONNECTED: 409,
  AUTH_REQUIRED: 409,
  BAD_SESSION: 409,
  MEDIA_UNAVAILABLE: 404,
  INVALID_CHAT_ID: 400,
  CONFIG_INVALID: 400,
};

/** Fastify body-parser and routing errors carry a 4xx `statusCode` and a `FST_ERR_*` code. */
function clientError(err: unknown): HttpError | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const { statusCode, code, message } = err as {
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  };
  if (typeof statusCode !== 'number' || statusCode < 400 || statusCode > 499) return undefined;
  return new HttpError(
    statusCode,
    typeof code === 'string' ? code : 'BAD_REQUEST',
    typeof message === 'string' ? message : 'Bad request',
  );
}

export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof ConnectorError) {
    return new HttpError(CONNECTOR_STATUS[err.code] ?? 500, err.code, err.message, err.retryable);
  }
  return clientError(err) ?? new HttpError(500, 'INTERNAL', 'Internal error');
}

export function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const lines = result.error.issues.map(
    (i) => `${i.path.map(String).join('.') || 'body'}: ${i.message}`,
  );
  throw new ValidationError(lines.join('; '));
}
