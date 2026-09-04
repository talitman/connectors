import { Readable } from 'node:stream';
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

async function loadData(
  body: z.infer<typeof mediaSchema>,
  fetchFn: typeof fetch,
): Promise<Buffer | Readable> {
  if (body.base64 !== undefined) return Buffer.from(body.base64, 'base64');
  const res = await fetchFn(body.url!, { signal: AbortSignal.timeout(30_000) }).catch(
    (err: unknown) => {
      throw new HttpError(400, 'MEDIA_FETCH_FAILED', `Could not fetch media url: ${String(err)}`);
    },
  );
  if (!res.ok || !res.body)
    throw new HttpError(400, 'MEDIA_FETCH_FAILED', `Media url responded with status ${res.status}`);
  return Readable.fromWeb(res.body);
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
