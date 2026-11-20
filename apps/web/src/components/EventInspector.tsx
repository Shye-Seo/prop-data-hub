import { useEffect, useMemo, useReducer } from 'react';
import { tracker } from '../lib/tracker';
import { buildInspectorSnapshot, eventPayloadJson, funnelWidths } from '../lib/inspector';
import { formatRelativeTime } from '../lib/format';

/**
 * 행동 이벤트 파이프라인 인스펙터.
 *
 * 화면 어디서든 매물 클릭·필터 변경·관심 등록을 하면 이 패널의 JSON과 퍼널 숫자가 즉시 바뀐다.
 * 데이터는 브라우저 트래커(IndexedDB)에서 오고, 서버 모드(VITE_API_BASE)면 배치 전송까지 보여준다.
 * 패널은 화면 하단에 고정되며, 데스크톱은 펼친 상태로 시작하고 모바일은 접어 둔다.
 */
export default function EventInspector({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [tick, refresh] = useReducer((value: number) => value + 1, 0);

  useEffect(() => tracker.subscribe(refresh), []);

  const snapshot = useMemo(
    () =>
      buildInspectorSnapshot({
        events: tracker.getEvents(),
        funnel: tracker.getFunnel(),
        queueSize: tracker.getQueueSize(),
        rejected: tracker.rejected,
        delivered: tracker.delivered,
        lastFlushAt: tracker.lastFlushAt,
        mode: tracker.mode,
        sessionId: tracker.sessionId,
        batchSize: tracker.batchSize,
      }),
    // tracker는 밖에서 바뀌므로 tick 카운터로 다시 계산한다.
    [tick],
  );

  const widths = funnelWidths(snapshot.funnel);

  return (
    <section
      aria-label="이벤트 파이프라인 인스펙터"
      data-testid="inspector"
      className="fixed bottom-0 left-0 right-0 z-30 border-t lg:left-60 lg:right-0 border-ink-700/60 bg-ink-900 text-slate-200 shadow-[0_-10px_34px_-10px_rgba(2,12,27,0.55)]"
    >
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-6">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
          <span className={`h-1.5 w-1.5 rounded-full ${snapshot.totals.events > 0 ? 'animate-pulse bg-emerald-400' : 'bg-slate-500'}`} />
          이벤트 파이프라인
        </span>
        <span className="num text-[10px] text-slate-400">
          적재 <span className="text-slate-200" data-testid="inspector-events">{snapshot.totals.events}</span>건 · 세션{' '}
          <span className="text-slate-200">{snapshot.totals.sessions}</span> · 큐 {snapshot.totals.queue}건
          {snapshot.totals.rejected > 0 && <> · 제외 {snapshot.totals.rejected}건</>}
        </span>
        <span className="hidden text-[10px] text-slate-500 sm:inline">
          {snapshot.totals.mode === 'api' ? 'API 배치 전송' : 'IndexedDB 적재(데모)'} · 마지막 전송{' '}
          {snapshot.totals.lastFlushAt ? formatRelativeTime(snapshot.totals.lastFlushAt) : '없음'}
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="ml-auto rounded-md border border-white/15 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition hover:bg-white/10"
        >
          {open ? '접기' : '펼치기'}
        </button>
      </div>

      {open && (
        <div className="scroll-thin mx-auto grid max-h-[38vh] max-w-[1180px] gap-3 overflow-y-auto px-4 pb-3 sm:px-6 lg:grid-cols-[1.05fr_1.15fr_0.9fr]">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">파이프라인 단계</p>
            <ol className="min-w-0 space-y-1.5">
              {snapshot.stages.map((stage) => (
                <li key={stage.key} className="min-w-0 rounded-lg bg-white/5 px-2.5 py-1.5" data-testid={`stage-${stage.key}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-200">{stage.label}</span>
                    <span
                      className={`num text-[11px] font-semibold ${
                        stage.state === 'warn' ? 'text-amber-300' : stage.state === 'idle' ? 'text-slate-500' : 'text-emerald-300'
                      }`}
                    >
                      {stage.value}
                    </span>
                  </div>
                  <p className="truncate text-[10px] text-slate-500" title={stage.hint}>{stage.hint}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="min-w-0">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">최근 이벤트 payload</p>
              {snapshot.latest && (
                <span className="num text-[10px] text-slate-500">
                  {snapshot.latest.occurredAt.slice(11, 19)} · {snapshot.latest.delivery}
                </span>
              )}
            </div>
            <pre
              className="scroll-thin max-h-44 overflow-auto rounded-lg bg-black/40 p-2.5 text-[10px] leading-relaxed text-emerald-200"
              data-testid="inspector-json"
            >
              {snapshot.latest ? eventPayloadJson(snapshot.latest) : '매물을 클릭하거나 필터를 바꾸면 이벤트가 여기에 쌓입니다.'}
            </pre>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {snapshot.recent.map((event) => (
                <span key={event.eventId} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400" title={event.name}>
                  {event.name}
                </span>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">세션 퍼널</p>
            <ol className="space-y-1.5">
              {snapshot.funnel.map((step, index) => (
                <li key={step.stepKey}>
                  <div className="flex items-baseline justify-between gap-2 text-[10px]">
                    <span className="text-slate-300">{step.stepLabel}</span>
                    <span className="num text-slate-400">
                      {step.sessions}세션 · {(step.conversionFromStart * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500"
                      style={{ width: `${Math.max(widths[index] ?? 0, step.sessions > 0 ? 3 : 0)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
              화면을 옮기면 page_view가, 필터·비교·금리 조정·CSV 저장을 하면 해당 이벤트가 즉시 반영됩니다.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
