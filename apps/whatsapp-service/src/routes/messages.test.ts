import { describe, expect, it, vi } from 'vitest';
import { buildTestApp } from '../testing/test-app.js';

async function setup(fetchImpl?: typeof fetch) {
  const { app, manager, connectors } = buildTestApp(fetchImpl ? { fetch: fetchImpl } : {});
  await manager.create({ id: 'main' });
  return { app, connector: connectors.get('main')! };
}

describe('POST /instances/:id/messages', () => {
  it('sends text', async () => {
    const { app, connector } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/instances/main/messages',
      payload: { to: '972501234567', type: 'text', text: 'hi', quotedMessageId: 'Q' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      messageId: 'SENT1',
      chatId: '972501234567',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(connector.calls.sentText[0]).toEqual({
      chatId: '972501234567',
      text: 'hi',
      options: { quotedMessageId: 'Q' },
    });
  });

  it('sends base64 media', async () => {
    const { app, connector } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/instances/main/messages',
      payload: {
        to: '1@g.us',
        type: 'audio',
        mimetype: 'audio/ogg; codecs=opus',
        base64: Buffer.from('oga').toString('base64'),
        voiceNote: true,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(connector.calls.sentMedia[0]).toMatchObject({
      chatId: '1@g.us',
      media: { kind: 'audio', mimetype: 'audio/ogg; codecs=opus', data: 'oga', voiceNote: true },
    });
  });

  it('fetches media from a url', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('pdfbytes', { status: 200 })),
    ) as unknown as typeof fetch;
    const { app, connector } = await setup(fetchImpl);
    const res = await app.inject({
      method: 'POST',
      url: '/instances/main/messages',
      payload: {
        to: '972501234567',
        type: 'document',
        mimetype: 'application/pdf',
        url: 'https://files.test/a.pdf',
        fileName: 'a.pdf',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(connector.calls.sentMedia[0]).toMatchObject({
      media: { kind: 'document', fileName: 'a.pdf', data: 'pdfbytes' },
    });
  });

  it('rejects invalid bodies and unreachable urls', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    ) as unknown as typeof fetch;
    const { app } = await setup(fetchImpl);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/instances/main/messages',
          payload: { to: 'x', type: 'text' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/instances/main/messages',
          payload: { to: 'x', type: 'image', mimetype: 'image/png' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/instances/main/messages',
          payload: { to: 'x', type: 'document', mimetype: 'application/pdf', base64: 'AA==' },
        })
      ).statusCode,
    ).toBe(400);
    const bad = await app.inject({
      method: 'POST',
      url: '/instances/main/messages',
      payload: {
        to: 'x',
        type: 'image',
        mimetype: 'image/png',
        url: 'https://files.test/missing.png',
      },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'MEDIA_FETCH_FAILED' } });
  });

  it('returns 409 when the instance is not connected', async () => {
    const { app, connector } = await setup();
    await connector.disconnect();
    const res = await app.inject({
      method: 'POST',
      url: '/instances/main/messages',
      payload: { to: 'x', type: 'text', text: 'hi' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_CONNECTED' } });
  });
});
