import { formatAreaM2AndPyeong, median, shiftMonth } from './metrics';
import { areaBucket, jeonseRatioSeries } from './risk';
import type {
  AlertChannel,
  AlertPreview,
  AlertRule,
  AlertRuleDraft,
  ApartmentComplex,
  AptRentTransaction,
  AptTransaction,
  AreaBandKey,
  DealGrade,
  DealSignal,
  RadarDeal,
  Region,
} from './types';

/**
 * 350세대 이상 매매 급매·저평가 레이더.
 *
 * 판단 기준을 한 곳에 모아 API·화면·알림 미리보기가 같은 값을 쓰게 한다.
 * - 기준 시세: 같은 단지·같은 면적 구간의 최근 6개월 중위 매매가(계약 해제 제외, 해당 거래 자신은 제외)
 * - 할인율: (거래가 − 기준 시세) ÷ 기준 시세 × 100. 음수면 기준 시세보다 싼 거래다.
 * - 표본이 3건 미만인 (단지, 면적)은 기준 시세를 신뢰할 수 없어 레이더에서 뺀다.
 * - 점수는 할인율 45 + 전세가율 20 + 3개월 거래량 15 + 단지 규모 20 = 100점 만점.
 */

/** 대단지 기준. 사용자 요구("350세대 이상")를 상수로 고정해 API 기본값·화면 토글·문서가 같이 쓴다. */
export const LARGE_COMPLEX_HOUSEHOLDS = 350;

/** 레이더 기본 수집 지역. 수집기 CLI 기본값과 화면 구 선택지가 이 목록을 쓴다. */
export const RADAR_SIGUNGU: Array<{ lawdCd: string; sigungu: string }> = [
  { lawdCd: '26230', sigungu: '부산진구' },
  { lawdCd: '26260', sigungu: '동래구' },
  { lawdCd: '26290', sigungu: '남구' },
  { lawdCd: '26350', sigungu: '해운대구' },
  { lawdCd: '26470', sigungu: '연제구' },
  { lawdCd: '26500', sigungu: '수영구' },
];

export function sigunguOf(lawdCd: string): string {
  return RADAR_SIGUNGU.find((row) => row.lawdCd === lawdCd)?.sigungu ?? lawdCd;
}

/**
 * 전용면적 구간. 전세가율·비교 화면과 같은 경계(60·85·115㎡ = 18·26·35평)를 쓴다.
 * 필터 칩·알림 조건 문장에 그대로 나가므로 라벨에 평 환산을 함께 적는다.
 */
export const AREA_BAND_RANGES: Record<AreaBandKey, { min: number; max: number; label: string }> = {
  under60: { min: 0, max: 60, label: '60㎡ (18평) 이하' },
  '60to85': { min: 60, max: 85, label: '60~85㎡ (18~26평)' },
  '85to115': { min: 85, max: 115, label: '85~115㎡ (26~35평)' },
  over115: { min: 115, max: Number.POSITIVE_INFINITY, label: '115㎡ (35평) 초과' },
};

export function areaBandOf(areaM2: number): AreaBandKey {
  if (areaM2 <= 60) return 'under60';
  if (areaM2 <= 85) return '60to85';
  if (areaM2 <= 115) return '85to115';
  return 'over115';
}

export function areaBandLabel(band: AreaBandKey | 'all'): string {
  return band === 'all' ? '전체 면적' : AREA_BAND_RANGES[band].label;
}

export function matchesAreaBand(areaM2: number, band: AreaBandKey | 'all'): boolean {
  return band === 'all' || areaBandOf(areaM2) === band;
}

/**
 * 점수 배점표. 항목별 상한을 더하면 100이 된다.
 * 배점을 바꾸면 화면 설명(Dictionary)·README·테스트가 함께 바뀌어야 하므로 여기 한 곳에 둔다.
 */
