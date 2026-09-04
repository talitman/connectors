import { BaileysClient } from './client/baileys-client.js';
import { createConnectorWithClient } from './connector.js';
import type { WhatsAppConnector, WhatsAppConnectorOptions } from './types.js';

export type * from './types.js';
export { ConnectionReplacedError, MediaUnavailableError, NotConnectedError } from './errors.js';
export type { MediaUnavailableReason } from './errors.js';

/** Creates a WhatsApp connector backed by Baileys. Consumers never touch Baileys directly. */
export function createWhatsAppConnector(options: WhatsAppConnectorOptions): WhatsAppConnector {
  return createConnectorWithClient(options, { clientFactory: (ctx) => new BaileysClient(ctx) });
}
