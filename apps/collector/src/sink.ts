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

export interface UpsertResult {
  inserted: number;
  updated: number;
}

export interface IngestionSink {
  saveRegions(regions: Region[]): Promise<number>;
  saveComplexes(complexes: ApartmentComplex[]): Promise<number>;
  upsertTransactions(rows: AptTransaction[]): Promise<UpsertResult>;
  upsertRentTransactions(rows: AptRentTransaction[]): Promise<UpsertResult>;
  upsertMacro(rows: MacroIndicator[]): Promise<UpsertResult>;
  startRun(run: PipelineRun): Promise<void>;
  finishRun(run: PipelineRun): Promise<void>;
  saveTask(task: PipelineRunTask): Promise<void>;
  enqueueDeadLetter(entry: DeadLetterEntry): Promise<void>;
  resolveDeadLetter(id: string, resolvedAt: string): Promise<void>;
}

export const TRANSACTION_COLUMNS = [
  'deal_hash',
  'lawd_cd',
  'legal_dong_code',
  'apt_name',
  'complex_id',
  'jibun',
  'built_year',
  'deal_month',
  'deal_date',
  'floor',
  'area_m2',
  'price_krw',
  'price_per_pyeong',
  'deal_type',
  'canceled',
  'source_id',
  'as_of_date',
  'collected_at',
  'source_note',
] as const;

/**
 * 재수집해도 행이 늘지 않는 업서트. deal_hash 충돌 시 값만 갱신하고
 * RETURNING (xmax = 0)로 신규/갱신 건수를 나눠 센다.
 */
export const TRANSACTION_UPSERT_SQL = `INSERT INTO apt_transactions (${TRANSACTION_COLUMNS.join(', ')})
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
ON CONFLICT (deal_hash) DO UPDATE
  SET price_krw = EXCLUDED.price_krw,
      price_per_pyeong = EXCLUDED.price_per_pyeong,
      floor = EXCLUDED.floor,
      canceled = EXCLUDED.canceled,
      as_of_date = EXCLUDED.as_of_date,
      collected_at = EXCLUDED.collected_at,
      source_note = EXCLUDED.source_note
RETURNING (xmax = 0) AS inserted`;

export function transactionParams(row: AptTransaction): unknown[] {
  return [
    row.dealHash,
    row.lawdCd,
    row.legalDongCode,
    row.aptName,
    row.complexId,
    row.jibun,
    row.builtYear,
    row.dealMonth,
    row.dealDate,
    row.floor,
    row.areaM2,
    row.priceKrw,
    row.pricePerPyeong,
    row.dealType,
    row.canceled,
    row.sourceId,
    row.asOfDate,
    row.collectedAt,
    row.sourceNote,
  ];
}

export const RENT_COLUMNS = [
  'rent_hash',
  'lawd_cd',
  'legal_dong_code',
  'apt_name',
  'complex_id',
  'jibun',
  'built_year',
  'deal_month',
  'deal_date',
  'floor',
  'area_m2',
  'deposit_krw',
  'monthly_rent_krw',
  'contract_type',
  'contract_term_months',
  'renewal_requested',
  'source_id',
  'as_of_date',
  'collected_at',
  'source_note',
] as const;

/**
 * 전월세 멱등 업서트. rent_hash 충돌 시 보증금·월세·계약기간만 갱신한다.
 * 같은 계약을 다시 받았을 때 신고 정정(보증금 변경 등)이 반영되도록 값을 덮어쓴다.
 */
export const RENT_UPSERT_SQL = `INSERT INTO apt_rent_transactions (${RENT_COLUMNS.join(', ')})
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
ON CONFLICT (rent_hash) DO UPDATE
  SET deposit_krw = EXCLUDED.deposit_krw,
      monthly_rent_krw = EXCLUDED.monthly_rent_krw,
      contract_term_months = EXCLUDED.contract_term_months,
      renewal_requested = EXCLUDED.renewal_requested,
      as_of_date = EXCLUDED.as_of_date,
      collected_at = EXCLUDED.collected_at,
      source_note = EXCLUDED.source_note
RETURNING (xmax = 0) AS inserted`;

