/* eslint-disable @typescript-eslint/require-await -- fake implements an async interface; methods resolve synchronously by default */
import { Readable } from 'node:stream';
import type { Unsubscribe } from '@connectors/core';
import type { OutgoingMedia } from '../types.js';
import { TypedEmitter } from '../client/emitter.js';
import type {
  AuthStore,
  ClientEventMap,
  MediaDescriptor,
  RawMessage,
  WhatsAppClient,
} from '../client/types.js';

export class FakeWhatsAppClient implements WhatsAppClient {
  readonly emitter = new TypedEmitter<ClientEventMap>();
  readonly calls = {
    start: 0,
    stop: 0,
    logout: 0,
    pairingCodes: [] as string[],
    sentText: [] as Array<{ jid: string; text: string; quoted?: RawMessage }>,
    sentMedia: [] as Array<{ jid: string; media: OutgoingMedia; quoted?: RawMessage }>,
    downloads: [] as MediaDescriptor[],
    reuploads: [] as RawMessage[],
  };
  registered = false;
  started = false;
  auth: AuthStore | undefined;
  nextPairingCode = 'ABCD-EFGH';
  nextMessageId = 1;
  downloadImpl: (d: MediaDescriptor) => Promise<Readable> = async () =>
    Readable.from([Buffer.from('media')]);
  reuploadImpl: (m: RawMessage) => Promise<RawMessage> = async (m) => m;
  startImpl: () => Promise<void> = async () => undefined;

  async start(auth: AuthStore): Promise<void> {
    this.calls.start++;
    this.auth = auth;
    this.started = true;
    await this.startImpl();
  }

  async stop(): Promise<void> {
    this.calls.stop++;
    this.started = false;
  }

  on<E extends keyof ClientEventMap>(
    event: E,
    handler: (payload: ClientEventMap[E]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, handler);
  }

  isRegistered(): boolean {
    return this.registered;
  }

  async requestPairingCode(phoneNumber: string): Promise<string> {
    this.calls.pairingCodes.push(phoneNumber);
    return this.nextPairingCode;
  }

  async sendText(jid: string, text: string, quoted?: RawMessage): Promise<RawMessage> {
    this.calls.sentText.push(quoted ? { jid, text, quoted } : { jid, text });
    return this.sentMessage(jid, { conversation: text });
  }

  async sendMedia(jid: string, media: OutgoingMedia, quoted?: RawMessage): Promise<RawMessage> {
    this.calls.sentMedia.push(quoted ? { jid, media, quoted } : { jid, media });
    return this.sentMessage(jid, { [`${media.kind}Message`]: { mimetype: media.mimetype } });
  }

  async downloadMedia(descriptor: MediaDescriptor): Promise<Readable> {
    this.calls.downloads.push(descriptor);
    return this.downloadImpl(descriptor);
  }

  async requestReupload(message: RawMessage): Promise<RawMessage> {
    this.calls.reuploads.push(message);
    return this.reuploadImpl(message);
  }

  async logout(): Promise<void> {
    this.calls.logout++;
    this.registered = false;
  }

  // Test helpers
  emitConnecting(): void {
    this.emitter.emit('connection', { status: 'connecting' });
  }
  emitOpen(): void {
    this.registered = true;
    this.emitter.emit('connection', { status: 'open' });
  }
  emitClose(statusCode?: number): void {
    const update =
      statusCode === undefined
        ? { status: 'close' as const }
        : { status: 'close' as const, statusCode };
    this.emitter.emit('connection', {
      ...update,
      error: new Error(`closed ${statusCode ?? 'unknown'}`),
    });
  }
  emitQr(qr = 'QR-DATA'): void {
    this.emitter.emit('qr', qr);
  }
  emitMessages(messages: RawMessage[], type: 'notify' | 'append' = 'notify'): void {
    this.emitter.emit('messages', { messages, type });
  }

  private sentMessage(jid: string, content: Record<string, unknown>): RawMessage {
    return {
      key: { remoteJid: jid, fromMe: true, id: `SENT${this.nextMessageId++}` },
      message: content,
      messageTimestamp: Math.floor(Date.now() / 1000),
    };
  }
}
