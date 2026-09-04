import { z } from 'zod';
import { parseWith } from '../errors.js';
import type { InstanceManager } from '../instance-manager.js';
import type { WhatsAppServiceApp } from '../server.js';

const paramsSchema = z.object({ id: z.string().min(1), messageId: z.string().min(1) });

export function mediaRoutes(app: WhatsAppServiceApp, deps: { manager: InstanceManager }): void {
  app.get('/instances/:id/media/:messageId', async (request, reply) => {
    const { id, messageId } = parseWith(paramsSchema, request.params);
    const connector = deps.manager.require(id).connector;
    const ref = connector.describeMedia(messageId);
    const stream = await connector.downloadMedia({ messageId });
    void reply.header('content-type', ref?.mimetype ?? 'application/octet-stream');
    if (ref?.fileName) {
      void reply.header(
        'content-disposition',
        `attachment; filename="${ref.fileName.replace(/["\\]/g, '')}"`,
      );
    }
    return reply.send(stream);
  });
}
