import {
  SAMPLE_COMPLEXES,
  SAMPLE_REGIONS,
  SAMPLE_SIGUNGU,
  assessComplexRisk,
  detectPriceAnomalies,
  jeonseRatioSeries,
  regionJeonseTrend,
  summarizeRegionRisk,
  type ComplexRiskAssessment,
  type JeonseRatioPoint,
  type PriceAnomaly,
  type RegionRiskSummary,
} from '@prop/shared';
import { MONTHS, dataset } from './dataset';

/**
 * 화면에서 쓰는 리스크·전세가율 계산 결과.
 *
 * 표본 데이터와 shared 함수로 한 번만 계산해 두고, 화면(개요·탐색·비교·구별 비교)이 같이 쓴다.
 * 계산식은 packages/shared/src/risk.ts에 있고 여기서는 조회용 인덱스만 만든다.
 */
export const RISK_ASSESSMENTS: ComplexRiskAssessment[] = SAMPLE_COMPLEXES.map((complex) =>
  assessComplexRisk({
    complex,
    region: SAMPLE_REGIONS.find((region) => region.legalDongCode === complex.legalDongCode),
    sales: dataset.transactions,
    rents: dataset.rentTransactions,
    months: MONTHS,
  }),
);

export const RISK_BY_COMPLEX = new Map(RISK_ASSESSMENTS.map((row) => [row.complexId, row]));

export const PRICE_ANOMALIES: PriceAnomaly[] = detectPriceAnomalies(dataset.transactions);

export const ANOMALY_BY_DEAL_HASH = new Map(PRICE_ANOMALIES.map((row) => [row.dealHash, row]));

/** 단지별 전세가율 시계열(대표 면적 구간). 단지 비교 화면에서 쓴다. */
export function complexJeonseSeries(complexId: string): JeonseRatioPoint[] {
  const complex = SAMPLE_COMPLEXES.find((row) => row.complexId === complexId);
  if (!complex) return [];
  return jeonseRatioSeries(
    dataset.rentTransactions.filter((row) => row.complexId === complexId),
    dataset.transactions.filter((row) => row.complexId === complexId),
    MONTHS,
    { complexId, areaM2: complex.representativeAreaM2 },
  );
}

export const REGION_RISK_SUMMARIES: RegionRiskSummary[] = SAMPLE_SIGUNGU.map(({ lawdCd, sigungu }) =>
  summarizeRegionRisk({
    lawdCd,
    sigungu,
    assessments: RISK_ASSESSMENTS,
    jeonseRatioTrend: regionJeonseTrend({
      rents: dataset.rentTransactions,
      sales: dataset.transactions,
      complexes: SAMPLE_COMPLEXES,
      months: MONTHS,
      lawdCd,
    }),
  }),
);

export function regionSummary(lawdCd: string): RegionRiskSummary | undefined {
  return REGION_RISK_SUMMARIES.find((row) => row.lawdCd === lawdCd);
}

/** 선택한 구(또는 전체)의 단지 리스크 목록. 점수 높은 순. */
export function assessmentsFor(lawdCd: string | null): ComplexRiskAssessment[] {
  const rows = lawdCd ? RISK_ASSESSMENTS.filter((row) => row.lawdCd === lawdCd) : RISK_ASSESSMENTS;
  return [...rows].sort((a, b) => b.score - a.score || b.jeonseRatioPct - a.jeonseRatioPct);
}

function medianValue(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/** 전체 집계: 구 비교 카드의 '전체' 값. */
export function overallSummary(): RegionRiskSummary {
  const rows = RISK_ASSESSMENTS;
  return {
    lawdCd: 'all',
    sigungu: '전체',
    complexCount: rows.length,
    medianPricePerPyeong: medianValue(rows.map((row) => row.latestPricePerPyeong).filter((value) => value > 0)),
    medianJeonseRatioPct: Number(medianValue(rows.map((row) => row.jeonseRatioPct).filter((value) => value > 0)).toFixed(1)),
    volume12m: rows.reduce((sum, row) => sum + row.volume12m, 0),
    anomalyCount: rows.reduce((sum, row) => sum + row.anomalyCount, 0),
    highRiskCount: rows.filter((row) => row.level === 'high' || row.level === 'critical').length,
    averageScore: rows.length === 0 ? 0 : Number((rows.reduce((sum, row) => sum + row.score, 0) / rows.length).toFixed(1)),
    jeonseRatioTrend: [],
  };
}

export const SAVED_COMPLEX_KEY = 'prop.savedComplexes';

/** 관심 등록 목록(브라우저 저장). 데모에서 새로고침해도 유지한다. */
export function readSavedComplexes(): string[] {
  try {
    const raw = window.localStorage.getItem(SAVED_COMPLEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

export function writeSavedComplexes(ids: string[]): void {
  try {
    window.localStorage.setItem(SAVED_COMPLEX_KEY, JSON.stringify(ids.slice(0, 50)));
  } catch {
    // 저장에 실패해도 화면 기능은 유지한다.
  }
}
