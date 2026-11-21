import { median, m2ToPyeong } from './metrics';
import { areaBandOf } from './radar';
import { areaBucket } from './risk';
import type {
  ApartmentComplex,
  AptTransaction,
  AreaBandKey,
  Region,
} from './types';

/**
 * 전고점 대비 하락률 랭킹.
 *
 * 350세대 이상 단지의 매매 실거래를 (단지, 5㎡ 면적 구간)으로 묶고, 월별 평당가 중위값의
 * 3개월 이동 중위값으로 전고점(24개월 내 최고)과 현재 시세를 비교한다.
 * - 같은 단지라도 59㎡와 84㎡는 평당가 수준이 다르므로 면적 구간을 반드시 나눈다.
 * - 월 표본이 1건이면 그 달 값이 한 건에 좌우되므로 3개월 이동 중위값을 쓴다.
 * - 표본이 부족한 구간(8개월 미만 또는 10건 미만)은 순위에서 뺀다.
 * - 단지별 순위는 표본이 충분한 구간 중 낙폭이 가장 큰 구간을 대표로 쓴다. 면적대를 고르면
 *   그 면적대 안에서만 비교한다.
 */

export const DRAWDOWN_LARGE_COMPLEX_HOUSEHOLDS = 350;
export const DRAWDOWN_MIN_MONTHS = 8;
export const DRAWDOWN_MIN_DEALS = 10;
export const DRAWDOWN_SMOOTHING_MONTHS = 3;

export interface DrawdownRow {
  complexId: string;
  complexName: string;
  lawdCd: string;
  sigungu: string;
  dong: string;
  households: number;
  builtYear: number;
  /** 단지 대표 전용면적(㎡). 면적 구간을 고르지 않았을 때 이 구간을 대표 행으로 쓴다. */
  representativeAreaM2: number;
  /** 대표 면적과 같은 5㎡ 구간인지. */
  isRepresentative: boolean;
  /** 해당 면적 구간의 거래 면적 중위값(㎡). */
  areaM2: number;
  areaBand: AreaBandKey;
  peakMonth: string;
  peakPricePerPyeong: number;
  currentMonth: string;
  currentPricePerPyeong: number;
  /** 전고점 시세를 해당 면적으로 환산한 금액. */
  peakPriceKrw: number;
  currentPriceKrw: number;
  /** (현재 − 전고점) ÷ 전고점 × 100. 음수가 하락. */
  drawdownPct: number;
  /** 전고점 − 현재(원). */
  drawdownKrw: number;
  /** 평당가 낙폭(원/평). */
  pppDropKrw: number;
  /** 값이 있는 달 수. */
  monthCount: number;
  sampleCount: number;
}

export interface BuildDrawdownParams {
  transactions: AptTransaction[];
  complexes: ApartmentComplex[];
  regions: Region[];
  /** 오래된 순 월 목록. 보통 최근 24개월. */
  months: string[];
  minHouseholds?: number;
  minMonths?: number;
  minDeals?: number;
  smoothingMonths?: number;
}

export interface DrawdownUniverse {
  complexes: number;
  largeComplexes: number;
  evaluatedBands: number;
  skippedThinBands: number;
}

export interface DrawdownRanking {
  rows: DrawdownRow[];
  asOfMonth: string;
  universe: DrawdownUniverse;
}

function rollingMedian(values: number[], endIndex: number, window: number): number {
  const start = Math.max(0, endIndex - window + 1);
  return median(values.slice(start, endIndex + 1).filter((value) => value > 0));
}

