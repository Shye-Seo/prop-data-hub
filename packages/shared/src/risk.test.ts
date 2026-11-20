import { describe, expect, it } from 'vitest';
import {
  JEONSE_RATIO_BANDS,
  assessComplexRisk,
  detectPriceAnomalies,
  jeonseRatioPct,
  jeonseRatioSeries,
  jeonseRiskLevel,
  riskLevelFromScore,
  scoreComplexRisk,
  summarizeRegionRisk,
} from './risk';
import { buildSampleDataset, SAMPLE_COMPLEXES, SAMPLE_REGIONS } from './fixtures/sample-dataset';
import { pricePerPyeongKrw } from './metrics';
import type { AptRentTransaction, AptTransaction } from './types';

function sale(partial: Partial<AptTransaction> & Pick<AptTransaction, 'dealHash' | 'complexId' | 'dealDate' | 'priceKrw' | 'areaM2'>): AptTransaction {
  return {
    lawdCd: '26290',
    legalDongCode: '2629051000',
    dong: '문현동',
    aptName: '문현베스티움',
    jibun: '806',
    builtYear: 2019,
    dealMonth: partial.dealDate.slice(0, 7),
    floor: 10,
    pricePerPyeong: pricePerPyeongKrw(partial.priceKrw, partial.areaM2),
    dealType: '중개거래',
    canceled: false,
    sourceId: 'molit_apt_trade',
    asOfDate: `${partial.dealDate.slice(0, 7)}-01`,
    collectedAt: '2026-09-30T02:00:00.000Z',
    sourceNote: null,
    ...partial,
  };
}

function rent(partial: Partial<AptRentTransaction> & Pick<AptRentTransaction, 'rentHash' | 'complexId' | 'dealDate' | 'depositKrw' | 'areaM2'>): AptRentTransaction {
  return {
    lawdCd: '26290',
    legalDongCode: '2629051000',
    dong: '문현동',
    aptName: '문현베스티움',
    jibun: '806',
    builtYear: 2019,
    dealMonth: partial.dealDate.slice(0, 7),
    floor: 8,
    monthlyRentKrw: 0,
    contractType: 'jeonse',
    contractTermMonths: 24,
    renewalRequested: false,
    sourceId: 'molit_apt_rent',
    asOfDate: `${partial.dealDate.slice(0, 7)}-01`,
    collectedAt: '2026-09-30T02:00:00.000Z',
    sourceNote: null,
    ...partial,
  };
}

describe('jeonseRatioPct', () => {
  it('전세가율을 소수 첫째 자리로 계산한다', () => {
    expect(jeonseRatioPct(420_000_000, 600_000_000)).toBe(70);
    expect(jeonseRatioPct(428_000_000, 628_000_000)).toBe(68.2);
    expect(jeonseRatioPct(0, 628_000_000)).toBe(0);
    expect(jeonseRatioPct(100, 0)).toBe(0);
  });

  it('구간 경계값에서 위험 단계가 바뀐다', () => {
    expect(jeonseRiskLevel(69.9)).toBe('low');
    expect(jeonseRiskLevel(JEONSE_RATIO_BANDS.warning)).toBe('moderate');
    expect(jeonseRiskLevel(JEONSE_RATIO_BANDS.high)).toBe('high');
    expect(jeonseRiskLevel(JEONSE_RATIO_BANDS.critical)).toBe('critical');
  });
});

