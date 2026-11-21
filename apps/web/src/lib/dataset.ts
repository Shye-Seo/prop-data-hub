import {
  aggregateMonthly,
  buildSampleDataset,
  changeRatePct,
  latestMacroValue,
  median,
  recentMonths,
  SAMPLE_END_MONTH,
  SAMPLE_MONTHS,
  type ApartmentComplex,
  type AptTransaction,
  type MacroIndicator,
  type MonthlyPricePoint,
} from '@prop/shared';

/**
 * 화면에서 쓰는 데이터 레이어.
 * 기본은 번들에 포함된 샘플 표본을 쓰고(백엔드 불필요), VITE_API_BASE가 있으면 API 조회로 바꿀 수 있다.
 * 샘플은 공공데이터 응답 구조를 그대로 따르되 거래 값은 대표 표본이다(README '데이터 범위' 참고).
 */
export const dataset = buildSampleDataset();

export const MONTHS = recentMonths(SAMPLE_END_MONTH, SAMPLE_MONTHS);

export const REGION_OPTIONS = dataset.regions.map((region) => ({
  legalDongCode: region.legalDongCode,
  lawdCd: region.lawdCd,
  sido: region.sido,
  sigungu: region.sigungu,
  dong: region.dong,
  label: `${region.sigungu} ${region.dong}`,
}));

export const AREA_BANDS = [
  { key: 'all', label: '전체 면적', min: 0, max: Number.POSITIVE_INFINITY },
  { key: 'under60', label: '60㎡ (18평) 이하', min: 0, max: 60 },
  { key: '60to85', label: '60~85㎡ (18~26평)', min: 60, max: 85 },
  { key: '85to115', label: '85~115㎡ (26~35평)', min: 85, max: 115 },
  { key: 'over115', label: '115㎡ (35평) 초과', min: 115, max: Number.POSITIVE_INFINITY },
] as const;

export type AreaBandKey = (typeof AREA_BANDS)[number]['key'];

const seriesCache = new Map<string, MonthlyPricePoint[]>();

export function seriesForDong(legalDongCode: string | null): MonthlyPricePoint[] {
  const key = legalDongCode ?? '__all__';
  const cached = seriesCache.get(key);
  if (cached) return cached;
  const scoped = legalDongCode
    ? dataset.transactions.filter((row) => row.legalDongCode === legalDongCode)
    : dataset.transactions;
  const series = aggregateMonthly(scoped, MONTHS);
  seriesCache.set(key, series);
  return series;
}

/** 구(시군구) 단위 시계열. 개요 차트가 동 단위 16개 선 대신 구 6개 선으로 보여줄 때 쓴다. */
export function seriesForLawdCd(lawdCd: string | null): MonthlyPricePoint[] {
  const key = `lawd:${lawdCd ?? '__all__'}`;
  const cached = seriesCache.get(key);
  if (cached) return cached;
  const scoped = lawdCd ? dataset.transactions.filter((row) => row.lawdCd === lawdCd) : dataset.transactions;
  const series = aggregateMonthly(scoped, MONTHS);
  seriesCache.set(key, series);
  return series;
}

/** 구 선택지(중복 제거). 개요 차트·레이더 머리말이 쓴다. */
export const DISTRICT_OPTIONS = [...new Map(dataset.regions.map((row) => [row.lawdCd, row])).values()].map(
  (row) => ({ lawdCd: row.lawdCd, sigungu: row.sigungu }),
);

export function complexSeries(complexId: string): MonthlyPricePoint[] {
  const key = `complex:${complexId}`;
  const cached = seriesCache.get(key);
  if (cached) return cached;
  const series = aggregateMonthly(
    dataset.transactions.filter((row) => row.complexId === complexId),
    MONTHS,
  );
  seriesCache.set(key, series);
  return series;
}

export interface RegionKpi {
  transactionCount: number;
  medianPriceKrw: number;
  medianPricePerPyeong: number;
  /** 표본 중위 전용면적(㎡). 개요 머리말에 평 환산과 함께 보여준다. */
  medianAreaM2: number;
  yoyChangePct: number;
  latestMonth: string;
  latestMedianPriceKrw: number;
  twelveMonthVolume: number;
  canceledCount: number;
}

