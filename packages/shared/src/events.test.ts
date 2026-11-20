import { describe, expect, it } from 'vitest';
import { aggregateFunnelDaily, behaviorEventSchema, computeFunnel, validateBehaviorEvent } from './events';
import { EVENT_CATALOG } from './events';
import { EVENT_NAMES, FUNNEL_STEPS } from './constants';
import type { BehaviorEventInput } from './types';

const session = 'session-0001-abcd';
const user = 'user-0001-abcd';

function event(partial: Partial<BehaviorEventInput> & Pick<BehaviorEventInput, 'name' | 'props'>): BehaviorEventInput {
  return {
    occurredAt: '2026-11-19T01:00:00.000Z',
    sessionId: session,
    userPseudoId: user,
    page: '/overview',
    ...partial,
  };
}

describe('behaviorEventSchema', () => {
  it('정의된 11종 이벤트를 모두 허용한다', () => {
    const samples: BehaviorEventInput[] = [
      event({ name: 'page_view', props: { route: '/overview', isInitialLoad: true } }),
      event({
        name: 'region_filter_change',
        props: { lawdCd: '26290', dong: '문현동', areaBand: '60to85', periodMonths: 12 },
      }),
      event({
        name: 'radar_filter_change',
        props: {
          lawdCds: ['26230', '26290'],
          minHouseholds: 350,
          largeComplexOnly: true,
          areaBand: '60to85',
          maxDiscountPct: 8,
          minScore: 40,
          resultCount: 4,
        },
      }),
      event({
        name: 'alert_rule_create',
        props: {
          ruleId: 'rule_test_01',
          lawdCds: ['26230'],
          minHouseholds: 350,
          areaBand: '60to85',
          maxDiscountPct: 8,
          minScore: 40,
          channels: ['kakao_alimtalk'],
          matchedCount: 2,
          source: 'radar_builder',
        },
      }),
      event({
        name: 'complex_compare_add',
        props: { complexIds: ['MOLIT-26290-001'], addedComplexId: 'MOLIT-26290-001', compareCount: 1 },
      }),
      event({
        name: 'rate_scenario_adjust',
        props: {
          priceKrw: 628_000_000,
          loanKrw: 428_000_000,
          annualRatePct: 4.1,
          termMonths: 480,
          repayment: 'equal_principal_interest',
        },
      }),
      event({ name: 'pipeline_source_inspect', props: { sourceId: 'molit_apt_trade', panel: 'sources' } }),
      event({
        name: 'listing_click',
        props: {
          complexId: 'MOLIT-26290-001',
          aptName: '문현베스티움',
          dealHash: 'a'.repeat(64),
          priceKrw: 845_000_000,
          areaM2: 84.98,
          source: 'explore_table',
        },
      }),
      event({
        name: 'listing_save',
        props: { complexId: 'MOLIT-26290-001', aptName: '문현베스티움', action: 'add', savedCount: 1 },
      }),
      event({ name: 'api_doc_mock_run', props: { endpoint: '/api/v1/rents', method: 'get', status: 200 } }),
      event({ name: 'funnel_step_complete', props: { step: 'report_export', route: '/overview' } }),
    ];
    expect(new Set(samples.map((row) => row.name))).toEqual(new Set(EVENT_NAMES));
    for (const sample of samples) {
      expect(behaviorEventSchema.safeParse(sample).success).toBe(true);
    }
  });

  it('이벤트별 props 타입이 맞지 않으면 거부한다', () => {
    const invalid = event({ name: 'region_filter_change', props: { lawdCd: '2629', dong: '문현동', areaBand: 'all', periodMonths: 0 } });
    const result = validateBehaviorEvent(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/props\.lawdCd/);
  });

  it('정의에 없는 이벤트명은 거부한다', () => {
    const result = validateBehaviorEvent({ ...event({ name: 'page_view', props: { route: '/x' } }), name: 'purchase' });
    expect(result.ok).toBe(false);
  });

  it('퍼널 단계가 아닌 step 값은 거부한다', () => {
    const result = validateBehaviorEvent(
      event({ name: 'funnel_step_complete', props: { step: 'unknown_step', route: '/overview' } }),
    );
    expect(result.ok).toBe(false);
  });

  it('이벤트 카탈로그가 9종 이벤트와 5단계 퍼널을 모두 설명한다', () => {
    expect(EVENT_CATALOG).toHaveLength(EVENT_NAMES.length);
    expect(FUNNEL_STEPS).toHaveLength(5);
    for (const definition of EVENT_CATALOG) {
      expect(definition.description.length).toBeGreaterThan(10);
      expect(definition.kpi.length).toBeGreaterThan(0);
      expect(definition.retentionDays).toBeGreaterThan(0);
    }
  });
});