export const DEAL_SCORE_WEIGHTS = {
  discount: [
    { thresholdPct: -15, points: 45, label: '-15% 이하' },
    { thresholdPct: -12, points: 38, label: '-12% 이하' },
    { thresholdPct: -10, points: 32, label: '-10% 이하' },
    { thresholdPct: -8, points: 24, label: '-8% 이하' },
    { thresholdPct: -6, points: 14, label: '-6% 이하' },
    { thresholdPct: -4, points: 7, label: '-4% 이하' },
  ],
  jeonse: [
    { thresholdPct: 65, points: 20, label: '65% 이하' },
    { thresholdPct: 70, points: 16, label: '70% 이하' },
    { thresholdPct: 75, points: 12, label: '75% 이하' },
    { thresholdPct: 80, points: 6, label: '80% 이하' },
  ],
  liquidity: [
    { threshold: 8, points: 15, label: '8건 이상' },
    { threshold: 5, points: 11, label: '5건 이상' },
    { threshold: 3, points: 7, label: '3건 이상' },
    { threshold: 2, points: 4, label: '2건 이상' },
  ],
  scale: [
    { threshold: 1000, points: 20, label: '1,000세대 이상' },
    { threshold: 700, points: 16, label: '700세대 이상' },
    { threshold: 500, points: 12, label: '500세대 이상' },
    { threshold: LARGE_COMPLEX_HOUSEHOLDS, points: 8, label: '350세대 이상' },
  ],
} as const;

/** 점수 구성 요약. API 응답·API 문서·지표 정의서가 같은 표를 인용한다. */
export const DEAL_SCORE_SUMMARY = {
  discount: { maxPoints: 45, description: '기준 시세(같은 단지·면적 구간 최근 6개월 중위 매매가) 대비 할인율' },
  jeonse: { maxPoints: 20, description: '전세가율 — 낮을수록 매매가와 보증금 차이(갭) 부담이 작다' },
  liquidity: { maxPoints: 15, description: '최근 3개월 같은 단지·면적 거래 건수(유동성)' },
  scale: { maxPoints: 20, description: '단지 세대수 — 350세대 이상 대단지 가중치' },
} as const;

export const DEAL_GRADE_THRESHOLDS = {
  strong: 70,
  good: 55,
  watch: 40,
} as const;

const GRADE_LABEL: Record<DealGrade, string> = {
  strong: '적극 검토',
  good: '검토',
  watch: '관찰',
  marginal: '기준 미달',
};

export function dealGradeLabel(grade: DealGrade): string {
  return GRADE_LABEL[grade];
}

export function dealGradeFromScore(score: number): DealGrade {
  if (score >= DEAL_GRADE_THRESHOLDS.strong) return 'strong';
  if (score >= DEAL_GRADE_THRESHOLDS.good) return 'good';
  if (score >= DEAL_GRADE_THRESHOLDS.watch) return 'watch';
  return 'marginal';
}

export interface DealScoreInput {
  /** 기준 시세 대비 할인율(%). 음수가 싸다. */
  discountPct: number;
  /** 단지·면적 구간 최근 전세가율(%). 전세 표본이 없으면 null. */
  jeonseRatioPct: number | null;
  /** 같은 단지·같은 면적 구간의 최근 3개월 거래 건수. */
  volume3m: number;
  households: number;
  /** 거래 유형. 직거래는 중위가 비교가 왜곡될 수 있어 별도로 표시한다. */
  dealType?: string;
}

export interface DealScoreResult {
  score: number;
  grade: DealGrade;
  signals: DealSignal[];
}

/**
 * 매물 점수 계산.
 * 신호(signals)는 화면에 근거 문장으로 그대로 보여준다. 점수만 보여주면 왜 높은지 알 수 없다.
 */
