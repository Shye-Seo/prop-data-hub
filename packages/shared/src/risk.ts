import { changeRatePct, median } from './metrics';
import type {
  ApartmentComplex,
  AptRentTransaction,
  AptTransaction,
  ComplexRiskAssessment,
  PriceAnomaly,
  Region,
  RegionRiskSummary,
  RiskLevel,
  RiskSignal,
} from './types';

/**
 * 전세가율 구간. 시장에서 통용되는 기준(70% 주의, 80% 경고, 90% 위험)을 그대로 쓴다.
 * 화면 배지·리스크 점수·문서가 이 상수 하나를 참조한다.
 */
export const JEONSE_RATIO_BANDS = {
  warning: 70,
  high: 80,
  critical: 90,
} as const;

/** 리스크 점수 경계. 이 값이 바뀌면 화면 배지와 테스트가 함께 바뀐다. */
export const RISK_SCORE_THRESHOLDS = {
  moderate: 22,
  high: 45,
  critical: 70,
} as const;

const RISK_LABEL: Record<RiskLevel, string> = {
  low: '안정',
  moderate: '주의',
  high: '경고',
  critical: '위험',
};

export function riskLevelLabel(level: RiskLevel): string {
  return RISK_LABEL[level];
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= RISK_SCORE_THRESHOLDS.critical) return 'critical';
  if (score >= RISK_SCORE_THRESHOLDS.high) return 'high';
  if (score >= RISK_SCORE_THRESHOLDS.moderate) return 'moderate';
  return 'low';
}

export function jeonseRatioPct(jeonseKrw: number, saleKrw: number): number {
  if (saleKrw <= 0 || jeonseKrw <= 0) return 0;
  return Number(((jeonseKrw / saleKrw) * 100).toFixed(1));
}

export function jeonseRiskLevel(ratioPct: number): RiskLevel {
  if (ratioPct >= JEONSE_RATIO_BANDS.critical) return 'critical';
  if (ratioPct >= JEONSE_RATIO_BANDS.high) return 'high';
  if (ratioPct >= JEONSE_RATIO_BANDS.warning) return 'moderate';
  return 'low';
}

export interface MonthlyJeonsePoint {
  month: string;
  jeonseMedianKrw: number;
  sampleCount: number;
}

/** 전세 계약만 골라 월별 중위 보증금을 만든다(월세 계약은 전세가율에서 제외). */
export function monthlyJeonseSeries(
  rents: AptRentTransaction[],
  months: string[],
  filter: { complexId?: string | null; lawdCd?: string; legalDongCode?: string } = {},
): MonthlyJeonsePoint[] {
  const scoped = rents.filter(
    (row) =>
      row.contractType === 'jeonse' &&
      (!filter.complexId || row.complexId === filter.complexId) &&
      (!filter.lawdCd || row.lawdCd === filter.lawdCd) &&
      (!filter.legalDongCode || row.legalDongCode === filter.legalDongCode),
  );
  return months.map((month) => {
    const rows = scoped.filter((row) => row.dealMonth === month);
    return { month, jeonseMedianKrw: median(rows.map((row) => row.depositKrw)), sampleCount: rows.length };
  });
}

export interface JeonseRatioPoint {
  month: string;
  ratioPct: number;
  jeonseMedianKrw: number;
  saleMedianKrw: number;
  /** 평당 기준 중위값. 면적 구성이 달라도 비교할 수 있도록 전세가율은 이 값으로 계산한다. */
  jeonseMedianPpp: number;
  saleMedianPpp: number;
  jeonseSamples: number;
  saleSamples: number;
  /** 전세가율을 매칭한 면적 구간(㎡). 화면에 '84㎡ 구간 기준'처럼 표기한다. */
  matchedAreas: number[];
}

/** 5㎡ 단위 면적 구간. 같은 구간끼리 비교해야 평당가 차이가 면적 구성 때문인지 실제 가격 변화인지 구분된다. */
export function areaBucket(areaM2: number): number {
  return Math.round(areaM2 / 5) * 5;
}

