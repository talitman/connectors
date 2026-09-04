import { createWebhookPublisher, type EventPublisher, type Logger } from '@connectors/core';
import type { ServiceConfig } from './config.js';
import type { InstanceDefinition } from './instance.js';

export function createPublisherFactory(
  config: Partial<Pick<ServiceConfig, 'WEBHOOK_URL' | 'WEBHOOK_SECRET'>>,
  logger: Logger,
): (definition: InstanceDefinition) => EventPublisher | undefined {
  return (definition) => {
    const url = definition.webhook?.url ?? config.WEBHOOK_URL;
    if (!url) return undefined;
    const secret = definition.webhook ? definition.webhook.secret : config.WEBHOOK_SECRET;
    return createWebhookPublisher({
      url,
      ...(secret ? { secret } : {}),
      logger: logger.child({ instanceId: definition.id }),
    });
  };
}