export function scoreDeal(input: DealScoreInput): DealScoreResult {
  const signals: DealSignal[] = [];
  let score = 0;

  const discountBand = DEAL_SCORE_WEIGHTS.discount.find((row) => input.discountPct <= row.thresholdPct);
  if (discountBand) {
    score += discountBand.points;
    signals.push({
      code: 'discount',
      label: '기준 시세 할인',
      points: discountBand.points,
      detail: `최근 6개월 단지·면적 중위가 대비 ${input.discountPct.toFixed(1)}% (배점 ${discountBand.points})`,
    });
  }

  // -20% 이하 할인은 급매가 아니라 특수 조건(수리 필요·층/향·직거래)일 가능성이 커서 따로 알린다.
  if (input.discountPct <= -20) {
    signals.push({
      code: 'discount_check',
      label: '특수 조건 확인',
      points: 0,
      detail: `중위가 대비 ${input.discountPct.toFixed(1)}% — 수리 필요·층/향·직거래 여부를 계약 전에 확인해야 합니다.`,
    });
  }
  if (input.dealType && input.dealType !== '중개거래') {
    signals.push({
      code: 'direct_trade',
      label: '직거래 신고',
      points: 0,
      detail: `${input.dealType} 신고 건 — 가족 간 거래 등 시세와 무관한 조건일 수 있습니다.`,
    });
  }

  if (input.jeonseRatioPct !== null) {
    const jeonseBand = DEAL_SCORE_WEIGHTS.jeonse.find((row) => input.jeonseRatioPct! <= row.thresholdPct);
    if (jeonseBand) {
      score += jeonseBand.points;
      signals.push({
        code: 'jeonse_ratio',
        label: '갭 부담 낮음',
        points: jeonseBand.points,
        detail: `전세가율 ${input.jeonseRatioPct.toFixed(1)}% — 매매가와 보증금 차이(갭)가 상대적으로 작습니다.`,
      });
    } else {
      signals.push({
        code: 'jeonse_ratio',
        label: '갭 부담 높음',
        points: 0,
        detail: `전세가율 ${input.jeonseRatioPct.toFixed(1)}% — 보증금이 매매가에 가까워 갭 부담이 큽니다.`,
      });
    }
  } else {
    signals.push({
      code: 'jeonse_ratio',
      label: '전세 표본 없음',
      points: 0,
      detail: '같은 면적 구간의 전세 계약 표본이 없어 갭 부담을 계산하지 못했습니다.',
    });
  }

  const liquidityBand = DEAL_SCORE_WEIGHTS.liquidity.find((row) => input.volume3m >= row.threshold);
  if (liquidityBand) {
    score += liquidityBand.points;
    signals.push({
      code: 'liquidity',
      label: '거래 유동성',
      points: liquidityBand.points,
      detail: `최근 3개월 같은 면적 거래 ${input.volume3m}건 — 시세 확인이 가능한 표본입니다.`,
    });
  } else {
    signals.push({
      code: 'liquidity',
      label: '거래 얇음',
      points: 0,
      detail: `최근 3개월 같은 면적 거래 ${input.volume3m}건 — 급매가 시세인지 확인할 표본이 적습니다.`,
    });
  }

  const scaleBand = DEAL_SCORE_WEIGHTS.scale.find((row) => input.households >= row.threshold);
  if (scaleBand) {
    score += scaleBand.points;
    signals.push({
      code: 'scale',
      label: '대단지',
      points: scaleBand.points,
      detail: `${input.households.toLocaleString('ko-KR')}세대 — ${scaleBand.label} 단지 가중치입니다.`,
    });
  }

  const capped = Math.min(100, Math.round(score));
  return { score: capped, grade: dealGradeFromScore(capped), signals };
}

export interface BuildRadarDealsParams {
  transactions: AptTransaction[];
  rents: AptRentTransaction[];
  complexes: ApartmentComplex[];
  regions: Region[];
  /** 전세가율을 계산할 월 목록(오래된 순). 보통 최근 24개월. */
  months: string[];
  /** 기준 시세를 만들 때 보는 개월 수. 기본 6. */
  referenceMonths?: number;
  /** 기준 시세를 인정하는 최소 표본 수. 기본 3. */
  minReferenceSamples?: number;
  /** 유동성 계산 개월 수. 기본 3. */
  liquidityMonths?: number;
  /** 이 개월 수 안에서만 후보 거래를 만든다. 기본 6(급매는 최근 거래에서 나온다). */
  lookbackMonths?: number;
}

export interface RadarDealUniverse {
  /** 후보로 훑은 단지 수 */
  complexes: number;
  /** 350세대 이상 단지 수 */
  largeComplexes: number;
  /** 훑은 거래 수 */
  scannedDeals: number;
  /** 기준 시세 표본이 부족해 제외한 거래 수 */
  thinReferenceDeals: number;
  /** 전세가율을 계산하지 못한 거래 수 */
  missingJeonseDeals: number;
}

export interface RadarDealSet {
  deals: RadarDeal[];
  universe: RadarDealUniverse;
  asOfMonth: string;
}

/**
 * 후보 거래마다 기준 시세·할인율·전세가율·유동성을 계산해 레이더 매물 목록을 만든다.
 *
 * 성능: 단지별로 거래를 묶고 (단지, 면적 구간) 단위로 정렬해 두므로 O(단지×거래²)이 아니라
 * 단지 안의 거래 수에 비례한다. 데모(수천 건)와 실서비스 월 단위 배치 모두 같은 함수를 쓴다.
 */
