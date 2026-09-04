import { describe, expect, it } from 'vitest';
import { buildTestApp } from './testing/test-app.js';

describe('server basics', () => {
  it('reports health with instance counts', async () => {
    const { app } = buildTestApp();
    await app.inject({ method: 'POST', url: '/instances', payload: { id: 'a' } });
    await app.inject({
      method: 'POST',
      url: '/instances',
      payload: { id: 'b', autoConnect: false },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', instances: { total: 2, connected: 1 } });
  });

  it('enforces the API key everywhere except /health', async () => {
    const { app: server } = buildTestApp({ env: { API_KEY: 'topsecret' } });
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

  it('returns a JSON 400 for malformed and empty JSON bodies', async () => {
    const { app } = buildTestApp();
    const bad = await app.inject({
      method: 'POST',
      url: '/instances',
      payload: '{not json',
      headers: { 'content-type': 'application/json' },
    });
    expect(bad.statusCode).toBe(400);
    const body = bad.json<{ error: { code: string; retryable: boolean } }>();
    expect(body.error.retryable).toBe(false);
    expect(body.error.code).not.toBe('INTERNAL');

    const empty = await app.inject({
      method: 'POST',
      url: '/instances',
      payload: '',
      headers: { 'content-type': 'application/json' },
    });
    expect(empty.statusCode).toBe(400);
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
