import { describe, expect, it } from 'vitest';
import {
  ANOMALY_BY_DEAL_HASH,
  PRICE_ANOMALIES,
  REGION_RISK_SUMMARIES,
  RISK_ASSESSMENTS,
  assessmentsFor,
  complexJeonseSeries,
  overallSummary,
  regionSummary,
} from './risk';
import { SAMPLE_COMPLEXES } from '@prop/shared';
import { dataset } from './dataset';

describe('화면 리스크 레이어', () => {
  it('모든 단지의 리스크 평가와 구별 요약을 만든다', () => {
    expect(RISK_ASSESSMENTS).toHaveLength(SAMPLE_COMPLEXES.length);
    expect(REGION_RISK_SUMMARIES).toHaveLength(6);
    expect(REGION_RISK_SUMMARIES.map((row) => row.sigungu)).toEqual([
      '부산진구',
      '동래구',
      '남구',
      '해운대구',
      '연제구',
      '수영구',
    ]);
    for (const row of REGION_RISK_SUMMARIES) {
      expect(row.complexCount).toBeGreaterThan(0);
      expect(row.medianJeonseRatioPct).toBeGreaterThan(50);
      expect(row.medianPricePerPyeong).toBeGreaterThan(0);
      expect(row.jeonseRatioTrend.length).toBe(12);
    }
  });

  it('단지 목록은 요청한 구로 거르고 점수 높은 순으로 정렬한다', () => {
    const suyeong = assessmentsFor('26500');
    expect(suyeong).toHaveLength(4);
    expect(suyeong.every((row) => row.sigungu === '수영구')).toBe(true);
    const scores = suyeong.map((row) => row.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    const all = assessmentsFor(null);
    expect(all).toHaveLength(SAMPLE_COMPLEXES.length);
    expect(all[0]!.score).toBeGreaterThanOrEqual(all[all.length - 1]!.score);
  });

  it('전체 요약은 구 요약보다 단지 수가 많다', () => {
    const all = overallSummary();
    expect(all.complexCount).toBe(SAMPLE_COMPLEXES.length);
    expect(all.volume12m).toBeGreaterThan(regionSummary('26290')!.volume12m);
    expect(all.anomalyCount).toBeGreaterThanOrEqual(3);
  });

  it('이상 거래 인덱스가 표본과 일치한다', () => {
    expect(PRICE_ANOMALIES.length).toBeGreaterThanOrEqual(3);
    expect(ANOMALY_BY_DEAL_HASH.size).toBe(PRICE_ANOMALIES.length);
    for (const anomaly of PRICE_ANOMALIES) {
      expect(dataset.transactions.some((row) => row.dealHash === anomaly.dealHash)).toBe(true);
    }
    expect(ANOMALY_BY_DEAL_HASH.get(PRICE_ANOMALIES[0]!.dealHash)?.kind).toBeTruthy();
  });

  it('단지 전세가율 시계열은 24개월이고 값이 구간 안에 있다', () => {
    const series = complexJeonseSeries('MOLIT-26290-005');
    expect(series).toHaveLength(24);
    const values = series.filter((row) => row.ratioPct > 0).map((row) => row.ratioPct);
    expect(values.length).toBeGreaterThan(12);
    for (const value of values) {
      expect(value).toBeGreaterThan(50);
      expect(value).toBeLessThan(120);
    }
  });
});