export function regionKpi(legalDongCode: string | null): RegionKpi {
  const scoped = dataset.transactions.filter(
    (row) => (!legalDongCode || row.legalDongCode === legalDongCode) && !row.canceled,
  );
  const series = seriesForDong(legalDongCode).filter((row) => row.sampleCount > 0);
  const latest = series[series.length - 1];
  const yearAgo = series.find((row) => row.month === MONTHS[MONTHS.length - 13]);

  return {
    transactionCount: scoped.length,
    medianPriceKrw: median(scoped.map((row) => row.priceKrw)),
    medianPricePerPyeong: median(scoped.map((row) => row.pricePerPyeong)),
    medianAreaM2: median(scoped.map((row) => row.areaM2)),
    yoyChangePct: changeRatePct(latest?.medianPriceKrw ?? 0, yearAgo?.medianPriceKrw ?? latest?.medianPriceKrw ?? 0),
    latestMonth: latest?.month ?? SAMPLE_END_MONTH,
    latestMedianPriceKrw: latest?.medianPriceKrw ?? 0,
    twelveMonthVolume: series.slice(-12).reduce((sum, row) => sum + row.sampleCount, 0),
    canceledCount: dataset.transactions.filter(
      (row) => (!legalDongCode || row.legalDongCode === legalDongCode) && row.canceled,
    ).length,
  };
}

export interface ComplexStat {
  complex: ApartmentComplex;
  dong: string;
  latestMedianPriceKrw: number;
  latestMedianPricePerPyeong: number;
  change12mPct: number;
  volume12m: number;
  latestMonth: string;
  series: MonthlyPricePoint[];
}

export function complexStat(complexId: string): ComplexStat | null {
  const complex = dataset.complexes.find((row) => row.complexId === complexId);
  if (!complex) return null;
  const region = dataset.regions.find((row) => row.legalDongCode === complex.legalDongCode);
  const series = complexSeries(complexId);
  const withData = series.filter((row) => row.sampleCount > 0);
  const latest = withData[withData.length - 1];
  const yearAgo = withData.find((row) => row.month === MONTHS[MONTHS.length - 13]);

  return {
    complex,
    dong: region?.dong ?? '',
    latestMedianPriceKrw: latest?.medianPriceKrw ?? 0,
    latestMedianPricePerPyeong: latest?.medianPricePerPyeong ?? 0,
    change12mPct: changeRatePct(latest?.medianPriceKrw ?? 0, yearAgo?.medianPriceKrw ?? latest?.medianPriceKrw ?? 0),
    volume12m: withData.slice(-12).reduce((sum, row) => sum + row.sampleCount, 0),
    latestMonth: latest?.month ?? SAMPLE_END_MONTH,
    series,
  };
}

export const ALL_COMPLEX_STATS: ComplexStat[] = dataset.complexes
  .map((complex) => complexStat(complex.complexId))
  .filter((stat): stat is ComplexStat => stat !== null);

export function macroSeries(indicatorCode: string): Array<{ month: string; value: number }> {
  return dataset.macro
    .filter((row) => row.indicatorCode === indicatorCode)
    .map((row) => ({ month: row.period, value: row.value }));
}

export function latestMacro(code: string): MacroIndicator | undefined {
  return latestMacroValue(dataset.macro, code);
}

export function transactionsFor(filters: {
  legalDongCode?: string | null;
  complexId?: string | null;
  areaBand?: AreaBandKey;
  months?: number;
}): AptTransaction[] {
  const band = AREA_BANDS.find((row) => row.key === (filters.areaBand ?? 'all')) ?? AREA_BANDS[0];
  const monthLimit = MONTHS.slice(-(filters.months ?? 12));
  const from = monthLimit[0];

  return dataset.transactions
    .filter((row) => !row.canceled)
    .filter((row) => (filters.legalDongCode ? row.legalDongCode === filters.legalDongCode : true))
    .filter((row) => (filters.complexId ? row.complexId === filters.complexId : true))
    .filter((row) => (from ? row.dealMonth >= from : true))
    .filter((row) => row.areaM2 > band.min - (band.key === 'all' ? 1 : 0) && row.areaM2 <= band.max)
    .sort((a, b) => b.dealDate.localeCompare(a.dealDate));
}

export const COMPLEX_BY_ID = new Map(dataset.complexes.map((complex) => [complex.complexId, complex]));

export function complexLabel(complexId: string): string {
  const complex = COMPLEX_BY_ID.get(complexId);
  if (!complex) return complexId;
  const region = dataset.regions.find((row) => row.legalDongCode === complex.legalDongCode);
  return `${complex.name} · ${region?.dong ?? ''}`;
}

/** 파이프라인 화면에서 쓰는 데모 상태. 실행·DLQ 재시도는 메모리에서만 바뀐다. */
export const pipelineSeed = {
  runs: dataset.pipelineRuns,
  tasks: dataset.runTasks,
  deadLetters: dataset.deadLetters,
  sources: dataset.sources,
};
