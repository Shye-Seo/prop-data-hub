-- prop-data-hub / PostgreSQL 16 스키마
-- 적용:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/postgres/init.sql
-- 재적용해도 데이터가 사라지지 않도록 CREATE ... IF NOT EXISTS, ON CONFLICT를 쓴다.
--
-- 설계 기준
--   * 실거래 거래 단위는 deal_hash(sha256)로 멱등성을 보장하고, 재수집 시 ON CONFLICT (deal_hash) DO UPDATE로 갱신한다.
--   * 시계열 조회는 (지역, 월, 금액) 복합 인덱스로, 기간 스캔은 BRIN으로 처리한다.
--   * 행동 이벤트는 월 단위 RANGE 파티션으로 두어 보존 기간 삭제(DROP PARTITION)가 가능하게 한다.
--   * 수집 실행·배치 태스크·DLQ를 분리해 실패 원인을 실행 단위로 추적한다.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. 수집 소스와 지역 마스터
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_sources (
  source_id      text PRIMARY KEY,
  name           text NOT NULL,
  provider       text NOT NULL,
  endpoint       text NOT NULL,
  license        text NOT NULL,
  update_cycle   text NOT NULL,
  as_of_policy   text NOT NULL,
  requires_key   boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ingestion_sources (source_id, name, provider, endpoint, license, update_cycle, as_of_policy, requires_key)
VALUES
  ('molit_apt_trade', '아파트 매매 실거래가', '국토교통부 (공공데이터포털)',
   'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
   '이용허락범위 제한 없음', '매월 신고분 반영(계약일 기준, 통상 1~2개월 지연)',
   '계약 연월 기준. 수집 시점과 계약 시점을 분리해 저장한다.', true),
  ('molit_apt_rent', '아파트 전월세 실거래가', '국토교통부 (공공데이터포털)',
   'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
   '이용허락범위 제한 없음', '매월 신고분 반영(계약일 기준, 통상 1~2개월 지연)',
   '계약 연월 기준. 보증금·월세를 함께 저장하고 전세가율은 전세 계약만 집계한다.', true),
  ('ecos_rates', '기준금리·주택담보대출 금리', '한국은행 ECOS Open API',
   'https://ecos.bok.or.kr/api/StatisticSearch', '한국은행 공공데이터 이용약관', '월간(기준금리는 변경 시)',
   '월간 지표는 해당 월 말일을 기준일로 둔다.', true),
  ('ecos_cpi', '소비자물가지수', '한국은행 ECOS Open API',
   'https://ecos.bok.or.kr/api/StatisticSearch', '한국은행 공공데이터 이용약관', '월간',
   '월간 지표는 해당 월 말일을 기준일로 둔다.', true)
ON CONFLICT (source_id) DO UPDATE
  SET name = EXCLUDED.name,
      provider = EXCLUDED.provider,
      endpoint = EXCLUDED.endpoint,
      license = EXCLUDED.license,
      update_cycle = EXCLUDED.update_cycle,
      as_of_policy = EXCLUDED.as_of_policy,
      updated_at = now();

CREATE TABLE IF NOT EXISTS regions (
  legal_dong_code char(10) PRIMARY KEY,
  lawd_cd         char(5) NOT NULL,
  sido            text NOT NULL,
  sigungu         text NOT NULL,
  dong            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regions_legal_dong_code_digits CHECK (legal_dong_code ~ '^[0-9]{10}$'),
  CONSTRAINT regions_lawd_cd_digits CHECK (lawd_cd ~ '^[0-9]{5}$')
);
CREATE INDEX IF NOT EXISTS regions_lawd_cd_idx ON regions (lawd_cd);

CREATE TABLE IF NOT EXISTS apartment_complexes (
  complex_id             text PRIMARY KEY,
  apt_seq                text UNIQUE,
  name                   text NOT NULL,
  legal_dong_code        char(10) NOT NULL REFERENCES regions (legal_dong_code) ON UPDATE CASCADE,
  lawd_cd                char(5) NOT NULL,
  built_year             smallint,
  households             integer,
  representative_area_m2 numeric(7, 2),
  search_doc             tsvector GENERATED ALWAYS AS (to_tsvector('simple', name)) STORED,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS apartment_complexes_dong_idx ON apartment_complexes (legal_dong_code);
CREATE INDEX IF NOT EXISTS apartment_complexes_search_gin ON apartment_complexes USING gin (search_doc);

-- ---------------------------------------------------------------------------
-- 2. 실거래 / 거시지표
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS apt_transactions (
  deal_hash       char(64) PRIMARY KEY,
  lawd_cd         char(5) NOT NULL,
  legal_dong_code char(10) NOT NULL REFERENCES regions (legal_dong_code) ON UPDATE CASCADE,
  apt_name        text NOT NULL,
  complex_id      text REFERENCES apartment_complexes (complex_id) ON UPDATE CASCADE,
  jibun           text,
  built_year      smallint,
  deal_month      char(7) NOT NULL,
  deal_date       date NOT NULL,
  floor           smallint,
  area_m2         numeric(7, 2) NOT NULL,
  price_krw       bigint NOT NULL,
  price_per_pyeong bigint NOT NULL,
  deal_type       text NOT NULL DEFAULT '중개거래',
  canceled        boolean NOT NULL DEFAULT false,
  source_id       text NOT NULL REFERENCES ingestion_sources (source_id),
  as_of_date      date NOT NULL,
  collected_at    timestamptz NOT NULL,
  source_note     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  search_doc      tsvector GENERATED ALWAYS AS (to_tsvector('simple', apt_name)) STORED,
  CONSTRAINT apt_transactions_price_positive CHECK (price_krw > 0),
  CONSTRAINT apt_transactions_area_positive CHECK (area_m2 > 0),
  CONSTRAINT apt_transactions_deal_month_format CHECK (deal_month ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT apt_transactions_deal_date_matches_month CHECK (to_char(deal_date, 'YYYY-MM') = deal_month)
);

-- 기간 스캔은 BRIN(데이터가 계약일 순으로 쌓이는 append-only 성격).
CREATE INDEX IF NOT EXISTS apt_transactions_deal_date_brin
  ON apt_transactions USING brin (deal_date) WITH (pages_per_range = 32);
-- 화면 조회 패턴: 지역 + 기간 + 금액 정렬.
CREATE INDEX IF NOT EXISTS apt_transactions_dong_month_price_idx
  ON apt_transactions (legal_dong_code, deal_month, price_krw DESC);
CREATE INDEX IF NOT EXISTS apt_transactions_lawd_month_idx
  ON apt_transactions (lawd_cd, deal_month);
CREATE INDEX IF NOT EXISTS apt_transactions_complex_month_idx
  ON apt_transactions (complex_id, deal_month);
CREATE INDEX IF NOT EXISTS apt_transactions_search_gin
  ON apt_transactions USING gin (search_doc);

-- 아파트 전월세 실거래 (국토교통부 getRTMSDataSvcAptRent).
-- 전세가율은 이 테이블의 전세 계약과 apt_transactions를 같은 면적 구간에서 매칭해 계산한다.
CREATE TABLE IF NOT EXISTS apt_rent_transactions (
  rent_hash            char(64) PRIMARY KEY,
  lawd_cd              char(5) NOT NULL,
  legal_dong_code      char(10) NOT NULL REFERENCES regions (legal_dong_code) ON UPDATE CASCADE,
  apt_name             text NOT NULL,
  complex_id           text REFERENCES apartment_complexes (complex_id) ON UPDATE CASCADE,
  jibun                text,
  built_year           smallint,
  deal_month           char(7) NOT NULL,
  deal_date            date NOT NULL,
  floor                smallint,
  area_m2              numeric(7, 2) NOT NULL,
  deposit_krw          bigint NOT NULL,
  monthly_rent_krw     integer NOT NULL DEFAULT 0,
  contract_type        text NOT NULL,
  contract_term_months smallint,
  renewal_requested    boolean NOT NULL DEFAULT false,
  source_id            text NOT NULL REFERENCES ingestion_sources (source_id),
  as_of_date           date NOT NULL,
  collected_at         timestamptz NOT NULL,
  source_note          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT apt_rent_transactions_deposit_positive CHECK (deposit_krw > 0),
  CONSTRAINT apt_rent_transactions_area_positive CHECK (area_m2 > 0),
  CONSTRAINT apt_rent_transactions_monthly_rent_nonnegative CHECK (monthly_rent_krw >= 0),
  CONSTRAINT apt_rent_transactions_contract_type CHECK (contract_type IN ('jeonse', 'monthly')),
  CONSTRAINT apt_rent_transactions_jeonse_has_no_rent CHECK (contract_type <> 'jeonse' OR monthly_rent_krw = 0),
  CONSTRAINT apt_rent_transactions_deal_month_format CHECK (deal_month ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT apt_rent_transactions_deal_date_matches_month CHECK (to_char(deal_date, 'YYYY-MM') = deal_month)
);

CREATE INDEX IF NOT EXISTS apt_rent_transactions_deal_date_brin
  ON apt_rent_transactions USING brin (deal_date) WITH (pages_per_range = 32);
CREATE INDEX IF NOT EXISTS apt_rent_transactions_lawd_month_idx
  ON apt_rent_transactions (lawd_cd, deal_month);
CREATE INDEX IF NOT EXISTS apt_rent_transactions_complex_month_idx
  ON apt_rent_transactions (complex_id, deal_month);
-- 전세가율 계산은 전세 계약만 읽으므로 부분 인덱스를 둔다.
CREATE INDEX IF NOT EXISTS apt_rent_transactions_jeonse_idx
  ON apt_rent_transactions (complex_id, deal_month, area_m2) WHERE contract_type = 'jeonse';

CREATE TABLE IF NOT EXISTS macro_indicators (
  indicator_code text NOT NULL,
  period_date    date NOT NULL,
  value          numeric(14, 4) NOT NULL,
  unit           text NOT NULL,
  indicator_name text NOT NULL,
  source_id      text NOT NULL REFERENCES ingestion_sources (source_id),
  as_of_date     date NOT NULL,
  collected_at   timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (indicator_code, period_date)
);
CREATE INDEX IF NOT EXISTS macro_indicators_period_idx
  ON macro_indicators (indicator_code, period_date DESC);

-- ---------------------------------------------------------------------------
-- 3. 수집 파이프라인 실행 이력 / 배치 태스크 / DLQ
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id            text PRIMARY KEY,
  source_id         text NOT NULL REFERENCES ingestion_sources (source_id),
  job_type          text NOT NULL CHECK (job_type IN ('backfill', 'incremental', 'manual')),
  status            text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'partial', 'failed')),
  started_at        timestamptz NOT NULL,
  finished_at       timestamptz,
  requested_months  integer NOT NULL CHECK (requested_months > 0),
  task_total        integer NOT NULL DEFAULT 0,
  task_succeeded    integer NOT NULL DEFAULT 0,
  task_failed       integer NOT NULL DEFAULT 0,
  records_upserted  integer NOT NULL DEFAULT 0,
  records_skipped   integer NOT NULL DEFAULT 0,
  retry_count       integer NOT NULL DEFAULT 0,
  error_summary     text,
  triggered_by      text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipeline_runs_started_idx ON pipeline_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_runs_source_status_idx ON pipeline_runs (source_id, status);

CREATE TABLE IF NOT EXISTS pipeline_run_tasks (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id      text NOT NULL REFERENCES pipeline_runs (run_id) ON DELETE CASCADE,
  source_id   text NOT NULL REFERENCES ingestion_sources (source_id),
  lawd_cd     char(5),
  period      char(7) NOT NULL,
  status      text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  attempts    integer NOT NULL DEFAULT 0,
  records     integer NOT NULL DEFAULT 0,
  error       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_run_tasks_unique_idx
  ON pipeline_run_tasks (run_id, lawd_cd, period);
-- 지역코드가 없는 태스크(거시지표 수집)는 (run_id, period)로 유일성을 보장한다.
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_run_tasks_unique_no_lawd_idx
  ON pipeline_run_tasks (run_id, period) WHERE lawd_cd IS NULL;

CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id            text PRIMARY KEY,
  run_id        text NOT NULL REFERENCES pipeline_runs (run_id) ON DELETE CASCADE,
  source_id     text NOT NULL REFERENCES ingestion_sources (source_id),
  payload       jsonb NOT NULL,
  error         text NOT NULL,
  attempts      integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dlq_unresolved_idx
  ON dead_letter_queue (next_retry_at) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. 사용자 행동 이벤트 (월 단위 RANGE 파티션)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_behavior_events (
  event_id       uuid NOT NULL,
  name           text NOT NULL,
  occurred_at    timestamptz NOT NULL,
  occurred_date  date NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  session_id     text NOT NULL,
  user_pseudo_id text NOT NULL,
  page           text NOT NULL,
  props          jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_version text NOT NULL,
  app_env        text NOT NULL,
  PRIMARY KEY (event_id, occurred_date)
) PARTITION BY RANGE (occurred_date);

CREATE INDEX IF NOT EXISTS user_behavior_events_occurred_brin
  ON user_behavior_events USING brin (occurred_at) WITH (pages_per_range = 16);
CREATE INDEX IF NOT EXISTS user_behavior_events_name_time_idx
  ON user_behavior_events (name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS user_behavior_events_session_idx
  ON user_behavior_events (session_id, occurred_at);
CREATE INDEX IF NOT EXISTS user_behavior_events_props_gin
  ON user_behavior_events USING gin (props jsonb_path_ops);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'user_behavior_events_default') THEN
    CREATE TABLE user_behavior_events_default PARTITION OF user_behavior_events DEFAULT;
  END IF;
END $$;

-- 월 파티션을 보장한다. 배치 적재 전에 대상 월로 호출한다.
CREATE OR REPLACE FUNCTION ensure_behavior_partition(target_date date)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  month_start date := date_trunc('month', target_date)::date;
  month_end   date := (date_trunc('month', target_date) + interval '1 month')::date;
  part_name   text := 'user_behavior_events_' || to_char(target_date, 'YYYYMM');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF user_behavior_events FOR VALUES FROM (%L) TO (%L)',
      part_name, month_start, month_end
    );
  END IF;
END $$;

-- 일 단위 퍼널 집계. 순서 보정 퍼널(세션 안에서 단계 순서를 지킨 도달)을 그대로 계산한다.
-- 대시보드의 실시간 퍼널과 같은 정의를 쓰기 위해 단계 간 시각 비교를 포함한다.
CREATE TABLE IF NOT EXISTS event_funnel_daily (
  funnel_date date NOT NULL,
  step_key    text NOT NULL,
  sessions    integer NOT NULL DEFAULT 0,
  events      integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (funnel_date, step_key)
);

CREATE OR REPLACE FUNCTION refresh_event_funnel_day(p_date date)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO event_funnel_daily (funnel_date, step_key, sessions, events)
  WITH per_session AS (
    SELECT
      session_id,
      min(occurred_at) FILTER (WHERE name = 'page_view') AS t1,
      min(occurred_at) FILTER (WHERE name = 'region_filter_change') AS t2,
      min(occurred_at) FILTER (WHERE name = 'complex_compare_add') AS t3,
      min(occurred_at) FILTER (WHERE name = 'rate_scenario_adjust') AS t4,
      min(occurred_at) FILTER (WHERE name = 'funnel_step_complete' AND props->>'step' = 'report_export') AS t5,
      count(*) FILTER (WHERE name = 'page_view') AS c1,
      count(*) FILTER (WHERE name = 'region_filter_change') AS c2,
      count(*) FILTER (WHERE name = 'complex_compare_add') AS c3,
      count(*) FILTER (WHERE name = 'rate_scenario_adjust') AS c4,
      count(*) FILTER (WHERE name = 'funnel_step_complete' AND props->>'step' = 'report_export') AS c5
    FROM user_behavior_events
    WHERE occurred_date = p_date
    GROUP BY session_id
  ),
  reached AS (
    SELECT
      c1, c2, c3, c4, c5,
      t1 IS NOT NULL AS r1,
      (t1 IS NOT NULL AND t2 IS NOT NULL AND t1 <= t2) AS r2,
      (t1 IS NOT NULL AND t2 IS NOT NULL AND t3 IS NOT NULL AND t1 <= t2 AND t2 <= t3) AS r3,
      (t1 IS NOT NULL AND t2 IS NOT NULL AND t3 IS NOT NULL AND t4 IS NOT NULL
        AND t1 <= t2 AND t2 <= t3 AND t3 <= t4) AS r4,
      (t1 IS NOT NULL AND t2 IS NOT NULL AND t3 IS NOT NULL AND t4 IS NOT NULL AND t5 IS NOT NULL
        AND t1 <= t2 AND t2 <= t3 AND t3 <= t4 AND t4 <= t5) AS r5
    FROM per_session
  )
  SELECT p_date, step_key, sessions, events
  FROM (
    SELECT 'dashboard_enter' AS step_key, count(*) FILTER (WHERE r1)::int AS sessions, coalesce(sum(c1), 0)::int AS events FROM reached
    UNION ALL
    SELECT 'region_filter', count(*) FILTER (WHERE r2)::int, coalesce(sum(c2), 0)::int FROM reached
    UNION ALL
    SELECT 'complex_compare', count(*) FILTER (WHERE r3)::int, coalesce(sum(c3), 0)::int FROM reached
    UNION ALL
    SELECT 'rate_scenario', count(*) FILTER (WHERE r4)::int, coalesce(sum(c4), 0)::int FROM reached
    UNION ALL
    SELECT 'report_export', count(*) FILTER (WHERE r5)::int, coalesce(sum(c5), 0)::int FROM reached
  ) AS steps
  ON CONFLICT (funnel_date, step_key) DO UPDATE
    SET sessions = EXCLUDED.sessions,
        events = EXCLUDED.events,
        updated_at = now();
END $$;

-- ---------------------------------------------------------------------------
-- 5. 집계 뷰 (화면·리포트가 같은 집계를 보도록 고정)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_transaction_monthly AS
SELECT
  legal_dong_code,
  deal_month,
  count(*) AS sample_count,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY price_krw)::bigint AS median_price_krw,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_pyeong)::bigint AS median_price_per_pyeong,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY area_m2)::numeric, 1) AS median_area_m2,
  sum(price_krw) AS total_volume_krw
