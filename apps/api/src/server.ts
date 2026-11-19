import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Store } from './store/types';
import { registerReferenceRoutes } from './routes/reference';
import { registerPipelineRoutes } from './routes/pipeline';
import { registerEventRoutes } from './routes/events';
import { routeTable } from './routes/validation';
import { openApiDocument, openApiHtml } from './openapi';

export interface BuildServerOptions {
  store: Store;
  corsOrigin?: string | string[] | boolean;
  logger?: boolean;
  appEnv?: string;
}

const startedAt = Date.now();

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const server = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 2 * 1024 * 1024,
  });

  await server.register(cors, {
    origin: options.corsOrigin ?? true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  server.get('/health', async () => ({
    status: 'ok',
    store: options.store.kind,
    appEnv: options.appEnv ?? 'local',
    uptimeSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    now: new Date().toISOString(),
  }));

  routeTable(server);
  await registerReferenceRoutes(server, options.store);
  await registerPipelineRoutes(server, options.store);
  await registerEventRoutes(server, options.store);

  server.get('/api-docs/openapi.json', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return openApiDocument;
  });

  server.get('/api-docs', async (_request, reply) => {
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    return openApiHtml;
  });

  server.setErrorHandler((error, _request, reply) => {
    if (error.validation) {
      return reply.status(400).send({ error: 'invalid_request', message: error.message });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: 'request_error', message: error.message });
    }
    server.log.error(error);
    return reply.status(500).send({ error: 'internal_error', message: '요청을 처리하지 못했습니다.' });
  });

  server.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ error: 'not_found', path: request.url }),
  );

  return server;
}
