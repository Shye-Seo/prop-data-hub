import { createDealHash } from '../deal-hash';
import { pricePerPyeongKrw, recentMonths, shiftMonth } from '../metrics';
import { createRentHash } from '../normalize/molit-rent';
import { SOURCE_IDS } from '../constants';
import { SOURCE_CATALOG } from '../sources';
import type {
  ApartmentComplex,
  AptRentTransaction,
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
 * 단지명·법정동·준공연도·세대수·대표 면적은 공개된 공동주택 기본정보(K-apt·공동주택 기본정보)와 실거래 단지 목록을 참고해 실제 값으로 두었다.
 * 대상은 부산 6개 구(부산진구·동래구·남구·해운대구·연제구·수영구)이고, 350세대 미만 단지도 일부 넣어 레이더 세대수 필터를 검증한다.
 * 거래 건별 금액·층·계약일은 화면과 지표 계산을 검증하기 위한 대표 표본으로, 실제 거래 내역이 아니다.
 * (실서비스에서는 이 자리에 국토교통부 실거래가 API 응답이 들어간다.)
 */
export const SAMPLE_END_MONTH = '2026-09';
export const SAMPLE_MONTHS = 24;

/**
 * 지역 마스터 표본.
 * 법정동 10자리 코드는 행정표준코드관리시스템의 법정동 코드 목록을 기준으로 넣었습니다(2026-11 확인).
 * 실서비스에서는 국토교통부 법정동코드 파일을 그대로 적재하는 자리입니다.
 */
export const SAMPLE_REGIONS: Region[] = [
  { lawdCd: '26230', legalDongCode: '2623010300', sido: '부산광역시', sigungu: '부산진구', dong: '부전동' },
  { lawdCd: '26230', legalDongCode: '2623010200', sido: '부산광역시', sigungu: '부산진구', dong: '전포동' },
  { lawdCd: '26230', legalDongCode: '2623010100', sido: '부산광역시', sigungu: '부산진구', dong: '양정동' },
  { lawdCd: '26230', legalDongCode: '2623010800', sido: '부산광역시', sigungu: '부산진구', dong: '부암동' },
  { lawdCd: '26230', legalDongCode: '2623011000', sido: '부산광역시', sigungu: '부산진구', dong: '가야동' },
  { lawdCd: '26260', legalDongCode: '2626010800', sido: '부산광역시', sigungu: '동래구', dong: '온천동' },
  { lawdCd: '26260', legalDongCode: '2626010900', sido: '부산광역시', sigungu: '동래구', dong: '사직동' },
  { lawdCd: '26260', legalDongCode: '2626010700', sido: '부산광역시', sigungu: '동래구', dong: '명륜동' },
  { lawdCd: '26290', legalDongCode: '2629010900', sido: '부산광역시', sigungu: '남구', dong: '문현동' },
  { lawdCd: '26290', legalDongCode: '2629010600', sido: '부산광역시', sigungu: '남구', dong: '대연동' },
  { lawdCd: '26350', legalDongCode: '2635010500', sido: '부산광역시', sigungu: '해운대구', dong: '우동' },
  { lawdCd: '26470', legalDongCode: '2647010200', sido: '부산광역시', sigungu: '연제구', dong: '연산동' },
  { lawdCd: '26470', legalDongCode: '2647010100', sido: '부산광역시', sigungu: '연제구', dong: '거제동' },
  { lawdCd: '26500', legalDongCode: '2650010400', sido: '부산광역시', sigungu: '수영구', dong: '광안동' },
  { lawdCd: '26500', legalDongCode: '2650010500', sido: '부산광역시', sigungu: '수영구', dong: '남천동' },
  { lawdCd: '26500', legalDongCode: '2650010300', sido: '부산광역시', sigungu: '수영구', dong: '민락동' },
];

/** 구(시군구) 단위 비교 뷰에서 쓰는 대상. 레이더 대상 6개 구를 같은 축에서 비교한다. */
export const SAMPLE_SIGUNGU = [
  { lawdCd: '26230', sigungu: '부산진구' },
  { lawdCd: '26260', sigungu: '동래구' },
  { lawdCd: '26290', sigungu: '남구' },
  { lawdCd: '26350', sigungu: '해운대구' },
  { lawdCd: '26470', sigungu: '연제구' },
  { lawdCd: '26500', sigungu: '수영구' },
] as const;

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
  /** 최근월 매매가 대비 전세가율(%). 전월세 표본을 만들 때 기준값으로 쓴다. */
  jeonseRatioPct: number;
  /** 최근 6개월에만 적용하는 추가 하락률(%). 급락 신호를 재현할 때 쓴다. */
  recentDropPct?: number;
  /** 의도적으로 넣는 이상 거래 표본. 해당 월 첫 거래 금액에 배수를 곱한다. */
  anomalies?: Array<{ month: string; factor: number }>;
  /**
   * 의도적으로 넣는 급매 표본. 해당 월 두 번째 거래 금액에 배수를 곱한다.
   * 레이더(중위가 대비 할인) 화면을 검증하려면 정상 분포에서 -8~-12% 벗어난 거래가 필요하다.
   * 이상 거래(anomalies)와 달리 -14%를 넘지 않게 두어 '급락' 배지와 섞이지 않는다.
   */
  bargains?: Array<{ month: string; factor: number; areaM2?: number }>;
}

