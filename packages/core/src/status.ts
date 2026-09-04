export type ConnectorState =
  'disconnected' | 'connecting' | 'pairing' | 'connected' | 'reconnecting' | 'logged_out';

export interface StatusError {
  code: string;
  message: string;
  retryable: boolean;
  at: Date;
}

export interface ConnectorStatus {
  state: ConnectorState;
  since: Date;
  lastError?: StatusError;
  detail?: Record<string, unknown>;
}

export type HealthState = 'healthy' | 'degraded' | 'unhealthy';

export function healthFromStatus(status: ConnectorStatus): HealthState {
  switch (status.state) {
    case 'connected':
      return 'healthy';
    case 'connecting':
    case 'pairing':
    case 'reconnecting':
      return 'degraded';
    case 'disconnected':
    case 'logged_out':
      return 'unhealthy';
  }
}
