import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  behaviorEventSchema,
  computeFunnel,
  toBehaviorEventRecord,
  type BehaviorEventInput,
} from '@prop/shared';
import type { Store } from '../store/types';
import { dateSchema, sendValidationError } from './validation';

const MAX_BATCH = 500;

const batchSchema = z.object({
  events: z.array(z.unknown()).min(1).max(MAX_BATCH),
  sentAt: z.string().datetime({ offset: true }).optional(),
  appEnv: z.enum(['local', 'preview', 'production']).optional(),
});

const listQuerySchema = z.object({
  name: z.string().max(64).optional(),
  sessionId: z.string().max(64).optional(),
  date: dateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const statsQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 30).default(24),
});

const funnelQuerySchema = z.object({
  date: dateSchema.optional(),
});

export async function registerEventRoutes(server: FastifyInstance, store: Store): Promise<void> {
  server.post<{ Body: unknown }>('/api/v1/events', async (request, reply) => {
    const parsed = batchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const accepted: BehaviorEventInput[] = [];
    const rejected: Array<{ index: number; issues: string[] }> = [];

    parsed.data.events.forEach((raw, index) => {
      const result = behaviorEventSchema.safeParse(raw);
      if (result.success) {
        accepted.push(result.data as BehaviorEventInput);
      } else {
        rejected.push({
          index,
          issues: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
        });
      }
    });

    if (accepted.length === 0) {
      return reply.status(400).send({ error: 'all_events_rejected', rejected });
    }

    const records = accepted.map((event) =>
      toBehaviorEventRecord(event, { appEnv: parsed.data.appEnv ?? 'local' }),
    );
    const result = await store.insertBehaviorEvents(records);

    return reply.status(rejected.length > 0 ? 207 : 202).send({
      accepted: accepted.length,
      inserted: result.inserted,
      duplicates: result.duplicates,
      rejectedCount: rejected.length,
      rejected,
      schemaVersion: records[0]?.schemaVersion ?? null,
    });
  });

  server.get<{ Querystring: Record<string, string> }>('/api/v1/events', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const page = await store.listBehaviorEvents(parsed.data);
    return { items: page.rows, total: page.total, limit: parsed.data.limit, offset: parsed.data.offset };
  });

  server.get<{ Querystring: { hours?: string } }>('/api/v1/events/stats', async (request, reply) => {
    const parsed = statsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const since = new Date(Date.now() - parsed.data.hours * 60 * 60 * 1000).toISOString();
    const stats = await store.eventStats(since);
    const { rows } = await store.listBehaviorEvents({ limit: 500, offset: 0 });
    const funnel = computeFunnel(
      rows.map((row) => ({
        name: row.name,
        occurredAt: row.occurredAt,
        sessionId: row.sessionId,
        userPseudoId: row.userPseudoId,
        page: row.page,
        props: row.props,
      })),
    );
    return { window: { hours: parsed.data.hours, since }, ...stats, funnel };
  });

  server.get<{ Querystring: { date?: string } }>('/api/v1/events/funnel', async (request, reply) => {
    const parsed = funnelQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const date = parsed.data.date ?? new Date().toISOString().slice(0, 10);
    const { rows, total } = await store.listBehaviorEvents({ date, limit: 500, offset: 0 });
    const funnel = computeFunnel(
      rows.map((row) => ({
        name: row.name,
        occurredAt: row.occurredAt,
        sessionId: row.sessionId,
        userPseudoId: row.userPseudoId,
        page: row.page,
        props: row.props,
      })),
    );
    return {
      date,
      eventCount: total,
      sampled: Math.min(total, 500),
      funnel,
      definition: '세션 안에서 단계 순서를 지킨 도달만 집계(순서 보정 퍼널)',
    };
  });
}
