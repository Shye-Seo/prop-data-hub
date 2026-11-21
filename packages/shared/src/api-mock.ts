import { SAMPLE_END_MONTH, SAMPLE_MONTHS, buildSampleDataset, type SampleDataset } from './fixtures/sample-dataset';
import { EVENT_SCHEMA_VERSION } from './constants';
import { aggregateMonthly, latestMacroValue, recentMonths } from './metrics';
import { aggregateRatioSeries, jeonseRatioSeries } from './risk';
import {
  DEAL_SCORE_SUMMARY,
  buildAlertPreview,
  buildRadarDealSet,
  describeAlertRule,
  filterRadarDeals,
  normalizeAlertRule,
  paginateRadarDeals,
  radarSummary,
  type RadarDealSet,
  type RadarFilter,
} from './radar';
import type { AlertRuleDraft, AreaBandKey } from './types';

/**
 * 라이브 데모(GitHub Pages)용 API 예시 응답.
 *
 * 서버가 없는 정적 데모에서도 "이 엔드포인트를 호출하면 어떤 응답이 오는가"를 보여주기 위한 것으로,
 * 실제 API 호출이 아니다. 같은 표본 데이터셋과 shared 집계 함수를 쓰므로 수치가 화면과 일치한다.
 * 응답의 note 필드에 데모 응답임을 항상 남긴다.
 */
export interface MockRequest {
  path: string;
  method?: 'get' | 'post';
  params?: Record<string, string>;
  body?: unknown;
}

export interface MockResponse {
  status: number;
  body: Record<string, unknown>;
  note: string;
  matchedPath: string;
}

const MOCK_NOTE = '데모 응답: 서버를 호출하지 않고 같은 표본 데이터와 집계 함수로 계산했습니다.';

/** 레이더 표본 계산은 비용이 있어 데이터셋당 한 번만 만든다. */
const radarCache = new WeakMap<SampleDataset, RadarDealSet>();

function radarDealSet(dataset: SampleDataset): RadarDealSet {
  const cached = radarCache.get(dataset);
  if (cached) return cached;
  const set = buildRadarDealSet({
    transactions: dataset.transactions,
    rents: dataset.rentTransactions,
    complexes: dataset.complexes,
    regions: dataset.regions,
    months: recentMonths(SAMPLE_END_MONTH, SAMPLE_MONTHS),
  });
  radarCache.set(dataset, set);
  return set;
}

