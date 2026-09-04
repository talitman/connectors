import { Readable, Transform } from 'node:stream';
import type { OutgoingMedia } from '@connectors/whatsapp';
import { z } from 'zod';
import { HttpError, parseWith } from '../errors.js';
import type { InstanceManager } from '../instance-manager.js';
import type { WhatsAppServiceApp } from '../server.js';

const base = { to: z.string().min(1), quotedMessageId: z.string().min(1).optional() };

const textSchema = z.object({ ...base, type: z.literal('text'), text: z.string().min(1) });

const mediaSchema = z
  .object({
    ...base,
    type: z.enum(['image', 'video', 'audio', 'document']),
    mimetype: z.string().min(1),
    base64: z.string().min(1).optional(),
    url: z.url().optional(),
    caption: z.string().optional(),
    fileName: z.string().min(1).optional(),
    voiceNote: z.boolean().optional(),
  })
  .refine((v) => (v.base64 === undefined) !== (v.url === undefined), {
    message: 'provide exactly one of base64 or url',
  })
  .refine((v) => v.type !== 'document' || v.fileName !== undefined, {
    message: 'fileName is required for documents',
    path: ['fileName'],
  });

const bodySchema = z.union([textSchema, mediaSchema]);
const paramsSchema = z.object({ id: z.string().min(1) });

export interface MessageRouteDeps {
  manager: InstanceManager;
  fetch?: typeof fetch;
}

/** Hard ceiling on media fetched from a caller-supplied url (64 MiB). */
export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function fetchFailed(message: string): HttpError {
  return new HttpError(400, 'MEDIA_FETCH_FAILED', message);
}

/** Destroys the source once more than MAX_MEDIA_BYTES have flowed through. */
function capped(source: Readable): Readable {
  let seen = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > MAX_MEDIA_BYTES) {
        callback(fetchFailed(`Media url exceeds the ${MAX_MEDIA_BYTES} byte limit`));
        return;
      }
      callback(null, chunk);
    },
  });
  limiter.on('error', () => source.destroy());
  return source.pipe(limiter);
}

async function loadData(
  body: z.infer<typeof mediaSchema>,
  fetchFn: typeof fetch,
): Promise<Buffer | Readable> {
  if (body.base64 !== undefined) return Buffer.from(body.base64, 'base64');
  const url = new URL(body.url!);
  if (!ALLOWED_PROTOCOLS.has(url.protocol))
    throw fetchFailed(`Media url protocol ${url.protocol} is not supported (use http or https)`);
  const res = await fetchFn(url, { signal: AbortSignal.timeout(30_000) }).catch((err: unknown) => {
    throw fetchFailed(`Could not fetch media url: ${String(err)}`);
  });
  if (!res.ok || !res.body) throw fetchFailed(`Media url responded with status ${res.status}`);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_MEDIA_BYTES) {
    await res.body.cancel().catch(() => undefined);
    throw fetchFailed(`Media url declares ${declared} bytes, above the ${MAX_MEDIA_BYTES} limit`);
  }
  return capped(Readable.fromWeb(res.body));
}

function toOutgoing(body: z.infer<typeof mediaSchema>, data: Buffer | Readable): OutgoingMedia {
  const caption = body.caption === undefined ? {} : { caption: body.caption };
  switch (body.type) {
    case 'image':
      return { kind: 'image', data, mimetype: body.mimetype, ...caption };
    case 'video':
      return { kind: 'video', data, mimetype: body.mimetype, ...caption };
    case 'audio':
      return {
        kind: 'audio',
        data,
        mimetype: body.mimetype,
        ...(body.voiceNote === undefined ? {} : { voiceNote: body.voiceNote }),
      };
    case 'document':
      return {
        kind: 'document',
        data,
        mimetype: body.mimetype,
        fileName: body.fileName!,
        ...caption,
      };
  }
}

export function messageRoutes(app: WhatsAppServiceApp, deps: MessageRouteDeps): void {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  app.post('/instances/:id/messages', async (request, reply) => {
    const { id } = parseWith(paramsSchema, request.params);
    const body = parseWith(bodySchema, request.body ?? {});
    const connector = deps.manager.require(id).connector;
    const options =
      body.quotedMessageId === undefined ? {} : { quotedMessageId: body.quotedMessageId };
    const sent =
      body.type === 'text'
        ? await connector.sendText(body.to, body.text, options)
        : await connector.sendMedia(
            body.to,
            toOutgoing(body, await loadData(body, fetchFn)),
            options,
          );
    return reply.code(201).send(sent);
  });
}
