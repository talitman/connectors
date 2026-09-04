import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@connectors/core';
import { browserTuple, toOutgoingContent, toProviderLogger } from './baileys-mapping.js';

function spyLogger(): Logger & { calls: string[] } {
  const calls: string[] = [];
  const mk = (lvl: string) => ((..._args: unknown[]) => calls.push(lvl)) as Logger['debug'];
  const logger = {
    calls,
    debug: mk('debug'),
    info: mk('info'),
    warn: mk('warn'),
    error: mk('error'),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
}

describe('toProviderLogger', () => {
  it('filters below the configured level and maps trace to debug', () => {
    const base = spyLogger();
    const p = toProviderLogger(base, 'warn');
    p.trace({}, 'x');
    p.debug({}, 'x');
    p.info({}, 'x');
    p.warn({}, 'x');
    p.error({}, 'x');
    expect(base.calls).toEqual(['warn', 'error']);
    expect(p.level).toBe('warn');
    expect(toProviderLogger(base, 'silent').level).toBe('silent');
    const all = toProviderLogger(spyLogger(), 'trace');
    all.trace('t');
    expect(all.child({ a: 1 }).level).toBe('trace');
  });
});

describe('browserTuple', () => {
  it('returns undefined without an override (the client then uses the provider default) and honours overrides', () => {
    expect(browserTuple(undefined)).toBeUndefined();
    expect(browserTuple({ os: 'Ubuntu', name: 'Firefox', version: '120' })).toEqual([
      'Ubuntu',
      'Firefox',
      '120',
    ]);
    expect(browserTuple({ os: 'Ubuntu', name: 'Firefox' })).toEqual(['Ubuntu', 'Firefox', '']);
  });
});

describe('toOutgoingContent', () => {
  it('maps every media kind, buffers and streams', () => {
    const buf = Buffer.from('x');
    const stream = Readable.from(['x']);
    expect(
      toOutgoingContent({ kind: 'image', data: buf, mimetype: 'image/png', caption: 'c' }),
    ).toEqual({ image: buf, mimetype: 'image/png', caption: 'c' });
    expect(toOutgoingContent({ kind: 'video', data: stream, mimetype: 'video/mp4' })).toEqual({
      video: { stream },
      mimetype: 'video/mp4',
    });
    expect(
      toOutgoingContent({
        kind: 'audio',
        data: buf,
        mimetype: 'audio/ogg; codecs=opus',
        voiceNote: true,
      }),
    ).toEqual({ audio: buf, mimetype: 'audio/ogg; codecs=opus', ptt: true });
    expect(
      toOutgoingContent({
        kind: 'document',
        data: buf,
        mimetype: 'application/pdf',
        fileName: 'a.pdf',
        caption: 'c',
      }),
    ).toEqual({ document: buf, mimetype: 'application/pdf', fileName: 'a.pdf', caption: 'c' });
  });
});
