import { createConnectorWithClient } from './connector.js';
import type { WhatsAppConnector, WhatsAppConnectorOptions } from './types.js';

export type * from './types.js';
export { ConnectionReplacedError, MediaUnavailableError, NotConnectedError } from './errors.js';
export type { MediaUnavailableReason } from './errors.js';

/** Creates a WhatsApp connector backed by the built-in provider client. */
export function createWhatsAppConnector(options: WhatsAppConnectorOptions): WhatsAppConnector {
  return createConnectorWithClient(options, {
    clientFactory: () => {
      throw new Error('Provider client not wired yet (Task 15)');
    },
  });
}
