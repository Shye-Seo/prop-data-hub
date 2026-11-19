import { buildServer } from './server';
import { createStore } from './store';

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const store = createStore();
  const server = await buildServer({
    store,
    corsOrigin: process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()) ?? true,
    logger: process.env.NODE_ENV !== 'test',
    appEnv: process.env.NODE_ENV ?? 'local',
  });

  await server.listen({ port, host });
  server.log.info(`prop-data-hub API listening on http://${host}:${port} (store=${store.kind})`);

  const shutdown = async (signal: string) => {
    server.log.info(`${signal} 수신, 종료합니다.`);
    await server.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
