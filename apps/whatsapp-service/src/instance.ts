import type { ConnectorStatus, EventPublisher, Logger, Unsubscribe } from '@connectors/core';
import type { PairingMethod, WhatsAppConnector } from '@connectors/whatsapp';

export interface InstanceDefinition {
  id: string;
  createdAt: string;
  webhook?: { url: string; secret?: string | undefined };
  pairing: PairingMethod;
  desiredState: 'connected' | 'disconnected';
}

export interface InstanceView {
  id: string;
  createdAt: string;
  webhook?: { url: string; hasSecret: boolean };
  pairing: PairingMethod;
  desiredState: 'connected' | 'disconnected';
  status: ConnectorStatus;
}

export class Instance {
  private readonly unsubscribe: Unsubscribe;

  constructor(
    readonly definition: InstanceDefinition,
    readonly connector: WhatsAppConnector,
    private readonly publisher: EventPublisher | undefined,
    logger: Logger,
  ) {
    const log = logger.child({ instanceId: definition.id });
    this.unsubscribe = connector.subscribe(async (event) => {
      if (!this.publisher) return;
      try {
        await this.publisher.publish(event);
      } catch (err) {
        log.warn({ err, eventId: event.id, type: event.type }, 'event delivery failed');
      }
    });
  }

  async view(): Promise<InstanceView> {
    const { id, createdAt, pairing, desiredState, webhook } = this.definition;
    return {
      id,
      createdAt,
      ...(webhook ? { webhook: { url: webhook.url, hasSecret: Boolean(webhook.secret) } } : {}),
      pairing,
      desiredState,
      status: await this.connector.getStatus(),
    };
  }

  close(): void {
    this.unsubscribe();
    void this.publisher?.close?.();
  }
}
