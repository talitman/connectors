import type { Readable } from 'node:stream';
import type {
  Connector,
  ConnectorEvent,
  ConnectorStatus,
  EventSource,
  KeyValueStore,
  Logger,
  Unsubscribe,
} from '@talitman/core';

export type WhatsAppLogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export type PairingMethod = { method: 'qr' } | { method: 'code'; phoneNumber: string };

export interface WhatsAppConnectorOptions {
  accountId: string;
  storage: { auth: KeyValueStore };
  logger?: Logger;
  /** Default: { method: 'qr' }. Phone number is digits with country code, no '+'. */
  pairing?: PairingMethod;
  reconnect?: { initialDelayMs?: number; maxDelayMs?: number; maxAttempts?: number | null };
  /** Emit message.sent for messages sent from this account. Default true. */
  includeOwnMessages?: boolean;
  /** Emit messages delivered as history sync. Default false. */
  includeHistory?: boolean;
  /** Attach the raw provider message to each event. Default false. */
  includeRaw?: boolean;
  dedupe?: { maxEntries?: number; ttlMs?: number };
  /** In-memory cache of recent raw messages used for media download and quoting. */
  mediaCache?: { maxEntries?: number; ttlMs?: number };
  browser?: { os: string; name: string; version?: string };
  /** Default false: the phone keeps receiving notifications. */
  markOnlineOnConnect?: boolean;
  /** Default false: never contacts GitHub for the latest WhatsApp Web version. */
  fetchLatestVersion?: boolean;
  waWebVersion?: [number, number, number];
  /** Level for the underlying provider's logger. Default 'warn'. */
  providerLogLevel?: WhatsAppLogLevel;
}

export type PairingState =
  | { method: 'qr'; qr: string; issuedAt: Date }
  | { method: 'code'; code: string; phoneNumber: string; issuedAt: Date };

export type ChatType = 'direct' | 'group' | 'broadcast' | 'status' | 'newsletter';
export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

export interface MediaRef {
  kind: MediaKind;
  mimetype: string;
  sizeBytes?: number;
  /** hex */
  sha256?: string;
  fileName?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  /** Key into the connector's in-memory media cache. */
  messageId: string;
}

export type MessageContent =
  | { kind: 'text'; text: string }
  | { kind: 'image'; caption?: string; media: MediaRef }
  | { kind: 'video'; caption?: string; media: MediaRef; isGif: boolean }
  | { kind: 'audio'; media: MediaRef; isVoiceNote: boolean }
  | { kind: 'document'; caption?: string; media: MediaRef }
  | { kind: 'sticker'; media: MediaRef; isAnimated: boolean }
  | { kind: 'contact'; contacts: { displayName: string; vcard: string }[] }
  | {
      kind: 'location';
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
      isLive: boolean;
    }
  | { kind: 'reaction'; emoji: string; targetMessageId: string }
  | { kind: 'unsupported'; providerType: string };

export interface MessageSender {
  /** Normalized JID (phone-number or LID form, whichever WhatsApp addressed). */
  id: string;
  phoneNumber?: string;
  lid?: string;
  displayName?: string;
}

export interface WhatsAppMessage {
  messageId: string;
  chatId: string;
  chatType: ChatType;
  direction: 'inbound' | 'outbound';
  sender: MessageSender;
  timestamp: Date;
  content: MessageContent;
  quoted?: { messageId: string; senderId?: string };
  mentions: string[];
  isViewOnce: boolean;
  isEdit: boolean;
  isForwarded: boolean;
  ephemeralExpirationSeconds?: number;
}

export type WhatsAppMessageEvent = ConnectorEvent<WhatsAppMessage> & {
  connector: 'whatsapp';
  type: 'message.received' | 'message.sent';
};
export type WhatsAppConnectionEvent = ConnectorEvent<ConnectorStatus> & {
  connector: 'whatsapp';
  type: 'connection.updated';
};
export type WhatsAppEvent = WhatsAppMessageEvent | WhatsAppConnectionEvent;

/** Either a MediaRef from an event, or a raw payload the consumer stored (requires includeRaw). */
export type MediaSource = { messageId: string } | { raw: unknown };

export type OutgoingMedia =
  | { kind: 'image'; data: Buffer | Readable; mimetype: string; caption?: string }
  | { kind: 'video'; data: Buffer | Readable; mimetype: string; caption?: string }
  | { kind: 'audio'; data: Buffer | Readable; mimetype: string; voiceNote?: boolean }
  | {
      kind: 'document';
      data: Buffer | Readable;
      mimetype: string;
      fileName: string;
      caption?: string;
    };

export interface SentMessage {
  messageId: string;
  chatId: string;
  timestamp: Date;
}

export interface SendOptions {
  quotedMessageId?: string;
}

export interface WhatsAppConnector extends Connector, EventSource<WhatsAppEvent> {
  readonly name: 'whatsapp';
  onPairing(handler: (pairing: PairingState) => void): Unsubscribe;
  getPairing(): PairingState | null;
  /** Unlink this device on WhatsApp and clear stored auth state. */
  logout(): Promise<void>;
  sendText(chatId: string, text: string, options?: SendOptions): Promise<SentMessage>;
  sendMedia(chatId: string, media: OutgoingMedia, options?: SendOptions): Promise<SentMessage>;
  downloadMedia(source: MediaSource): Promise<Readable>;
  downloadMediaToFile(
    source: MediaSource,
    filePath: string,
  ): Promise<{ path: string; bytes: number }>;
  /** Metadata for a cached media message, or undefined if unknown/expired. */
  describeMedia(messageId: string): MediaRef | undefined;
}
