import { EVENT_CATALOG, FUNNEL_STEPS, SOURCE_CATALOG } from '@prop/shared';
import { Card, DataNote } from '../components/ui';
import { dataset } from '../lib/dataset';
import { formatNumber } from '../lib/format';

const METRICS = [
  {
    name: '관측 거래(observed_transactions)',
    definition: '기준월까지 수집된 계약 중 해제되지 않은 거래 건수.',
    rule: 'canceled = true 제외 · 계약일 기준 · 지역·면적 조건 적용',
  },
  {
    name: '중위 매매가(median_price)',
    definition: '해당 월·지역의 거래 금액 중위값.',
    rule: '표본 1건 이상 · 해제 제외 · 평균 대신 중위값을 써서 이상 거래 영향을 줄임',
  },
  {
    name: '평당가(price_per_pyeong)',
    definition: '거래금액 ÷ (전용면적 ÷ 3.305785).',
    rule: '원/평 단위 · 반올림 · 면적 0 이하 제외',
  },
  {
    name: '전년 동월 대비(change_12m)',
    definition: '(최근월 중위가 − 12개월 전 중위가) ÷ 12개월 전 중위가 × 100.',
    rule: '12개월 전 표본이 없으면 0으로 두지 않고 비교 불가로 표시하는 것이 원칙(데모는 0 처리)',
  },
  {
    name: '월 상환액(monthly_payment)',
    definition: '원리금균등·원금균등·이자만 상환별 월 납입액.',
    rule: '원금·이자만 계산 · 인지세·보증료·우대금리 제외',
  },
  {
    name: '필요 연소득(required_income)',
    definition: '월 상환액 × 12 ÷ DSR 40%.',
    rule: '다른 대출·신용대출 미반영 · 비교용 지표',
  },
  {
    name: '기준 시세(reference_median)',
    definition: '같은 단지·같은 면적 구간(60·85·115㎡ = 18·26·35평 경계)의 최근 6개월 중위 매매가에서 해당 거래를 뺀 값.',
    rule: '해제 거래 제외 · 표본 3건 미만이면 그 매물은 레이더에서 제외',
  },
  {
    name: '할인율(discount_pct)',
    definition: '(거래가 − 기준 시세) ÷ 기준 시세 × 100. 음수면 기준 시세보다 싼 거래.',
    rule: '목표 할인율 -8%는 "할인율 ≤ -8%"를 뜻한다(기본값)',
  },
  {
    name: '매물 점수(deal_score)',
    definition: '할인율 45 + 전세가율 20 + 최근 3개월 거래량 15 + 단지 규모(350세대 이상) 20 = 100점.',
    rule: '70점 이상 적극 검토 · 55점 이상 검토 · 40점 이상 관찰 · -20% 이하 할인은 특수 조건 확인 신호를 붙임',
  },
  {
    name: '퍼널 전환율(funnel_conversion)',
    definition: '한 단계 앞 단계에 도달한 세션 중 다음 단계에 도달한 세션 비율.',
    rule: '세션 안에서 발생 시각 순서를 지킨 경우만 인정 · 새로고침 후에도 로컬 스트림 유지',
  },
  {
    name: '데이터 기준일(as_of_date)',
    definition: '계약 연월의 1일(월 단위) 또는 지표 말일.',
    rule: '수집 시각(collected_at)과 분리 저장 · 화면에 함께 표시',
  },
];