export function buildRadarDealSet(params: BuildRadarDealsParams): RadarDealSet {
  const referenceMonths = params.referenceMonths ?? 6;
  const minReferenceSamples = params.minReferenceSamples ?? 3;
  const liquidityMonths = params.liquidityMonths ?? 3;
  const lookbackMonths = params.lookbackMonths ?? 6;

  const endMonth = params.months.at(-1) ?? '';
  const lookbackStart = shiftMonth(endMonth || '2026-09', -(lookbackMonths - 1));

  const complexById = new Map(params.complexes.map((complex) => [complex.complexId, complex]));
  const regionByDong = new Map(params.regions.map((region) => [region.legalDongCode, region]));

  const salesByComplex = new Map<string, AptTransaction[]>();
  for (const row of params.transactions) {
    if (row.canceled || !row.complexId) continue;
    const list = salesByComplex.get(row.complexId);
    if (list) list.push(row);
    else salesByComplex.set(row.complexId, [row]);
  }

  const rentsByComplex = new Map<string, AptRentTransaction[]>();
  for (const row of params.rents) {
    if (!row.complexId) continue;
    const list = rentsByComplex.get(row.complexId);
    if (list) list.push(row);
    else rentsByComplex.set(row.complexId, [row]);
  }

  // (단지:면적구간) → 전세가율 시계열. 같은 구간을 여러 번 계산하지 않도록 캐시한다.
  const ratioCache = new Map<string, Array<{ month: string; ratioPct: number; jeonseMedianPpp: number; saleMedianPpp: number }>>();
  const ratioFor = (complexId: string, areaM2: number) => {
    const bucket = areaBucket(areaM2);
    const key = `${complexId}:${bucket}`;
    const cached = ratioCache.get(key);
    if (cached) return cached;
    const series = jeonseRatioSeries(
      rentsByComplex.get(complexId) ?? [],
      salesByComplex.get(complexId) ?? [],
      params.months,
      { complexId, areaM2: bucket },
    ).map((row) => ({
      month: row.month,
      ratioPct: row.ratioPct,
      jeonseMedianPpp: row.jeonseMedianPpp,
      saleMedianPpp: row.saleMedianPpp,
    }));
    ratioCache.set(key, series);
    return series;
  };
  const latestRatioAtOrBefore = (complexId: string, areaM2: number, month: string) => {
    const series = ratioFor(complexId, areaM2);
    for (let index = series.length - 1; index >= 0; index -= 1) {
      const row = series[index]!;
      if (row.month <= month && row.ratioPct > 0) return row;
    }
    return undefined;
  };

  const deals: RadarDeal[] = [];
  let scannedDeals = 0;
  let thinReferenceDeals = 0;
  let missingJeonseDeals = 0;
  let largeComplexes = 0;

  for (const complex of params.complexes) {
    if (complex.households >= LARGE_COMPLEX_HOUSEHOLDS) largeComplexes += 1;
    const sales = salesByComplex.get(complex.complexId) ?? [];
    if (sales.length === 0) continue;

    // (면적 구간) → 월 오름차순 거래. 기준 시세·유동성을 같은 배열에서 계산한다.
    const byBand = new Map<AreaBandKey, AptTransaction[]>();
    for (const row of sales) {
      const band = areaBandOf(row.areaM2);
      const list = byBand.get(band);
      if (list) list.push(row);
      else byBand.set(band, [row]);
    }

    for (const [band, rows] of byBand) {
      for (const deal of rows) {
        if (deal.dealMonth < lookbackStart) continue;
        if (params.months.length > 0 && deal.dealMonth > endMonth) continue;
        scannedDeals += 1;

        const referenceStart = shiftMonth(deal.dealMonth, -(referenceMonths - 1));
        const referenceRows = rows.filter(
          (row) =>
            row.dealHash !== deal.dealHash && row.dealMonth >= referenceStart && row.dealMonth <= deal.dealMonth,
        );
        if (referenceRows.length < minReferenceSamples) {
          thinReferenceDeals += 1;
          continue;
        }

        const medianPriceKrw = median(referenceRows.map((row) => row.priceKrw));
        if (medianPriceKrw <= 0) {
          thinReferenceDeals += 1;
          continue;
        }
        const discountPct = Number((((deal.priceKrw - medianPriceKrw) / medianPriceKrw) * 100).toFixed(1));

        const liquidityStart = shiftMonth(deal.dealMonth, -(liquidityMonths - 1));
        const volume3m = rows.filter(
          (row) => row.dealMonth >= liquidityStart && row.dealMonth <= deal.dealMonth,
        ).length;

        const ratioPoint = latestRatioAtOrBefore(complex.complexId, deal.areaM2, deal.dealMonth);
        if (!ratioPoint) missingJeonseDeals += 1;
        const jeonseRatioPct = ratioPoint?.ratioPct ?? null;
        const gapKrw =
          ratioPoint && ratioPoint.saleMedianPpp > 0
            ? Math.max(
                0,
                Math.round(
                  (ratioPoint.saleMedianPpp - ratioPoint.jeonseMedianPpp) * (deal.areaM2 / 3.305785),
                ),
              )
            : null;

        const { score, grade, signals } = scoreDeal({
          discountPct,
          jeonseRatioPct,
          volume3m,
          households: complex.households,
          dealType: deal.dealType,
        });

        const region = regionByDong.get(complex.legalDongCode);
        deals.push({
          dealHash: deal.dealHash,
          complexId: complex.complexId,
          complexName: complex.name,
          lawdCd: complex.lawdCd,
          sigungu: region?.sigungu ?? sigunguOf(complex.lawdCd),
          dong: region?.dong ?? deal.dong,
          households: complex.households,
          builtYear: complex.builtYear,
          areaM2: deal.areaM2,
          areaBand: band,
          floor: deal.floor,
          dealDate: deal.dealDate,
          dealMonth: deal.dealMonth,
          priceKrw: deal.priceKrw,
          pricePerPyeong: deal.pricePerPyeong,
          medianPriceKrw,
          medianPricePerPyeong: median(referenceRows.map((row) => row.pricePerPyeong)),
          referenceSamples: referenceRows.length,
          discountPct,
          jeonseRatioPct,
          gapKrw,
          volume3m,
          dealScore: score,
          grade,
          signals,
          dealType: deal.dealType,
          asOfMonth: deal.dealMonth,
        });
      }
    }
  }

  deals.sort((a, b) => b.dealScore - a.dealScore || a.discountPct - b.discountPct || b.dealDate.localeCompare(a.dealDate));

  return {
    deals,
    asOfMonth: endMonth,
    universe: {
      complexes: params.complexes.length,
      largeComplexes,
      scannedDeals,
      thinReferenceDeals,
      missingJeonseDeals,
    },
  };
}

