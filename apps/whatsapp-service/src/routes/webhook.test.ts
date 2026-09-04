import { signWebhookBody, type ConnectorEvent } from '@connectors/core';
import { describe, expect, it, vi } from 'vitest';
import { buildTestApp } from '../testing/test-app.js';

const event: ConnectorEvent = {
  id: 'whatsapp:main:message.received:M1',
  connector: 'whatsapp',
  accountId: 'main',
  externalId: 'M1',
  type: 'message.received',
  timestamp: new Date('2026-01-01T00:00:00Z'),
  receivedAt: new Date('2026-01-01T00:00:01Z'),
  payload: { messageId: 'M1' },
};

describe('service -> webhook delivery', () => {
  it('signs and POSTs connector events to the instance webhook', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn((url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch;

    const { app, manager, connectors } = buildTestApp({ fetch: fetchImpl });
    const created = await app.inject({
      method: 'POST',
      url: '/instances',
      payload: { id: 'main', webhook: { url: 'https://hook.test/x', secret: 's' } },
    });
    expect(created.statusCode).toBe(201);
    expect(manager.get('main')).toBeDefined();

    await connectors.get('main')!.emit(event as never);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe('https://hook.test/x');
    expect(call!.init.method).toBe('POST');
    const headers = call!.init.headers as Record<string, string>;
    const body = call!.init.body as string;
    expect(headers['x-connectors-event']).toBe('message.received');
    expect(headers['x-connectors-signature']).toBe(signWebhookBody('s', body));
    expect(headers['x-connectors-delivery']).toEqual(expect.any(String));
    expect(JSON.parse(body)).toMatchObject({ id: 'whatsapp:main:message.received:M1' });
  });

  it('does not build a publisher when the instance has no webhook', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    ) as unknown as typeof fetch;
    const { manager, connectors } = buildTestApp({ fetch: fetchImpl });
    await manager.create({ id: 'plain' });
    await connectors.get('plain')!.emit(event as never);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
