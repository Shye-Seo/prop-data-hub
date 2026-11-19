import { createDealHash } from '../deal-hash';
import { pricePerPyeongKrw, recentMonths, shiftMonth } from '../metrics';
import { SOURCE_IDS } from '../constants';
import { SOURCE_CATALOG } from '../sources';
import type {
  ApartmentComplex,
  AptTransaction,
  DeadLetterEntry,
  MacroIndicator,
  PipelineRun,
  PipelineRunTask,
  Region,
} from '../types';

/**
 * 데모 데이터셋.
 *
 * 단지명·법정동·준공연도·세대수·대표 면적은 공개된 공동주택 기본정보와 실거래 단지 목록을 참고해 실제 값으로 두었다.
 * 거래 건별 금액·층·계약일은 화면과 지표 계산을 검증하기 위한 대표 표본으로, 실제 거래 내역이 아니다.
 * (실서비스에서는 이 자리에 국토교통부 실거래가 API 응답이 들어간다.)
 */
export const SAMPLE_END_MONTH = '2026-09';
export const SAMPLE_MONTHS = 24;

export const SAMPLE_REGIONS: Region[] = [
  { lawdCd: '26290', legalDongCode: '2629051000', sido: '부산광역시', sigungu: '남구', dong: '문현동' },
  { lawdCd: '26290', legalDongCode: '2629052000', sido: '부산광역시', sigungu: '남구', dong: '대연동' },
  { lawdCd: '26350', legalDongCode: '2635054000', sido: '부산광역시', sigungu: '해운대구', dong: '우동' },
];

export interface ComplexSeed {
  complexId: string;
  name: string;
  legalDongCode: string;
  lawdCd: string;
  builtYear: number;
  households: number;
  representativeAreaM2: number;
  /** 2026년 9월 기준 84㎡(또는 대표 면적) 대표 시세(원). */
  anchorPriceKrw: number;
  /** 최근 24개월 누적 변동률(%). 지역·단지 특성을 반영한 표본값. */
  trendPct: number;
  areaVariants: number[];
}

