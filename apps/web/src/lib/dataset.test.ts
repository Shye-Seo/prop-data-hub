import { describe, expect, it } from 'vitest';
import {
  ALL_COMPLEX_STATS,
  MONTHS,
  REGION_OPTIONS,
  complexStat,
  regionKpi,
  seriesForDong,
  transactionsFor,
} from './dataset';

describe('화면 데이터 레이어', () => {
  it('지역 6곳과 단지 16개를 준비한다', () => {
    expect(REGION_OPTIONS).toHaveLength(6);
    expect(ALL_COMPLEX_STATS).toHaveLength(16);
    expect(MONTHS).toHaveLength(24);
    expect(MONTHS[23]).toBe('2026-09');
  });

  it('지역별 월별 시계열이 24개월이고 최근월 표본이 있다', () => {
    for (const region of REGION_OPTIONS) {
      const series = seriesForDong(region.legalDongCode);
      expect(series).toHaveLength(24);
      expect(series[23]?.sampleCount).toBeGreaterThan(0);
      expect(series[23]?.medianPriceKrw).toBeGreaterThan(0);
    }
  });

  it('지역 KPI가 표본·중위가·평당가·전년 대비를 계산한다', () => {
    const kpi = regionKpi('2629051000');
    expect(kpi.transactionCount).toBeGreaterThan(0);
    expect(kpi.medianPriceKrw).toBeGreaterThan(0);
    expect(kpi.medianPricePerPyeong).toBeGreaterThan(0);
    expect(kpi.latestMonth).toBe('2026-09');
    expect(Number.isFinite(kpi.yoyChangePct)).toBe(true);
  });

  it('전체 지역 KPI는 개별 지역보다 표본이 많다', () => {
    const all = regionKpi(null);
    const one = regionKpi('2629051000');
    expect(all.transactionCount).toBeGreaterThan(one.transactionCount);
  });

  it('단지 통계가 단지 정보와 12개월 변동률을 묶는다', () => {
    const stat = complexStat('MOLIT-26290-001');
    expect(stat?.complex.name).toBe('문현베스티움');
    expect(stat?.dong).toBe('문현동');
    expect(stat?.latestMedianPriceKrw).toBeGreaterThan(0);
    expect(stat?.volume12m).toBeGreaterThan(0);
    expect(stat?.series).toHaveLength(24);
    expect(complexStat('NOPE')).toBeNull();
  });

  it('실거래 필터가 해제 거래를 제외하고 면적·단지를 좁힌다', () => {
    const rows = transactionsFor({ complexId: 'MOLIT-26290-001', areaBand: '60to85', months: 24 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.canceled).toBe(false);
      expect(row.complexId).toBe('MOLIT-26290-001');
      expect(row.areaM2).toBeGreaterThan(60);
      expect(row.areaM2).toBeLessThanOrEqual(85);
    }
    // 최근순 정렬
    const dates = rows.map((row) => row.dealDate);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('기간 필터가 최근 N개월로 제한한다', () => {
    const six = transactionsFor({ months: 6 });
    const twentyFour = transactionsFor({ months: 24 });
    expect(six.length).toBeGreaterThan(0);
    expect(twentyFour.length).toBeGreaterThan(six.length);
    expect(six.every((row) => row.dealMonth >= '2026-04')).toBe(true);
  });
});
