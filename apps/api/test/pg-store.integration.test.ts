import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgStore, type Queryable } from '../src/store/pg-store';

/**
 * PostgreSQL 16 문법을 WASM으로 실행하는 PGlite에서 스키마와 리포지토리 SQL을 실제로 검증한다.
 * 로컬 환경에 PostgreSQL 서버가 없어도 DDL·인덱스·멱등 업서트·파티션·퍼널 함수를 확인할 수 있다.
 * (프로덕션 PostgreSQL 버전·확장 구성 차이는 README의 검증 범위에 적어 두었다.)
 */
const initSqlPath = fileURLToPath(new URL('../../../infra/postgres/init.sql', import.meta.url));

describe('PostgreSQL 스키마와 PgStore (PGlite)', () => {
  let db: PGlite;
  let store: PgStore;

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    const initSql = readFileSync(initSqlPath, 'utf8');
    await db.exec(initSql);
    store = new PgStore({
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        const result = await db.query<T>(sql, params as unknown[]);
        return { rows: result.rows };
      },
    } satisfies Queryable);

    await db.exec(`
      INSERT INTO regions (legal_dong_code, lawd_cd, sido, sigungu, dong) VALUES
        ('2629051000', '26290', '부산광역시', '남구', '문현동'),
        ('2629052000', '26290', '부산광역시', '남구', '대연동');

      INSERT INTO apartment_complexes (complex_id, name, legal_dong_code, lawd_cd, built_year, households, representative_area_m2)
      VALUES
        ('MOLIT-26290-001', '문현베스티움', '2629051000', '26290', 2019, 743, 84.98),
        ('MOLIT-26290-006', '대연롯데캐슬레전드', '2629052000', '26290', 2018, 3149, 84.97);
    `);

    const upsert = `
      INSERT INTO apt_transactions (
        deal_hash, lawd_cd, legal_dong_code, apt_name, complex_id, jibun, built_year, deal_month, deal_date,
        floor, area_m2, price_krw, price_per_pyeong, deal_type, canceled, source_id, as_of_date, collected_at, source_note
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (deal_hash) DO UPDATE
        SET price_krw = EXCLUDED.price_krw,
            price_per_pyeong = EXCLUDED.price_per_pyeong,
            collected_at = EXCLUDED.collected_at,
            as_of_date = EXCLUDED.as_of_date,
            source_note = EXCLUDED.source_note
    `;

    const rows = [
      ['a'.repeat(64), '26290', '2629051000', '문현베스티움', 'MOLIT-26290-001', '806', 2019, '2026-09', '2026-09-12', 12, 84.98, 845_000_000, 32_871_126, '중개거래', false, 'molit_apt_trade', '2026-09-01', '2026-09-30T02:00:00Z', null],
      ['b'.repeat(64), '26290', '2629051000', '문현베스티움', 'MOLIT-26290-001', '806', 2019, '2026-09', '2026-09-20', 8, 59.94, 620_000_000, 34_198_000, '중개거래', false, 'molit_apt_trade', '2026-09-01', '2026-09-30T02:00:00Z', null],
      ['c'.repeat(64), '26290', '2629052000', '대연롯데캐슬레전드', 'MOLIT-26290-006', '158', 2018, '2026-08', '2026-08-12', 24, 84.97, 810_000_000, 31_509_000, '중개거래', false, 'molit_apt_trade', '2026-08-01', '2026-08-28T02:00:00Z', null],
      ['d'.repeat(64), '26290', '2629052000', '대연롯데캐슬레전드', 'MOLIT-26290-006', '158', 2018, '2026-08', '2026-08-22', 19, 84.97, 705_000_000, 27_424_000, '중개거래', true, 'molit_apt_trade', '2026-08-01', '2026-08-28T02:00:00Z', 'contract_canceled'],
    ];
    for (const row of rows) await db.query(upsert, row);

    await db.query(
      `INSERT INTO macro_indicators (indicator_code, period_date, value, unit, indicator_name, source_id, as_of_date, collected_at)
       VALUES ('base_rate', '2026-09-30', 2.25, '연%', '한국은행 기준금리', 'ecos_rates', '2026-09-30', '2026-10-01T01:00:00Z'),
              ('base_rate', '2026-08-31', 2.5, '연%', '한국은행 기준금리', 'ecos_rates', '2026-08-31', '2026-09-01T01:00:00Z')
       ON CONFLICT (indicator_code, period_date) DO UPDATE SET value = EXCLUDED.value, collected_at = EXCLUDED.collected_at`,
    );

    await db.query(
      `INSERT INTO pipeline_runs (run_id, source_id, job_type, status, started_at, finished_at, requested_months,
        task_total, task_succeeded, task_failed, records_upserted, records_skipped, retry_count, error_summary, triggered_by)
       VALUES ('run_test_001', 'molit_apt_trade', 'incremental', 'partial', '2026-11-18T02:00:00Z', '2026-11-18T02:05:00Z', 2,
        2, 1, 1, 42, 3, 2, 'HTTP 504', 'eventbridge-scheduler')`,
    );
    await db.query(
      `INSERT INTO pipeline_run_tasks (run_id, source_id, lawd_cd, period, status, attempts, records, error)
       VALUES ('run_test_001', 'molit_apt_trade', '26290', '2026-09', 'succeeded', 1, 30, NULL),
              ('run_test_001', 'molit_apt_trade', '26350', '2026-09', 'failed', 3, 0, 'HTTP 504')`,
    );
    await db.query(
      `INSERT INTO dead_letter_queue (id, run_id, source_id, payload, error, attempts, next_retry_at)
       VALUES ('dlq_test_001', 'run_test_001', 'molit_apt_trade', '{"lawdCd":"26350"}'::jsonb, 'HTTP 504', 3, '2026-11-18T02:20:00Z')`,
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('스키마를 두 번 적용해도 오류 없이 같은 상태가 된다', async () => {
    const initSql = readFileSync(initSqlPath, 'utf8');
    await expect(db.exec(initSql)).resolves.toBeInstanceOf(Array);
    const { rows } = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM apt_transactions');
    expect(Number(rows[0]!.count)).toBe(4);
  });

  it('인덱스가 BRIN·GIN·BTREE로 생성된다', async () => {
    const { rows } = await db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('apt_transactions', 'user_behavior_events')`,
    );
    const definitions = rows.map((row) => `${row.indexname}::${row.indexdef}`).join('\n');
    expect(definitions).toMatch(/apt_transactions_deal_date_brin::.*USING brin/i);
    expect(definitions).toMatch(/apt_transactions_search_gin::.*USING gin/i);
    expect(definitions).toMatch(/apt_transactions_dong_month_price_idx::.*btree/i);
  });

  it('같은 거래를 다시 업서트해도 행이 늘지 않고 값만 갱신된다', async () => {
    const before = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM apt_transactions');
    expect(Number(before.rows[0]!.count)).toBe(4);

    await db.query(
      `INSERT INTO apt_transactions (
        deal_hash, lawd_cd, legal_dong_code, apt_name, complex_id, jibun, built_year, deal_month, deal_date,
        floor, area_m2, price_krw, price_per_pyeong, deal_type, canceled, source_id, as_of_date, collected_at, source_note
      ) VALUES ($1,'26290','2629051000','문현베스티움','MOLIT-26290-001','806',2019,'2026-09','2026-09-12',12,84.98,850000000,32871000,'중개거래',false,'molit_apt_trade','2026-09-01','2026-10-02T02:00:00Z',null)
      ON CONFLICT (deal_hash) DO UPDATE SET price_krw = EXCLUDED.price_krw, price_per_pyeong = EXCLUDED.price_per_pyeong, collected_at = EXCLUDED.collected_at`,
      ['a'.repeat(64)],
    );

    const after = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM apt_transactions');
    expect(Number(after.rows[0]!.count)).toBe(4);
    const updated = await db.query<{ price_krw: string }>(
      'SELECT price_krw FROM apt_transactions WHERE deal_hash = $1',
      ['a'.repeat(64)],
    );
    expect(Number(updated.rows[0]!.price_krw)).toBe(850_000_000);
  });

  it('PgStore가 지역·단지·실거래를 조회한다', async () => {
    const regions = await store.listRegions();
    expect(regions).toHaveLength(2);
    expect(regions[0]?.dong).toBe('문현동');

    const complexes = await store.listComplexes();
    expect(complexes[0]?.name).toBe('문현베스티움');
    expect(complexes[0]?.representativeAreaM2).toBe(84.98);

    const page = await store.listTransactions({ limit: 10, offset: 0, lawdCd: '26290' });
    expect(page.total).toBe(3);
    expect(page.rows[0]?.dealDate).toBe('2026-09-20');
    expect(page.rows.every((row) => row.canceled === false)).toBe(true);

    const withCanceled = await store.listTransactions({ limit: 10, offset: 0, includeCanceled: true });
    expect(withCanceled.total).toBe(4);
    expect(withCanceled.rows.some((row) => row.canceled)).toBe(true);
  });

  it('필터·정렬·페이지네이션 조합이 SQL에서 동작한다', async () => {
    const page = await store.listTransactions({
      limit: 1,
      offset: 1,
      legalDongCode: '2629051000',
      fromMonth: '2026-09',
      toMonth: '2026-09',
      sort: 'price_desc',
    });
    expect(page.total).toBe(2);
    expect(page.rows[0]?.priceKrw).toBe(620_000_000);
  });

  it('월별 중위가 시계열이 빈 달을 채워 반환된다', async () => {
    const series = await store.monthlySeries({ legalDongCode: '2629051000', months: 3 });
    expect(series).toHaveLength(3);
    expect(series.map((row) => row.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(series[0]?.sampleCount).toBe(0);
    expect(series[2]?.sampleCount).toBe(2);
    // 앞선 업서트에서 845,000,000원이 850,000,000원으로 갱신됐다. 중위값은 (620,000,000 + 850,000,000) / 2.
    expect(series[2]?.medianPriceKrw).toBe(735_000_000);
  });

  it('거시지표를 코드·기간으로 조회한다', async () => {
    const rows = await store.listMacro({ codes: ['base_rate'], from: '2026-09-01' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(2.25);
    expect(rows[0]?.period).toBe('2026-09');
  });

  it('파이프라인 실행·태스크·DLQ를 조회한다', async () => {
    const runs = await store.listPipelineRuns(5);
    expect(runs[0]).toMatchObject({ runId: 'run_test_001', status: 'partial', taskFailed: 1 });
    const tasks = await store.listRunTasks('run_test_001');
    expect(tasks).toHaveLength(2);
    expect(tasks.find((task) => task.status === 'failed')?.attempts).toBe(3);

    const dlq = await store.listDeadLetters();
    expect(dlq[0]?.resolvedAt).toBeNull();
  });

  it('행동 이벤트는 월 파티션에 적재되고 event_id 중복을 버린다', async () => {
    const record = (id: string, name: 'page_view' | 'region_filter_change', occurredAt: string, props: Record<string, unknown>) => ({
      eventId: id,
      name,
      occurredAt,
      receivedAt: occurredAt,
      sessionId: 'session-pg-0001',
      userPseudoId: 'user-pg-0001',
      page: '/overview',
      props,
      schemaVersion: '1.0.0',
      appEnv: 'local',
    });

    const events = [
      record('11111111-1111-4111-8111-111111111111', 'page_view', '2026-11-19T01:00:00.000Z', { route: '/overview' }),
      record('22222222-2222-4222-8222-222222222222', 'region_filter_change', '2026-11-19T01:02:00.000Z', {
        lawdCd: '26290',
        dong: '문현동',
        areaBand: '60to85',
        periodMonths: 12,
      }),
    ];

    const first = await store.insertBehaviorEvents(events);
    expect(first).toEqual({ inserted: 2, duplicates: 0 });

    const again = await store.insertBehaviorEvents(events);
    expect(again).toEqual({ inserted: 0, duplicates: 2 });

    const partition = await db.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname = 'user_behavior_events_202611'`,
    );
    expect(partition.rows).toHaveLength(1);

    const stored = await store.listBehaviorEvents({ limit: 10, offset: 0, date: '2026-11-19' });
    expect(stored.total).toBe(2);
    expect(stored.rows[0]?.name).toBe('region_filter_change');

    const stats = await store.eventStats('2026-11-01T00:00:00.000Z');
    expect(stats.total).toBe(2);
    expect(stats.sessions).toBe(1);
  });

  it('일 단위 퍼널 함수가 순서를 지킨 도달만 집계한다', async () => {
    await db.query('SELECT refresh_event_funnel_day($1::date)', ['2026-11-19']);
    const { rows } = await db.query<{ step_key: string; sessions: number }>(
      'SELECT step_key, sessions FROM event_funnel_daily WHERE funnel_date = $1 ORDER BY step_key',
      ['2026-11-19'],
    );
    expect(rows).toHaveLength(5);
    const byStep = Object.fromEntries(rows.map((row) => [row.step_key, Number(row.sessions)]));
    expect(byStep.dashboard_enter).toBe(1);
    expect(byStep.region_filter).toBe(1);
    expect(byStep.complex_compare).toBe(0);
  });

  it('집계 머티리얼라이즈드 뷰가 해제 거래를 제외한다', async () => {
    await db.exec('REFRESH MATERIALIZED VIEW mv_transaction_monthly');
    const { rows } = await db.query<{ legal_dong_code: string; deal_month: string; sample_count: string; median_price_krw: string }>(
      'SELECT legal_dong_code, deal_month, sample_count, median_price_krw FROM mv_transaction_monthly ORDER BY deal_month, legal_dong_code',
    );
    // (문현동, 2026-09) 2건과 (대연동, 2026-08) 1건 = 2개 그룹
    expect(rows).toHaveLength(2);
    const daeyeon = rows.find((row) => row.legal_dong_code === '2629052000');
    expect(Number(daeyeon?.sample_count)).toBe(1);
    expect(Number(daeyeon?.median_price_krw)).toBe(810_000_000);
  });

  it('수집 품질 뷰가 보정·해제 건을 센다', async () => {
    const { rows } = await db.query<{ total_rows: string; canceled_rows: string; annotated_rows: string }>(
      `SELECT sum(total_rows)::text AS total_rows, sum(canceled_rows)::text AS canceled_rows, sum(annotated_rows)::text AS annotated_rows
         FROM v_ingestion_quality`,
    );
    expect(Number(rows[0]?.total_rows)).toBe(4);
    expect(Number(rows[0]?.canceled_rows)).toBe(1);
    expect(Number(rows[0]?.annotated_rows)).toBe(1);
  });

  it('전월세 테이블이 제약으로 잘못된 계약을 막는다', async () => {
    const insert = `
      INSERT INTO apt_rent_transactions (
        rent_hash, lawd_cd, legal_dong_code, apt_name, complex_id, jibun, built_year, deal_month, deal_date,
        floor, area_m2, deposit_krw, monthly_rent_krw, contract_type, contract_term_months, renewal_requested,
        source_id, as_of_date, collected_at, source_note
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    `;
    await db.query(insert, [
      'r'.repeat(64), '26290', '2629051000', '문현베스티움', 'MOLIT-26290-001', '806', 2019, '2026-09', '2026-09-14',
      9, 84.98, 428_000_000, 0, 'jeonse', 24, false, 'molit_apt_rent', '2026-09-01', '2026-10-01T03:00:00Z', null,
    ]);
    await db.query(insert, [
      's'.repeat(64), '26290', '2629051000', '문현베스티움', 'MOLIT-26290-001', '806', 2019, '2026-09', '2026-09-08',
      17, 59.94, 300_000_000, 950_000, 'monthly', 12, true, 'molit_apt_rent', '2026-09-01', '2026-10-01T03:00:00Z', null,
    ]);

    await expect(
      db.query(insert, [
        't'.repeat(64), '26290', '2629051000', '문현베스티움', 'MOLIT-26290-001', '806', 2019, '2026-09', '2026-09-09',
        5, 84.98, 400_000_000, 500_000, 'jeonse', 24, false, 'molit_apt_rent', '2026-09-01', '2026-10-01T03:00:00Z', null,
      ]),
    ).rejects.toThrow(/apt_rent_transactions_jeonse_has_no_rent/);

    const { rows } = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM apt_rent_transactions');
    expect(Number(rows[0]!.count)).toBe(2);
  });

  it('전세가율 뷰가 같은 면적 구간의 전세·매매를 매칭한다', async () => {
    const { rows } = await db.query<{
      complex_id: string;
      deal_month: string;
      area_bucket: string;
      jeonse_ratio_pct: string;
      jeonse_samples: string;
    }>(
      `SELECT complex_id, deal_month, area_bucket::text AS area_bucket, jeonse_ratio_pct::text, jeonse_samples::text
         FROM v_jeonse_ratio_monthly ORDER BY deal_month, area_bucket`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.complex_id).toBe('MOLIT-26290-001');
    expect(rows[0]?.deal_month).toBe('2026-09');
    expect(Number(rows[0]?.area_bucket)).toBe(17);
    // 84.98㎡ 전세(428,000,000) ÷ 같은 달 84.98㎡ 매매 중위(845,000,000) ≈ 50.6%
    expect(Number(rows[0]?.jeonse_ratio_pct)).toBeGreaterThan(49);
    expect(Number(rows[0]?.jeonse_ratio_pct)).toBeLessThan(52);
    expect(Number(rows[0]?.jeonse_samples)).toBe(1);
  });

  it('PgStore가 전월세 목록과 월별 전세가율을 조회한다', async () => {
    const page = await store.listRentTransactions({ lawdCd: '26290', limit: 10, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.rows[0]?.aptName).toBe('문현베스티움');
    expect(page.rows.some((row) => row.contractType === 'monthly' && row.monthlyRentKrw === 950_000)).toBe(true);
    expect(page.rows.every((row) => row.dong === '문현동')).toBe(true);

    const jeonseOnly = await store.listRentTransactions({ contractType: 'jeonse', limit: 10, offset: 0 });
    expect(jeonseOnly.total).toBe(1);
    expect(jeonseOnly.rows[0]?.monthlyRentKrw).toBe(0);

    const series = await store.jeonseRatioMonthly({ lawdCd: '26290', months: 3 });
    expect(series).toHaveLength(3);
    expect(series.at(-1)?.month).toBe('2026-09');
    expect(series.at(-1)?.ratioPct).toBeGreaterThan(49);
    expect(series.at(-1)?.complexCount).toBe(1);
    expect(series[0]?.ratioPct).toBe(0);
  });
});
