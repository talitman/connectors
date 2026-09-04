import {
  exponentialBackoff,
  type Backoff,
  type ConnectorError,
  type ConnectorState,
  type ConnectorStatus,
  type Logger,
  type Unsubscribe,
} from '@connectors/core';
import type { AuthStore, ClientConnectionUpdate, WhatsAppClient } from '../client/types.js';
import { mapDisconnectError, statusCodeOf } from '../errors.js';
import type { ResolvedOptions } from '../options.js';
import type { PairingState } from '../types.js';
import { policyFor } from './disconnect-reason.js';

export interface ConnectionManagerDeps {
  client: WhatsAppClient;
  auth: AuthStore;
  logger: Logger;
  options: ResolvedOptions;
  random?: () => number;
}

export class ConnectionManager {
  private status: ConnectorStatus = { state: 'disconnected', since: new Date() };
  private pairing: PairingState | null = null;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private manualStop = false;
  private pairingCodeRequested = false;
  private readonly backoff: Backoff;
  private readonly logger: Logger;
  private readonly statusListeners = new Set<(status: ConnectorStatus) => void>();
  private readonly pairingListeners = new Set<(pairing: PairingState) => void>();

  constructor(private readonly deps: ConnectionManagerDeps) {
    this.logger = deps.logger.child({ component: 'connection' });
    const random = deps.random;
    this.backoff = exponentialBackoff({
      initialMs: deps.options.reconnect.initialDelayMs,
      maxMs: deps.options.reconnect.maxDelayMs,
      ...(random ? { random } : {}),
    });
    deps.client.on('connection', (update) => this.onConnection(update));
    deps.client.on('qr', (qr) => this.onQr(qr));
  }

  getStatus(): ConnectorStatus {
    return { ...this.status, ...(this.status.detail ? { detail: { ...this.status.detail } } : {}) };
  }

  getPairing(): PairingState | null {
    return this.pairing;
  }

  onStatus(listener: (status: ConnectorStatus) => void): Unsubscribe {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onPairing(listener: (pairing: PairingState) => void): Unsubscribe {
    this.pairingListeners.add(listener);
    return () => this.pairingListeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (this.status.state !== 'disconnected' && this.status.state !== 'logged_out') return;
    this.manualStop = false;
    this.attempt = 0;
    this.pairingCodeRequested = false;
    this.setState('connecting');
    await this.startClient();
  }

  async disconnect(): Promise<void> {
    this.manualStop = true;
    this.clearTimer();
    this.pairing = null;
    await this.deps.client.stop();
    this.setState('disconnected');
  }

  async logout(): Promise<void> {
    this.manualStop = true;
    this.clearTimer();
    this.pairing = null;
    try {
      await this.deps.client.logout();
    } catch (err) {
      this.logger.warn({ err }, 'logout request failed; clearing local auth anyway');
    }
    await this.deps.client.stop();
    await this.deps.auth.clear();
    this.setState('logged_out');
  }

  private async startClient(): Promise<void> {
    try {
      await this.deps.client.start(this.deps.auth);
    } catch (err) {
      this.logger.error({ err }, 'failed to start WhatsApp client');
      await this.handleClose(statusCodeOf(err), err);
    }
  }

  private onQr(qr: string): void {
    if (this.manualStop || this.deps.client.isRegistered()) return;
    if (this.status.state !== 'pairing') this.setState('pairing');
    const pairing = this.deps.options.pairing;
    if (pairing.method === 'qr') {
      this.setPairing({ method: 'qr', qr, issuedAt: new Date() });
      return;
    }
    if (this.pairingCodeRequested) return;
    this.pairingCodeRequested = true;
    this.deps.client
      .requestPairingCode(pairing.phoneNumber)
      .then((code) => {
        if (this.manualStop) return;
        this.setPairing({
          method: 'code',
          code,
          phoneNumber: pairing.phoneNumber,
          issuedAt: new Date(),
        });
      })
      .catch((err: unknown) => {
        this.logger.error({ err }, 'pairing code request failed');
        this.pairingCodeRequested = false;
      });
  }

  private onConnection(update: ClientConnectionUpdate): void {
    if (this.manualStop) return;
    switch (update.status) {
      case 'connecting':
        if (this.status.state !== 'pairing' && this.status.state !== 'connecting')
          this.setState('connecting');
        return;
      case 'open':
        this.attempt = 0;
        this.pairing = null;
        this.pairingCodeRequested = false;
        this.setState('connected');
        return;
      case 'close':
        void this.handleClose(update.statusCode, update.error);
        return;
    }
  }

  private async handleClose(statusCode: number | undefined, cause: unknown): Promise<void> {
    if (this.manualStop) return;
    const error = mapDisconnectError(statusCode, cause);
    const policy = policyFor(statusCode);
    this.pairing = null;
    this.logger.info({ statusCode, policy, code: error.code }, 'WhatsApp connection closed');
    switch (policy) {
      case 'reconnect-now':
        this.setState('reconnecting', error);
        await this.restart();
        return;
      case 'reconnect-backoff': {
        this.attempt += 1;
        const max = this.deps.options.reconnect.maxAttempts;
        if (max !== null && this.attempt > max) {
          await this.deps.client.stop();
          this.setState('disconnected', error);
          return;
        }
        this.setState('reconnecting', error);
        const delay = this.backoff.delayFor(this.attempt);
        this.clearTimer();
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = undefined;
          void this.restart();
        }, delay);
        return;
      }
      case 'logged-out':
        await this.deps.client.stop();
        await this.deps.auth.clear();
        this.setState('logged_out', error);
        return;
      case 'stop':
        await this.deps.client.stop();
        this.setState('disconnected', error);
        return;
    }
  }

  private async restart(): Promise<void> {
    if (this.manualStop) return;
    await this.deps.client.stop();
    if (this.manualStop) return;
    this.pairingCodeRequested = false;
    this.setState('connecting', this.status.lastError);
    await this.startClient();
  }

  private clearTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private setState(
    state: ConnectorState,
    error?: ConnectorError | ConnectorStatus['lastError'],
  ): void {
    const lastError =
      error === undefined
        ? undefined
        : 'at' in error
          ? error
          : {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              at: new Date(),
            };
    this.status = {
      state,
      since: new Date(),
      ...(lastError ? { lastError } : {}),
      detail: { reconnectAttempt: this.attempt, pairing: state === 'pairing' },
    };
    for (const listener of [...this.statusListeners]) listener(this.getStatus());
  }

  private setPairing(pairing: PairingState): void {
    this.pairing = pairing;
    for (const listener of [...this.pairingListeners]) listener(pairing);
  }
}
