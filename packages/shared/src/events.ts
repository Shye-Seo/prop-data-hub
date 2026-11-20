import { z } from 'zod';
import { EVENT_NAMES, EVENT_SCHEMA_VERSION, FUNNEL_STEPS, type EventName, type FunnelStepKey } from './constants';
import type { BehaviorEventInput, BehaviorEventRecord, FunnelStepAggregate } from './types';

const eventNameEnum = z.enum([...EVENT_NAMES] as [EventName, ...EventName[]]);

const pageViewProps = z.object({
  route: z.string().min(1).max(120),
  referrer: z.string().max(200).optional(),
  deviceType: z.enum(['mobile', 'tablet', 'desktop']).optional(),
  isInitialLoad: z.boolean().optional(),
  loadMs: z.number().nonnegative().max(600_000).optional(),
});

const regionFilterProps = z.object({
  lawdCd: z.string().regex(/^\d{5}$/),
  dong: z.string().max(40),
  complexId: z.string().max(64).optional(),
  previousLawdCd: z.string().regex(/^\d{5}$/).optional(),
  areaBand: z.enum(['under60', '60to85', '85to115', 'over115', 'all']),
  periodMonths: z.number().int().min(1).max(120),
  resultCount: z.number().int().nonnegative().optional(),
});

const radarFilterProps = z.object({
  lawdCds: z.array(z.string().regex(/^\d{5}$/)).max(8),
  minHouseholds: z.number().int().min(0).max(20_000),
  largeComplexOnly: z.boolean(),
  areaBand: z.enum(['under60', '60to85', '85to115', 'over115', 'all']),
  maxDiscountPct: z.number().min(1).max(50),
  minScore: z.number().int().min(0).max(100).optional(),
  resultCount: z.number().int().nonnegative(),
});

const alertRuleProps = z.object({
  ruleId: z.string().min(1).max(64),
  lawdCds: z.array(z.string().regex(/^\d{5}$/)).min(1).max(8),
  minHouseholds: z.number().int().min(0).max(20_000),
  areaBand: z.enum(['under60', '60to85', '85to115', 'over115', 'all']),
  maxDiscountPct: z.number().min(1).max(50),
  minScore: z.number().int().min(0).max(100).optional(),
  channels: z.array(z.enum(['kakao_alimtalk', 'webhook'])).min(1).max(2),
  matchedCount: z.number().int().nonnegative(),
  source: z.enum(['radar_builder', 'api']).optional(),
});

const complexCompareProps = z.object({
  complexIds: z.array(z.string().min(1).max(64)).min(1).max(3),
  addedComplexId: z.string().min(1).max(64),
  compareCount: z.number().int().min(1).max(3),
  basis: z.enum(['price_per_pyeong', 'recent_price', 'volume']).optional(),
});

const listingClickProps = z.object({
  complexId: z.string().min(1).max(64),
  aptName: z.string().min(1).max(80),
  dealHash: z.string().max(80).optional(),
  priceKrw: z.number().int().positive(),
  areaM2: z.number().positive().max(500),
  source: z.enum(['explore_table', 'overview', 'compare', 'risk', 'radar']),
  dealScore: z.number().int().min(0).max(100).optional(),
  jeonseRatioPct: z.number().min(0).max(200).optional(),
});

const listingSaveProps = z.object({
  complexId: z.string().min(1).max(64),
  aptName: z.string().min(1).max(80),
  action: z.enum(['add', 'remove']),
  savedCount: z.number().int().min(0).max(50),
  priceKrw: z.number().int().positive().optional(),
});

const apiDocMockProps = z.object({
  endpoint: z.string().min(1).max(120),
  method: z.enum(['get', 'post']),
  status: z.number().int().min(100).max(599),
});

const rateScenarioProps = z.object({
  priceKrw: z.number().int().positive(),
  loanKrw: z.number().int().nonnegative(),
  annualRatePct: z.number().min(0).max(20),
  termMonths: z.number().int().min(12).max(600),
  repayment: z.enum(['equal_principal_interest', 'equal_principal', 'interest_only']),
  monthlyPaymentKrw: z.number().int().nonnegative().optional(),
});