const COMPLEX_SEEDS: ComplexSeed[] = [
  {
    complexId: 'MOLIT-26290-001',
    name: '문현베스티움',
    legalDongCode: '2629051000',
    lawdCd: '26290',
    builtYear: 2019,
    households: 743,
    representativeAreaM2: 84.98,
    anchorPriceKrw: 628_000_000,
    trendPct: 3.6,
    areaVariants: [59.94, 84.98, 101.97],
  },
  {
    complexId: 'MOLIT-26290-002',
    name: '문현동삼성',
    legalDongCode: '2629051000',
    lawdCd: '26290',
    builtYear: 2001,
    households: 916,
    representativeAreaM2: 84.97,
    anchorPriceKrw: 410_000_000,
    trendPct: 2.1,
    areaVariants: [59.91, 84.97, 114.92],
  },
  {
    complexId: 'MOLIT-26290-003',
    name: '문현경동리인',
    legalDongCode: '2629051000',
    lawdCd: '26290',
    builtYear: 2020,
    households: 600,
    representativeAreaM2: 84.99,
    anchorPriceKrw: 478_000_000,
    trendPct: 4.8,
    areaVariants: [59.98, 84.99],
  },
  {
    complexId: 'MOLIT-26290-004',
    name: '오션파라곤',
    legalDongCode: '2629051000',
    lawdCd: '26290',
    builtYear: 2022,
    households: 662,
    representativeAreaM2: 59.98,
    anchorPriceKrw: 455_000_000,
    trendPct: 5.4,
    areaVariants: [59.98, 74.95],
  },
  {
    complexId: 'MOLIT-26290-005',
    name: '문현현대',
    legalDongCode: '2629051000',
    lawdCd: '26290',
    builtYear: 1998,
    households: 693,
    representativeAreaM2: 84.94,
    anchorPriceKrw: 269_000_000,
    trendPct: -1.2,
    areaVariants: [59.93, 84.94],
  },
  {
    complexId: 'MOLIT-26290-006',
    name: '대연롯데캐슬레전드',
    legalDongCode: '2629052000',
    lawdCd: '26290',
    builtYear: 2018,
    households: 3149,
    representativeAreaM2: 84.97,
    anchorPriceKrw: 810_000_000,
    trendPct: 2.9,
    areaVariants: [59.96, 84.97, 101.94],
  },
  {
    complexId: 'MOLIT-26290-007',
    name: '대연파크푸르지오',
    legalDongCode: '2629052000',
    lawdCd: '26290',
    builtYear: 2018,
    households: 1422,
    representativeAreaM2: 84.99,
    anchorPriceKrw: 599_000_000,
    trendPct: 1.4,
    areaVariants: [59.95, 84.99],
  },
  {
    complexId: 'MOLIT-26290-008',
    name: '대연SK뷰힐스',
    legalDongCode: '2629052000',
    lawdCd: '26290',
    builtYear: 2018,
    households: 994,
    representativeAreaM2: 84.96,
    anchorPriceKrw: 918_000_000,
    trendPct: 3.1,
    areaVariants: [59.92, 84.96, 99.91],
  },
  {
    complexId: 'MOLIT-26290-009',
    name: '대연푸르지오클라센트',
    legalDongCode: '2629052000',
    lawdCd: '26290',
    builtYear: 2024,
    households: 1057,
    representativeAreaM2: 84.98,
    anchorPriceKrw: 720_000_000,
    trendPct: 6.2,
    areaVariants: [59.94, 84.98],
  },
  {
    complexId: 'MOLIT-26350-001',
    name: '해운대두산위브더제니스',
    legalDongCode: '2635054000',
    lawdCd: '26350',
    builtYear: 2011,
    households: 1683,
    representativeAreaM2: 84.98,
    anchorPriceKrw: 900_000_000,
    trendPct: 1.8,
    areaVariants: [59.97, 84.98, 126.93],
  },
  {
    complexId: 'MOLIT-26350-002',
    name: '해운대아이파크',
    legalDongCode: '2635054000',
    lawdCd: '26350',
    builtYear: 2007,
    households: 1631,
    representativeAreaM2: 84.99,
    anchorPriceKrw: 1_050_000_000,
    trendPct: 2.4,
    areaVariants: [59.99, 84.99, 132.94],
  },
  {
    complexId: 'MOLIT-26350-003',
    name: '센텀동부센트레빌',
    legalDongCode: '2635054000',
    lawdCd: '26350',
    builtYear: 2007,
    households: 596,
    representativeAreaM2: 84.97,
    anchorPriceKrw: 800_000_000,
    trendPct: 0.7,
    areaVariants: [59.95, 84.97],
  },
];

export const SAMPLE_COMPLEXES: ApartmentComplex[] = COMPLEX_SEEDS.map((seed) => ({
  complexId: seed.complexId,
  name: seed.name,
  legalDongCode: seed.legalDongCode,
  lawdCd: seed.lawdCd,
  builtYear: seed.builtYear,
  households: seed.households,
  representativeAreaM2: seed.representativeAreaM2,
}));

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function jitter(rand: () => number, ratio: number): number {
  return 1 + (rand() * 2 - 1) * ratio;
}

/** 평형별 평당가 보정: 소형은 평당가가 높고 대형은 낮은 경향을 반영한다. */
function areaFactor(areaM2: number, representativeAreaM2: number): number {
  const ratio = areaM2 / representativeAreaM2;
  return 1 + (1 - ratio) * 0.18;
}

