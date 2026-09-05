import { ConfigError } from '@talitman/core';
import { describe, expect, it } from 'vitest';
import { loadServiceConfig } from './config.js';

describe('loadServiceConfig', () => {
  it('applies defaults', () => {
    expect(loadServiceConfig({})).toEqual({
      PORT: 3000,
      HOST: '0.0.0.0',
      DATA_DIR: './data',
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
      WA_FETCH_LATEST_VERSION: false,
    });
  });

  it('reads overrides', () => {
    const cfg = loadServiceConfig({
      PORT: '8080',
      API_KEY: 'k',
      WEBHOOK_URL: 'https://h.test/x',
      WEBHOOK_SECRET: 's',
      LOG_PRETTY: 'true',
    });
    expect(cfg).toMatchObject({
      PORT: 8080,
      API_KEY: 'k',
      WEBHOOK_URL: 'https://h.test/x',
      WEBHOOK_SECRET: 's',
      LOG_PRETTY: true,
    });
  });

  it('rejects invalid values', () => {
    expect(() => loadServiceConfig({ WEBHOOK_URL: 'nope' })).toThrow(ConfigError);
    expect(() => loadServiceConfig({ PORT: '0' })).toThrow(ConfigError);
  });
});