export function rentParams(row: AptRentTransaction): unknown[] {
  return [
    row.rentHash,
    row.lawdCd,
    row.legalDongCode,
    row.aptName,
    row.complexId,
    row.jibun,
    row.builtYear,
    row.dealMonth,
    row.dealDate,
    row.floor,
    row.areaM2,
    row.depositKrw,
    row.monthlyRentKrw,
    row.contractType,
    row.contractTermMonths,
    row.renewalRequested,
    row.sourceId,
    row.asOfDate,
    row.collectedAt,
    row.sourceNote,
  ];
}

export const MACRO_UPSERT_SQL = `INSERT INTO macro_indicators
  (indicator_code, period_date, value, unit, indicator_name, source_id, as_of_date, collected_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (indicator_code, period_date) DO UPDATE
  SET value = EXCLUDED.value,
      unit = EXCLUDED.unit,
      indicator_name = EXCLUDED.indicator_name,
      as_of_date = EXCLUDED.as_of_date,
      collected_at = EXCLUDED.collected_at
RETURNING (xmax = 0) AS inserted`;

export function macroParams(row: MacroIndicator): unknown[] {
  return [
    row.indicatorCode,
    row.periodDate,
    row.value,
    row.unit,
    row.indicatorName,
    row.sourceId,
    row.asOfDate,
    row.collectedAt,
  ];
}

/** 테스트·드라이런용 인메모리 싱크. 실제 DB 없이 파이프라인 상태 전이를 검증한다. */
export class MemorySink implements IngestionSink {
  readonly regions = new Map<string, Region>();
  readonly complexes = new Map<string, ApartmentComplex>();
  readonly transactions = new Map<string, AptTransaction>();
  readonly rentTransactions = new Map<string, AptRentTransaction>();
  readonly macro = new Map<string, MacroIndicator>();
  readonly runs = new Map<string, PipelineRun>();
  readonly tasks: PipelineRunTask[] = [];
  readonly deadLetters = new Map<string, DeadLetterEntry>();

  async saveRegions(regions: Region[]): Promise<number> {
    for (const region of regions) this.regions.set(region.legalDongCode, region);
    return regions.length;
  }

  async saveComplexes(complexes: ApartmentComplex[]): Promise<number> {
    for (const complex of complexes) this.complexes.set(complex.complexId, complex);
    return complexes.length;
  }

  async upsertTransactions(rows: AptTransaction[]): Promise<UpsertResult> {
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      if (this.transactions.has(row.dealHash)) updated += 1;
      else inserted += 1;
      this.transactions.set(row.dealHash, row);
    }
    return { inserted, updated };
  }

  async upsertRentTransactions(rows: AptRentTransaction[]): Promise<UpsertResult> {
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      if (this.rentTransactions.has(row.rentHash)) updated += 1;
      else inserted += 1;
      this.rentTransactions.set(row.rentHash, row);
    }
    return { inserted, updated };
  }

  async upsertMacro(rows: MacroIndicator[]): Promise<UpsertResult> {
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const key = `${row.indicatorCode}:${row.periodDate}`;
      if (this.macro.has(key)) updated += 1;
      else inserted += 1;
      this.macro.set(key, row);
    }
    return { inserted, updated };
  }

  async startRun(run: PipelineRun): Promise<void> {
    this.runs.set(run.runId, { ...run });
  }

  async finishRun(run: PipelineRun): Promise<void> {
    this.runs.set(run.runId, { ...run });
  }

  async saveTask(task: PipelineRunTask): Promise<void> {
    const index = this.tasks.findIndex(
      (row) => row.runId === task.runId && row.lawdCd === task.lawdCd && row.period === task.period,
    );
    if (index >= 0) this.tasks[index] = task;
    else this.tasks.push(task);
  }

  async enqueueDeadLetter(entry: DeadLetterEntry): Promise<void> {
    this.deadLetters.set(entry.id, entry);
  }

  async resolveDeadLetter(id: string, resolvedAt: string): Promise<void> {
    const entry = this.deadLetters.get(id);
    if (entry) this.deadLetters.set(id, { ...entry, resolvedAt });
  }
}
