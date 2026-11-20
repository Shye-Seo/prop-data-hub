import { describe, expect, it } from 'vitest';
import { SAMPLE_REGIONS, SOURCE_IDS } from '@prop/shared';
import { HttpClient } from '../src/http';
import { MemorySink } from '../src/sink';
import {
  runEcosIngestion,
  runMolitIngestion,
  runMolitRentIngestion,
  retryMolitDeadLetter,
  retryMolitRentDeadLetter,
  type PipelineDeps,
} from '../src/pipeline';
import { createFixtureTransport } from '../src/fixtures/transport';

const endpoint = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';

function buildDeps(sink: MemorySink, fetchImpl: typeof fetch): PipelineDeps {
  let runIndex = 0;
  return {
    sink,
    http: new HttpClient({ fetchImpl, retry: { maxAttempts: 4, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 } }),
    now: () => new Date('2026-11-19T02:00:00Z'),
    idFactory: () => `run_test_${String(++runIndex).padStart(2, '0')}`,
    deadLetterRetryDelayMs: 60_000,
  };
}

describe('runMolitIngestion', () => {
  it('일부 태스크가 실패하면 partial로 마감하고 DLQ에 적재한다', async () => {
    const sink = new MemorySink();
    await sink.saveRegions(SAMPLE_REGIONS);
    const transport = createFixtureTransport({
      hardFailures: [{ lawdCd: '26350', dealMonth: '2026-08' }],
      transientFailures: [{ lawdCd: '26290', dealMonth: '2026-09' }],
    });
    const deps = buildDeps(sink, transport.fetch);

    const result = await runMolitIngestion(
      {
        endpoint,
        serviceKey: 'fixture',
        regions: SAMPLE_REGIONS,
        lawdCds: ['26290', '26350'],
        endMonth: '2026-09',
        months: 2,
        jobType: 'incremental',
        triggeredBy: 'test',
        numOfRows: 100,
      },
      deps,
    );

    expect(result.run.status).toBe('partial');
    expect(result.run.taskTotal).toBe(4);
    expect(result.run.taskSucceeded).toBe(3);
    expect(result.run.taskFailed).toBe(1);
    expect(result.run.errorSummary).toContain('26350/2026-08');
    expect(result.run.retryCount).toBe(4); // 일시 오류 1회 + 상시 실패 3회
    expect(result.run.recordsUpserted).toBeGreaterThan(0);
    expect(sink.deadLetters.size).toBe(1);
    const deadLetter = [...sink.deadLetters.values()][0]!;
    expect(deadLetter.sourceId).toBe(SOURCE_IDS.molitAptTrade);
    expect(deadLetter.attempts).toBe(4);
    expect(deadLetter.resolvedAt).toBeNull();
    expect(sink.runs.get(result.run.runId)?.finishedAt).toBe('2026-11-19T02:00:00.000Z');
  });

  it('같은 기간을 다시 수집하면 신규 없이 갱신만 한다(멱등)', async () => {
    const sink = new MemorySink();
    const transport = createFixtureTransport();
    const deps = buildDeps(sink, transport.fetch);
    const options = {
      endpoint,
      serviceKey: 'fixture',
      regions: SAMPLE_REGIONS,
      lawdCds: ['26290'],
      endMonth: '2026-09',
      months: 1,
      jobType: 'incremental' as const,
      triggeredBy: 'test',
      numOfRows: 100,
    };

    const first = await runMolitIngestion(options, deps);
    expect(first.run.status).toBe('succeeded');
    const firstCount = sink.transactions.size;
    expect(firstCount).toBe(first.run.recordsUpserted);

    const second = await runMolitIngestion(options, deps);
    expect(second.run.status).toBe('succeeded');
    expect(sink.transactions.size).toBe(firstCount);
    expect(second.run.recordsUpserted).toBe(firstCount);
  });

  it('모든 태스크가 실패하면 failed로 마감한다', async () => {
    const sink = new MemorySink();
    const transport = createFixtureTransport({ hardFailures: [{ lawdCd: '26290' }] });
    const result = await runMolitIngestion(
      {
        endpoint,
        serviceKey: 'fixture',
        regions: SAMPLE_REGIONS,
        lawdCds: ['26290'],
        endMonth: '2026-09',
        months: 2,
        jobType: 'backfill',
        triggeredBy: 'test',
      },
      buildDeps(sink, transport.fetch),
    );
    expect(result.run.status).toBe('failed');
    expect(result.run.taskFailed).toBe(2);
    expect(sink.deadLetters.size).toBe(2);
  });

  it('DLQ 재시도가 성공하면 해결 처리하고 거래를 반영한다', async () => {
    const sink = new MemorySink();
    const failing = createFixtureTransport({ hardFailures: [{ lawdCd: '26350', dealMonth: '2026-08' }] });
    const deps = buildDeps(sink, failing.fetch);
    await runMolitIngestion(
      {
        endpoint,
        serviceKey: 'fixture',
        regions: SAMPLE_REGIONS,
        lawdCds: ['26350'],
        endMonth: '2026-09',
        months: 2,
        jobType: 'incremental',
        triggeredBy: 'test',
      },
      deps,
    );

    const entry = [...sink.deadLetters.values()][0]!;
    const before = sink.transactions.size;
    const retry = await retryMolitDeadLetter(
      entry,
      { endpoint, serviceKey: 'fixture', regions: SAMPLE_REGIONS },
      buildDeps(sink, createFixtureTransport().fetch),
    );

    expect(retry.resolved).toBe(true);
    expect(retry.transactions.length).toBeGreaterThan(0);
    expect(sink.transactions.size).toBeGreaterThan(before);
    expect(sink.deadLetters.get(entry.id)?.resolvedAt).not.toBeNull();
  });
});

