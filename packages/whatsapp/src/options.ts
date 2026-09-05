import { ConfigError, type KeyValueStore, type Logger } from '@talitman/core';
import { z } from 'zod';
import type { WhatsAppConnectorOptions } from './types.js';

const isStore = (v: unknown): v is KeyValueStore =>
  typeof v === 'object' && v !== null && typeof (v as KeyValueStore).get === 'function';
const isLogger = (v: unknown): v is Logger =>
  typeof v === 'object' && v !== null && typeof (v as Logger).child === 'function';

const cacheSchema = (maxEntries: number, ttlMs: number) =>
  z
    .object({
      maxEntries: z.number().int().positive().default(maxEntries),
      ttlMs: z.number().int().positive().default(ttlMs),
    })
    .prefault({});

export const optionsSchema = z.object({
  accountId: z.string().min(1),
  storage: z.object({
    auth: z.custom<KeyValueStore>(isStore, 'auth store must implement KeyValueStore'),
  }),
  logger: z.custom<Logger>(isLogger).optional(),
  pairing: z
    .discriminatedUnion('method', [
      z.object({ method: z.literal('qr') }),
      z.object({ method: z.literal('code'), phoneNumber: z.string().regex(/^\d{6,15}$/) }),
    ])
    .default({ method: 'qr' }),
  reconnect: z
    .object({
      initialDelayMs: z.number().int().positive().default(1000),
      maxDelayMs: z.number().int().positive().default(60_000),
      maxAttempts: z.number().int().positive().nullable().default(null),
    })
    .prefault({}),
  includeOwnMessages: z.boolean().default(true),
  includeHistory: z.boolean().default(false),
  includeRaw: z.boolean().default(false),
  dedupe: cacheSchema(5000, 600_000),
  mediaCache: cacheSchema(5000, 86_400_000),
  browser: z
    .object({ os: z.string().min(1), name: z.string().min(1), version: z.string().optional() })
    .optional(),
  markOnlineOnConnect: z.boolean().default(false),
  fetchLatestVersion: z.boolean().default(false),
  waWebVersion: z.tuple([z.number().int(), z.number().int(), z.number().int()]).optional(),
  providerLogLevel: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('warn'),
});

export type ResolvedOptions = z.infer<typeof optionsSchema>;

export function resolveOptions(input: WhatsAppConnectorOptions): ResolvedOptions {
  const result = optionsSchema.safeParse(input);
  if (result.success) return result.data;
  const lines = result.error.issues.map(
    (i) => `  ${i.path.map(String).join('.') || '(root)'}: ${i.message}`,
  );
  throw new ConfigError(`Invalid WhatsApp connector options:\n${lines.join('\n')}`);
}
