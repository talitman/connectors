import type { ConnectorEvent } from '../events.js';

export interface EventPublisher {
  publish(event: ConnectorEvent): Promise<void>;
  close?(): Promise<void>;
}
