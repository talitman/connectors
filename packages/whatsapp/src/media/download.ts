import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { MediaDescriptor, RawMessage, WhatsAppClient } from '../client/types.js';
import { MediaUnavailableError } from '../errors.js';
import type { MediaSource } from '../types.js';
import type { RawMessageCache } from './cache.js';
import { extractMediaDescriptor } from './descriptor.js';

function isRawMessage(v: unknown): v is RawMessage {
  return typeof v === 'object' && v !== null && typeof (v as RawMessage).key === 'object';
}

export function resolveRawMessage(source: MediaSource, cache: RawMessageCache): RawMessage {
  if ('raw' in source) {
    if (!isRawMessage(source.raw)) {
      throw new MediaUnavailableError(
        'no-media',
        'The supplied raw payload is not a WhatsApp message',
      );
    }
    return source.raw;
  }
  const raw = cache.get(source.messageId);
  if (!raw) {
    throw new MediaUnavailableError(
      'not-cached',
      `Message ${source.messageId} is not in the media cache (it expired, was evicted, or arrived before a restart)`,
    );
  }
  return raw;
}

export async function openMediaStream(
  client: WhatsAppClient,
  raw: RawMessage,
  cache: RawMessageCache,
): Promise<{ stream: Readable; descriptor: MediaDescriptor }> {
  const descriptor = extractMediaDescriptor(raw);
  if (!descriptor)
    throw new MediaUnavailableError('no-media', 'Message does not contain downloadable media');
  try {
    return { stream: await client.downloadMedia(descriptor), descriptor };
  } catch (err) {
    if (!(err instanceof MediaUnavailableError) || err.reason !== 'expired') throw err;
    const refreshed = await client.requestReupload(raw);
    const id = refreshed.key.id;
    if (id) cache.set(id, refreshed);
    const fresh = extractMediaDescriptor(refreshed);
    if (!fresh) throw err;
    return { stream: await client.downloadMedia(fresh), descriptor: fresh };
  }
}

/** Streams into a temp file next to the target and renames on success. */
export async function streamToFile(
  stream: Readable,
  filePath: string,
): Promise<{ path: string; bytes: number }> {
  await mkdir(dirname(filePath), { recursive: true });
  const partial = `${filePath}.${randomBytes(6).toString('hex')}.part`;
  let bytes = 0;
  try {
    const out = createWriteStream(partial, { mode: 0o600 });
    stream.on('data', (chunk: Buffer | string) => {
      bytes += Buffer.byteLength(chunk);
    });
    await pipeline(stream, out);
    await rename(partial, filePath);
    return { path: filePath, bytes };
  } catch (err) {
    await unlink(partial).catch(() => undefined);
    throw err;
  }
}
