import type { LogLevel } from '@talitman/config';
import type { Logger } from '@talitman/core';
import { pino, type Logger as PinoLogger } from 'pino';
import { DEFAULT_REDACT_PATHS } from './redact.js';

export interface LoggerOptions {
  name?: string;
  level?: LogLevel;
  /** Human-readable output via pino-pretty (development only). */
  pretty?: boolean;
  /** Extra redact paths appended to DEFAULT_REDACT_PATHS. */
  redact?: string[];
  /** Custom destination stream; mainly for tests. Ignored when pretty is true. */
  destination?: NodeJS.WritableStream;
}

export function createPinoLogger(options: LoggerOptions = {}): PinoLogger {
  const base = {
    level: options.level ?? 'info',
    redact: { paths: [...DEFAULT_REDACT_PATHS, ...(options.redact ?? [])], censor: '[REDACTED]' },
    ...(options.name === undefined ? {} : { name: options.name }),
  };
  if (options.pretty) {
    return pino({ ...base, transport: { target: 'pino-pretty', options: { colorize: true } } });
  }
  return options.destination ? pino(base, options.destination) : pino(base);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return createPinoLogger(options);
}