const pipelineSourceProps = z.object({
  sourceId: z.string().min(1).max(64),
  runId: z.string().max(64).optional(),
  panel: z.enum(['sources', 'runs', 'run_detail', 'dlq']),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const funnelStepProps = z.object({
  step: z.enum(FUNNEL_STEPS.map((step) => step.key) as [FunnelStepKey, ...FunnelStepKey[]]),
  route: z.string().max(120),
  detail: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

/** 이벤트별 props 스키마. 수집 API와 프론트 트래커가 같은 정의를 쓴다. */
export const EVENT_PROP_SCHEMAS = {
  page_view: pageViewProps,
  region_filter_change: regionFilterProps,
  radar_filter_change: radarFilterProps,
  alert_rule_create: alertRuleProps,
  complex_compare_add: complexCompareProps,
  listing_click: listingClickProps,
  listing_save: listingSaveProps,
  api_doc_mock_run: apiDocMockProps,
  rate_scenario_adjust: rateScenarioProps,
  pipeline_source_inspect: pipelineSourceProps,
  funnel_step_complete: funnelStepProps,
} as const;

export const behaviorEventSchema = z
  .object({
    eventId: z.string().uuid().optional(),
    name: eventNameEnum,
    occurredAt: z.string().datetime({ offset: true }),
    sessionId: z.string().min(8).max(64),
    userPseudoId: z.string().min(8).max(64),
    page: z.string().min(1).max(120),
    props: z.record(z.unknown()).default({}),
  })
  .superRefine((event, ctx) => {
    const schema = EVENT_PROP_SCHEMAS[event.name];
    const result = schema.safeParse(event.props);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['props', ...issue.path],
          message: issue.message,
        });
      }
    }
  });

export type BehaviorEventPayload = z.infer<typeof behaviorEventSchema>;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateBehaviorEvent(input: unknown): ValidationResult {
  const result = behaviorEventSchema.safeParse(input);
  if (result.success) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  };
}

/**
 * 이벤트 정의서. 대시보드 '지표 정의' 화면과 README가 같은 표를 참조한다.
 * 수집 담당·활용 지표·보존 기간을 이벤트 단위로 명시해, 이벤트가 늘어날 때
 * 정의 없는 수집이 생기지 않게 한다.
 */
export interface EventDefinition {
  name: EventName;
  label: string;
  description: string;
  trigger: string;
  props: string[];
  kpi: string[];
  retentionDays: number;
  owner: string;
}

