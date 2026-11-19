import {
  RETRY_POLICY,
  SOURCE_IDS,
  isCountableTransaction,
  recentMonths,
  type AptTransaction,
  type DeadLetterEntry,
  type MacroIndicator,
  type PipelineRun,
  type PipelineRunStatus,
  type PipelineRunTask,
  type Region,
} from '@prop/shared';
import { HttpClient, HttpError } from './http';
import type { IngestionSink, UpsertResult } from './sink';
import { collectMolitMonth } from './sources/molit';
import { collectEcosSeries, ECOS_INDICATORS, type EcosIndicatorSpec } from './sources/ecos';

export interface PipelineDeps {
  sink: IngestionSink;
  http: HttpClient;
  now?: () => Date;
  idFactory?: () => string;
  logger?: (message: string) => void;
  deadLetterRetryDelayMs?: number;
}

export interface RunSummary {
  run: PipelineRun;
  tasks: PipelineRunTask[];
  failures: Array<{ period: string; lawdCd: string | null; error: string }>;
  dealCount: number;
  canceledCount: number;
}

export interface MolitIngestionOptions {
  endpoint: string;
  serviceKey: string;
  regions: Region[];
  lawdCds: string[];
  endMonth: string;
  months: number;
  jobType: PipelineRun['jobType'];
  triggeredBy: string;
  numOfRows?: number;
  maxPages?: number;
}

