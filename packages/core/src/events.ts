export interface ConnectorEvent<TPayload = unknown> {
  /** Stable dedupe key, see buildEventId. */
  id: string;
  connector: string;
  accountId: string;
  /** Provider-side identifier (message id, etc). */
  externalId: string;
  /** Dotted event type, e.g. 'message.received'. */
  type: string;
  /** Provider timestamp. */
  timestamp: Date;
  /** When the connector produced the event. */
  receivedAt: Date;
  payload: TPayload;
  /** Opaque provider payload, present only when the consumer opted in. */
  raw?: unknown;
}

export function buildEventId(parts: {
  connector: string;
  accountId: string;
  type: string;
  externalId: string;
}): string {
  return `${parts.connector}:${parts.accountId}:${parts.type}:${parts.externalId}`;
}
