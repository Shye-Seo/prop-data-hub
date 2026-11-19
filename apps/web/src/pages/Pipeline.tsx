import { useMemo, useState } from 'react';
import type { DeadLetterEntry, PipelineRun, PipelineRunTask } from '@prop/shared';
import { Card, DataNote, EmptyState, StatusBadge } from '../components/ui';
import { pipelineSeed, REGION_OPTIONS, dataset } from '../lib/dataset';
import { formatNumber } from '../lib/format';
import { tracker } from '../lib/tracker';

const SOURCE_LABEL: Record<string, string> = {
  molit_apt_trade: '국토교통부 실거래가',
  ecos_rates: '한국은행 ECOS 금리',
  ecos_cpi: '한국은행 ECOS 물가',
};

export default function Pipeline() {
  const [runs, setRuns] = useState<PipelineRun[]>(pipelineSeed.runs);
  const [tasks, setTasks] = useState<PipelineRunTask[]>(pipelineSeed.tasks);
  const [deadLetters, setDeadLetters] = useState<DeadLetterEntry[]>(pipelineSeed.deadLetters);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(pipelineSeed.runs[0]?.runId ?? null);
  const [toast, setToast] = useState<string | null>(null);

  const selectedRun = runs.find((run) => run.runId === selectedRunId) ?? null;
  const selectedTasks = tasks.filter((task) => task.runId === selectedRunId);
  const unresolved = deadLetters.filter((entry) => entry.resolvedAt === null);

  const summary = useMemo(() => {
    const recent = runs.slice(0, 4);
    const succeeded = recent.filter((run) => run.status === 'succeeded').length;
    return {
      successRate: recent.length === 0 ? 0 : (succeeded / recent.length) * 100,
      records: recent.reduce((sum, run) => sum + run.recordsUpserted, 0),
      retries: recent.reduce((sum, run) => sum + run.retryCount, 0),
    };
  }, [runs]);

  const inspectSource = (sourceId: string, asOfPolicy: string) => {
    tracker.track('pipeline_source_inspect', {
      sourceId,
      panel: 'sources',
      asOfDate: dataset.transactions[0]?.asOfDate,
    });
    setToast(`${SOURCE_LABEL[sourceId] ?? sourceId} · ${asOfPolicy}`);
    window.setTimeout(() => setToast(null), 4000);
  };

  const openRun = (run: PipelineRun) => {
    setSelectedRunId(run.runId);
    tracker.track('pipeline_source_inspect', {
      sourceId: run.sourceId,
      runId: run.runId,
      panel: 'run_detail',
    });
  };

  const retryDeadLetter = (entry: DeadLetterEntry) => {
    const resolvedAt = new Date().toISOString();
    setDeadLetters((current) =>
      current.map((row) => (row.id === entry.id ? { ...row, resolvedAt, attempts: row.attempts + 1 } : row)),
    );
    tracker.track('pipeline_source_inspect', {
      sourceId: entry.sourceId,
      runId: entry.runId,
      panel: 'dlq',
    });
    setToast('재시도가 성공해 해결 처리했습니다. (데모에서는 실제 외부 호출 없이 상태만 바뀝니다)');
    window.setTimeout(() => setToast(null), 4500);
  };

  const simulateRun = () => {
    const now = new Date();
    const digits = now.toISOString().split('').filter((char) => char >= '0' && char <= '9').join('');
    const runId = `run_sim_${digits.slice(0, 14)}`;
    const lawds = REGION_OPTIONS.slice(0, 2).map((region) => region.lawdCd);
    const periods = ['2026-09', '2026-08'];
    const newTasks: PipelineRunTask[] = [];
    lawds.forEach((lawdCd) => {
      periods.forEach((period) => {
        newTasks.push({
          runId,
          sourceId: 'molit_apt_trade',
          lawdCd,
          period,
          status: 'succeeded',
          attempts: 1,
          records: 40 + Math.round(Math.random() * 60),
          error: null,
          updatedAt: now.toISOString(),
        });
      });
    });
    const records = newTasks.reduce((sum, task) => sum + task.records, 0);
    const run: PipelineRun = {
      runId,
      sourceId: 'molit_apt_trade',
      jobType: 'manual',
      status: 'succeeded',
      startedAt: now.toISOString(),
      finishedAt: new Date(now.getTime() + 42_000).toISOString(),
      requestedMonths: periods.length,
      taskTotal: newTasks.length,
      taskSucceeded: newTasks.length,
      taskFailed: 0,
      recordsUpserted: records,
      recordsSkipped: 0,
      retryCount: 1,
      errorSummary: null,
      triggeredBy: 'console:simulation',
    };
    setRuns((current) => [run, ...current]);
    setTasks((current) => [...newTasks, ...current]);
    setSelectedRunId(runId);
    tracker.track('pipeline_source_inspect', { sourceId: run.sourceId, runId, panel: 'runs' });
    setToast('수집 실행을 시뮬레이션했습니다. 실제 워커는 apps/collector에서 같은 경로를 실행합니다.');
    window.setTimeout(() => setToast(null), 4500);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card card-pad">
          <p className="label">최근 실행</p>
          <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-ink-800">
            <StatusBadge status={runs[0]?.status ?? 'queued'} />
            <span className="num text-xs font-normal text-slate-500">{runs[0]?.startedAt.slice(5, 16).replace('T', ' ')}</span>
          </p>
        </div>
        <div className="card card-pad">
          <p className="label">최근 4회 성공률</p>
          <p className="num mt-1 text-lg font-semibold text-ink-800">{summary.successRate.toFixed(0)}%</p>
        </div>
        <div className="card card-pad">
          <p className="label">최근 적재</p>
          <p className="num mt-1 text-lg font-semibold text-ink-800">{formatNumber(summary.records)}건</p>
        </div>
        <div className="card card-pad">
          <p className="label">DLQ 미해결</p>
          <p className={`num mt-1 text-lg font-semibold ${unresolved.length > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {unresolved.length}건
          </p>
        </div>
      </div>

      <Card
        title="수집 소스와 기준일 정책"
        subtitle="출처·라이선스·갱신 주기와 함께 데이터 기준일(as-of) 산정 방식을 표시합니다."
        action={
          <button type="button" className="btn" onClick={simulateRun} data-testid="simulate-run">
            수집 실행
          </button>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          {pipelineSeed.sources.map((source) => (
            <div key={source.sourceId} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-slate-800">{source.name}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{source.provider}</p>
                </div>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                  {source.requiresKey ? '인증키 필요' : '공개'}
                </span>
              </div>
              <p className="num mt-2 break-all text-[10px] leading-relaxed text-slate-400">{source.endpoint}</p>
              <dl className="mt-2 space-y-1 text-[11px] text-slate-500">
                <div className="flex gap-1">
                  <dt className="shrink-0 text-slate-400">갱신</dt>
                  <dd>{source.updateCycle}</dd>
                </div>
                <div className="flex gap-1">
                  <dt className="shrink-0 text-slate-400">기준일</dt>
                  <dd>{source.asOfPolicy}</dd>
                </div>
                <div className="flex gap-1">
                  <dt className="shrink-0 text-slate-400">이용</dt>
                  <dd>{source.license}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="mt-2 text-[11px] font-semibold text-teal-700"
                onClick={() => inspectSource(source.sourceId, source.asOfPolicy)}
              >
                출처 확인 →
              </button>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card title="실행 이력" subtitle="행을 누르면 배치 태스크 단위 결과를 봅니다.">
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm" data-testid="run-table">
              <thead>
                <tr className="table-head">
                  <th className="px-2 py-2">시작</th>
                  <th className="px-2 py-2">소스</th>
                  <th className="px-2 py-2">상태</th>
                  <th className="px-2 py-2 text-right">태스크</th>
                  <th className="px-2 py-2 text-right">적재</th>
                  <th className="px-2 py-2 text-right">재시도</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((run) => (
                  <tr
                    key={run.runId}
                    className={`cursor-pointer hover:bg-slate-50 ${selectedRunId === run.runId ? 'bg-teal-50/40' : ''}`}
                    onClick={() => openRun(run)}
                  >
                    <td className="num px-2 py-2 text-[11px] text-slate-500">{run.startedAt.slice(5, 16).replace('T', ' ')}</td>
                    <td className="px-2 py-2 text-xs text-slate-700">{SOURCE_LABEL[run.sourceId] ?? run.sourceId}</td>
                    <td className="px-2 py-2">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="num px-2 py-2 text-right text-xs text-slate-600">
                      {run.taskSucceeded}/{run.taskTotal}
                    </td>
                    <td className="num px-2 py-2 text-right text-xs text-slate-700">{formatNumber(run.recordsUpserted)}</td>
                    <td className="num px-2 py-2 text-right text-xs text-slate-500">{run.retryCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title={selectedRun ? `실행 상세 · ${selectedRun.runId.slice(0, 24)}` : '실행 상세'}
          subtitle={selectedRun ? `트리거 ${selectedRun.triggeredBy} · 요청 ${selectedRun.requestedMonths}개월` : '행을 선택하세요'}
        >
          {!selectedRun ? (
            <EmptyState title="선택된 실행이 없습니다" description="왼쪽 표에서 실행을 선택하면 태스크 결과가 표시됩니다." />
          ) : (
            <div className="space-y-3">
              {selectedRun.errorSummary && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700">
                  {selectedRun.errorSummary}
                </p>
              )}
              <div className="max-h-72 overflow-y-auto scroll-thin">
                <table className="w-full border-collapse text-xs" data-testid="task-table">
                  <thead>
                    <tr className="table-head">
                      <th className="px-2 py-1.5">기간</th>
                      <th className="px-2 py-1.5">지역</th>
                      <th className="px-2 py-1.5">상태</th>
                      <th className="px-2 py-1.5 text-right">시도</th>
                      <th className="px-2 py-1.5 text-right">건수</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedTasks.map((task) => (
                      <tr key={`${task.runId}-${task.lawdCd}-${task.period}`}>
                        <td className="num px-2 py-1.5 text-slate-600">{task.period}</td>
                        <td className="px-2 py-1.5 text-slate-600">{task.lawdCd ?? 'ECOS'}</td>
                        <td className="px-2 py-1.5">
                          <StatusBadge status={task.status} />
                        </td>
                        <td className="num px-2 py-1.5 text-right text-slate-500">{task.attempts}</td>
                        <td className="num px-2 py-1.5 text-right text-slate-600">{formatNumber(task.records)}</td>
                      </tr>
                    ))}
                    {selectedTasks.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-2 py-4 text-center text-[11px] text-slate-400">
                          태스크 기록이 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <DataNote>
                실패 태스크는 재시도 후에도 실패하면 DLQ로 넘어가고, 운영자가 원인을 확인한 뒤 재처리합니다.
                실행 단위 요약은 pipeline_runs, 배치 단위 결과는 pipeline_run_tasks에 남습니다.
              </DataNote>
            </div>
          )}
        </Card>
      </div>

      <Card title="실패 큐(DLQ)" subtitle="재시도 대기 건과 해결된 건을 함께 보관합니다.">
        <div className="space-y-2">
          {deadLetters.length === 0 && <p className="text-xs text-slate-400">실패 건이 없습니다.</p>}
          {deadLetters.map((entry) => (
            <div
              key={entry.id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                entry.resolvedAt ? 'border-slate-200 bg-slate-50/60' : 'border-rose-200 bg-rose-50/50'
              }`}
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-700">
                  <StatusBadge status={entry.resolvedAt ? 'resolved' : 'pending'} />
                  <span className="num">{entry.id}</span>
                  <span className="text-[11px] font-normal text-slate-500">{entry.error}</span>
                </p>
                <p className="num mt-0.5 text-[10px] text-slate-400">
                  payload {JSON.stringify(entry.payload)} · 시도 {entry.attempts}회 · 다음 재시도 {entry.nextRetryAt.slice(0, 16).replace('T', ' ')}
                </p>
              </div>
              {entry.resolvedAt ? (
                <span className="text-[11px] text-slate-400">해결 {entry.resolvedAt.slice(0, 16).replace('T', ' ')}</span>
              ) : (
                <button type="button" className="btn-ghost" onClick={() => retryDeadLetter(entry)}>
                  재시도
                </button>
              )}
            </div>
          ))}
        </div>
      </Card>

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-30 max-w-[92vw] -translate-x-1/2 rounded-lg bg-ink-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
