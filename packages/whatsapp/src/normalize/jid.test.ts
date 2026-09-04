import { describe, expect, it } from 'vitest';
import {
  chatTypeOf,
  isLidJid,
  isPhoneJid,
  normalizeJid,
  phoneNumberFromJid,
  toChatJid,
} from './jid.js';

describe('jid helpers', () => {
  it('normalizes device suffixes and legacy servers', () => {
    expect(normalizeJid('972501234567:12@s.whatsapp.net')).toBe('972501234567@s.whatsapp.net');
    expect(normalizeJid('972501234567@c.us')).toBe('972501234567@s.whatsapp.net');
    expect(normalizeJid('123456@lid')).toBe('123456@lid');
    expect(normalizeJid('123-456@g.us')).toBe('123-456@g.us');
  });

  it('classifies chat types', () => {
    expect(chatTypeOf('1@s.whatsapp.net')).toBe('direct');
    expect(chatTypeOf('1@lid')).toBe('direct');
    expect(chatTypeOf('1@g.us')).toBe('group');
    expect(chatTypeOf('status@broadcast')).toBe('status');
    expect(chatTypeOf('123@broadcast')).toBe('broadcast');
    expect(chatTypeOf('123@newsletter')).toBe('newsletter');
  });

  it('extracts phone numbers only from phone-number JIDs', () => {
    expect(isPhoneJid('1@s.whatsapp.net')).toBe(true);
    expect(isLidJid('1@lid')).toBe(true);
    expect(phoneNumberFromJid('972501234567:3@s.whatsapp.net')).toBe('972501234567');
    expect(phoneNumberFromJid('1@lid')).toBeUndefined();
    expect(phoneNumberFromJid('1@g.us')).toBeUndefined();
  });

  it('coerces chat ids for sending', () => {
    expect(toChatJid('972501234567')).toBe('972501234567@s.whatsapp.net');
    expect(toChatJid('123@g.us')).toBe('123@g.us');
    expect(toChatJid('55@c.us')).toBe('55@s.whatsapp.net');
    expect(() => toChatJid('+972 50')).toThrow('INVALID_CHAT_ID');
    expect(() => toChatJid('')).toThrow('INVALID_CHAT_ID');
  });
});
