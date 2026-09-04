import { timingSafeEqual } from 'node:crypto';
import type { onRequestHookHandler } from 'fastify';
import { UnauthorizedError } from './errors.js';

function equal(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function apiKeyHook(apiKey: string | undefined): onRequestHookHandler {
  return (request, _reply, done) => {
    if (!apiKey || request.url === '/health' || request.url.startsWith('/health?')) {
      done();
      return;
    }
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    done(token && equal(token, apiKey) ? undefined : new UnauthorizedError());
  };
}
