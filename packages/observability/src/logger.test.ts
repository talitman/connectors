import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { Logger } from '@connectors/core';
import { createLogger } from './logger.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { stream, lines, last: () => JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown> };
}

describe('createLogger', () => {
  it('writes JSON lines with name and level', () => {
    const c = capture();
    const logger = createLogger({ name: 'test', level: 'debug', destination: c.stream });
    logger.info({ a: 1 }, 'hello');
    expect(c.last()).toMatchObject({ name: 'test', a: 1, msg: 'hello', level: 30 });
  });

  it('redacts auth material and secrets by default', () => {
    const c = capture();
    const logger = createLogger({ destination: c.stream });
    logger.info(
      {
        creds: { noiseKey: 'x' },
        keys: { 'pre-key': {} },
        message: { mediaKey: 'k' },
        req: { headers: { authorization: 'Bearer t' } },
        secret: 's',
        apiKey: 'k',
        nested: { privKey: 'p', public: 'q' },
        safe: 'visible',
      },
      'm',
    );
    const line = c.last();
    expect(line.creds).toBe('[REDACTED]');
    expect(line.keys).toBe('[REDACTED]');
    expect((line.message as Record<string, unknown>).mediaKey).toBe('[REDACTED]');
    expect(
      ((line.req as Record<string, unknown>).headers as Record<string, unknown>).authorization,
    ).toBe('[REDACTED]');
    expect(line.secret).toBe('[REDACTED]');
    expect(line.apiKey).toBe('[REDACTED]');
    expect((line.nested as Record<string, unknown>).privKey).toBe('[REDACTED]');
    expect(line.safe).toBe('visible');
  });

  it('child loggers keep bindings and satisfy the core Logger interface', () => {
    const c = capture();
    const logger: Logger = createLogger({ destination: c.stream });
    const child = logger.child({ component: 'x' });
    child.warn('careful');
    expect(c.last()).toMatchObject({ component: 'x', msg: 'careful', level: 40 });
  });

  it('respects level', () => {
    const c = capture();
    const logger = createLogger({ level: 'warn', destination: c.stream });
    logger.info('hidden');
    expect(c.lines).toHaveLength(0);
  });
});
