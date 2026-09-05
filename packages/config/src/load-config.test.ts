import { ConfigError } from '@talitman/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { booleanString, logLevel, port } from './fields.js';
import { loadConfig } from './load-config.js';

const schema = z.object({
  PORT: port(3000),
  LOG_LEVEL: logLevel,
  DEBUG: booleanString(false),
  NAME: z.string().min(1),
});

describe('loadConfig', () => {
  it('parses with defaults', () => {
    const cfg = loadConfig(schema, { NAME: 'svc' });
    expect(cfg).toEqual({ PORT: 3000, LOG_LEVEL: 'info', DEBUG: false, NAME: 'svc' });
  });

  it('coerces strings', () => {
    const cfg = loadConfig(schema, { NAME: 'svc', PORT: '8080', DEBUG: 'yes', LOG_LEVEL: 'debug' });
    expect(cfg).toEqual({ PORT: 8080, LOG_LEVEL: 'debug', DEBUG: true, NAME: 'svc' });
  });

  it('throws ConfigError listing every invalid variable', () => {
    let caught: unknown;
    try {
      loadConfig(schema, { PORT: 'abc', LOG_LEVEL: 'loud', DEBUG: 'maybe' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const message = (caught as Error).message;
    expect(message).toContain('PORT');
    expect(message).toContain('LOG_LEVEL');
    expect(message).toContain('DEBUG');
    expect(message).toContain('NAME');
  });
});
