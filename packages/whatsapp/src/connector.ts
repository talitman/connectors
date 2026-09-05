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

const MAX_PENDING_OWN_SENDS = 1000;

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
  /** Monotonic suffix so two status transitions in the same millisecond get distinct event ids. */
  private connectionSeq = 0;
  private duplicatesDropped = 0;
  /** Ids of messages this connector sent that the provider has not yet echoed back. */
  private readonly ownSentIds = new Set<string>();

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
    this.client.on('messages', (batch) => {
      void this.handleBatch(batch).catch((err: unknown) =>
        this.logger.error({ err }, 'message batch handling failed'),
      );
    });
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
        duplicatesDropped: this.duplicatesDropped,
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
    this.rememberOwnSend(messageId);
    return { messageId, chatId: jid, timestamp: timestampOf(raw) };
  }

  private rememberOwnSend(messageId: string): void {
    this.ownSentIds.add(messageId);
    // Bound the set in case the provider never echoes a send (e.g. emitOwnEvents disabled upstream).
    while (this.ownSentIds.size > MAX_PENDING_OWN_SENDS) {
      const oldest = this.ownSentIds.values().next().value;
      if (oldest === undefined) break;
      this.ownSentIds.delete(oldest);
    }
  }

  private async handleBatch(batch: ClientMessageBatch): Promise<void> {
    // A socket created by an in-flight start() can outlive a disconnect()/logout(); ignore it.
    if (this.manager.isStopped()) return;
    // The provider echoes this connector's own sends as 'append' batches, the same type it uses
    // for history sync. Without includeHistory, let through only the echoes of our own sends.
    const messages =
      batch.type === 'append' && !this.options.includeHistory
        ? batch.messages.filter(
            (raw) =>
              raw.key.id !== undefined && raw.key.id !== null && this.ownSentIds.has(raw.key.id),
          )
        : batch.messages;
    for (const raw of messages) {
      const id = raw.key.id;
      if (!id) continue;
      this.ownSentIds.delete(id);
      if (this.dedupe.isDuplicate(`${this.accountId}:${id}`)) {
        this.duplicatesDropped += 1;
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
    const externalId = `${full.since.toISOString()}#${this.connectionSeq++}`;
    void this.dispatch({
      id: buildEventId({
        connector: 'whatsapp',
        accountId: this.accountId,
        type: 'connection.updated',
        externalId,
      }),
      connector: 'whatsapp',
      accountId: this.accountId,
      externalId,
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
