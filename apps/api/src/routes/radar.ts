import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_ALERT_RULE,
  DEAL_SCORE_SUMMARY,
  LARGE_COMPLEX_HOUSEHOLDS,
  buildAlertPreview,
  filterRadarDeals,
  normalizeAlertRule,
  radarSummary,
  toBehaviorEventRecord,
  validateBehaviorEvent,
  type AlertChannel,
  type AlertRuleDraft,
  type AreaBandKey,
} from '@prop/shared';
import type { Store } from '../store/types';
import { lawdCdSchema, paginationSchema, sendValidationError } from './validation';

const areaBandSchema = z.enum(['under60', '60to85', '85to115', 'over115', 'all']);

const lawdListSchema = z
  .string()
  .optional()
  .transform((value) => (value ? value.split(',').map((code) => code.trim()).filter(Boolean) : undefined))
  .refine((codes) => !codes || codes.every((code) => lawdCdSchema.safeParse(code).success), {
    message: 'lawdCds는 5자리 시군구 코드를 쉼표로 구분해야 합니다',
  })
  .transform((codes) => (codes ? [...new Set(codes)].slice(0, 8) : undefined));

const radarQuerySchema = paginationSchema
  .extend({
    lawdCds: lawdListSchema,
    minHouseholds: z.coerce.number().int().min(0).max(20_000).default(LARGE_COMPLEX_HOUSEHOLDS),
    areaBand: areaBandSchema.default('all'),
    maxDiscountPct: z.coerce.number().min(1).max(50).default(8),
    minScore: z.coerce.number().int().min(0).max(100).default(0),
    referenceMonths: z.coerce.number().int().min(3).max(12).default(6),
    lookbackMonths: z.coerce.number().int().min(1).max(24).default(6),
    includeBelowThreshold: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  })
  .transform((value) => ({
    ...value,
    limit: Math.min(value.limit, 200),
  }));

const alertRuleBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  lawdCds: z.array(lawdCdSchema).min(1).max(8),
  minHouseholds: z.coerce.number().int().min(0).max(20_000).default(DEFAULT_ALERT_RULE.minHouseholds),
  areaBand: areaBandSchema.default(DEFAULT_ALERT_RULE.areaBand as AreaBandKey | 'all'),
  maxDiscountPct: z.coerce.number().min(1).max(50).default(DEFAULT_ALERT_RULE.maxDiscountPct),
  minScore: z.coerce.number().int().min(0).max(100).default(DEFAULT_ALERT_RULE.minScore),
  channels: z.array(z.enum(['kakao_alimtalk', 'webhook'])).min(1).max(2).default([...DEFAULT_ALERT_RULE.channels]),
  // 보내면 같은 요청에서 alert_rule_create 이벤트를 적재한다.
  sessionId: z.string().min(8).max(64).optional(),
  userPseudoId: z.string().min(8).max(64).optional(),
  ruleId: z.string().min(1).max(64).optional(),
});

