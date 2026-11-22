import { useMemo, useState } from 'react';
import { Card, DataNote } from '../components/ui';
import { LineChart } from '../components/charts';
import { ALL_COMPLEX_STATS, REGION_OPTIONS, complexStat } from '../lib/dataset';
import { RISK_BY_COMPLEX, complexJeonseSeries } from '../lib/risk';
import { formatAreaWithPyeong, formatKrwKorean, formatNumber, formatPct, formatPyeongPrice } from '../lib/format';
import { tracker } from '../lib/tracker';

const COLORS = ['#0e7c6b', '#2f5fd0', '#b06a1f'];

export default function Compare() {
  const [selected, setSelected] = useState<string[]>(['MOLIT-26290-001', 'MOLIT-26290-006']);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const stats = selected
    .map((id) => complexStat(id))
    .filter((stat): stat is NonNullable<ReturnType<typeof complexStat>> => stat !== null);

  const groups = useMemo(
    () =>
      REGION_OPTIONS.map((region) => ({
        region,
        items: ALL_COMPLEX_STATS.filter(
          (stat) =>
            stat.complex.legalDongCode === region.legalDongCode &&
            (query.trim() === '' || stat.complex.name.includes(query.trim())),
        ),
      })).filter((group) => group.items.length > 0),
    [query],
  );

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

  const jeonseSeries = stats.map((stat, index) => ({
    key: `jeonse-${stat.complex.complexId}`,
    label: stat.complex.name,
    color: COLORS[index % COLORS.length]!,
    points: complexJeonseSeries(stat.complex.complexId).map((row) => ({ label: row.month, value: row.ratioPct })),
  }));

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 xl:grid-cols-[300px_1fr]">
        <Card
          title="비교할 단지"
          subtitle={`${stats.length}/3 선택`}
          action={
            <button type="button" className="btn-ghost" onClick={() => setSelected([])} disabled={selected.length === 0}>
              초기화
            </button>
          }
        >
          <input
            type="text"
            className="select mb-2"
            placeholder="단지명 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="단지명 검색"
          />
          <div className="scroll-thin -mx-1 max-h-[520px] space-y-3 overflow-y-auto px-1">
            {groups.map(({ region, items }) => (
              <div key={region.legalDongCode}>
                <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
                  {region.sigungu} {region.dong}
                </p>
                <ul className="border-t border-line-soft">
                  {items.map((stat) => {
                    const checked = selected.includes(stat.complex.complexId);
                    const order = selected.indexOf(stat.complex.complexId);
                    return (
                      <li key={stat.complex.complexId} className="border-b border-line-soft">
                        <label
                          className={`flex cursor-pointer items-center justify-between gap-2 px-1.5 py-1.5 text-[12px] transition-colors hover:bg-canvas ${
                            checked ? 'bg-canvas/80' : ''
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 accent-accent"
                              checked={checked}
                              onChange={() => toggle(stat.complex.complexId)}
                              aria-label={`${stat.complex.name} 비교에 추가`}
                            />
                            <span className={`truncate ${checked ? 'font-medium text-ink-900' : 'text-ink-700'}`}>
                              {stat.complex.name}
                            </span>
                            {checked && (
                              <span
                                aria-hidden="true"
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: COLORS[order % COLORS.length] }}
                              />
                            )}
                          </span>
                          <span className="num shrink-0 text-[10px] text-ink-300">{stat.complex.households.toLocaleString('ko-KR')}세대</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {groups.length === 0 && <p className="px-1 py-6 text-center text-[11.5px] text-ink-400">검색 결과가 없습니다.</p>}
          </div>
          {message && <p className="mt-2 text-[11px] leading-relaxed text-amber-700">{message}</p>}
        </Card>

        <div className="space-y-4">
          <Card
            title="평당가 추이 비교"
            subtitle="전용면적 환산 평당가(원/평) · 계약일 기준 중위값"
            action={<span className="num text-[10.5px] text-ink-300">{stats.length}/3</span>}
          >
            {stats.length === 0 ? (
              <p className="py-12 text-center text-[12px] text-ink-400">왼쪽 목록에서 단지를 선택하세요.</p>
            ) : (
              <LineChart ariaLabel="선택한 단지들의 평당가 추이 비교" series={series} height={272} formatValue={formatPyeongPrice} />
            )}
          </Card>

          {stats.length > 0 && (
            <Card title="비교 요약" subtitle={`기준월 ${stats[0]?.latestMonth ?? '-'} · 최근 12개월 거래량`}>
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-sm">
                  <thead>
                    <tr className="table-head">
                      <th className="px-2 py-[7px]">항목</th>
                      {stats.map((stat, index) => (
                        <th key={stat.complex.complexId} className="px-2 py-[7px] text-right align-bottom">
                          <span className="inline-flex items-center gap-1.5 whitespace-normal">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                            {stat.complex.name}
                          </span>
                          <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] font-normal normal-case tracking-normal text-ink-300">
                            {stat.dong}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    <Row label="최근월 중위 매매가" values={stats.map((stat) => formatKrwKorean(stat.latestMedianPriceKrw))} />
                    <Row label="최근월 평당가" values={stats.map((stat) => formatPyeongPrice(stat.latestMedianPricePerPyeong))} />
                    <Row
                      label="전년 동월 대비"
                      values={stats.map((stat) => formatPct(stat.change12mPct))}
                      tone={stats.map((stat) => (stat.change12mPct >= 0 ? 'up' : 'down'))}
                    />
                    <Row label="최근 12개월 거래" values={stats.map((stat) => `${formatNumber(stat.volume12m)}건`)} />
                    <Row
                      label="전세가율"
                      values={stats.map((stat) => {
                        const risk = RISK_BY_COMPLEX.get(stat.complex.complexId);
                        return risk ? `${risk.jeonseRatioPct.toFixed(1)}%` : '-';
                      })}
                      tone={stats.map((stat) => {
                        const risk = RISK_BY_COMPLEX.get(stat.complex.complexId);
                        return risk && risk.jeonseRatioPct >= 80 ? 'down' : 'up';
                      })}
                    />
                    <Row
                      label="리스크 단계"
                      values={stats.map((stat) => {
                        const risk = RISK_BY_COMPLEX.get(stat.complex.complexId);
                        return risk ? `${risk.score}점 · ${risk.signals.length}개 신호` : '-';
                      })}
                    />
                    <Row label="대표 전용면적" values={stats.map((stat) => formatAreaWithPyeong(stat.complex.representativeAreaM2))} />
                    <Row label="세대수" values={stats.map((stat) => `${stat.complex.households.toLocaleString('ko-KR')}세대`)} />
                    <Row label="준공" values={stats.map((stat) => `${stat.complex.builtYear}년`)} />
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {stats.length > 0 && (
            <Card title="전세가율 추이" subtitle="같은 면적 구간 매칭 · 80% 넘으면 경고" action={<span className="num text-[10.5px] text-ink-300">%</span>}>
              <LineChart
                ariaLabel="선택한 단지들의 전세가율 추이 비교"
                series={jeonseSeries}
                height={208}
                formatValue={(value) => `${value.toFixed(1)}%`}
                formatAxis={(value) => `${Math.round(value)}%`}
              />
            </Card>
          )}
        </div>
      </div>

      <DataNote>
        평당가는 전용면적을 3.305785㎡=1평으로 환산해 계산합니다. 표본이 적은 달은 중위값이 흔들릴 수 있어, 표본 3건 미만인
        달은 비교에서 제외합니다. 전세가율과 리스크 단계는 같은 단지·같은 면적 구간 기준입니다.
      </DataNote>
    </div>
  );
}

function Row({ label, values, tone }: { label: string; values: string[]; tone?: Array<'up' | 'down'> }) {
  return (
    <tr>
      <td className="px-2 py-[7px] text-[11.5px] text-ink-400">{label}</td>
      {values.map((value, index) => (
        <td
          key={`${label}-${index}`}
          className={`num px-2 py-[7px] text-right text-[12px] font-semibold ${
            tone?.[index] === 'up' ? 'text-emerald-700' : tone?.[index] === 'down' ? 'text-rose-700' : 'text-ink-900'
          }`}
        >
          {value}
        </td>
      ))}
    </tr>
  );
}
