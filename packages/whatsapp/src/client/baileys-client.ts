import type { Readable } from 'node:stream';
import { nonRetryable, type Logger, type Unsubscribe } from '@talitman/core';
import makeWASocket, {
  Browsers,
  downloadContentFromMessage,
  fetchLatestBaileysVersion,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  proto,
  type AnyMessageContent,
  type AuthenticationCreds,
  type BaileysEventMap,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
  type WAMessage,
  type WASocket,
} from 'baileys';
import { MediaUnavailableError, statusCodeOf } from '../errors.js';
import type { ResolvedOptions } from '../options.js';
import type { OutgoingMedia } from '../types.js';
import {
  browserTuple,
  toOutgoingContent,
  toProviderLogger,
  type ProviderLogger,
} from './baileys-mapping.js';
import { TypedEmitter } from './emitter.js';
import type {
  AuthStore,
  ClientEventMap,
  MediaDescriptor,
  RawMessage,
  WhatsAppClient,
} from './types.js';

/**
 * The only module that imports the provider library. Everything it exposes is expressed in the
 * structural types from ./types.ts so the rest of the package never sees provider types.
 */
export class BaileysClient implements WhatsAppClient {
  private readonly emitter: TypedEmitter<ClientEventMap>;
  private readonly logger: Logger;
  private readonly providerLogger: ProviderLogger;
  private readonly options: ResolvedOptions;
  private sock: WASocket | undefined;
  private creds: AuthenticationCreds | undefined;
  /** Bumped by every stop(); a start() whose generation is stale abandons its socket. */
  private generation = 0;
  /** Serialized creds writes, so start()/stop() can await the last one. */
  private pendingSave: Promise<void> = Promise.resolve();
  /** Removes exactly the listeners we registered, leaving Baileys' internal ones alone. */
  private detach: (() => void) | undefined;

  constructor(ctx: { logger: Logger; options: ResolvedOptions }) {
    this.logger = ctx.logger.child({ component: 'baileys-client' });
    this.providerLogger = toProviderLogger(
      ctx.logger.child({ component: 'baileys' }),
      ctx.options.providerLogLevel,
    );
    this.options = ctx.options;
    this.emitter = new TypedEmitter<ClientEventMap>((err) =>
      this.logger.error({ err }, 'client event handler failed'),
    );
  }

  async start(auth: AuthStore): Promise<void> {
    await this.stop();
    await this.pendingSave;
    // stop() has already bumped the generation; anything that bumps it again wins over us.
    const generation = this.generation;

    const creds = ((await auth.loadCreds()) as AuthenticationCreds | undefined) ?? initAuthCreds();
    if (generation !== this.generation) return;
    this.creds = creds;

    const keys: SignalKeyStore = {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const data = await auth.getKeys(type, ids);
        if (type === 'app-state-sync-key') {
          for (const id of Object.keys(data)) {
            data[id] = proto.Message.AppStateSyncKeyData.fromObject(
              data[id] as Record<string, unknown>,
            );
          }
        }
        return data as { [id: string]: SignalDataTypeMap[T] };
      },
      set: (data: SignalDataSet) => auth.setKeys(data),
      clear: () => auth.clearKeys(),
    };

    const version = this.options.fetchLatestVersion
      ? (await fetchLatestBaileysVersion()).version
      : this.options.waWebVersion;
    if (generation !== this.generation) return;

    const sock = makeWASocket({
      auth: { creds, keys: makeCacheableSignalKeyStore(keys, this.providerLogger) },
      logger: this.providerLogger,
      browser: browserTuple(this.options.browser) ?? Browsers.macOS('Chrome'),
      ...(version ? { version } : {}),
      markOnlineOnConnect: this.options.markOnlineOnConnect,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: () => Promise.resolve(undefined),
    });
    if (generation !== this.generation) {
      await this.endSocket(sock);
      return;
    }
    this.sock = sock;