function newRuleId(): string {
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 350세대 이상 매매 급매·저평가 레이더 API.
 *
 * 점수·필터·알림 payload 규칙은 packages/shared/src/radar.ts 한 곳에 있고, 라우트는
 * (1) 요청 검증 (2) 스토어에서 표본 조회 (3) 공용 필터 적용 (4) 규칙 저장·이벤트 적재를 맡는다.
 * 데모(GitHub Pages)는 같은 shared 함수를 브라우저에서 실행하므로 숫자가 일치한다.
 */
export async function registerRadarRoutes(server: FastifyInstance, store: Store): Promise<void> {
  server.get<{ Querystring: Record<string, string> }>('/api/v1/radar/deals', async (request, reply) => {
    const parsed = radarQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const query = parsed.data;

    const set = await store.radarDealSet({
      lawdCds: query.lawdCds,
      referenceMonths: query.referenceMonths,
      lookbackMonths: query.lookbackMonths,
      ratioMonths: 24,
    });

    const filtered = filterRadarDeals(set.deals, {
      lawdCds: query.lawdCds,
      // includeBelowThreshold=true는 "세대수 조건에 걸린 단지까지 같이 본다"는 뜻이다(비교용).
      minHouseholds: query.includeBelowThreshold ? 0 : query.minHouseholds,
      areaBand: query.areaBand,
      maxDiscountPct: query.maxDiscountPct,
      minScore: query.minScore,
    });

    return {
      items: filtered.slice(query.offset, query.offset + query.limit),
      total: filtered.length,
      limit: query.limit,
      offset: query.offset,
      asOfMonth: set.asOfMonth,
      filter: {
        lawdCds: query.lawdCds ?? [],
        minHouseholds: query.includeBelowThreshold ? 0 : query.minHouseholds,
        areaBand: query.areaBand,
        maxDiscountPct: query.maxDiscountPct,
        minScore: query.minScore,
        referenceMonths: query.referenceMonths,
        lookbackMonths: query.lookbackMonths,
      },
      summary: radarSummary(filtered),
      universe: set.universe,
      scoreWeights: DEAL_SCORE_SUMMARY,
      definition:
        '할인율 = (거래가 − 같은 단지·면적 구간 최근 6개월 중위 매매가) ÷ 중위 매매가 × 100. ' +
        '점수 = 할인율 45 + 전세가율 20 + 3개월 거래량 15 + 단지 규모 20.',
      note: '기준 시세 표본이 3건 미만인 (단지, 면적 구간)은 목록에서 제외한다.',
    };
  });

  server.get('/api/v1/radar/alert-rules', async () => {
    const items = await store.listAlertRules();
    return { items, count: items.length };
  });

  server.post<{ Body: unknown }>('/api/v1/radar/alert-rules', async (request, reply) => {
    const parsed = alertRuleBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const body = parsed.data;

    const now = new Date().toISOString();
    const draft: AlertRuleDraft = {
      name: body.name,
      lawdCds: body.lawdCds,
      minHouseholds: body.minHouseholds,
      areaBand: body.areaBand,
      maxDiscountPct: body.maxDiscountPct,
      minScore: body.minScore,
      channels: body.channels as AlertChannel[],
    };
    const rule = normalizeAlertRule(draft, { ruleId: body.ruleId ?? newRuleId(), createdAt: now });

    const set = await store.radarDealSet({ lawdCds: rule.lawdCds, referenceMonths: 6, lookbackMonths: 6, ratioMonths: 24 });
    const preview = buildAlertPreview(rule, set.deals, { now });
    const saved = await store.createAlertRule(rule, preview.matchedCount);

    // 알림 규칙 저장 자체를 행동 이벤트로 남긴다. 세션 정보가 없으면 저장만 하고 이벤트는 남기지 않는다.
    let event: { recorded: boolean; eventId?: string; reason?: string; issues?: string[] } = {
      recorded: false,
      reason: 'session_missing',
    };
    if (body.sessionId && body.userPseudoId) {
      const candidate = {
        name: 'alert_rule_create' as const,
        occurredAt: now,
        sessionId: body.sessionId,
        userPseudoId: body.userPseudoId,
        page: '/radar',
        props: {
          ruleId: rule.ruleId,
          lawdCds: rule.lawdCds,
          minHouseholds: rule.minHouseholds,
          areaBand: rule.areaBand,
          maxDiscountPct: rule.maxDiscountPct,
          minScore: rule.minScore,
          channels: rule.channels,
          matchedCount: preview.matchedCount,
          source: 'api' as const,
        },
      };
      const validation = validateBehaviorEvent(candidate);
      if (!validation.ok) {
        event = { recorded: false, reason: 'schema_rejected', issues: validation.errors };
      } else {
        const record = toBehaviorEventRecord(candidate, { receivedAt: now, appEnv: 'production' });
        const result = await store.insertBehaviorEvents([record]);
        event = { recorded: result.inserted > 0, eventId: record.eventId, reason: result.inserted > 0 ? undefined : 'duplicate' };
      }
    }

    return reply.status(201).send({
      rule: saved,
      preview,
      condition: preview.condition,
      saved: true,
      event,
      note: '규칙은 저장되었지만 실제 알림톡 발송·웹훅 호출은 하지 않습니다. 발송 워커와 SENS 템플릿 승인은 배포 환경에서 연결합니다.',
    });
  });
}
