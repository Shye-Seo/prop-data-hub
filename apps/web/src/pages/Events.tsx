import { useEffect, useMemo, useState } from 'react';
import { EVENT_CATALOG, EVENT_NAMES } from '@prop/shared';
import { Card, DataNote, EmptyState, StatusBadge } from '../components/ui';
import { tracker, type TrackedEvent } from '../lib/tracker';
import { formatNumber, formatRelativeTime } from '../lib/format';

const NAME_LABEL: Record<string, string> = Object.fromEntries(EVENT_CATALOG.map((entry) => [entry.name, entry.label]));

export default function Events() {
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<string>('all');
  const [schemaEvent, setSchemaEvent] = useState<string>('page_view');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => tracker.subscribe(() => setTick((value) => value + 1)), []);

  const events = useMemo(() => tracker.getEvents(), [tick]);
  const funnel = useMemo(() => tracker.getFunnel(), [tick]);
  const counts = useMemo(() => tracker.countsByName(), [tick]);
  const filtered = filter === 'all' ? events : events.filter((event) => event.name === filter);
  const recent = [...filtered].slice(-40).reverse();
  const firstStep = funnel[0]?.sessions ?? 0;

  const definition = EVENT_CATALOG.find((entry) => entry.name === schemaEvent)!;
  const sample = [...events].reverse().find((event) => event.name === schemaEvent);

  const fireSample = (name: (typeof EVENT_NAMES)[number]) => {
    const samples: Record<string, Record<string, unknown>> = {
      region_filter_change: { lawdCd: '26290', dong: '문현동', areaBand: '60to85', periodMonths: 12, resultCount: 87 },
      complex_compare_add: { complexIds: ['MOLIT-26290-001', 'MOLIT-26290-003'], addedComplexId: 'MOLIT-26290-003', compareCount: 2, basis: 'price_per_pyeong' },
      rate_scenario_adjust: { priceKrw: 628000000, loanKrw: 428000000, annualRatePct: 4.1, termMonths: 480, repayment: 'equal_principal_interest', monthlyPaymentKrw: 1820000 },
      pipeline_source_inspect: { sourceId: 'molit_apt_trade', panel: 'sources', asOfDate: '2026-09-01' },
      funnel_step_complete: { step: 'report_export', route: '/events', detail: { rows: 30, format: 'csv' } },
      page_view: { route: '/events' },
    };
    const created = tracker.track(name, samples[name] ?? {});
    setToast(created ? `${NAME_LABEL[name]} 이벤트를 기록했습니다.` : '스키마 검증에서 제외되었습니다.');
    window.setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card card-pad">
          <p className="label">수집 이벤트</p>
          <p className="num mt-1 text-xl font-semibold text-ink-800" data-testid="total-events">{formatNumber(events.length)}</p>
        </div>
        <div className="card card-pad">
          <p className="label">세션</p>
          <p className="num mt-1 text-xl font-semibold text-ink-800">{funnel[0]?.sessions ?? 0}</p>
          <p className="mt-0.5 truncate text-[10px] text-slate-400">{tracker.sessionId}</p>
        </div>
        <div className="card card-pad">
          <p className="label">최종 전환</p>
          <p className="num mt-1 text-xl font-semibold text-teal-700">
            {funnel[funnel.length - 1]?.sessions ?? 0}
            <span className="ml-1 text-xs font-normal text-slate-400">/ {firstStep}</span>
          </p>
        </div>
        <div className="card card-pad">
          <p className="label">적재 방식</p>
          <p className="mt-1 text-sm font-semibold text-ink-800">{tracker.mode === 'api' ? 'API 배치 전송' : '로컬 + IndexedDB'}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">검증 제외 {tracker.rejected}건</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <Card
          title="퍼널 전환"
          subtitle="세션 안에서 단계 순서를 지킨 도달만 집계 · 새로고침 후에도 유지"
          action={<span className="text-[11px] text-slate-400">기준: 이 브라우저</span>}
        >
          <ol className="space-y-3" data-testid="funnel">
            {funnel.map((step) => {
              const width = firstStep === 0 ? 0 : Math.round((step.sessions / firstStep) * 100);
              return (
                <li key={step.stepKey}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-medium text-slate-700">
                      {step.stepIndex}. {step.stepLabel}
                    </span>
                    <span className="num text-[11px] text-slate-500">
                      {step.sessions}세션 · {step.events}회
                      <span className="ml-1 text-slate-400">({(step.conversionFromStart * 100).toFixed(0)}%)</span>
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-teal-600 to-teal-500"
                      style={{ width: `${Math.max(width, step.sessions > 0 ? 3 : 0)}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-right text-[10px] text-slate-400">
                    직전 단계 대비 {(step.conversionFromPrevious * 100).toFixed(0)}%
                  </p>
                </li>
              );
            })}
          </ol>
          <p className="mb-1 text-[11px] leading-relaxed text-slate-500">
            지역 필터 → 단지 비교 → 금리 조정 → 리포트 저장 순으로 화면을 이동하면 각 단계가 채워집니다.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(['region_filter_change', 'complex_compare_add', 'rate_scenario_adjust', 'funnel_step_complete'] as const).map((name) => (
              <button key={name} type="button" className="btn-ghost text-[11px]" onClick={() => fireSample(name)}>
                + {NAME_LABEL[name]}
              </button>
            ))}
          </div>
        </Card>

        <Card title="이벤트별 건수" subtitle="브라우저에 적재된 이벤트 스트림 기준">
          <ul className="space-y-2">
            {EVENT_CATALOG.map((entry) => {
              const count = counts.find((row) => row.name === entry.name)?.count ?? 0;
              return (
                <li key={entry.name}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-700">{entry.label}</span>
                    <span className="num font-semibold text-ink-800">{formatNumber(count)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-ink-700"
                      style={{ width: `${events.length === 0 ? 0 : (count / Math.max(1, events.length)) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="mt-3 text-[11px] font-semibold text-slate-500 underline decoration-dotted"
            onClick={() => {
              tracker.reset();
              setToast('로컬 이벤트 스트림을 비웠습니다.');
              window.setTimeout(() => setToast(null), 2500);
            }}
          >
            로컬 스트림 비우기
          </button>
        </Card>
      </div>

      <Card
        title="이벤트 스트림"
        subtitle={`${formatNumber(filtered.length)}건 저장됨 · 최근 40건 표시`}
        action={
          <select className="select w-44 text-xs" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="이벤트 필터">
            <option value="all">전체 이벤트</option>
            {EVENT_CATALOG.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.label}
              </option>
            ))}
          </select>
        }
      >
        {recent.length === 0 ? (
          <EmptyState title="아직 수집된 이벤트가 없습니다" description="화면을 이동하거나 위 버튼으로 샘플 이벤트를 기록해 보세요." />
        ) : (
          <div className="scroll-thin max-h-80 overflow-auto" data-testid="event-stream">
            <table className="w-full min-w-[680px] border-collapse text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="table-head">
                  <th className="px-2 py-1.5">시각</th>
                  <th className="px-2 py-1.5">이벤트</th>
                  <th className="px-2 py-1.5">페이지</th>
                  <th className="px-2 py-1.5">속성</th>
                  <th className="px-2 py-1.5">적재</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((event: TrackedEvent) => (
                  <tr key={event.eventId} className="hover:bg-slate-50">
                    <td className="num whitespace-nowrap px-2 py-1.5 text-[10px] text-slate-500">{event.occurredAt.slice(11, 19)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium text-slate-700">{NAME_LABEL[event.name] ?? event.name}</td>
                    <td className="num whitespace-nowrap px-2 py-1.5 text-[10px] text-slate-500">{event.page}</td>
                    <td className="num max-w-[260px] truncate px-2 py-1.5 text-[10px] text-slate-500" title={JSON.stringify(event.props)}>
                      {JSON.stringify(event.props)}
                    </td>
                    <td className="px-2 py-1.5">
                      <StatusBadge status={event.delivery} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[10px] text-slate-400">
          마지막 전송 {tracker.lastFlushAt ? formatRelativeTime(tracker.lastFlushAt) : '없음'} · 배치 크기 10건 / 3초 ·
          페이지를 떠날 때 sendBeacon
        </p>
      </Card>

      <Card
        title="이벤트 스키마"
        subtitle="수집 전 @prop/shared 스키마로 검증합니다. 필드가 맞지 않으면 적재하지 않고 제외 사유만 남깁니다."
        action={
          <select className="select w-48 text-xs" value={schemaEvent} onChange={(event) => setSchemaEvent(event.target.value)} aria-label="스키마 이벤트 선택">
            {EVENT_CATALOG.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-slate-800">
              {definition.name} <span className="font-normal text-slate-500">· {definition.label}</span>
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{definition.description}</p>
            <dl className="mt-2 space-y-1 text-[11px]">
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-slate-400">발생 시점</dt>
                <dd className="text-slate-600">{definition.trigger}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-slate-400">속성</dt>
                <dd className="num text-slate-600">{definition.props.join(', ')}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-slate-400">활용</dt>
                <dd className="text-slate-600">{definition.kpi.join(' · ')}</dd>
              </div>
            </dl>
          </div>
          <div>
            <p className="label mb-1">최근 수집 예시</p>
            <pre className="scroll-thin max-h-40 overflow-auto rounded-lg bg-ink-900 p-3 text-[10px] leading-relaxed text-slate-200">
              {sample ? JSON.stringify(sample, null, 2) : '아직 이 이벤트가 수집되지 않았습니다.'}
            </pre>
          </div>
        </div>
        <DataNote>
          이벤트 이름과 속성은 EVENT_NAMES 상수와 zod 스키마에서 단일 관리합니다. 프론트 트래커와 수집 API가 같은 정의를
          참조하므로, 정의를 바꾸면 양쪽 검증이 함께 바뀝니다.
        </DataNote>
      </Card>

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-ink-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
