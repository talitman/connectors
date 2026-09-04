import { describe, expect, it } from 'vitest';
import { loadServiceConfig } from './config.js';
import { buildServer } from './server.js';
import { createPinoLogger } from '@connectors/observability';
import { FakeWhatsAppConnector } from './testing/fake-connector.js';

function app(env: Record<string, string> = {}, instances: FakeWhatsAppConnector[] = []) {
  const manager = {
    list: () => instances.map((connector, i) => ({ definition: { id: `i${i}` }, connector })),
  };
  return buildServer({
    manager,
    config: loadServiceConfig(env),
    logger: createPinoLogger({ level: 'silent' }),
  });
}

describe('server basics', () => {
  it('reports health with instance counts', async () => {
    const a = new FakeWhatsAppConnector('a');
    const b = new FakeWhatsAppConnector('b');
    await a.connect();
    const res = await app({}, [a, b]).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', instances: { total: 2, connected: 1 } });
  });

  it('enforces the API key everywhere except /health', async () => {
    const server = app({ API_KEY: 'topsecret' });
    expect((await server.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const denied = await server.inject({ method: 'GET', url: '/instances/x' });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid API key', retryable: false },
    });
    const wrong = await server.inject({
      method: 'GET',
      url: '/instances/x',
      headers: { authorization: 'Bearer nope' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await app().inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
