import { noopLogger } from '@talitman/core';
import { describe, expect, it } from 'vitest';
import { createPublisherFactory } from './publishers.js';

const def = (webhook?: { url: string; secret?: string }) => ({
  id: 'i',
  createdAt: '',
  pairing: { method: 'qr' as const },
  desiredState: 'disconnected' as const,
  ...(webhook ? { webhook } : {}),
});

describe('createPublisherFactory', () => {
  it('prefers the instance webhook, falls back to env, else none', () => {
    const withEnv = createPublisherFactory(
      { WEBHOOK_URL: 'https://env.test/h', WEBHOOK_SECRET: 's' },
      noopLogger,
    );
    expect(withEnv(def({ url: 'https://inst.test/h' }))).toBeDefined();
    expect(withEnv(def())).toBeDefined();
    const noEnv = createPublisherFactory({}, noopLogger);
    expect(noEnv(def())).toBeUndefined();
    expect(noEnv(def({ url: 'https://inst.test/h' }))).toBeDefined();
  });
});
