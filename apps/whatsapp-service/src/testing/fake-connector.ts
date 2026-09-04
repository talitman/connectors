/* eslint-disable @typescript-eslint/require-await -- fake implements an async interface; methods resolve synchronously by default */
import { Readable } from 'node:stream';
import type { ConnectorStatus, EventHandler, Unsubscribe } from '@connectors/core';
import type {
  MediaRef,
  MediaSource,
  OutgoingMedia,
  PairingState,
  SendOptions,
  SentMessage,
  WhatsAppConnector,
  WhatsAppEvent,
} from '@connectors/whatsapp';
import { MediaUnavailableError, NotConnectedError } from '@connectors/whatsapp';

export class FakeWhatsAppConnector implements WhatsAppConnector {
  readonly name = 'whatsapp' as const;
  status: ConnectorStatus = { state: 'disconnected', since: new Date('2026-01-01T00:00:00Z') };
  pairing: PairingState | null = null;
  media = new Map<string, MediaRef>();
  mediaBody = 'media-bytes';
  readonly calls = {
    connect: 0,
    disconnect: 0,
    logout: 0,
    sentText: [] as unknown[],
    sentMedia: [] as unknown[],
  };
  private readonly subscribers = new Set<EventHandler<WhatsAppEvent>>();
  private readonly pairingListeners = new Set<(p: PairingState) => void>();
  connectBehavior: 'connect' | 'pair' = 'connect';

  constructor(readonly accountId: string) {}

  subscribe(handler: EventHandler<WhatsAppEvent>): Unsubscribe {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  async emit(event: WhatsAppEvent): Promise<void> {
    for (const h of this.subscribers) await h(event);
  }

  onPairing(handler: (p: PairingState) => void): Unsubscribe {
    this.pairingListeners.add(handler);
    return () => this.pairingListeners.delete(handler);
  }

  getPairing(): PairingState | null {
    return this.pairing;
  }

  async connect(): Promise<void> {
    this.calls.connect++;
    if (this.connectBehavior === 'pair') {
      this.status = { state: 'pairing', since: new Date() };
      this.pairing = { method: 'qr', qr: 'QR-RAW', issuedAt: new Date('2026-01-01T00:00:00Z') };
      for (const l of this.pairingListeners) l(this.pairing);
    } else {
      this.status = { state: 'connected', since: new Date() };
    }
  }

  async disconnect(): Promise<void> {
    this.calls.disconnect++;
    this.status = { state: 'disconnected', since: new Date() };
  }

  async logout(): Promise<void> {
    this.calls.logout++;
    this.status = { state: 'logged_out', since: new Date() };
  }

  async getStatus(): Promise<ConnectorStatus> {
    return this.status;
  }

  async sendText(chatId: string, text: string, options?: SendOptions): Promise<SentMessage> {
    this.ensureConnected();
    this.calls.sentText.push({ chatId, text, options });
    return { messageId: 'SENT1', chatId, timestamp: new Date('2026-01-01T00:00:00Z') };
  }

  async sendMedia(
    chatId: string,
    media: OutgoingMedia,
    options?: SendOptions,
  ): Promise<SentMessage> {
    this.ensureConnected();
    const data = Buffer.isBuffer(media.data)
      ? media.data
      : Buffer.concat(await media.data.toArray());
    this.calls.sentMedia.push({ chatId, media: { ...media, data: data.toString() }, options });
    return { messageId: 'SENT2', chatId, timestamp: new Date('2026-01-01T00:00:00Z') };
  }

  async downloadMedia(source: MediaSource): Promise<Readable> {
    if (!('messageId' in source) || !this.media.has(source.messageId)) {
      throw new MediaUnavailableError('not-cached', 'not cached');
    }
    return Readable.from([Buffer.from(this.mediaBody)]);
  }

  async downloadMediaToFile(): Promise<{ path: string; bytes: number }> {
    throw new Error('not used in service tests');
  }

  describeMedia(messageId: string): MediaRef | undefined {
    return this.media.get(messageId);
  }

  private ensureConnected(): void {
    if (this.status.state !== 'connected') throw new NotConnectedError(this.status.state);
  }
}
