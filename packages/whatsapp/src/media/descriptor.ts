import type {
  MediaDescriptor,
  RawMediaMessage,
  RawMessage,
  RawMessageContent,
} from '../client/types.js';
import type { MediaKind, MediaRef } from '../types.js';
import { unwrapContent } from '../normalize/message.js';

const MEDIA_FIELDS = [
  ['imageMessage', 'image'],
  ['videoMessage', 'video'],
  ['audioMessage', 'audio'],
  ['documentMessage', 'document'],
  ['stickerMessage', 'sticker'],
] as const;

export function findMedia(
  content: RawMessageContent,
): { kind: MediaKind; media: RawMediaMessage } | undefined {
  for (const [field, kind] of MEDIA_FIELDS) {
    const media = content[field];
    if (media) return { kind, media };
  }
  return undefined;
}

export function extractMediaDescriptor(raw: RawMessage): MediaDescriptor | undefined {
  if (!raw.message) return undefined;
  const found = findMedia(unwrapContent(raw.message).content);
  if (!found) return undefined;
  const { kind, media } = found;
  if (!media.mediaKey || !media.directPath || !media.mimetype) return undefined;
  const descriptor: MediaDescriptor = {
    kind,
    mediaKey: media.mediaKey,
    directPath: media.directPath,
    mimetype: media.mimetype,
  };
  if (media.url) descriptor.url = media.url;
  return descriptor;
}

export function mediaRefOf(kind: MediaKind, media: RawMediaMessage, messageId: string): MediaRef {
  const ref: MediaRef = { kind, mimetype: media.mimetype ?? 'application/octet-stream', messageId };
  const size =
    media.fileLength == null
      ? undefined
      : typeof media.fileLength === 'number'
        ? media.fileLength
        : media.fileLength.toNumber();
  if (size !== undefined) ref.sizeBytes = size;
  if (media.fileSha256) ref.sha256 = Buffer.from(media.fileSha256).toString('hex');
  if (media.fileName) ref.fileName = media.fileName;
  if (media.width != null) ref.width = media.width;
  if (media.height != null) ref.height = media.height;
  if (media.seconds != null) ref.durationSeconds = media.seconds;
  return ref;
}
