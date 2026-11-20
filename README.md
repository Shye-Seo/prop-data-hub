# prop-data-hub

부동산 실거래가·전월세와 거시지표를 수집·정규화해 화면 지표로 만들고, 사용자 행동 이벤트를 같은 스키마로 수집하는
TypeScript 풀스택 모노레포입니다. 공공데이터 수집 파이프라인, PostgreSQL 스키마, REST API, React 대시보드,
행동 이벤트 수집 체계를 한 저장소에서 실행합니다. 전월세 표본으로 전세가율·이상 거래 리스크를 계산하고,
면접관이 라이브 데모에서 직접 눌러 보는 이벤트 파이프라인 인스펙터와 API 문서(Mock 실행)를 포함합니다.

- 라이브 데모: <https://shye-seo.github.io/prop-data-hub/> (정적 빌드, 백엔드 없이 동작)
  — 저장소 Settings › Pages에서 소스를 `main` / `/docs`로 지정하면 활성화됩니다. 앱 권한상 Pages 설정 API는 403이라
  저장소 소유자가 한 번 지정해야 합니다.
- 대상 채용공고: 한국자산해독원(KADI) 풀스택 개발자 — TypeScript · React · Node.js · PostgreSQL · AWS,
  pnpm 모노레포, 공공데이터 파이프라인, 행동 지표/이벤트 정의, Playwright 자동화 경험

## 1. 무엇을 만들었나

| 채용 요구 | 구현 위치 | 확인 방법 |
| --- | --- | --- |
| pnpm 기반 모노레포 | `pnpm-workspace.yaml`, `apps/*`, `packages/shared`, `infra/` | `pnpm install` |
| 공공데이터 수집 파이프라인 | `apps/collector`, `packages/shared/src/normalize` | `pnpm --filter @prop/collector once` |
| 멱등 업서트·재시도·DLQ | `infra/postgres/init.sql`, `apps/collector/src/pipeline.ts` | `pnpm --filter @prop/collector test` |
| 출처·기준일 메타데이터 | `ingestion_sources`, `as_of_date`, `collected_at` 컬럼과 화면 | 데모 › 수집 파이프라인 |
| 지표·이벤트 정의 | `packages/shared/src/events.ts`(9종 이벤트, 5단계 퍼널) | 데모 › 지표 정의서 |
| 전월세 수집·전세가율 | `apps/collector/src/sources/molit-rent.ts`, `packages/shared/src/risk.ts`, `v_jeonse_ratio_monthly` | `pnpm --filter @prop/collector once -- --rent` · 데모 › 구별 리스크 |
| 이상치·리스크 스코어링 | `packages/shared/src/risk.ts`(수정 z-score·급락·배점) | `pnpm --filter @prop/shared test` |
| 실시간 파이프라인 인스펙터 | `apps/web/src/components/EventInspector.tsx`, `src/lib/inspector.ts` | 데모 하단 패널 |
| 인터랙티브 API 문서 | `packages/shared/src/openapi.ts`, `schema-summary.ts`, `api-mock.ts`, `apps/web/src/pages/ApiDocs.tsx` | 데모 › API 문서 |
| 행동 이벤트 수집 API | `apps/api/src/routes/events.ts`, `user_behavior_events` | `POST /api/v1/events` |
| 실시간 퍼널·이벤트 뷰어 | `apps/web/src/pages/Events.tsx`, `src/lib/tracker.ts` | 데모 › 행동 이벤트 |
| PostgreSQL DDL·인덱스·파티션 | `infra/postgres/init.sql` | `apps/api/test/pg-store.integration.test.ts` |
| REST API + OpenAPI 3.0 | `apps/api/src/server.ts`, `packages/shared/src/openapi.ts` | `http://localhost:8080/api-docs` · 데모 › API 문서 |
| Docker Compose | `docker-compose.yml`, `infra/docker/*` | `docker compose up --build` |
| AWS 아키텍처 | `infra/aws/` (CloudFormation + 운영 문서) | 배포 전 문서 |
| Playwright E2E | `e2e/app.spec.ts` (12 시나리오) | `pnpm test:e2e` |

## 2. 구조

