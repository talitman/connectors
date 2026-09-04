import type { RawContextInfo, RawMessage, RawMessageContent } from '../client/types.js';
import { findMedia, mediaRefOf } from '../media/descriptor.js';
import type { MessageContent, MessageSender, WhatsAppMessage } from '../types.js';
import { chatTypeOf, isLidJid, normalizeJid, phoneNumberFromJid } from './jid.js';

export interface UnwrappedContent {
  content: RawMessageContent;
  isViewOnce: boolean;
  isEdit: boolean;
  isEphemeral: boolean;
}

const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'editedMessage',
  'documentWithCaptionMessage',
] as const;

export function unwrapContent(input: RawMessageContent): UnwrappedContent {
  let content = input;
  let isViewOnce = false;
  let isEdit = false;
  let isEphemeral = false;
  for (let depth = 0; depth < 5; depth++) {
    let unwrapped = false;
    for (const wrapper of WRAPPERS) {
      const inner = content[wrapper]?.message;
      if (inner) {
        if (wrapper.startsWith('viewOnce')) isViewOnce = true;
        if (wrapper === 'editedMessage') isEdit = true;
        if (wrapper === 'ephemeralMessage') isEphemeral = true;
        content = inner;
        unwrapped = true;
        break;
      }
    }
    if (!unwrapped) break;
  }
  return { content, isViewOnce, isEdit, isEphemeral };
}

const IGNORED_TYPES = new Set([
  'protocolMessage',
  'senderKeyDistributionMessage',
  'messageContextInfo',
]);

function contentTypeOf(content: RawMessageContent): string | undefined {
  return Object.keys(content).find((k) => !IGNORED_TYPES.has(k) && content[k] != null);
}

export function timestampOf(raw: RawMessage): Date {
  const ts = raw.messageTimestamp;
  const seconds = ts == null ? Date.now() / 1000 : typeof ts === 'number' ? ts : ts.toNumber();
  return new Date(seconds * 1000);
}

function contextOf(content: RawMessageContent, type: string): RawContextInfo | undefined {
  const node = content[type] as { contextInfo?: RawContextInfo | null } | null | undefined;
  return node?.contextInfo ?? undefined;
}

function senderOf(
  primary: string,
  alt: string | null | undefined,
  displayName: string | undefined,
): MessageSender {
  const id = normalizeJid(primary);
  const sender: MessageSender = { id };
  const candidates = [id, alt ? normalizeJid(alt) : undefined];
  for (const c of candidates) {
    if (!c) continue;
    const phone = phoneNumberFromJid(c);
    if (phone && sender.phoneNumber === undefined) sender.phoneNumber = phone;
    if (isLidJid(c) && sender.lid === undefined) sender.lid = c;
  }
  if (displayName) sender.displayName = displayName;
  return sender;
}

function mapContent(content: RawMessageContent, type: string, messageId: string): MessageContent {
  const media = findMedia(content);
  if (media) {
    const ref = mediaRefOf(media.kind, media.media, messageId);
    const caption = media.media.caption ?? undefined;
    switch (media.kind) {
      case 'image':
        return caption === undefined
          ? { kind: 'image', media: ref }
          : { kind: 'image', caption, media: ref };
      case 'video':
        return {
          kind: 'video',
          ...(caption === undefined ? {} : { caption }),
          media: ref,
          isGif: media.media.gifPlayback === true,
        };
      case 'audio':
        return { kind: 'audio', media: ref, isVoiceNote: media.media.ptt === true };
      case 'document':
        return caption === undefined
          ? { kind: 'document', media: ref }
          : { kind: 'document', caption, media: ref };
      case 'sticker':
        return { kind: 'sticker', media: ref, isAnimated: media.media.isAnimated === true };
    }
  }
  if (type === 'conversation') return { kind: 'text', text: content.conversation ?? '' };
  if (type === 'extendedTextMessage')
    return { kind: 'text', text: content.extendedTextMessage?.text ?? '' };
  if (type === 'contactMessage') {
    const c = content.contactMessage;
    return {
      kind: 'contact',
      contacts: [{ displayName: c?.displayName ?? '', vcard: c?.vcard ?? '' }],
    };
  }
  if (type === 'contactsArrayMessage') {
    const list = content.contactsArrayMessage?.contacts ?? [];
    return {
      kind: 'contact',
      contacts: list.map((c) => ({ displayName: c.displayName ?? '', vcard: c.vcard ?? '' })),
    };
  }
  if (type === 'locationMessage') {
    const l = content.locationMessage;
    return {
      kind: 'location',
      latitude: l?.degreesLatitude ?? 0,
      longitude: l?.degreesLongitude ?? 0,
      ...(l?.name ? { name: l.name } : {}),
      ...(l?.address ? { address: l.address } : {}),
      isLive: false,
    };
  }
  if (type === 'liveLocationMessage') {
    const l = content.liveLocationMessage;
    return {
      kind: 'location',
      latitude: l?.degreesLatitude ?? 0,
      longitude: l?.degreesLongitude ?? 0,
      isLive: true,
    };
  }
  if (type === 'reactionMessage') {
    const r = content.reactionMessage;
    return { kind: 'reaction', emoji: r?.text ?? '', targetMessageId: r?.key?.id ?? '' };
  }
  return { kind: 'unsupported', providerType: type };
}

export interface NormalizeContext {
  /** Normalized JID of the connected account, used as sender for outbound direct messages. */
  selfId?: string;
}

export function normalizeMessage(
  raw: RawMessage,
  ctx: NormalizeContext = {},
): WhatsAppMessage | undefined {
  const messageId = raw.key.id;
  const remoteJid = raw.key.remoteJid;
  if (!messageId || !remoteJid || !raw.message) return undefined;
  const { content, isViewOnce, isEdit, isEphemeral } = unwrapContent(raw.message);
  const type = contentTypeOf(content);
  if (!type) return undefined;

  const chatId = normalizeJid(remoteJid);
  const chatType = chatTypeOf(chatId);
  const fromMe = raw.key.fromMe === true;
  const displayName = fromMe ? undefined : (raw.pushName ?? undefined);

  let sender: MessageSender;
  if (chatType === 'group' || chatType === 'broadcast' || chatType === 'status') {
    sender = senderOf(
      raw.key.participant ?? (fromMe && ctx.selfId ? ctx.selfId : remoteJid),
      raw.key.participantAlt,
      displayName,
    );
  } else if (fromMe) {
    sender = senderOf(
      ctx.selfId ?? remoteJid,
      ctx.selfId ? undefined : raw.key.remoteJidAlt,
      undefined,
    );
  } else {
    sender = senderOf(remoteJid, raw.key.remoteJidAlt, displayName);
  }

  const context = contextOf(content, type);
  const message: WhatsAppMessage = {
    messageId,
    chatId,
    chatType,
    direction: fromMe ? 'outbound' : 'inbound',
    sender,
    timestamp: timestampOf(raw),
    content: mapContent(content, type, messageId),
    mentions: (context?.mentionedJid ?? []).map(normalizeJid),
    isViewOnce,
    isEdit,
    isForwarded: context?.isForwarded === true || (context?.forwardingScore ?? 0) > 0,
  };
  if (context?.stanzaId) {
    message.quoted = context.participant
      ? { messageId: context.stanzaId, senderId: normalizeJid(context.participant) }
      : { messageId: context.stanzaId };
  }
  const expiration = context?.expiration ?? undefined;
  if (expiration) message.ephemeralExpirationSeconds = expiration;
  else if (isEphemeral) message.ephemeralExpirationSeconds = 0;
  return message;
}
