import type {
  AlertRule,
  ApartmentComplex,
  AptRentTransaction,
  AptTransaction,
  BehaviorEventRecord,
  DeadLetterEntry,
  MacroIndicator,
  MonthlyPricePoint,
  PipelineRun,
  PipelineRunTask,
  RadarDealSet,
  Region,
  SourceDescriptor,
} from '@prop/shared';

export interface TransactionFilter {
  lawdCd?: string;
  legalDongCode?: string;
  dong?: string;
  aptName?: string;
  complexIds?: string[];
  fromMonth?: string;
  toMonth?: string;
  minPriceKrw?: number;
  maxPriceKrw?: number;
  minAreaM2?: number;
  maxAreaM2?: number;
  includeCanceled?: boolean;
  sort?: 'deal_date_desc' | 'price_desc' | 'price_asc' | 'ppp_desc';
  limit: number;
  offset: number;
}

export interface TransactionPage {
  rows: AptTransaction[];
  total: number;
}

export interface RentFilter {
  lawdCd?: string;
  legalDongCode?: string;
  complexId?: string;
  fromMonth?: string;
  toMonth?: string;
  contractType?: 'jeonse' | 'monthly';
  limit: number;
  offset: number;
}

export interface RentPage {
  rows: AptRentTransaction[];
  total: number;
}

/** 월별 전세가율 집계. 단지별 전세가율의 중위값과 기여 단지 수를 함께 내린다. */
export interface JeonseRatioRow {
  month: string;
  ratioPct: number;
  complexCount: number;
  jeonseSamples: number;
  saleSamples: number;
}

export interface EventFilter {
  name?: string;
  sessionId?: string;
  date?: string;
  limit: number;
  offset: number;
}

export interface EventStats {
  total: number;
  sessions: number;
  byName: Record<string, number>;
  lastReceivedAt: string | null;
}

/** 레이더 표본을 만들 범위. 필터·정렬은 shared의 filterRadarDeals가 담당한다. */
export interface RadarScope {
  lawdCds?: string[];
  referenceMonths: number;
  /** 후보 거래를 볼 최근 개월 수. */
  lookbackMonths: number;
  /** 전세가율 계산 개월 수. */
  ratioMonths: number;
}

export interface EventInsertResult {
  inserted: number;
  duplicates: number;
}

export interface Store {
  readonly kind: 'memory' | 'postgres';
  listRegions(): Promise<Region[]>;
  listComplexes(): Promise<ApartmentComplex[]>;
  listTransactions(filter: TransactionFilter): Promise<TransactionPage>;
  monthlySeries(params: { legalDongCode?: string; lawdCd?: string; months: number }): Promise<MonthlyPricePoint[]>;
  complexMonthly(complexId: string, months: number): Promise<MonthlyPricePoint[]>;
  listRentTransactions(filter: RentFilter): Promise<RentPage>;
  jeonseRatioMonthly(params: { lawdCd?: string; legalDongCode?: string; complexId?: string; months: number }): Promise<JeonseRatioRow[]>;
  listMacro(params: { codes?: string[]; from?: string; to?: string }): Promise<MacroIndicator[]>;
  listSources(): Promise<SourceDescriptor[]>;
  listPipelineRuns(limit: number): Promise<PipelineRun[]>;
  getPipelineRun(runId: string): Promise<PipelineRun | null>;
  listRunTasks(runId: string): Promise<PipelineRunTask[]>;
  listDeadLetters(): Promise<DeadLetterEntry[]>;
  /** 급매 레이더 표본(점수 계산 완료). 조건 필터·페이지는 라우트에서 shared 함수로 적용한다. */
  radarDealSet(scope: RadarScope): Promise<RadarDealSet>;
  createAlertRule(rule: AlertRule, lastMatchedCount: number): Promise<AlertRule>;
  listAlertRules(): Promise<AlertRule[]>;
  insertBehaviorEvents(records: BehaviorEventRecord[]): Promise<EventInsertResult>;
  listBehaviorEvents(filter: EventFilter): Promise<{ rows: BehaviorEventRecord[]; total: number }>;
  eventStats(sinceIso: string): Promise<EventStats>;
  close(): Promise<void>;
}
