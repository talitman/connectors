import type { Readable } from 'node:stream';
import type { Unsubscribe } from '@connectors/core';
import type { MediaKind, OutgoingMedia } from '../types.js';

/** Structural subset of the provider's message shape that this package reads. */
export interface LongLike {
  toNumber(): number;
}

export interface RawMessageKey {
  remoteJid?: string | null;
  fromMe?: boolean | null;
  id?: string | null;
  participant?: string | null;
  remoteJidAlt?: string | null;
  participantAlt?: string | null;
}

export interface RawContextInfo {
  stanzaId?: string | null;
  participant?: string | null;
  mentionedJid?: string[] | null;
  isForwarded?: boolean | null;
  forwardingScore?: number | null;
  expiration?: number | null;
}

export interface RawMediaMessage {
  url?: string | null;
  directPath?: string | null;
  mediaKey?: Uint8Array | null;
  mimetype?: string | null;
  fileLength?: number | LongLike | null;
  fileSha256?: Uint8Array | null;
  fileName?: string | null;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
  seconds?: number | null;
  ptt?: boolean | null;
  gifPlayback?: boolean | null;
  isAnimated?: boolean | null;
  viewOnce?: boolean | null;
  contextInfo?: RawContextInfo | null;
}

export interface RawWrapped {
  message?: RawMessageContent | null;
}

export interface RawMessageContent {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null; contextInfo?: RawContextInfo | null } | null;
  imageMessage?: RawMediaMessage | null;
  videoMessage?: RawMediaMessage | null;
  audioMessage?: RawMediaMessage | null;
  documentMessage?: RawMediaMessage | null;
  stickerMessage?: RawMediaMessage | null;
  contactMessage?: {
    displayName?: string | null;
    vcard?: string | null;
    contextInfo?: RawContextInfo | null;
  } | null;
  contactsArrayMessage?: {
    displayName?: string | null;
    contacts?: Array<{ displayName?: string | null; vcard?: string | null }> | null;
    contextInfo?: RawContextInfo | null;
  } | null;
  locationMessage?: {
    degreesLatitude?: number | null;
    degreesLongitude?: number | null;
    name?: string | null;
    address?: string | null;
    contextInfo?: RawContextInfo | null;
  } | null;
  liveLocationMessage?: {
    degreesLatitude?: number | null;
    degreesLongitude?: number | null;
    caption?: string | null;
    contextInfo?: RawContextInfo | null;
  } | null;
  reactionMessage?: { key?: RawMessageKey | null; text?: string | null } | null;
  ephemeralMessage?: RawWrapped | null;
  viewOnceMessage?: RawWrapped | null;
  viewOnceMessageV2?: RawWrapped | null;
  viewOnceMessageV2Extension?: RawWrapped | null;
  editedMessage?: RawWrapped | null;
  documentWithCaptionMessage?: RawWrapped | null;
  protocolMessage?: unknown;
  senderKeyDistributionMessage?: unknown;
  [other: string]: unknown;
}

export interface RawMessage {
  key: RawMessageKey;
  message?: RawMessageContent | null;
  messageTimestamp?: number | LongLike | null;
  pushName?: string | null;
  messageStubType?: number | null;
}

/** What the client needs to fetch and decrypt one media item. */
export interface MediaDescriptor {
  kind: MediaKind;
  mediaKey: Uint8Array;
  directPath: string;
  url?: string;
  mimetype: string;
}

/** Persistence facade handed to the client. Values are opaque JSON-able objects. */
export interface AuthStore {
  loadCreds(): Promise<Record<string, unknown> | undefined>;
  saveCreds(creds: Record<string, unknown>): Promise<void>;
  getKeys(type: string, ids: string[]): Promise<Record<string, unknown>>;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- documents that a null value explicitly signals "delete this key"
  setKeys(data: Record<string, Record<string, unknown | null>>): Promise<void>;
  clearKeys(): Promise<void>;
  clear(): Promise<void>;
}

export interface ClientConnectionUpdate {
  status: 'connecting' | 'open' | 'close';
  statusCode?: number;
  error?: Error;
  isNewLogin?: boolean;
}

export interface ClientMessageBatch {
  messages: RawMessage[];
  type: 'notify' | 'append';
}

export interface ClientEventMap extends Record<string, unknown> {
  connection: ClientConnectionUpdate;
  qr: string;
  messages: ClientMessageBatch;
  creds: undefined;
}

/**
 * Internal provider boundary. BaileysClient is the only implementation that talks to WhatsApp.
 * start() must create a fresh underlying socket every time; stop() must tear it down.
 */
export interface WhatsAppClient {
  start(auth: AuthStore): Promise<void>;
  stop(): Promise<void>;
  on<E extends keyof ClientEventMap>(
    event: E,
    handler: (payload: ClientEventMap[E]) => void,
  ): Unsubscribe;
  isRegistered(): boolean;
  /** Normalized JID of the connected account, once known. */
  selfJid(): string | undefined;
  requestPairingCode(phoneNumber: string): Promise<string>;
  sendText(jid: string, text: string, quoted?: RawMessage): Promise<RawMessage>;
  sendMedia(jid: string, media: OutgoingMedia, quoted?: RawMessage): Promise<RawMessage>;
  /** Throws MediaUnavailableError('expired') on 404/410 from the media CDN. */
  downloadMedia(descriptor: MediaDescriptor): Promise<Readable>;
  requestReupload(message: RawMessage): Promise<RawMessage>;
  logout(): Promise<void>;
}

export type WhatsAppClientFactory = () => WhatsAppClient;
