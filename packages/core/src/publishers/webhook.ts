import { createHmac, randomUUID } from 'node:crypto';
import { exponentialBackoff, type BackoffPolicy } from '../backoff.js';
import { PublishError } from '../errors.js';
import type { ConnectorEvent } from '../events.js';
import { noopLogger, type Logger } from '../logger.js';
import { sleep } from '../sleep.js';
import type { EventPublisher } from './publisher.js';

export interface WebhookPublisherOptions {
  url: string;
  /** HMAC-SHA256 secret. Header: X-Connectors-Signature: sha256=<hex>. */
  secret?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  backoff?: BackoffPolicy;
  fetch?: typeof fetch;
  logger?: Logger;
}

export function signWebhookBody(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function shouldRetry(status: number): boolean {
  return status >= 500 || status === 429;
}

export function createWebhookPublisher(options: WebhookPublisherOptions): EventPublisher {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxAttempts = options.maxAttempts ?? 3;
  const backoff = exponentialBackoff({ initialMs: 500, maxMs: 10_000, ...options.backoff });
  const logger = (options.logger ?? noopLogger).child({ component: 'webhook-publisher' });

  return {
    async publish(event: ConnectorEvent): Promise<void> {
      const body = JSON.stringify(event);
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-connectors-event': event.type,
        'x-connectors-delivery': randomUUID(),
      };
      if (options.secret) headers['x-connectors-signature'] = signWebhookBody(options.secret, body);

      let lastStatus: number | undefined;
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await fetchFn(options.url, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (res.ok) return;
          lastStatus = res.status;
          lastError = undefined;
          if (!shouldRetry(res.status)) {
            throw new PublishError(`Webhook rejected event with status ${res.status}`, {
              details: { attempts: attempt, lastStatus: res.status, eventId: event.id },
            });
          }
        } catch (err) {
          if (err instanceof PublishError) throw err;
          lastError = err;
          lastStatus = undefined;
        }
        logger.warn(
          { attempt, maxAttempts, eventId: event.id, status: lastStatus, err: lastError },
          'webhook delivery attempt failed',
        );
        if (attempt < maxAttempts) await sleep(backoff.delayFor(attempt));
      }
      throw new PublishError(`Webhook delivery failed after ${maxAttempts} attempts`, {
        cause: lastError,
        details: { attempts: maxAttempts, lastStatus, eventId: event.id },
      });
    },
  };
}
