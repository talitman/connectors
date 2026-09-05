import { Readable } from 'node:stream';
import { MemoryStore, noopLogger } from '@connectors/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RawMessage } from './client/types.js';
import { createConnectorWithClient } from './connector.js';
import { NotConnectedError } from './errors.js';
import { FakeWhatsAppClient } from './testing/fake-client.js';
import type { WhatsAppConnectorOptions, WhatsAppEvent, WhatsAppMessageEvent } from './types.js';

function setup(overrides: Partial<WhatsAppConnectorOptions> = {}) {
  const client = new FakeWhatsAppClient();
  const store = new MemoryStore();
  const connector = createConnectorWithClient(
    { accountId: 'acct', storage: { auth: store }, logger: noopLogger, ...overrides },
    { clientFactory: () => client, random: () => 0.5 },
  );
  const events: WhatsAppEvent[] = [];
  connector.subscribe((e) => {
    events.push(e);
  });
  const messages = () =>
    events.filter((e): e is WhatsAppMessageEvent => e.type !== 'connection.updated');
  return { client, store, connector, events, messages };
}

const text = (id: string, extra: Partial<RawMessage['key']> = {}): RawMessage => ({
  key: { remoteJid: '972501234567@s.whatsapp.net', fromMe: false, id, ...extra },
  message: { conversation: `hello ${id}` },
  messageTimestamp: 1_700_000_000,
  pushName: 'Alice',
});

const image = (id: string): RawMessage => ({
  key: { remoteJid: '972501234567@s.whatsapp.net', fromMe: false, id },
  message: {
    imageMessage: {
      mediaKey: new Uint8Array([1]),
      directPath: '/p',
      url: 'https://mmg/x',
      mimetype: 'image/jpeg',
      fileLength: 10,
    },
  },
  messageTimestamp: 1_700_000_000,
});

const flush = () => new Promise((r) => setImmediate(r));

async function connected(overrides: Partial<WhatsAppConnectorOptions> = {}) {
  const s = setup(overrides);
  await s.connector.connect();
  s.client.emitOpen();
  await flush();
  return s;
}

