import Fastify, {
  LogController,
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import type { Logger as PinoLogger } from 'pino';
import { apiKeyHook } from './auth-hook.js';
import type { ServiceConfig } from './config.js';
import { HttpError, NotFoundError, toHttpError } from './errors.js';
import type { InstanceManager } from './instance-manager.js';
import { healthRoutes } from './routes/health.js';
import { instanceRoutes } from './routes/instances.js';
import { mediaRoutes } from './routes/media.js';
import { messageRoutes } from './routes/messages.js';

export interface ServerDeps {
  manager: InstanceManager;
  config: ServiceConfig;
  logger: PinoLogger;
  fetch?: typeof fetch;
}

/** FastifyInstance parametrized with the pino logger createPinoLogger returns (loggerInstance option). */
export type WhatsAppServiceApp = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  PinoLogger
>;

export function buildServer(deps: ServerDeps): WhatsAppServiceApp {
  const app = Fastify({
    loggerInstance: deps.logger,
    logController: new LogController({ disableRequestLogging: true }),
  });

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
  instanceRoutes(app, deps);
  messageRoutes(app, { manager: deps.manager, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  mediaRoutes(app, { manager: deps.manager });

  return app;
}