export function buildSampleTransactions(endMonth = SAMPLE_END_MONTH, months = SAMPLE_MONTHS): AptTransaction[] {
  const monthList = recentMonths(endMonth, months);
  const transactions: AptTransaction[] = [];

  for (const seed of COMPLEX_SEEDS) {
    const monthlyTrend = Math.pow(1 + seed.trendPct / 100, 1 / months) - 1;
    const anchorPpp = seed.anchorPriceKrw / (seed.representativeAreaM2 / 3.305785);

    monthList.forEach((month, monthIndex) => {
      const rand = mulberry32(seedFromString(`${seed.complexId}:${month}`));
      const drift = Math.pow(1 + monthlyTrend, monthIndex);
      const seasonal = 1 + Math.sin((monthIndex / 12) * Math.PI * 2) * 0.012;
      const volume = 2 + Math.floor(rand() * 3);

      for (let i = 0; i < volume; i += 1) {
        const areaM2 = seed.areaVariants[Math.floor(rand() * seed.areaVariants.length)] ?? seed.representativeAreaM2;
        const ppp = anchorPpp * drift * seasonal * areaFactor(areaM2, seed.representativeAreaM2) * jitter(rand, 0.035);
        const priceKrw = Math.round((ppp * (areaM2 / 3.305785)) / 10_000) * 10_000;
        const day = 2 + Math.floor(rand() * 26);
        const floor = 1 + Math.floor(rand() * 24);
        const dealDate = `${month}-${String(day).padStart(2, '0')}`;
        const dong = SAMPLE_REGIONS.find((region) => region.legalDongCode === seed.legalDongCode)?.dong ?? '';
        const canceled = rand() < 0.012;

        transactions.push({
          dealHash: createDealHash({
            lawdCd: seed.lawdCd,
            aptName: seed.name,
            legalDongCode: seed.legalDongCode,
            jibun: '',
            builtYear: seed.builtYear,
            dealDate,
            floor,
            areaM2,
            priceKrw,
            dealType: rand() < 0.12 ? '직거래' : '중개거래',
          }),
          lawdCd: seed.lawdCd,
          legalDongCode: seed.legalDongCode,
          dong,
          aptName: seed.name,
          complexId: seed.complexId,
          jibun: '',
          builtYear: seed.builtYear,
          dealMonth: month,
          dealDate,
          floor,
          areaM2: Number(areaM2.toFixed(2)),
          priceKrw,
          pricePerPyeong: pricePerPyeongKrw(priceKrw, areaM2),
          dealType: rand() < 0.12 ? '직거래' : '중개거래',
          canceled,
          sourceId: SOURCE_IDS.molitAptTrade,
          asOfDate: `${month}-01`,
          collectedAt: `${month}-28T02:10:00.000Z`,
          sourceNote: canceled ? 'contract_canceled' : null,
        });
      }
    });
  }

  return transactions.sort((a, b) => b.dealDate.localeCompare(a.dealDate));
}

export function buildSampleMacro(endMonth = SAMPLE_END_MONTH, months = SAMPLE_MONTHS): MacroIndicator[] {
  const monthList = recentMonths(endMonth, months);
  const indicators: MacroIndicator[] = [];
  const baseRatePath = [3.5, 3.5, 3.25, 3.25, 3.0, 3.0, 2.75, 2.75, 2.5, 2.5, 2.25, 2.25];

  monthList.forEach((month, index) => {
    const [yearText, monthText] = month.split('-');
    const year = Number(yearText);
    const monthNumber = Number(monthText);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const periodDate = `${month}-${String(lastDay).padStart(2, '0')}`;
    const base = baseRatePath[Math.min(baseRatePath.length - 1, Math.floor(index / 2))] ?? 2.5;
    const mortgage = Number((base + 1.62 + Math.sin(index / 3) * 0.18).toFixed(2));
    const cpi = Number((112.4 + index * 0.28 + Math.sin(index / 2) * 0.15).toFixed(2));

    indicators.push(
      {
        indicatorCode: 'base_rate',
        indicatorName: '한국은행 기준금리',
        periodDate,
        period: month,
        value: base,
        unit: '연%',
        sourceId: SOURCE_IDS.ecosRates,
        asOfDate: periodDate,
        collectedAt: `${month}-28T01:40:00.000Z`,
      },
      {
        indicatorCode: 'mortgage_rate',
        indicatorName: '주택담보대출 금리(예금은행)',
        periodDate,
        period: month,
        value: mortgage,
        unit: '연%',
        sourceId: SOURCE_IDS.ecosRates,
        asOfDate: periodDate,
        collectedAt: `${month}-28T01:40:00.000Z`,
      },
      {
        indicatorCode: 'cpi',
        indicatorName: '소비자물가지수(2020=100)',
        periodDate,
        period: month,
        value: cpi,
        unit: '2020=100',
        sourceId: SOURCE_IDS.ecosCpi,
        asOfDate: periodDate,
        collectedAt: `${month}-28T01:40:00.000Z`,
      },
    );
  });

  return indicators;
}

