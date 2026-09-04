import type { ConnectorEvent } from './events.js';
import type { ConnectorStatus } from './status.js';

export type Unsubscribe = () => void;

export interface Connector {
  readonly name: string;
  readonly accountId: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): Promise<ConnectorStatus>;
}

export type EventHandler<E> = (event: E) => void | Promise<void>;

/** Push-based connectors emit events as they arrive. */
export interface EventSource<E extends ConnectorEvent = ConnectorEvent> {
  subscribe(handler: EventHandler<E>): Unsubscribe;
}

/** Pull-based connectors return whatever is new when asked. */
export interface Pollable<E extends ConnectorEvent = ConnectorEvent> {
  poll(): Promise<E[]>;
}

export function isEventSource(c: Connector): c is Connector & EventSource {
  return typeof (c as Partial<EventSource>).subscribe === 'function';
}

export function isPollable(c: Connector): c is Connector & Pollable {
  return typeof (c as Partial<Pollable>).poll === 'function';
}
