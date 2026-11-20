import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { MAX_PAGE_SIZE, recentMonths, shiftMonth } from '@prop/shared';

export function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({
    error: 'validation_error',
    issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  });
}

export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  return schema.parse(value);
}

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM 형식이어야 합니다');
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다');
export const lawdCdSchema = z.string().regex(/^\d{5}$/, '5자리 지역코드여야 합니다');
export const legalDongCodeSchema = z.string().regex(/^\d{10}$/, '10자리 법정동코드여야 합니다');

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const transactionQuerySchema = paginationSchema.extend({
  lawdCd: lawdCdSchema.optional(),
  legalDongCode: legalDongCodeSchema.optional(),
  dong: z.string().min(1).max(40).optional(),
  aptName: z.string().min(1).max(60).optional(),
  complexIds: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').map((id) => id.trim()).filter(Boolean) : undefined)),
  fromMonth: monthSchema.optional(),
  toMonth: monthSchema.optional(),
  minPriceKrw: z.coerce.number().int().nonnegative().optional(),
  maxPriceKrw: z.coerce.number().int().positive().optional(),
  minAreaM2: z.coerce.number().positive().optional(),
  maxAreaM2: z.coerce.number().positive().optional(),
  includeCanceled: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  sort: z.enum(['deal_date_desc', 'price_desc', 'price_asc', 'ppp_desc']).default('deal_date_desc'),
});

export const monthlyQuerySchema = z.object({
  lawdCd: lawdCdSchema.optional(),
  legalDongCode: legalDongCodeSchema.optional(),
  months: z.coerce.number().int().min(1).max(60).default(24),
});

export const macroQuerySchema = z.object({
  codes: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').map((code) => code.trim()).filter(Boolean) : undefined)),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

export function monthsRange(months: number): { startMonth: string; endMonth: string } {
  const endMonth = shiftMonth(new Date().toISOString().slice(0, 7), -1);
  return { startMonth: recentMonths(endMonth, months)[0]!, endMonth };
}

export function routeTable(server: FastifyInstance): void {
  server.get('/api/v1', async () => ({
    name: 'prop-data-hub API',
    version: '1.0.0',
    documentation: '/api-docs',
    endpoints: [
      'GET /health',
      'GET /api/v1/regions',
      'GET /api/v1/complexes',
      'GET /api/v1/complexes/:complexId/monthly',
      'GET /api/v1/transactions',
      'GET /api/v1/transactions/monthly',
      'GET /api/v1/rents',
      'GET /api/v1/market/jeonse-ratio',
      'GET /api/v1/macro',
      'GET /api/v1/macro/latest',
      'GET /api/v1/pipeline/sources',
      'GET /api/v1/pipeline/runs',
      'GET /api/v1/pipeline/runs/:runId',
      'GET /api/v1/pipeline/dlq',
      'POST /api/v1/events',
      'GET /api/v1/events',
      'GET /api/v1/events/stats',
      'GET /api/v1/events/funnel',
      'GET /api-docs',
      'GET /api-docs/openapi.json',
    ],
  }));
}