describe('jeonseRatioSeries', () => {
  const months = ['2026-07', '2026-08', '2026-09'];

  it('월별 매매·전세 중위값으로 전세가율을 만들고 월세 계약은 제외한다', () => {
    const sales = [
      sale({ dealHash: 's1', complexId: 'C1', dealDate: '2026-09-03', priceKrw: 600_000_000, areaM2: 84 }),
      sale({ dealHash: 's2', complexId: 'C1', dealDate: '2026-09-20', priceKrw: 700_000_000, areaM2: 84 }),
      sale({ dealHash: 's3', complexId: 'C1', dealDate: '2026-08-10', priceKrw: 640_000_000, areaM2: 84 }),
    ];
    const rents = [
      rent({ rentHash: 'r1', complexId: 'C1', dealDate: '2026-09-05', depositKrw: 450_000_000, areaM2: 84 }),
      rent({ rentHash: 'r2', complexId: 'C1', dealDate: '2026-09-06', depositKrw: 510_000_000, areaM2: 84 }),
      rent({
        rentHash: 'r3',
        complexId: 'C1',
        dealDate: '2026-09-07',
        depositKrw: 300_000_000,
        areaM2: 84,
        contractType: 'monthly',
        monthlyRentKrw: 900_000,
      }),
    ];
    const series = jeonseRatioSeries(rents, sales, months, { complexId: 'C1' });
    expect(series[2]?.saleMedianKrw).toBe(650_000_000);
    expect(series[2]?.jeonseMedianKrw).toBe(480_000_000);
    expect(series[2]?.ratioPct).toBeGreaterThan(73);
    expect(series[2]?.ratioPct).toBeLessThan(75);
    expect(series[2]?.matchedAreas).toEqual([85]);
    expect(series[2]?.jeonseSamples).toBe(2);
    expect(series[1]?.ratioPct).toBe(0);
    expect(series[0]?.saleSamples).toBe(0);
    expect(series[0]?.matchedAreas).toEqual([]);
  });

  it('해제 거래는 매매 중위값에서 뺀다', () => {
    const sales = [
      sale({ dealHash: 's1', complexId: 'C1', dealDate: '2026-09-03', priceKrw: 600_000_000, areaM2: 84 }),
      sale({ dealHash: 's2', complexId: 'C1', dealDate: '2026-09-11', priceKrw: 200_000_000, areaM2: 84, canceled: true }),
    ];
    const rents = [rent({ rentHash: 'r1', complexId: 'C1', dealDate: '2026-09-05', depositKrw: 300_000_000, areaM2: 84 })];
    const series = jeonseRatioSeries(rents, sales, ['2026-09'], { complexId: 'C1' });
    expect(series[0]?.saleMedianKrw).toBe(600_000_000);
    expect(series[0]?.ratioPct).toBe(50);
  });
});

describe('detectPriceAnomalies', () => {
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

  function steadySales(complexId: string): AptTransaction[] {
    return months.flatMap((month, index) => [
      sale({ dealHash: `${complexId}-${month}-a`, complexId, dealDate: `${month}-05`, priceKrw: 600_000_000 + index * 1_000_000, areaM2: 84 }),
      sale({ dealHash: `${complexId}-${month}-b`, complexId, dealDate: `${month}-18`, priceKrw: 604_000_000 + index * 1_000_000, areaM2: 84 }),
    ]);
  }

  it('중위 평당가 대비 급락 거래를 sharp_drop으로 표시한다', () => {
    const rows = steadySales('C1');
    rows.push(sale({ dealHash: 'drop', complexId: 'C1', dealDate: '2026-08-22', priceKrw: 480_000_000, areaM2: 84 }));
    const anomalies = detectPriceAnomalies(rows);
    const drop = anomalies.find((row) => row.dealHash === 'drop');
    expect(drop?.kind).toBe('sharp_drop');
    expect(drop?.deviationPct).toBeLessThan(-12);
  });

  it('MAD 기준으로 크게 벗어난 고가 거래를 outlier_high로 표시한다', () => {
    const rows = steadySales('C1');
    rows.push(sale({ dealHash: 'spike', complexId: 'C1', dealDate: '2026-09-12', priceKrw: 900_000_000, areaM2: 84 }));
    const anomalies = detectPriceAnomalies(rows);
    const spike = anomalies.find((row) => row.dealHash === 'spike');
    expect(spike?.kind).toBe('outlier_high');
    expect(spike?.modifiedZ).toBeGreaterThan(3.5);
  });

  it('정상 범위 거래는 표시하지 않고, 표본이 적으면 z-score를 만들지 않는다', () => {
    const rows = steadySales('C1');
    expect(detectPriceAnomalies(rows)).toHaveLength(0);
    const few = [
      sale({ dealHash: 'a', complexId: 'C2', dealDate: '2026-09-01', priceKrw: 600_000_000, areaM2: 84 }),
      sale({ dealHash: 'b', complexId: 'C2', dealDate: '2026-09-02', priceKrw: 660_000_000, areaM2: 84 }),
    ];
    expect(detectPriceAnomalies(few)).toHaveLength(0);

    // 표본이 적어도 중위 대비 -12% 이상 하락한 거래는 급락으로 표시하되, z-score는 계산하지 않는다.
    const thinDrop = [
      sale({ dealHash: 'a', complexId: 'C3', dealDate: '2026-09-01', priceKrw: 600_000_000, areaM2: 84 }),
      sale({ dealHash: 'b', complexId: 'C3', dealDate: '2026-09-02', priceKrw: 900_000_000, areaM2: 84 }),
    ];
    const [flagged] = detectPriceAnomalies(thinDrop);
    expect(flagged?.dealHash).toBe('a');
    expect(flagged?.kind).toBe('sharp_drop');
    expect(flagged?.modifiedZ).toBeNull();
  });
});