const QUALITY_RULES = [
  ['금액 0원 이하', 'invalid_price로 건너뛰고 원본을 skipped에 남긴다.', 'normalize/molit.ts'],
  ['계약일 누락', '해당 월 1일로 보정하고 source_note에 contract_day_missing_defaulted_to_1을 남긴다.', 'normalize/molit.ts'],
  ['계약 해제', '버리지 않고 canceled=true로 저장한 뒤 집계에서 제외한다.', 'aggregateMonthly / apt_transactions'],
  ['법정동 미매핑', 'unknown_legal_dong으로 건너뛰고 지역 마스터 보강 대상으로 남긴다.', 'collector/sources/molit.ts'],
  ['중복 수집', 'deal_hash(sha256) 충돌 시 ON CONFLICT DO UPDATE로 값만 갱신한다.', 'infra/postgres/init.sql'],
  ['행동 이벤트 스키마 불일치', '적재하지 않고 index·사유와 함께 207로 돌려준다.', 'routes/events.ts'],
  ['행동 이벤트 중복', '(event_id, occurred_date) 기준 중복은 버린다.', 'user_behavior_events PK'],
  ['레이더 기준 시세 표본 부족', '표본 3건 미만이면 할인율을 만들지 않고 목록에서 뺀다(thinReferenceDeals로 집계).', 'shared/radar.ts'],
  ['전세 표본 없음', '전세가율·갭을 null로 두고 점수에서 해당 항목을 0점 처리한다.', 'shared/radar.ts'],
];

const API_ROWS = [
  ['GET', '/health', '스토어 종류·가동 시간'],
  ['GET', '/api/v1/regions', '법정동 마스터'],
  ['GET', '/api/v1/complexes', '단지 마스터'],
  ['GET', '/api/v1/complexes/:id/monthly', '단지 월별 중위가'],
  ['GET', '/api/v1/transactions', '실거래 필터·정렬·페이지'],
  ['GET', '/api/v1/transactions/monthly', '지역 월별 집계'],
  ['GET', '/api/v1/rents', '전월세 실거래(전세·월세)'],
  ['GET', '/api/v1/market/jeonse-ratio', '월별 전세가율(면적 구간 매칭)'],
  ['GET', '/api/v1/radar/deals', '350세대+ 급매·저평가 레이더'],
  ['GET', '/api/v1/radar/alert-rules', '저장된 알림 규칙'],
  ['POST', '/api/v1/radar/alert-rules', '알림 규칙 저장 + 미리보기'],
  ['GET', '/api/v1/macro', '거시지표 시계열'],
  ['GET', '/api/v1/macro/latest', '지표별 최신값'],
  ['GET', '/api/v1/pipeline/sources', '출처·기준일 정책'],
  ['GET', '/api/v1/pipeline/runs', '실행 이력'],
  ['GET', '/api/v1/pipeline/runs/:id', '실행 상세(태스크)'],
  ['GET', '/api/v1/pipeline/dlq', '실패 큐'],
  ['POST', '/api/v1/events', '이벤트 배치 수집(최대 500건)'],
  ['GET', '/api/v1/events', '이벤트 조회'],
  ['GET', '/api/v1/events/stats', '이벤트 집계·퍼널'],
  ['GET', '/api-docs', 'OpenAPI 3.0 뷰어'],
];