/**
 * 월별 전세가율. 같은 달에 매매·전세 표본이 모두 있을 때만 계산한다.
 *
 * 단지 안에서도 59㎡·84㎡가 섞여 거래되므로 총액 중위값끼리 나누면 면적 구성에 따라 값이 튄다.
 * 그래서 (1) 면적 구간별로 전세 평당가와 매매 평당가를 매칭해 비율을 구하고
 * (2) 그 비율들의 중위값을 그 달의 전세가율로 쓴다. 화면에는 매칭에 쓴 면적 구간을 같이 보여준다.
 */
export function jeonseRatioSeries(
  rents: AptRentTransaction[],
  sales: AptTransaction[],
  months: string[],
  filter: { complexId?: string | null; lawdCd?: string; legalDongCode?: string; areaM2?: number } = {},
): JeonseRatioPoint[] {
  const onlyBucket = filter.areaM2 ? areaBucket(filter.areaM2) : null;
  const scopedRents = rents.filter(
    (row) =>
      row.contractType === 'jeonse' &&
      (!filter.complexId || row.complexId === filter.complexId) &&
      (!filter.lawdCd || row.lawdCd === filter.lawdCd) &&
      (!filter.legalDongCode || row.legalDongCode === filter.legalDongCode) &&
      (onlyBucket === null || areaBucket(row.areaM2) === onlyBucket),
  );
  const scopedSales = sales.filter(
    (row) =>
      !row.canceled &&
      (!filter.complexId || row.complexId === filter.complexId) &&
      (!filter.lawdCd || row.lawdCd === filter.lawdCd) &&
      (!filter.legalDongCode || row.legalDongCode === filter.legalDongCode) &&
      (onlyBucket === null || areaBucket(row.areaM2) === onlyBucket),
  );

  return months.map((month) => {
    const monthRents = scopedRents.filter((row) => row.dealMonth === month);
    const monthSales = scopedSales.filter((row) => row.dealMonth === month);
    const buckets = new Map<number, { rents: AptRentTransaction[]; sales: AptTransaction[] }>();

    for (const row of monthRents) {
      const key = areaBucket(row.areaM2);
      const bucket = buckets.get(key) ?? { rents: [], sales: [] };
      bucket.rents.push(row);
      buckets.set(key, bucket);
    }
    for (const row of monthSales) {
      const key = areaBucket(row.areaM2);
      const bucket = buckets.get(key) ?? { rents: [], sales: [] };
      bucket.sales.push(row);
      buckets.set(key, bucket);
    }

    const matched = [...buckets.entries()].filter(([, bucket]) => bucket.rents.length > 0 && bucket.sales.length > 0);
    if (matched.length === 0) {
      return {
        month,
        ratioPct: 0,
        jeonseMedianKrw: median(monthRents.map((row) => row.depositKrw)),
        saleMedianKrw: median(monthSales.map((row) => row.priceKrw)),
        jeonseMedianPpp: 0,
        saleMedianPpp: 0,
        jeonseSamples: monthRents.length,
        saleSamples: monthSales.length,
        matchedAreas: [],
      };
    }

    const bucketRatios = matched.map(([, bucket]) => {
      const jeonsePpp = median(bucket.rents.map((row) => Math.round(row.depositKrw / (row.areaM2 / 3.305785))));
      const salePpp = median(bucket.sales.map((row) => row.pricePerPyeong));
      return jeonseRatioPct(jeonsePpp, salePpp);
    });
    const matchedRents = matched.flatMap(([, bucket]) => bucket.rents);
    const matchedSales = matched.flatMap(([, bucket]) => bucket.sales);

    return {
      month,
      ratioPct: Number(median(bucketRatios).toFixed(1)),
      jeonseMedianKrw: median(matchedRents.map((row) => row.depositKrw)),
      saleMedianKrw: median(matchedSales.map((row) => row.priceKrw)),
      jeonseMedianPpp: median(matchedRents.map((row) => Math.round(row.depositKrw / (row.areaM2 / 3.305785)))),
      saleMedianPpp: median(matchedSales.map((row) => row.pricePerPyeong)),
      jeonseSamples: monthRents.length,
      saleSamples: monthSales.length,
      matchedAreas: matched.map(([key]) => key).sort((a, b) => a - b),
    };
  });
}