describe('scoreComplexRisk', () => {
  it('전세가율·하락·이상치가 겹치면 점수와 단계가 올라간다', () => {
    const safe = scoreComplexRisk({ jeonseRatioPct: 60, change6mPct: 1.2, change12mPct: 3, anomalyCount: 0, volume12m: 30 });
    expect(safe.score).toBe(0);
    expect(safe.level).toBe('low');
    expect(safe.signals).toHaveLength(0);

    const risky = scoreComplexRisk({ jeonseRatioPct: 88, change6mPct: -7.4, change12mPct: -6.1, anomalyCount: 1, volume12m: 24 });
    expect(risky.score).toBe(28 + 18 + 8 + 6);
    expect(risky.level).toBe('high');
    expect(risky.signals.map((row) => row.code)).toEqual([
      'jeonse_ratio_high',
      'recent_price_drop',
      'twelve_month_decline',
      'price_anomaly',
    ]);
  });

  it('점수는 100을 넘지 않고 위험 단계 경계가 고정돼 있다', () => {
    const worst = scoreComplexRisk({ jeonseRatioPct: 96, change6mPct: -14, change12mPct: -18, anomalyCount: 5, volume12m: 3 });
    expect(worst.score).toBe(97);
    expect(worst.level).toBe('critical');
    expect(riskLevelFromScore(21)).toBe('low');
    expect(riskLevelFromScore(22)).toBe('moderate');
    expect(riskLevelFromScore(45)).toBe('high');
    expect(riskLevelFromScore(70)).toBe('critical');
  });
});

describe('샘플 데이터셋 리스크 평가', () => {
  const dataset = buildSampleDataset();
  const months = [...new Set(dataset.transactions.map((row) => row.dealMonth))].sort();

  it('단지마다 전세가율과 리스크 점수를 계산한다', () => {
    const assessments = SAMPLE_COMPLEXES.map((complex) =>
      assessComplexRisk({
        complex,
        region: SAMPLE_REGIONS.find((region) => region.legalDongCode === complex.legalDongCode),
        sales: dataset.transactions,
        rents: dataset.rentTransactions,
        months,
      }),
    );
    expect(assessments).toHaveLength(SAMPLE_COMPLEXES.length);
    for (const row of assessments) {
      expect(row.jeonseRatioPct).toBeGreaterThan(50);
      expect(row.jeonseRatioPct).toBeLessThan(100);
      expect(row.score).toBeGreaterThanOrEqual(0);
      expect(row.score).toBeLessThanOrEqual(100);
      expect(row.gapKrw).toBeGreaterThan(0);
      expect(row.asOfMonth).toMatch(/^2026-\d{2}$/);
    }
    expect(assessments.filter((row) => row.level !== 'low').length).toBeGreaterThan(0);
  });

  it('샘플에 넣은 이상 거래가 이상치로 잡힌다', () => {
    const anomalies = detectPriceAnomalies(dataset.transactions);
    expect(anomalies.length).toBeGreaterThanOrEqual(3);
    expect(anomalies.some((row) => row.complexId === 'MOLIT-26290-008')).toBe(true);
    expect(anomalies.some((row) => row.complexId === 'MOLIT-26350-002')).toBe(true);
  });

  it('구 단위로 단지 수·중위 전세가율·거래량을 묶는다', () => {
    const assessments = SAMPLE_COMPLEXES.map((complex) =>
      assessComplexRisk({
        complex,
        region: SAMPLE_REGIONS.find((region) => region.legalDongCode === complex.legalDongCode),
        sales: dataset.transactions,
        rents: dataset.rentTransactions,
        months,
      }),
    );
    const namgu = summarizeRegionRisk({
      lawdCd: '26290',
      sigungu: '남구',
      assessments,
      jeonseRatioTrend: jeonseRatioSeries(dataset.rentTransactions, dataset.transactions, months, { lawdCd: '26290' }),
    });
    expect(namgu.complexCount).toBe(9);
    expect(namgu.volume12m).toBeGreaterThan(100);
    expect(namgu.medianJeonseRatioPct).toBeGreaterThan(60);
    expect(namgu.jeonseRatioTrend.length).toBe(12);

    const suyeong = summarizeRegionRisk({
      lawdCd: '26500',
      sigungu: '수영구',
      assessments,
      jeonseRatioTrend: [],
    });
    expect(suyeong.complexCount).toBe(4);
    expect(suyeong.volume12m).toBeGreaterThan(0);
  });
});
