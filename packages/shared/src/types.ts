import type { EventName } from './constants';

export interface Region {
  /** 시군구 5자리 코드(국토교통부 실거래가 API의 LAWD_CD). 예: 부산 남 26290 */
  lawdCd: string;
  /** 법정동 10자리 코드. 예: 문현동 2629051000 */
  legalDongCode: string;
  sido: string;
  sigungu: string;
  dong: string;
}

export interface ApartmentComplex {
  /** 국토교통부 단지 식별자(aptSeq). 실거래 응답에는 없어 단지명+법정동으로 매핑한다. */
  complexId: string;
  name: string;
  legalDongCode: string;
  lawdCd: string;
  builtYear: number;
  households: number;
  /** 대표 전용면적(㎡). 비교 화면에서 기준 면적으로 쓴다. */
  representativeAreaM2: number;
}

export interface AptTransaction {
  /** 거래 단위 멱등 해시. 같은 거래는 재수집해도 이 값이 같다. */
  dealHash: string;
  lawdCd: string;
  legalDongCode: string;
  dong: string;
  aptName: string;
  complexId: string | null;
  jibun: string;
  builtYear: number | null;
  /** 계약 연월(YYYY-MM). 월 단위 집계·파티셔닝 기준. */
  dealMonth: string;
  /** 계약일(YYYY-MM-DD). 계약일이 비어 있으면 월의 1일로 보정하고 source_note에 남긴다. */
  dealDate: string;
  floor: number | null;
  /** 전용면적(㎡) */
  areaM2: number;
  /** 거래금액(원). API는 만원 단위 문자열을 주므로 파서에서 원으로 환산한다. */
  priceKrw: number;
  /** 평당가(원/평). 조회 시 계산하지만 정렬·인덱스를 위해 저장한다. */
  pricePerPyeong: number;
  dealType: string;
  /** 계약 해제 여부. 'O'면 집계에서 제외한다. */
  canceled: boolean;
  sourceId: string;
  /** 원천 데이터의 기준 시점(계약 연월 기준일). */
  asOfDate: string;
  collectedAt: string;
  sourceNote: string | null;
}

export interface MacroIndicator {
  indicatorCode: string;
  /** 예: 한국은행 기준금리 */
  indicatorName: string;
  /** 월 단위 기준일(YYYY-MM-DD). 월간 지표는 말일로 맞춘다. */
  periodDate: string;
  period: string;
  value: number;
  unit: string;
  sourceId: string;
  asOfDate: string;
  collectedAt: string;
}

export type PipelineRunStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';

export interface PipelineRun {
  runId: string;
  sourceId: string;
  jobType: 'backfill' | 'incremental' | 'manual';
  status: PipelineRunStatus;
  startedAt: string;
  finishedAt: string | null;
  requestedMonths: number;
  taskTotal: number;
  taskSucceeded: number;
  taskFailed: number;
  recordsUpserted: number;
  recordsSkipped: number;
  retryCount: number;
  errorSummary: string | null;
  triggeredBy: string;
}

export interface PipelineRunTask {
  runId: string;
  sourceId: string;
  lawdCd: string | null;
  period: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  attempts: number;
  records: number;
  error: string | null;
  updatedAt: string;
}

export interface DeadLetterEntry {
  id: string;
  runId: string;
  sourceId: string;
  payload: Record<string, unknown>;
  error: string;
  attempts: number;
  nextRetryAt: string;
  resolvedAt: string | null;
}

export interface SourceDescriptor {
  sourceId: string;
  name: string;
  provider: string;
  endpoint: string;
  license: string;
  updateCycle: string;
  /** 데이터가 실제로 반영되는 시점. 수집 시점과 구분해 표시한다. */
  asOfPolicy: string;
  requiresKey: boolean;
}

export interface BehaviorEventInput {
  eventId?: string;
  name: EventName;
  occurredAt: string;
  sessionId: string;
  userPseudoId: string;
  page: string;
  props: Record<string, unknown>;
}

export interface BehaviorEventRecord extends Required<Pick<BehaviorEventInput, 'eventId'>> {
  name: EventName;
  occurredAt: string;
  receivedAt: string;
  sessionId: string;
  userPseudoId: string;
  page: string;
  props: Record<string, unknown>;
  schemaVersion: string;
  appEnv: string;
}

export interface FunnelStepAggregate {
  stepKey: string;
  stepLabel: string;
  stepIndex: number;
  users: number;
  sessions: number;
  events: number;
  conversionFromPrevious: number;
  conversionFromStart: number;
}

export interface MonthlyPricePoint {
  month: string;
  sampleCount: number;
  medianPriceKrw: number;
  medianPricePerPyeong: number;
  medianAreaM2: number;
  totalVolumeKrw: number;
}
