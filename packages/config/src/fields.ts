import { z } from 'zod';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const logLevel = z.enum(LOG_LEVELS).default('info');

export const port = (defaultPort: number) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? defaultPort : Number(v)),
    z.number().int().min(1).max(65535),
  );

const TRUE = new Set(['true', '1', 'yes', 'on']);
const FALSE = new Set(['false', '0', 'no', 'off']);

export const booleanString = (defaultValue: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return defaultValue;
    if (typeof v !== 'string') return v;
    const s = v.trim().toLowerCase();
    if (TRUE.has(s)) return true;
    if (FALSE.has(s)) return false;
    return v;
  }, z.boolean());

export const optionalUrl = z.url().optional();
export const nonEmptyString = z.string().min(1);
export const optionalNonEmptyString = z.string().min(1).optional();
