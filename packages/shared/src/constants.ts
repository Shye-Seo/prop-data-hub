/** 평 단위 환산 계수(1평 = 3.3058㎡). 계약·고시에서 쓰는 관용값을 그대로 쓴다. */
export const PYEONG_M2 = 3.305785;

/** 수집 대상 공공데이터 소스 식별자. DB의 ingestion_sources.source_id와 동일한 값을 쓴다. */
export const SOURCE_IDS = {
  molitAptTrade: 'molit_apt_trade',
  molitAptRent: 'molit_apt_rent',
  ecosRates: 'ecos_rates',
  ecosCpi: 'ecos_cpi',
} as const;

export type SourceId = (typeof SOURCE_IDS)[keyof typeof SOURCE_IDS];

/** 사용자 행동 이벤트 이름. 스키마와 대시보드가 같은 상수를 참조한다. */
export const EVENT_NAMES = [
  'page_view',
  'region_filter_change',
  'radar_filter_change',
  'alert_rule_create',
  'complex_compare_add',
  'listing_click',
  'listing_save',
  'api_doc_mock_run',
  'rate_scenario_adjust',
  'jeonse_safety_check',
  'cash_plan_calculate',
  'drawdown_filter_change',
  'pipeline_source_inspect',
  'funnel_step_complete',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** 행동 이벤트 스키마 버전. 필드가 바뀌면 올리고, 과거 데이터는 버전으로 구분한다. */
export const EVENT_SCHEMA_VERSION = '1.2.0';

/** 퍼널 단계. funnel_step_complete의 step 값과 1:1로 대응한다. */
export const FUNNEL_STEPS = [
  { key: 'dashboard_enter', label: '대시보드 진입', sourceEvent: 'page_view' },
  { key: 'region_filter', label: '지역 조건 설정', sourceEvent: 'region_filter_change' },
  { key: 'complex_compare', label: '단지 비교', sourceEvent: 'complex_compare_add' },
  { key: 'rate_scenario', label: '금리 시나리오 조정', sourceEvent: 'rate_scenario_adjust' },
  { key: 'report_export', label: '분석 리포트 저장', sourceEvent: 'funnel_step_complete' },
] as const;

export type FunnelStepKey = (typeof FUNNEL_STEPS)[number]['key'];

/** 파이프라인 재시도 기본 정책. collector와 문서가 같은 값을 본다. */
export const RETRY_POLICY = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  jitterRatio: 0.2,
} as const;

/** API 페이지 크기 상한. 과도한 응답으로 DB·네트워크를 밀어붙이지 않도록 고정한다. */
export const MAX_PAGE_SIZE = 200;