FROM apt_transactions
WHERE canceled = false
GROUP BY legal_dong_code, deal_month
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_transaction_monthly_pk
  ON mv_transaction_monthly (legal_dong_code, deal_month);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_complex_monthly AS
SELECT
  t.complex_id,
  c.name AS complex_name,
  t.legal_dong_code,
  t.deal_month,
  count(*) AS sample_count,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY t.price_krw)::bigint AS median_price_krw,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY t.price_per_pyeong)::bigint AS median_price_per_pyeong
FROM apt_transactions t
JOIN apartment_complexes c ON c.complex_id = t.complex_id
WHERE t.canceled = false
GROUP BY t.complex_id, c.name, t.legal_dong_code, t.deal_month
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_complex_monthly_pk
  ON mv_complex_monthly (complex_id, deal_month);

-- 전세가율: 같은 단지·월·면적 구간(5㎡)에서 전세 평당가와 매매 평당가를 매칭해 비율을 낸다.
-- 화면(shared risk.ts)과 API가 같은 정의를 쓰도록 계산식을 여기에 고정했다.
CREATE OR REPLACE VIEW v_jeonse_ratio_monthly AS
WITH sale AS (
  SELECT
    complex_id,
    deal_month,
    width_bucket(area_m2, 0, 200, 40) AS area_bucket,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_pyeong) AS sale_ppp,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY price_krw)::bigint AS sale_median_krw,
    count(*) AS sale_samples
  FROM apt_transactions
  WHERE canceled = false AND complex_id IS NOT NULL
  GROUP BY complex_id, deal_month, width_bucket(area_m2, 0, 200, 40)
), rent AS (
  SELECT
    complex_id,
    deal_month,
    width_bucket(area_m2, 0, 200, 40) AS area_bucket,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY deposit_krw / (area_m2 / 3.305785)) AS jeonse_ppp,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY deposit_krw)::bigint AS jeonse_median_krw,
    count(*) AS jeonse_samples
  FROM apt_rent_transactions
  WHERE contract_type = 'jeonse' AND complex_id IS NOT NULL
  GROUP BY complex_id, deal_month, width_bucket(area_m2, 0, 200, 40)
)
SELECT
  r.complex_id,
  c.name AS complex_name,
  c.lawd_cd,
  c.legal_dong_code,
  r.deal_month,
  r.area_bucket,
  round((r.jeonse_ppp / NULLIF(s.sale_ppp, 0) * 100)::numeric, 1) AS jeonse_ratio_pct,
  r.jeonse_median_krw,
  s.sale_median_krw,
  r.jeonse_samples,
  s.sale_samples
