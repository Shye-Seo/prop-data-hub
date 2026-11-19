import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { latestMacroValue } from '@prop/shared';
import type { Store } from '../store/types';
import {
  lawdCdSchema,
  legalDongCodeSchema,
  macroQuerySchema,
  monthlyQuerySchema,
  sendValidationError,
  transactionQuerySchema,
} from './validation';

const complexParamsSchema = z.object({ complexId: z.string().min(1).max(64) });

export async function registerReferenceRoutes(server: FastifyInstance, store: Store): Promise<void> {
  server.get('/api/v1/regions', async () => {
    const items = await store.listRegions();
    return { items, count: items.length };
  });

  server.get('/api/v1/complexes', async () => {
    const items = await store.listComplexes();
    return { items, count: items.length };
  });

  server.get<{ Params: { complexId: string }; Querystring: { months?: string } }>(
    '/api/v1/complexes/:complexId/monthly',
    async (request, reply) => {
      const params = complexParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(reply, params.error);
      const query = monthlyQuerySchema.safeParse(request.query ?? {});
      if (!query.success) return sendValidationError(reply, query.error);

      const complexes = await store.listComplexes();
      const complex = complexes.find((row) => row.complexId === params.data.complexId);
      if (!complex) return reply.status(404).send({ error: 'complex_not_found', complexId: params.data.complexId });

      const series = await store.complexMonthly(complex.complexId, query.data.months);
      return {
        complex,
        months: query.data.months,
        series,
        basis: '계약일 기준 중위값, 해제 거래 제외',
      };
    },
  );

  server.get<{ Querystring: Record<string, string> }>('/api/v1/transactions', async (request, reply) => {
    const parsed = transactionQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { limit, offset, ...filter } = parsed.data;

    const page = await store.listTransactions({ ...filter, limit, offset });
    return {
      items: page.rows,
      total: page.total,
      limit,
      offset,
      filter: {
        ...filter,
        fromMonth: filter.fromMonth ?? null,
        toMonth: filter.toMonth ?? null,
      },
      unit: { priceKrw: '원', areaM2: '㎡', pricePerPyeong: '원/평' },
    };
  });

  server.get<{ Querystring: Record<string, string> }>('/api/v1/transactions/monthly', async (request, reply) => {
    const parsed = monthlyQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { lawdCd, legalDongCode, months } = parsed.data;

    if (lawdCd && legalDongCode) {
      return reply.status(400).send({
        error: 'ambiguous_scope',
        message: 'lawdCd와 legalDongCode 중 하나만 지정해야 합니다.',
      });
    }
    if (lawdCd && !lawdCdSchema.safeParse(lawdCd).success) return sendValidationError(reply, lawdCdSchema.safeParse(lawdCd).error!);
    if (legalDongCode && !legalDongCodeSchema.safeParse(legalDongCode).success) {
      return sendValidationError(reply, legalDongCodeSchema.safeParse(legalDongCode).error!);
    }

    const series = await store.monthlySeries({ lawdCd, legalDongCode, months });
    return {
      scope: { lawdCd: lawdCd ?? null, legalDongCode: legalDongCode ?? null },
      months,
      series,
      basis: '계약일 기준 중위값, 해제 거래 제외',
      asOf: series[series.length - 1]?.month ?? null,
    };
  });

  server.get<{ Querystring: Record<string, string> }>('/api/v1/macro', async (request, reply) => {
    const parsed = macroQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const rows = await store.listMacro(parsed.data);
    return {
      items: rows,
      count: rows.length,
      basis: '월간 지표는 해당 월 말일 기준',
    };
  });

  server.get('/api/v1/macro/latest', async () => {
    const rows = await store.listMacro({});
    return {
      baseRate: latestMacroValue(rows, 'base_rate') ?? null,
      mortgageRate: latestMacroValue(rows, 'mortgage_rate') ?? null,
      cpi: latestMacroValue(rows, 'cpi') ?? null,
      basis: '가장 최근 기준일의 값. 수집 시점과 다를 수 있다.',
    };
  });
}