```
prop-data-hub/
├─ apps/
│  ├─ web/          React 18 + Vite + Tailwind. 데모 모드에서는 번들 샘플 데이터로 동작
│  ├─ api/          Fastify + pg + zod. 인메모리/PostgreSQL 스토어를 같은 인터페이스로 사용
│  └─ collector/    수집 워커. 매매·전월세 MOLIT, ECOS 커넥터, rate-limit, 재시도, DLQ, 실행 이력
├─ packages/shared/ 타입·zod 스키마·XML/JSON 정규화·거래 해시·지표 계산 (web/api/collector 공용)
├─ infra/
│  ├─ postgres/init.sql   테이블·인덱스·파티션·집계 뷰·퍼널 함수
│  ├─ docker/             API·collector·web 이미지, nginx 설정
│  └─ aws/                CloudFormation 템플릿과 운영 문서
├─ e2e/              Playwright (프로덕션 빌드 대상)
├─ docs/             GitHub Pages용 정적 빌드 산출물
└─ scripts/          의존성 없는 정적 서버
```

데이터 흐름은 다음과 같습니다.

```
공공데이터 API ──▶ collector(정규화·검증) ──▶ PostgreSQL ──▶ API ──▶ React 대시보드
      │                    │                                  ▲
      │                    └─ pipeline_runs / run_tasks / DLQ │
      └─ ECOS(금리·물가)                                        │
사용자 행동 ──▶ tracker(배치·검증) ──▶ POST /api/v1/events ─────┘ (user_behavior_events → event_funnel_daily)
```

## 3. 실행

Node 20 이상, pnpm 9 기준입니다.

```bash
pnpm install

# 프론트엔드만 (백엔드 없이 샘플 데이터로 동작)
pnpm dev:web                      # http://localhost:5173

# API (DATABASE_URL이 없으면 인메모리 스토어)
pnpm dev:api                      # http://localhost:8080/api-docs

# 수집 워커 (키 없이 샘플 응답으로 전체 경로 실행)
pnpm --filter @prop/collector once                 # 매매 + ECOS
pnpm --filter @prop/collector once -- --rent       # 전월세까지 수집(전세가율 원천)
pnpm --filter @prop/collector once -- --json
pnpm --filter @prop/collector once -- --retry-dlq  # 실패 건 재시도(매매·전월세 구분)
```

PostgreSQL을 붙이려면:

```bash
docker compose up -d postgres     # 또는 로컬 PostgreSQL 16
export DATABASE_URL=postgres://prop:prop@localhost:5432/prop_data_hub
pnpm db:init
pnpm dev:api
```

API 서버는 `DATABASE_URL`이 있으면 PostgreSQL, 없으면 샘플 데이터를 적재한 인메모리 스토어로 뜹니다.
어느 쪽이든 응답 형태는 같습니다.

### 환경변수

`.env.example` 참고. 실제 수집을 돌릴 때만 아래 두 키가 필요합니다.

| 변수 | 설명 |
| --- | --- |
| `MOLIT_SERVICE_KEY` | 공공데이터포털 국토교통부 아파트 매매 실거래가 서비스키(Decoding) |
| `ECOS_API_KEY` | 한국은행 ECOS Open API 인증키 |
| `MOLIT_REQUESTS_PER_SECOND` | 초당 요청 한도(기본 5). 일일 한도와 함께 조정 |
| `DATABASE_URL` | 없으면 인메모리 모드 |

## 4. 수집 파이프라인

### 4.1 소스와 정규화

- **국토교통부 아파트 매매 실거래가** (`getRTMSDataSvcAptTradeDev`) — XML/JSON 모두 파싱.
  금액 만원→원, 전용면적 ㎡, 계약일 조립. 계약일이 비면 1일로 보정하고 `source_note`에 근거를 남깁니다.
- **국토교통부 아파트 전월세 실거래가** (`getRTMSDataSvcAptRent`) — 보증금·월세(만원→원), 계약구분(전세/월세),
  계약기간·갱신요구권 사용 여부까지 저장합니다. 전세가율 계산에는 `contract_type='jeonse'`만 씁니다.
- **한국은행 ECOS** — `StatisticSearch` 응답의 `RESULT.CODE`를 먼저 확인합니다(HTTP 200으로 오류가 오는 API).
  월간 지표는 말일을 기준일로 둡니다.
- 법정동명만 오는 실거래 응답은 지역 마스터(`regions`)의 (시군구코드, 법정동명)으로 10자리 법정동코드를 찾습니다.
  매핑이 없으면 `unknown_legal_dong`으로 건너뜁니다.