export function buildSamplePipelineRuns(): PipelineRun[] {
  const runs: PipelineRun[] = [
    {
      runId: 'run_20261118_0200_molit',
      sourceId: SOURCE_IDS.molitAptTrade,
      jobType: 'incremental',
      status: 'partial',
      startedAt: '2026-11-18T02:00:04.000Z',
      finishedAt: '2026-11-18T02:04:51.000Z',
      requestedMonths: 2,
      taskTotal: 6,
      taskSucceeded: 5,
      taskFailed: 1,
      recordsUpserted: 1842,
      recordsSkipped: 12,
      retryCount: 3,
      errorSummary: '26350/2026-09 HTTP 504 (재시도 3회 후 DLQ 적재)',
      triggeredBy: 'eventbridge-scheduler',
    },
    {
      runId: 'run_20261118_0315_ecos',
      sourceId: SOURCE_IDS.ecosRates,
      jobType: 'incremental',
      status: 'succeeded',
      startedAt: '2026-11-18T03:15:00.000Z',
      finishedAt: '2026-11-18T03:15:22.000Z',
      requestedMonths: 24,
      taskTotal: 1,
      taskSucceeded: 1,
      taskFailed: 0,
      recordsUpserted: 24,
      recordsSkipped: 0,
      retryCount: 0,
      errorSummary: null,
      triggeredBy: 'eventbridge-scheduler',
    },
    {
      runId: 'run_20261117_0200_molit',
      sourceId: SOURCE_IDS.molitAptTrade,
      jobType: 'incremental',
      status: 'succeeded',
      startedAt: '2026-11-17T02:00:03.000Z',
      finishedAt: '2026-11-17T02:03:40.000Z',
      requestedMonths: 2,
      taskTotal: 6,
      taskSucceeded: 6,
      taskFailed: 0,
      recordsUpserted: 1904,
      recordsSkipped: 0,
      retryCount: 1,
      errorSummary: null,
      triggeredBy: 'eventbridge-scheduler',
    },
    {
      runId: 'run_20261116_0200_molit',
      sourceId: SOURCE_IDS.molitAptTrade,
      jobType: 'incremental',
      status: 'failed',
      startedAt: '2026-11-16T02:00:02.000Z',
      finishedAt: '2026-11-16T02:00:59.000Z',
      requestedMonths: 2,
      taskTotal: 6,
      taskSucceeded: 0,
      taskFailed: 6,
      recordsUpserted: 0,
      recordsSkipped: 0,
      retryCount: 0,
      errorSummary: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR (인증키 만료 의심)',
      triggeredBy: 'eventbridge-scheduler',
    },
    {
      runId: 'run_20261115_1400_backfill',
      sourceId: SOURCE_IDS.molitAptTrade,
      jobType: 'backfill',
      status: 'succeeded',
      startedAt: '2026-11-15T14:00:00.000Z',
      finishedAt: '2026-11-15T14:42:18.000Z',
      requestedMonths: 24,
      taskTotal: 72,
      taskSucceeded: 72,
      taskFailed: 0,
      recordsUpserted: 21466,
      recordsSkipped: 88,
      retryCount: 6,
      errorSummary: null,
      triggeredBy: 'manual:operator',
    },
    {
      runId: 'run_20261118_0340_cpi',
      sourceId: SOURCE_IDS.ecosCpi,
      jobType: 'incremental',
      status: 'succeeded',
      startedAt: '2026-11-18T03:40:00.000Z',
      finishedAt: '2026-11-18T03:40:11.000Z',
      requestedMonths: 24,
      taskTotal: 1,
      taskSucceeded: 1,
      taskFailed: 0,
      recordsUpserted: 24,
      recordsSkipped: 0,
      retryCount: 0,
      errorSummary: null,
      triggeredBy: 'eventbridge-scheduler',
    },
  ];
  return runs;
}

