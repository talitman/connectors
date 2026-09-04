import { MemoryStore, noopLogger } from '@connectors/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthStore } from '../auth/auth-state.js';
import { resolveOptions } from '../options.js';
import { FakeWhatsAppClient } from '../testing/fake-client.js';
import type { WhatsAppConnectorOptions } from '../types.js';
import { ConnectionManager } from './state-machine.js';

function setup(overrides: Partial<WhatsAppConnectorOptions> = {}) {
  const client = new FakeWhatsAppClient();
  const store = new MemoryStore();
  const auth = createAuthStore(store);
  const options = resolveOptions({
    accountId: 'a',
    storage: { auth: store },
    reconnect: { initialDelayMs: 100, maxDelayMs: 1000 },
    ...overrides,
  });
  const manager = new ConnectionManager({
    client,
    auth,
    logger: noopLogger,
    options,
    random: () => 0.5,
  });
  const states: string[] = [];
  manager.onStatus((s) => states.push(s.state));
  return { client, store, auth, options, manager, states };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('ConnectionManager', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('walks connecting -> pairing (qr) -> connected', async () => {
    const { client, manager, states } = setup();
    const pairings: unknown[] = [];
    manager.onPairing((p) => pairings.push(p));
    await manager.connect();
    expect(client.calls.start).toBe(1);
    expect(manager.getStatus().state).toBe('connecting');
    client.emitQr('QR1');
    expect(manager.getStatus().state).toBe('pairing');
    expect(manager.getPairing()).toMatchObject({ method: 'qr', qr: 'QR1' });
    client.emitQr('QR2');
    expect(manager.getPairing()).toMatchObject({ method: 'qr', qr: 'QR2' });
    expect(pairings).toHaveLength(2);
    client.emitOpen();
    expect(manager.getStatus().state).toBe('connected');
    expect(manager.getPairing()).toBeNull();
    expect(states).toEqual(['connecting', 'pairing', 'connected']);
  });

  it('ignores qr updates once registered and connect() is idempotent', async () => {
    const { client, manager } = setup();
    client.registered = true;
    await manager.connect();
    await manager.connect();
    expect(client.calls.start).toBe(1);
    client.emitQr();
    expect(manager.getStatus().state).toBe('connecting');
  });

  it('requests a pairing code once per socket when method is code', async () => {
    const { client, manager } = setup({ pairing: { method: 'code', phoneNumber: '972501234567' } });
    await manager.connect();
    client.emitQr();
    client.emitQr();
    await flush();
    expect(client.calls.pairingCodes).toEqual(['972501234567']);
    expect(manager.getPairing()).toMatchObject({
      method: 'code',
      code: 'ABCD-EFGH',
      phoneNumber: '972501234567',
    });
    // QR timeout (408) restarts the socket; the code must be requested again on the new socket.
    client.emitClose(408);
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(client.calls.start).toBe(2);
    client.emitQr();
    await flush();
    expect(client.calls.pairingCodes).toHaveLength(2);
  });

  it('restarts immediately on 515', async () => {
    const { client, manager, states } = setup();
    await manager.connect();
    client.emitOpen();
    client.emitClose(515);
    await flush();
    expect(client.calls.stop).toBe(1);
    expect(client.calls.start).toBe(2);
    expect(states).toEqual(['connecting', 'connected', 'reconnecting', 'connecting']);
    client.emitOpen();
    expect(manager.getStatus().state).toBe('connected');
  });

  it('clears auth and stops on 401', async () => {
    const { client, manager, store } = setup();
    await store.set('creds', new Uint8Array([1]));
    await manager.connect();
    client.emitClose(401);
    await flush();
    const status = manager.getStatus();
    expect(status.state).toBe('logged_out');
    expect(status.lastError).toMatchObject({ code: 'AUTH_REQUIRED', retryable: false });
    expect(await store.list('')).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.calls.start).toBe(1);
  });

  it('stops on 440 without touching auth', async () => {
    const { client, manager, store } = setup();
    await store.set('creds', new Uint8Array([1]));
    await manager.connect();
    client.emitClose(440);
    await flush();
    expect(manager.getStatus()).toMatchObject({
      state: 'disconnected',
      lastError: { code: 'CONNECTION_REPLACED' },
    });
    expect(await store.list('')).toEqual(['creds']);
    expect(client.calls.start).toBe(1);
  });

  it('reconnects with exponential backoff on other closes', async () => {
    const { client, manager } = setup();
    await manager.connect();
    client.emitClose(428);
    await flush();
    expect(manager.getStatus()).toMatchObject({
      state: 'reconnecting',
      lastError: { code: 'CONNECTION_LOST', retryable: true },
      detail: { reconnectAttempt: 1 },
    });
    await vi.advanceTimersByTimeAsync(99);
    expect(client.calls.start).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(client.calls.start).toBe(2);
    client.emitClose();
    await flush();
    await vi.advanceTimersByTimeAsync(199);
    expect(client.calls.start).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(client.calls.start).toBe(3);
    client.emitOpen();
    expect(manager.getStatus().detail).toMatchObject({ reconnectAttempt: 0 });
  });

  it('gives up after maxAttempts', async () => {
    const { client, manager } = setup({ reconnect: { initialDelayMs: 10, maxAttempts: 2 } });
    await manager.connect();
    client.emitClose(428);
    await vi.advanceTimersByTimeAsync(10);
    await flush();
    client.emitClose(428);
    await vi.advanceTimersByTimeAsync(20);
    await flush();
    client.emitClose(428);
    await flush();
    expect(manager.getStatus()).toMatchObject({
      state: 'disconnected',
      lastError: { retryable: true },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.calls.start).toBe(3);
  });

  it('disconnect() cancels a pending reconnect and ignores late close events', async () => {
    const { client, manager } = setup();
    await manager.connect();
    client.emitClose(428);
    await flush();
    await manager.disconnect();
    expect(manager.getStatus().state).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.calls.start).toBe(1);
    client.emitClose(428);
    await flush();
    expect(manager.getStatus().state).toBe('disconnected');
    expect(client.calls.start).toBe(1);
  });

  it('logout() unlinks, clears auth and lands in logged_out', async () => {
    const { client, manager, store } = setup();
    await store.set('creds', new Uint8Array([1]));
    await manager.connect();
    client.emitOpen();
    await manager.logout();
    expect(client.calls.logout).toBe(1);
    expect(client.calls.stop).toBe(1);
    expect(await store.list('')).toEqual([]);
    expect(manager.getStatus().state).toBe('logged_out');
  });

  it('treats a failing start() as a close', async () => {
    const { client, manager } = setup();
    // eslint-disable-next-line @typescript-eslint/require-await -- startImpl is typed () => Promise<void>; this stub rejects by throwing
    client.startImpl = async () => {
      throw Object.assign(new Error('boom'), { output: { statusCode: 503 } });
    };
    await manager.connect();
    await flush();
    expect(manager.getStatus()).toMatchObject({
      state: 'reconnecting',
      lastError: { code: 'CONNECTION_LOST' },
    });
  });
});