    const onCreds = (): void => {
      this.pendingSave = this.pendingSave
        .then(() => auth.saveCreds(creds as unknown as Record<string, unknown>))
        .then(() => this.emitter.emit('creds', undefined))
        .catch((err: unknown) => this.logger.error({ err }, 'failed to persist credentials'));
    };
    const onConnection = (update: BaileysEventMap['connection.update']): void => {
      if (update.qr) this.emitter.emit('qr', update.qr);
      if (!update.connection) return;
      const error = update.lastDisconnect?.error;
      const statusCode = statusCodeOf(error);
      this.emitter.emit('connection', {
        status: update.connection,
        ...(statusCode === undefined ? {} : { statusCode }),
        ...(error ? { error } : {}),
        ...(update.isNewLogin === undefined ? {} : { isNewLogin: update.isNewLogin }),
      });
    };
    const onMessages = ({ messages, type }: BaileysEventMap['messages.upsert']): void => {
      // WAMessage is a superset of RawMessage; the cast narrows to the fields this package reads.
      this.emitter.emit('messages', { messages: messages as unknown as RawMessage[], type });
    };

    sock.ev.on('creds.update', onCreds);
    sock.ev.on('connection.update', onConnection);
    sock.ev.on('messages.upsert', onMessages);
    // removeAllListeners would also strip Baileys' own internal handlers.
    this.detach = () => {
      sock.ev.off('creds.update', onCreds);
      sock.ev.off('connection.update', onConnection);
      sock.ev.off('messages.upsert', onMessages);
    };
  }

  async stop(): Promise<void> {
    this.generation += 1;
    await this.pendingSave;
    const sock = this.sock;
    if (!sock) return;
    this.sock = undefined;
    this.detach?.();
    this.detach = undefined;
    await this.endSocket(sock);
  }

  private async endSocket(sock: WASocket): Promise<void> {
    try {
      await sock.end(undefined);
    } catch (err) {
      this.logger.debug({ err }, 'error while ending socket');
    }
  }

  on<E extends keyof ClientEventMap>(
    event: E,
    handler: (payload: ClientEventMap[E]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, handler);
  }

  isRegistered(): boolean {
    return this.creds?.registered === true;
  }

  selfJid(): string | undefined {
    return this.creds?.me?.id;
  }

  async requestPairingCode(phoneNumber: string): Promise<string> {
    return this.requireSocket().requestPairingCode(phoneNumber);
  }

  async sendText(jid: string, text: string, quoted?: RawMessage): Promise<RawMessage> {
    const result = await this.requireSocket().sendMessage(
      jid,
      { text, linkPreview: null },
      quoted ? { quoted: quoted as unknown as WAMessage } : undefined,
    );
    return this.sentOrThrow(result);
  }

  async sendMedia(jid: string, media: OutgoingMedia, quoted?: RawMessage): Promise<RawMessage> {
    const content = toOutgoingContent(media) as unknown as AnyMessageContent;
    const result = await this.requireSocket().sendMessage(
      jid,
      content,
      quoted ? { quoted: quoted as unknown as WAMessage } : undefined,
    );
    return this.sentOrThrow(result);
  }

  async downloadMedia(descriptor: MediaDescriptor): Promise<Readable> {
    try {
      return await downloadContentFromMessage(
        {
          mediaKey: descriptor.mediaKey,
          directPath: descriptor.directPath,
          url: descriptor.url ?? null,
        },
        descriptor.kind,
      );
    } catch (err) {
      const code = statusCodeOf(err);
      if (code === 404 || code === 410 || /\b(404|410)\b/.test(String((err as Error).message))) {
        throw new MediaUnavailableError(
          'expired',
          'Media is no longer available on WhatsApp servers',
          err,
        );
      }
      throw err;
    }
  }

  async requestReupload(message: RawMessage): Promise<RawMessage> {
    const updated = await this.requireSocket().updateMediaMessage(message as unknown as WAMessage);
    return updated as unknown as RawMessage;
  }

  async logout(): Promise<void> {
    await this.requireSocket().logout();
  }

  private requireSocket(): WASocket {
    if (!this.sock) throw nonRetryable('WhatsApp socket is not started', 'NOT_CONNECTED');
    return this.sock;
  }

  private sentOrThrow(result: WAMessage | undefined): RawMessage {
    if (!result) throw nonRetryable('Provider did not return the sent message', 'SEND_FAILED');
    return result as unknown as RawMessage;
  }
}
