import type { Logger } from '@connectors/core';
import type { ResolvedOptions } from '../options.js';
import type { OutgoingMedia, WhatsAppLogLevel } from '../types.js';

/** Structural equivalent of the provider's ILogger; kept here so this file stays provider-free. */
export interface ProviderLogger {
  level: string;
  child(bindings: Record<string, unknown>): ProviderLogger;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const LEVEL_RANK: Record<WhatsAppLogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Infinity,
};

export function toProviderLogger(logger: Logger, level: WhatsAppLogLevel): ProviderLogger {
  const threshold = LEVEL_RANK[level];
  const forward =
    (rank: number, method: 'debug' | 'info' | 'warn' | 'error') =>
    (obj: unknown, msg?: string): void => {
      if (rank < threshold) return;
      if (typeof obj === 'string') logger[method](obj);
      else if (typeof obj === 'object' && obj !== null)
        logger[method](obj as Record<string, unknown>, msg);
      else logger[method]({ value: obj }, msg);
    };
  return {
    level,
    child: (bindings) => toProviderLogger(logger.child(bindings), level),
    trace: forward(LEVEL_RANK.trace, 'debug'),
    debug: forward(LEVEL_RANK.debug, 'debug'),
    info: forward(LEVEL_RANK.info, 'info'),
    warn: forward(LEVEL_RANK.warn, 'warn'),
    error: forward(LEVEL_RANK.error, 'error'),
  };
}

export function browserTuple(
  browser: ResolvedOptions['browser'],
): [string, string, string] | undefined {
  if (!browser) return undefined;
  return [browser.os, browser.name, browser.version ?? ''];
}

function upload(data: OutgoingMedia['data']): Buffer | { stream: NodeJS.ReadableStream } {
  return Buffer.isBuffer(data) ? data : { stream: data };
}

/** Builds the provider's AnyMessageContent for media; the caller casts at the boundary. */
export function toOutgoingContent(media: OutgoingMedia): Record<string, unknown> {
  switch (media.kind) {
    case 'image':
      return {
        image: upload(media.data),
        mimetype: media.mimetype,
        ...(media.caption === undefined ? {} : { caption: media.caption }),
      };
    case 'video':
      return {
        video: upload(media.data),
        mimetype: media.mimetype,
        ...(media.caption === undefined ? {} : { caption: media.caption }),
      };
    case 'audio':
      return { audio: upload(media.data), mimetype: media.mimetype, ptt: media.voiceNote === true };
    case 'document':
      return {
        document: upload(media.data),
        mimetype: media.mimetype,
        fileName: media.fileName,
        ...(media.caption === undefined ? {} : { caption: media.caption }),
      };
  }
}
