import {
  MemoryStore,
  jsonCodec,
  noopLogger,
  type ConnectorEvent,
  type EventPublisher,
} from '@connectors/core';
import { describe, expect, it } from 'vitest';
import { InstanceManager, type InstanceDefinition } from './instance-manager.js';
import { FakeWhatsAppConnector } from './testing/fake-connector.js';

function setup(store = new MemoryStore()) {
  const connectors = new Map<string, FakeWhatsAppConnector>();
  const published: ConnectorEvent[] = [];
  // eslint-disable-next-line @typescript-eslint/require-await -- fake publisher implements an async interface synchronously
  const publisher: EventPublisher = { publish: async (e) => void published.push(e) };
  const manager = new InstanceManager({
    store,
    logger: noopLogger,
    connectorFactory: (def) => {
      const c = new FakeWhatsAppConnector(def.id);
      connectors.set(def.id, c);
      return c;
    },
    publisherFactory: (def) => (def.webhook ? publisher : undefined),
  });
  return { manager, connectors, published, store };
}

const event: ConnectorEvent = {
  id: 'e1',
  connector: 'whatsapp',
  accountId: 'x',
  externalId: '1',
  type: 'message.received',
  timestamp: new Date(),
  receivedAt: new Date(),
  payload: {},
};

describe('InstanceManager', () => {
  it('creates, persists and auto-connects an instance', async () => {
    const { manager, connectors, store } = setup();
    const inst = await manager.create({
      id: 'main',
      webhook: { url: 'https://h.test/x', secret: 's' },
    });
    expect(inst.definition).toMatchObject({
      id: 'main',
      desiredState: 'connected',
      pairing: { method: 'qr' },
    });
    expect(connectors.get('main')!.calls.connect).toBe(1);
    const stored = jsonCodec.decode<InstanceDefinition>(
      (await store.get('instances/main/definition'))!,
    );
    expect(stored).toMatchObject({
      id: 'main',
      desiredState: 'connected',
      webhook: { url: 'https://h.test/x', secret: 's' },
    });
    expect((await inst.view()).webhook).toEqual({ url: 'https://h.test/x', hasSecret: true });
  });

  it('generates ids, validates them and rejects duplicates', async () => {
    const { manager } = setup();
    const a = await manager.create({ autoConnect: false });
    expect(a.definition.id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(manager.create({ id: 'bad id!' })).rejects.toMatchObject({ statusCode: 400 });
    await manager.create({ id: 'dup', autoConnect: false });
    await expect(manager.create({ id: 'dup' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('reserves the id so concurrent creates yield exactly one 409', async () => {
    const { manager } = setup();
    const results = await Promise.allSettled([
      manager.create({ id: 'dup', autoConnect: false }),
      manager.create({ id: 'dup', autoConnect: false }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ statusCode: 409 });
    expect(manager.list().map((i) => i.definition.id)).toEqual(['dup']);
  });

  it('skips corrupt definitions during restore', async () => {
    const store = new MemoryStore();
    const first = setup(store);
    await first.manager.create({ id: 'good', autoConnect: false });
    await store.set('instances/bad/definition', new TextEncoder().encode('{not json'));

    const second = setup(store);
    await second.manager.restore();
    expect(second.manager.list().map((i) => i.definition.id)).toEqual(['good']);
  });

  it('forwards connector events to the publisher', async () => {
    const { manager, connectors, published } = setup();
    await manager.create({ id: 'main', webhook: { url: 'https://h.test/x' } });
    await connectors.get('main')!.emit(event as never);
    expect(published).toEqual([event]);
  });

  it('connect/disconnect update desiredState and the connector', async () => {
    const { manager, connectors, store } = setup();
    await manager.create({ id: 'main', autoConnect: false });
    expect(connectors.get('main')!.calls.connect).toBe(0);
    await manager.connect('main');
    expect(connectors.get('main')!.calls.connect).toBe(1);
    await manager.disconnect('main');
    expect(connectors.get('main')!.calls.disconnect).toBe(1);
    const stored = jsonCodec.decode<InstanceDefinition>(
      (await store.get('instances/main/definition'))!,
    );
    expect(stored.desiredState).toBe('disconnected');
    expect(manager.require('main').definition.desiredState).toBe('disconnected');
    expect(() => manager.require('nope')).toThrow(/not found/);
  });

  it('remove logs out, clears storage and forgets the instance', async () => {
    const { manager, connectors, store } = setup();
    await manager.create({ id: 'main' });
    await store.set('instances/main/whatsapp/main/auth/creds', new Uint8Array([1]));
    await manager.remove('main');
    expect(connectors.get('main')!.calls.logout).toBe(1);
    expect(await store.list('instances/')).toEqual([]);
    expect(manager.get('main')).toBeUndefined();
  });

  it('restores persisted instances and reconnects those that were connected', async () => {
    const store = new MemoryStore();
    const first = setup(store);
    await first.manager.create({ id: 'on' });
    await first.manager.create({ id: 'off', autoConnect: false });

    const second = setup(store);
    await second.manager.restore();
    expect(
      second.manager
        .list()
        .map((i) => i.definition.id)
        .sort(),
    ).toEqual(['off', 'on']);
    expect(second.connectors.get('on')!.calls.connect).toBe(1);
    expect(second.connectors.get('off')!.calls.connect).toBe(0);
  });

  it('shutdown disconnects everything without changing desiredState', async () => {
    const { manager, connectors, store } = setup();
    await manager.create({ id: 'main' });
    await manager.shutdown();
    expect(connectors.get('main')!.calls.disconnect).toBe(1);
    const stored = jsonCodec.decode<InstanceDefinition>(
      (await store.get('instances/main/definition'))!,
    );
    expect(stored.desiredState).toBe('connected');
  });
});
