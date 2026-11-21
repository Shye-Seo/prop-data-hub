import { describe, expect, it } from 'vitest';
import { selectDrawdownRanking } from '@prop/shared';
import {
  COMPLEX_OPTIONS,
  DRAWDOWN_SET,
  areaOptionsForComplex,
  complexOption,
  defaultAreaOption,
  saleReference,
} from './tools';

describe('전세·현금 계산 화면 데이터', () => {
  it('단지 선택지가 33개이고 구·동·세대수를 포함한다', () => {
    expect(COMPLEX_OPTIONS).toHaveLength(33);
    const first = COMPLEX_OPTIONS[0]!;
    expect(first.label).toContain(first.dong);
    expect(first.households).toBeGreaterThan(0);
    expect(complexOption('NOPE')).toBeUndefined();
  });

  it('단지의 거래 면적 구간과 기본 면적을 고른다', () => {
    const options = areaOptionsForComplex('MOLIT-26290-001');
    expect(options.length).toBeGreaterThan(0);
    const defaultOption = defaultAreaOption('MOLIT-26290-001');
    expect(defaultOption?.band).toBe('60to85');
    expect(defaultOption?.areaM2).toBeGreaterThan(84);
    expect(defaultOption?.areaM2).toBeLessThan(85);
  });

  it('최근 6개월 중위 매매가와 표본·기준월을 만든다', () => {
    const reference = saleReference('MOLIT-26290-001', '60to85');
    expect(reference).not.toBeNull();
    expect(reference!.medianPriceKrw).toBeGreaterThan(0);
    expect(reference!.sampleCount).toBeGreaterThan(0);
    expect(reference!.latestMonth >= '2026-04').toBe(true);
    expect(reference!.areaM2).toBeGreaterThan(84);
  });

  it('전고점 하락률 표본이 350세대 이상 단지의 대표 면적 행을 만든다', () => {
    expect(DRAWDOWN_SET.rows.length).toBeGreaterThan(10);
    expect(DRAWDOWN_SET.universe.largeComplexes).toBe(30);
    expect(DRAWDOWN_SET.asOfMonth).toBe('2026-09');
    const ranked = selectDrawdownRanking(DRAWDOWN_SET.rows);
    expect(ranked).toHaveLength(30);
    expect(ranked[0]!.drawdownPct).toBeLessThanOrEqual(0);
    expect(ranked[0]!.rank).toBe(1);
    for (const row of ranked) {
      expect(row.areaM2).toBeGreaterThan(0);
      expect(row.monthCount).toBeGreaterThanOrEqual(8);
      expect(row.sampleCount).toBeGreaterThanOrEqual(10);
    }
  });

  it('수영구·84㎡ 조건으로 랭킹을 좁힌다', () => {
    const ranked = selectDrawdownRanking(DRAWDOWN_SET.rows, { lawdCds: ['26500'], areaBand: '60to85' });
    expect(ranked.length).toBeGreaterThan(0);
    for (const row of ranked) {
      expect(row.sigungu).toBe('수영구');
      expect(row.areaM2).toBeGreaterThan(60);
      expect(row.areaM2).toBeLessThanOrEqual(85);
    }
  });
});