export default function Dictionary() {
  return (
    <div className="space-y-4">
      <Card title="이벤트 정의서" subtitle="이름·발생 시점·속성·활용 지표·보존 기간을 이벤트 단위로 고정합니다.">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-xs">
            <thead>
              <tr className="table-head">
                <th className="px-2 py-2">이벤트</th>
                <th className="px-2 py-2">정의</th>
                <th className="px-2 py-2">발생 시점</th>
                <th className="px-2 py-2">속성</th>
                <th className="px-2 py-2">활용 지표</th>
                <th className="px-2 py-2 text-right">보존</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {EVENT_CATALOG.map((entry) => (
                <tr key={entry.name} className="align-top">
                  <td className="whitespace-nowrap px-2 py-2">
                    <span className="block font-semibold text-slate-800">{entry.name}</span>
                    <span className="text-[11px] text-slate-400">{entry.label}</span>
                  </td>
                  <td className="px-2 py-2 text-slate-600">{entry.description}</td>
                  <td className="px-2 py-2 text-[11px] text-slate-500">{entry.trigger}</td>
                  <td className="num px-2 py-2 text-[11px] text-slate-500">{entry.props.join(', ')}</td>
                  <td className="px-2 py-2 text-[11px] text-slate-500">{entry.kpi.join(' · ')}</td>
                  <td className="num px-2 py-2 text-right text-[11px] text-slate-400">{entry.retentionDays}일</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DataNote>
          보존 기간은 user_behavior_events의 월 단위 파티션을 DROP하는 방식으로 지킵니다. 원본 이벤트 400일 + 일 단위
          퍼널 집계(event_funnel_daily)는 별도로 보관합니다.
        </DataNote>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="퍼널 정의" subtitle="5단계 · 순서 보정 · event_funnel_daily와 같은 정의">
          <ol className="space-y-2">
            {FUNNEL_STEPS.map((step, index) => (
              <li key={step.key} className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2">
                <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-800 text-[10px] font-semibold text-white">
                  {index + 1}
                </span>
                <span>
                  <span className="block text-xs font-semibold text-slate-800">{step.label}</span>
                  <span className="num mt-0.5 block text-[11px] text-slate-500">
                    {step.sourceEvent}
                    {step.key === 'report_export' ? " (props.step = 'report_export')" : ''}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="지표 정의" subtitle="계산식과 예외 규칙을 함께 고정">
          <ul className="space-y-2.5">
            {METRICS.map((metric) => (
              <li key={metric.name}>
                <p className="num text-[11px] font-semibold text-slate-800">{metric.name}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{metric.definition}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">{metric.rule}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="전세가율·리스크 정의" subtitle="화면과 API가 같은 계산을 쓰도록 shared에 고정">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-slate-800">전세가율</p>
            <p className="num mt-1 rounded bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700">
              전세 보증금 평당가 ÷ 매매 평당가 × 100
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              같은 단지·월·면적 구간(5㎡)에서 매칭합니다. 59㎡(18평)와 84㎡(25평)가 섞인 단지에서 총액끼리 나누면 면적 구성 때문에
              값이 튀기 때문입니다. 구간: 70% 주의 · 80% 경고 · 90% 위험.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-800">리스크 점수 (0~100)</p>
            <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-slate-600">
              <li>· 전세가율: 70%↑ 6점 · 75%↑ 12점 · 80%↑ 22점 · 85%↑ 28점 · 90%↑ 35점</li>
              <li>· 최근 6개월 하락: -1%↓ 4점 · -3%↓ 10점 · -6%↓ 18점 · -10%↓ 25점</li>
              <li>· 12개월 하락: -2%↓ 3점 · -5%↓ 8점 · -10%↓ 12점</li>
              <li>· 이상 거래 1건 6점 · 2건 10점 · 3건↑ 15점 / 12개월 거래 6건↓ 10점</li>
            </ul>
            <p className="mt-1 text-[10px] text-slate-400">
              이상 거래는 단지·면적 구간 중위값과 MAD로 수정 z-score를 계산하고, 중위 대비 -14% 이상 급락은 따로 표시합니다.
              감정평가가 아닌 계약 전 확인 지표입니다.
            </p>
          </div>
        </div>
      </Card>

      <Card title="급매 레이더 정의" subtitle="기준 시세·할인율·점수·알림 조건을 한 곳에서 고정">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold text-slate-800">기준 시세와 할인율</p>
            <p className="num mt-1 text-[11px] text-slate-700">
              할인율 = (거래가 − 최근 6개월 같은 단지·면적 중위가) ÷ 중위가 × 100
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              같은 단지라도 59㎡(18평)와 84㎡(25평)는 시세 수준이 달라 60·85·115㎡(18·26·35평) 경계로 구간을 나눕니다. 표본이 3건 미만인 구간은
              기준 시세를 만들지 않고, 목표 할인율 -8%는 할인율 ≤ -8%를 뜻합니다.
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold text-slate-800">매물 점수 (0~100)</p>
            <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-slate-600">
              <li>· 할인율: -4% 7점 · -6% 14점 · -8% 24점 · -10% 32점 · -12% 38점 · -15%↑ 45점</li>
              <li>· 전세가율: 65%↓ 20점 · 70%↓ 16점 · 75%↓ 12점 · 80%↓ 6점</li>
              <li>· 3개월 거래: 2건 4점 · 3건 7점 · 5건 11점 · 8건↑ 15점</li>
              <li>· 단지 규모: 350세대 8점 · 500세대 12점 · 700세대 16점 · 1,000세대↑ 20점</li>
            </ul>
            <p className="mt-1 text-[10px] text-slate-400">
              70점 이상 적극 검토 · 55점 이상 검토 · 40점 이상 관찰. -20% 이하 할인과 직거래는 별도 확인 신호를 붙입니다.
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          알림은 조건을 저장한 뒤 카카오 알림톡(NAVER Cloud SENS 템플릿)과 웹훅 payload를 미리보기로 보여줍니다. 실제 발송은
          배포 환경의 승인된 템플릿·발신 프로필·웹훅 URL로 워커가 처리하며, 데모에서는 저장과 미리보기까지만 동작합니다.
        </p>
      </Card>

      <Card title="데이터 품질 규칙" subtitle="수집·정규화 단계에서 실제로 적용되는 규칙">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-xs">
            <thead>
              <tr className="table-head">
                <th className="px-2 py-2">상황</th>
                <th className="px-2 py-2">처리</th>
                <th className="px-2 py-2">구현 위치</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {QUALITY_RULES.map(([situation, action, where]) => (
                <tr key={situation}>
                  <td className="whitespace-nowrap px-2 py-2 font-medium text-slate-700">{situation}</td>
                  <td className="px-2 py-2 text-slate-600">{action}</td>
                  <td className="num px-2 py-2 text-[11px] text-slate-400">{where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="수집 소스" subtitle="기준일 정책과 갱신 주기를 함께 관리">
          <ul className="space-y-2">
            {SOURCE_CATALOG.map((source) => (
              <li key={source.sourceId} className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-xs font-semibold text-slate-800">{source.name}</p>
                <p className="text-[10px] text-slate-400">{source.provider}</p>
                <p className="mt-1 text-[11px] text-slate-600">{source.updateCycle}</p>
                <p className="text-[10px] text-slate-400">{source.asOfPolicy}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="API 표면" subtitle="로컬 API 서버(apps/api)가 제공하는 경로">
          <div className="scroll-thin max-h-72 overflow-auto">
            <table className="w-full border-collapse text-[11px]">
              <tbody className="divide-y divide-slate-100">
                {API_ROWS.map(([method, path, description]) => (
                  <tr key={path}>
                    <td className={`w-12 px-1 py-1.5 font-semibold ${method === 'POST' ? 'text-orange-700' : 'text-emerald-700'}`}>{method}</td>
                    <td className="num px-1 py-1.5 text-slate-700">{path}</td>
                    <td className="px-1 py-1.5 text-slate-500">{description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="데이터 범위" subtitle="이 데모에서 확인할 수 있는 것과 없는 것">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
            <p className="text-xs font-semibold text-emerald-800">검증된 것</p>
            <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-emerald-900/80">
              <li>· 공공데이터(매매·전월세) XML/JSON 정규화와 거래 해시 멱등 업서트</li>
              <li>· 조회 필터·정렬·월별 중위가 집계, 전세가율 뷰 (PostgreSQL 실행 검증)</li>
              <li>· 전세가율·이상 거래·리스크 점수 계산과 샘플 고정</li>
              <li>· 행동 이벤트 스키마 검증·배치 수집·퍼널 집계</li>
              <li>· 프로덕션 빌드 E2E(탐색·비교·리스크·이벤트·인스펙터·API 문서)</li>
            </ul>
          </div>
          <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">미연결</p>
            <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-slate-600">
              <li>· 실제 공공데이터포털·ECOS 인증키 발급 후 라이브 호출</li>
              <li>· 실제 AWS 배포(ECS·RDS·EventBridge) — IaC 템플릿만 준비</li>
              <li>· 실거래 금액은 대표 표본이며 실제 거래가 아님</li>
              <li>· 이 브라우저의 이벤트는 IndexedDB에만 저장(수집 API 미연결)</li>
            </ul>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          현재 데모 데이터: 단지 {dataset.complexes.length}개 · 매매 {formatNumber(dataset.transactions.length)}건 · 전월세{' '}
          {formatNumber(dataset.rentTransactions.length)}건 · 거시지표 {formatNumber(dataset.macro.length)}개 값
        </p>
      </Card>
    </div>
  );
}
