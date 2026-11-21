import { describe, expect, it } from 'vitest';
import {
  DEAL_GRADE_THRESHOLDS,
  LARGE_COMPLEX_HOUSEHOLDS,
  areaBandOf,
  buildAlertPreview,
  buildRadarDealSet,
  describeAlertRule,
  filterRadarDeals,
  normalizeAlertRule,
  radarSummary,
  scoreDeal,
} from './radar';
import { buildSampleDataset, SAMPLE_END_MONTH, SAMPLE_MONTHS } from './fixtures/sample-dataset';
import { recentMonths, shiftMonth } from './metrics';
import type { ApartmentComplex, AptRentTransaction, AptTransaction, Region } from './types';

const MONTHS = recentMonths(SAMPLE_END_MONTH, SAMPLE_MONTHS);

function makeComplex(overrides: Partial<ApartmentComplex> = {}): ApartmentComplex {
  return {
    complexId: 'T-001',
    name: '테스트단지',
    legalDongCode: '2623010200',
    lawdCd: '26230',
    builtYear: 2010,
    households: 800,
    representativeAreaM2: 84.9,
    ...overrides,
  };
}

function makeDeal(overrides: Partial<AptTransaction> = {}): AptTransaction {
  return {
    dealHash: `hash-${Math.random().toString(36).slice(2, 10)}`,
    lawdCd: '26230',
    legalDongCode: '2623010200',
    dong: '전포동',
    aptName: '테스트단지',
    complexId: 'T-001',
    jibun: '',
    builtYear: 2010,
    dealMonth: '2026-09',
    dealDate: '2026-09-10',
    floor: 10,
    areaM2: 84.9,
    priceKrw: 600_000_000,
    pricePerPyeong: 23_352_000,
    dealType: '중개거래',
    canceled: false,
    sourceId: 'molit_apt_trade',
    asOfDate: '2026-09-01',
    collectedAt: '2026-09-28T02:00:00.000Z',
    sourceNote: null,
    ...overrides,
  };
}

function makeRent(overrides: Partial<AptRentTransaction> = {}): AptRentTransaction {
  return {
    rentHash: `rent-${Math.random().toString(36).slice(2, 10)}`,
    lawdCd: '26230',
    legalDongCode: '2623010200',
    dong: '전포동',
    aptName: '테스트단지',
    complexId: 'T-001',
    jibun: '',
    builtYear: 2010,
    dealMonth: '2026-09',
    dealDate: '2026-09-08',
    floor: 8,
    areaM2: 84.9,
    depositKrw: 400_000_000,
    monthlyRentKrw: 0,
    contractType: 'jeonse',
    contractTermMonths: 24,
    renewalRequested: false,
    sourceId: 'molit_apt_rent',
    asOfDate: '2026-09-01',
    collectedAt: '2026-09-28T03:00:00.000Z',
    sourceNote: null,
    ...overrides,
  };
}

const REGION: Region = {
  lawdCd: '26230',
  legalDongCode: '2623010200',
  sido: '부산광역시',
  sigungu: '부산진구',
  dong: '전포동',
};

describe('레이더 면적 구간', () => {
  it('전용면적을 60·85·115㎡ 경계로 나눈다', () => {
    expect(areaBandOf(59.9)).toBe('under60');
    expect(areaBandOf(60)).toBe('under60');
    expect(areaBandOf(84.9)).toBe('60to85');
    expect(areaBandOf(85)).toBe('60to85');
    expect(areaBandOf(101.9)).toBe('85to115');
    expect(areaBandOf(126.9)).toBe('over115');
  });
});

