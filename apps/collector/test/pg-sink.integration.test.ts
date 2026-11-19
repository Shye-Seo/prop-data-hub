import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { SAMPLE_REGIONS, buildSampleTransactions } from '@prop/shared';
import { PgSink } from '../src/db/pg-sink';
import { MemorySink } from '../src/sink';
import type { Queryable } from '../src/db/queryable';
import { runMolitIngestion } from '../src/pipeline';
import { HttpClient } from '../src/http';
import { createFixtureTransport } from '../src/fixtures/transport';

const initSqlPath = fileURLToPath(new URL('../../../infra/postgres/init.sql', import.meta.url));

describe('PgSink (PGlite)', () => {
  let db: PGlite;
  let sink: PgSink;

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(readFileSync(initSqlPath, 'utf8'));
    sink = new PgSink({
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        const result = await db.query<T>(sql, params as unknown[]);
        return { rows: result.rows };
      },
    } satisfies Queryable);
    await sink.saveRegions(SAMPLE_REGIONS);
    await sink.saveComplexes([
      {
        complexId: 'MOLIT-26290-001',
        name: '문현베스티움',
        legalDongCode: '2629051000',
        lawdCd: '26290',
        builtYear: 2019,
        households: 743,
        representativeAreaM2: 84.98,
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('지역·단지를 업서트한다', async () => {
    const regions = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM regions');
    expect(Number(regions.rows[0]?.count)).toBe(3);
    const complexes = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM apartment_complexes');
    expect(Number(complexes.rows[0]?.count)).toBe(1);
  });

  it('거래를 멱등 업서트하고 신규/갱신 건수를 구분한다', async () => {
    const sample = buildSampleTransactions('2026-09', 1).filter((row) => row.complexId === 'MOLIT-26290-001');
    expect(sample.length).toBeGreaterThan(0);

    const first = await sink.upsertTransactions(sample);
    expect(first.inserted).toBe(sample.length);
    expect(first.updated).toBe(0);

    const second = await sink.upsertTransactions(sample);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(sample.length);

    const count = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM apt_transactions');
    expect(Number(count.rows[0]?.count)).toBe(sample.length);
  });

  it('파이프라인 실행과 태스크를 기록하고, 지역코드 없는 태스크도 중복 없이 갱신한다', async () => {
    const run = {
      runId: 'run_pg_001',
      sourceId: 'molit_apt_trade',
      jobType: 'incremental' as const,
      status: 'running' as const,
      startedAt: '2026-11-19T02:00:00.000Z',
      finishedAt: null,
      requestedMonths: 1,
      taskTotal: 1,
      taskSucceeded: 0,
      taskFailed: 0,
      recordsUpserted: 0,
      recordsSkipped: 0,
      retryCount: 0,
      errorSummary: null,
      triggeredBy: 'test',
    };
    await sink.startRun(run);
    await sink.finishRun({ ...run, status: 'succeeded', finishedAt: '2026-11-19T02:01:00.000Z', recordsUpserted: 12 });

    const stored = await db.query<{ status: string; records_upserted: number }>(
      'SELECT status, records_upserted FROM pipeline_runs WHERE run_id = $1',
      ['run_pg_001'],
    );
    expect(stored.rows[0]?.status).toBe('succeeded');
    expect(Number(stored.rows[0]?.records_upserted)).toBe(12);

    for (const records of [5, 7]) {
      await sink.saveTask({
        runId: 'run_pg_001',
        sourceId: 'ecos_rates',
        lawdCd: null,
        period: '2026-09',
        status: 'succeeded',
        attempts: 1,
        records,
        error: null,
        updatedAt: '2026-11-19T02:01:00.000Z',
      });
    }
    const tasks = await db.query<{ records: number }>(
      'SELECT records FROM pipeline_run_tasks WHERE run_id = $1 AND lawd_cd IS NULL',
      ['run_pg_001'],
    );
    expect(tasks.rows).toHaveLength(1);
    expect(Number(tasks.rows[0]?.records)).toBe(7);
  });

  it('DLQ를 적재하고 해결 상태를 갱신한다', async () => {
    await sink.enqueueDeadLetter({
      id: 'dlq_pg_001',
      runId: 'run_pg_001',
      sourceId: 'molit_apt_trade',
      payload: { lawdCd: '26350', dealMonth: '2026-09' },
      error: 'HTTP 504',
      attempts: 4,
      nextRetryAt: '2026-11-19T02:10:00.000Z',
      resolvedAt: null,
    });
    await sink.resolveDeadLetter('dlq_pg_001', '2026-11-19T02:11:00.000Z');
    const stored = await db.query<{ resolved_at: string | null; payload: unknown }>(
      'SELECT resolved_at, payload FROM dead_letter_queue WHERE id = $1',
      ['dlq_pg_001'],
    );
    expect(stored.rows[0]?.resolved_at).not.toBeNull();
    expect(stored.rows[0]?.payload).toMatchObject({ lawdCd: '26350' });
  });

  it('파이프라인을 실제 DB에 끝까지 실행하고 실행 이력을 남긴다', async () => {
    const transport = createFixtureTransport();
    const memory = new MemorySink();
    await memory.saveRegions(SAMPLE_REGIONS);
    const result = await runMolitIngestion(
      {
        endpoint: 'https://example.test/molit',
        serviceKey: 'fixture',
        regions: SAMPLE_REGIONS,
        lawdCds: ['26290'],
        endMonth: '2026-09',
        months: 1,
        jobType: 'incremental',
        triggeredBy: 'integration-test',
        numOfRows: 100,
      },
      {
        sink,
        http: new HttpClient({ fetchImpl: transport.fetch }),
        now: () => new Date('2026-11-19T03:00:00Z'),
        idFactory: () => 'run_pg_integration_001',
      },
    );

    expect(result.run.status).toBe('succeeded');
    expect(result.run.recordsUpserted).toBeGreaterThan(0);

    const runs = await db.query<{ run_id: string; task_total: number; task_succeeded: number }>(
      'SELECT run_id, task_total, task_succeeded FROM pipeline_runs WHERE run_id = $1',
      ['run_pg_integration_001'],
    );
    expect(runs.rows[0]).toMatchObject({ run_id: 'run_pg_integration_001' });
    expect(Number(runs.rows[0]?.task_total)).toBe(1);
    expect(Number(runs.rows[0]?.task_succeeded)).toBe(1);

    const tasks = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM pipeline_run_tasks WHERE run_id = $1',
      ['run_pg_integration_001'],
    );
    expect(Number(tasks.rows[0]?.count)).toBe(1);

    const quality = await db.query<{ total_rows: string }>('SELECT sum(total_rows)::text AS total_rows FROM v_ingestion_quality');
    expect(Number(quality.rows[0]?.total_rows)).toBeGreaterThan(0);
  });
});
