import { describe, expect, it } from 'vitest';
import {
  SAMPLE_COMPLEXES,
  SAMPLE_REGIONS,
  buildSampleDataset,
  buildSampleMacro,
  buildSampleRentTransactions,
  buildSampleTransactions,
} from './sample-dataset';
import { jeonseRatioSeries } from '../risk';

describe('샘플 데이터셋', () => {
  const dataset = buildSampleDataset();

  it('6개 법정동·16개 단지·24개월 거래를 만든다', () => {
    expect(dataset.regions).toHaveLength(6);
    expect(SAMPLE_COMPLEXES).toHaveLength(16);
    expect(dataset.transactions.length).toBeGreaterThan(500);
    const months = new Set(dataset.transactions.map((row) => row.dealMonth));
    expect(months.size).toBe(24);
    expect([...months].sort().at(-1)).toBe('2026-09');
  });

  it('단지마다 평균 2건 이상의 월 표본이 있어 추이 계산이 가능하다', () => {
    for (const complex of SAMPLE_COMPLEXES) {
      const rows = dataset.transactions.filter((row) => row.complexId === complex.complexId);
      expect(rows.length / 24).toBeGreaterThanOrEqual(2);
    }
  });

  it('거래 해시가 중복되지 않고 모든 행이 법정동 코드와 연결된다', () => {
    const hashes = new Set(dataset.transactions.map((row) => row.dealHash));
    expect(hashes.size).toBe(dataset.transactions.length);
    const dongCodes = new Set(SAMPLE_REGIONS.map((region) => region.legalDongCode));
    expect(dataset.transactions.every((row) => dongCodes.has(row.legalDongCode))).toBe(true);
  });

  it('같은 입력이면 같은 표본을 만든다(데모·테스트 재현성)', () => {
    const first = buildSampleTransactions();
    const second = buildSampleTransactions();
    expect(first.map((row) => row.dealHash)).toEqual(second.map((row) => row.dealHash));
    expect(first[0]?.priceKrw).toBe(second[0]?.priceKrw);
  });

  it('평당가와 금액·면적이 일관된다', () => {
    for (const row of dataset.transactions.slice(0, 50)) {
      expect(row.pricePerPyeong).toBe(Math.round(row.priceKrw / (row.areaM2 / 3.305785)));
      expect(row.dealDate.startsWith(row.dealMonth)).toBe(true);
    }
  });

  it('거시지표는 24개월×3종이며 기준일이 말일이다', () => {
    const macro = buildSampleMacro();
    expect(macro).toHaveLength(72);
    expect(new Set(macro.map((row) => row.indicatorCode))).toEqual(new Set(['base_rate', 'mortgage_rate', 'cpi']));
    expect(macro.filter((row) => row.indicatorCode === 'base_rate')[0]?.periodDate).toMatch(/-31$/);
  });

  it('파이프라인 실행·태스크·DLQ 표본이 서로 참조된다', () => {
    const runIds = new Set(dataset.pipelineRuns.map((run) => run.runId));
    expect(dataset.runTasks.every((task) => runIds.has(task.runId))).toBe(true);
    expect(dataset.deadLetters.every((entry) => runIds.has(entry.runId))).toBe(true);
    expect(dataset.pipelineRuns.some((run) => run.status === 'partial')).toBe(true);
  });

  it('전월세 표본은 24개월간 전세·월세 계약을 모두 갖고 해시가 중복되지 않는다', () => {
    const rents = dataset.rentTransactions;
    expect(rents.length).toBeGreaterThan(300);
    expect(new Set(rents.map((row) => row.rentHash)).size).toBe(rents.length);
    expect(rents.some((row) => row.contractType === 'jeonse')).toBe(true);
    expect(rents.some((row) => row.contractType === 'monthly' && row.monthlyRentKrw > 0)).toBe(true);
    expect(new Set(rents.map((row) => row.dealMonth)).size).toBe(24);
    expect(rents.filter((row) => row.contractType === 'jeonse').every((row) => row.monthlyRentKrw === 0)).toBe(true);
  });

  it('전세가 표본으로 계산한 전세가율이 구간 안에 들어온다', () => {
    const months = [...new Set(dataset.transactions.map((row) => row.dealMonth))].sort();
    const series = jeonseRatioSeries(dataset.rentTransactions, dataset.transactions, months);
    const valid = series.filter((row) => row.ratioPct > 0);
    expect(valid.length).toBeGreaterThanOrEqual(20);
    for (const row of valid) {
      expect(row.ratioPct).toBeGreaterThan(50);
      expect(row.ratioPct).toBeLessThan(100);
    }
  });

  it('최근 6개월 하락을 넣은 단지는 전세가율이 직전보다 올라간다', () => {
    const months = [...new Set(dataset.transactions.map((row) => row.dealMonth))].sort();
    const series = jeonseRatioSeries(dataset.rentTransactions, dataset.transactions, months, {
      complexId: 'MOLIT-26290-005',
    });
    const valid = series.filter((row) => row.ratioPct > 0);
    const early = valid.slice(0, 6);
    const late = valid.slice(-6);
    const average = (rows: typeof valid) => rows.reduce((sum, row) => sum + row.ratioPct, 0) / rows.length;
    expect(average(late)).toBeGreaterThan(average(early) + 1);
  });

  it('buildSampleRentTransactions는 같은 입력이면 같은 표본을 만든다', () => {
    const first = buildSampleRentTransactions();
    const second = buildSampleRentTransactions();
    expect(first.map((row) => row.rentHash)).toEqual(second.map((row) => row.rentHash));
  });
});
