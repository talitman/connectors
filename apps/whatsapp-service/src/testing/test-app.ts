import { MemoryStore, noopLogger } from '@connectors/core';
import { createPinoLogger } from '@connectors/observability';
import { loadServiceConfig } from '../config.js';
import { InstanceManager } from '../instance-manager.js';
import { buildServer, type WhatsAppServiceApp } from '../server.js';
import { FakeWhatsAppConnector } from './fake-connector.js';

export interface TestAppOptions {
  env?: Record<string, string>;
  /** Injected into buildServer; used by routes that call out over HTTP (media-by-url, webhooks). */
  fetch?: typeof fetch;
}

export interface TestApp {
  app: WhatsAppServiceApp;
  manager: InstanceManager;
  connectors: Map<string, FakeWhatsAppConnector>;
}

/** Builds a real InstanceManager (in-memory store, fake connectors, no publisher) behind a real server. */
export function buildTestApp(options: TestAppOptions = {}): TestApp {
  const connectors = new Map<string, FakeWhatsAppConnector>();
  const manager = new InstanceManager({
    store: new MemoryStore(),
    logger: noopLogger,
    connectorFactory: (definition) => {
      const connector = new FakeWhatsAppConnector(definition.id);
      connectors.set(definition.id, connector);
      return connector;
    },
    publisherFactory: () => undefined,
  });
  const app = buildServer({
    manager,
    config: loadServiceConfig(options.env ?? {}),
    logger: createPinoLogger({ level: 'silent' }),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return { app, manager, connectors };
}