export interface RadarFilter {
  lawdCds?: string[];
  /** 0이면 세대수 조건을 끈다. 기본 350. */
  minHouseholds?: number;
  areaBand?: AreaBandKey | 'all';
  /** 목표 할인율(%p). 8이면 -8% 이하만 남긴다. */
  maxDiscountPct?: number;
  minScore?: number;
  limit?: number;
  offset?: number;
}

export const DEFAULT_RADAR_FILTER = {
  minHouseholds: LARGE_COMPLEX_HOUSEHOLDS,
  maxDiscountPct: 8,
  minScore: 0,
} as const;

/** 레이더 필터 적용. 정렬은 점수 내림차순(같으면 할인율이 큰 순). */
export function filterRadarDeals(deals: RadarDeal[], filter: RadarFilter = {}): RadarDeal[] {
  const minHouseholds = filter.minHouseholds ?? DEFAULT_RADAR_FILTER.minHouseholds;
  const maxDiscountPct = filter.maxDiscountPct ?? DEFAULT_RADAR_FILTER.maxDiscountPct;
  const minScore = filter.minScore ?? DEFAULT_RADAR_FILTER.minScore;
  const areaBand = filter.areaBand ?? 'all';
  const lawdCds = filter.lawdCds && filter.lawdCds.length > 0 ? new Set(filter.lawdCds) : null;

  return deals
    .filter((deal) => (lawdCds ? lawdCds.has(deal.lawdCd) : true))
    .filter((deal) => (minHouseholds > 0 ? deal.households >= minHouseholds : true))
    .filter((deal) => matchesAreaBand(deal.areaM2, areaBand))
    .filter((deal) => deal.discountPct <= -maxDiscountPct)
    .filter((deal) => deal.dealScore >= minScore)
    .sort((a, b) => b.dealScore - a.dealScore || a.discountPct - b.discountPct || b.dealDate.localeCompare(a.dealDate));
}