export function buildSampleRunTasks(): PipelineRunTask[] {
  const tasks: PipelineRunTask[] = [];
  const partialRun = 'run_20261118_0200_molit';
  const periods = ['2026-09', '2026-08'];
  const lawds = ['26290', '26350', '26110'];
  periods.forEach((period) => {
    lawds.forEach((lawdCd) => {
      const failed = lawdCd === '26350' && period === '2026-09';
      tasks.push({
        runId: partialRun,
        sourceId: SOURCE_IDS.molitAptTrade,
        lawdCd,
        period,
        status: failed ? 'failed' : 'succeeded',
        attempts: failed ? 4 : 1,
        records: failed ? 0 : 300 + Number(lawdCd.slice(-2)),
        error: failed ? 'HTTP 504 Gateway Timeout' : null,
        updatedAt: '2026-11-18T02:04:51.000Z',
      });
    });
  });
  return tasks;
}

export function buildSampleDeadLetters(): DeadLetterEntry[] {
  return [
    {
      id: 'dlq_0001',
      runId: 'run_20261118_0200_molit',
      sourceId: SOURCE_IDS.molitAptTrade,
      payload: { lawdCd: '26350', dealMonth: '2026-09', pageNo: 1, numOfRows: 100 },
      error: 'HTTP 504 Gateway Timeout',
      attempts: 4,
      nextRetryAt: '2026-11-18T02:20:00.000Z',
      resolvedAt: null,
    },
    {
      id: 'dlq_0002',
      runId: 'run_20261116_0200_molit',
      sourceId: SOURCE_IDS.molitAptTrade,
      payload: { lawdCd: '26290', dealMonth: '2026-09', pageNo: 1, numOfRows: 100 },
      error: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR',
      attempts: 4,
      nextRetryAt: '2026-11-16T03:00:00.000Z',
      resolvedAt: '2026-11-17T02:02:00.000Z',
    },
  ];
}

export interface SampleDataset {
  regions: Region[];
  complexes: ApartmentComplex[];
  transactions: AptTransaction[];
  macro: MacroIndicator[];
  pipelineRuns: PipelineRun[];
  runTasks: PipelineRunTask[];
  deadLetters: DeadLetterEntry[];
  sources: typeof SOURCE_CATALOG;
}

export function buildSampleDataset(): SampleDataset {
  return {
    regions: SAMPLE_REGIONS,
    complexes: SAMPLE_COMPLEXES,
    transactions: buildSampleTransactions(),
    macro: buildSampleMacro(),
    pipelineRuns: buildSamplePipelineRuns(),
    runTasks: buildSampleRunTasks(),
    deadLetters: buildSampleDeadLetters(),
    sources: SOURCE_CATALOG,
  };
}

export function sampleComplexSeed(complexId: string): ComplexSeed | undefined {
  return COMPLEX_SEEDS.find((seed) => seed.complexId === complexId);
}

/** 데모 화면의 필터 기본값. 2026-09 이후 최근 12개월. */
export const DEFAULT_DEMO_RANGE = {
  endMonth: SAMPLE_END_MONTH,
  startMonth: shiftMonth(SAMPLE_END_MONTH, -11),
};
