import { z } from 'zod';
import { parseWith } from '../errors.js';
import type { InstanceManager } from '../instance-manager.js';
import type { WhatsAppServiceApp } from '../server.js';

const paramsSchema = z.object({ id: z.string().min(1), messageId: z.string().min(1) });

const CONTROL = /[\u0000-\u001f\u007f]/g;
const NON_ASCII = /[^\u0020-\u007e]/g;

/**
 * RFC 6266 / RFC 5987 Content-Disposition. Node rejects header values above U+00FF, so the
 * quoted `filename` carries an ASCII-only fallback and `filename*` carries the real name.
 */
export function contentDisposition(fileName: string): string {
  const clean = fileName.replace(CONTROL, '');
  const ascii = clean.replace(NON_ASCII, '_').replace(/["\\]/g, '');
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function mediaRoutes(app: WhatsAppServiceApp, deps: { manager: InstanceManager }): void {
  app.get('/instances/:id/media/:messageId', async (request, reply) => {
    const { id, messageId } = parseWith(paramsSchema, request.params);
    const connector = deps.manager.require(id).connector;
    const ref = connector.describeMedia(messageId);
    const stream = await connector.downloadMedia({ messageId });
    void reply.header('content-type', ref?.mimetype ?? 'application/octet-stream');
    if (ref?.fileName) {
      void reply.header('content-disposition', contentDisposition(ref.fileName));
    }
    return reply.send(stream);
  });
}