describe('매물 점수', () => {
  it('할인·전세가율·유동성·규모 배점을 합산해 100점 만점으로 만든다', () => {
    const best = scoreDeal({ discountPct: -16, jeonseRatioPct: 60, volume3m: 10, households: 2000 });
    expect(best.score).toBe(100);
    expect(best.grade).toBe('strong');
    expect(best.signals.map((signal) => signal.code)).toEqual(
      expect.arrayContaining(['discount', 'jeonse_ratio', 'liquidity', 'scale']),
    );

    const worst = scoreDeal({ discountPct: -2, jeonseRatioPct: 95, volume3m: 0, households: 200 });
    expect(worst.score).toBe(0);
    expect(worst.grade).toBe('marginal');
  });

  it('할인율 구간별 배점이 문서와 일치한다', () => {
    const points = (discountPct: number) => scoreDeal({ discountPct, jeonseRatioPct: 95, volume3m: 0, households: 200 }).score;
    expect(points(-4)).toBe(7);
    expect(points(-6)).toBe(14);
    expect(points(-8)).toBe(24);
    expect(points(-10)).toBe(32);
    expect(points(-12)).toBe(38);
    expect(points(-15)).toBe(45);
  });

  it('전세 표본이 없으면 갭 항목을 0점 처리하고 근거를 남긴다', () => {
    const result = scoreDeal({ discountPct: -9, jeonseRatioPct: null, volume3m: 4, households: 900 });
    expect(result.signals.find((signal) => signal.code === 'jeonse_ratio')?.label).toBe('전세 표본 없음');
    expect(result.score).toBe(24 + 7 + 16);
  });

  it('350세대 미만 단지는 대단지 가중치를 받지 않는다', () => {
    const small = scoreDeal({ discountPct: -9, jeonseRatioPct: 60, volume3m: 4, households: LARGE_COMPLEX_HOUSEHOLDS - 1 });
    expect(small.signals.some((signal) => signal.code === 'scale')).toBe(false);
  });

  it('-20% 이하 할인과 직거래는 별도 확인 신호를 남긴다', () => {
    const result = scoreDeal({ discountPct: -23, jeonseRatioPct: 60, volume3m: 5, households: 1000, dealType: '직거래' });
    expect(result.signals.map((signal) => signal.code)).toEqual(expect.arrayContaining(['discount_check', 'direct_trade']));
  });

  it('점수 경계값이 등급으로 이어진다', () => {
    expect(DEAL_GRADE_THRESHOLDS.strong).toBe(70);
    expect(scoreDeal({ discountPct: -10, jeonseRatioPct: 65, volume3m: 5, households: 1000 }).grade).toBe('strong');
    expect(scoreDeal({ discountPct: -8, jeonseRatioPct: 78, volume3m: 2, households: 400 }).grade).toBe('watch');
  });
});

describe('레이더 매물 생성', () => {
  it('기준 시세는 같은 단지·면적 구간의 최근 6개월 중위가에서 자기 자신을 뺀 값이다', () => {
    const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    const base = 600_000_000;
    const history = months.slice(0, 5).map((month, index) =>
      makeDeal({
        dealHash: `hist-${index}`,
        dealMonth: month,
        dealDate: `${month}-10`,
        priceKrw: base,
        pricePerPyeong: 23_352_000,
      }),
    );
    const target = makeDeal({ dealHash: 'target', dealMonth: '2026-09', dealDate: '2026-09-18', priceKrw: 540_000_000, pricePerPyeong: 21_017_000 });

    const set = buildRadarDealSet({
      transactions: [...history, target],
      rents: [],
      complexes: [makeComplex()],
      regions: [REGION],
      months,
    });

    const deal = set.deals.find((row) => row.dealHash === 'target');
    expect(deal).toBeDefined();
    expect(deal?.medianPriceKrw).toBe(base);
    expect(deal?.referenceSamples).toBe(5);
    expect(deal?.discountPct).toBe(-10);
    expect(deal?.dealScore).toBeGreaterThan(0);
  });

  it('기준 시세 표본이 3건 미만이면 목록에서 빼고 이유를 집계한다', () => {
    const set = buildRadarDealSet({
      transactions: [
        makeDeal({ dealHash: 'a', dealMonth: '2026-08', dealDate: '2026-08-10' }),
        makeDeal({ dealHash: 'b', dealMonth: '2026-09', dealDate: '2026-09-10' }),
      ],
      rents: [],
      complexes: [makeComplex()],
      regions: [REGION],
      months: MONTHS,
    });
    expect(set.deals).toHaveLength(0);
    expect(set.universe.thinReferenceDeals).toBe(2);
  });

  it('면적 구간이 다르면 기준 시세를 섞지 않는다', () => {
    const small = [0, 1, 2].map((index) =>
      makeDeal({ dealHash: `small-${index}`, areaM2: 59.9, priceKrw: 400_000_000, dealMonth: '2026-08' }),
    );
    const big = [0, 1, 2].map((index) =>
      makeDeal({ dealHash: `big-${index}`, areaM2: 84.9, priceKrw: 700_000_000, dealMonth: '2026-08' }),
    );
    const target = makeDeal({ dealHash: 'target', areaM2: 84.9, priceKrw: 630_000_000, dealMonth: '2026-09', dealDate: '2026-09-15' });
    const set = buildRadarDealSet({
      transactions: [...small, ...big, target],
      rents: [],
      complexes: [makeComplex()],
      regions: [REGION],
      months: MONTHS,
    });
    const deal = set.deals.find((row) => row.dealHash === 'target');
    expect(deal?.medianPriceKrw).toBe(700_000_000);
    expect(deal?.areaBand).toBe('60to85');
  });

  it('전세 표본이 없으면 전세가율·갭을 null로 두고 집계에 남긴다', () => {
    const rows = [0, 1, 2].map((index) => makeDeal({ dealHash: `d-${index}`, dealMonth: '2026-08' }));
    const target = makeDeal({ dealHash: 'target', dealMonth: '2026-09', dealDate: '2026-09-15', priceKrw: 550_000_000 });
    const set = buildRadarDealSet({
      transactions: [...rows, target],
      rents: [],
      complexes: [makeComplex()],
      regions: [REGION],
      months: MONTHS,
    });
    const deal = set.deals.find((row) => row.dealHash === 'target');
    expect(deal?.jeonseRatioPct).toBeNull();
    expect(deal?.gapKrw).toBeNull();
    expect(set.universe.missingJeonseDeals).toBeGreaterThan(0);
  });

  it('전세가율은 같은 면적 구간의 전세 계약으로 계산한다', () => {
    const sales = [0, 1, 2].map((index) => makeDeal({ dealHash: `s-${index}`, dealMonth: '2026-08' }));
    const target = makeDeal({ dealHash: 'target', dealMonth: '2026-09', dealDate: '2026-09-15', priceKrw: 550_000_000 });
    const rents = [0, 1].map((index) => makeRent({ rentHash: `r-${index}`, dealMonth: '2026-09' }));
    const set = buildRadarDealSet({
      transactions: [...sales, target],
      rents,
      complexes: [makeComplex()],
      regions: [REGION],
      months: MONTHS,
    });
    const deal = set.deals.find((row) => row.dealHash === 'target');
    expect(deal?.jeonseRatioPct).toBeCloseTo(66.7, 1);
    expect(deal?.gapKrw).toBeGreaterThan(0);
  });
});

