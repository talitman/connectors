import { describe, expect, it } from 'vitest';
import type { RawMessage, RawMessageContent } from '../client/types.js';
import { extractMediaDescriptor } from '../media/descriptor.js';
import { normalizeMessage } from './message.js';

const media = {
  url: 'https://mmg.whatsapp.net/x',
  directPath: '/v/t62.7118-24/abc.enc',
  mediaKey: new Uint8Array([1, 2, 3]),
  mimetype: 'image/jpeg',
  fileLength: 1234,
  fileSha256: new Uint8Array([0xab, 0xcd]),
  width: 640,
  height: 480,
};

function raw(message: RawMessageContent, overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    key: { remoteJid: '972501234567@s.whatsapp.net', fromMe: false, id: 'MSG1' },
    message,
    messageTimestamp: 1_700_000_000,
    pushName: 'Alice',
    ...overrides,
  };
}

describe('normalizeMessage', () => {
  it('normalizes a plain text message in a direct chat', () => {
    const m = normalizeMessage(raw({ conversation: 'hi' }))!;
    expect(m).toMatchObject({
      messageId: 'MSG1',
      chatId: '972501234567@s.whatsapp.net',
      chatType: 'direct',
      direction: 'inbound',
      sender: {
        id: '972501234567@s.whatsapp.net',
        phoneNumber: '972501234567',
        displayName: 'Alice',
      },
      content: { kind: 'text', text: 'hi' },
      mentions: [],
      isViewOnce: false,
      isEdit: false,
      isForwarded: false,
    });
    expect(m.timestamp.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it('reads Long-like timestamps', () => {
    const m = normalizeMessage(
      raw({ conversation: 'x' }, { messageTimestamp: { toNumber: () => 1_700_000_001 } }),
    )!;
    expect(m.timestamp.getTime()).toBe(1_700_000_001_000);
  });

  it('extracts quoted, mentions, forwarded and ephemeral context from extended text', () => {
    const m = normalizeMessage(
      raw({
        extendedTextMessage: {
          text: 'hey @1',
          contextInfo: {
            stanzaId: 'Q1',
            participant: '111@s.whatsapp.net',
            mentionedJid: ['111@s.whatsapp.net'],
            isForwarded: true,
            expiration: 86400,
          },
        },
      }),
    )!;
    expect(m.content).toEqual({ kind: 'text', text: 'hey @1' });
    expect(m.quoted).toEqual({ messageId: 'Q1', senderId: '111@s.whatsapp.net' });
    expect(m.mentions).toEqual(['111@s.whatsapp.net']);
    expect(m.isForwarded).toBe(true);
    expect(m.ephemeralExpirationSeconds).toBe(86400);
  });

  it('carries LID and phone number for senders addressed by LID', () => {
    const m = normalizeMessage(
      raw(
        { conversation: 'x' },
        {
          key: {
            remoteJid: '999@lid',
            remoteJidAlt: '972501234567@s.whatsapp.net',
            fromMe: false,
            id: 'L1',
          },
        },
      ),
    )!;
    expect(m.chatId).toBe('999@lid');
    expect(m.sender).toEqual({
      id: '999@lid',
      lid: '999@lid',
      phoneNumber: '972501234567',
      displayName: 'Alice',
    });
  });

  it('uses the participant as sender in groups', () => {
    const m = normalizeMessage(
      raw(
        { conversation: 'x' },
        {
          key: {
            remoteJid: '123@g.us',
            fromMe: false,
            id: 'G1',
            participant: '555@lid',
            participantAlt: '972500000000@s.whatsapp.net',
          },
        },
      ),
    )!;
    expect(m.chatType).toBe('group');
    expect(m.sender).toEqual({
      id: '555@lid',
      lid: '555@lid',
      phoneNumber: '972500000000',
      displayName: 'Alice',
    });
  });

  it('marks outbound messages and uses selfId as sender in direct chats', () => {
    const m = normalizeMessage(
      raw(
        { conversation: 'x' },
        { key: { remoteJid: '1@s.whatsapp.net', fromMe: true, id: 'O1' }, pushName: null },
      ),
      {
        selfId: '972509999999@s.whatsapp.net',
      },
    )!;
    expect(m.direction).toBe('outbound');
    expect(m.sender).toEqual({ id: '972509999999@s.whatsapp.net', phoneNumber: '972509999999' });
  });

  it('normalizes image with caption and media ref', () => {
    const m = normalizeMessage(raw({ imageMessage: { ...media, caption: 'look' } }))!;
    expect(m.content).toEqual({
      kind: 'image',
      caption: 'look',
      media: {
        kind: 'image',
        mimetype: 'image/jpeg',
        sizeBytes: 1234,
        sha256: 'abcd',
        width: 640,
        height: 480,
        messageId: 'MSG1',
      },
    });
  });

  it('normalizes voice notes, video, document and sticker', () => {
    expect(
      normalizeMessage(
        raw({
          audioMessage: { ...media, mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 4 },
        }),
      )!.content,
    ).toEqual({
      kind: 'audio',
      isVoiceNote: true,
      media: {
        kind: 'audio',
        mimetype: 'audio/ogg; codecs=opus',
        sizeBytes: 1234,
        sha256: 'abcd',
        width: 640,
        height: 480,
        durationSeconds: 4,
        messageId: 'MSG1',
      },
    });
    expect(
      normalizeMessage(
        raw({ videoMessage: { ...media, mimetype: 'video/mp4', gifPlayback: true, seconds: 2 } }),
      )!.content,
    ).toMatchObject({ kind: 'video', isGif: true });
    expect(
      normalizeMessage(
        raw({
          documentMessage: {
            ...media,
            mimetype: 'application/pdf',
            fileName: 'a.pdf',
            caption: 'c',
          },
        }),
      )!.content,
    ).toMatchObject({
      kind: 'document',
      caption: 'c',
      media: { kind: 'document', fileName: 'a.pdf' },
    });
    expect(
      normalizeMessage(
        raw({ stickerMessage: { ...media, mimetype: 'image/webp', isAnimated: true } }),
      )!.content,
    ).toMatchObject({ kind: 'sticker', isAnimated: true });
  });

  it('normalizes contacts, locations and reactions', () => {
    expect(
      normalizeMessage(raw({ contactMessage: { displayName: 'Bob', vcard: 'BEGIN:VCARD' } }))!
        .content,
    ).toEqual({
      kind: 'contact',
      contacts: [{ displayName: 'Bob', vcard: 'BEGIN:VCARD' }],
    });
    expect(
      normalizeMessage(
        raw({
          contactsArrayMessage: { contacts: [{ displayName: 'A', vcard: 'v1' }, { vcard: 'v2' }] },
        }),
      )!.content,
    ).toEqual({
      kind: 'contact',
      contacts: [
        { displayName: 'A', vcard: 'v1' },
        { displayName: '', vcard: 'v2' },
      ],
    });
    expect(
      normalizeMessage(
        raw({ locationMessage: { degreesLatitude: 32.1, degreesLongitude: 34.8, name: 'TLV' } }),
      )!.content,
    ).toEqual({
      kind: 'location',
      latitude: 32.1,
      longitude: 34.8,
      name: 'TLV',
      isLive: false,
    });
    expect(
      normalizeMessage(raw({ liveLocationMessage: { degreesLatitude: 1, degreesLongitude: 2 } }))!
        .content,
    ).toEqual({
      kind: 'location',
      latitude: 1,
      longitude: 2,
      isLive: true,
    });
    expect(
      normalizeMessage(raw({ reactionMessage: { key: { id: 'T1' }, text: '👍' } }))!.content,
    ).toEqual({ kind: 'reaction', emoji: '👍', targetMessageId: 'T1' });
  });

  it('unwraps ephemeral, view-once, edited and captioned-document wrappers', () => {
    const vo = normalizeMessage(raw({ viewOnceMessageV2: { message: { imageMessage: media } } }))!;
    expect(vo.isViewOnce).toBe(true);
    expect(vo.content.kind).toBe('image');
    const ed = normalizeMessage(raw({ editedMessage: { message: { conversation: 'fixed' } } }))!;
    expect(ed.isEdit).toBe(true);
    expect(ed.content).toEqual({ kind: 'text', text: 'fixed' });
    const eph = normalizeMessage(
      raw({ ephemeralMessage: { message: { extendedTextMessage: { text: 'e' } } } }),
    )!;
    expect(eph.content).toEqual({ kind: 'text', text: 'e' });
    const doc = normalizeMessage(
      raw({
        documentWithCaptionMessage: {
          message: { documentMessage: { ...media, mimetype: 'application/pdf', caption: 'cap' } },
        },
      }),
    )!;
    expect(doc.content).toMatchObject({ kind: 'document', caption: 'cap' });
  });

  it('reports unsupported types and skips empty/protocol/stub messages', () => {
    expect(normalizeMessage(raw({ pollCreationMessageV3: { name: 'p' } }))!.content).toEqual({
      kind: 'unsupported',
      providerType: 'pollCreationMessageV3',
    });
    expect(normalizeMessage(raw({ protocolMessage: { type: 0 } }))).toBeUndefined();
    expect(
      normalizeMessage({ key: { remoteJid: '1@s.whatsapp.net', id: 'S' }, messageStubType: 1 }),
    ).toBeUndefined();
    expect(
      normalizeMessage(
        raw(
          { conversation: 'x' },
          { key: { remoteJid: '1@s.whatsapp.net', fromMe: false, id: null } },
        ),
      ),
    ).toBeUndefined();
  });
});

describe('extractMediaDescriptor', () => {
  it('returns the decryption descriptor for media messages', () => {
    const d = extractMediaDescriptor(
      raw({ viewOnceMessage: { message: { audioMessage: { ...media, mimetype: 'audio/ogg' } } } }),
    );
    expect(d).toEqual({
      kind: 'audio',
      mediaKey: new Uint8Array([1, 2, 3]),
      directPath: '/v/t62.7118-24/abc.enc',
      url: 'https://mmg.whatsapp.net/x',
      mimetype: 'audio/ogg',
    });
  });

  it('returns undefined for non-media or incomplete media', () => {
    expect(extractMediaDescriptor(raw({ conversation: 'x' }))).toBeUndefined();
    expect(
      extractMediaDescriptor(raw({ imageMessage: { mimetype: 'image/jpeg' } })),
    ).toBeUndefined();
  });
});