describe('runEcosIngestion', () => {
  it('지표 시계열을 정규화해 적재한다', async () => {
    const sink = new MemorySink();
    const transport = createFixtureTransport();
    const result = await runEcosIngestion(
      {
        endpoint: 'https://ecos.bok.or.kr/api',
        apiKey: 'fixture',
        endMonth: '2026-09',
        months: 2,
        jobType: 'incremental',
        triggeredBy: 'test',
      },
      buildDeps(sink, transport.fetch),
    );
    expect(result.run.status).toBe('succeeded');
    expect(result.run.recordsUpserted).toBeGreaterThan(0);
    expect(sink.macro.size).toBeGreaterThan(0);
    const [first] = [...sink.macro.values()];
    expect(first?.indicatorCode).toBeTruthy();
    expect(first?.periodDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('runMolitRentIngestion', () => {
  const rentEndpoint = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';

  it('전월세를 수집해 전세·월세 건수를 나눠 기록하고 멱등 업서트한다', async () => {
    const sink = new MemorySink();
    await sink.saveRegions(SAMPLE_REGIONS);
    const transport = createFixtureTransport();
    const deps = buildDeps(sink, transport.fetch);

    const options = {
      endpoint: rentEndpoint,
      serviceKey: 'fixture',
      regions: SAMPLE_REGIONS,
      lawdCds: ['26290', '26500'],
      endMonth: '2026-09',
      months: 2,
      jobType: 'incremental' as const,
      triggeredBy: 'test',
      numOfRows: 100,
    };
    const first = await runMolitRentIngestion(options, deps);
    expect(first.run.sourceId).toBe(SOURCE_IDS.molitAptRent);
    expect(first.run.status).toBe('succeeded');
    expect(first.run.taskTotal).toBe(4);
    expect(first.run.recordsUpserted).toBeGreaterThan(0);
    expect(first.jeonseCount).toBeGreaterThan(0);
    expect(first.monthlyCount).toBeGreaterThan(0);
    expect(sink.rentTransactions.size).toBe(first.run.recordsUpserted);
    expect([...sink.rentTransactions.values()].every((row) => row.sourceId === SOURCE_IDS.molitAptRent)).toBe(true);

    const second = await runMolitRentIngestion(options, deps);
    expect(second.run.recordsUpserted).toBe(first.run.recordsUpserted);
    expect(sink.rentTransactions.size).toBe(first.run.recordsUpserted);
  });

  it('실패한 (지역, 월)은 DLQ에 적재하고 retry로 해결한다', async () => {
    const sink = new MemorySink();
    await sink.saveRegions(SAMPLE_REGIONS);
    const transport = createFixtureTransport({ hardFailures: [{ lawdCd: '26350', dealMonth: '2026-09' }] });
    const deps = buildDeps(sink, transport.fetch);
    const result = await runMolitRentIngestion(
      {
        endpoint: rentEndpoint,
        serviceKey: 'fixture',
        regions: SAMPLE_REGIONS,
        lawdCds: ['26350'],
        endMonth: '2026-09',
        months: 1,
        jobType: 'incremental',
        triggeredBy: 'test',
      },
      deps,
    );
    expect(result.run.status).toBe('failed');
    expect(sink.deadLetters.size).toBe(1);
    const entry = [...sink.deadLetters.values()][0]!;
    expect(entry.sourceId).toBe(SOURCE_IDS.molitAptRent);
    expect(entry.id.startsWith('dlq_rent_')).toBe(true);

    const retried = await retryMolitRentDeadLetter(
      entry,
      { endpoint: rentEndpoint, serviceKey: 'fixture', regions: SAMPLE_REGIONS },
      { ...deps, http: new HttpClient({ fetchImpl: createFixtureTransport().fetch }) },
    );
    expect(retried.resolved).toBe(true);
    expect(retried.transactions.length).toBeGreaterThan(0);
    expect(sink.deadLetters.get(entry.id)?.resolvedAt).toBeTruthy();
  });
});
