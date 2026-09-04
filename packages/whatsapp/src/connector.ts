import type { Readable } from 'node:stream';
import {
  EventDeduplicator,
  buildEventId,
  encodeSegment,
  namespaced,
  noopLogger,
  nonRetryable,
  type ConnectorStatus,
  type EventHandler,
  type Logger,
  type Unsubscribe,
} from '@connectors/core';
import { createAuthStore } from './auth/auth-state.js';
import type { ClientMessageBatch, RawMessage, WhatsAppClient } from './client/types.js';
import { ConnectionManager } from './connection/state-machine.js';
import { NotConnectedError } from './errors.js';
import { RawMessageCache } from './media/cache.js';
import { findMedia, mediaRefOf } from './media/descriptor.js';
import { openMediaStream, resolveRawMessage, streamToFile } from './media/download.js';
import { normalizeJid, phoneNumberFromJid, toChatJid } from './normalize/jid.js';
import { normalizeMessage, timestampOf, unwrapContent } from './normalize/message.js';
import { resolveOptions, type ResolvedOptions } from './options.js';
import type {
  MediaRef,
  MediaSource,
  OutgoingMedia,
  PairingState,
  SendOptions,
  SentMessage,
  WhatsAppConnector,
  WhatsAppConnectorOptions,
  WhatsAppEvent,
  WhatsAppMessageEvent,
} from './types.js';

export interface ConnectorInternals {
  clientFactory: (ctx: { logger: Logger; options: ResolvedOptions }) => WhatsAppClient;
  random?: () => number;
}

class WhatsAppConnectorImpl implements WhatsAppConnector {
  readonly name = 'whatsapp' as const;
  readonly accountId: string;
  private readonly logger: Logger;
  private readonly client: WhatsAppClient;
  private readonly manager: ConnectionManager;
  private readonly dedupe: EventDeduplicator;
  private readonly cache: RawMessageCache;
  private readonly subscribers = new Set<EventHandler<WhatsAppEvent>>();

  constructor(
    private readonly options: ResolvedOptions,
    internals: ConnectorInternals,
  ) {
    this.accountId = options.accountId;
    this.logger = (options.logger ?? noopLogger).child({
      connector: 'whatsapp',
      accountId: this.accountId,
    });
    const auth = createAuthStore(
      namespaced(options.storage.auth, `whatsapp/${encodeSegment(this.accountId)}/auth`),
    );
    this.client = internals.clientFactory({ logger: this.logger, options });
    this.dedupe = new EventDeduplicator(options.dedupe);
    this.cache = new RawMessageCache(options.mediaCache);
    this.manager = new ConnectionManager({
      client: this.client,
      auth,
      logger: this.logger,
      options,
      ...(internals.random ? { random: internals.random } : {}),
    });
    this.manager.onStatus((status) => this.emitStatus(status));
    this.client.on('messages', (batch) => void this.handleBatch(batch));
  }