export const EVENT_CATALOG: EventDefinition[] = [
  {
    name: 'page_view',
    label: '화면 조회',
    description: '라우트 단위 화면 진입. 세션 시작과 체류 분석의 기준 이벤트다.',
    trigger: '라우트가 바뀌어 화면이 마운트될 때 1회',
    props: ['route', 'referrer', 'deviceType', 'isInitialLoad', 'loadMs'],
    kpi: ['세션 수', '화면별 도달', '진입 경로'],
    retentionDays: 400,
    owner: '프로덕트 분석',
  },
  {
    name: 'region_filter_change',
    label: '지역 조건 변경',
    description: '실거래 탐색에서 지역·면적·기간 조건이 바뀐 시점. 탐색 수요의 단위다.',
    trigger: '필터 확정(적용) 시 1회, 같은 세션의 연속 변경은 800ms 디바운스',
    props: ['lawdCd', 'dong', 'complexId', 'previousLawdCd', 'areaBand', 'periodMonths', 'resultCount'],
    kpi: ['지역별 탐색 세션', '조건 변경 후 이탈률', '조회 결과 0건 비율'],
    retentionDays: 400,
    owner: '프로덕트 분석',
  },
  {
    name: 'radar_filter_change',
    label: '레이더 조건 변경',
    description: '급매 레이더에서 구·세대수·평형·할인율 조건이 바뀐 시점. 알림 규칙으로 이어지는 탐색 수요를 본다.',
    trigger: '레이더 필터 확정 시 1회, 같은 세션의 연속 변경은 800ms 디바운스',
    props: ['lawdCds', 'minHouseholds', 'largeComplexOnly', 'areaBand', 'maxDiscountPct', 'minScore', 'resultCount'],
    kpi: ['레이더 세션', '조건별 결과 0건 비율', '알림 규칙 저장 전환율'],
    retentionDays: 400,
    owner: '프로덕트 분석',
  },
  {
    name: 'alert_rule_create',
    label: '알림 규칙 저장',
    description: '레이더 조건을 맞춤 알림 규칙으로 저장한 시점. 알림 미리보기(카카오 알림톡·웹훅)와 함께 남긴다.',
    trigger: '알림 규칙 저장이 성공했을 때 1회(서버 저장 시 수집 API로도 적재)',
    props: ['ruleId', 'lawdCds', 'minHouseholds', 'areaBand', 'maxDiscountPct', 'minScore', 'channels', 'matchedCount', 'source'],
    kpi: ['알림 규칙 생성 수', '규칙당 매칭 건수', '채널 선택 비중'],
    retentionDays: 400,
    owner: '프로덕트 분석',
  },
  {
    name: 'complex_compare_add',
    label: '단지 비교 추가',
    description: '비교함에 단지를 넣은 시점. 비교 화면 도달 여부와 비교 조합을 본다.',
    trigger: '비교함에 단지가 추가될 때',
    props: ['complexIds', 'addedComplexId', 'compareCount', 'basis'],
    kpi: ['비교 진입률', '단지별 비교 채택', '비교 후 리포트 저장률'],
    retentionDays: 400,
    owner: '프로덕트 분석',
  },
  {
    name: 'listing_click',
    label: '매물 클릭',
    description: '실거래·비교·리스크 화면에서 단지(거래) 상세를 연 시점. 관심도가 가장 직접적으로 드러나는 행동이다.',
    trigger: '목록 행·단지 카드를 눌러 상세를 열 때 1회',
    props: ['complexId', 'aptName', 'dealHash', 'priceKrw', 'areaM2', 'source', 'jeonseRatioPct'],
    kpi: ['단지별 클릭 수', '목록 대비 상세 진입률', '클릭 후 관심 등록 전환'],
    retentionDays: 400,
    owner: '프로덕트 분석',
  },
  {
    name: 'listing_save',
    label: '관심 등록',
    description: '관심 단지에 넣거나 뺀 시점. 세션 퍼널과 별도로 비교·상담으로 이어지는 중간 신호로 본다.',
    trigger: '관심 등록 버튼을 눌러 상태가 바뀔 때',
    props: ['complexId', 'aptName', 'action', 'savedCount', 'priceKrw'],
    kpi: ['관심 등록 세션', '단지별 관심 수', '관심 등록 후 비교 진행률'],
    retentionDays: 400,
    owner: '프로덕트 분석',
  },
  {
    name: 'api_doc_mock_run',
    label: 'API 문서 실행',
    description: 'API 문서 화면에서 엔드포인트 예시 응답을 실행한 시점. 개발자·면접관이 어떤 API를 확인했는지 본다.',
    trigger: 'Mock 응답 실행 버튼을 눌러 응답을 받을 때',
    props: ['endpoint', 'method', 'status'],
    kpi: ['문서 사용 세션', '엔드포인트별 실행 수', '응답 오류율'],
    retentionDays: 180,
    owner: '프로덕트 분석',
  },
  {
    name: 'rate_scenario_adjust',
    label: '금리 시나리오 조정',
    description: '대출 조건(가격·금리·기간·상환방식)을 바꾼 시점. 핵심 기능 사용 신호다.',
    trigger: '입력 변경 후 400ms 디바운스 또는 상환방식 변경 시',
    props: ['priceKrw', 'loanKrw', 'annualRatePct', 'termMonths', 'repayment', 'monthlyPaymentKrw'],
    kpi: ['시나리오 사용 세션', '평균 금리 구간', '리포트 저장 전환율'],
    retentionDays: 400,
    owner: '프로덕트 분석',
  },
  {
    name: 'pipeline_source_inspect',
    label: '데이터 출처 확인',
    description: '수집 파이프라인 화면에서 출처·기준일을 확인한 시점. 데이터 신뢰 기능의 사용량이다.',
    trigger: '출처 카드·실행 상세·DLQ 패널을 열 때',
    props: ['sourceId', 'runId', 'panel', 'asOfDate'],
    kpi: ['출처 확인 세션', '실행 상세 열람률', 'DLQ 확인 건수'],
    retentionDays: 400,
    owner: '데이터 운영',
  },
  {
    name: 'funnel_step_complete',
    label: '퍼널 단계 완료',
    description: '분석 결과를 외부로 가져가는 완료 행동(리포트 저장 등)을 기록한다.',
    trigger: '리포트 저장·복사 등 완료 동작 성공 시',
    props: ['step', 'route', 'detail'],
    kpi: ['퍼널 최종 전환율', '단계별 이탈', '리포트 저장 건수'],
    retentionDays: 400,
    owner: '프로덕트 분석',
  },
];

