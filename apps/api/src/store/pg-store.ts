import {
  aggregateMonthly,
  recentMonths,
  shiftMonth,
  type ApartmentComplex,
  type AptTransaction,
  type BehaviorEventRecord,
  type DeadLetterEntry,
  type MacroIndicator,
  type MonthlyPricePoint,
  type PipelineRun,
  type PipelineRunStatus,
  type PipelineRunTask,
  type Region,
  type SourceDescriptor,
} from '@prop/shared';
import type {
  EventFilter,
  EventInsertResult,
  EventStats,
  Store,
  TransactionFilter,
  TransactionPage,
} from './types';

/** pg Pool과 PGlite가 함께 만족하는 최소 인터페이스. 테스트에서 WASM PostgreSQL로 같은 SQL을 검증한다. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

interface TransactionRow {
  deal_hash: string;
  lawd_cd: string;
  legal_dong_code: string;
  dong: string;
  apt_name: string;
  complex_id: string | null;
  jibun: string | null;
  built_year: number | null;
  deal_month: string;
  deal_date: string | Date;
  floor: number | null;
  area_m2: string | number;
  price_krw: string | number;
  price_per_pyeong: string | number;
  deal_type: string;
  canceled: boolean;
  source_id: string;
  as_of_date: string | Date;
  collected_at: string | Date;
  source_note: string | null;
}

function toIsoDate(value: string | Date | null): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapTransaction(row: TransactionRow): AptTransaction {
  return {
    dealHash: row.deal_hash,
    lawdCd: row.lawd_cd,
    legalDongCode: row.legal_dong_code,
    dong: row.dong,
    aptName: row.apt_name,
    complexId: row.complex_id,
    jibun: row.jibun ?? '',
    builtYear: row.built_year === null ? null : Number(row.built_year),
    dealMonth: row.deal_month,
    dealDate: toIsoDate(row.deal_date),
    floor: row.floor === null ? null : Number(row.floor),
    areaM2: Number(row.area_m2),
    priceKrw: Number(row.price_krw),
    pricePerPyeong: Number(row.price_per_pyeong),
    dealType: row.deal_type,
    canceled: row.canceled,
    sourceId: row.source_id,
    asOfDate: toIsoDate(row.as_of_date),
    collectedAt: toIsoTimestamp(row.collected_at),
    sourceNote: row.source_note,
  };
}

export class PgStore implements Store {
  readonly kind = 'postgres' as const;

  constructor(private readonly db: Queryable) {}

  async listRegions(): Promise<Region[]> {
    const { rows } = await this.db.query<{
      legal_dong_code: string;
      lawd_cd: string;
      sido: string;
      sigungu: string;
      dong: string;
    }>('SELECT legal_dong_code, lawd_cd, sido, sigungu, dong FROM regions ORDER BY legal_dong_code');
    return rows.map((row) => ({
      legalDongCode: row.legal_dong_code,
      lawdCd: row.lawd_cd,
      sido: row.sido,
      sigungu: row.sigungu,
      dong: row.dong,
    }));
  }

  async listComplexes(): Promise<ApartmentComplex[]> {
    const { rows } = await this.db.query<{
      complex_id: string;
      name: string;
      legal_dong_code: string;
      lawd_cd: string;
      built_year: number | null;
      households: number | null;
      representative_area_m2: string | null;
    }>(
      `SELECT complex_id, name, legal_dong_code, lawd_cd, built_year, households, representative_area_m2
         FROM apartment_complexes
        ORDER BY legal_dong_code, name`,
    );
    return rows.map((row) => ({
      complexId: row.complex_id,
      name: row.name,
      legalDongCode: row.legal_dong_code,
      lawdCd: row.lawd_cd,
      builtYear: row.built_year === null ? 0 : Number(row.built_year),
      households: row.households === null ? 0 : Number(row.households),
      representativeAreaM2: row.representative_area_m2 === null ? 0 : Number(row.representative_area_m2),
    }));
  }

  async listTransactions(filter: TransactionFilter): Promise<TransactionPage> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    if (!filter.includeCanceled) conditions.push('t.canceled = false');
    if (filter.lawdCd) conditions.push(`t.lawd_cd = ${bind(filter.lawdCd)}`);
    if (filter.legalDongCode) conditions.push(`t.legal_dong_code = ${bind(filter.legalDongCode)}`);
    if (filter.dong) conditions.push(`r.dong = ${bind(filter.dong)}`);
    if (filter.aptName) conditions.push(`t.apt_name ILIKE ${bind(`%${filter.aptName}%`)}`);
    if (filter.complexIds && filter.complexIds.length > 0) conditions.push(`t.complex_id = ANY(${bind(filter.complexIds)}::text[])`);
    if (filter.fromMonth) conditions.push(`t.deal_month >= ${bind(filter.fromMonth)}`);
    if (filter.toMonth) conditions.push(`t.deal_month <= ${bind(filter.toMonth)}`);
    if (filter.minPriceKrw !== undefined) conditions.push(`t.price_krw >= ${bind(filter.minPriceKrw)}`);
    if (filter.maxPriceKrw !== undefined) conditions.push(`t.price_krw <= ${bind(filter.maxPriceKrw)}`);
    if (filter.minAreaM2 !== undefined) conditions.push(`t.area_m2 >= ${bind(filter.minAreaM2)}`);
    if (filter.maxAreaM2 !== undefined) conditions.push(`t.area_m2 <= ${bind(filter.maxAreaM2)}`);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy: Record<NonNullable<TransactionFilter['sort']>, string> = {
      deal_date_desc: 't.deal_date DESC, t.deal_hash DESC',
      price_desc: 't.price_krw DESC',
      price_asc: 't.price_krw ASC',
      ppp_desc: 't.price_per_pyeong DESC',
    };

    const limitParam = bind(filter.limit);
    const offsetParam = bind(filter.offset);

    const { rows } = await this.db.query<TransactionRow & { total_count: string }>(
      `SELECT t.*, r.dong, count(*) OVER () AS total_count
         FROM apt_transactions t
         JOIN regions r ON r.legal_dong_code = t.legal_dong_code
         ${where}
        ORDER BY ${orderBy[filter.sort ?? 'deal_date_desc']}
        LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params,
    );

    return {
      rows: rows.map(mapTransaction),
      total: rows.length === 0 ? (await this.countTransactions(where, params.slice(0, params.length - 2))) : Number(rows[0]!.total_count),
    };
  }

  private async countTransactions(where: string, params: unknown[]): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM apt_transactions t
         JOIN regions r ON r.legal_dong_code = t.legal_dong_code
         ${where}`,
      params,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async monthlySeries(params: { legalDongCode?: string; lawdCd?: string; months: number }): Promise<MonthlyPricePoint[]> {
    const scope: string[] = [];
    const values: unknown[] = [];
    if (params.legalDongCode) {
      values.push(params.legalDongCode);
      scope.push(`legal_dong_code = $${values.length}`);
    } else if (params.lawdCd) {
      values.push(params.lawdCd);
      scope.push(`lawd_cd = $${values.length}`);
    }
    const scopeSql = scope.length > 0 ? `AND ${scope.join(' AND ')}` : '';
    const { rows: latestRows } = await this.db.query<{ latest: string | null }>(
      `SELECT max(deal_month) AS latest FROM apt_transactions WHERE canceled = false ${scopeSql}`,
      values,
    );
    const latest = latestRows[0]?.latest ?? shiftMonth(new Date().toISOString().slice(0, 7), -1);
    const months = recentMonths(latest, params.months);

    const { rows } = await this.db.query<{
      month: string;
      sample_count: string;
      median_price_krw: string;
      median_price_per_pyeong: string;
      median_area_m2: string;
      total_volume_krw: string;
    }>(
      `SELECT deal_month AS month,
              count(*)::text AS sample_count,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY price_krw)::bigint::text AS median_price_krw,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_pyeong)::bigint::text AS median_price_per_pyeong,
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY area_m2)::numeric, 1)::text AS median_area_m2,
              sum(price_krw)::bigint::text AS total_volume_krw
         FROM apt_transactions
        WHERE canceled = false
          AND deal_month BETWEEN $${values.length + 1} AND $${values.length + 2}
          ${scopeSql}
        GROUP BY deal_month
        ORDER BY deal_month`,
      [...values, months[0], months[months.length - 1]],
    );

    const byMonth = new Map(rows.map((row) => [row.month, row]));
    return months.map((month) => {
      const row = byMonth.get(month);
      return {
        month,
        sampleCount: row ? Number(row.sample_count) : 0,
        medianPriceKrw: row ? Number(row.median_price_krw) : 0,
        medianPricePerPyeong: row ? Number(row.median_price_per_pyeong) : 0,
        medianAreaM2: row ? Number(row.median_area_m2) : 0,
        totalVolumeKrw: row ? Number(row.total_volume_krw) : 0,
      };
    });
  }

  async complexMonthly(complexId: string, months: number): Promise<MonthlyPricePoint[]> {
    const { rows: latestRows } = await this.db.query<{ latest: string | null }>(
      'SELECT max(deal_month) AS latest FROM apt_transactions WHERE complex_id = $1 AND canceled = false',
      [complexId],
    );
    const latest = latestRows[0]?.latest ?? shiftMonth(new Date().toISOString().slice(0, 7), -1);
    const monthList = recentMonths(latest, months);
    const { rows } = await this.db.query<{
      month: string;
      sample_count: string;
      median_price_krw: string;
      median_price_per_pyeong: string;
      median_area_m2: string;
      total_volume_krw: string;
    }>(
      `SELECT deal_month AS month,
              count(*)::text AS sample_count,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY price_krw)::bigint::text AS median_price_krw,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_pyeong)::bigint::text AS median_price_per_pyeong,
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY area_m2)::numeric, 1)::text AS median_area_m2,
              sum(price_krw)::bigint::text AS total_volume_krw
         FROM apt_transactions
        WHERE canceled = false AND complex_id = $1 AND deal_month BETWEEN $2 AND $3
        GROUP BY deal_month`,
      [complexId, monthList[0], monthList[monthList.length - 1]],
    );
    const byMonth = new Map(rows.map((row) => [row.month, row]));
    return monthList.map((month) => {
      const row = byMonth.get(month);
      return {
        month,
        sampleCount: row ? Number(row.sample_count) : 0,
        medianPriceKrw: row ? Number(row.median_price_krw) : 0,
        medianPricePerPyeong: row ? Number(row.median_price_per_pyeong) : 0,
        medianAreaM2: row ? Number(row.median_area_m2) : 0,
        totalVolumeKrw: row ? Number(row.total_volume_krw) : 0,
      };
    });
  }

  async listMacro(params: { codes?: string[]; from?: string; to?: string }): Promise<MacroIndicator[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (params.codes && params.codes.length > 0) {
      values.push(params.codes);
      conditions.push(`indicator_code = ANY($${values.length}::text[])`);
    }
    if (params.from) {
      values.push(params.from);
      conditions.push(`period_date >= $${values.length}`);
    }
    if (params.to) {
      values.push(params.to);
      conditions.push(`period_date <= $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.db.query<{
      indicator_code: string;
      indicator_name: string;
      period_date: string;
      period: string;
      value: string;
      unit: string;
      source_id: string;
      as_of_date: string;
      collected_at: string;
    }>(
      `SELECT indicator_code, indicator_name, period_date, to_char(period_date, 'YYYY-MM') AS period,
              value::text AS value, unit, source_id, as_of_date, collected_at
         FROM macro_indicators
         ${where}
        ORDER BY indicator_code, period_date`,
      values,
    );
    return rows.map((row) => ({
      indicatorCode: row.indicator_code,
      indicatorName: row.indicator_name,
      periodDate: toIsoDate(row.period_date),
      period: row.period,
      value: Number(row.value),
      unit: row.unit,
      sourceId: row.source_id,
      asOfDate: toIsoDate(row.as_of_date),
      collectedAt: toIsoTimestamp(row.collected_at),
    }));
  }

  async listSources(): Promise<SourceDescriptor[]> {
    const { rows } = await this.db.query<{
      source_id: string;
      name: string;
      provider: string;
      endpoint: string;
      license: string;
      update_cycle: string;
      as_of_policy: string;
      requires_key: boolean;
    }>(
      `SELECT source_id, name, provider, endpoint, license, update_cycle, as_of_policy, requires_key
         FROM ingestion_sources ORDER BY source_id`,
    );
    return rows.map((row) => ({
      sourceId: row.source_id,
      name: row.name,
      provider: row.provider,
      endpoint: row.endpoint,
      license: row.license,
      updateCycle: row.update_cycle,
      asOfPolicy: row.as_of_policy,
      requiresKey: row.requires_key,
    }));
  }

  async listPipelineRuns(limit: number): Promise<PipelineRun[]> {
    const { rows } = await this.db.query<PipelineRunRow>(
      `SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map(mapRun);
  }

  async getPipelineRun(runId: string): Promise<PipelineRun | null> {
    const { rows } = await this.db.query<PipelineRunRow>('SELECT * FROM pipeline_runs WHERE run_id = $1', [runId]);
    return rows[0] ? mapRun(rows[0]) : null;
  }

  async listRunTasks(runId: string): Promise<PipelineRunTask[]> {
    const { rows } = await this.db.query<{
      run_id: string;
      source_id: string;
      lawd_cd: string | null;
      period: string;
      status: PipelineRunTask['status'];
      attempts: number;
      records: number;
      error: string | null;
      updated_at: string;
    }>('SELECT * FROM pipeline_run_tasks WHERE run_id = $1 ORDER BY lawd_cd, period', [runId]);
    return rows.map((row) => ({
      runId: row.run_id,
      sourceId: row.source_id,
      lawdCd: row.lawd_cd,
      period: row.period,
      status: row.status,
      attempts: Number(row.attempts),
      records: Number(row.records),
      error: row.error,
      updatedAt: toIsoTimestamp(row.updated_at),
    }));
  }

  async listDeadLetters(): Promise<DeadLetterEntry[]> {
    const { rows } = await this.db.query<{
      id: string;
      run_id: string;
      source_id: string;
      payload: Record<string, unknown>;
      error: string;
      attempts: number;
      next_retry_at: string;
      resolved_at: string | null;
    }>(
      `SELECT id, run_id, source_id, payload, error, attempts, next_retry_at, resolved_at
         FROM dead_letter_queue ORDER BY next_retry_at`,
    );
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      sourceId: row.source_id,
      payload: row.payload,
      error: row.error,
      attempts: Number(row.attempts),
      nextRetryAt: toIsoTimestamp(row.next_retry_at),
      resolvedAt: row.resolved_at ? toIsoTimestamp(row.resolved_at) : null,
    }));
  }

  async insertBehaviorEvents(records: BehaviorEventRecord[]): Promise<EventInsertResult> {
    if (records.length === 0) return { inserted: 0, duplicates: 0 };

    const dates = [...new Set(records.map((record) => record.occurredAt.slice(0, 10)))];
    for (const date of dates) {
      await this.db.query('SELECT ensure_behavior_partition($1::date)', [date]);
    }

    const columns = [
      'event_id',
      'name',
      'occurred_at',
      'occurred_date',
      'session_id',
      'user_pseudo_id',
      'page',
      'props',
      'schema_version',
      'app_env',
    ];
    const params: unknown[] = [];
    const tuples = records.map((record) => {
      const placeholders = [
        params.push(record.eventId),
        params.push(record.name),
        params.push(record.occurredAt),
        params.push(record.occurredAt.slice(0, 10)),
        params.push(record.sessionId),
        params.push(record.userPseudoId),
        params.push(record.page),
        params.push(JSON.stringify(record.props)),
        params.push(record.schemaVersion),
        params.push(record.appEnv),
      ];
      return `(${placeholders.map((index) => `$${index}`).join(', ')})`;
    });

    const insertSql = `INSERT INTO user_behavior_events (${columns.join(', ')})
      VALUES ${tuples.join(', ')}
      ON CONFLICT (event_id, occurred_date) DO NOTHING
      RETURNING event_id`;

    const { rows } = await this.db.query<{ event_id: string }>(insertSql, params);
    return { inserted: rows.length, duplicates: records.length - rows.length };
  }

  async listBehaviorEvents(filter: EventFilter): Promise<{ rows: BehaviorEventRecord[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.name) {
      params.push(filter.name);
      conditions.push(`name = $${params.length}`);
    }
    if (filter.sessionId) {
      params.push(filter.sessionId);
      conditions.push(`session_id = $${params.length}`);
    }
    if (filter.date) {
      params.push(filter.date);
      conditions.push(`occurred_date = $${params.length}::date`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(filter.limit, filter.offset);
    const { rows } = await this.db.query<{
      event_id: string;
      name: BehaviorEventRecord['name'];
      occurred_at: string;
      received_at: string;
      session_id: string;
      user_pseudo_id: string;
      page: string;
      props: Record<string, unknown>;
      schema_version: string;
      app_env: string;
      total_count: string;
    }>(
      `SELECT *, count(*) OVER () AS total_count
         FROM user_behavior_events
         ${where}
        ORDER BY occurred_at DESC, event_id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      total: rows.length === 0 ? 0 : Number(rows[0]!.total_count),
      rows: rows.map((row) => ({
        eventId: row.event_id,
        name: row.name,
        occurredAt: toIsoTimestamp(row.occurred_at),
        receivedAt: toIsoTimestamp(row.received_at),
        sessionId: row.session_id,
        userPseudoId: row.user_pseudo_id,
        page: row.page,
        props: row.props,
        schemaVersion: row.schema_version,
        appEnv: row.app_env,
      })),
    };
  }

  async eventStats(sinceIso: string): Promise<EventStats> {
    const { rows } = await this.db.query<{ name: string; total: string; sessions: string; last_received: string | null }>(
      `SELECT name, count(*)::text AS total, count(DISTINCT session_id)::text AS sessions, max(received_at) AS last_received
         FROM user_behavior_events
        WHERE occurred_at >= $1
        GROUP BY name`,
      [sinceIso],
    );
    const byName: Record<string, number> = {};
    let total = 0;
    let sessions = 0;
    let lastReceivedAt: string | null = null;
    for (const row of rows) {
      const count = Number(row.total);
      byName[row.name] = count;
      total += count;
      sessions = Math.max(sessions, Number(row.sessions));
      if (row.last_received && (!lastReceivedAt || toIsoTimestamp(row.last_received) > lastReceivedAt)) {
        lastReceivedAt = toIsoTimestamp(row.last_received);
      }
    }
    return { total, sessions, byName, lastReceivedAt };
  }

  async close(): Promise<void> {
    const candidate = this.db as unknown as { end?: () => Promise<void> };
    if (typeof candidate.end === 'function') await candidate.end();
  }
}

interface PipelineRunRow {
  run_id: string;
  source_id: string;
  job_type: PipelineRun['jobType'];
  status: PipelineRunStatus;
  started_at: string;
  finished_at: string | null;
  requested_months: number;
  task_total: number;
  task_succeeded: number;
  task_failed: number;
  records_upserted: number;
  records_skipped: number;
  retry_count: number;
  error_summary: string | null;
  triggered_by: string;
}

function mapRun(row: PipelineRunRow): PipelineRun {
  return {
    runId: row.run_id,
    sourceId: row.source_id,
    jobType: row.job_type,
    status: row.status,
    startedAt: toIsoTimestamp(row.started_at),
    finishedAt: row.finished_at ? toIsoTimestamp(row.finished_at) : null,
    requestedMonths: Number(row.requested_months),
    taskTotal: Number(row.task_total),
    taskSucceeded: Number(row.task_succeeded),
    taskFailed: Number(row.task_failed),
    recordsUpserted: Number(row.records_upserted),
    recordsSkipped: Number(row.records_skipped),
    retryCount: Number(row.retry_count),
    errorSummary: row.error_summary,
    triggeredBy: row.triggered_by,
  };
}

export { aggregateMonthly };
