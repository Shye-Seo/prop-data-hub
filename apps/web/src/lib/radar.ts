import {
  AREA_BAND_RANGES,
  DEFAULT_ALERT_RULE,
  LARGE_COMPLEX_HOUSEHOLDS,
  RADAR_SIGUNGU,
  buildAlertPreview,
  buildRadarDealSet,
  filterRadarDeals,
  normalizeAlertRule,
  radarSummary,
  type AlertChannel,
  type AlertPreview,
  type AlertRule,
  type AreaBandKey,
  type BuildRadarDealsParams,
  type RadarDeal,
  type RadarSummary,
} from '@prop/shared';
import { MONTHS, dataset } from './dataset';

/**
 * 화면(데모) 레이더 데이터.
 *
 * API와 같은 shared 함수(buildRadarDealSet·filterRadarDeals)를 브라우저에서 실행한다.
 * 그래서 데모 숫자와 서버 응답이 같은 규칙으로 계산되고, 계산식이 두 벌로 갈라지지 않는다.
 * 백엔드 없이 도는 데모에서 매 요청마다 다시 계산하지 않도록 한 번만 만들어 둔다.
 */
const radarParams: BuildRadarDealsParams = {
  transactions: dataset.transactions,
  rents: dataset.rentTransactions,
  complexes: dataset.complexes,
  regions: dataset.regions,
  months: MONTHS,
};

export const RADAR_SET = buildRadarDealSet(radarParams);

export interface RadarFilterState {
  lawdCds: string[];
  largeComplexOnly: boolean;
  areaBand: AreaBandKey | 'all';
  maxDiscountPct: number;
  minScore: number;
}

export const DEFAULT_RADAR_UI_FILTER: RadarFilterState = {
  lawdCds: [],
  largeComplexOnly: true,
  areaBand: 'all',
  maxDiscountPct: 8,
  minScore: 0,
};

export const RADAR_DISTRICTS = RADAR_SIGUNGU.map((row) => ({
  ...row,
  complexCount: dataset.complexes.filter((complex) => complex.lawdCd === row.lawdCd).length,
  largeComplexCount: dataset.complexes.filter(
    (complex) => complex.lawdCd === row.lawdCd && complex.households >= LARGE_COMPLEX_HOUSEHOLDS,
  ).length,
}));

export interface RadarResult {
  deals: RadarDeal[];
  summary: RadarSummary;
}

export function radarResults(filter: RadarFilterState): RadarResult {
  const deals = filterRadarDeals(RADAR_SET.deals, {
    lawdCds: filter.lawdCds,
    minHouseholds: filter.largeComplexOnly ? LARGE_COMPLEX_HOUSEHOLDS : 0,
    areaBand: filter.areaBand,
    maxDiscountPct: filter.maxDiscountPct,
    minScore: filter.minScore,
  });
  return { deals, summary: radarSummary(deals) };
}

export function filterToRuleDraft(filter: RadarFilterState, name?: string): {
  name: string;
  lawdCds: string[];
  minHouseholds: number;
  areaBand: AreaBandKey | 'all';
  maxDiscountPct: number;
  minScore: number;
  channels: AlertChannel[];
} {
  const districts = filter.lawdCds.length > 0
    ? filter.lawdCds.map((code) => RADAR_DISTRICTS.find((row) => row.lawdCd === code)?.sigungu ?? code).join('·')
    : '부산';
  return {
    name: name?.trim() || `${districts} ${filter.areaBand === 'all' ? '' : AREA_BAND_RANGES[filter.areaBand].label + ' '}급매`.trim(),
    lawdCds: filter.lawdCds.length > 0 ? filter.lawdCds : RADAR_DISTRICTS.map((row) => row.lawdCd),
    minHouseholds: filter.largeComplexOnly ? LARGE_COMPLEX_HOUSEHOLDS : 0,
    areaBand: filter.areaBand,
    maxDiscountPct: filter.maxDiscountPct,
    minScore: filter.minScore,
    channels: [...DEFAULT_ALERT_RULE.channels],
  };
}

export interface RulePreviewResult {
  rule: AlertRule;
  preview: AlertPreview;
}

/** 데모에서 규칙 저장 → 미리보기. 서버의 POST /api/v1/radar/alert-rules와 같은 shared 함수를 쓴다. */
export function previewRule(rule: AlertRule): RulePreviewResult {
  return { rule, preview: buildAlertPreview(rule, RADAR_SET.deals) };
}

function newRuleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `rule_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `rule_${Date.now().toString(36)}`;
}

export function createRule(draft: Parameters<typeof normalizeAlertRule>[0]): AlertRule {
  return normalizeAlertRule(draft, { ruleId: newRuleId(), createdAt: new Date().toISOString() });
}

export const ALERT_RULES_KEY = 'prop.radarAlertRules';

/** 저장한 규칙(브라우저). 서버 모드에서는 alert_rules 테이블이 원본이고 이건 데모용 사본이다. */
export function readAlertRules(): AlertRule[] {
  try {
    const raw = window.localStorage.getItem(ALERT_RULES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is AlertRule => Boolean(row && typeof row.ruleId === 'string'));
  } catch {
    return [];
  }
}

export function writeAlertRules(rules: AlertRule[]): void {
  try {
    window.localStorage.setItem(ALERT_RULES_KEY, JSON.stringify(rules.slice(0, 20)));
  } catch {
    // 저장에 실패해도 화면은 유지한다.
  }
}

export { radarSummary };
