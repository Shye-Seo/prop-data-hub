/**
 * OpenAPI 3.0 명세.
 * 외부 CDN 없이 서빙하기 위해 객체로 두고 /api-docs/openapi.json에서 그대로 내려준다.
 */
export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'prop-data-hub API',
    version: '1.0.0',
    description:
      '부동산 실거래가·거시지표 수집 결과와 사용자 행동 이벤트를 조회·수집하는 API. ' +
      '모든 금액은 원(KRW), 면적은 ㎡, 평당가는 원/평 기준이다.',
  },
  servers: [{ url: 'http://localhost:8080', description: '로컬 개발' }],
  tags: [
    { name: 'reference', description: '지역·단지 기준정보' },
    { name: 'transactions', description: '실거래가 조회' },
    { name: 'macro', description: '거시지표' },
    { name: 'pipeline', description: '수집 파이프라인 상태' },
    { name: 'events', description: '사용자 행동 이벤트' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['reference'],
        summary: '헬스 체크',
        responses: {
          '200': {
            description: '정상',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    store: { type: 'string', enum: ['memory', 'postgres'] },
                    uptimeSeconds: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/regions': {
      get: {
        tags: ['reference'],
        summary: '법정동 목록',
        responses: { '200': { description: '법정동 목록', content: { 'application/json': { schema: { $ref: '#/components/schemas/RegionList' } } } } },
      },
    },
    '/api/v1/complexes': {
      get: {
        tags: ['reference'],
        summary: '단지 목록',
        responses: { '200': { description: '단지 목록' } },
      },
    },
    '/api/v1/complexes/{complexId}/monthly': {
      get: {
        tags: ['reference'],
        summary: '단지 월별 중위가 추이',
        parameters: [
          { name: 'complexId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'months', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 60, default: 24 } },
        ],
        responses: {
          '200': { description: '월별 추이' },
          '404': { description: '단지 없음' },
        },
      },
    },
    '/api/v1/transactions': {
      get: {
        tags: ['transactions'],
        summary: '실거래 조회',
        parameters: [
          { name: 'lawdCd', in: 'query', schema: { type: 'string', pattern: '^\\d{5}$' }, description: '시군구 코드' },
          { name: 'legalDongCode', in: 'query', schema: { type: 'string', pattern: '^\\d{10}$' } },
          { name: 'aptName', in: 'query', schema: { type: 'string' }, description: '단지명 부분 일치' },
          { name: 'complexIds', in: 'query', schema: { type: 'string' }, description: '쉼표 구분 단지 ID' },
          { name: 'fromMonth', in: 'query', schema: { type: 'string', example: '2025-10' } },
          { name: 'toMonth', in: 'query', schema: { type: 'string', example: '2026-09' } },
          { name: 'minPriceKrw', in: 'query', schema: { type: 'integer' } },
          { name: 'maxPriceKrw', in: 'query', schema: { type: 'integer' } },
          { name: 'minAreaM2', in: 'query', schema: { type: 'number' } },
          { name: 'maxAreaM2', in: 'query', schema: { type: 'number' } },
          { name: 'includeCanceled', in: 'query', schema: { type: 'boolean', default: false } },
          {
            name: 'sort',
            in: 'query',
            schema: { type: 'string', enum: ['deal_date_desc', 'price_desc', 'price_asc', 'ppp_desc'], default: 'deal_date_desc' },
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
        ],
        responses: {
          '200': {
            description: '실거래 목록',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/Transaction' } },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
        },
      },
    },
    '/api/v1/transactions/monthly': {
      get: {
        tags: ['transactions'],
        summary: '월별 중위가·평당가·거래량',
        parameters: [
          { name: 'lawdCd', in: 'query', schema: { type: 'string' } },
          { name: 'legalDongCode', in: 'query', schema: { type: 'string' } },
          { name: 'months', in: 'query', schema: { type: 'integer', default: 24, maximum: 60 } },
        ],
        responses: { '200': { description: '월별 집계' }, '400': { $ref: '#/components/responses/ValidationError' } },
      },
    },
    '/api/v1/macro': {
      get: {
        tags: ['macro'],
        summary: '거시지표 시계열',
        parameters: [
          { name: 'codes', in: 'query', schema: { type: 'string', example: 'base_rate,mortgage_rate,cpi' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { '200': { description: '거시지표 목록' } },
      },
    },
    '/api/v1/macro/latest': {
      get: { tags: ['macro'], summary: '지표별 최신값', responses: { '200': { description: '최신값' } } },
    },
    '/api/v1/pipeline/sources': {
      get: { tags: ['pipeline'], summary: '수집 소스 정의(기준일 정책 포함)', responses: { '200': { description: '소스 목록' } } },
    },
    '/api/v1/pipeline/runs': {
      get: {
        tags: ['pipeline'],
        summary: '수집 실행 이력',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100, default: 20 } }],
        responses: { '200': { description: '실행 이력과 7일 요약' } },
      },
    },
    '/api/v1/pipeline/runs/{runId}': {
      get: {
        tags: ['pipeline'],
        summary: '실행 상세(배치 태스크 포함)',
        parameters: [{ name: 'runId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: '실행 상세' }, '404': { description: '실행 없음' } },
      },
    },
    '/api/v1/pipeline/dlq': {
      get: { tags: ['pipeline'], summary: '재시도 대기·해결된 실패 건', responses: { '200': { description: 'DLQ 목록' } } },
    },
    '/api/v1/events': {
      post: {
        tags: ['events'],
        summary: '행동 이벤트 배치 수집',
        description:
          '한 번에 최대 500건. 이벤트별 스키마 검증을 통과한 건만 적재하고, 거부 사유는 index와 함께 반환한다. ' +
          '중복(event_id)은 버린다.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['events'],
                properties: {
                  events: { type: 'array', maxItems: 500, items: { $ref: '#/components/schemas/BehaviorEvent' } },
                  appEnv: { type: 'string', enum: ['local', 'preview', 'production'] },
                },
              },
            },
          },
        },
        responses: {
          '202': { description: '전건 수집' },
          '207': { description: '일부 거부(검증 실패)' },
          '400': { $ref: '#/components/responses/ValidationError' },
        },
      },
      get: {
        tags: ['events'],
        summary: '수집된 이벤트 조회',
        parameters: [
          { name: 'name', in: 'query', schema: { type: 'string' } },
          { name: 'sessionId', in: 'query', schema: { type: 'string' } },
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500, default: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { '200': { description: '이벤트 목록' } },
      },
    },
    '/api/v1/events/stats': {
      get: {
        tags: ['events'],
        summary: '최근 구간 이벤트 집계와 퍼널',
        parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer', default: 24, maximum: 720 } }],
        responses: { '200': { description: '이벤트 수·세션 수·이벤트별 건수·퍼널' } },
      },
    },
    '/api/v1/events/funnel': {
      get: {
        tags: ['events'],
        summary: '일 단위 순서 보정 퍼널',
        parameters: [{ name: 'date', in: 'query', schema: { type: 'string', format: 'date' } }],
        responses: { '200': { description: '5단계 퍼널' } },
      },
    },
  },
  components: {
    responses: {
      ValidationError: {
        description: '요청 파라미터 검증 실패',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string', example: 'validation_error' },
                issues: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { path: { type: 'string' }, message: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    schemas: {
      RegionList: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lawdCd: { type: 'string', example: '26290' },
                legalDongCode: { type: 'string', example: '2629051000' },
                sido: { type: 'string' },
                sigungu: { type: 'string' },
                dong: { type: 'string' },
              },
            },
          },
          count: { type: 'integer' },
        },
      },
      Transaction: {
        type: 'object',
        required: ['dealHash', 'aptName', 'dealDate', 'areaM2', 'priceKrw'],
        properties: {
          dealHash: { type: 'string', description: '거래 멱등 해시(sha256)' },
          lawdCd: { type: 'string' },
          legalDongCode: { type: 'string' },
          dong: { type: 'string' },
          aptName: { type: 'string' },
          complexId: { type: 'string', nullable: true },
          dealMonth: { type: 'string', example: '2026-09' },
          dealDate: { type: 'string', format: 'date' },
          floor: { type: 'integer', nullable: true },
          areaM2: { type: 'number' },
          priceKrw: { type: 'integer' },
          pricePerPyeong: { type: 'integer' },
          dealType: { type: 'string' },
          canceled: { type: 'boolean' },
          sourceId: { type: 'string' },
          asOfDate: { type: 'string', format: 'date' },
          collectedAt: { type: 'string', format: 'date-time' },
          sourceNote: { type: 'string', nullable: true },
        },
      },
      BehaviorEvent: {
        type: 'object',
        required: ['name', 'occurredAt', 'sessionId', 'userPseudoId', 'page', 'props'],
        properties: {
          eventId: { type: 'string', format: 'uuid' },
          name: {
            type: 'string',
            enum: [
              'page_view',
              'region_filter_change',
              'complex_compare_add',
              'rate_scenario_adjust',
              'pipeline_source_inspect',
              'funnel_step_complete',
            ],
          },
          occurredAt: { type: 'string', format: 'date-time' },
          sessionId: { type: 'string' },
          userPseudoId: { type: 'string' },
          page: { type: 'string' },
          props: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
} as const;

export const openApiHtml = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>prop-data-hub API 명세</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", sans-serif; color: #0f172a; background: #f8fafc; }
  header { padding: 20px 24px; background: #0b2545; color: #fff; }
  header h1 { margin: 0 0 4px; font-size: 20px; }
  header p { margin: 0; color: #b9cbe4; font-size: 13px; }
  main { padding: 20px 24px 60px; max-width: 1040px; }
  section { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
  h2 { font-size: 15px; margin: 0 0 10px; color: #0b2545; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
  th { color: #475569; font-weight: 600; background: #f8fafc; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #eef2f7; padding: 1px 5px; border-radius: 4px; }
  .method { display: inline-block; min-width: 52px; font-weight: 700; font-size: 11px; letter-spacing: .04em; }
  .get { color: #166534; } .post { color: #9a3412; }
  .muted { color: #64748b; }
  .param { font-weight: 600; }
  a { color: #1d4ed8; }
</style>
</head>
<body>
<header>
  <h1>prop-data-hub API <span class="muted" style="color:#8fb3dd">v1.0.0</span></h1>
  <p>부동산 실거래·거시지표·수집 파이프라인·행동 이벤트 API · 본 문서는 <code style="background:#12305a;color:#cfe0f7">openapi.json</code>을 읽어 렌더링한다.</p>
</header>
<main>
  <section>
    <h2>엔드포인트</h2>
    <table id="endpoints"><tbody><tr><td class="muted">명세를 불러오는 중…</td></tr></tbody></table>
  </section>
  <section>
    <h2>스키마</h2>
    <table id="schemas"><tbody><tr><td class="muted">…</td></tr></tbody></table>
  </section>
  <p class="muted" style="font-size:12px">금액 단위: 원 · 면적: ㎡ · 평당가: 원/평 · 평 환산 3.305785㎡</p>
</main>
<script>
fetch('./openapi.json')
  .then((response) => response.json())
  .then((doc) => {
    const endpointRows = [];
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const params = (operation.parameters || []).map((param) => {
          return '<span class="param">' + param.name + '</span> <span class="muted">(' + param.in + (param.required ? ', 필수' : '') + ')</span>';
        }).join('<br>') || '<span class="muted">-</span>';
        endpointRows.push(
          '<tr><td><span class="method ' + method + '">' + method.toUpperCase() + '</span><code>' + path + '</code></td>' +
          '<td>' + (operation.summary || '') + (operation.description ? '<br><span class="muted" style="font-size:12px">' + operation.description + '</span>' : '') + '</td>' +
          '<td style="font-size:12px">' + params + '</td></tr>'
        );
      }
    }
    document.querySelector('#endpoints tbody').innerHTML =
      '<tr><th>경로</th><th>설명</th><th>파라미터</th></tr>' + endpointRows.join('');

    const schemaRows = Object.entries(doc.components.schemas).map(([name, schema]) => {
      const entries = schema.properties ? Object.entries(schema.properties) : [];
      const fields = entries.map(([key, value]) => {
        const type = value.type || (value.$ref ? value.$ref.split('/').pop() : 'object');
        return '<span class="param">' + key + '</span> <span class="muted">' + type + '</span>';
      }).join(' · ');
      return '<tr><td><code>' + name + '</code></td><td style="font-size:12px">' + fields + '</td></tr>';
    });
    document.querySelector('#schemas tbody').innerHTML = '<tr><th>스키마</th><th>필드</th></tr>' + schemaRows.join('');
  })
  .catch(() => {
    document.querySelector('#endpoints tbody').innerHTML = '<tr><td>명세를 불러오지 못했습니다. /api-docs/openapi.json을 확인하세요.</td></tr>';
  });
</script>
</body>
</html>`;
