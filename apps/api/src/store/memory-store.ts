import {
  aggregateMonthly,
  buildSampleDataset,
  isCountableTransaction,
  recentMonths,
  shiftMonth,
  type ApartmentComplex,
  type AptTransaction,
  type BehaviorEventRecord,
  type DeadLetterEntry,
  type MacroIndicator,
  type MonthlyPricePoint,
  type PipelineRun,
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

/** 데이터가 없을 때(개발·테스트·데모) 쓰는 인메모리 스토어. 샘플 데이터셋을 그대로 적재한다. */
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;

  private transactions: AptTransaction[];
  private readonly regions: Region[];
  private readonly complexes: ApartmentComplex[];
  private readonly macro: MacroIndicator[];
  private readonly sources: SourceDescriptor[];
  private readonly runs: PipelineRun[];
  private readonly runTasks: PipelineRunTask[];
  private readonly deadLetters: DeadLetterEntry[];
  private readonly events: BehaviorEventRecord[] = [];
  private readonly eventIds = new Set<string>();

  constructor(seed = buildSampleDataset()) {
    this.transactions = [...seed.transactions];
    this.regions = seed.regions;
    this.complexes = seed.complexes;
    this.macro = seed.macro;
    this.sources = seed.sources;
    this.runs = seed.pipelineRuns;
    this.runTasks = seed.runTasks;
    this.deadLetters = seed.deadLetters;
  }

  async listRegions(): Promise<Region[]> {
    return [...this.regions];
  }

  async listComplexes(): Promise<ApartmentComplex[]> {
    return [...this.complexes];
  }

  async listTransactions(filter: TransactionFilter): Promise<TransactionPage> {
    const filtered = this.transactions.filter((row) => {
      if (!filter.includeCanceled && row.canceled) return false;
      if (filter.lawdCd && row.lawdCd !== filter.lawdCd) return false;
      if (filter.legalDongCode && row.legalDongCode !== filter.legalDongCode) return false;
      if (filter.dong && row.dong !== filter.dong) return false;
      if (filter.aptName && !row.aptName.includes(filter.aptName)) return false;
      if (filter.complexIds && filter.complexIds.length > 0 && (!row.complexId || !filter.complexIds.includes(row.complexId))) {
        return false;
      }
      if (filter.fromMonth && row.dealMonth < filter.fromMonth) return false;
      if (filter.toMonth && row.dealMonth > filter.toMonth) return false;
      if (filter.minPriceKrw !== undefined && row.priceKrw < filter.minPriceKrw) return false;
      if (filter.maxPriceKrw !== undefined && row.priceKrw > filter.maxPriceKrw) return false;
      if (filter.minAreaM2 !== undefined && row.areaM2 < filter.minAreaM2) return false;
      if (filter.maxAreaM2 !== undefined && row.areaM2 > filter.maxAreaM2) return false;
      return true;
    });

    const sorters: Record<NonNullable<TransactionFilter['sort']>, (a: AptTransaction, b: AptTransaction) => number> = {
      deal_date_desc: (a, b) => b.dealDate.localeCompare(a.dealDate) || b.dealHash.localeCompare(a.dealHash),
      price_desc: (a, b) => b.priceKrw - a.priceKrw,
      price_asc: (a, b) => a.priceKrw - b.priceKrw,
      ppp_desc: (a, b) => b.pricePerPyeong - a.pricePerPyeong,
    };
    const sorter = sorters[filter.sort ?? 'deal_date_desc'];
    const sorted = [...filtered].sort(sorter);

    return {
      total: sorted.length,
      rows: sorted.slice(filter.offset, filter.offset + filter.limit),
    };
  }

  async monthlySeries(params: { legalDongCode?: string; lawdCd?: string; months: number }): Promise<MonthlyPricePoint[]> {
    const months = this.resolveMonths(params.months);
    const scoped = this.transactions.filter((row) => {
      if (params.legalDongCode) return row.legalDongCode === params.legalDongCode;
      if (params.lawdCd) return row.lawdCd === params.lawdCd;
      return true;
    });
    return aggregateMonthly(scoped, months);
  }

  async complexMonthly(complexId: string, months: number): Promise<MonthlyPricePoint[]> {
    const monthList = this.resolveMonths(months);
    return aggregateMonthly(
      this.transactions.filter((row) => row.complexId === complexId),
      monthList,
    );
  }

  async listMacro(params: { codes?: string[]; from?: string; to?: string }): Promise<MacroIndicator[]> {
    return this.macro
      .filter((row) => (params.codes && params.codes.length > 0 ? params.codes.includes(row.indicatorCode) : true))
      .filter((row) => (params.from ? row.periodDate >= params.from : true))
      .filter((row) => (params.to ? row.periodDate <= params.to : true))
      .sort((a, b) => a.indicatorCode.localeCompare(b.indicatorCode) || a.periodDate.localeCompare(b.periodDate));
  }

  async listSources(): Promise<SourceDescriptor[]> {
    return [...this.sources];
  }

  async listPipelineRuns(limit: number): Promise<PipelineRun[]> {
    return [...this.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
  }

  async getPipelineRun(runId: string): Promise<PipelineRun | null> {
    return this.runs.find((run) => run.runId === runId) ?? null;
  }

  async listRunTasks(runId: string): Promise<PipelineRunTask[]> {
    return this.runTasks.filter((task) => task.runId === runId);
  }

  async listDeadLetters(): Promise<DeadLetterEntry[]> {
    return [...this.deadLetters].sort((a, b) => a.nextRetryAt.localeCompare(b.nextRetryAt));
  }

  async insertBehaviorEvents(records: BehaviorEventRecord[]): Promise<EventInsertResult> {
    let inserted = 0;
    let duplicates = 0;
    for (const record of records) {
      if (this.eventIds.has(record.eventId)) {
        duplicates += 1;
        continue;
      }
      this.eventIds.add(record.eventId);
      this.events.push(record);
      inserted += 1;
    }
    return { inserted, duplicates };
  }

  async listBehaviorEvents(filter: EventFilter): Promise<{ rows: BehaviorEventRecord[]; total: number }> {
    const filtered = this.events
      .filter((row) => (filter.name ? row.name === filter.name : true))
      .filter((row) => (filter.sessionId ? row.sessionId === filter.sessionId : true))
      .filter((row) => (filter.date ? row.occurredAt.slice(0, 10) === filter.date : true))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return { total: filtered.length, rows: filtered.slice(filter.offset, filter.offset + filter.limit) };
  }

  async eventStats(sinceIso: string): Promise<EventStats> {
    const scoped = this.events.filter((row) => row.occurredAt >= sinceIso);
    const byName: Record<string, number> = {};
    for (const row of scoped) byName[row.name] = (byName[row.name] ?? 0) + 1;
    return {
      total: scoped.length,
      sessions: new Set(scoped.map((row) => row.sessionId)).size,
      byName,
      lastReceivedAt: scoped.length === 0 ? null : scoped[scoped.length - 1]!.receivedAt,
    };
  }

  /** 데모·테스트에서 최신 월 기준으로 기간을 계산한다. */
  private resolveMonths(count: number): string[] {
    const counted = this.transactions.filter(isCountableTransaction);
    const latest = counted.map((row) => row.dealMonth).sort().at(-1) ?? shiftMonth(new Date().toISOString().slice(0, 7), -1);
    return recentMonths(latest, count);
  }

  async close(): Promise<void> {
    // 인메모리 스토어는 정리할 자원이 없다.
  }
}
