import type { WhatsAppConnector } from '@connectors/whatsapp';
import Fastify, {
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import type { Logger as PinoLogger } from 'pino';
import { apiKeyHook } from './auth-hook.js';
import type { ServiceConfig } from './config.js';
import { HttpError, NotFoundError, toHttpError } from './errors.js';
import { healthRoutes } from './routes/health.js';

/** The slice of InstanceManager the HTTP layer needs; the real class (Task 17) satisfies it. */
export interface InstanceManagerLike {
  list(): Array<{ definition: { id: string }; connector: WhatsAppConnector }>;
}

export interface ServerDeps {
  manager: InstanceManagerLike;
  config: ServiceConfig;
  logger: PinoLogger;
}

/** FastifyInstance parametrized with the pino logger createPinoLogger returns (loggerInstance option). */
export type WhatsAppServiceApp = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  PinoLogger
>;

export function buildServer(deps: ServerDeps): WhatsAppServiceApp {
  const app = Fastify({ loggerInstance: deps.logger, disableRequestLogging: true });

  app.addHook('onRequest', apiKeyHook(deps.config.API_KEY));

  app.setNotFoundHandler((_request, reply) => {
    const err = new NotFoundError('Route');
    void reply.code(err.statusCode).send(err.toBody());
  });

  app.setErrorHandler((error, request, reply) => {
    const http = toHttpError(error);
    if (http.statusCode >= 500) request.log.error({ err: error }, 'request failed');
    else if (!(error instanceof HttpError)) request.log.warn({ err: error }, 'request rejected');
    void reply.code(http.statusCode).send(http.toBody());
  });

  healthRoutes(app, deps.manager);
  // instanceRoutes(app, deps) — Task 17
  // messageRoutes(app, deps); mediaRoutes(app, deps) — Task 18

  return app;
}