### 4.2 멱등 업서트

거래 식별자는 `deal_hash = sha256(시군구|법정동코드|정규화 단지명|지번|준공연도|계약일|층|면적|금액|거래유형)`입니다.
단지명 공백·괄호·"아파트" 접미사 차이는 같은 거래로 묶습니다.

```sql
INSERT INTO apt_transactions (...) VALUES (...)
ON CONFLICT (deal_hash) DO UPDATE
  SET price_krw = EXCLUDED.price_krw,
      price_per_pyeong = EXCLUDED.price_per_pyeong,
      canceled = EXCLUDED.canceled,
      as_of_date = EXCLUDED.as_of_date,
      collected_at = EXCLUDED.collected_at,
      source_note = EXCLUDED.source_note
RETURNING (xmax = 0) AS inserted;
```

`RETURNING (xmax = 0)`으로 신규/갱신 건수를 나눠 실행 이력에 남깁니다. 같은 기간을 두 번 수집해도 행이 늘지 않습니다.
전월세는 `rent_hash = sha256(시군구|법정동코드|단지명|지번|준공연도|계약일|층|면적|보증금|월세|계약유형|계약기간)`로
같은 계약을 묶고, 보증금·월세 신고 정정은 값만 갱신합니다.

### 4.3 호출 제어와 실패 처리

- **토큰 버킷**으로 소스별 초당 호출 수를 제한합니다(`MOLIT_REQUESTS_PER_SECOND`).
- **지수 백오프 + 지터**로 429/5xx/네트워크 오류만 재시도합니다(4xx는 즉시 실패). `Retry-After`를 우선 적용합니다.
- 배치 태스크(지역×월) 단위로 성공·실패를 기록하고, 최종 실패는 `dead_letter_queue`에 payload와 함께 적재합니다.
- 실행 상태는 `succeeded` / `partial` / `failed`. 부분 성공을 실패로 뭉개지 않아 어느 지역·월이 빠졌는지 남습니다.

### 4.4 전월세 수집과 전세가율 계산

전월세 수집은 매매와 같은 (지역×월) 태스크 단위로 실행하고, 실패는 `dead_letter_queue`에 `dlq_rent_*`로 남깁니다
(`--retry-dlq`가 source_id로 매매·전월세를 구분해 재시도).

전세가율은 **같은 단지·월·면적 구간(5㎡)의 전세 보증금 평당가 ÷ 매매 평당가 × 100**입니다.
59㎡와 84㎡가 섞인 단지에서 총액끼리 나누면 면적 구성에 따라 값이 튀기 때문에, 면적 구간을 맞춰 비교하고
그 달에 값이 있는 단지들의 중위값을 구 단위 지표로 씁니다. 같은 정의를 세 곳이 공유합니다.

1. 화면·데모: `packages/shared/src/risk.ts`
2. API: `GET /api/v1/market/jeonse-ratio`
3. PostgreSQL: `v_jeonse_ratio_monthly` 뷰

리스크 점수(0~100)는 전세가율(구간별 6~35점), 최근 6개월·12개월 가격 흐름(3~25점), 평당가 이상 거래(6~15점),
유동성(5~10점)을 합산합니다. 이상 거래는 단지·면적 구간 안에서 중위값과 MAD(중위절대편차)로 수정 z-score를 계산하고,
중위 대비 -14% 이상 급락은 별도 배지로 표시합니다. 감정평가가 아니라 계약 전 확인을 돕는 화면 지표이며,
화면과 리포트는 항상 근거 문장(`signals`)을 함께 보여줍니다.

### 4.5 기준일(as-of) 추적

모든 수집 행은 `as_of_date`(데이터 기준 시점)와 `collected_at`(수집 시각)을 함께 저장합니다.
실거래는 계약 연월의 1일, 월간 지표는 말일이 기준일입니다. 화면은 기준일을 표시하고, 수집 시점과 섞어 쓰지 않습니다.

## 5. 행동 이벤트 설계

`packages/shared/src/events.ts`에 9종 이벤트와 5단계 퍼널을 정의하고, 프론트 트래커와 수집 API가 같은 zod 스키마로 검증합니다.

