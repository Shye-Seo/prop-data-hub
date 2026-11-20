/**
 * PostgreSQL 스키마 요약(ERD).
 *
 * 라이브 데모의 'API 문서 > 스키마' 탭이 이 데이터를 그린다. 실제 DDL은 infra/postgres/init.sql이고,
 * 요약이 DDL과 어긋나면 packages/shared 테스트(schema-summary.test.ts)에서 잡는다.
 * 컬럼 전체를 옮겨 적지 않고 관계·키·조회 패턴을 판단하는 데 필요한 컬럼만 남겼다.
 */
export interface SchemaColumn {
  name: string;
  type: string;
  key?: 'PK' | 'FK' | 'IDX';
  note?: string;
}

export interface SchemaTable {
  name: string;
  kind: 'table' | 'view' | 'materialized view';
  purpose: string;
  columns: SchemaColumn[];
  indexes: string[];
  note?: string;
}

export interface SchemaRelation {
  from: string;
  fromColumn: string;
  to: string;
  toColumn: string;
  label: string;
}

export const SCHEMA_TABLES: SchemaTable[] = [
  {
    name: 'ingestion_sources',
    kind: 'table',
    purpose: '수집 소스 정의와 기준일 정책',
    columns: [
      { name: 'source_id', type: 'text', key: 'PK' },
      { name: 'name', type: 'text' },
      { name: 'update_cycle', type: 'text' },
      { name: 'as_of_policy', type: 'text' },
      { name: 'requires_key', type: 'boolean' },
    ],
    indexes: [],
  },
  {
    name: 'regions',
    kind: 'table',
    purpose: '법정동 마스터(10자리 코드 ↔ 시군구 5자리)',
    columns: [
      { name: 'legal_dong_code', type: 'char(10)', key: 'PK' },
      { name: 'lawd_cd', type: 'char(5)', key: 'IDX' },
      { name: 'sigungu', type: 'text' },
      { name: 'dong', type: 'text' },
    ],
    indexes: ['regions_lawd_cd_idx'],
  },
  {
    name: 'apartment_complexes',
    kind: 'table',
    purpose: '단지 기준정보(준공연도·세대수·대표 면적)',
    columns: [
      { name: 'complex_id', type: 'text', key: 'PK' },
      { name: 'name', type: 'text' },
      { name: 'legal_dong_code', type: 'char(10)', key: 'FK' },
      { name: 'lawd_cd', type: 'char(5)' },
      { name: 'households', type: 'integer' },
      { name: 'representative_area_m2', type: 'numeric(7,2)' },
    ],
    indexes: ['apartment_complexes_dong_idx', 'apartment_complexes_search_gin'],
  },
  {
    name: 'apt_transactions',
    kind: 'table',
    purpose: '아파트 매매 실거래(멱등 업서트 단위)',
    columns: [
      { name: 'deal_hash', type: 'char(64)', key: 'PK', note: 'sha256 멱등 해시' },
      { name: 'lawd_cd', type: 'char(5)', key: 'IDX' },
      { name: 'legal_dong_code', type: 'char(10)', key: 'FK' },
      { name: 'complex_id', type: 'text', key: 'FK' },
      { name: 'deal_month', type: 'char(7)' },
      { name: 'deal_date', type: 'date', key: 'IDX' },
      { name: 'area_m2', type: 'numeric(7,2)' },
      { name: 'price_krw', type: 'bigint' },
      { name: 'price_per_pyeong', type: 'bigint' },
      { name: 'canceled', type: 'boolean', note: '해제 거래는 집계에서 제외' },
      { name: 'source_id', type: 'text', key: 'FK' },
      { name: 'as_of_date', type: 'date' },
    ],
    indexes: [
      'apt_transactions_deal_date_brin',
      'apt_transactions_dong_month_price_idx',
      'apt_transactions_lawd_month_idx',
      'apt_transactions_complex_month_idx',
      'apt_transactions_search_gin',
    ],
  },
  {
    name: 'apt_rent_transactions',
    kind: 'table',
    purpose: '아파트 전월세 실거래(전세가율 계산 원천)',
    columns: [
      { name: 'rent_hash', type: 'char(64)', key: 'PK' },
      { name: 'legal_dong_code', type: 'char(10)', key: 'FK' },
      { name: 'complex_id', type: 'text', key: 'FK' },
      { name: 'deal_month', type: 'char(7)' },
      { name: 'area_m2', type: 'numeric(7,2)' },
      { name: 'deposit_krw', type: 'bigint' },
      { name: 'monthly_rent_krw', type: 'integer', note: '전세는 0' },
      { name: 'contract_type', type: "text CHECK (jeonse|monthly)" },
      { name: 'source_id', type: 'text', key: 'FK' },
    ],
    indexes: [
      'apt_rent_transactions_deal_date_brin',
      'apt_rent_transactions_lawd_month_idx',
      'apt_rent_transactions_complex_month_idx',
      'apt_rent_transactions_jeonse_idx',
    ],
  },
  {
    name: 'macro_indicators',
    kind: 'table',
    purpose: '기준금리·주담대 금리·소비자물가 월간 지표',
    columns: [
      { name: 'indicator_code', type: 'text', key: 'PK' },
      { name: 'period_date', type: 'date', key: 'PK' },
      { name: 'value', type: 'numeric(14,4)' },
      { name: 'source_id', type: 'text', key: 'FK' },
    ],
    indexes: ['macro_indicators_period_idx'],
  },
  {
    name: 'pipeline_runs',
    kind: 'table',
    purpose: '수집 실행 단위 이력(부분 성공·실패 요약)',
    columns: [
      { name: 'run_id', type: 'text', key: 'PK' },
      { name: 'source_id', type: 'text', key: 'FK' },
      { name: 'job_type', type: 'text' },
      { name: 'status', type: 'text' },
      { name: 'task_total', type: 'integer' },
      { name: 'task_failed', type: 'integer' },
      { name: 'records_upserted', type: 'bigint' },
    ],
    indexes: ['pipeline_runs_started_idx', 'pipeline_runs_source_status_idx'],
  },
  {
    name: 'pipeline_run_tasks',
    kind: 'table',
    purpose: '실행 안의 배치 태스크(지역×월)와 재시도 횟수',
    columns: [
      { name: 'id', type: 'bigserial', key: 'PK' },
      { name: 'run_id', type: 'text', key: 'FK' },
      { name: 'lawd_cd', type: 'char(5)' },
      { name: 'period', type: 'char(7)' },
      { name: 'status', type: 'text' },
      { name: 'attempts', type: 'smallint' },
    ],
    indexes: ['pipeline_run_tasks_unique_idx', 'pipeline_run_tasks_unique_no_lawd_idx'],
  },
  {
    name: 'dead_letter_queue',
    kind: 'table',
    purpose: '재시도 후에도 실패한 요청(수동 재처리 대상)',
    columns: [
      { name: 'id', type: 'text', key: 'PK' },
      { name: 'run_id', type: 'text', key: 'FK' },
      { name: 'payload', type: 'jsonb' },
      { name: 'error', type: 'text' },
      { name: 'next_retry_at', type: 'timestamptz' },
      { name: 'resolved_at', type: 'timestamptz' },
    ],
    indexes: ['dlq_unresolved_idx'],
  },
  {
    name: 'user_behavior_events',
    kind: 'table',
    purpose: '사용자 행동 이벤트(월 단위 RANGE 파티션)',
    columns: [
      { name: 'event_id', type: 'uuid', key: 'PK' },
      { name: 'occurred_date', type: 'date', key: 'PK', note: '파티션 키' },
      { name: 'name', type: 'text', key: 'IDX' },
      { name: 'session_id', type: 'text', key: 'IDX' },
      { name: 'props', type: 'jsonb', key: 'IDX' },
      { name: 'schema_version', type: 'text' },
      { name: 'app_env', type: 'text' },
    ],
    indexes: [
      'user_behavior_events_occurred_brin',
      'user_behavior_events_name_time_idx',
      'user_behavior_events_session_idx',
      'user_behavior_events_props_gin',
    ],
    note: '보존 기간이 지난 월은 DROP PARTITION으로 지운다.',
  },
  {
    name: 'alert_rules',
    kind: 'table',
    purpose: '사용자가 저장한 급매 레이더 알림 규칙(조건·채널)',
    columns: [
      { name: 'rule_id', type: 'text', key: 'PK' },
      { name: 'name', type: 'text' },
      { name: 'lawd_cds', type: 'text[]', note: '대상 시군구 5자리 코드' },
      { name: 'min_households', type: 'integer', note: '기본 350' },
      { name: 'area_band', type: 'text', note: 'under60 | 60to85 | 85to115 | over115 | all' },
      { name: 'max_discount_pct', type: 'numeric(4,1)', note: '중위가 대비 목표 할인율' },
      { name: 'min_score', type: 'integer' },
      { name: 'channels', type: 'text[]', note: 'kakao_alimtalk | webhook' },
      { name: 'last_matched_count', type: 'integer', note: '마지막 미리보기 매칭 건수' },
      { name: 'created_at', type: 'timestamptz' },
    ],
    indexes: ['alert_rules_created_idx'],
    note: '실제 발송(알림톡·웹훅)은 워커가 이 규칙을 읽어 처리하고, 발송 결과는 별도 로그로 남긴다.',
  },
  {
    name: 'event_funnel_daily',
    kind: 'table',
    purpose: '일 단위 순서 보정 퍼널 집계(대시보드와 같은 정의)',
    columns: [
      { name: 'funnel_date', type: 'date', key: 'PK' },
      { name: 'step_key', type: 'text', key: 'PK' },
      { name: 'sessions', type: 'integer' },
      { name: 'events', type: 'integer' },
    ],
    indexes: [],
  },
  {
    name: 'v_jeonse_ratio_monthly',
    kind: 'view',
    purpose: '단지·월·면적 구간별 전세가율(같은 정의를 API와 화면이 공유)',
    columns: [
      { name: 'complex_id', type: 'text' },
      { name: 'deal_month', type: 'char(7)' },
      { name: 'area_bucket', type: 'integer', note: '5㎡ 구간' },
      { name: 'jeonse_ratio_pct', type: 'numeric' },
      { name: 'jeonse_samples', type: 'bigint' },
      { name: 'sale_samples', type: 'bigint' },
    ],
    indexes: [],
  },
  {
    name: 'mv_transaction_monthly',
    kind: 'materialized view',
    purpose: '법정동 월별 중위가·평당가·거래량',
    columns: [
      { name: 'legal_dong_code', type: 'char(10)' },
      { name: 'deal_month', type: 'char(7)' },
      { name: 'median_price_krw', type: 'bigint' },
      { name: 'sample_count', type: 'bigint' },
    ],
    indexes: ['mv_transaction_monthly_pk'],
  },
  {
    name: 'mv_complex_monthly',
    kind: 'materialized view',
    purpose: '단지 월별 중위가·평당가',
    columns: [
      { name: 'complex_id', type: 'text' },
      { name: 'deal_month', type: 'char(7)' },
      { name: 'median_price_per_pyeong', type: 'bigint' },
    ],
    indexes: ['mv_complex_monthly_pk'],
  },
  {
    name: 'v_ingestion_quality',
    kind: 'view',
    purpose: '수집 품질 점검(해제·보정·기준일 불일치)',
    columns: [
      { name: 'source_id', type: 'text' },
      { name: 'total_rows', type: 'bigint' },
      { name: 'canceled_rows', type: 'bigint' },
      { name: 'as_of_mismatch_rows', type: 'bigint' },
    ],
    indexes: [],
  },
];

