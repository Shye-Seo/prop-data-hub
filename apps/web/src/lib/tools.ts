import {
  AREA_BAND_RANGES,
  areaBandOf,
  buildDrawdownRanking,
  median,
  type AreaBandKey,
  type DrawdownRanking,
} from '@prop/shared';
import { MONTHS, dataset } from './dataset';

/**
 * 전세 안전진단·입주 현금 계산·전고점 하락률 화면의 데이터 접근.
 *
 * 레이더(lib/radar.ts)와 같은 방식으로 shared 계산을 브라우저에서 한 번만 실행한다.
 * 화면과 API·테스트가 같은 함수를 쓰므로 숫자가 갈라지지 않는다.
 */

export interface ComplexOption {
  complexId: string;
  name: string;
  sigungu: string;
  dong: string;
  households: number;
  builtYear: number;
  representativeAreaM2: number;
  label: string;
}

export const COMPLEX_OPTIONS: ComplexOption[] = dataset.complexes
  .map((complex) => {
    const region = dataset.regions.find((row) => row.legalDongCode === complex.legalDongCode);
    return {
      complexId: complex.complexId,
      name: complex.name,
      sigungu: region?.sigungu ?? '',
      dong: region?.dong ?? '',
      households: complex.households,
      builtYear: complex.builtYear,
      representativeAreaM2: complex.representativeAreaM2,
      label: `${complex.name} · ${region?.dong ?? ''} (${complex.households.toLocaleString('ko-KR')}세대)`,
    };
  })
  .sort((a, b) => a.sigungu.localeCompare(b.sigungu, 'ko') || b.households - a.households);

export function complexOption(complexId: string): ComplexOption | undefined {
  return COMPLEX_OPTIONS.find((row) => row.complexId === complexId);
}

export interface AreaOption {
  band: AreaBandKey;
  label: string;
  areaM2: number;
  sampleCount: number;
}

const BAND_ORDER: AreaBandKey[] = ['under60', '60to85', '85to115', 'over115'];

/** 면적 중위값은 소수점을 살린다(59.9㎡가 60㎡로 반올림되지 않게). */
function medianAreaM2(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianValue = sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return Number(medianValue.toFixed(2));
}

/** 단지에서 실제 거래가 있는 면적 구간만 고른다. areaM2는 그 구간 거래 면적의 중위값이다. */
export function areaOptionsForComplex(complexId: string): AreaOption[] {
  const rows = dataset.transactions.filter((row) => row.complexId === complexId && !row.canceled);
  const byBand = new Map<AreaBandKey, number[]>();
  for (const row of rows) {
    const band = areaBandOf(row.areaM2);
    const list = byBand.get(band);
    if (list) list.push(row.areaM2);
    else byBand.set(band, [row.areaM2]);
  }
  return BAND_ORDER.filter((band) => byBand.has(band)).map((band) => {
    const areas = byBand.get(band)!;
    return {
      band,
      label: AREA_BAND_RANGES[band].label,
      areaM2: medianAreaM2(areas),
      sampleCount: areas.length,
    };
  });
}

/** 단지의 대표 면적과 가장 가까운 거래 구간. 기본 선택값으로 쓴다. */
export function defaultAreaOption(complexId: string): AreaOption | undefined {
  const options = areaOptionsForComplex(complexId);
  const complex = dataset.complexes.find((row) => row.complexId === complexId);
  if (!complex) return options[0];
  return [...options].sort(
    (a, b) => Math.abs(a.areaM2 - complex.representativeAreaM2) - Math.abs(b.areaM2 - complex.representativeAreaM2),
  )[0];
}

export interface SaleReference {
  /** 최근 6개월 중위 매매가(원). */
  medianPriceKrw: number;
  /** 최근 6개월 중위 평당가(원/평). */
  medianPricePerPyeong: number;
  sampleCount: number;
  latestMonth: string;
  latestDealDate: string;
  monthsUsed: number;
  /** 면적 구간 안에서 표본 면적 중위값(㎡). */
  areaM2: number;
}

/**
 * 해당 단지·면적 구간의 최근 6개월 중위 매매가. 레이더의 기준 시세와 같은 기간을 쓴다.
 * 표본이 없으면 null.
 */
export function saleReference(complexId: string, band: AreaBandKey, months = 6): SaleReference | null {
  const recentMonths = MONTHS.slice(-months);
  const rows = dataset.transactions.filter(
    (row) =>
      row.complexId === complexId &&
      !row.canceled &&
      areaBandOf(row.areaM2) === band &&
      recentMonths.includes(row.dealMonth),
  );
  if (rows.length === 0) return null;
  return {
    medianPriceKrw: median(rows.map((row) => row.priceKrw)),
    medianPricePerPyeong: median(rows.map((row) => row.pricePerPyeong)),
    sampleCount: rows.length,
    latestMonth: rows.map((row) => row.dealMonth).sort().at(-1) ?? '',
    latestDealDate: rows.map((row) => row.dealDate).sort().at(-1) ?? '',
    monthsUsed: months,
    areaM2: medianAreaM2(rows.map((row) => row.areaM2)),
  };
}

/** 전고점 하락률 표본. 데모에서는 한 번만 계산한다. */
export const DRAWDOWN_SET: DrawdownRanking = buildDrawdownRanking({
  transactions: dataset.transactions,
  complexes: dataset.complexes,
  regions: dataset.regions,
  months: MONTHS,
});
