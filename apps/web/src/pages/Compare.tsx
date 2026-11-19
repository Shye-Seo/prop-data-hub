import { useState } from 'react';
import { Card, DataNote } from '../components/ui';
import { LineChart } from '../components/charts';
import { ALL_COMPLEX_STATS, REGION_OPTIONS, complexStat, dataset } from '../lib/dataset';
import { formatKrwKorean, formatNumber, formatPct, formatPyeongPrice } from '../lib/format';
import { tracker } from '../lib/tracker';

const COLORS = ['#0f766e', '#1d4ed8', '#b45309'];

export default function Compare() {
  const [selected, setSelected] = useState<string[]>(['MOLIT-26290-001', 'MOLIT-26290-006']);
  const [message, setMessage] = useState<string | null>(null);

  const stats = selected
    .map((id) => complexStat(id))
    .filter((stat): stat is NonNullable<ReturnType<typeof complexStat>> => stat !== null);

  const toggle = (complexId: string) => {
    if (selected.includes(complexId)) {
      setSelected(selected.filter((id) => id !== complexId));
      return;
    }
    if (selected.length >= 3) {
      setMessage('비교는 최대 3개 단지까지 가능합니다. 하나를 해제하고 추가해 주세요.');
      window.setTimeout(() => setMessage(null), 3500);
      return;
    }
    const next = [...selected, complexId];
    setSelected(next);
    tracker.track('complex_compare_add', {
      complexIds: next,
      addedComplexId: complexId,
      compareCount: next.length,
      basis: 'price_per_pyeong',
    });
  };

  const series = stats.map((stat, index) => ({
    key: stat.complex.complexId,
    label: stat.complex.name,
    color: COLORS[index % COLORS.length]!,
    points: stat.series.map((row) => ({ label: row.month, value: row.medianPricePerPyeong })),
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <Card title="비교할 단지" subtitle="최대 3개 · 해제·추가 모두 이벤트로 기록">
          <div className="space-y-3">
            {REGION_OPTIONS.map((region) => {
              const items = ALL_COMPLEX_STATS.filter((stat) => stat.complex.legalDongCode === region.legalDongCode);
              return (
                <div key={region.legalDongCode}>
                  <p className="mb-1.5 text-[11px] font-semibold text-slate-500">
                    {region.sigungu} {region.dong}
                  </p>
                  <ul className="space-y-1">
                    {items.map((stat) => {
                      const checked = selected.includes(stat.complex.complexId);
                      return (
                        <li key={stat.complex.complexId}>
                          <label
                            className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                              checked ? 'border-teal-500/60 bg-teal-50/70' : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-teal-600"
                                checked={checked}
                                onChange={() => toggle(stat.complex.complexId)}
                                aria-label={`${stat.complex.name} 비교에 추가`}
                              />
                              <span className="truncate font-medium text-slate-700">{stat.complex.name}</span>
                            </span>
                            <span className="num shrink-0 text-[10px] text-slate-400">{stat.complex.households.toLocaleString('ko-KR')}세대</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
          {message && <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">{message}</p>}
        </Card>

        <div className="space-y-4">
          <Card
            title="평당가 추이 비교"
            subtitle="전용면적 환산 평당가(원/평) · 계약일 기준 중위값"
            action={<span className="text-[11px] text-slate-400">{stats.length}/3 선택</span>}
          >
            {stats.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">왼쪽 목록에서 단지를 선택하세요.</p>
            ) : (
              <LineChart ariaLabel="선택한 단지들의 평당가 추이 비교" series={series} height={280} formatValue={formatPyeongPrice} />
            )}
          </Card>

          {stats.length > 0 && (
            <Card title="비교 요약" subtitle={`기준월 ${stats[0]?.latestMonth ?? '-'} · 최근 12개월 거래량`}>
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="table-head">
                      <th className="px-2 py-2">항목</th>
                      {stats.map((stat, index) => (
                        <th key={stat.complex.complexId} className="px-2 py-2 text-right">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                            {stat.complex.name}
                          </span>
                          <span className="block text-[10px] font-normal text-slate-400">{stat.dong}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <Row label="최근월 중위 매매가" values={stats.map((stat) => formatKrwKorean(stat.latestMedianPriceKrw))} />
                    <Row label="최근월 평당가" values={stats.map((stat) => formatPyeongPrice(stat.latestMedianPricePerPyeong))} />
                    <Row
                      label="전년 동월 대비"
                      values={stats.map((stat) => formatPct(stat.change12mPct))}
                      tone={stats.map((stat) => (stat.change12mPct >= 0 ? 'up' : 'down'))}
                    />
                    <Row label="최근 12개월 거래" values={stats.map((stat) => `${formatNumber(stat.volume12m)}건`)} />
                    <Row label="세대수" values={stats.map((stat) => `${stat.complex.households.toLocaleString('ko-KR')}세대`)} />
                    <Row label="준공" values={stats.map((stat) => `${stat.complex.builtYear}년`)} />
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>

      <DataNote>
        평당가는 전용면적을 3.305785㎡=1평으로 환산해 계산합니다. 단지별 표본 수가 적은 달은 중위값이 흔들릴 수 있어,
        실서비스에서는 표본 3건 미만 월을 흐리게 표시하거나 제외하는 규칙을 적용합니다.
        {selected.length > 0 && ` 현재 비교 조합: ${selected.join(', ')}`}
      </DataNote>
      <p className="text-[11px] text-slate-400">
        전체 {dataset.complexes.length}개 단지 중 비교 가능한 단지 {ALL_COMPLEX_STATS.length}개
      </p>
    </div>
  );
}

function Row({ label, values, tone }: { label: string; values: string[]; tone?: Array<'up' | 'down'> }) {
  return (
    <tr>
      <td className="px-2 py-2 text-xs text-slate-500">{label}</td>
      {values.map((value, index) => (
        <td
          key={`${label}-${index}`}
          className={`num px-2 py-2 text-right text-[13px] font-semibold ${
            tone?.[index] === 'up' ? 'text-emerald-600' : tone?.[index] === 'down' ? 'text-rose-600' : 'text-ink-800'
          }`}
        >
          {value}
        </td>
      ))}
    </tr>
  );
}
