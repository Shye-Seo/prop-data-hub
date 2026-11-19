import { describe, expect, it } from 'vitest';
import {
  SAMPLE_COMPLEXES,
  SAMPLE_REGIONS,
  buildSampleDataset,
  buildSampleMacro,
  buildSampleTransactions,
} from './sample-dataset';

describe('샘플 데이터셋', () => {
  const dataset = buildSampleDataset();

  it('3개 법정동·12개 단지·24개월 거래를 만든다', () => {
    expect(dataset.regions).toHaveLength(3);
    expect(SAMPLE_COMPLEXES).toHaveLength(12);
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
});
