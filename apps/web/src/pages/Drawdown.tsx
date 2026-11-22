import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AREA_BAND_RANGES,
  DRAWDOWN_LARGE_COMPLEX_HOUSEHOLDS,
  RADAR_SIGUNGU,
  selectDrawdownRanking,
  summarizeDrawdown,
  type AreaBandKey,
} from '@prop/shared';
import { Card, DataNote, EmptyState, FilterLabel, Stat, StatGrid } from '../components/ui';
import { BarChart } from '../components/charts';
import { formatAreaWithPyeong, formatKrwKorean, formatMonth, formatNumber, formatPct, formatPyeongPrice } from '../lib/format';
import { dataset } from '../lib/dataset';
import { DRAWDOWN_SET } from '../lib/tools';
import { tracker } from '../lib/tracker';

const AREA_OPTIONS: Array<{ key: AreaBandKey | 'all'; label: string }> = [
  { key: 'all', label: '전체 면적(단지 대표)' },
  ...(Object.entries(AREA_BAND_RANGES) as Array<[AreaBandKey, { label: string }]>).map(([key, value]) => ({
    key,
    label: value.label,
  })),
];

const HOUSEHOLD_OPTIONS = [350, 500, 700, 1000];

export default function Drawdown() {
  const [lawdCds, setLawdCds] = useState<string[]>([]);
  const [areaBand, setAreaBand] = useState<AreaBandKey | 'all'>('all');
  const [minHouseholds, setMinHouseholds] = useState(DRAWDOWN_LARGE_COMPLEX_HOUSEHOLDS);
  const [onlyDeclined, setOnlyDeclined] = useState(false);
  const [selectedComplexId, setSelectedComplexId] = useState<string | null>(null);
  const initial = useRef(true);

  const entries = useMemo(
    () => selectDrawdownRanking(DRAWDOWN_SET.rows, { lawdCds, areaBand, minHouseholds, onlyDeclined }),
    [lawdCds, areaBand, minHouseholds, onlyDeclined],
  );
  const summary = useMemo(() => summarizeDrawdown(entries), [entries]);
  const selected = selectedComplexId ? entries.find((row) => row.complexId === selectedComplexId) : undefined;

  const topDeclines = entries
    .filter((row) => row.drawdownPct < 0)
    .slice(0, 8)
    .map((row) => ({
      label: row.complexName.length > 7 ? `${row.complexName.slice(0, 7)}…` : row.complexName,
      value: Math.abs(row.drawdownPct),
    }));

  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      tracker.track('drawdown_filter_change', {
        lawdCds,
        areaBand,
        minHouseholds,
        onlyDeclined,
        resultCount: entries.length,
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [lawdCds.join(','), areaBand, minHouseholds, onlyDeclined, entries.length]);

  const toggleDistrict = (lawdCd: string) => {
    setLawdCds((current) =>
      current.includes(lawdCd) ? current.filter((code) => code !== lawdCd) : [...current, lawdCd],
    );
    setSelectedComplexId(null);
  };

  const openRow = (row: (typeof entries)[number]) => {
    setSelectedComplexId((current) => (current === row.complexId ? null : row.complexId));
    if (selectedComplexId === row.complexId) return;
    tracker.track('listing_click', {
      complexId: row.complexId,
      aptName: row.complexName,
      priceKrw: row.currentPriceKrw,
      areaM2: row.areaM2,
      source: 'drawdown',
    });
  };

  return (
    <div className="space-y-4">
      <Card
        title="하락률 조건"
        subtitle={`${DRAWDOWN_LARGE_COMPLEX_HOUSEHOLDS}세대 이상 · 24개월 전고점 대비 · 같은 단지·5㎡ 구간의 3개월 이동 중위 평당가`}
        action={
          <span className="num text-[10.5px] text-ink-300">
            기준월 {DRAWDOWN_SET.asOfMonth} · 평가 구간 {DRAWDOWN_SET.universe.evaluatedBands}개 · 표본 부족 제외 {DRAWDOWN_SET.universe.skippedThinBands}개
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1" role="group" aria-label="구 선택">
          <FilterLabel>구</FilterLabel>
          <button
            type="button"
            className={`chip ${lawdCds.length === 0 ? 'chip-active' : ''}`}
            aria-pressed={lawdCds.length === 0}
            onClick={() => {
              setLawdCds([]);
              setSelectedComplexId(null);
            }}
          >
            전체 6개 구
          </button>
          {RADAR_SIGUNGU.map((row) => {
            const count = dataset.complexes.filter(
              (complex) => complex.lawdCd === row.lawdCd && complex.households >= minHouseholds,
            ).length;
            return (
              <button
                key={row.lawdCd}
                type="button"
                className={`chip ${lawdCds.includes(row.lawdCd) ? 'chip-active' : ''}`}
                aria-pressed={lawdCds.includes(row.lawdCd)}
                onClick={() => toggleDistrict(row.lawdCd)}
                data-testid={`drawdown-district-${row.lawdCd}`}
              >
                {row.sigungu}
                <span className="chip-count">{count}곳</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid gap-3 border-t border-line-soft pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-medium text-ink-600">면적대</span>
            <select
              className="select"
              value={areaBand}
              onChange={(event) => {
                setAreaBand(event.target.value as AreaBandKey | 'all');
                setSelectedComplexId(null);
              }}
              aria-label="면적대"
              data-testid="drawdown-band"
            >
              {AREA_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-medium text-ink-600">세대수 하한</span>
            <select
              className="select"
              value={minHouseholds}
              onChange={(event) => setMinHouseholds(Number(event.target.value))}
              aria-label="세대수 하한"
            >
              {HOUSEHOLD_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value.toLocaleString('ko-KR')}세대 이상
                </option>
              ))}
            </select>
          </label>

          <label className="flex h-9 w-fit cursor-pointer items-center gap-2 self-end rounded-md border border-line bg-white px-2.5">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-accent"
              checked={onlyDeclined}
              onChange={(event) => setOnlyDeclined(event.target.checked)}
              data-testid="drawdown-only-declined"
            />
            <span className="text-[12px] text-ink-700">하락 단지만 보기</span>
          </label>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-ink-300">
          전체 면적은 단지 대표 면적(거래가 가장 많은 5㎡ 구간)입니다. 면적대를 고르면 같은 ㎡ (평) 기준으로 비교합니다.
        </p>
      </Card>

      <StatGrid>
        <Stat label="평가 단지" value={`${formatNumber(summary.count)}곳`} hint={`세대 합계 ${formatNumber(summary.totalHouseholds)}세대`} testId="drawdown-count" />
        <Stat label="하락 단지" value={`${formatNumber(summary.declinedCount)}곳`} hint={summary.count > 0 ? `${((summary.declinedCount / summary.count) * 100).toFixed(0)}%가 전고점 아래` : '-'} />
        <Stat label="중위 하락률" value={summary.count === 0 ? '-' : formatPct(summary.medianDrawdownPct)} hint="단지별 대표 면적 기준" tone={summary.medianDrawdownPct < 0 ? 'down' : 'default'} />
        <Stat
          label="최대 낙폭"
          value={summary.worstComplexName ? formatPct(summary.worstDrawdownPct) : '-'}
          hint={summary.worstComplexName ?? '표본 없음'}
          testId="drawdown-worst"
          tone={summary.worstComplexName ? 'down' : 'default'}
        />
      </StatGrid>

      <Card title="하락률 상위 단지" subtitle="전고점 대비 많이 빠진 순서 · 막대는 하락률(%p)">
        {topDeclines.length > 0 ? (
          <BarChart
            ariaLabel="전고점 대비 하락률 상위 단지 막대 그래프"
            points={topDeclines}
            height={150}
            color="#be123c"
            formatValue={(value) => `${value.toFixed(1)}%`}
            formatAxis={(value) => `${value.toFixed(0)}%`}
          />
        ) : (
          <EmptyState title="하락 단지가 없습니다" description="조건을 넓히거나 면적대를 바꿔 보세요." />
        )}
      </Card>

      <Card
        title="전고점 대비 하락률 랭킹"
        subtitle="24개월 내 최고 월별 중위 평당가 대비 현재 3개월 중위 평당가 · 행을 누르면 근거가 열립니다"
        action={<span className="text-[11px] text-ink-300">표본 8개월·10건 미만 구간 제외</span>}
      >
        {selected && (
          <div className="mb-3 rounded-md border border-line bg-canvas/70 px-3 py-2.5" data-testid="drawdown-detail">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[12.5px] font-semibold text-ink-900">
                  {selected.complexName} · {formatAreaWithPyeong(selected.areaM2)}
                </p>
                <p className="num mt-0.5 text-[11px] text-ink-500">
                  {selected.sigungu} {selected.dong} · {formatNumber(selected.households)}세대 · {selected.builtYear}년 준공 · 표본 {selected.sampleCount}건/{selected.monthCount}개월
                </p>
              </div>
              <span className="status text-rose-700">
                <span className="dot bg-rose-500" aria-hidden="true" />
                {formatPct(selected.drawdownPct)} · {formatKrwKorean(selected.drawdownKrw)} 하락
              </span>
            </div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line-soft pt-2.5 text-[11px] sm:grid-cols-4">
              <div>
                <dt className="text-ink-300">전고점</dt>
                <dd className="num font-semibold text-ink-700">
                  {formatMonth(selected.peakMonth)} · {formatKrwKorean(selected.peakPriceKrw)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-300">현재(3개월 중위)</dt>
                <dd className="num font-semibold text-ink-700">
                  {formatMonth(selected.currentMonth)} · {formatKrwKorean(selected.currentPriceKrw)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-300">평당가 낙폭</dt>
                <dd className="num font-semibold text-rose-700">{formatPyeongPrice(selected.pppDropKrw)}</dd>
              </div>
              <div>
                <dt className="text-ink-300">전고점 평당가</dt>
                <dd className="num font-semibold text-ink-700">{formatPyeongPrice(selected.peakPricePerPyeong)}</dd>
              </div>
            </dl>
          </div>
        )}

        {entries.length === 0 ? (
          <EmptyState title="조건에 맞는 단지가 없습니다" description="구·면적대·세대수 조건을 넓혀 보세요." />
        ) : (
          <div className="table-scroll scroll-thin -mx-1 max-h-[560px] overflow-auto px-1">
            <table className="w-full min-w-[900px] border-collapse text-sm" data-testid="drawdown-table">
              <thead>
                <tr className="table-head">
                  <th className="px-2 py-[7px] text-right">순위</th>
                  <th className="px-2 py-[7px]">단지</th>
                  <th className="px-2 py-[7px]">구·동</th>
                  <th className="px-2 py-[7px] text-right">면적(㎡·평)</th>
                  <th className="px-2 py-[7px] text-right">전고점</th>
                  <th className="px-2 py-[7px] text-right">현재</th>
                  <th className="px-2 py-[7px] text-right">하락률</th>
                  <th className="px-2 py-[7px] text-right">평당가 낙폭</th>
                  <th className="px-2 py-[7px] text-right">표본</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => (
                  <tr
                    key={row.complexId}
                    className={`cursor-pointer border-b border-line-soft last:border-0 hover:bg-canvas ${
                      selectedComplexId === row.complexId ? 'bg-canvas' : ''
                    }`}
                    onClick={() => openRow(row)}
                    data-testid={`drawdown-row-${row.complexId}`}
                  >
                    <td className="num px-2 py-2 text-right text-xs font-semibold text-slate-500">{row.rank}</td>
                    <td className="px-2 py-[7px]">
                      <span className="text-[12.5px] font-medium text-ink-800">{row.complexName}</span>
                      <span className="ml-1 text-[10px] text-ink-300">{formatNumber(row.households)}세대</span>
                    </td>
                    <td className="px-2 py-[7px] text-[11.5px] text-ink-500">
                      {row.sigungu} {row.dong}
                    </td>
                    <td className="num px-2 py-2 text-right text-[11.5px] text-ink-500">{formatAreaWithPyeong(row.areaM2)}</td>
                    <td className="num px-2 py-2 text-right text-[11.5px] text-ink-500">
                      {formatKrwKorean(row.peakPriceKrw)}
                      <span className="block text-[10px] text-ink-300">{formatMonth(row.peakMonth)}</span>
                    </td>
                    <td className="num px-2 py-2 text-right text-xs text-ink-700">
                      {formatKrwKorean(row.currentPriceKrw)}
                      <span className="block text-[10px] text-ink-300">{formatMonth(row.currentMonth)}</span>
                    </td>
                    <td className={`num px-2 py-2 text-right text-[12.5px] font-semibold ${row.drawdownPct < 0 ? 'text-rose-700' : 'text-ink-300'}`}>
                      {formatPct(row.drawdownPct)}
                    </td>
                    <td className="num px-2 py-2 text-right text-[11.5px] text-ink-500">
                      {row.pppDropKrw > 0 ? formatPyeongPrice(row.pppDropKrw) : '-'}
                    </td>
                    <td className="num px-2 py-2 text-right text-[10px] text-ink-300">
                      {row.sampleCount}건
                      <span className="block">{row.monthCount}개월</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <DataNote>
        전고점은 최근 24개월의 월별 중위 평당가를 3개월 이동 중위값으로 평활한 뒤 가장 높은 달로 잡고, 현재는 마지막 3개월 중위값입니다.
        같은 단지라도 59㎡와 84㎡는 평당가 수준이 달라 5㎡ 구간으로 나눠 계산하며, 표본이 8개월·10건 미만인 구간은 순위에서 뺍니다.
        전체 면적은 단지 대표 면적(거래가 가장 많은 구간)이고, 면적대를 고르면 같은 ㎡ (평) 기준으로 비교합니다. 계약 해제 거래는 제외하며,
        감정평가나 호가가 아니라 신고된 실거래의 중위값입니다.
      </DataNote>
    </div>
  );
}