/** 세션 단위로 순서를 지켜 퍼널 도달을 계산한다(뒤 단계 이벤트만 있는 세션은 앞 단계에 도달하지 않은 것으로 본다). */
export function computeFunnel(events: BehaviorEventInput[]): FunnelStepAggregate[] {
  const bySession = new Map<string, BehaviorEventInput[]>();
  for (const event of events) {
    const list = bySession.get(event.sessionId);
    if (list) list.push(event);
    else bySession.set(event.sessionId, [event]);
  }

  const stepOrder = FUNNEL_STEPS.map((step) => step.key);
  const reachedByStep = new Map<string, Set<string>>(stepOrder.map((key) => [key, new Set<string>()]));
  const eventCountByStep = new Map<string, number>(stepOrder.map((key) => [key, 0]));

  const stepOf = (event: BehaviorEventInput): string | null => {
    if (event.name === 'funnel_step_complete') {
      const step = (event.props as { step?: string }).step;
      return step && stepOrder.includes(step as FunnelStepKey) ? step : null;
    }
    const matched = FUNNEL_STEPS.find((step) => step.sourceEvent === event.name);
    return matched ? matched.key : null;
  };

  for (const [sessionId, sessionEvents] of bySession) {
    const sorted = [...sessionEvents].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    let cursor = 0;
    for (const event of sorted) {
      const step = stepOf(event);
      if (!step) continue;
      eventCountByStep.set(step, (eventCountByStep.get(step) ?? 0) + 1);
      const index = stepOrder.indexOf(step as FunnelStepKey);
      if (index === cursor) {
        reachedByStep.get(step)?.add(sessionId);
        cursor += 1;
      } else if (index > cursor) {
        // 순서를 건너뛴 세션은 중간 단계에 도달하지 않은 것으로 집계한다.
        continue;
      } else {
        reachedByStep.get(step)?.add(sessionId);
      }
    }
  }

  const firstCount = reachedByStep.get(stepOrder[0]!)?.size ?? 0;
  return FUNNEL_STEPS.map((step, index) => {
    const sessions = reachedByStep.get(step.key)?.size ?? 0;
    const previous = index === 0 ? sessions : (reachedByStep.get(stepOrder[index - 1]!)?.size ?? 0);
    return {
      stepKey: step.key,
      stepLabel: step.label,
      stepIndex: index + 1,
      users: sessions,
      sessions,
      events: eventCountByStep.get(step.key) ?? 0,
      conversionFromPrevious: index === 0 ? 1 : previous === 0 ? 0 : Number((sessions / previous).toFixed(4)),
      conversionFromStart: firstCount === 0 ? 0 : Number((sessions / firstCount).toFixed(4)),
    };
  });
}

/** event_funnel_daily 테이블에 적재할 일 단위 행. 수집 API가 배치 적재 후 upsert한다. */
export function aggregateFunnelDaily(
  events: BehaviorEventInput[],
  date: string,
): Array<{ funnelDate: string; stepKey: string; sessions: number; events: number }> {
  const scoped = events.filter((event) => event.occurredAt.slice(0, 10) === date);
  const funnel = computeFunnel(scoped);
  return funnel.map((row) => ({
    funnelDate: date,
    stepKey: row.stepKey,
    sessions: row.sessions,
    events: row.events,
  }));
}

export function toBehaviorEventRecord(
  payload: BehaviorEventPayload,
  options: { receivedAt?: string; appEnv?: string } = {},
): BehaviorEventRecord {
  return {
    eventId: payload.eventId ?? cryptoRandomId(),
    name: payload.name,
    occurredAt: payload.occurredAt,
    receivedAt: options.receivedAt ?? new Date().toISOString(),
    sessionId: payload.sessionId,
    userPseudoId: payload.userPseudoId,
    page: payload.page,
    props: payload.props,
    schemaVersion: EVENT_SCHEMA_VERSION,
    appEnv: options.appEnv ?? 'local',
  };
}

function cryptoRandomId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') return globalCrypto.randomUUID();
  // Node 18 미만 폴백. 수집 API는 Node 20 이상을 요구하므로 실제로는 쓰이지 않는다.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