| 이벤트 | 발생 시점 | 주요 속성 | 활용 |
| --- | --- | --- | --- |
| `page_view` | 화면 진입 | route, isInitialLoad, deviceType | 세션·도달 |
| `region_filter_change` | 지역/단지/면적/기간 조건 확정(800ms 디바운스) | lawdCd, dong, complexId, areaBand, periodMonths, resultCount | 탐색 수요, 결과 0건 비율 |
| `complex_compare_add` | 비교함에 단지 추가 | complexIds, addedComplexId, compareCount | 비교 진입률 |
| `listing_click` | 실거래·리스크 화면에서 단지(거래) 상세 열기 | complexId, aptName, dealHash, priceKrw, areaM2, source, jeonseRatioPct | 단지별 관심, 상세 진입률 |
| `listing_save` | 관심 등록/해제 | complexId, aptName, action, savedCount | 관심 등록 전환 |
| `rate_scenario_adjust` | 대출 조건 변경(400ms 디바운스) | priceKrw, loanKrw, annualRatePct, termMonths, repayment | 핵심 기능 사용 |
| `pipeline_source_inspect` | 출처 카드·실행 상세·DLQ 열람 | sourceId, runId, panel, asOfDate | 데이터 신뢰 기능 사용 |
| `api_doc_mock_run` | API 문서에서 예시 응답 실행 | endpoint, method, status | 문서 사용, 엔드포인트별 실행 |
| `funnel_step_complete` | 리포트 저장 등 완료 행동 | step, route, detail | 최종 전환 |

퍼널은 **세션 안에서 단계 순서를 지킨 도달**만 인정합니다(순서 보정 퍼널). 중간 단계를 건너뛴 세션은 뒤 단계에
도달하지 않은 것으로 집계합니다. 같은 정의를 세 곳에서 씁니다.

1. 프론트 트래커(`computeFunnel`)
2. API `/api/v1/events/funnel`
3. PostgreSQL `refresh_event_funnel_day()` → `event_funnel_daily`

수집은 10건 또는 3초마다 배치 전송하고, 페이지를 떠날 때 `sendBeacon`으로 남은 큐를 보냅니다. 검증에 실패한 이벤트는
적재하지 않고 `index`·사유와 함께 207로 돌려줍니다. 중복은 `(event_id, occurred_date)` PK로 버립니다.

데모 모드(VITE_API_BASE 없음)에서는 인메모리 스트림 + IndexedDB에 적재해 새로고침 후에도 이벤트 뷰어가 유지됩니다.

화면 하단의 **이벤트 파이프라인 인스펙터**는 매물 클릭·필터 변경·관심 등록 때마다 같은 이벤트가
수집 → 스키마 검증 → 배치 버퍼 → 적재(IndexedDB/API) → 퍼널 집계로 흐르는 것을 단계별 건수, JSON payload,
세션 퍼널 전환율로 즉시 보여줍니다. 데모에서 직접 눌러 확인할 수 있고, 같은 계산을 `apps/web/src/lib/inspector.ts`에서
테스트로 고정했습니다.

## 6. 데이터베이스

`infra/postgres/init.sql`이 단일 스키마 원본입니다. 재적용해도 데이터가 유지됩니다.

- **테이블**: `ingestion_sources`, `regions`, `apartment_complexes`, `apt_transactions`, `apt_rent_transactions`,
  `macro_indicators`, `pipeline_runs`, `pipeline_run_tasks`, `dead_letter_queue`, `user_behavior_events`(월 파티션),
  `event_funnel_daily`
- **뷰**: `v_jeonse_ratio_monthly`(단지·월·면적 구간 전세가율), `v_ingestion_quality`(수집 품질 점검)
- **인덱스**: `apt_transactions` BRIN(계약일 기간 스캔), BTREE(지역·월·금액), GIN(단지명 tsvector),
  `apt_rent_transactions` BRIN(계약일) + BTREE(지역·월, 단지·월) + 전세 부분 인덱스,
  `user_behavior_events` BRIN + GIN(jsonb_path_ops)
- **파티션**: `user_behavior_events`는 `occurred_date` 월 단위 RANGE. `ensure_behavior_partition(date)`로 생성하고,
  보존 기간이 지난 파티션은 DROP으로 정리합니다.
