import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorEvent } from '../events.js';
import { PublishError } from '../errors.js';
import { createWebhookPublisher, signWebhookBody } from './webhook.js';

const event: ConnectorEvent = {
  id: 'whatsapp:a:message.received:1',
  connector: 'whatsapp',
  accountId: 'a',
  externalId: '1',
  type: 'message.received',
  timestamp: new Date('2026-01-01T00:00:00Z'),
  receivedAt: new Date('2026-01-01T00:00:01Z'),
  payload: { hello: 'world' },
};

function fakeFetch(responses: Array<number | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const urlStr = url instanceof Request ? url.url : url instanceof URL ? url.href : `${url}`;
    calls.push({ url: urlStr, init: init ?? {} });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return Promise.resolve(new Response(null, { status: next ?? 200 }));
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

describe('createWebhookPublisher', () => {
  it('posts JSON with event headers and a signature', async () => {
    const { fetchFn, calls } = fakeFetch([200]);
    const publisher = createWebhookPublisher({
      url: 'https://example.test/hook',
      secret: 's3',
      fetch: fetchFn,
    });
    await publisher.publish(event);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe('https://example.test/hook');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-connectors-event')).toBe('message.received');
    expect(headers.get('x-connectors-delivery')).toMatch(/[0-9a-f-]{36}/);
    const body = init.body as string;
    expect(JSON.parse(body)).toMatchObject({ id: event.id, timestamp: '2026-01-01T00:00:00.000Z' });
    const expected = 'sha256=' + createHmac('sha256', 's3').update(body).digest('hex');
    expect(headers.get('x-connectors-signature')).toBe(expected);
    expect(signWebhookBody('s3', body)).toBe(expected);
  });

  it('omits the signature header without a secret', async () => {
    const { fetchFn, calls } = fakeFetch([200]);
    await createWebhookPublisher({ url: 'https://x.test', fetch: fetchFn }).publish(event);
    expect(new Headers(calls[0]!.init.headers).has('x-connectors-signature')).toBe(false);
  });

  it('retries on 5xx, 429 and network errors, then succeeds', async () => {
    const { fetchFn, calls } = fakeFetch([500, 429, new Error('ECONNRESET'), 204]);
    const publisher = createWebhookPublisher({
      url: 'https://x.test',
      fetch: fetchFn,
      maxAttempts: 4,
      backoff: { initialMs: 0, jitter: 0 },
    });
    await publisher.publish(event);
    expect(calls).toHaveLength(4);
  });

  it('does not retry other 4xx', async () => {
    const { fetchFn, calls } = fakeFetch([400]);
    const publisher = createWebhookPublisher({
      url: 'https://x.test',
      fetch: fetchFn,
      maxAttempts: 3,
    });
    await expect(publisher.publish(event)).rejects.toBeInstanceOf(PublishError);
    expect(calls).toHaveLength(1);
  });

  it('gives up after maxAttempts with a PublishError', async () => {
    const { fetchFn, calls } = fakeFetch([503, 503, 503]);
    const publisher = createWebhookPublisher({
      url: 'https://x.test',
      fetch: fetchFn,
      maxAttempts: 3,
      backoff: { initialMs: 0, jitter: 0 },
    });
    await expect(publisher.publish(event)).rejects.toMatchObject({
      code: 'PUBLISH_FAILED',
      details: { attempts: 3, lastStatus: 503 },
    });
    expect(calls).toHaveLength(3);
  });

  it('passes an abort signal with the timeout', async () => {
    const { fetchFn, calls } = fakeFetch([200]);
    await createWebhookPublisher({ url: 'https://x.test', fetch: fetchFn, timeoutMs: 5 }).publish(
      event,
    );
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });
});
