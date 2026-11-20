import type { Queryable } from './queryable';
import {
  MACRO_UPSERT_SQL,
  RENT_UPSERT_SQL,
  TRANSACTION_UPSERT_SQL,
  macroParams,
  rentParams,
  transactionParams,
  type IngestionSink,
  type UpsertResult,
} from '../sink';
import type {
  ApartmentComplex,
  AptRentTransaction,
  AptTransaction,
  DeadLetterEntry,
  MacroIndicator,
  PipelineRun,
  PipelineRunTask,
  Region,
} from '@prop/shared';

export class PgSink implements IngestionSink {
  constructor(private readonly db: Queryable) {}

  async saveRegions(regions: Region[]): Promise<number> {
    let count = 0;
    for (const region of regions) {
      const result = await this.db.query(
        `INSERT INTO regions (legal_dong_code, lawd_cd, sido, sigungu, dong)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (legal_dong_code) DO UPDATE
           SET lawd_cd = EXCLUDED.lawd_cd, sido = EXCLUDED.sido, sigungu = EXCLUDED.sigungu, dong = EXCLUDED.dong`,
        [region.legalDongCode, region.lawdCd, region.sido, region.sigungu, region.dong],
      );
      count += 1;
      void result;
    }
    return count;
  }

  async saveComplexes(complexes: ApartmentComplex[]): Promise<number> {
    let count = 0;
    for (const complex of complexes) {
      await this.db.query(
        `INSERT INTO apartment_complexes
           (complex_id, name, legal_dong_code, lawd_cd, built_year, households, representative_area_m2)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (complex_id) DO UPDATE
           SET name = EXCLUDED.name,
               legal_dong_code = EXCLUDED.legal_dong_code,
               lawd_cd = EXCLUDED.lawd_cd,
               built_year = EXCLUDED.built_year,
               households = EXCLUDED.households,
               representative_area_m2 = EXCLUDED.representative_area_m2`,
        [
          complex.complexId,
          complex.name,
          complex.legalDongCode,
          complex.lawdCd,
          complex.builtYear,
          complex.households,
          complex.representativeAreaM2,
        ],
      );
      count += 1;
    }
    return count;
  }

  async upsertTransactions(rows: AptTransaction[]): Promise<UpsertResult> {
    const result: UpsertResult = { inserted: 0, updated: 0 };
    for (const row of rows) {
      const { rows: returning } = await this.db.query<{ inserted: boolean }>(TRANSACTION_UPSERT_SQL, transactionParams(row));
      if (returning[0]?.inserted) result.inserted += 1;
      else result.updated += 1;
    }
    return result;
  }

  async upsertRentTransactions(rows: AptRentTransaction[]): Promise<UpsertResult> {
    const result: UpsertResult = { inserted: 0, updated: 0 };
    for (const row of rows) {
      const { rows: returning } = await this.db.query<{ inserted: boolean }>(RENT_UPSERT_SQL, rentParams(row));
      if (returning[0]?.inserted) result.inserted += 1;
      else result.updated += 1;
    }
    return result;
  }

  async upsertMacro(rows: MacroIndicator[]): Promise<UpsertResult> {
    const result: UpsertResult = { inserted: 0, updated: 0 };
    for (const row of rows) {
      const { rows: returning } = await this.db.query<{ inserted: boolean }>(MACRO_UPSERT_SQL, macroParams(row));
      if (returning[0]?.inserted) result.inserted += 1;
      else result.updated += 1;
    }
    return result;
  }

  async startRun(run: PipelineRun): Promise<void> {
    await this.db.query(
      `INSERT INTO pipeline_runs (run_id, source_id, job_type, status, started_at, finished_at, requested_months,
         task_total, task_succeeded, task_failed, records_upserted, records_skipped, retry_count, error_summary, triggered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (run_id) DO UPDATE
         SET status = EXCLUDED.status, finished_at = EXCLUDED.finished_at, task_total = EXCLUDED.task_total,
             task_succeeded = EXCLUDED.task_succeeded, task_failed = EXCLUDED.task_failed,
             records_upserted = EXCLUDED.records_upserted, records_skipped = EXCLUDED.records_skipped,
             retry_count = EXCLUDED.retry_count, error_summary = EXCLUDED.error_summary`,
      [
        run.runId,
        run.sourceId,
        run.jobType,
        run.status,
        run.startedAt,
        run.finishedAt,
        run.requestedMonths,
        run.taskTotal,
        run.taskSucceeded,
        run.taskFailed,
        run.recordsUpserted,
        run.recordsSkipped,
        run.retryCount,
        run.errorSummary,
        run.triggeredBy,
      ],
    );
  }

  async finishRun(run: PipelineRun): Promise<void> {
    await this.db.query(
      `UPDATE pipeline_runs
          SET status = $2, finished_at = $3, task_total = $4, task_succeeded = $5, task_failed = $6,
              records_upserted = $7, records_skipped = $8, retry_count = $9, error_summary = $10
        WHERE run_id = $1`,
      [
        run.runId,
        run.status,
        run.finishedAt,
        run.taskTotal,
        run.taskSucceeded,
        run.taskFailed,
        run.recordsUpserted,
        run.recordsSkipped,
        run.retryCount,
        run.errorSummary,
      ],
    );
  }

  async saveTask(task: PipelineRunTask): Promise<void> {
    if (task.lawdCd === null) {
      await this.db.query(
        `INSERT INTO pipeline_run_tasks (run_id, source_id, lawd_cd, period, status, attempts, records, error)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)
         ON CONFLICT (run_id, period) WHERE lawd_cd IS NULL DO UPDATE
           SET status = EXCLUDED.status, attempts = EXCLUDED.attempts, records = EXCLUDED.records,
               error = EXCLUDED.error, updated_at = now()`,
        [task.runId, task.sourceId, task.period, task.status, task.attempts, task.records, task.error],
      );
      return;
    }
    await this.db.query(
      `INSERT INTO pipeline_run_tasks (run_id, source_id, lawd_cd, period, status, attempts, records, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (run_id, lawd_cd, period) DO UPDATE
         SET status = EXCLUDED.status, attempts = EXCLUDED.attempts, records = EXCLUDED.records,
             error = EXCLUDED.error, updated_at = now()`,
      [task.runId, task.sourceId, task.lawdCd, task.period, task.status, task.attempts, task.records, task.error],
    );
  }

  async enqueueDeadLetter(entry: DeadLetterEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO dead_letter_queue (id, run_id, source_id, payload, error, attempts, next_retry_at, resolved_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
      [
        entry.id,
        entry.runId,
        entry.sourceId,
        JSON.stringify(entry.payload),
        entry.error,
        entry.attempts,
        entry.nextRetryAt,
        entry.resolvedAt,
      ],
    );
  }

  async resolveDeadLetter(id: string, resolvedAt: string): Promise<void> {
    await this.db.query('UPDATE dead_letter_queue SET resolved_at = $2 WHERE id = $1', [id, resolvedAt]);
  }
}
