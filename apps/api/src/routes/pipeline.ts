import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from '../store/types';
import { sendValidationError } from './validation';

const runsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const runParamsSchema = z.object({
  runId: z.string().min(1).max(80),
});

export async function registerPipelineRoutes(server: FastifyInstance, store: Store): Promise<void> {
  server.get('/api/v1/pipeline/sources', async () => {
    const items = await store.listSources();
    return {
      items,
      count: items.length,
      note: 'asOfPolicy는 데이터 기준일 산정 방식이다. collectedAt(수집 시각)과 구분해 표시한다.',
    };
  });

  server.get<{ Querystring: { limit?: string } }>('/api/v1/pipeline/runs', async (request, reply) => {
    const parsed = runsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const items = await store.listPipelineRuns(parsed.data.limit);
    return {
      items,
      count: items.length,
      summary: summarize(items),
    };
  });

  server.get<{ Params: { runId: string } }>('/api/v1/pipeline/runs/:runId', async (request, reply) => {
    const parsed = runParamsSchema.safeParse(request.params);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const run = await store.getPipelineRun(parsed.data.runId);
    if (!run) return reply.status(404).send({ error: 'run_not_found', runId: parsed.data.runId });
    const tasks = await store.listRunTasks(run.runId);
    return { run, tasks, taskCount: tasks.length };
  });

  server.get('/api/v1/pipeline/dlq', async () => {
    const items = await store.listDeadLetters();
    return {
      items,
      count: items.length,
      unresolved: items.filter((row) => row.resolvedAt === null).length,
    };
  });
}

function summarize(runs: Awaited<ReturnType<Store['listPipelineRuns']>>) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recent = runs.filter((run) => run.startedAt >= since);
  return {
    window: '최근 7일(조회된 실행 기준)',
    runs: recent.length,
    succeeded: recent.filter((run) => run.status === 'succeeded').length,
    partial: recent.filter((run) => run.status === 'partial').length,
    failed: recent.filter((run) => run.status === 'failed').length,
    recordsUpserted: recent.reduce((sum, run) => sum + run.recordsUpserted, 0),
    retries: recent.reduce((sum, run) => sum + run.retryCount, 0),
  };
}