export interface AnomalyOptions {
  /** 이상치 판정에 쓰는 최소 표본 수. 이보다 적으면 z-score를 계산하지 않는다. */
  minSamples?: number;
  /** modified z-score 임계값. MAD 기반이라 극단값에 덜 민감하다. */
  modifiedZThreshold?: number;
  /** 중위 평당가 대비 이 비율 이상 낮은 거래를 급락으로 본다(%). */
  sharpDropPct?: number;
  /** z-score로 이상치를 판정할 때 최소 벗어남(%). MAD가 작으면 작은 차이도 z가 커지므로 같이 본다. */
  minDeviationPct?: number;
}

/**
 * 단지별 평당가 분포에서 벗어난 거래를 찾는다.
 *
 * - 기준값은 단지·기간 내 중위 평당가, 산포는 MAD(중위절대편차)를 쓴다.
 * - 급락은 중위 대비 -sharpDropPct% 이하인 거래로 따로 표시한다(같은 하락이지만 화면 문구가 다르다).
 * - 표본이 minSamples 미만이면 modifiedZ는 null로 두고, 급락 여부만 본다.
 */
export function detectPriceAnomalies(
  transactions: AptTransaction[],
  options: AnomalyOptions = {},
): PriceAnomaly[] {
  const minSamples = options.minSamples ?? 12;
  const zThreshold = options.modifiedZThreshold ?? 4.5;
  const sharpDropPct = options.sharpDropPct ?? 14;
  const minDeviationPct = options.minDeviationPct ?? 8;

  const groups = new Map<string, AptTransaction[]>();
  for (const row of transactions) {
    if (row.canceled) continue;
    // 같은 단지라도 59㎡와 84㎡는 평당가 수준이 다르므로 면적 구간까지 같아야 비교가 성립한다.
    const key = `${row.complexId ?? `${row.legalDongCode}:${row.aptName}`}:${areaBucket(row.areaM2)}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const anomalies: PriceAnomaly[] = [];
  for (const rows of groups.values()) {
    const referencePpp = median(rows.map((row) => row.pricePerPyeong));
    if (referencePpp <= 0) continue;
    const deviations = rows.map((row) => Math.abs(row.pricePerPyeong - referencePpp));
    const mad = median(deviations);

    for (const row of rows) {
      const deviationPct = Number((((row.pricePerPyeong - referencePpp) / referencePpp) * 100).toFixed(1));
      const modifiedZ =
        mad > 0 && rows.length >= minSamples
          ? Number((0.6745 * ((row.pricePerPyeong - referencePpp) / mad)).toFixed(2))
          : null;
      const isSharpDrop = deviationPct <= -sharpDropPct;
      const isHigh = modifiedZ !== null && modifiedZ >= zThreshold && deviationPct >= minDeviationPct;
      const isLow = modifiedZ !== null && modifiedZ <= -zThreshold && deviationPct <= -minDeviationPct;
      if (!isSharpDrop && !isHigh && !isLow) continue;

      anomalies.push({
        dealHash: row.dealHash,
        complexId: row.complexId,
        aptName: row.aptName,
        dong: row.dong,
        dealDate: row.dealDate,
        priceKrw: row.priceKrw,
        pricePerPyeong: row.pricePerPyeong,
        referencePpp,
        deviationPct,
        modifiedZ,
        kind: isSharpDrop ? 'sharp_drop' : isHigh ? 'outlier_high' : 'outlier_low',
      });
    }
  }

  return anomalies.sort((a, b) => b.dealDate.localeCompare(a.dealDate));
}

export interface RiskScoreInput {
  jeonseRatioPct: number;
  change6mPct: number;
  change12mPct: number;
  anomalyCount: number;
  volume12m: number;
}

/**
 * 전세가율·가격 흐름·이상치·유동성을 합산한 0~100 리스크 점수.
 *
 * 항목별 배점(합계 100 상한):
 * - 전세가율 90%↑ 35, 85%↑ 28, 80%↑ 22, 75%↑ 12, 70%↑ 6
 * - 최근 6개월 하락 -10%↓ 25, -6%↓ 18, -3%↓ 10, -1%↓ 4
 * - 12개월 하락 -10%↓ 12, -5%↓ 8, -2%↓ 3
 * - 이상치 3건↑ 15, 2건 10, 1건 6
 * - 12개월 거래 6건↓ 10, 12건↓ 5
 *
 * 배점은 "이 단지가 지금 계약하기에 안전한가"를 한 숫자로 비교하기 위한 것이고,
 * 투자 판단이나 감정평가가 아니다. 화면과 리포트는 항상 근거 신호(문장)를 함께 보여준다.
 */
export function scoreComplexRisk(input: RiskScoreInput): { score: number; level: RiskLevel; signals: RiskSignal[] } {
  const signals: RiskSignal[] = [];
  let score = 0;

  const ratio = input.jeonseRatioPct;
  if (ratio >= JEONSE_RATIO_BANDS.critical) {
    score += 35;
    signals.push({
      code: 'jeonse_ratio_high',
      level: 'critical',
      label: '전세가율 위험',
      detail: `전세가율 ${ratio.toFixed(1)}% — 매매가가 내려갈 때 보증금 반환 여력이 빠르게 줄어드는 구간입니다.`,
    });
  } else if (ratio >= 85) {
    score += 28;
    signals.push({
      code: 'jeonse_ratio_high',
      level: 'high',
      label: '전세가율 경고',
      detail: `전세가율 ${ratio.toFixed(1)}% — 90%에 가까워 역전세 위험을 먼저 확인해야 합니다.`,
    });
  } else if (ratio >= JEONSE_RATIO_BANDS.high) {
    score += 22;
    signals.push({
      code: 'jeonse_ratio_warning',
      level: 'high',
      label: '전세가율 경고',
      detail: `전세가율 ${ratio.toFixed(1)}% — 시장 경고 구간(80%)을 넘었습니다.`,
    });
  } else if (ratio >= 75) {
    score += 12;
    signals.push({
      code: 'jeonse_ratio_warning',
      level: 'moderate',
      label: '전세가율 주의',
      detail: `전세가율 ${ratio.toFixed(1)}% — 경고 구간까지 ${(JEONSE_RATIO_BANDS.high - ratio).toFixed(1)}%p 남았습니다.`,
    });
  } else if (ratio >= JEONSE_RATIO_BANDS.warning) {
    score += 6;
    signals.push({
      code: 'jeonse_ratio_warning',
      level: 'moderate',
      label: '전세가율 주의',
      detail: `전세가율 ${ratio.toFixed(1)}% — 통상 주의 구간(70%)에 들어섰습니다.`,
    });
  }

  const change6 = input.change6mPct;
  if (change6 <= -1) {
    score += change6 <= -10 ? 25 : change6 <= -6 ? 18 : change6 <= -3 ? 10 : 4;
    signals.push({
      code: 'recent_price_drop',
      level: change6 <= -8 ? 'high' : 'moderate',
      label: '최근 급락',
      detail: `최근 6개월 중위 매매가 ${change6.toFixed(1)}% — 거래 표본 기준 하락 폭입니다.`,
    });
  }

  if (input.change12mPct <= -2) {
    score += input.change12mPct <= -10 ? 12 : input.change12mPct <= -5 ? 8 : 3;
    signals.push({
      code: 'twelve_month_decline',
      level: input.change12mPct <= -10 ? 'high' : 'moderate',
      label: '연간 하락',
      detail: `전년 동월 대비 ${input.change12mPct.toFixed(1)}% — 하락 추세가 12개월 이상 이어졌습니다.`,
    });
  }

  if (input.anomalyCount >= 1) {
    score += input.anomalyCount >= 3 ? 15 : input.anomalyCount === 2 ? 10 : 6;
    signals.push({
      code: 'price_anomaly',
      level: input.anomalyCount >= 3 ? 'high' : 'moderate',
      label: '이상 거래',
      detail: `최근 12개월 평당가 이상치 ${input.anomalyCount}건 — 단지 중위 평당가와 크게 벌어진 거래가 있습니다.`,
    });
  }

  if (input.volume12m > 0 && input.volume12m <= 12) {
    score += input.volume12m <= 6 ? 10 : 5;
    signals.push({
      code: 'thin_liquidity',
      level: 'moderate',
      label: '거래 얇음',
      detail: `최근 12개월 거래 ${input.volume12m}건 — 시세를 확인할 표본이 적습니다.`,
    });
  }

  const capped = Math.min(100, Math.round(score));
  return { score: capped, level: riskLevelFromScore(capped), signals };
}

export interface AssessComplexRiskParams {
  complex: ApartmentComplex;
  region: Region | undefined;
  sales: AptTransaction[];
  rents: AptRentTransaction[];
  months: string[];
}

/** 한 단지의 전세가율·가격 흐름·이상치를 모아 리스크 평가를 만든다. */
export function assessComplexRisk(params: AssessComplexRiskParams): ComplexRiskAssessment {
  const complexSales = params.sales.filter((row) => row.complexId === params.complex.complexId);
  const complexRents = params.rents.filter((row) => row.complexId === params.complex.complexId);
  const ratioSeries = jeonseRatioSeries(complexRents, complexSales, params.months, {
    complexId: params.complex.complexId,
    // 같은 면적 구간(보통 84㎡)끼리 비교해 면적 구성 변화가 전세가율·가격 변화율에 섞이지 않게 한다.
    areaM2: params.complex.representativeAreaM2,
  });
  const valid = ratioSeries.filter((row) => row.ratioPct > 0 && row.jeonseSamples > 0);

  const latest = valid.at(-1);
  const asOfMonth = latest?.month ?? params.months.at(-1) ?? '';
  const recentSales = complexSales.filter(
    (row) => !row.canceled && row.dealMonth >= (params.months.at(-12) ?? params.months[0] ?? ''),
  );
  const anomalyWindowStart = `${params.months.at(-12) ?? params.months[0] ?? ''}-01`;
  const anomalyCount = detectPriceAnomalies(complexSales).filter((row) => row.dealDate >= anomalyWindowStart).length;

  const ratio = latest?.ratioPct ?? 0;
  // 가격 변화율은 24개월 달력 순서를 그대로 두고, 같은 면적 구간의 평당가를 3개월 중위값으로 묶어 계산한다.
  // (월 표본이 1~2건이라 한 달 값만 쓰면 잡음이 크다.)
  const repBucket = areaBucket(params.complex.representativeAreaM2);
  const pppByMonth = params.months.map((month) =>
    median(
      complexSales
        .filter((row) => !row.canceled && row.dealMonth === month && areaBucket(row.areaM2) === repBucket)
        .map((row) => row.pricePerPyeong),
    ),
  );
  let latestIndex = -1;
  for (let index = pppByMonth.length - 1; index >= 0; index -= 1) {
    if ((pppByMonth[index] ?? 0) > 0) {
      latestIndex = index;
      break;
    }
  }
  const change6mPct =
    latestIndex >= 6
      ? changeRatePct(rollingMedian(pppByMonth, latestIndex), rollingMedian(pppByMonth, latestIndex - 6))
      : 0;
  const change12mPct =
    latestIndex >= 12
      ? changeRatePct(rollingMedian(pppByMonth, latestIndex), rollingMedian(pppByMonth, latestIndex - 12))
      : 0;
  const { score, level, signals } = scoreComplexRisk({
    jeonseRatioPct: ratio,
    change6mPct,
    change12mPct,
    anomalyCount,
    volume12m: recentSales.length,
  });

  return {
    complexId: params.complex.complexId,
    complexName: params.complex.name,
    lawdCd: params.complex.lawdCd,
    sigungu: params.region?.sigungu ?? '',
    dong: params.region?.dong ?? '',
    jeonseRatioPct: ratio,
    jeonseMedianKrw: latest?.jeonseMedianKrw ?? 0,
    saleMedianKrw: latest?.saleMedianKrw ?? 0,
    latestPricePerPyeong: latest?.saleMedianPpp ?? 0,
    gapKrw: Math.max(
      0,
      Math.round(((latest?.saleMedianPpp ?? 0) - (latest?.jeonseMedianPpp ?? 0)) * (params.complex.representativeAreaM2 / 3.305785)),
    ),
    change6mPct,
    change12mPct,
    volume12m: recentSales.length,
    anomalyCount,
    score,
    level,
    signals,
    asOfMonth,
  };
}

/**
 * 여러 단지의 월별 전세가율을 구 단위 시계열로 묶는다.
 * 단지마다 한 달 표본이 적어 월 단위 비율이 흔들리므로, 그 달에 값이 있는 단지들의 중위값을 쓴다.
 */
export function aggregateRatioSeries(
  seriesList: JeonseRatioPoint[][],
  options: { minContributors?: number } = {},
): Array<{ month: string; ratioPct: number }> {
  const months = seriesList[0]?.map((row) => row.month) ?? [];
  const minContributors = options.minContributors ?? 2;
  return months.map((month, index) => {
    const values = seriesList
      .map((series) => series[index]?.ratioPct ?? 0)
      .filter((value) => value > 0);
    // 기여 단지가 너무 적은 달은 한 단지 값이 구 전체 값처럼 보이므로 비운다(화면에서는 빈 구간).
    if (values.length < minContributors) return { month, ratioPct: 0 };
    return { month, ratioPct: Number(median(values).toFixed(1)) };
  });
}

/** 여러 달 값을 묶어 중위값을 낸다. 월 표본이 1~2건일 때 한 달 값으로 추세를 판단하지 않기 위해 쓴다. */
function rollingMedian(values: number[], endIndex: number, window = 3): number {
  const start = Math.max(0, endIndex - window + 1);
  const slice = values.slice(start, endIndex + 1).filter((value) => value > 0);
  return median(slice);
}

/**
 * 구 단위 전세가율 추이. 단지별로 같은 면적 구간의 전세가율을 구한 뒤 달마다 중위값을 낸다.
 * 한 달 표본이 2~3곳뿐이라 월별 값이 흔들리므로, 화면에는 3개월 이동 중위값을 내려준다.
 * 표본이 부족한 달(기여 단지 2곳 미만)은 0으로 두고, 화면은 그 구간을 비운다.
 */
export function regionJeonseTrend(params: {
  rents: AptRentTransaction[];
  sales: AptTransaction[];
  complexes: ApartmentComplex[];
  months: string[];
  lawdCd: string;
}): Array<{ month: string; ratioPct: number }> {
  const seriesList = params.complexes
    .filter((complex) => complex.lawdCd === params.lawdCd)
    .map((complex) =>
      jeonseRatioSeries(params.rents, params.sales, params.months, {
        complexId: complex.complexId,
        areaM2: complex.representativeAreaM2,
      }),
    );
  const monthly = aggregateRatioSeries(seriesList);
  return monthly.map((row, index) => {
    const window = monthly
      .slice(Math.max(0, index - 2), index + 1)
      .map((item) => item.ratioPct)
      .filter((value) => value > 0);
    return { month: row.month, ratioPct: window.length === 0 ? 0 : Number(median(window).toFixed(1)) };
  });
}

export function summarizeRegionRisk(params: {
  lawdCd: string;
  sigungu: string;
  assessments: ComplexRiskAssessment[];
  jeonseRatioTrend: Array<{ month: string; ratioPct: number }>;
}): RegionRiskSummary {
  const rows = params.assessments.filter((row) => row.lawdCd === params.lawdCd);
  const trend = params.jeonseRatioTrend.filter((row) => row.ratioPct > 0).slice(-12);
  return {
    lawdCd: params.lawdCd,
    sigungu: params.sigungu,
    complexCount: rows.length,
    medianPricePerPyeong: median(rows.map((row) => row.latestPricePerPyeong).filter((value) => value > 0)),
    medianJeonseRatioPct: Number(
      median(rows.map((row) => row.jeonseRatioPct).filter((value) => value > 0)).toFixed(1),
    ),
    volume12m: rows.reduce((sum, row) => sum + row.volume12m, 0),
    anomalyCount: rows.reduce((sum, row) => sum + row.anomalyCount, 0),
    highRiskCount: rows.filter((row) => row.level === 'high' || row.level === 'critical').length,
    averageScore: rows.length === 0 ? 0 : Number((rows.reduce((sum, row) => sum + row.score, 0) / rows.length).toFixed(1)),
    jeonseRatioTrend: trend,
  };
}