- **집계**: `mv_transaction_monthly`, `mv_complex_monthly`(중위값, 해제 제외), `v_ingestion_quality`(보정·해제·기준일 불일치)
- **퍼널 함수**: `refresh_event_funnel_day(date)` — 세션별 단계 도달 시각을 비교해 순서 보정 집계를 upsert

`apt_transactions`는 `deal_hash` 전역 유일성을 유지하려고 파티션하지 않았습니다. 파티션 테이블의 유니크 제약은
파티션 키를 포함해야 해서 `ON CONFLICT (deal_hash)`를 그대로 쓸 수 없습니다. 거래량이 커지면 `deal_month` 파티션 +
`(deal_hash, deal_month)` 유니크로 바꾸는 편이 맞고, 그때는 업서트 충돌 대상도 함께 바꿔야 합니다.

## 7. API

`/api-docs`에서 OpenAPI 3.0 문서를 CDN 없이 볼 수 있습니다.

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/health` | 상태·스토어 종류 |
| GET | `/api/v1/regions` | 법정동 마스터 |
| GET | `/api/v1/complexes` | 단지 마스터 |
| GET | `/api/v1/complexes/:id/monthly` | 단지 월별 중위가 |
| GET | `/api/v1/transactions` | 지역·단지·기간·면적·금액 필터, 정렬, 페이지 |
| GET | `/api/v1/transactions/monthly` | 지역 월별 중위가·평당가·거래량 |
| GET | `/api/v1/rents` | 전월세 실거래(전세·월세, 기간·단지 필터) |
| GET | `/api/v1/market/jeonse-ratio` | 월별 전세가율(단지·월·면적 구간 매칭) |
| GET | `/api/v1/macro` | 거시지표 시계열 |
| GET | `/api/v1/macro/latest` | 지표별 최신값 |
| GET | `/api/v1/pipeline/sources` | 출처·라이선스·기준일 정책 |
| GET | `/api/v1/pipeline/runs` | 실행 이력 + 7일 요약 |
| GET | `/api/v1/pipeline/runs/:id` | 실행 상세(배치 태스크) |
| GET | `/api/v1/pipeline/dlq` | 실패 큐 |
| POST | `/api/v1/events` | 행동 이벤트 배치 수집(최대 500건) |
| GET | `/api/v1/events` | 이벤트 조회 |
| GET | `/api/v1/events/stats` | 이벤트 집계 + 퍼널 |
| GET | `/api/v1/events/funnel` | 일 단위 순서 보정 퍼널 |

## 8. 프론트엔드 데모

`apps/web`은 GitHub Pages에 올릴 수 있는 정적 빌드입니다. 백엔드 없이 다음이 동작합니다.

- 시장 개요: 지역별 중위가 추이, 거래량, 금리·물가 지표, 최근 수집 상태
- 실거래 탐색: 지역·단지·면적·기간 필터, 평당가, 이상 거래·리스크 배지, 매물 클릭 상세, 관심 등록, CSV 저장
- 단지 비교: 최대 3개 단지 평당가·전세가율 추이와 요약(전세가율·리스크 점수 행 포함)
- 구별 리스크: 남구·수영구·해운대구의 중위 전세가율·평당가·거래량 비교 차트, 단지별 리스크 점수와 근거 신호,
  이상 거래 표본. 차트는 외부 CDN 없는 순수 SVG입니다.
- API 문서: OpenAPI 3.0 오퍼레이션 목록, 파라미터·요청 예시, 예시 응답 실행(Mock), PostgreSQL 스키마·관계(ERD 요약)
- 이벤트 파이프라인 인스펙터: 모든 화면 하단에서 이벤트 적재·검증·버퍼·집계 상태와 JSON payload, 세션 퍼널 확인
- 금리 민감도: 매매가·자기자본·금리·기간·상환방식별 월 상환액, 총 이자, DSR 필요 소득
- 수집 파이프라인: 소스 메타데이터, 실행 이력, 배치 태스크, DLQ 재시도(시뮬레이션)
- 행동 이벤트: 실시간 퍼널·이벤트 스트림·스키마 예시
- 지표 정의서: 이벤트·퍼널·지표·품질 규칙·API 표면

빌드:

```bash
pnpm build          # apps/web → docs/
pnpm preview        # http://127.0.0.1:4173
```

GitHub Pages는 `main` 브랜치의 `/docs` 폴더를 소스로 지정하면 됩니다(Settings → Pages → Build and deployment →
Deploy from a branch → `main` / `/docs`).

## 9. 테스트와 검증 결과 (2026-11-20)

| 구분 | 명령 | 결과 |
| --- | --- | --- |
| 공용 라이브러리 (이벤트·리스크·전월세 정규화·OpenAPI·스키마 요약) | `pnpm --filter @prop/shared test` | 79 passed |
| API (라우트 + PGlite 통합) | `pnpm --filter @prop/api test` | 32 passed |
| 수집 워커 (HTTP·rate-limit·매매/전월세 파이프라인·PGlite) | `pnpm --filter @prop/collector test` | 32 passed |
| 웹 데이터·리스크·인스펙터 | `pnpm --filter @prop/web test` | 20 passed |
| 합계(단위·통합) | `pnpm test` | 163 passed |
| 타입 검사 | `pnpm typecheck` | 4개 패키지 통과 |
| E2E (프로덕션 빌드) | `pnpm test:e2e` | 12 passed |
| 정적 빌드 | `pnpm build` | 성공 (JS 385KB / gzip 119KB, CSS 29KB / gzip 6KB) |
| 수집 워커 1회 실행 | `pnpm --filter @prop/collector once -- --rent` | 매매 18태스크 중 17성공(300건), 전월세 17/18(236건, 전세 191·월세 45), ECOS 6건, DLQ 2건 |

E2E 시나리오: 개요 렌더링 / 지역 필터 / 실거래 필터·CSV / 단지 비교(3개 제한) / 금리 시뮬레이터 /
파이프라인 출처·실행·DLQ 재시도 / 이벤트 퍼널·스트림·스키마 / 새로고침 후 이벤트 유지 / 모바일 레이아웃 /
매물 클릭·관심 등록 → 인스펙터 반영 / 구별 리스크 차트·상세 신호 / API 문서 Mock 실행·스키마 탭.

DDL과 업서트 SQL은 PostgreSQL 16 호환 WASM 엔진(PGlite)에서 실제 실행해 검증했습니다. BRIN/GIN 인덱스 생성,
월 파티션, 멱등 업서트, `refresh_event_funnel_day`, 머티리얼라이즈드 뷰까지 이 테스트에서 확인합니다.

## 10. 검증 범위와 미연결 범위

**검증한 것**

- 공공데이터 XML/JSON 파싱과 정규화, 거래 해시 멱등성 (단위 테스트 + 실제 DB 실행)
- 초당 호출 제한, 재시도·백오프, 4xx 즉시 실패, Retry-After
- 지역×월 배치 실행의 성공/부분 성공/실패 상태 전이와 DLQ 적재·재처리
- PostgreSQL DDL·인덱스·파티션·집계 뷰·퍼널 함수 (PGlite, PostgreSQL 16)
- API 18개 경로의 응답과 검증 오류(400/404/207), OpenAPI 문서와 Mock 응답(모든 오퍼레이션)
- 이벤트 스키마 검증, 중복 제거, 배치 수집, 퍼널 집계
- 전세가율 면적 구간 매칭, 이상 거래 탐지, 리스크 배점 (shared 테스트 + 샘플 데이터셋 고정)
- 프로덕션 빌드에 대한 Playwright 12개 시나리오, 모바일 390px 레이아웃

**미연결·확인 필요**

- 실제 공공데이터포털·ECOS 인증키를 넣은 라이브 호출은 하지 않았습니다. 응답 픽스처와 시뮬레이터로 경로만 검증했습니다.
- ECOS 통계표 코드(`722Y001` 기준금리 등)와 항목 코드는 키 발급 후 통계표 조회 화면에서 확정해야 합니다.
  `apps/collector/src/sources/ecos.ts`의 값은 연결용 기본값입니다.
- AWS 배포는 하지 않았습니다. `infra/aws/cloudformation/prop-data-hub.yml`은 YAML 문법 검증만 했고,
  계정·VPC·도메인이 정해지면 `infra/aws/README.md` 순서로 적용합니다.
- Docker 이미지는 로컬 환경에 Docker가 없어 빌드하지 못했습니다. Compose 구성과 Dockerfile은 작성만 되어 있습니다.
- 데모 데이터의 거래 금액·층·계약일과 전월세 보증금·월세는 화면 검증용 대표 표본입니다. 단지명·준공연도·세대수는
  공개 정보(공동주택 기본정보·단지 안내)를 참고했습니다.
- 이 브라우저의 행동 이벤트는 IndexedDB에만 저장됩니다. 수집 API에 연결하려면 `VITE_API_BASE`를 설정합니다.
- 전월세도 픽스처 응답으로 경로만 검증했습니다. 실제 전월세 API 호출은 매매와 같은 `MOLIT_SERVICE_KEY`로 가능하지만
  이 저장소에서는 라이브 호출을 하지 않았습니다.
- 데모의 API 문서 'Mock 응답'은 서버 호출이 아니라 같은 표본 데이터로 만든 예시 응답입니다(응답에 `mock: true` 표기).
- GitHub Actions 워크플로는 저장소 연결의 앱 권한(Workflows) 제한으로 푸시하지 못합니다.

### CI 활성화 (웹에서 1회)

1. <https://github.com/Shye-Seo/prop-data-hub/new/main/.github/workflows> 를 연다.
2. 파일 이름에 `ci.yml`을 입력한다.
3. 저장소 루트의 `ci.github-workflow.yml` 내용을 그대로 붙여넣고 커밋한다.
4. Actions 탭에서 첫 실행(설치 → 타입 검사 → 테스트 163건 → 빌드 → Playwright 12건)이 도는 것을 확인한다.

워크플로는 `pnpm test:e2e`가 `docs/`를 서빙해 검증하므로, 빌드 산출물이 저장소에 커밋돼 있어야 합니다.

## 11. 이 프로젝트에서 신경 쓴 것

- **재수집이 안전해야 한다.** 공공데이터는 같은 달을 여러 번 다시 받습니다. 해시 기반 멱등 업서트와
  신규/갱신 카운트 분리가 없으면 중복·집계 왜곡이 생깁니다.
- **부분 실패를 숨기지 않는다.** 6개 배치 중 1개가 실패하면 `partial`로 남기고, 어느 지역·월이 빠졌는지,
  몇 번 재시도했는지, DLQ에 무엇이 쌓였는지 화면에서 바로 보이게 했습니다.
- **기준일을 섞지 않는다.** 계약 시점, 지표 기준일, 수집 시각을 각각 저장합니다. 부동산 데이터는 신고 지연이 있어
  "언제 기준 데이터인가"가 숫자만큼 중요합니다.
- **이벤트 정의를 코드 한 곳에 둔다.** 이름과 속성을 프론트·API·DB 집계가 공유해야 나중에 이벤트가 늘어도
  정의 없는 수집이 생기지 않습니다.
- **데모가 실제로 동작해야 한다.** 외부 CDN 없이 정적 파일만으로 차트·필터·이벤트 수집·퍼널·API 문서가 돌아가고,
  같은 산출물을 Playwright가 검증합니다.
- **지표의 뜻을 화면에서 설명한다.** 전세가율·이상치·리스크 점수는 계산식과 한계(표본 부족, 감정평가 아님)를
  화면 문구와 README에 같이 적었습니다.

## 12. 작성자

4년 차 풀사이클 개발자로 커머스 SaaS에서 기획, MySQL 스키마 설계, PHP/TypeScript 백엔드, React 프론트엔드,
외부 API 연동(인스타그램·네이버클라우드 알림톡), 운영·유지보수를 1인으로 맡았습니다. 이 저장소는 그 경험을
TypeScript·PostgreSQL·AWS 기준의 모노레포 구조로 다시 정리한 작업입니다. 화면에 보이는 지표 뒤에 어떤 수집·검증·집계가
있는지를 코드와 테스트로 설명할 수 있게 만드는 데 초점을 두었습니다.

## 데이터 출처와 라이선스

- 국토교통부 아파트 매매 실거래가 (공공데이터포털, 이용허락범위 제한 없음)
- 국토교통부 아파트 전월세 실거래가 (공공데이터포털, 이용허락범위 제한 없음)
- 한국은행 ECOS Open API (한국은행 공공데이터 이용약관)
- 단지 기본 정보: 국토교통부 공동주택 기본 정보제공 서비스 공개 정보 참고

코드는 포트폴리오 목적의 저장소입니다. 샘플 데이터는 실제 거래 내역이 아닙니다.
