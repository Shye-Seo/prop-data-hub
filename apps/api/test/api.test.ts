import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server';
import { MemoryStore } from '../src/store/memory-store';
import { openApiDocument } from '../src/openapi';

const SESSION = 'session-api-test-0001';
const USER = 'user-api-test-0001';
const EVENT_ID = '11111111-1111-4111-8111-111111111111';

function pageView(occurredAt = '2026-11-19T01:00:00.000Z') {
  return {
    eventId: EVENT_ID,
    name: 'page_view',
    occurredAt,
    sessionId: SESSION,
    userPseudoId: USER,
    page: '/overview',
    props: { route: '/overview', isInitialLoad: true },
  };
}

describe('API', () => {
  let server: FastifyInstance;
  let store: MemoryStore;

  beforeAll(async () => {
    store = new MemoryStore();
    server = await buildServer({ store, corsOrigin: '*' });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('헬스 체크가 스토어 종류를 알려준다', async () => {
    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', store: 'memory' });
  });

  it('지역·단지 기준정보를 반환한다', async () => {
    const regions = await server.inject({ method: 'GET', url: '/api/v1/regions' });
    expect(regions.statusCode).toBe(200);
    expect(regions.json().count).toBe(3);

    const complexes = await server.inject({ method: 'GET', url: '/api/v1/complexes' });
    expect(complexes.statusCode).toBe(200);
    expect(complexes.json().count).toBe(12);
  });

  it('실거래를 지역·기간·면적으로 필터링하고 페이지를 나눈다', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/transactions?legalDongCode=2629051000&fromMonth=2026-01&toMonth=2026-09&limit=5&offset=0',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(5);
    expect(body.total).toBeGreaterThan(5);
    for (const item of body.items) {
      expect(item.legalDongCode).toBe('2629051000');
      expect(item.dealMonth >= '2026-01' && item.dealMonth <= '2026-09').toBe(true);
      expect(item.canceled).toBe(false);
    }

    const second = await server.inject({
      method: 'GET',
      url: '/api/v1/transactions?legalDongCode=2629051000&fromMonth=2026-01&toMonth=2026-09&limit=5&offset=5',
    });
    expect(second.json().items[0].dealHash).not.toBe(body.items[0].dealHash);
  });

  it('금액 정렬과 면적 필터가 동작한다', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/transactions?complexIds=MOLIT-26290-001&sort=price_desc&minAreaM2=80&maxAreaM2=90&limit=10',
    });
    expect(response.statusCode).toBe(200);
    const prices = response.json().items.map((item: { priceKrw: number }) => item.priceKrw);
    expect(prices.length).toBeGreaterThan(0);
    expect([...prices].sort((a, b) => b - a)).toEqual(prices);
    for (const item of response.json().items) {
      expect(item.areaM2).toBeGreaterThanOrEqual(80);
      expect(item.areaM2).toBeLessThanOrEqual(90);
    }
  });

  it('잘못된 지역코드는 400과 필드 오류를 낸다', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/transactions?lawdCd=2629' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('validation_error');
    expect(response.json().issues[0].path).toBe('lawdCd');
  });

  it('월별 시계열을 24개월로 채우고 빈 달은 0으로 둔다', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/transactions/monthly?legalDongCode=2629051000&months=24',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.series).toHaveLength(24);
    expect(body.series[23].month).toBe('2026-09');
    expect(body.series.every((row: { month: string }) => /^\d{4}-\d{2}$/.test(row.month))).toBe(true);
    expect(body.series[23].medianPriceKrw).toBeGreaterThan(0);
  });

  it('단지별 월별 추이와 없는 단지 404를 처리한다', async () => {
    const found = await server.inject({ method: 'GET', url: '/api/v1/complexes/MOLIT-26290-001/monthly?months=12' });
    expect(found.statusCode).toBe(200);
    expect(found.json().complex.name).toBe('문현베스티움');
    expect(found.json().series).toHaveLength(12);

    const missing = await server.inject({ method: 'GET', url: '/api/v1/complexes/NOPE/monthly' });
    expect(missing.statusCode).toBe(404);
  });

  it('거시지표 최신값 3종을 반환한다', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/macro/latest' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.baseRate.value).toBeGreaterThan(0);
    expect(body.mortgageRate.value).toBeGreaterThan(body.baseRate.value);
    expect(body.cpi.value).toBeGreaterThan(100);
    expect(body.baseRate.periodDate).toBe('2026-09-30');
  });

  it('수집 실행 이력·상세·DLQ를 반환한다', async () => {
    const runs = await server.inject({ method: 'GET', url: '/api/v1/pipeline/runs?limit=10' });
    expect(runs.statusCode).toBe(200);
    const body = runs.json();
    expect(body.count).toBe(6);
    expect(body.items[0].startedAt >= body.items[1].startedAt).toBe(true);
    expect(body.summary.failed).toBeGreaterThanOrEqual(1);

    const detail = await server.inject({ method: 'GET', url: '/api/v1/pipeline/runs/run_20261118_0200_molit' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().tasks).toHaveLength(6);
    expect(detail.json().tasks.filter((task: { status: string }) => task.status === 'failed')).toHaveLength(1);

    const missing = await server.inject({ method: 'GET', url: '/api/v1/pipeline/runs/nope' });
    expect(missing.statusCode).toBe(404);

    const dlq = await server.inject({ method: 'GET', url: '/api/v1/pipeline/dlq' });
    expect(dlq.json().unresolved).toBe(1);
  });

  it('행동 이벤트를 검증·적재하고 중복은 버린다', async () => {
    const first = await server.inject({ method: 'POST', url: '/api/v1/events', payload: { events: [pageView()] } });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ accepted: 1, inserted: 1, duplicates: 0 });

    const duplicate = await server.inject({ method: 'POST', url: '/api/v1/events', payload: { events: [pageView()] } });
    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.json()).toMatchObject({ inserted: 0, duplicates: 1 });

    const stored = await server.inject({ method: 'GET', url: `/api/v1/events?sessionId=${SESSION}` });
    expect(stored.json().total).toBe(1);
    expect(stored.json().items[0].props.route).toBe('/overview');
  });

  it('일부 이벤트가 스키마에 맞지 않으면 207로 거부 사유를 함께 돌려준다', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/events',
      payload: {
        events: [
          {
            name: 'region_filter_change',
            occurredAt: '2026-11-19T01:05:00.000Z',
            sessionId: 'session-api-test-0002',
            userPseudoId: 'user-api-test-0002',
            page: '/transactions',
            props: { lawdCd: '26290', dong: '문현동', areaBand: '60to85', periodMonths: 12 },
          },
          { name: 'region_filter_change', occurredAt: '2026-11-19T01:06:00.000Z', props: { lawdCd: 'x' } },
        ],
      },
    });
    expect(response.statusCode).toBe(207);
    expect(response.json()).toMatchObject({ accepted: 1, rejectedCount: 1 });
    expect(response.json().rejected[0].index).toBe(1);
  });

  it('전건이 거부되면 400을 낸다', async () => {
    const response = await server.inject({ method: 'POST', url: '/api/v1/events', payload: { events: [{ name: 'nope' }] } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('all_events_rejected');
  });

  it('수집 현황과 퍼널을 집계한다', async () => {
    const stats = await server.inject({ method: 'GET', url: '/api/v1/events/stats?hours=720' });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().total).toBeGreaterThanOrEqual(2);
    expect(stats.json().byName.page_view).toBeGreaterThanOrEqual(1);

    const funnel = await server.inject({ method: 'GET', url: '/api/v1/events/funnel?date=2026-11-19' });
    expect(funnel.statusCode).toBe(200);
    expect(funnel.json().funnel).toHaveLength(5);
    expect(funnel.json().funnel[0].sessions).toBeGreaterThanOrEqual(1);
  });

  it('OpenAPI 명세와 뷰어를 CDN 없이 서빙한다', async () => {
    const json = await server.inject({ method: 'GET', url: '/api-docs/openapi.json' });
    expect(json.statusCode).toBe(200);
    const document = json.json();
    expect(document.openapi).toBe('3.0.3');
    expect(Object.keys(document.paths)).toEqual(expect.arrayContaining(['/api/v1/transactions', '/api/v1/events']));
    expect(openApiDocument.components.schemas.BehaviorEvent.properties.name.enum).toHaveLength(6);

    const html = await server.inject({ method: 'GET', url: '/api-docs' });
    expect(html.statusCode).toBe(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.body).not.toMatch(/https?:\/\/cdn/);
    expect(html.body).toContain('openapi.json');
  });

  it('정의되지 않은 경로는 JSON 404를 낸다', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/unknown' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('not_found');
  });

  it('CORS 프리플라이트를 허용한다', async () => {
    const response = await server.inject({
      method: 'OPTIONS',
      url: '/api/v1/events',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    });
    expect(response.statusCode).toBeLessThan(300);
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });
});