  subscribe(handler: EventHandler<WhatsAppEvent>): Unsubscribe {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  onPairing(handler: (pairing: PairingState) => void): Unsubscribe {
    return this.manager.onPairing(handler);
  }

  getPairing(): PairingState | null {
    return this.manager.getPairing();
  }

  connect(): Promise<void> {
    return this.manager.connect();
  }

  disconnect(): Promise<void> {
    return this.manager.disconnect();
  }

  logout(): Promise<void> {
    return this.manager.logout();
  }

  getStatus(): Promise<ConnectorStatus> {
    return Promise.resolve(this.withIdentity(this.manager.getStatus()));
  }

  async sendText(chatId: string, text: string, options: SendOptions = {}): Promise<SentMessage> {
    this.ensureConnected();
    const jid = toChatJid(chatId);
    const raw = await this.client.sendText(jid, text, this.quoted(options));
    return this.toSent(raw, jid);
  }

  async sendMedia(
    chatId: string,
    media: OutgoingMedia,
    options: SendOptions = {},
  ): Promise<SentMessage> {
    this.ensureConnected();
    const jid = toChatJid(chatId);
    const raw = await this.client.sendMedia(jid, media, this.quoted(options));
    return this.toSent(raw, jid);
  }

  async downloadMedia(source: MediaSource): Promise<Readable> {
    const raw = resolveRawMessage(source, this.cache);
    const { stream } = await openMediaStream(this.client, raw, this.cache);
    return stream;
  }

  async downloadMediaToFile(
    source: MediaSource,
    filePath: string,
  ): Promise<{ path: string; bytes: number }> {
    return streamToFile(await this.downloadMedia(source), filePath);
  }

  describeMedia(messageId: string): MediaRef | undefined {
    const raw = this.cache.get(messageId);
    if (!raw?.message) return undefined;
    const found = findMedia(unwrapContent(raw.message).content);
    return found ? mediaRefOf(found.kind, found.media, messageId) : undefined;
  }

  private selfId(): string | undefined {
    const jid = this.client.selfJid();
    return jid ? normalizeJid(jid) : undefined;
  }

  private withIdentity(status: ConnectorStatus): ConnectorStatus {
    const self = this.selfId();
    const phone = self ? phoneNumberFromJid(self) : undefined;
    return {
      ...status,
      detail: {
        ...status.detail,
        ...(self ? { selfId: self } : {}),
        ...(phone ? { phoneNumber: phone } : {}),
      },
    };
  }

  private ensureConnected(): void {
    const { state } = this.manager.getStatus();
    if (state !== 'connected') throw new NotConnectedError(state);
  }

  private quoted(options: SendOptions): RawMessage | undefined {
    return options.quotedMessageId ? this.cache.get(options.quotedMessageId) : undefined;
  }

  private toSent(raw: RawMessage, jid: string): SentMessage {
    const messageId = raw.key.id;
    if (!messageId) throw nonRetryable('Provider returned a message without an id', 'SEND_FAILED');
    return { messageId, chatId: jid, timestamp: timestampOf(raw) };
  }

  private async handleBatch(batch: ClientMessageBatch): Promise<void> {
    if (batch.type === 'append' && !this.options.includeHistory) return;
    for (const raw of batch.messages) {
      const id = raw.key.id;
      if (!id) continue;
      if (this.dedupe.isDuplicate(`${this.accountId}:${id}`)) {
        this.logger.debug({ messageId: id }, 'duplicate message dropped');
        continue;
      }
      this.cache.set(id, raw);
      const fromMe = raw.key.fromMe === true;
      if (fromMe && !this.options.includeOwnMessages) continue;
      const selfId = this.selfId();
      const payload = normalizeMessage(raw, selfId ? { selfId } : {});
      if (!payload) continue;
      const type = fromMe ? 'message.sent' : 'message.received';
      const event: WhatsAppMessageEvent = {
        id: buildEventId({
          connector: 'whatsapp',
          accountId: this.accountId,
          type,
          externalId: id,
        }),
        connector: 'whatsapp',
        accountId: this.accountId,
        externalId: id,
        type,
        timestamp: payload.timestamp,
        receivedAt: new Date(),
        payload,
        ...(this.options.includeRaw ? { raw } : {}),
      };
      await this.dispatch(event);
    }
  }

  private emitStatus(status: ConnectorStatus): void {
    const full = this.withIdentity(status);
    void this.dispatch({
      id: buildEventId({
        connector: 'whatsapp',
        accountId: this.accountId,
        type: 'connection.updated',
        externalId: full.since.toISOString(),
      }),
      connector: 'whatsapp',
      accountId: this.accountId,
      externalId: full.since.toISOString(),
      type: 'connection.updated',
      timestamp: full.since,
      receivedAt: new Date(),
      payload: full,
    });
  }

  private async dispatch(event: WhatsAppEvent): Promise<void> {
    for (const handler of [...this.subscribers]) {
      try {
        await handler(event);
      } catch (err) {
        this.logger.error({ err, eventId: event.id }, 'event handler failed');
      }
    }
  }
}

export function createConnectorWithClient(
  options: WhatsAppConnectorOptions,
  internals: ConnectorInternals,
): WhatsAppConnector {
  return new WhatsAppConnectorImpl(resolveOptions(options), internals);
}
