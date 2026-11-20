import { describe, expect, it } from 'vitest';
import {
  DEAL_GRADE_THRESHOLDS,
  LARGE_COMPLEX_HOUSEHOLDS,
  filterRadarDeals,
  type AlertRule,
} from '@prop/shared';
import {
  DEFAULT_RADAR_UI_FILTER,
  RADAR_DISTRICTS,
  RADAR_SET,
  createRule,
  filterToRuleDraft,
  previewRule,
  radarResults,
  readAlertRules,
  writeAlertRules,
} from './radar';

describe('화면 레이더 레이어', () => {
  it('구 선택지에 부산 6개 구와 단지 수가 준비된다', () => {
    expect(RADAR_DISTRICTS).toHaveLength(6);
    expect(RADAR_DISTRICTS.map((row) => row.sigungu)).toEqual([
      '부산진구',
      '동래구',
      '남구',
      '해운대구',
      '연제구',
      '수영구',
    ]);
    for (const row of RADAR_DISTRICTS) {
      expect(row.largeComplexCount).toBeGreaterThan(0);
      expect(row.largeComplexCount).toBeLessThanOrEqual(row.complexCount);
    }
  });

  it('기본 조건은 350세대 이상 · 중위가 대비 -8% 이하다', () => {
    const { deals, summary } = radarResults(DEFAULT_RADAR_UI_FILTER);
    expect(deals.length).toBeGreaterThan(0);
    expect(summary.count).toBe(deals.length);
    for (const deal of deals) {
      expect(deal.households).toBeGreaterThanOrEqual(LARGE_COMPLEX_HOUSEHOLDS);
      expect(deal.discountPct).toBeLessThanOrEqual(-8);
    }
  });

  it('세대수 토글을 끄면 350세대 미만 단지도 결과에 들어온다', () => {
    const on = radarResults(DEFAULT_RADAR_UI_FILTER);
    const off = radarResults({ ...DEFAULT_RADAR_UI_FILTER, largeComplexOnly: false });
    expect(off.deals.length).toBeGreaterThan(on.deals.length);
    expect(off.deals.some((deal) => deal.households < LARGE_COMPLEX_HOUSEHOLDS)).toBe(true);
    expect(on.deals.some((deal) => deal.households < LARGE_COMPLEX_HOUSEHOLDS)).toBe(false);
  });

  it('구·평형·점수 조건이 결과에 반영된다', () => {
    const result = radarResults({
      ...DEFAULT_RADAR_UI_FILTER,
      lawdCds: ['26230', '26470'],
      areaBand: '60to85',
      minScore: DEAL_GRADE_THRESHOLDS.good,
    });
    expect(result.deals.length).toBeGreaterThan(0);
    for (const deal of result.deals) {
      expect(['26230', '26470']).toContain(deal.lawdCd);
      expect(deal.areaBand).toBe('60to85');
      expect(deal.dealScore).toBeGreaterThanOrEqual(DEAL_GRADE_THRESHOLDS.good);
    }
  });

  it('화면 조건을 알림 규칙 초안으로 옮긴다', () => {
    const draft = filterToRuleDraft({
      lawdCds: ['26230', '26290'],
      largeComplexOnly: true,
      areaBand: '60to85',
      maxDiscountPct: 8,
      minScore: 40,
    });
    expect(draft.lawdCds).toEqual(['26230', '26290']);
    expect(draft.minHouseholds).toBe(LARGE_COMPLEX_HOUSEHOLDS);
    expect(draft.areaBand).toBe('60to85');
    expect(draft.maxDiscountPct).toBe(8);
    expect(draft.minScore).toBe(40);
    expect(draft.name).toContain('부산진구·남구');
    expect(draft.channels).toEqual(['kakao_alimtalk']);

    const all = filterToRuleDraft({ ...DEFAULT_RADAR_UI_FILTER, lawdCds: [] });
    expect(all.lawdCds).toHaveLength(6);
  });

  it('규칙을 만들면 카카오·웹훅 미리보기가 함께 나온다', () => {
    const draft = filterToRuleDraft({ ...DEFAULT_RADAR_UI_FILTER, lawdCds: ['26230'] }, '부산진구 급매');
    const rule = createRule({ ...draft, channels: ['kakao_alimtalk', 'webhook'] });
    expect(rule.ruleId).toContain('rule_');
    expect(rule.name).toBe('부산진구 급매');

    const { preview } = previewRule(rule);
    expect(preview.matchedCount).toBeGreaterThan(0);
    expect(preview.kakao.message).toContain('부산진구 급매');
    expect(preview.webhook.url).toContain('hooks.example.com');
    expect(preview.previewOnly).toBe(true);
    expect(preview.sample.every((deal) => deal.lawdCd === '26230')).toBe(true);
  });

  it('브라우저 저장소가 없어도 규칙 저장 함수가 예외를 던지지 않는다', () => {
    expect(readAlertRules()).toEqual([]);
    const rule: AlertRule = createRule({ ...filterToRuleDraft(DEFAULT_RADAR_UI_FILTER) });
    expect(() => writeAlertRules([rule])).not.toThrow();
    expect(readAlertRules()).toEqual([]);
  });

  it('레이더 표본과 직접 필터 결과가 일치한다', () => {
    const direct = filterRadarDeals(RADAR_SET.deals);
    const viaLayer = radarResults(DEFAULT_RADAR_UI_FILTER).deals;
    expect(viaLayer.map((deal) => deal.dealHash)).toEqual(direct.map((deal) => deal.dealHash));
    expect(RADAR_SET.universe.largeComplexes).toBeGreaterThan(0);
  });
});
