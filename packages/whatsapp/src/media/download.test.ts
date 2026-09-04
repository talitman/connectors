import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { RawMessage } from '../client/types.js';
import { MediaUnavailableError } from '../errors.js';
import { FakeWhatsAppClient } from '../testing/fake-client.js';
import { RawMessageCache } from './cache.js';
import { openMediaStream, resolveRawMessage, streamToFile } from './download.js';

const mediaRaw = (id = 'M1', directPath = '/p1'): RawMessage => ({
  key: { id, remoteJid: '1@s.whatsapp.net' },
  message: { imageMessage: { mediaKey: new Uint8Array([1]), directPath, mimetype: 'image/jpeg' } },
});

const read = async (s: Readable) => Buffer.concat(await s.toArray()).toString();

describe('resolveRawMessage', () => {
  it('reads from cache or raw, and fails when not cached', () => {
    const cache = new RawMessageCache({ maxEntries: 5, ttlMs: 1000 });
    cache.set('M1', mediaRaw());
    expect(resolveRawMessage({ messageId: 'M1' }, cache).key.id).toBe('M1');
    expect(resolveRawMessage({ raw: mediaRaw('R1') }, cache).key.id).toBe('R1');
    expect(() => resolveRawMessage({ messageId: 'nope' }, cache)).toThrow(MediaUnavailableError);
    expect(() => resolveRawMessage({ raw: { junk: true } }, cache)).toThrow(MediaUnavailableError);
  });
});

describe('openMediaStream', () => {
  it('streams decrypted media via the client', async () => {
    const client = new FakeWhatsAppClient();
    const cache = new RawMessageCache({ maxEntries: 5, ttlMs: 1000 });
    const { stream, descriptor } = await openMediaStream(client, mediaRaw(), cache);
    expect(descriptor.mimetype).toBe('image/jpeg');
    expect(await read(stream)).toBe('media');
    expect(client.calls.downloads).toHaveLength(1);
  });

  it('throws no-media for messages without media', async () => {
    const client = new FakeWhatsAppClient();
    const cache = new RawMessageCache({ maxEntries: 5, ttlMs: 1000 });
    await expect(
      openMediaStream(client, { key: { id: 'T' }, message: { conversation: 'x' } }, cache),
    ).rejects.toMatchObject({ reason: 'no-media' });
  });

  it('requests a reupload once when media expired and updates the cache', async () => {
    const client = new FakeWhatsAppClient();
    const cache = new RawMessageCache({ maxEntries: 5, ttlMs: 1000 });
    cache.set('M1', mediaRaw());
    let calls = 0;
    client.downloadImpl = (d) => {
      calls++;
      if (d.directPath === '/p1') throw new MediaUnavailableError('expired', 'gone');
      return Promise.resolve(Readable.from([Buffer.from('fresh')]));
    };
    client.reuploadImpl = () => Promise.resolve(mediaRaw('M1', '/p2'));
    const { stream } = await openMediaStream(client, mediaRaw(), cache);
    expect(await read(stream)).toBe('fresh');
    expect(calls).toBe(2);
    expect(client.calls.reuploads).toHaveLength(1);
    expect(cache.get('M1')?.message?.imageMessage?.directPath).toBe('/p2');
  });

  it('gives up if the reupload also fails', async () => {
    const client = new FakeWhatsAppClient();
    const cache = new RawMessageCache({ maxEntries: 5, ttlMs: 1000 });
    client.downloadImpl = () => {
      throw new MediaUnavailableError('expired', 'gone');
    };
    await expect(openMediaStream(client, mediaRaw(), cache)).rejects.toMatchObject({
      reason: 'expired',
    });
    expect(client.calls.downloads).toHaveLength(2);
  });
});

describe('streamToFile', () => {
  it('writes atomically and reports bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wa-media-'));
    const target = join(dir, 'out.bin');
    const result = await streamToFile(
      Readable.from([Buffer.from('abc'), Buffer.from('de')]),
      target,
    );
    expect(result).toEqual({ path: target, bytes: 5 });
    expect((await readFile(target)).toString()).toBe('abcde');
    expect(await readdir(dir)).toEqual(['out.bin']);
  });

  it('removes the partial file when the stream errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wa-media-'));
    const failing = new Readable({
      read() {
        this.push(Buffer.from('x'));
        this.destroy(new Error('stream broke'));
      },
    });
    await expect(streamToFile(failing, join(dir, 'out.bin'))).rejects.toThrow('stream broke');
    expect(await readdir(dir)).toEqual([]);
  });
});
