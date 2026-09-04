export type DisconnectPolicy = 'reconnect-now' | 'reconnect-backoff' | 'logged-out' | 'stop';

/**
 * WhatsApp close codes: 515 restart required (normal after pairing), 401/403/419 logged out,
 * 500 bad session, 440 replaced by another session, everything else transient.
 */
export function policyFor(statusCode?: number): DisconnectPolicy {
  switch (statusCode) {
    case 515:
      return 'reconnect-now';
    case 401:
    case 403:
    case 419:
    case 500:
      return 'logged-out';
    case 440:
      return 'stop';
    default:
      return 'reconnect-backoff';
  }
}