describe('computeFunnel', () => {
  it('세션 안에서 순서를 지킨 도달만 단계별로 센다', () => {
    const events: BehaviorEventInput[] = [
      event({ name: 'page_view', props: { route: '/overview' }, occurredAt: '2026-11-19T01:00:00.000Z' }),
      event({
        name: 'region_filter_change',
        props: { lawdCd: '26290', dong: '문현동', areaBand: '60to85', periodMonths: 12 },
        occurredAt: '2026-11-19T01:01:00.000Z',
      }),
      event({
        name: 'radar_filter_change',
        props: {
          lawdCds: ['26230', '26290'],
          minHouseholds: 350,
          largeComplexOnly: true,
          areaBand: '60to85',
          maxDiscountPct: 8,
          minScore: 40,
          resultCount: 4,
        },
      }),
      event({
        name: 'alert_rule_create',
        props: {
          ruleId: 'rule_test_01',
          lawdCds: ['26230'],
          minHouseholds: 350,
          areaBand: '60to85',
          maxDiscountPct: 8,
          minScore: 40,
          channels: ['kakao_alimtalk'],
          matchedCount: 2,
          source: 'radar_builder',
        },
      }),
      event({
        name: 'complex_compare_add',
        props: { complexIds: ['a'], addedComplexId: 'a', compareCount: 1 },
        occurredAt: '2026-11-19T01:02:00.000Z',
      }),
      event({
        name: 'rate_scenario_adjust',
        props: { priceKrw: 628_000_000, loanKrw: 0, annualRatePct: 4, termMonths: 480, repayment: 'equal_principal_interest' },
        occurredAt: '2026-11-19T01:03:00.000Z',
      }),
      event({
        name: 'funnel_step_complete',
        props: { step: 'report_export', route: '/overview' },
        occurredAt: '2026-11-19T01:04:00.000Z',
      }),
    ];
    const funnel = computeFunnel(events);
    expect(funnel.map((row) => row.sessions)).toEqual([1, 1, 1, 1, 1]);
    expect(funnel[4]?.conversionFromStart).toBe(1);
  });

  it('중간 단계를 건너뛴 세션은 뒤 단계에 도달하지 않은 것으로 집계한다', () => {
    const events: BehaviorEventInput[] = [
      event({ name: 'page_view', props: { route: '/overview' } }),
      event({
        name: 'radar_filter_change',
        props: {
          lawdCds: ['26230', '26290'],
          minHouseholds: 350,
          largeComplexOnly: true,
          areaBand: '60to85',
          maxDiscountPct: 8,
          minScore: 40,
          resultCount: 4,
        },
      }),
      event({
        name: 'alert_rule_create',
        props: {
          ruleId: 'rule_test_01',
          lawdCds: ['26230'],
          minHouseholds: 350,
          areaBand: '60to85',
          maxDiscountPct: 8,
          minScore: 40,
          channels: ['kakao_alimtalk'],
          matchedCount: 2,
          source: 'radar_builder',
        },
      }),
      event({
        name: 'complex_compare_add',
        props: { complexIds: ['a'], addedComplexId: 'a', compareCount: 1 },
        occurredAt: '2026-11-19T01:02:00.000Z',
      }),
      event(
        {
          name: 'page_view',
          props: { route: '/pipeline' },
          sessionId: 'session-0002-abcd',
          userPseudoId: 'user-0002-abcd',
        },
      ),
    ];
    const funnel = computeFunnel(events);
    expect(funnel[0]?.sessions).toBe(2);
    expect(funnel[1]?.sessions).toBe(0);
    expect(funnel[2]?.sessions).toBe(0);
    expect(funnel[2]?.conversionFromStart).toBe(0);
  });

  it('AARRR가 아닌 5단계 구조에서 단계 간 전환율을 소수 넷째 자리로 계산한다', () => {
    const base: BehaviorEventInput[] = [];
    for (let i = 0; i < 10; i += 1) {
      base.push(
        event({
          name: 'page_view',
          props: { route: '/overview' },
          sessionId: `session-${String(i).padStart(4, '0')}-x`,
          userPseudoId: `user-${String(i).padStart(4, '0')}-x`,
        }),
      );
    }
    for (let i = 0; i < 4; i += 1) {
      base.push(
        event({
          name: 'region_filter_change',
          props: { lawdCd: '26290', dong: '문현동', areaBand: 'all', periodMonths: 12 },
          occurredAt: '2026-11-19T01:01:00.000Z',
          sessionId: `session-${String(i).padStart(4, '0')}-x`,
          userPseudoId: `user-${String(i).padStart(4, '0')}-x`,
        }),
      );
    }
    const funnel = computeFunnel(base);
    expect(funnel[0]?.sessions).toBe(10);
    expect(funnel[1]?.sessions).toBe(4);
    expect(funnel[1]?.conversionFromPrevious).toBe(0.4);
  });

  it('일 단위 집계 행을 5단계 모두 만든다', () => {
    const rows = aggregateFunnelDaily(
      [event({ name: 'page_view', props: { route: '/overview' } })],
      '2026-11-19',
    );
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ funnelDate: '2026-11-19', stepKey: 'dashboard_enter', sessions: 1, events: 1 });
    expect(rows[1]?.sessions).toBe(0);
  });
});