export function paginateRadarDeals(deals: RadarDeal[], limit: number, offset: number): RadarDeal[] {
  return deals.slice(offset, offset + limit);
}

export interface RadarSummary {
  count: number;
  medianDiscountPct: number;
  medianScore: number;
  strongCount: number;
  complexCount: number;
  medianGapKrw: number;
  totalHouseholds: number;
  maxDiscountPct: number;
}

export function radarSummary(deals: RadarDeal[]): RadarSummary {
  const householdsByComplex = new Map<string, number>();
  for (const deal of deals) householdsByComplex.set(deal.complexId, deal.households);
  return {
    count: deals.length,
    medianDiscountPct: deals.length === 0 ? 0 : Number(median(deals.map((deal) => deal.discountPct)).toFixed(1)),
    medianScore: median(deals.map((deal) => deal.dealScore)),
    strongCount: deals.filter((deal) => deal.grade === 'strong').length,
    complexCount: householdsByComplex.size,
    medianGapKrw: median(deals.map((deal) => deal.gapKrw ?? 0).filter((value) => value > 0)),
    totalHouseholds: [...householdsByComplex.values()].reduce((sum, value) => sum + value, 0),
    maxDiscountPct: deals.length === 0 ? 0 : Math.min(...deals.map((deal) => deal.discountPct)),
  };
}

export const ALERT_CHANNELS: AlertChannel[] = ['kakao_alimtalk', 'webhook'];

export const ALERT_CHANNEL_LABEL: Record<AlertChannel, string> = {
  kakao_alimtalk: '카카오 알림톡',
  webhook: '웹훅(Slack·Discord)',
};

/** 사용자가 저장하는 알림 규칙의 기본값. 화면 폼과 API 검증이 같은 값을 쓴다. */
export const DEFAULT_ALERT_RULE: Omit<AlertRule, 'ruleId' | 'name' | 'createdAt'> = {
  lawdCds: ['26290'],
  minHouseholds: LARGE_COMPLEX_HOUSEHOLDS,
  areaBand: '60to85',
  maxDiscountPct: 8,
  minScore: DEAL_GRADE_THRESHOLDS.watch,
  channels: ['kakao_alimtalk'],
};

function channelLabel(channels: AlertChannel[]): string {
  return channels.map((channel) => ALERT_CHANNEL_LABEL[channel]).join(', ');
}

/** 규칙 설명 문장. 화면 조건 요약·알림 본문·웹훅 payload가 같은 문장을 쓴다. */
export function describeAlertRule(rule: AlertRule): string {
  const districts = rule.lawdCds.map((lawdCd) => sigunguOf(lawdCd)).join('·') || '전체 지역';
  const households = rule.minHouseholds > 0 ? `${rule.minHouseholds.toLocaleString('ko-KR')}세대 이상` : '세대수 무관';
  const score = rule.minScore > 0 ? ` · 점수 ${rule.minScore}점 이상` : '';
  return `${districts} · ${households} · ${areaBandLabel(rule.areaBand)} · 중위가 대비 -${rule.maxDiscountPct}% 이하${score}`;
}

export function normalizeAlertRule(draft: AlertRuleDraft, options: { ruleId: string; createdAt: string }): AlertRule {
  return {
    ruleId: options.ruleId,
    name: draft.name.trim().slice(0, 60),
    lawdCds: [...new Set(draft.lawdCds)],
    minHouseholds: draft.minHouseholds ?? LARGE_COMPLEX_HOUSEHOLDS,
    areaBand: draft.areaBand ?? DEFAULT_ALERT_RULE.areaBand,
    maxDiscountPct: draft.maxDiscountPct ?? DEFAULT_ALERT_RULE.maxDiscountPct,
    minScore: draft.minScore ?? DEFAULT_ALERT_RULE.minScore,
    channels: draft.channels && draft.channels.length > 0 ? [...new Set(draft.channels)] : ['kakao_alimtalk'],
    createdAt: options.createdAt,
  };
}

/** 규칙에 맞는 매물만 고른다(레이더 필터와 같은 함수를 쓴다). */
export function matchAlertRule(deals: RadarDeal[], rule: AlertRule): RadarDeal[] {
  return filterRadarDeals(deals, {
    lawdCds: rule.lawdCds,
    minHouseholds: rule.minHouseholds,
    areaBand: rule.areaBand,
    maxDiscountPct: rule.maxDiscountPct,
    minScore: rule.minScore,
  });
}

