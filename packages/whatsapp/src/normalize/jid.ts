import { ConnectorError } from '@connectors/core';
import type { ChatType } from '../types.js';

export const USER_SERVER = 's.whatsapp.net';
export const LID_SERVER = 'lid';
export const GROUP_SERVER = 'g.us';
export const BROADCAST_SERVER = 'broadcast';
export const NEWSLETTER_SERVER = 'newsletter';

export function decodeJid(jid: string): { user: string; server: string } | undefined {
  const at = jid.indexOf('@');
  if (at <= 0) return undefined;
  const server = jid.slice(at + 1);
  const user = jid.slice(0, at).split(':')[0] ?? '';
  return { user, server: server === 'c.us' ? USER_SERVER : server };
}

export function normalizeJid(jid: string): string {
  const parts = decodeJid(jid);
  return parts ? `${parts.user}@${parts.server}` : jid;
}

export function isPhoneJid(jid: string): boolean {
  return decodeJid(jid)?.server === USER_SERVER;
}

export function isLidJid(jid: string): boolean {
  return decodeJid(jid)?.server === LID_SERVER;
}

export function phoneNumberFromJid(jid: string): string | undefined {
  const parts = decodeJid(jid);
  return parts && parts.server === USER_SERVER && /^\d+$/.test(parts.user) ? parts.user : undefined;
}

export function chatTypeOf(jid: string): ChatType {
  const server = decodeJid(jid)?.server;
  if (jid === 'status@broadcast') return 'status';
  switch (server) {
    case GROUP_SERVER:
      return 'group';
    case BROADCAST_SERVER:
      return 'broadcast';
    case NEWSLETTER_SERVER:
      return 'newsletter';
    default:
      return 'direct';
  }
}

/** Accepts a JID or a bare E.164 number without '+'. */
export function toChatJid(chatId: string): string {
  if (/^\d{5,20}$/.test(chatId)) return `${chatId}@${USER_SERVER}`;
  if (chatId.includes('@') && decodeJid(chatId)?.user) return normalizeJid(chatId);
  throw new ConnectorError(`INVALID_CHAT_ID: ${JSON.stringify(chatId)}`, {
    code: 'INVALID_CHAT_ID',
    retryable: false,
  });
}