const COMPLEX_SEEDS: ComplexSeed[] = [
  {
    complexId: 'MOLIT-26290-001',
    name: '문현베스티움',
    legalDongCode: '2629010900',
    lawdCd: '26290',
    builtYear: 2019,
    households: 743,
    representativeAreaM2: 84.98,
    anchorPriceKrw: 628_000_000,
    trendPct: 3.6,
    areaVariants: [59.94, 84.98, 101.97],
    jeonseRatioPct: 69,
  },
  {
    complexId: 'MOLIT-26290-002',
    name: '문현동삼성',
    legalDongCode: '2629010900',
    lawdCd: '26290',
    builtYear: 2001,
    households: 916,
    representativeAreaM2: 84.97,
    anchorPriceKrw: 410_000_000,
    trendPct: 2.1,
    areaVariants: [59.91, 84.97, 114.92],
    jeonseRatioPct: 71,
    anomalies: [{ month: '2026-07', factor: 0.84 }],
  },
  {
    complexId: 'MOLIT-26290-003',
    name: '문현경동리인',
    legalDongCode: '2629010900',
    lawdCd: '26290',
    builtYear: 2020,
    households: 600,
    representativeAreaM2: 84.99,
    anchorPriceKrw: 478_000_000,
    trendPct: 4.8,
    areaVariants: [59.98, 84.99],
    jeonseRatioPct: 67,
  },
  {
    complexId: 'MOLIT-26290-004',
    name: '오션파라곤',
    legalDongCode: '2629010900',
    lawdCd: '26290',
    builtYear: 2022,
    households: 662,
    representativeAreaM2: 59.98,
    anchorPriceKrw: 455_000_000,
    trendPct: 5.4,
    areaVariants: [59.98, 74.95],
    jeonseRatioPct: 78,
  },
  {
    complexId: 'MOLIT-26290-005',
    name: '문현현대',
    legalDongCode: '2629010900',
    lawdCd: '26290',
    builtYear: 1998,
    households: 693,
    representativeAreaM2: 84.94,
    anchorPriceKrw: 269_000_000,
    trendPct: -2.4,
    areaVariants: [59.93, 84.94],
    jeonseRatioPct: 82,
    recentDropPct: -7,
    anomalies: [{ month: '2026-08', factor: 0.87 }],
  },
  {
    complexId: 'MOLIT-26290-006',
    name: '대연롯데캐슬레전드',
    legalDongCode: '2629010600',
    lawdCd: '26290',
    builtYear: 2018,
    households: 3149,
    representativeAreaM2: 84.97,
    anchorPriceKrw: 810_000_000,
    trendPct: 2.9,
    areaVariants: [59.96, 84.97, 101.94],
    jeonseRatioPct: 64,
  },
  {
    complexId: 'MOLIT-26290-007',
    name: '대연파크푸르지오',
    legalDongCode: '2629010600',
    lawdCd: '26290',
    builtYear: 2018,
    households: 1422,
    representativeAreaM2: 84.99,
    anchorPriceKrw: 599_000_000,
    trendPct: 1.4,
    areaVariants: [59.95, 84.99],
    jeonseRatioPct: 68,
  },
  {
    complexId: 'MOLIT-26290-008',
    name: '대연SK뷰힐스',
    legalDongCode: '2629010600',
    lawdCd: '26290',
    builtYear: 2018,
    households: 994,
    representativeAreaM2: 84.96,
    anchorPriceKrw: 918_000_000,
    trendPct: 3.1,
    areaVariants: [59.92, 84.96, 99.91],
    jeonseRatioPct: 62,
    anomalies: [{ month: '2026-06', factor: 0.79 }],
  },
  {
    complexId: 'MOLIT-26290-009',
    name: '대연푸르지오클라센트',
    legalDongCode: '2629010600',
    lawdCd: '26290',
    builtYear: 2024,
    households: 1057,
    representativeAreaM2: 84.98,
    anchorPriceKrw: 720_000_000,
    trendPct: 6.2,
    areaVariants: [59.94, 84.98],
    jeonseRatioPct: 89,
  },
  {
    complexId: 'MOLIT-26350-001',
    name: '해운대두산위브더제니스',
    legalDongCode: '2635010500',
    lawdCd: '26350',
    builtYear: 2011,
    households: 1683,
    representativeAreaM2: 84.98,
    anchorPriceKrw: 900_000_000,
    trendPct: 1.8,
    areaVariants: [59.97, 84.98, 126.93],
    jeonseRatioPct: 66,
    bargains: [
      { month: '2026-08', factor: 0.9 },
      { month: '2026-09', factor: 0.915 },
    ],
  },
  {
    complexId: 'MOLIT-26350-002',
    name: '해운대아이파크',
    legalDongCode: '2635010500',
    lawdCd: '26350',
    builtYear: 2007,
    households: 1631,
    representativeAreaM2: 84.99,
    anchorPriceKrw: 1_050_000_000,
    trendPct: 2.4,
    areaVariants: [59.99, 84.99, 132.94],
    jeonseRatioPct: 65,
    anomalies: [{ month: '2026-08', factor: 1.16 }],
  },
  {
    complexId: 'MOLIT-26350-003',
    name: '센텀동부센트레빌',
    legalDongCode: '2635010500',
    lawdCd: '26350',
    builtYear: 2007,
    households: 596,
    representativeAreaM2: 84.97,
    anchorPriceKrw: 800_000_000,
    trendPct: 0.7,
    areaVariants: [59.95, 84.97],
    jeonseRatioPct: 70,
  },
  {
    complexId: 'MOLIT-26500-001',
    name: '광안자이',
    legalDongCode: '2650010400',
    lawdCd: '26500',
    builtYear: 2020,
    households: 971,
    representativeAreaM2: 84.93,
    anchorPriceKrw: 770_000_000,
    trendPct: 3.4,
    areaVariants: [59.92, 84.93, 99.98],
    jeonseRatioPct: 68,
    bargains: [{ month: '2026-09', factor: 0.9 }],
  },
  {
    complexId: 'MOLIT-26500-002',
    name: '삼익비치타운',
    legalDongCode: '2650010500',
    lawdCd: '26500',
    builtYear: 1979,
    households: 3060,
    representativeAreaM2: 84.9,
    anchorPriceKrw: 468_000_000,
    trendPct: -0.9,
    areaVariants: [59.88, 84.9, 111.95],
    jeonseRatioPct: 84,
    recentDropPct: -4.5,
  },
  {
    complexId: 'MOLIT-26500-003',
    name: '센텀비치푸르지오',
    legalDongCode: '2650010300',
    lawdCd: '26500',
    builtYear: 2003,
    households: 1082,
    representativeAreaM2: 84.96,
    anchorPriceKrw: 565_000_000,
    trendPct: 1.2,
    areaVariants: [59.94, 84.96, 101.92],
    jeonseRatioPct: 77,
  },
  {
    complexId: 'MOLIT-26500-004',
    name: '부산더샵센텀포레',
    legalDongCode: '2650010300',
    lawdCd: '26500',
    builtYear: 2014,
    households: 1006,
    representativeAreaM2: 84.98,
    anchorPriceKrw: 925_000_000,
    trendPct: 2.2,
    areaVariants: [59.97, 84.98, 101.95],
    jeonseRatioPct: 73,
  },
  // 부산진구(26230). 서면·양정·가야 축의 대단지와 350세대 미만 단지를 섞어 레이더 토글을 검증한다.
  {
    complexId: 'MOLIT-26230-001',
    name: '양정자이더샵SK뷰',
    legalDongCode: '2623010100',
    lawdCd: '26230',
    builtYear: 2025,
    households: 2276,
    representativeAreaM2: 84.95,
    anchorPriceKrw: 750_000_000,
    trendPct: 4.2,
    areaVariants: [59.94, 84.95, 101.9],
    jeonseRatioPct: 66,
  },
  {
    complexId: 'MOLIT-26230-002',
    name: '서면아이파크',
    legalDongCode: '2623010200',
    lawdCd: '26230',
    builtYear: 2020,
    households: 2144,
    representativeAreaM2: 84.97,
    anchorPriceKrw: 700_000_000,
    trendPct: 2.8,
    areaVariants: [59.96, 84.97, 121.9],
    jeonseRatioPct: 64,
    bargains: [
      { month: '2026-08', factor: 0.905 },
      { month: '2026-09', factor: 0.885 },
    ],
  },
  {
    complexId: 'MOLIT-26230-003',
    name: '롯데캐슬라센트',
    legalDongCode: '2623010800',
    lawdCd: '26230',
    builtYear: 2025,
    households: 2195,
    representativeAreaM2: 84.98,
    anchorPriceKrw: 548_000_000,
    trendPct: 5.1,
    areaVariants: [59.98, 84.98, 99.91],
    jeonseRatioPct: 70,
    bargains: [{ month: '2026-07', factor: 0.9 }],
  },
  {
    complexId: 'MOLIT-26230-004',
    name: '가야벽산',
    legalDongCode: '2623011000',
    lawdCd: '26230',
    builtYear: 1991,
    households: 1772,
    representativeAreaM2: 84.9,
    anchorPriceKrw: 226_000_000,
    trendPct: -1.6,
    areaVariants: [59.9, 84.9, 134.9],
    jeonseRatioPct: 84,
    recentDropPct: -5,
    bargains: [{ month: '2026-09', factor: 0.9 }],
  },
  {
    complexId: 'MOLIT-26230-006',
    name: '서면센트럴스타',
    legalDongCode: '2623010300',
    lawdCd: '26230',
    builtYear: 2011,
    households: 1360,
    representativeAreaM2: 84.9,
    anchorPriceKrw: 620_000_000,
    trendPct: 1.1,
    areaVariants: [59.9, 84.9, 129.9],
    jeonseRatioPct: 72,
    bargains: [{ month: '2026-08', factor: 0.9 }],
  },
  {
    complexId: 'MOLIT-26230-005',
    name: '가야KTe편한세상',
    legalDongCode: '2623011000',
    lawdCd: '26230',
    builtYear: 2006,
    households: 299,
    representativeAreaM2: 84.96,
    anchorPriceKrw: 470_000_000,
    trendPct: 1.2,
    areaVariants: [59.95, 84.96],
    jeonseRatioPct: 72,
    // 350세대 미만 + 큰 할인. 세대수 토글이 실제로 이 단지를 빼는지 확인하는 표본이다.
    bargains: [{ month: '2026-09', factor: 0.87 }],
  },
  // 동래구(26260). 온천·사직 축 대단지와 350세대 미만 단지.
  {
    complexId: 'MOLIT-26260-001',
    name: '래미안포레스티지',
    legalDongCode: '2626010800',
    lawdCd: '26260',
    builtYear: 2024,
    households: 4043,
    representativeAreaM2: 84.95,
    anchorPriceKrw: 900_000_000,
    trendPct: 3.4,
    areaVariants: [59.93, 84.95, 101.9],
    jeonseRatioPct: 63,
  },
  {
    complexId: 'MOLIT-26260-002',
    name: '동래래미안아이파크',
    legalDongCode: '2626010800',
    lawdCd: '26260',
    builtYear: 2021,
    households: 3853,
    representativeAreaM2: 84.96,
    anchorPriceKrw: 860_000_000,
    trendPct: 2.6,
    areaVariants: [59.94, 84.96, 114.9],
    jeonseRatioPct: 65,
    bargains: [{ month: '2026-08', factor: 0.91 }],
  },
  {
    complexId: 'MOLIT-26260-003',
    name: '사직쌍용예가',
    legalDongCode: '2626010900',
    lawdCd: '26260',
    builtYear: 2006,
    households: 2947,
    representativeAreaM2: 84.9,
    anchorPriceKrw: 600_000_000,
    trendPct: 0.8,
    areaVariants: [59.9, 84.9, 134.9],
    jeonseRatioPct: 74,
    bargains: [
      { month: '2026-08', factor: 0.9 },
      { month: '2026-09', factor: 0.875 },
    ],
  },
  {
    complexId: 'MOLIT-26260-004',
    name: '사직KCC스위첸',
    legalDongCode: '2626010900',
    lawdCd: '26260',
    builtYear: 2016,
    households: 999,
    representativeAreaM2: 84.97,
    anchorPriceKrw: 560_000_000,
    trendPct: 1.9,
    areaVariants: [59.96, 84.97],
    jeonseRatioPct: 71,
    bargains: [{ month: '2026-07', factor: 0.905 }],
  },
  {
    complexId: 'MOLIT-26260-005',
    name: '동래SK뷰1차',
    legalDongCode: '2626010800',
    lawdCd: '26260',
    builtYear: 2006,
    households: 342,
    representativeAreaM2: 84.92,
    anchorPriceKrw: 430_000_000,
    trendPct: 0.4,
    areaVariants: [59.9, 84.92, 107.9],
    jeonseRatioPct: 76,
    bargains: [{ month: '2026-09', factor: 0.86 }],
  },
  {
    complexId: 'MOLIT-26260-006',
    name: '명륜자이',
    legalDongCode: '2626010700',
    lawdCd: '26260',
    builtYear: 2016,
    households: 671,
    representativeAreaM2: 84.95,
    anchorPriceKrw: 550_000_000,
    trendPct: 1.5,
    areaVariants: [59.94, 84.95],
    jeonseRatioPct: 73,
  },
  // 연제구(26470). 연산·거제 축.
  {
    complexId: 'MOLIT-26470-001',
    name: '더샵파크시티',
    legalDongCode: '2647010200',
    lawdCd: '26470',
    builtYear: 2015,
    households: 1758,
    representativeAreaM2: 84.96,
    anchorPriceKrw: 625_000_000,
    trendPct: 2.2,
    areaVariants: [59.95, 84.96, 99.9],
    jeonseRatioPct: 69,
    bargains: [{ month: '2026-08', factor: 0.895 }],
  },
  {
    complexId: 'MOLIT-26470-002',
    name: '연산롯데캐슬골드포레',
    legalDongCode: '2647010200',
    lawdCd: '26470',
    builtYear: 2020,
    households: 1230,
    representativeAreaM2: 84.98,
    anchorPriceKrw: 767_000_000,
    trendPct: 3.8,
    areaVariants: [59.97, 84.98, 101.9],
    jeonseRatioPct: 66,
  },
  {
    complexId: 'MOLIT-26470-003',
    name: '거제동월드메르디앙',
    legalDongCode: '2647010100',
    lawdCd: '26470',
    builtYear: 2005,
    households: 1156,
    representativeAreaM2: 84.93,
    anchorPriceKrw: 620_000_000,
    trendPct: 0.6,
    areaVariants: [59.92, 84.93, 134.9],
    jeonseRatioPct: 75,
    bargains: [{ month: '2026-09', factor: 0.89 }],
  },
  {
    complexId: 'MOLIT-26470-004',
    name: '아시아드코오롱하늘채',
    legalDongCode: '2647010100',
    lawdCd: '26470',
    builtYear: 2019,
    households: 660,
    representativeAreaM2: 84.99,
    anchorPriceKrw: 940_000_000,
    trendPct: 2.9,
    areaVariants: [84.99, 114.9],
    jeonseRatioPct: 62,
  },
  {
    complexId: 'MOLIT-26470-005',
    name: '연산SK뷰1단지',
    legalDongCode: '2647010200',
    lawdCd: '26470',
    builtYear: 2006,
    households: 329,
    representativeAreaM2: 84.88,
    anchorPriceKrw: 379_000_000,
    trendPct: 0.3,
    areaVariants: [59.9, 84.88],
    jeonseRatioPct: 77,
    bargains: [{ month: '2026-09', factor: 0.88 }],
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

/**
 * 표본 면적을 고른다. 대표 면적 비중을 높게 두는 이유는, 전세가율·가격 추이를 같은 면적 구간에서
 * 비교할 때 매달 표본이 비지 않게 하기 위해서다(화면 기본값이 84㎡ 구간이다).
 */
function pickArea(rand: () => number, seed: ComplexSeed, representativeWeight: number): number {
  const others = seed.areaVariants.filter((area) => Math.abs(area - seed.representativeAreaM2) > 0.01);
  if (others.length === 0 || rand() < representativeWeight) return seed.representativeAreaM2;
  return others[Math.floor(rand() * others.length)] ?? seed.representativeAreaM2;
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
      // 최근 6개월에만 적용하는 하락 보정. 6개월에 걸쳐 선형으로 반영한다.
      const dropMonths = 6;
      const dropProgress = seed.recentDropPct && monthIndex >= months - dropMonths
        ? Math.min(1, (monthIndex - (months - dropMonths - 1)) / dropMonths)
        : 0;
      const dropFactor = seed.recentDropPct ? 1 + (seed.recentDropPct / 100) * dropProgress : 1;
      const anomaly = seed.anomalies?.find((row) => row.month === month);

      for (let i = 0; i < volume; i += 1) {
        const areaM2 = pickArea(rand, seed, 0.55);
        // 급매 표본은 그 달 두 번째 거래(표본이 1건이면 첫 거래)에 적용한다.
        const bargainIndex = volume > 1 ? 1 : 0;
        const bargain = seed.bargains?.find(
          (row) => row.month === month && (row.areaM2 === undefined || Math.abs(row.areaM2 - areaM2) < 0.6),
        );
        const ppp =
          anchorPpp *
          drift *
          seasonal *
          areaFactor(areaM2, seed.representativeAreaM2) *
          jitter(rand, 0.035) *
          dropFactor *
          (anomaly && i === 0 ? anomaly.factor : 1) *
          (bargain && i === bargainIndex ? bargain.factor : 1);
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
  rentTransactions: AptRentTransaction[];
  macro: MacroIndicator[];
  pipelineRuns: PipelineRun[];
  runTasks: PipelineRunTask[];
  deadLetters: DeadLetterEntry[];
  sources: typeof SOURCE_CATALOG;
}

export function buildSampleDataset(): SampleDataset {
  const transactions = buildSampleTransactions();
  return {
    regions: SAMPLE_REGIONS,
    complexes: SAMPLE_COMPLEXES,
    transactions,
    rentTransactions: buildSampleRentTransactions(),
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

/**
 * 전월세 표본.
 *
 * 전세 보증금은 같은 시점의 매매 기준가(추세선)에 단지 전세가율을 곱해 만들고,
 * 일부 계약은 보증금+월세 형태로 섞는다. 매매 표본에 넣은 급락·이상치를 전세가에 반영하지 않으므로,
 * 매매가가 빠지는 단지에서는 전세가율이 자연스럽게 올라간다(실제 관측과 같은 방향).
 * 실제 신고된 전월세 계약이 아니라 전세가율·리스크 화면을 검증하는 표본이다.
 */
export function buildSampleRentTransactions(
  months = SAMPLE_MONTHS,
): AptRentTransaction[] {
  const monthList = recentMonths(SAMPLE_END_MONTH, months);
  const rows: AptRentTransaction[] = [];

  for (const seed of COMPLEX_SEEDS) {
    const anchorPpp = seed.anchorPriceKrw / (seed.representativeAreaM2 / 3.305785);
    const monthlyTrend = Math.pow(1 + seed.trendPct / 100, 1 / months) - 1;
    const dong = SAMPLE_REGIONS.find((region) => region.legalDongCode === seed.legalDongCode)?.dong ?? '';

    monthList.forEach((month, monthIndex) => {
      const rand = mulberry32(seedFromString(`rent:${seed.complexId}:${month}`));
      const drift = Math.pow(1 + monthlyTrend, monthIndex);
      const seasonal = 1 + Math.sin((monthIndex / 12) * Math.PI * 2) * 0.008;
      // 전세가율 자체도 완만하게 움직인다(24개월에 ±2%p 수준).
      const ratioDrift = 1 + ((monthIndex - months / 2) / months) * 0.04;
      const contractCount = 2 + (rand() < 0.5 ? 1 : 0);

      for (let i = 0; i < contractCount; i += 1) {
        const areaM2 = pickArea(rand, seed, 0.7);
        const referenceSaleKrw = anchorPpp * drift * seasonal * (areaM2 / 3.305785);
        const jeonseDepositKrw = Math.round((referenceSaleKrw * (seed.jeonseRatioPct / 100) * ratioDrift * jitter(rand, 0.018)) / 10_000) * 10_000;
        const isMonthly = rand() < 0.18;
        const depositKrw = isMonthly ? Math.round((jeonseDepositKrw * 0.4) / 10_000) * 10_000 : jeonseDepositKrw;
        // 월세-전세 전환율 연 5% 수준을 12개월 월세로 나눈 근사치.
        const monthlyRentKrw = isMonthly ? Math.round((jeonseDepositKrw * 0.6 * 0.05) / 12 / 10_000) * 10_000 : 0;
        const day = 2 + Math.floor(rand() * 26);
        const floor = 1 + Math.floor(rand() * 24);
        const dealDate = `${month}-${String(day).padStart(2, '0')}`;
        const contractType = isMonthly ? 'monthly' : 'jeonse';
        const contractTermMonths = isMonthly ? 12 : 24;

        rows.push({
          rentHash: createRentHash({
            lawdCd: seed.lawdCd,
            legalDongCode: seed.legalDongCode,
            aptName: seed.name,
            jibun: '',
            builtYear: seed.builtYear,
            dealDate,
            floor,
            areaM2,
            depositKrw,
            monthlyRentKrw,
            contractType,
            contractTermMonths,
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
          depositKrw,
          monthlyRentKrw,
          contractType,
          contractTermMonths,
          renewalRequested: rand() < 0.12,
          sourceId: SOURCE_IDS.molitAptRent,
          asOfDate: `${month}-01`,
          collectedAt: `${month}-28T03:10:00.000Z`,
          sourceNote: null,
        });
      }
    });
  }

  return rows.sort((a, b) => b.dealDate.localeCompare(a.dealDate));
}

/** 데모 화면의 필터 기본값. 2026-09 이후 최근 12개월. */
export const DEFAULT_DEMO_RANGE = {
  endMonth: SAMPLE_END_MONTH,
  startMonth: shiftMonth(SAMPLE_END_MONTH, -11),
};