function formatRunId(now: Date, source: string, idFactory?: () => string): string {
  if (idFactory) return idFactory();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `run_${stamp}_${source}_${suffix}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    return `${error.message} (attempts=${error.attempts})`;
  }
  return error instanceof Error ? error.message : String(error);
}

function toAttempts(error: unknown): number {
  return error instanceof HttpError ? error.attempts : 1;
}

function buildRunId(now: Date, prefix: string, idFactory?: () => string): string {
  return formatRunId(now, prefix, idFactory);
}

function finalizeStatus(total: number, failed: number): PipelineRunStatus {
  if (total === 0) return 'failed';
  if (failed === 0) return 'succeeded';
  if (failed === total) return 'failed';
  return 'partial';
}

export async function runMolitIngestion(
  options: MolitIngestionOptions,
  deps: PipelineDeps,
): Promise<RunSummary> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const months = recentMonths(options.endMonth, options.months).reverse();
  const runId = buildRunId(startedAt, 'molit', deps.idFactory);

  const tasks: PipelineRunTask[] = [];
  const failures: RunSummary['failures'] = [];
  let recordsUpserted = 0;
  let recordsSkipped = 0;
  let retryCount = 0;
  let dealCount = 0;
  let canceledCount = 0;

  const run: PipelineRun = {
    runId,
    sourceId: SOURCE_IDS.molitAptTrade,
    jobType: options.jobType,
    status: 'running',
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    requestedMonths: options.months,
    taskTotal: options.lawdCds.length * months.length,
    taskSucceeded: 0,
    taskFailed: 0,
    recordsUpserted: 0,
    recordsSkipped: 0,
    retryCount: 0,
    errorSummary: null,
    triggeredBy: options.triggeredBy,
  };
  await deps.sink.startRun(run);

  for (const lawdCd of options.lawdCds) {
    for (const dealMonth of months) {
      const taskBase = {
        runId,
        sourceId: SOURCE_IDS.molitAptTrade,
        lawdCd,
        period: dealMonth,
      };

      try {
        const result = await collectMolitMonth(
          {
            endpoint: options.endpoint,
            serviceKey: options.serviceKey,
            http: deps.http,
            regions: options.regions,
            numOfRows: options.numOfRows,
            maxPages: options.maxPages,
            now,
          },
          { lawdCd, dealMonth },
        );

        const upserted: UpsertResult = await deps.sink.upsertTransactions(result.transactions);
        recordsUpserted += upserted.inserted + upserted.updated;
        recordsSkipped += result.skipped.length;
        retryCount += result.retries;
        dealCount += result.transactions.length;
        canceledCount += result.transactions.filter((row) => !isCountableTransaction(row)).length;

        const task: PipelineRunTask = {
          ...taskBase,
          status: 'succeeded',
          attempts: 1,
          records: upserted.inserted + upserted.updated,
          error: null,
          updatedAt: now().toISOString(),
        };
        tasks.push(task);
        await deps.sink.saveTask(task);
        deps.logger?.(`[molit] ${lawdCd}/${dealMonth} ${task.records}건 반영 (신규 ${upserted.inserted}, 갱신 ${upserted.updated})`);
      } catch (error) {
        const message = toErrorMessage(error);
        const attempts = toAttempts(error);
        retryCount += Math.max(0, attempts - 1);
        failures.push({ period: dealMonth, lawdCd, error: message });

        const task: PipelineRunTask = {
          ...taskBase,
          status: 'failed',
          attempts,
          records: 0,
          error: message,
          updatedAt: now().toISOString(),
        };
        tasks.push(task);
        await deps.sink.saveTask(task);

        const deadLetter: DeadLetterEntry = {
          id: `dlq_${runId}_${lawdCd}_${dealMonth.replace('-', '')}`,
          runId,
          sourceId: SOURCE_IDS.molitAptTrade,
          payload: { lawdCd, dealMonth, numOfRows: options.numOfRows ?? 100, maxPages: options.maxPages ?? 20 },
          error: message,
          attempts,
          nextRetryAt: new Date(now().getTime() + (deps.deadLetterRetryDelayMs ?? 60_000)).toISOString(),
          resolvedAt: null,
        };
        await deps.sink.enqueueDeadLetter(deadLetter);
        deps.logger?.(`[molit] ${lawdCd}/${dealMonth} 실패: ${message} → DLQ`);
      }
    }
  }

  const finished: PipelineRun = {
    ...run,
    status: finalizeStatus(run.taskTotal, failures.length),
    finishedAt: now().toISOString(),
    taskSucceeded: run.taskTotal - failures.length,
    taskFailed: failures.length,
    recordsUpserted,
    recordsSkipped,
    retryCount,
    errorSummary:
      failures.length === 0
        ? null
        : failures
            .slice(0, 3)
            .map((failure) => `${failure.lawdCd}/${failure.period} ${failure.error}`)
            .join(' | '),
  };
  await deps.sink.finishRun(finished);

  return { run: finished, tasks, failures, dealCount, canceledCount };
}

export interface EcosIngestionOptions {
  endpoint: string;
  apiKey: string;
  endMonth: string;
  months: number;
  specs?: EcosIndicatorSpec[];
  jobType: PipelineRun['jobType'];
  triggeredBy: string;
}

export async function runEcosIngestion(
  options: EcosIngestionOptions,
  deps: PipelineDeps,
): Promise<RunSummary> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const specs = options.specs ?? ECOS_INDICATORS;
  const monthList = recentMonths(options.endMonth, options.months);
  const runId = buildRunId(startedAt, 'ecos', deps.idFactory);

  const failures: RunSummary['failures'] = [];
  const tasks: PipelineRunTask[] = [];
  let recordsUpserted = 0;
  let retryCount = 0;

  const run: PipelineRun = {
    runId,
    sourceId: SOURCE_IDS.ecosRates,
    jobType: options.jobType,
    status: 'running',
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    requestedMonths: options.months,
    taskTotal: specs.length,
    taskSucceeded: 0,
    taskFailed: 0,
    recordsUpserted: 0,
    recordsSkipped: 0,
    retryCount: 0,
    errorSummary: null,
    triggeredBy: options.triggeredBy,
  };
  await deps.sink.startRun(run);

  for (const spec of specs) {
    const period = monthList[monthList.length - 1]!;
    try {
      const result = await collectEcosSeries(
        { endpoint: options.endpoint, apiKey: options.apiKey, http: deps.http, now },
        spec,
        {
          startPeriod: monthList[0]!.replace('-', ''),
          endPeriod: period.replace('-', ''),
        },
      );
      const upserted = await deps.sink.upsertMacro(result.indicators);
      recordsUpserted += upserted.inserted + upserted.updated;
      retryCount += result.retries;
      const task: PipelineRunTask = {
        runId,
        sourceId: SOURCE_IDS.ecosRates,
        lawdCd: null,
        period,
        status: 'succeeded',
        attempts: 1,
        records: upserted.inserted + upserted.updated,
        error: null,
        updatedAt: now().toISOString(),
      };
      tasks.push(task);
      await deps.sink.saveTask(task);
    } catch (error) {
      const message = toErrorMessage(error);
      const attempts = toAttempts(error);
      retryCount += Math.max(0, attempts - 1);
      failures.push({ period, lawdCd: null, error: `${spec.indicatorCode}: ${message}` });
      const task: PipelineRunTask = {
        runId,
        sourceId: SOURCE_IDS.ecosRates,
        lawdCd: null,
        period,
        status: 'failed',
        attempts,
        records: 0,
        error: message,
        updatedAt: now().toISOString(),
      };
      tasks.push(task);
      await deps.sink.saveTask(task);
      await deps.sink.enqueueDeadLetter({
        id: `dlq_${runId}_${spec.indicatorCode}`,
        runId,
        sourceId: SOURCE_IDS.ecosRates,
        payload: { indicatorCode: spec.indicatorCode, statCode: spec.statCode, months: options.months },
        error: message,
        attempts,
        nextRetryAt: new Date(now().getTime() + (deps.deadLetterRetryDelayMs ?? 60_000)).toISOString(),
        resolvedAt: null,
      });
    }
  }

  const finished: PipelineRun = {
    ...run,
    status: finalizeStatus(run.taskTotal, failures.length),
    finishedAt: now().toISOString(),
    taskSucceeded: run.taskTotal - failures.length,
    taskFailed: failures.length,
    recordsUpserted,
    recordsSkipped: 0,
    retryCount,
    errorSummary: failures.length === 0 ? null : failures.map((failure) => failure.error).join(' | '),
  };
  await deps.sink.finishRun(finished);

  return { run: finished, tasks, failures, dealCount: 0, canceledCount: 0 };
}

/** DLQ에 쌓인 실거래 수집 실패 건을 다시 시도하고, 성공하면 해결 처리한다. */
export async function retryMolitDeadLetter(
  entry: DeadLetterEntry,
  options: { endpoint: string; serviceKey: string; regions: Region[] },
  deps: PipelineDeps,
): Promise<{ resolved: boolean; transactions: AptTransaction[]; error?: string }> {
  const payload = entry.payload as { lawdCd?: string; dealMonth?: string };
  if (!payload.lawdCd || !payload.dealMonth) {
    return { resolved: false, transactions: [], error: 'invalid_payload' };
  }
  const now = deps.now ?? (() => new Date());
  try {
    const result = await collectMolitMonth(
      { ...options, http: deps.http, now },
      { lawdCd: payload.lawdCd, dealMonth: payload.dealMonth },
    );
    await deps.sink.upsertTransactions(result.transactions);
    await deps.sink.resolveDeadLetter(entry.id, now().toISOString());
    return { resolved: true, transactions: result.transactions };
  } catch (error) {
    return { resolved: false, transactions: [], error: toErrorMessage(error) };
  }
}

export interface MacroRetryResult {
  resolved: boolean;
  indicators: MacroIndicator[];
  error?: string;
}

export async function retryEcosDeadLetter(
  entry: DeadLetterEntry,
  options: { endpoint: string; apiKey: string },
  deps: PipelineDeps,
): Promise<MacroRetryResult> {
  const payload = entry.payload as { indicatorCode?: string };
  const spec = ECOS_INDICATORS.find((row) => row.indicatorCode === payload.indicatorCode);
  if (!spec) return { resolved: false, indicators: [], error: 'unknown_indicator' };
  const now = deps.now ?? (() => new Date());
  try {
    const result = await collectEcosSeries(
      { ...options, http: deps.http, now },
      spec,
      { startPeriod: '202401', endPeriod: now().toISOString().slice(0, 7).replace('-', '') },
    );
    await deps.sink.upsertMacro(result.indicators);
    await deps.sink.resolveDeadLetter(entry.id, now().toISOString());
    return { resolved: true, indicators: result.indicators };
  } catch (error) {
    return { resolved: false, indicators: [], error: toErrorMessage(error) };
  }
}

export { RETRY_POLICY, HttpClient };
