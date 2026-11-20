import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server';
import { MemoryStore } from '../src/store/memory-store';
import { openApiDocument } from '../src/openapi';
import { SAMPLE_COMPLEXES } from '@prop/shared';

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
    expect(regions.json().count).toBe(16);

    const complexes = await server.inject({ method: 'GET', url: '/api/v1/complexes' });
    expect(complexes.statusCode).toBe(200);
    expect(complexes.json().count).toBe(SAMPLE_COMPLEXES.length);
  });

  it('실거래를 지역·기간·면적으로 필터링하고 페이지를 나눈다', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/transactions?legalDongCode=2629010900&fromMonth=2026-01&toMonth=2026-09&limit=5&offset=0',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(5);
    expect(body.total).toBeGreaterThan(5);
    for (const item of body.items) {
      expect(item.legalDongCode).toBe('2629010900');
      expect(item.dealMonth >= '2026-01' && item.dealMonth <= '2026-09').toBe(true);
      expect(item.canceled).toBe(false);
    }

    const second = await server.inject({
      method: 'GET',
      url: '/api/v1/transactions?legalDongCode=2629010900&fromMonth=2026-01&toMonth=2026-09&limit=5&offset=5',
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
      url: '/api/v1/transactions/monthly?legalDongCode=2629010900&months=24',
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

  it('전월세 목록과 월별 전세가율을 반환한다', async () => {
    const rents = await server.inject({ method: 'GET', url: '/api/v1/rents?lawdCd=26500&contractType=jeonse&limit=5' });
    expect(rents.statusCode).toBe(200);
    const rentBody = rents.json();
    expect(rentBody.items.length).toBeLessThanOrEqual(5);
    expect(rentBody.total).toBeGreaterThan(0);
    for (const item of rentBody.items) {
      expect(item.lawdCd).toBe('26500');
      expect(item.contractType).toBe('jeonse');
      expect(item.monthlyRentKrw).toBe(0);
    }

    const ratio = await server.inject({ method: 'GET', url: '/api/v1/market/jeonse-ratio?lawdCd=26290&months=12' });
    expect(ratio.statusCode).toBe(200);
    const ratioBody = ratio.json();
    expect(ratioBody.series).toHaveLength(12);
    expect(ratioBody.latest.ratioPct).toBeGreaterThan(50);
    expect(ratioBody.series.every((row: { ratioPct: number }) => row.ratioPct === 0 || row.ratioPct > 50)).toBe(true);
    expect(ratioBody.series.at(-1).month).toBe('2026-09');

    const byComplex = await server.inject({
      method: 'GET',
      url: '/api/v1/market/jeonse-ratio?complexId=MOLIT-26290-001&months=6',
    });
    expect(byComplex.statusCode).toBe(200);
    expect(byComplex.json().series).toHaveLength(6);

    const missing = await server.inject({ method: 'GET', url: '/api/v1/market/jeonse-ratio?complexId=MOLIT-00000-999' });
    expect(missing.statusCode).toBe(404);

    const invalid = await server.inject({ method: 'GET', url: '/api/v1/rents?lawdCd=2629' });
    expect(invalid.statusCode).toBe(400);
  });

  it('OpenAPI 명세와 뷰어를 CDN 없이 서빙한다', async () => {
    const json = await server.inject({ method: 'GET', url: '/api-docs/openapi.json' });
    expect(json.statusCode).toBe(200);
    const document = json.json();
    expect(document.openapi).toBe('3.0.3');
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/api/v1/transactions', '/api/v1/events', '/api/v1/rents', '/api/v1/market/jeonse-ratio']),
    );
    expect(openApiDocument.components.schemas.BehaviorEvent.properties.name.enum).toHaveLength(11);

    const html = await server.inject({ method: 'GET', url: '/api-docs' });
    expect(html.statusCode).toBe(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.body).not.toMatch(/https?:\/\/cdn/);
    expect(html.body).toContain('openapi.json');
  });

  it('레이더 기본 조건(350세대 이상·-8% 이하)으로 매물과 점수를 반환한다', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/radar/deals?limit=5' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(5);
    expect(body.total).toBeGreaterThanOrEqual(body.items.length);
    expect(body.asOfMonth).toBe('2026-09');
    expect(body.filter.minHouseholds).toBe(350);
    expect(body.filter.maxDiscountPct).toBe(8);
    expect(body.summary.count).toBe(body.total);
    expect(body.universe.largeComplexes).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.households).toBeGreaterThanOrEqual(350);
      expect(item.discountPct).toBeLessThanOrEqual(-8);
      expect(item.dealScore).toBeGreaterThanOrEqual(0);
      expect(item.dealScore).toBeLessThanOrEqual(100);
      expect(item.medianPriceKrw).toBeGreaterThan(0);
      expect(item.signals.length).toBeGreaterThan(0);
    }
    // 점수 내림차순 정렬
    const scores = body.items.map((item: { dealScore: number }) => item.dealScore);
    expect([...scores].sort((a: number, b: number) => b - a)).toEqual(scores);
  });

  it('레이더 세대수·구·평형·할인율 필터가 각각 동작한다', async () => {
    const all = await server.inject({ method: 'GET', url: '/api/v1/radar/deals?limit=200&minHouseholds=0' });
    const items = all.json().items as Array<{ households: number; lawdCd: string; areaBand: string; discountPct: number; complexName: string }>;
    expect(items.some((item) => item.households < 350)).toBe(true);
    expect(new Set(items.map((item) => item.lawdCd)).size).toBeGreaterThanOrEqual(6);

    const lawd = await server.inject({ method: 'GET', url: '/api/v1/radar/deals?lawdCds=26230,26290&limit=200' });
    expect(lawd.statusCode).toBe(200);
    for (const item of lawd.json().items) expect(['26230', '26290']).toContain(item.lawdCd);

    const area = await server.inject({ method: 'GET', url: '/api/v1/radar/deals?areaBand=85to115&limit=200' });
    for (const item of area.json().items) expect(item.areaBand).toBe('85to115');

    const deep = await server.inject({ method: 'GET', url: '/api/v1/radar/deals?maxDiscountPct=15&limit=200' });
    for (const item of deep.json().items) expect(item.discountPct).toBeLessThanOrEqual(-15);
    expect(deep.json().total).toBeLessThanOrEqual(all.json().total);
  });

  it('레이더 파라미터가 잘못되면 400을 낸다', async () => {
    const badLawd = await server.inject({ method: 'GET', url: '/api/v1/radar/deals?lawdCds=2623' });
    expect(badLawd.statusCode).toBe(400);
    expect(badLawd.json().issues[0].path).toBe('lawdCds');

    const badBand = await server.inject({ method: 'GET', url: '/api/v1/radar/deals?areaBand=all-in' });
    expect(badBand.statusCode).toBe(400);

    const badDiscount = await server.inject({ method: 'GET', url: '/api/v1/radar/deals?maxDiscountPct=80' });
    expect(badDiscount.statusCode).toBe(400);
  });

  it('알림 규칙을 저장하고 미리보기·행동 이벤트를 함께 남긴다', async () => {
    const payload = {
      name: '부산진구·남구 84㎡ 급매',
      lawdCds: ['26230', '26290'],
      minHouseholds: 350,
      areaBand: '60to85',
      maxDiscountPct: 8,
      minScore: 40,
      channels: ['kakao_alimtalk', 'webhook'],
      sessionId: 'session-radar-0001',
      userPseudoId: 'user-radar-0001',
    };
    const created = await server.inject({ method: 'POST', url: '/api/v1/radar/alert-rules', payload });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.saved).toBe(true);
    expect(body.rule.ruleId).toMatch(/^rule_/);
    expect(body.rule.lastMatchedCount).toBe(body.preview.matchedCount);
    expect(body.preview.kakao.templateCode).toBe('PROP_RADAR_DEAL_01');
    expect(body.preview.webhook.body.type).toBe('radar.deal.matched');
    expect(body.event.recorded).toBe(true);
    for (const deal of body.preview.sample) {
      expect(['26230', '26290']).toContain(deal.lawdCd);
      expect(deal.households).toBeGreaterThanOrEqual(350);
      expect(deal.areaBand).toBe('60to85');
      expect(deal.discountPct).toBeLessThanOrEqual(-8);
    }

    const stored = await server.inject({ method: 'GET', url: '/api/v1/radar/alert-rules' });
    expect(stored.statusCode).toBe(200);
    expect(stored.json().count).toBe(1);
    expect(stored.json().items[0].ruleId).toBe(body.rule.ruleId);

    const events = await server.inject({ method: 'GET', url: '/api/v1/events?name=alert_rule_create' });
    expect(events.json().total).toBe(1);
    expect(events.json().items[0].props.ruleId).toBe(body.rule.ruleId);
    expect(events.json().items[0].props.matchedCount).toBe(body.preview.matchedCount);
  });

  it('알림 규칙 본문이 잘못되면 400을 낸다', async () => {
    const noName = await server.inject({
      method: 'POST',
      url: '/api/v1/radar/alert-rules',
      payload: { lawdCds: ['26230'] },
    });
    expect(noName.statusCode).toBe(400);
    expect(noName.json().issues[0].path).toBe('name');

    const noRegion = await server.inject({
      method: 'POST',
      url: '/api/v1/radar/alert-rules',
      payload: { name: '지역 없음', lawdCds: [] },
    });
    expect(noRegion.statusCode).toBe(400);

    const badChannel = await server.inject({
      method: 'POST',
      url: '/api/v1/radar/alert-rules',
      payload: { name: '채널 오류', lawdCds: ['26230'], channels: ['sms'] },
    });
    expect(badChannel.statusCode).toBe(400);
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
