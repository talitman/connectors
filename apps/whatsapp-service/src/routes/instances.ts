import * as QRCode from 'qrcode';
import { z } from 'zod';
import { parseWith } from '../errors.js';
import type { InstanceManager } from '../instance-manager.js';
import type { WhatsAppServiceApp } from '../server.js';

const pairingSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('qr') }),
  z.object({ method: z.literal('code'), phoneNumber: z.string().regex(/^\d{6,15}$/) }),
]);

const createSchema = z.object({
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  webhook: z.object({ url: z.url(), secret: z.string().min(1).optional() }).optional(),
  pairing: pairingSchema.optional(),
  autoConnect: z.boolean().optional(),
});

const paramsSchema = z.object({ id: z.string().min(1) });

export function instanceRoutes(app: WhatsAppServiceApp, deps: { manager: InstanceManager }): void {
  const { manager } = deps;
  const idOf = (params: unknown) => parseWith(paramsSchema, params).id;

  app.post('/instances', async (request, reply) => {
    const body = parseWith(createSchema, request.body ?? {});
    const instance = await manager.create(body);
    return reply.code(201).send(await instance.view());
  });

  app.get('/instances/:id', async (request) => manager.require(idOf(request.params)).view());

  app.get('/instances/:id/status', async (request) =>
    manager.require(idOf(request.params)).connector.getStatus(),
  );

  app.post('/instances/:id/connect', async (request, reply) => {
    const id = idOf(request.params);
    await manager.connect(id);
    return reply.code(202).send(await manager.require(id).connector.getStatus());
  });

  app.get('/instances/:id/pairing', async (request, reply) => {
    const pairing = manager.require(idOf(request.params)).connector.getPairing();
    if (!pairing) return reply.code(204).send();
    if (pairing.method === 'qr') {
      return {
        method: 'qr',
        qr: { raw: pairing.qr, dataUrl: await QRCode.toDataURL(pairing.qr) },
        issuedAt: pairing.issuedAt,
      };
    }
    return {
      method: 'code',
      code: pairing.code,
      phoneNumber: pairing.phoneNumber,
      issuedAt: pairing.issuedAt,
    };
  });

  app.post('/instances/:id/disconnect', async (request) => {
    const id = idOf(request.params);
    await manager.disconnect(id);
    return manager.require(id).connector.getStatus();
  });

  app.delete('/instances/:id', async (request, reply) => {
    await manager.remove(idOf(request.params));
    return reply.code(204).send();
  });
}