export const SCHEMA_RELATIONS: SchemaRelation[] = [
  { from: 'apartment_complexes', fromColumn: 'legal_dong_code', to: 'regions', toColumn: 'legal_dong_code', label: '단지 → 법정동' },
  { from: 'apt_transactions', fromColumn: 'legal_dong_code', to: 'regions', toColumn: 'legal_dong_code', label: '매매 → 법정동' },
  { from: 'apt_transactions', fromColumn: 'complex_id', to: 'apartment_complexes', toColumn: 'complex_id', label: '매매 → 단지' },
  { from: 'apt_rent_transactions', fromColumn: 'legal_dong_code', to: 'regions', toColumn: 'legal_dong_code', label: '전월세 → 법정동' },
  { from: 'apt_rent_transactions', fromColumn: 'complex_id', to: 'apartment_complexes', toColumn: 'complex_id', label: '전월세 → 단지' },
  { from: 'apt_transactions', fromColumn: 'source_id', to: 'ingestion_sources', toColumn: 'source_id', label: '매매 → 소스' },
  { from: 'apt_rent_transactions', fromColumn: 'source_id', to: 'ingestion_sources', toColumn: 'source_id', label: '전월세 → 소스' },
  { from: 'macro_indicators', fromColumn: 'source_id', to: 'ingestion_sources', toColumn: 'source_id', label: '지표 → 소스' },
  { from: 'pipeline_runs', fromColumn: 'source_id', to: 'ingestion_sources', toColumn: 'source_id', label: '실행 → 소스' },
  { from: 'pipeline_run_tasks', fromColumn: 'run_id', to: 'pipeline_runs', toColumn: 'run_id', label: '태스크 → 실행' },
  { from: 'dead_letter_queue', fromColumn: 'run_id', to: 'pipeline_runs', toColumn: 'run_id', label: 'DLQ → 실행' },
  { from: 'alert_rules', fromColumn: 'lawd_cds', to: 'regions', toColumn: 'lawd_cd', label: '알림 규칙 → 지역' },
];