function dealLine(deal: RadarDeal): string {
  const discount = `${deal.discountPct.toFixed(1)}%`;
  return `${deal.complexName}(${deal.dong}) ${formatAreaM2AndPyeong(deal.areaM2)} ${Math.round(deal.priceKrw / 10000).toLocaleString('ko-KR')}만원 · ${discount}`;
}

export interface AlertPreviewOptions {
  /** 미리보기 기준 시각. 메시지에 찍힌다. */
  now?: string;
  /** 미리보기에 싣는 매물 수. 기본 3. */
  topN?: number;
  linkUrl?: string;
}

/**
 * 알림 미리보기.
 *
 * 실제 발송은 하지 않는다. 카카오 알림톡(SENS 템플릿)과 웹훅에 넣을 payload를 그대로 보여주고,
 * 같은 payload를 서버가 그대로 쓰도록 형태를 고정한다. 승인된 발신 프로필·템플릿 코드·웹훅 URL은
 * 배포 환경에서 정해지므로 여기서는 자리값(placeholder)으로 둔다.
 */
export function buildAlertPreview(rule: AlertRule, deals: RadarDeal[], options: AlertPreviewOptions = {}): AlertPreview {
  const matched = matchAlertRule(deals, rule);
  const topN = options.topN ?? 3;
  const top = matched.slice(0, topN);
  const now = options.now ?? new Date().toISOString();
  const condition = describeAlertRule(rule);
  const linkUrl = options.linkUrl ?? 'https://shye-seo.github.io/prop-data-hub/#radar';

  const lines = [
    `[${rule.name}]`,
    `조건에 맞는 매물 ${matched.length}건이 있습니다.`,
    condition,
    '',
    ...top.map((deal, index) => `${index + 1}. ${dealLine(deal)} (점수 ${deal.dealScore})`),
    matched.length > top.length ? `외 ${matched.length - top.length}건` : '',
  ].filter((line, index, list) => line !== '' || list[index - 1] !== '');

  const kakao = {
    channel: 'kakao_alimtalk' as const,
    provider: 'NAVER Cloud SENS',
    templateCode: 'PROP_RADAR_DEAL_01',
    templateName: '부산 350세대+ 급매 레이더',
    recipientType: 'phone',
    variables: {
      rule_name: rule.name,
      condition,
      matched_count: String(matched.length),
      top_deal: top[0] ? dealLine(top[0]) : '-',
      link: linkUrl,
    },
    message: lines.join('\n'),
    buttons: [{ type: 'WL', name: '레이더 열기', linkMobile: linkUrl, linkPc: linkUrl }],
  };

  const webhook = {
    channel: 'webhook' as const,
    method: 'POST' as const,
    url: 'https://hooks.example.com/prop-radar',
    headers: {
      'content-type': 'application/json',
      // 실제 발송 시 SENS·웹훅 서명은 배포 환경의 시크릿으로 만든다.
      'x-prop-radar-signature': 'sha256=<HMAC-SHA256(secret, body)>',
    },
    body: {
      type: 'radar.deal.matched',
      occurredAt: now,
      rule: {
        ruleId: rule.ruleId,
        name: rule.name,
        condition,
        channels: rule.channels,
      },
      matchedCount: matched.length,
      deals: top.map((deal) => ({
        dealHash: deal.dealHash,
        complexId: deal.complexId,
        complexName: deal.complexName,
        sigungu: deal.sigungu,
        dong: deal.dong,
        households: deal.households,
        areaM2: deal.areaM2,
        priceKrw: deal.priceKrw,
        medianPriceKrw: deal.medianPriceKrw,
        discountPct: deal.discountPct,
        jeonseRatioPct: deal.jeonseRatioPct,
        dealScore: deal.dealScore,
        grade: deal.grade,
        dealDate: deal.dealDate,
      })),
    },
  };

  return {
    rule,
    condition,
    matchedCount: matched.length,
    sample: top,
    channels: rule.channels.map((channel) => channelLabel([channel])),
    kakao,
    webhook,
    previewOnly: true,
    note: '미리보기입니다. 실제 알림톡 발송·웹훅 호출은 하지 않습니다. 승인된 템플릿 코드와 웹훅 URL은 배포 환경에서 설정합니다.',
  };
}