describe('WhatsApp connector', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes identity and forwards lifecycle to the client', async () => {
    const { connector, client } = setup();
    expect(connector.name).toBe('whatsapp');
    expect(connector.accountId).toBe('acct');
    expect((await connector.getStatus()).state).toBe('disconnected');
    await connector.connect();
    expect(client.calls.start).toBe(1);
    await connector.disconnect();
    expect((await connector.getStatus()).state).toBe('disconnected');
  });

  it('namespaces auth storage per account', async () => {
    const { connector, client, store } = setup();
    await connector.connect();
    await client.auth!.saveCreds({ registered: true });
    expect(await store.list('')).toEqual(['whatsapp/acct/auth/creds']);
  });

  it('emits connection.updated events', async () => {
    const { connector, client, events } = setup();
    await connector.connect();
    client.emitOpen();
    await flush();
    const types = events.map((e) => e.type);
    expect(types).toEqual(['connection.updated', 'connection.updated']);
    expect(events[1]).toMatchObject({
      connector: 'whatsapp',
      accountId: 'acct',
      payload: { state: 'connected' },
    });
    expect((await connector.getStatus()).detail).toMatchObject({ phoneNumber: '972509999999' });
  });

  it('gives connection.updated events distinct ids inside one millisecond', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const { connector, client, events } = setup();
    await connector.connect();
    client.emitOpen();
    await flush();
    const updates = events.filter((e) => e.type === 'connection.updated');
    expect(updates).toHaveLength(2);
    expect(updates.map((e) => e.externalId)).toEqual([
      '2026-01-01T00:00:00.000Z#0',
      '2026-01-01T00:00:00.000Z#1',
    ]);
    expect(new Set(updates.map((e) => e.id)).size).toBe(2);
    expect(updates[1]!.id).toBe('whatsapp:acct:connection.updated:2026-01-01T00:00:00.000Z#1');
  });

  it('counts dropped duplicates in getStatus detail', async () => {
    const { client, connector } = await connected();
    expect((await connector.getStatus()).detail).toMatchObject({ duplicatesDropped: 0 });
    client.emitMessages([text('M1'), text('M1')]);
    await flush();
    expect((await connector.getStatus()).detail).toMatchObject({ duplicatesDropped: 1 });
  });

  it('ignores message batches that land after a manual disconnect', async () => {
    const { client, connector, messages } = setup();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    client.startImpl = () => gate;

    const connecting = connector.connect();
    await connector.disconnect();
    release();
    await connecting;
    await flush();

    client.emitMessages([text('M1')]);
    await flush();
    expect(messages()).toHaveLength(0);
  });

  it('emits normalized message.received without raw by default', async () => {
    const { client, messages } = await connected();
    client.emitMessages([text('M1')]);
    await flush();
    expect(messages()).toHaveLength(1);
    const e = messages()[0]!;
    expect(e).toMatchObject({
      id: 'whatsapp:acct:message.received:M1',
      externalId: 'M1',
      type: 'message.received',
      payload: {
        messageId: 'M1',
        content: { kind: 'text', text: 'hello M1' },
        direction: 'inbound',
      },
    });
    expect(e.raw).toBeUndefined();
    expect(e.timestamp.getTime()).toBe(1_700_000_000_000);
  });

  it('attaches raw when includeRaw is set', async () => {
    const { client, messages } = await connected({ includeRaw: true });
    client.emitMessages([text('M1')]);
    await flush();
    expect(messages()[0]!.raw).toMatchObject({ key: { id: 'M1' } });
  });

  it('drops duplicates and history batches by default', async () => {
    const { client, messages } = await connected();
    client.emitMessages([text('M1'), text('M1')]);
    client.emitMessages([text('M1')]);
    client.emitMessages([text('H1')], 'append');
    await flush();
    expect(messages().map((e) => e.externalId)).toEqual(['M1']);
  });

  it('includes history when asked', async () => {
    const { client, messages } = await connected({ includeHistory: true });
    client.emitMessages([text('H1')], 'append');
    await flush();
    expect(messages().map((e) => e.externalId)).toEqual(['H1']);
  });

  it('emits message.sent for own messages unless disabled', async () => {
    const a = await connected();
    a.client.emitMessages([text('O1', { fromMe: true })]);
    await flush();
    expect(a.messages()[0]).toMatchObject({
      type: 'message.sent',
      payload: { direction: 'outbound', sender: { id: '972509999999@s.whatsapp.net' } },
    });

    const b = await connected({ includeOwnMessages: false });
    b.client.emitMessages([text('O1', { fromMe: true })]);
    await flush();
    expect(b.messages()).toHaveLength(0);
  });

  it('emits message.sent for messages sent through the connector even though the provider reports them as append', async () => {
    const { client, connector, messages } = await connected();
    const sent = await connector.sendText('972501234567', 'hi');
    const ownEcho: RawMessage = {
      key: { remoteJid: '972501234567@s.whatsapp.net', fromMe: true, id: sent.messageId },
      message: { conversation: 'hi' },
      messageTimestamp: 1_700_000_000,
    };
    // The provider echoes the connector's own send as an 'append' batch, alongside history noise.
    client.emitMessages([text('H1', { fromMe: true }), ownEcho], 'append');
    await flush();
    expect(messages().map((e) => [e.type, e.externalId])).toEqual([
      ['message.sent', sent.messageId],
    ]);
    // A second echo of the same id is a duplicate, not a second event.
    client.emitMessages([ownEcho], 'append');
    await flush();
    expect(messages()).toHaveLength(1);
  });

  it('isolates subscriber failures', async () => {
    const { client, connector, messages } = await connected();
    connector.subscribe(() => {
      throw new Error('consumer bug');
    });
    client.emitMessages([text('M1')]);
    await flush();
    expect(messages()).toHaveLength(1);
  });

  it('refuses to send when not connected', async () => {
    const { connector } = setup();
    await expect(connector.sendText('972501234567', 'hi')).rejects.toBeInstanceOf(
      NotConnectedError,
    );
  });

  it('sends text with chat id coercion and quoting from the cache', async () => {
    const { client, connector } = await connected();
    client.emitMessages([text('Q1')]);
    await flush();
    const sent = await connector.sendText('972501234567', 'hi', { quotedMessageId: 'Q1' });
    expect(client.calls.sentText[0]).toMatchObject({
      jid: '972501234567@s.whatsapp.net',
      text: 'hi',
      quoted: { key: { id: 'Q1' } },
    });
    expect(sent).toMatchObject({ messageId: 'SENT1', chatId: '972501234567@s.whatsapp.net' });
    expect(sent.timestamp).toBeInstanceOf(Date);
  });

  it('sends media', async () => {
    const { client, connector } = await connected();
    await connector.sendMedia('123@g.us', {
      kind: 'image',
      data: Buffer.from('img'),
      mimetype: 'image/png',
      caption: 'c',
    });
    expect(client.calls.sentMedia[0]).toMatchObject({
      jid: '123@g.us',
      media: { kind: 'image', mimetype: 'image/png', caption: 'c' },
    });
  });

  it('downloads media referenced by an event and describes cached media', async () => {
    const { client, connector, messages } = await connected();
    client.downloadImpl = () => Promise.resolve(Readable.from([Buffer.from('bytes')]));
    client.emitMessages([image('I1')]);
    await flush();
    const content = messages()[0]!.payload.content;
    expect(content.kind).toBe('image');
    if (content.kind !== 'image') throw new Error('unreachable');
    const stream = await connector.downloadMedia(content.media);
    expect(Buffer.concat(await stream.toArray()).toString()).toBe('bytes');
    expect(connector.describeMedia('I1')).toMatchObject({
      kind: 'image',
      mimetype: 'image/jpeg',
      sizeBytes: 10,
      messageId: 'I1',
    });
    expect(connector.describeMedia('nope')).toBeUndefined();
    await expect(connector.downloadMedia({ messageId: 'nope' })).rejects.toMatchObject({
      code: 'MEDIA_UNAVAILABLE',
    });
  });

  it('logout clears auth and reports logged_out', async () => {
    const { client, connector, store } = await connected();
    await client.auth!.saveCreds({ registered: true });
    await connector.logout();
    expect(client.calls.logout).toBe(1);
    expect(await store.list('')).toEqual([]);
    expect((await connector.getStatus()).state).toBe('logged_out');
  });
});
