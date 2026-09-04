import { FileStore } from '@connectors/core';
import { createPinoLogger } from '@connectors/observability';
import { createWhatsAppConnector } from '@connectors/whatsapp';
import { loadServiceConfig } from './config.js';
import { InstanceManager } from './instance-manager.js';
import { createPublisherFactory } from './publishers.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadServiceConfig();
  const logger = createPinoLogger({
    name: 'whatsapp-service',
    level: config.LOG_LEVEL,
    pretty: config.LOG_PRETTY,
  });
  const store = new FileStore(config.DATA_DIR);

  const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!config.API_KEY && !LOOPBACK.has(config.HOST)) {
    logger.warn(
      { host: config.HOST },
      'API_KEY is not set and HOST is not loopback: the API is reachable without authentication',
    );
  }

  const manager = new InstanceManager({
    store,
    logger,
    connectorFactory: (definition, authStore) =>
      createWhatsAppConnector({
        accountId: definition.id,
        storage: { auth: authStore },
        logger,
        pairing: definition.pairing,
        fetchLatestVersion: config.WA_FETCH_LATEST_VERSION,
      }),
    publisherFactory: createPublisherFactory(config, logger),
  });

  const app = buildServer({ manager, config, logger });
  await app.listen({ port: config.PORT, host: config.HOST });
  await manager.restore();
  logger.info(
    { port: config.PORT, host: config.HOST, dataDir: config.DATA_DIR },
    'whatsapp-service started',
  );

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    void (async () => {
      await app.close();
      await manager.shutdown();
      process.exit(0);
    })().catch((err: unknown) => {
      logger.error({ err }, 'shutdown failed');
      process.exit(1);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
