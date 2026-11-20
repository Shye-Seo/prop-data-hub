import type { EventName } from './constants';

export interface Region {
  /** 시군구 5자리 코드(국토교통부 실거래가 API의 LAWD_CD). 예: 부산 남 26290 */
  lawdCd: string;
  /** 법정동 10자리 코드(행정표준코드 법정동 목록). 예: 문현동 2629010900 */
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

export type RentContractType = 'jeonse' | 'monthly';

/**
 * 아파트 전월세 실거래(국토교통부 getRTMSDataSvcAptRent).
 * 전세 계약은 monthly_rent_krw가 0이고, 월세 계약은 보증금과 월세를 함께 저장한다.
 */
export interface AptRentTransaction {
  /** 전월세 거래 단위 멱등 해시. 같은 계약은 재수집해도 값이 같다. */
  rentHash: string;
  lawdCd: string;
  legalDongCode: string;
  dong: string;
  aptName: string;
  complexId: string | null;
  jibun: string;
  builtYear: number | null;
  dealMonth: string;
  dealDate: string;
  floor: number | null;
  /** 전용면적(㎡) */
  areaM2: number;
  /** 보증금(원). API는 만원 단위 문자열을 주므로 파서에서 원으로 환산한다. */
  depositKrw: number;
  /** 월세(원). 전세는 0. */
  monthlyRentKrw: number;
  contractType: RentContractType;
  contractTermMonths: number | null;
  /** 갱신요구권 사용 여부. 계약 갱신 비중을 보는 지표로 쓴다. */
  renewalRequested: boolean;
  sourceId: string;
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

export type RiskLevel = 'low' | 'moderate' | 'high' | 'critical';

export type RiskSignalCode =
  | 'jeonse_ratio_high'
  | 'jeonse_ratio_warning'
  | 'recent_price_drop'
  | 'twelve_month_decline'
  | 'price_anomaly'
  | 'thin_liquidity';

export interface RiskSignal {
  code: RiskSignalCode;
  level: RiskLevel;
  label: string;
  /** 화면과 리포트에 그대로 쓰는 근거 문장. */
  detail: string;
}

/** 단지 단위 전세가율·이상치 리스크 평가 결과. */
export interface ComplexRiskAssessment {
  complexId: string;
  complexName: string;
  lawdCd: string;
  sigungu: string;
  dong: string;
  /** 최근월 전세 중위가 ÷ 최근월 매매 중위가 × 100 */
  jeonseRatioPct: number;
  jeonseMedianKrw: number;
  saleMedianKrw: number;
  latestPricePerPyeong: number;
  /** 매매가 − 전세가(원). 전세가율이 높을수록 작다. */
  gapKrw: number;
  change6mPct: number;
  change12mPct: number;
  volume12m: number;
  anomalyCount: number;
  /** 0~100. 높을수록 위험. */
  score: number;
  level: RiskLevel;
  signals: RiskSignal[];
  asOfMonth: string;
}

/** 구(시군구) 단위 비교 뷰의 한 행. */
export interface RegionRiskSummary {
  lawdCd: string;
  sigungu: string;
  complexCount: number;
  medianPricePerPyeong: number;
  medianJeonseRatioPct: number;
  volume12m: number;
  anomalyCount: number;
  highRiskCount: number;
  averageScore: number;
  jeonseRatioTrend: Array<{ month: string; ratioPct: number }>;
}

export interface PriceAnomaly {
  dealHash: string;
  complexId: string | null;
  aptName: string;
  dong: string;
  dealDate: string;
  priceKrw: number;
  pricePerPyeong: number;
  /** 단지·최근 12개월 중위 평당가. */
  referencePpp: number;
  deviationPct: number;
  /** modified z-score(MAD 기준). 표본이 작으면 null. */
  modifiedZ: number | null;
  kind: 'sharp_drop' | 'outlier_high' | 'outlier_low';
}

/** 전용면적 구간 키. 레이더·알림 규칙·이벤트 속성이 같은 이름을 쓴다. */
export type AreaBandKey = 'under60' | '60to85' | '85to115' | 'over115';

export type DealGrade = 'strong' | 'good' | 'watch' | 'marginal';

export type DealSignalCode =
  | 'discount'
  | 'discount_check'
  | 'jeonse_ratio'
  | 'liquidity'
  | 'scale'
  | 'direct_trade';

/** 매물 점수 근거. 화면은 이 문장을 그대로 보여준다. */
export interface DealSignal {
  code: DealSignalCode;
  label: string;
  points: number;
  detail: string;
}

/**
 * 급매 레이더의 매물 단위 결과.
 * 모든 금액은 원, 면적은 ㎡, 할인율은 기준 시세(같은 단지·면적 구간 최근 6개월 중위가) 대비 %다.
 */
export interface RadarDeal {
  dealHash: string;
  complexId: string;
  complexName: string;
  lawdCd: string;
  sigungu: string;
  dong: string;
  households: number;
  builtYear: number;
  areaM2: number;
  areaBand: AreaBandKey;
  floor: number | null;
  dealDate: string;
  dealMonth: string;
  priceKrw: number;
  pricePerPyeong: number;
  /** 같은 단지·면적 구간 최근 6개월 중위 매매가(해당 거래 제외). */
  medianPriceKrw: number;
  medianPricePerPyeong: number;
  /** 기준 시세 표본 수. minReferenceSamples 미만인 거래는 목록에서 빠진다. */
  referenceSamples: number;
  /** (거래가 − 기준 시세) ÷ 기준 시세 × 100. 음수면 저평가. */
  discountPct: number;
  /** 단지·면적 구간 전세가율(%). 전세 표본이 없으면 null. */
  jeonseRatioPct: number | null;
  /** 매매가 − 전세보증금(해당 면적 환산). 계산 불가면 null. */
  gapKrw: number | null;
  /** 같은 단지·면적 구간 최근 3개월 거래 건수. */
  volume3m: number;
  dealScore: number;
  grade: DealGrade;
  signals: DealSignal[];
  dealType: string;
  /** 거래 기준월. */
  asOfMonth: string;
}

export type AlertChannel = 'kakao_alimtalk' | 'webhook';

/** 사용자가 저장하는 맞춤 알림 규칙. */
export interface AlertRule {
  ruleId: string;
  name: string;
  lawdCds: string[];
  minHouseholds: number;
  areaBand: AreaBandKey | 'all';
  maxDiscountPct: number;
  minScore: number;
  channels: AlertChannel[];
  createdAt: string;
  /** 마지막 미리보기에서 규칙에 걸린 매물 수. 서버가 저장 시점 값을 남긴다. */
  lastMatchedCount?: number;
}

/** 알림 규칙 생성 입력(ruleId·createdAt은 서버/화면이 채운다). */
export interface AlertRuleDraft {
  name: string;
  lawdCds: string[];
  minHouseholds?: number;
  areaBand?: AreaBandKey | 'all';
  maxDiscountPct?: number;
  minScore?: number;
  channels?: AlertChannel[];
}

/** 카카오 알림톡(SENS)·웹훅 payload 미리보기. 실제 발송은 하지 않는다. */
export interface AlertPreview {
  rule: AlertRule;
  condition: string;
  matchedCount: number;
  sample: RadarDeal[];
  channels: string[];
  kakao: {
    channel: 'kakao_alimtalk';
    provider: string;
    templateCode: string;
    templateName: string;
    recipientType: string;
    variables: Record<string, string>;
    message: string;
    buttons: Array<{ type: string; name: string; linkMobile: string; linkPc: string }>;
  };
  webhook: {
    channel: 'webhook';
    method: 'POST';
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  };
  previewOnly: boolean;
  note: string;
}

export interface MonthlyPricePoint {
  month: string;
  sampleCount: number;
  medianPriceKrw: number;
  medianPricePerPyeong: number;
  medianAreaM2: number;
  totalVolumeKrw: number;
}
