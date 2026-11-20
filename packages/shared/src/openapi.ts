/**
 * OpenAPI 3.0 명세.
 *
 * API 서버(apps/api)가 /api-docs/openapi.json으로 서빙하고, 웹 데모(apps/web)는
 * 같은 문서를 번들에서 읽어 인터랙티브 문서 화면을 만든다. 두 곳이 같은 객체를 쓰므로
 * 명세와 실제 라우트가 어긋나면 테스트(apps/api/test)에서 먼저 잡힌다.
 * 외부 CDN 없이 서빙하기 위해 HTML 변환은 서버 쪽에서만 한다.
 */
export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'prop-data-hub API',
    version: '1.1.0',
    description:
      '부동산 실거래가·전월세·거시지표 수집 결과와 사용자 행동 이벤트를 조회·수집하는 API. ' +
      '모든 금액은 원(KRW), 면적은 ㎡, 평당가는 원/평 기준이다. ' +
      '데모(GitHub Pages)에서는 서버 없이 같은 명세의 예시 응답을 실행해 본다.',
  },
  servers: [
    { url: 'http://localhost:8080', description: '로컬 개발' },
    { url: 'https://api.prop-data-hub.example', description: '배포 예정(CloudFormation 템플릿 기준)' },
  ],
  tags: [
    { name: 'reference', description: '지역·단지 기준정보' },
    { name: 'transactions', description: '실거래가 조회' },
    { name: 'market', description: '전월세·전세가율' },
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
        responses: { '200': { description: '단지 목록', content: { 'application/json': { schema: { $ref: '#/components/schemas/ComplexList' } } } } },
      },
    },
    '/api/v1/complexes/{complexId}/monthly': {
      get: {
        tags: ['reference'],
        summary: '단지 월별 중위가 추이',
        parameters: [
          { name: 'complexId', in: 'path', required: true, schema: { type: 'string' }, example: 'MOLIT-26290-001' },
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
    '/api/v1/rents': {
      get: {
        tags: ['market'],
        summary: '전월세 실거래 조회',
        description:
          '국토교통부 전월세 실거래가(getRTMSDataSvcAptRent)를 정규화한 결과. 전세는 monthlyRentKrw=0이고, ' +
          '월세는 보증금과 월세를 함께 내려준다. 전세가율 계산에는 전세 계약만 쓴다.',
        parameters: [
          { name: 'lawdCd', in: 'query', schema: { type: 'string', pattern: '^\\d{5}$' } },
          { name: 'legalDongCode', in: 'query', schema: { type: 'string', pattern: '^\\d{10}$' } },
          { name: 'complexId', in: 'query', schema: { type: 'string' } },
          { name: 'contractType', in: 'query', schema: { type: 'string', enum: ['jeonse', 'monthly'] } },
          { name: 'fromMonth', in: 'query', schema: { type: 'string', example: '2025-10' } },
          { name: 'toMonth', in: 'query', schema: { type: 'string', example: '2026-09' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
        ],
        responses: {
          '200': {
            description: '전월세 목록',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/RentTransaction' } },
                    total: { type: 'integer' },
                    limit: { type: 'integer' },
                    offset: { type: 'integer' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
        },
      },
    },
    '/api/v1/market/jeonse-ratio': {
      get: {
        tags: ['market'],
        summary: '월별 전세가율',
        description:
          '같은 단지·월·면적 구간(5㎡)의 전세 보증금 평당가를 매매 평당가로 나눈 비율. ' +
          '단지별 값을 월마다 중위값으로 묶어 내려준다. 표본이 부족한 달은 ratioPct=0이다.',
        parameters: [
          { name: 'lawdCd', in: 'query', schema: { type: 'string', pattern: '^\\d{5}$' } },
          { name: 'legalDongCode', in: 'query', schema: { type: 'string', pattern: '^\\d{10}$' } },
          { name: 'complexId', in: 'query', schema: { type: 'string' } },
          { name: 'months', in: 'query', schema: { type: 'integer', minimum: 3, maximum: 60, default: 24 } },
        ],
        responses: {
          '200': {
            description: '월별 전세가율',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    months: { type: 'integer' },
                    latest: { $ref: '#/components/schemas/JeonseRatioPoint' },
                    series: { type: 'array', items: { $ref: '#/components/schemas/JeonseRatioPoint' } },
                    definition: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { description: '단지 없음' },
        },
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
        parameters: [{ name: 'runId', in: 'path', required: true, schema: { type: 'string' }, example: 'run_20261118_0200_molit' }],
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
              example: {
                events: [
                  {
                    name: 'listing_click',
                    occurredAt: '2026-11-20T02:11:04.000Z',
                    sessionId: 'sess-8f2a1c9d3e',
                    userPseudoId: 'user-2b7c4d1a9f',
                    page: '/explore',
                    props: {
                      complexId: 'MOLIT-26290-001',
                      aptName: '문현베스티움',
                      priceKrw: 628000000,
                      areaM2: 84.98,
                      source: 'explore_table',
                    },
                  },
                ],
                appEnv: 'preview',
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
    '/api-docs/openapi.json': {
      get: {
        tags: ['reference'],
        summary: 'OpenAPI 명세(JSON)',
        responses: { '200': { description: '이 문서', content: { 'application/json': { schema: { type: 'object' } } } } },
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
      ComplexList: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                complexId: { type: 'string', example: 'MOLIT-26290-001' },
                name: { type: 'string', example: '문현베스티움' },
                legalDongCode: { type: 'string' },
                lawdCd: { type: 'string' },
                builtYear: { type: 'integer' },
                households: { type: 'integer' },
                representativeAreaM2: { type: 'number' },
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
      RentTransaction: {
        type: 'object',
        required: ['rentHash', 'aptName', 'dealDate', 'depositKrw', 'contractType'],
        properties: {
          rentHash: { type: 'string', description: '전월세 거래 멱등 해시(sha256)' },
          lawdCd: { type: 'string' },
          legalDongCode: { type: 'string' },
          dong: { type: 'string' },
          aptName: { type: 'string' },
          complexId: { type: 'string', nullable: true },
          dealMonth: { type: 'string', example: '2026-09' },
          dealDate: { type: 'string', format: 'date' },
          floor: { type: 'integer', nullable: true },
          areaM2: { type: 'number' },
          depositKrw: { type: 'integer', description: '보증금(원)' },
          monthlyRentKrw: { type: 'integer', description: '월세(원). 전세는 0' },
          contractType: { type: 'string', enum: ['jeonse', 'monthly'] },
          contractTermMonths: { type: 'integer', nullable: true },
          renewalRequested: { type: 'boolean' },
          sourceId: { type: 'string' },
          asOfDate: { type: 'string', format: 'date' },
          collectedAt: { type: 'string', format: 'date-time' },
        },
      },
      JeonseRatioPoint: {
        type: 'object',
        required: ['month', 'ratioPct'],
        properties: {
          month: { type: 'string', example: '2026-09' },
          ratioPct: { type: 'number', description: '전세가율(%). 표본 부족 시 0' },
          complexCount: { type: 'integer', description: '값에 기여한 단지 수' },
          jeonseSamples: { type: 'integer' },
          saleSamples: { type: 'integer' },
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
              'listing_click',
              'listing_save',
              'api_doc_mock_run',
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
