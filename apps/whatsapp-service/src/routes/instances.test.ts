import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../testing/test-app.js';

describe('instance routes', () => {
  it('creates and reads an instance', async () => {
    const { app } = buildTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/instances',
      payload: { id: 'main', webhook: { url: 'https://h.test/x' } },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      id: 'main',
      desiredState: 'connected',
      status: { state: 'connected' },
      webhook: { url: 'https://h.test/x', hasSecret: false },
    });
    const read = await app.inject({ method: 'GET', url: '/instances/main' });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ id: 'main' });
    const status = await app.inject({ method: 'GET', url: '/instances/main/status' });
    expect(status.json()).toMatchObject({ state: 'connected' });
  });

  it('validates bodies and reports conflicts', async () => {
    const { app } = buildTestApp();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/instances',
          payload: { webhook: { url: 'nope' } },
        })
      ).statusCode,
    ).toBe(400);
    await app.inject({ method: 'POST', url: '/instances', payload: { id: 'dup' } });
    const dup = await app.inject({ method: 'POST', url: '/instances', payload: { id: 'dup' } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('404s for unknown instances', async () => {
    const { app } = buildTestApp();
    for (const url of ['/instances/x', '/instances/x/status', '/instances/x/pairing']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: 'POST', url: '/instances/x/connect' })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: 'DELETE', url: '/instances/x' })).statusCode).toBe(404);
  });

  it('connect, pairing, disconnect and delete', async () => {
    const { app, connectors } = buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/instances',
      payload: { id: 'main', autoConnect: false },
    });
    connectors.get('main')!.connectBehavior = 'pair';
    const none = await app.inject({ method: 'GET', url: '/instances/main/pairing' });
    expect(none.statusCode).toBe(204);
    const connect = await app.inject({ method: 'POST', url: '/instances/main/connect' });
    expect(connect.statusCode).toBe(202);
    expect(connect.json()).toMatchObject({ state: 'pairing' });
    const pairing = await app.inject({ method: 'GET', url: '/instances/main/pairing' });
    expect(pairing.statusCode).toBe(200);
    expect(pairing.json()).toMatchObject({
      method: 'qr',
      qr: { raw: 'QR-RAW' },
      issuedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(pairing.json<{ qr: { dataUrl: string } }>().qr.dataUrl).toMatch(
      /^data:image\/png;base64,/,
    );
    const disconnect = await app.inject({ method: 'POST', url: '/instances/main/disconnect' });
    expect(disconnect.statusCode).toBe(200);
    expect(disconnect.json()).toMatchObject({ state: 'disconnected' });
    const del = await app.inject({ method: 'DELETE', url: '/instances/main' });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/instances/main' })).statusCode).toBe(404);
  });
});