/** 면적 중위값은 소수점을 살려야 59.9㎡가 60㎡로 반올림되지 않는다. */
function medianExact(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * 단지·면적 구간별 전고점 대비 하락률 행을 만든다.
 * 정렬은 하락률 오름차순(가장 많이 빠진 단지가 먼저), 같으면 세대수가 큰 단지가 먼저다.
 */
export function buildDrawdownRanking(params: BuildDrawdownParams): DrawdownRanking {
  const minHouseholds = params.minHouseholds ?? DRAWDOWN_LARGE_COMPLEX_HOUSEHOLDS;
  const minMonths = params.minMonths ?? DRAWDOWN_MIN_MONTHS;
  const minDeals = params.minDeals ?? DRAWDOWN_MIN_DEALS;
  const smoothing = Math.max(1, params.smoothingMonths ?? DRAWDOWN_SMOOTHING_MONTHS);
  const months = params.months;
  const monthIndex = new Map(months.map((month, index) => [month, index]));
  const regionByDong = new Map(params.regions.map((region) => [region.legalDongCode, region]));

  const rows: DrawdownRow[] = [];
  let largeComplexes = 0;
  let skippedThinBands = 0;

  for (const complex of params.complexes) {
    if (complex.households < minHouseholds) continue;
    largeComplexes += 1;

    const sales = params.transactions.filter(
      (row) => row.complexId === complex.complexId && !row.canceled && monthIndex.has(row.dealMonth),
    );
    if (sales.length === 0) continue;

    const byBucket = new Map<number, AptTransaction[]>();
    for (const row of sales) {
      const bucket = areaBucket(row.areaM2);
      const list = byBucket.get(bucket);
      if (list) list.push(row);
      else byBucket.set(bucket, [row]);
    }
    const representativeBucket = [...byBucket.entries()]
      .sort(
        (a, b) =>
          b[1].length - a[1].length ||
          Math.abs(areaBucket(complex.representativeAreaM2) - a[0]) -
            Math.abs(areaBucket(complex.representativeAreaM2) - b[0]),
      )
      .at(0)?.[0];

    for (const [bucket, bucketRows] of byBucket) {
      if (bucketRows.length < minDeals) {
        skippedThinBands += 1;
        continue;
      }
      const monthSet = new Set(bucketRows.map((row) => row.dealMonth));
      if (monthSet.size < minMonths) {
        skippedThinBands += 1;
        continue;
      }

      // 월별 평당가 중위값 → 3개월 이동 중위값. 표본이 없는 달은 0으로 두고 건너뛴다.
      const monthlyPpp = months.map((month) =>
        median(bucketRows.filter((row) => row.dealMonth === month).map((row) => row.pricePerPyeong)),
      );
      const smoothed = monthlyPpp.map((_, index) => rollingMedian(monthlyPpp, index, smoothing));
      const validIndices = smoothed
        .map((value, index) => ({ value, index }))
        .filter((row) => row.value > 0);
      if (validIndices.length < minMonths) {
        skippedThinBands += 1;
        continue;
      }

      const latestIndex = validIndices[validIndices.length - 1]!.index;
      let peakIndex = 0;
      let peakValue = 0;
      for (let index = 0; index <= latestIndex; index += 1) {
        const value = smoothed[index] ?? 0;
        if (value > peakValue) {
          peakValue = value;
          peakIndex = index;
        }
      }
      const currentValue = smoothed[latestIndex] ?? 0;
      if (peakValue <= 0 || currentValue <= 0) {
        skippedThinBands += 1;
        continue;
      }

      const areaM2 = Number(medianExact(bucketRows.map((row) => row.areaM2)).toFixed(2));
      const pyeong = m2ToPyeong(areaM2);
      const peakPriceKrw = Math.round(peakValue * pyeong);
      const currentPriceKrw = Math.round(currentValue * pyeong);
      const drawdownPct = Number((((currentValue - peakValue) / peakValue) * 100).toFixed(1));
      const region = regionByDong.get(complex.legalDongCode);

      rows.push({
        complexId: complex.complexId,
        complexName: complex.name,
        lawdCd: complex.lawdCd,
        sigungu: region?.sigungu ?? '',
        dong: region?.dong ?? '',
        households: complex.households,
        builtYear: complex.builtYear,
        representativeAreaM2: complex.representativeAreaM2,
        isRepresentative: bucket === representativeBucket,
        areaM2,
        areaBand: areaBandOf(areaM2),
        peakMonth: months[peakIndex] ?? '',
        peakPricePerPyeong: peakValue,
        currentMonth: months[latestIndex] ?? '',
        currentPricePerPyeong: currentValue,
        peakPriceKrw,
        currentPriceKrw,
        drawdownPct,
        drawdownKrw: Math.max(0, peakPriceKrw - currentPriceKrw),
        pppDropKrw: Math.max(0, peakValue - currentValue),
        monthCount: monthSet.size,
        sampleCount: bucketRows.length,
      });
    }
  }

  rows.sort(
    (a, b) =>
      a.drawdownPct - b.drawdownPct ||
      b.households - a.households ||
      a.complexName.localeCompare(b.complexName, 'ko'),
  );

  return {
    rows,
    asOfMonth: months.at(-1) ?? '',
    universe: {
      complexes: params.complexes.length,
      largeComplexes,
      evaluatedBands: rows.length,
      skippedThinBands,
    },
  };
}

export interface DrawdownFilter {
  lawdCds?: string[];
  areaBand?: AreaBandKey | 'all';
  minHouseholds?: number;
  /** true면 하락(0% 미만) 단지만 남긴다. */
  onlyDeclined?: boolean;
  limit?: number;
}

export interface DrawdownRankEntry extends DrawdownRow {
  rank: number;
}

/**
 * 단지별 순위. 면적대를 고르지 않으면 단지 대표 면적 구간(거래가 가장 많은 5㎡ 구간)을 쓴다.
 * 면적대를 고르면 그 면적대 안에서 대표 면적에 가장 가까운 구간을 쓴다(같은 ㎡·평 기준 비교).
 * 모든 구간에서 가장 많이 빠진 구간을 고르면 하락이 과장되므로 대표 구간을 쓴다.
 */
export function selectDrawdownRanking(rows: DrawdownRow[], filter: DrawdownFilter = {}): DrawdownRankEntry[] {
  const areaBand = filter.areaBand ?? 'all';
  const lawdCds = filter.lawdCds && filter.lawdCds.length > 0 ? new Set(filter.lawdCds) : null;
  const minHouseholds = filter.minHouseholds ?? 0;

  const scoped = rows.filter(
    (row) =>
      (!lawdCds || lawdCds.has(row.lawdCd)) &&
      (areaBand === 'all' || row.areaBand === areaBand) &&
      row.households >= minHouseholds &&
      (filter.onlyDeclined ? row.drawdownPct < 0 : true),
  );

  const representativeByComplex = new Map<string, DrawdownRow>();
  for (const row of scoped) {
    const existing = representativeByComplex.get(row.complexId);
    if (!existing) {
      representativeByComplex.set(row.complexId, row);
      continue;
    }
    const rowDistance = Math.abs(areaBucket(row.areaM2) - areaBucket(row.representativeAreaM2));
    const existingDistance = Math.abs(areaBucket(existing.areaM2) - areaBucket(existing.representativeAreaM2));
    if (
      rowDistance < existingDistance ||
      (rowDistance === existingDistance && row.sampleCount > existing.sampleCount)
    ) {
      representativeByComplex.set(row.complexId, row);
    }
  }

  const sorted = [...representativeByComplex.values()].sort(
    (a, b) =>
      a.drawdownPct - b.drawdownPct ||
      b.households - a.households ||
      a.complexName.localeCompare(b.complexName, 'ko'),
  );
  const limited = filter.limit ? sorted.slice(0, filter.limit) : sorted;
  return limited.map((row, index) => ({ ...row, rank: index + 1 }));
}

export interface DrawdownSummary {
  count: number;
  declinedCount: number;
  medianDrawdownPct: number;
  averageDrawdownPct: number;
  worstComplexName: string | null;
  worstDrawdownPct: number;
  totalHouseholds: number;
}

export function summarizeDrawdown(entries: DrawdownRow[]): DrawdownSummary {
  const declined = entries.filter((row) => row.drawdownPct < 0);
  const worst = [...entries].sort((a, b) => a.drawdownPct - b.drawdownPct)[0];
  return {
    count: entries.length,
    declinedCount: declined.length,
    medianDrawdownPct:
      entries.length === 0 ? 0 : Number(median(entries.map((row) => row.drawdownPct)).toFixed(1)),
    averageDrawdownPct:
      entries.length === 0
        ? 0
        : Number((entries.reduce((sum, row) => sum + row.drawdownPct, 0) / entries.length).toFixed(1)),
    worstComplexName: worst?.complexName ?? null,
    worstDrawdownPct: worst?.drawdownPct ?? 0,
    totalHouseholds: entries.reduce((sum, row) => sum + row.households, 0),
  };
}
