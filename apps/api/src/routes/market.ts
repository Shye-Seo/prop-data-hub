import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from '../store/types';
import {
  lawdCdSchema,
  legalDongCodeSchema,
  monthSchema,
  paginationSchema,
  sendValidationError,
} from './validation';

const rentQuerySchema = paginationSchema.extend({
  lawdCd: lawdCdSchema.optional(),
  legalDongCode: legalDongCodeSchema.optional(),
  complexId: z.string().min(1).max(64).optional(),
  contractType: z.enum(['jeonse', 'monthly']).optional(),
  fromMonth: monthSchema.optional(),
  toMonth: monthSchema.optional(),
});

const jeonseRatioQuerySchema = z.object({
  lawdCd: lawdCdSchema.optional(),
  legalDongCode: legalDongCodeSchema.optional(),
  complexId: z.string().min(1).max(64).optional(),
  months: z.coerce.number().int().min(3).max(60).default(24),
});

/** 전월세 실거래와 전세가율 조회. 화면(데모·대시보드)과 분석 리포트가 같은 집계를 본다. */
export async function registerMarketRoutes(server: FastifyInstance, store: Store): Promise<void> {
  server.get<{ Querystring: Record<string, string> }>('/api/v1/rents', async (request, reply) => {
    const parsed = rentQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { limit, offset, ...filter } = parsed.data;
    const page = await store.listRentTransactions({ ...filter, limit, offset });
    return {
      items: page.rows,
      total: page.total,
      limit,
      offset,
      basis: '계약일 기준. 전세는 monthlyRentKrw=0, 월세는 보증금과 월세를 함께 표기',
    };
  });

  server.get<{ Querystring: Record<string, string> }>('/api/v1/market/jeonse-ratio', async (request, reply) => {
    const parsed = jeonseRatioQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    if (parsed.data.complexId) {
      const complexes = await store.listComplexes();
      if (!complexes.some((row) => row.complexId === parsed.data.complexId)) {
        return reply.status(404).send({ error: 'complex_not_found', complexId: parsed.data.complexId });
      }
    }

    const series = await store.jeonseRatioMonthly(parsed.data);
    const latest = [...series].reverse().find((row) => row.ratioPct > 0);
    return {
      months: parsed.data.months,
      filter: {
        lawdCd: parsed.data.lawdCd ?? null,
        legalDongCode: parsed.data.legalDongCode ?? null,
        complexId: parsed.data.complexId ?? null,
      },
      latest,
      series,
      definition:
        '전세가율 = 같은 단지·월·면적 구간(5㎡)의 전세 보증금 평당가 ÷ 매매 평당가 × 100. 단지별 값의 월별 중위값을 내려준다.',
      note: '표본이 부족한 달(기여 단지 2개 미만)은 ratioPct=0으로 내려간다.',
    };
  });
}