FROM rent r
JOIN sale s ON s.complex_id = r.complex_id AND s.deal_month = r.deal_month AND s.area_bucket = r.area_bucket
JOIN apartment_complexes c ON c.complex_id = r.complex_id;

-- 수집 품질 점검: 기준일이 계약월과 어긋나거나, 보정·해제 표시가 있는 건을 한눈에 본다.
CREATE OR REPLACE VIEW v_ingestion_quality AS
SELECT
  source_id,
  date_trunc('month', collected_at)::date AS collected_month,
  count(*) AS total_rows,
  count(*) FILTER (WHERE canceled) AS canceled_rows,
  count(*) FILTER (WHERE source_note IS NOT NULL) AS annotated_rows,
  count(*) FILTER (WHERE to_char(as_of_date, 'YYYY-MM') <> deal_month) AS as_of_mismatch_rows,
  min(deal_month) AS oldest_deal_month,
  max(deal_month) AS newest_deal_month
FROM apt_transactions
GROUP BY source_id, date_trunc('month', collected_at)::date;
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS apt_transactions_set_updated_at ON apt_transactions;
CREATE TRIGGER apt_transactions_set_updated_at
  BEFORE UPDATE ON apt_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS macro_indicators_set_updated_at ON macro_indicators;
CREATE TRIGGER macro_indicators_set_updated_at
  BEFORE UPDATE ON macro_indicators
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS apt_rent_transactions_set_updated_at ON apt_rent_transactions;
CREATE TRIGGER apt_rent_transactions_set_updated_at
  BEFORE UPDATE ON apt_rent_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

-- ---------------------------------------------------------------------------
-- 6. 멱등 업서트 (collector가 실제로 실행하는 문장)
-- ---------------------------------------------------------------------------
-- INSERT INTO apt_transactions (...) VALUES (...)
-- ON CONFLICT (deal_hash) DO UPDATE
--   SET price_krw = EXCLUDED.price_krw,
--       price_per_pyeong = EXCLUDED.price_per_pyeong,
--       canceled = EXCLUDED.canceled,
--       collected_at = EXCLUDED.collected_at,
--       as_of_date = EXCLUDED.as_of_date,
--       source_note = EXCLUDED.source_note;
--
-- macro_indicators는 (indicator_code, period_date) 기준으로 갱신한다.
--   ON CONFLICT (indicator_code, period_date) DO UPDATE
--     SET value = EXCLUDED.value, collected_at = EXCLUDED.collected_at;
--
-- user_behavior_events는 (event_id, occurred_date) 기준으로 중복을 버린다.
--   ON CONFLICT (event_id, occurred_date) DO NOTHING;