function truthy(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

function radarFilterFromParams(params: Record<string, string>): RadarFilter {
  const areaBand = (params.areaBand ?? 'all') as AreaBandKey | 'all';
  return {
    lawdCds: params.lawdCds ? params.lawdCds.split(',').map((code) => code.trim()).filter(Boolean) : undefined,
    minHouseholds: params.minHouseholds !== undefined ? Number(params.minHouseholds) : undefined,
    areaBand,
    maxDiscountPct: params.maxDiscountPct !== undefined ? Number(params.maxDiscountPct) : undefined,
    minScore: params.minScore !== undefined ? Number(params.minScore) : undefined,
  };
}

export function mockApiResponse(request: MockRequest, dataset: SampleDataset = buildSampleDataset()): MockResponse {
  const method = request.method ?? 'get';
  const params = request.params ?? {};
  const path = request.path;
  const months = recentMonths(SAMPLE_END_MONTH, SAMPLE_MONTHS);

  const respond = (matchedPath: string, status: number, body: Record<string, unknown>): MockResponse => ({
    status,
    body: { ...body, mock: true, note: MOCK_NOTE },
    note: MOCK_NOTE,
    matchedPath,
  });

  if (path === '/health') {
    return respond(path, 200, { status: 'ok', store: 'memory', appEnv: 'demo', uptimeSeconds: 0 });
  }

  if (path === '/api/v1' || path === '/api-docs/openapi.json') {
    return respond(path, 200, { name: 'prop-data-hub API', version: '1.1.0', documentation: '/api-docs' });
  }

  if (path === '/api/v1/regions') {
    return respond(path, 200, { items: dataset.regions, count: dataset.regions.length });
  }

  if (path === '/api/v1/complexes') {
    return respond(path, 200, { items: dataset.complexes, count: dataset.complexes.length });
  }

  if (path.startsWith('/api/v1/complexes/') && path.endsWith('/monthly')) {
    const complexId = decodeURIComponent(path.split('/')[4] ?? '');
    const complex = dataset.complexes.find((row) => row.complexId === complexId);
    if (!complex) return respond(path, 404, { error: 'complex_not_found', complexId });
    const monthCount = Number(params.months ?? 24);
    const series = aggregateMonthly(
      dataset.transactions.filter((row) => row.complexId === complexId),
      recentMonths(SAMPLE_END_MONTH, monthCount),
    );
    return respond(path, 200, { complex, months: monthCount, series, basis: '계약일 기준 중위값, 해제 거래 제외' });
  }

  if (path === '/api/v1/transactions') {
    const limit = Math.min(Number(params.limit ?? 5), 50);
    const rows = filterTransactions(dataset, params).slice(0, limit);
    return respond(path, 200, {
      items: rows,
      total: filterTransactions(dataset, params).length,
      limit,
      offset: 0,
    });
  }

  if (path === '/api/v1/transactions/monthly') {
    const scope = dataset.transactions.filter(
      (row) =>
        !row.canceled &&
        (!params.legalDongCode || row.legalDongCode === params.legalDongCode) &&
        (!params.lawdCd || row.lawdCd === params.lawdCd),
    );
    const monthCount = Number(params.months ?? 12);
    const series = aggregateMonthly(scope, recentMonths(SAMPLE_END_MONTH, monthCount));
    return respond(path, 200, { months: monthCount, series });
  }

  if (path === '/api/v1/rents') {
    const limit = Math.min(Number(params.limit ?? 5), 50);
    const rows = dataset.rentTransactions
      .filter((row) => (params.contractType ? row.contractType === params.contractType : true))
      .filter((row) => (params.lawdCd ? row.lawdCd === params.lawdCd : true))
      .filter((row) => (params.legalDongCode ? row.legalDongCode === params.legalDongCode : true))
      .filter((row) => (params.complexId ? row.complexId === params.complexId : true))
      .sort((a, b) => b.dealDate.localeCompare(a.dealDate));
    return respond(path, 200, { items: rows.slice(0, limit), total: rows.length, limit, offset: 0 });
  }

  if (path === '/api/v1/market/jeonse-ratio') {
    const monthCount = Number(params.months ?? 24);
    const monthList = recentMonths(SAMPLE_END_MONTH, monthCount);
    const complexes = dataset.complexes.filter(
      (complex) =>
        (!params.complexId || complex.complexId === params.complexId) &&
        (!params.legalDongCode || complex.legalDongCode === params.legalDongCode) &&
        (!params.lawdCd || complex.lawdCd === params.lawdCd),
    );
    const seriesList = complexes.map((complex) =>
      jeonseRatioSeries(
        dataset.rentTransactions.filter((row) => row.complexId === complex.complexId),
        dataset.transactions.filter((row) => row.complexId === complex.complexId),
        monthList,
        { complexId: complex.complexId, areaM2: complex.representativeAreaM2 },
      ),
    );
    const aggregated = aggregateRatioSeries(seriesList, { minContributors: complexes.length <= 1 ? 1 : 2 });
    const series = aggregated.map((row, index) => ({
      month: row.month,
      ratioPct: row.ratioPct,
      complexCount: seriesList.filter((item) => (item[index]?.ratioPct ?? 0) > 0).length,
    }));
    const latest = [...series].reverse().find((row) => row.ratioPct > 0);
    return respond(path, 200, { months: monthCount, latest, series, definition: '전세가율 = 전세 평당가 ÷ 매매 평당가 × 100(같은 면적 구간)' });
  }

  if (path === '/api/v1/macro') {
    return respond(path, 200, { items: dataset.macro.slice(-12), count: Math.min(12, dataset.macro.length) });
  }

  if (path === '/api/v1/macro/latest') {
    const items = ['base_rate', 'mortgage_rate', 'cpi']
      .map((code) => latestMacroValue(dataset.macro, code))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    return respond(path, 200, { items });
  }

  if (path === '/api/v1/pipeline/sources') {
    return respond(path, 200, { items: dataset.sources, count: dataset.sources.length });
  }

  if (path === '/api/v1/pipeline/runs') {
    return respond(path, 200, { items: dataset.pipelineRuns, count: dataset.pipelineRuns.length });
  }

  if (path.startsWith('/api/v1/pipeline/runs/')) {
    const runId = decodeURIComponent(path.split('/').pop() ?? '');
    const run = dataset.pipelineRuns.find((row) => row.runId === runId);
    if (!run) return respond(path, 404, { error: 'run_not_found', runId });
    return respond(path, 200, { run, tasks: dataset.runTasks.filter((task) => task.runId === runId) });
  }

  if (path === '/api/v1/pipeline/dlq') {
    return respond(path, 200, { items: dataset.deadLetters, count: dataset.deadLetters.length });
  }

  if (path === '/api/v1/radar/deals') {
    const set = radarDealSet(dataset);
    const filter = radarFilterFromParams(params);
    const effectiveFilter = truthy(params.includeBelowThreshold) ? { ...filter, minHouseholds: 0 } : filter;
    const filtered = filterRadarDeals(set.deals, effectiveFilter);
    const limit = Math.min(Number(params.limit ?? 5), 50);
    const offset = Number(params.offset ?? 0);
    return respond(path, 200, {
      items: paginateRadarDeals(filtered, limit, offset),
      total: filtered.length,
      limit,
      offset,
      asOfMonth: set.asOfMonth,
      filter: {
        lawdCds: filter.lawdCds ?? [],
        minHouseholds: effectiveFilter.minHouseholds ?? 350,
        areaBand: filter.areaBand ?? 'all',
        maxDiscountPct: filter.maxDiscountPct ?? 8,
        minScore: filter.minScore ?? 0,
      },
      summary: radarSummary(filtered),
      universe: set.universe,
      scoreWeights: DEAL_SCORE_SUMMARY,
      definition: '할인율 = (거래가 − 같은 단지·면적 구간 최근 6개월 중위가) ÷ 중위가 × 100',
    });
  }

  if (path === '/api/v1/radar/alert-rules' && method === 'get') {
    return respond(path, 200, {
      items: [],
      count: 0,
      hint: '데모에서는 저장한 규칙이 브라우저(localStorage)에 남습니다. 서버 모드에서는 alert_rules 테이블을 조회합니다.',
    });
  }

  if (path === '/api/v1/radar/alert-rules' && method === 'post') {
    const body = (request.body ?? {}) as Partial<AlertRuleDraft>;
    if (!body.name || !body.lawdCds || body.lawdCds.length === 0) {
      return respond(path, 400, {
        error: 'validation_error',
        issues: [
          ...(body.name ? [] : [{ path: 'name', message: '이름을 입력해야 합니다' }]),
          ...(body.lawdCds && body.lawdCds.length > 0 ? [] : [{ path: 'lawdCds', message: '지역을 하나 이상 선택해야 합니다' }]),
        ],
      });
    }
    const rule = normalizeAlertRule(
      { ...body, name: body.name, lawdCds: body.lawdCds },
      { ruleId: 'rule_demo_01', createdAt: '2026-11-20T06:00:00.000Z' },
    );
    const preview = buildAlertPreview(rule, radarDealSet(dataset).deals, { now: '2026-11-20T06:00:00.000Z' });
    return respond(path, 201, {
      rule,
      preview,
      condition: describeAlertRule(rule),
      saved: false,
      event: { recorded: false, reason: 'demo' },
    });
  }

  if (path === '/api/v1/events' && method === 'post') {
    const events = (request.body as { events?: unknown[] } | undefined)?.events ?? [];
    const accepted = events.length;
    return respond(path, accepted > 0 ? 202 : 400, {
      accepted,
      inserted: accepted,
      duplicates: 0,
      rejectedCount: 0,
      schemaVersion: EVENT_SCHEMA_VERSION,
    });
  }

  if (path === '/api/v1/events' && method === 'get') {
    return respond(path, 200, {
      items: [],
      total: 0,
      limit: Number(params.limit ?? 100),
      offset: 0,
      hint: '수집된 이벤트는 브라우저 데모에서 트래커가 보관합니다. 서버 없이도 화면의 인스펙터에서 확인할 수 있습니다.',
    });
  }

  if (path === '/api/v1/events/stats') {
    return respond(path, 200, {
      window: { hours: Number(params.hours ?? 24) },
      total: 0,
      sessions: 0,
      byName: {},
      funnel: [],
    });
  }

  if (path === '/api/v1/events/funnel') {
    return respond(path, 200, {
      date: params.date ?? '2026-11-20',
      eventCount: 0,
      funnel: [],
      definition: '세션 안에서 단계 순서를 지킨 도달만 집계(순서 보정 퍼널)',
    });
  }

  return respond(path, 404, { error: 'mock_route_not_found', path, method });
}

function filterTransactions(dataset: SampleDataset, params: Record<string, string>) {
  return dataset.transactions
    .filter((row) => (params.includeCanceled === 'true' ? true : !row.canceled))
    .filter((row) => (params.lawdCd ? row.lawdCd === params.lawdCd : true))
    .filter((row) => (params.legalDongCode ? row.legalDongCode === params.legalDongCode : true))
    .filter((row) => (params.aptName ? row.aptName.includes(params.aptName) : true))
    .filter((row) => (params.complexIds ? params.complexIds.split(',').includes(row.complexId ?? '') : true))
    .filter((row) => (params.minPriceKrw ? row.priceKrw >= Number(params.minPriceKrw) : true))
    .filter((row) => (params.maxPriceKrw ? row.priceKrw <= Number(params.maxPriceKrw) : true))
    .filter((row) => (params.fromMonth ? row.dealMonth >= params.fromMonth : true))
    .filter((row) => (params.toMonth ? row.dealMonth <= params.toMonth : true))
    .sort((a, b) => b.dealDate.localeCompare(a.dealDate));
}