describe('레이더 필터', () => {
  const dataset = buildSampleDataset();
  const set = buildRadarDealSet({
    transactions: dataset.transactions,
    rents: dataset.rentTransactions,
    complexes: dataset.complexes,
    regions: dataset.regions,
    months: MONTHS,
  });

  it('기본값은 350세대 이상 · 중위가 대비 -8% 이하다', () => {
    const filtered = filterRadarDeals(set.deals);
    expect(filtered.length).toBeGreaterThan(0);
    for (const deal of filtered) {
      expect(deal.households).toBeGreaterThanOrEqual(LARGE_COMPLEX_HOUSEHOLDS);
      expect(deal.discountPct).toBeLessThanOrEqual(-8);
    }
  });

  it('세대수 토글을 끄면 350세대 미만 단지의 급매도 포함된다', () => {
    const off = filterRadarDeals(set.deals, { minHouseholds: 0 });
    const small = off.filter((deal) => deal.households < LARGE_COMPLEX_HOUSEHOLDS);
    expect(small.length).toBeGreaterThan(0);
    expect(new Set(small.map((deal) => deal.complexName))).toEqual(
      new Set(['가야KTe편한세상', '동래SK뷰1차', '연산SK뷰1단지']),
    );
    expect(filterRadarDeals(set.deals).some((deal) => deal.households < LARGE_COMPLEX_HOUSEHOLDS)).toBe(false);
  });

  it('부산 6개 구 모두 레이더 후보가 있다', () => {
    const filtered = filterRadarDeals(set.deals, { minHouseholds: 0 });
    const districts = new Set(filtered.map((deal) => deal.sigungu));
    expect(districts).toEqual(new Set(['부산진구', '동래구', '남구', '해운대구', '연제구', '수영구']));
  });

  it('구·평형·할인율·점수 조건이 함께 적용된다', () => {
    const filtered = filterRadarDeals(set.deals, {
      lawdCds: ['26230', '26290'],
      areaBand: '60to85',
      maxDiscountPct: 10,
      minScore: DEAL_GRADE_THRESHOLDS.watch,
    });
    expect(filtered.length).toBeGreaterThan(0);
    for (const deal of filtered) {
      expect(['26230', '26290']).toContain(deal.lawdCd);
      expect(deal.areaBand).toBe('60to85');
      expect(deal.discountPct).toBeLessThanOrEqual(-10);
      expect(deal.dealScore).toBeGreaterThanOrEqual(DEAL_GRADE_THRESHOLDS.watch);
    }
  });

  it('정렬은 점수 내림차순이다', () => {
    const filtered = filterRadarDeals(set.deals);
    const scores = filtered.map((deal) => deal.dealScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('요약값이 목록과 일치한다', () => {
    const filtered = filterRadarDeals(set.deals);
    const summary = radarSummary(filtered);
    expect(summary.count).toBe(filtered.length);
    expect(summary.complexCount).toBe(new Set(filtered.map((deal) => deal.complexId)).size);
    expect(summary.maxDiscountPct).toBe(Math.min(...filtered.map((deal) => deal.discountPct)));
  });
});

describe('맞춤 알림 규칙', () => {
  const dataset = buildSampleDataset();
  const set = buildRadarDealSet({
    transactions: dataset.transactions,
    rents: dataset.rentTransactions,
    complexes: dataset.complexes,
    regions: dataset.regions,
    months: MONTHS,
  });

  const rule = normalizeAlertRule(
    {
      name: '부산진구·남구 84㎡ 급매',
      lawdCds: ['26230', '26290'],
      minHouseholds: 350,
      areaBand: '60to85',
      maxDiscountPct: 8,
      minScore: 40,
      channels: ['kakao_alimtalk', 'webhook'],
    },
    { ruleId: 'rule_test_01', createdAt: '2026-11-20T00:00:00.000Z' },
  );

  it('규칙을 정규화하고 조건 문장을 만든다', () => {
    expect(rule.lawdCds).toEqual(['26230', '26290']);
    expect(describeAlertRule(rule)).toBe(
      '부산진구·남구 · 350세대 이상 · 60~85㎡ (18~26평) · 중위가 대비 -8% 이하 · 점수 40점 이상',
    );
  });

  it('알림 미리보기는 매칭 건수·카카오 본문·웹훅 payload를 함께 만든다', () => {
    const preview = buildAlertPreview(rule, set.deals, { now: '2026-11-20T06:00:00.000Z' });
    expect(preview.matchedCount).toBeGreaterThan(0);
    expect(preview.sample.length).toBeLessThanOrEqual(3);
    expect(preview.kakao.templateCode).toBe('PROP_RADAR_DEAL_01');
    expect(preview.kakao.variables.matched_count).toBe(String(preview.matchedCount));
    expect(preview.kakao.message).toContain(rule.name);
    expect(preview.kakao.message).toContain('조건에 맞는 매물');
    expect(preview.webhook.method).toBe('POST');
    expect(preview.webhook.body.type).toBe('radar.deal.matched');
    expect(preview.previewOnly).toBe(true);
    expect(preview.note).toContain('미리보기');
  });

  it('미리보기에 싣는 매물은 규칙 조건을 지킨다', () => {
    const preview = buildAlertPreview(rule, set.deals);
    for (const deal of preview.sample) {
      expect(['26230', '26290']).toContain(deal.lawdCd);
      expect(deal.households).toBeGreaterThanOrEqual(350);
      expect(deal.areaBand).toBe('60to85');
      expect(deal.discountPct).toBeLessThanOrEqual(-8);
      expect(deal.dealScore).toBeGreaterThanOrEqual(40);
    }
  });

  it('조건에 맞는 매물이 없어도 미리보기는 0건으로 만든다', () => {
    const strict = normalizeAlertRule(
      { name: '없는 조건', lawdCds: ['26230'], maxDiscountPct: 40, areaBand: 'over115' },
      { ruleId: 'rule_none', createdAt: '2026-11-20T00:00:00.000Z' },
    );
    const preview = buildAlertPreview(strict, set.deals);
    expect(preview.matchedCount).toBe(0);
    expect(preview.kakao.message).toContain('0건');
    expect(preview.webhook.body.deals).toEqual([]);
  });

  it('최근 거래가 없는 과거 구간에서는 후보가 만들어지지 않는다', () => {
    const oldSet = buildRadarDealSet({
      transactions: dataset.transactions.filter((row) => row.dealMonth <= shiftMonth(SAMPLE_END_MONTH, -12)),
      rents: dataset.rentTransactions,
      complexes: dataset.complexes,
      regions: dataset.regions,
      months: recentMonths(shiftMonth(SAMPLE_END_MONTH, -12), SAMPLE_MONTHS),
    });
    expect(oldSet.deals.every((deal) => deal.dealMonth <= shiftMonth(SAMPLE_END_MONTH, -12))).toBe(true);
  });
});
