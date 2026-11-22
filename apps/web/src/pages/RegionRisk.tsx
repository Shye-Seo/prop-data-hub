import { useMemo, useState } from 'react';
import { JEONSE_RATIO_BANDS, jeonseRiskLevel, riskLevelLabel } from '@prop/shared';
import { Card, DataNote, FilterLabel, RiskBadge, Stat, StatGrid } from '../components/ui';
import { BarChart, LineChart, Sparkline } from '../components/charts';
import {
  PRICE_ANOMALIES,
  REGION_RISK_SUMMARIES,
  RISK_BY_COMPLEX,
  assessmentsFor,
  complexJeonseSeries,
  overallSummary,
} from '../lib/risk';
import { dataset } from '../lib/dataset';
import { formatArea, formatDate, formatKrwKorean, formatNumber, formatPct, formatPyeong, formatPyeongPrice } from '../lib/format';
import { tracker } from '../lib/tracker';

const COLORS: Record<string, string> = {
  '26230': '#0f766e',
  '26260': '#1d4ed8',
  '26290': '#7c3aed',
  '26350': '#b45309',
  '26470': '#be185d',
  '26500': '#0e7490',
};

const SORTS = [
  { key: 'score', label: '리스크 점수' },
  { key: 'jeonse', label: '전세가율' },
  { key: 'volume', label: '12개월 거래' },
] as const;

export default function RegionRisk() {
  const [lawdCd, setLawdCd] = useState<string | null>(null);
  const [sort, setSort] = useState<(typeof SORTS)[number]['key']>('score');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const summary = lawdCd ? REGION_RISK_SUMMARIES.find((row) => row.lawdCd === lawdCd) : overallSummary();
  const rows = useMemo(() => {
    const base = assessmentsFor(lawdCd);
    if (sort === 'jeonse') return [...base].sort((a, b) => b.jeonseRatioPct - a.jeonseRatioPct);
    if (sort === 'volume') return [...base].sort((a, b) => b.volume12m - a.volume12m);
    return base;
  }, [lawdCd, sort]);

  const selected = selectedId ? RISK_BY_COMPLEX.get(selectedId) : undefined;
  /** 갭은 단지 대표 전용면적으로 환산한 값이라, 라벨에도 그 단지의 면적을 그대로 보여준다. */
  const selectedComplexArea =
    (selectedId ? dataset.complexes.find((complex) => complex.complexId === selectedId)?.representativeAreaM2 : undefined) ?? 84;
  const selectedSeries = selected ? complexJeonseSeries(selected.complexId) : [];
  const selectedAnomalies = selected ? PRICE_ANOMALIES.filter((row) => row.complexId === selected.complexId) : [];

  const pricePoints = REGION_RISK_SUMMARIES.map((row) => ({ label: row.sigungu, value: row.medianPricePerPyeong }));
  const ratioPoints = REGION_RISK_SUMMARIES.map((row) => ({ label: row.sigungu, value: row.medianJeonseRatioPct }));
  const volumePoints = REGION_RISK_SUMMARIES.map((row) => ({ label: row.sigungu, value: row.volume12m }));

  const trendSeries = REGION_RISK_SUMMARIES.map((row) => ({
    key: row.lawdCd,
    label: row.sigungu,
    color: COLORS[row.lawdCd] ?? '#0f766e',
    points: row.jeonseRatioTrend.map((point) => ({ label: point.month, value: point.ratioPct })),
  }));

  const openComplex = (complexId: string, name: string) => {
    const assessment = RISK_BY_COMPLEX.get(complexId);
    setSelectedId(complexId === selectedId ? null : complexId);
    if (!assessment) return;
    tracker.track('listing_click', {
      complexId,
      aptName: name,
      priceKrw: Math.max(0, assessment.saleMedianKrw),
      areaM2: 84,
      source: 'risk',
      jeonseRatioPct: assessment.jeonseRatioPct,
    });
  };

  return (
    <div className="space-y-4">
      <div className="filter-bar">
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <FilterLabel>비교 구</FilterLabel>
          <button type="button" className={`chip ${lawdCd === null ? 'chip-active' : ''}`} onClick={() => setLawdCd(null)} aria-pressed={lawdCd === null}>
            전체 6개 구
          </button>
          {REGION_RISK_SUMMARIES.map((row) => (
            <button
              key={row.lawdCd}
              type="button"
              className={`chip ${lawdCd === row.lawdCd ? 'chip-active' : ''}`}
              onClick={() => setLawdCd(row.lawdCd)}
              aria-pressed={lawdCd === row.lawdCd}
            >
              {row.sigungu}
            </button>
          ))}
          <span className="ml-auto pl-2 text-[10.5px] text-ink-400">
            대표 전용면적(84㎡·25평) 구간 기준 · 전월세 표본 {formatNumber(dataset.rentTransactions.length)}건
          </span>
        </div>
      </div>

      <StatGrid>
        <Stat label="중위 전세가율" value={`${summary?.medianJeonseRatioPct.toFixed(1) ?? '0'}%`} hint={`주의 ${JEONSE_RATIO_BANDS.warning}% · 경고 ${JEONSE_RATIO_BANDS.high}% · 위험 ${JEONSE_RATIO_BANDS.critical}%`} />
        <Stat label="중위 평당가" value={formatPyeongPrice(summary?.medianPricePerPyeong ?? 0)} hint={`단지 ${summary?.complexCount ?? 0}곳`} />
        <Stat label="최근 12개월 거래" value={`${formatNumber(summary?.volume12m ?? 0)}건`} hint="해제 거래 제외" />
        <Stat
          label="고위험 단지"
          value={`${summary?.highRiskCount ?? 0}곳`}
          hint={`이상 거래 ${summary?.anomalyCount ?? 0}건 · 평균 점수 ${summary?.averageScore ?? 0}`}
          tone={summary && summary.highRiskCount > 0 ? 'down' : 'default'}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="구별 중위 평당가" subtitle="전용면적 환산 · 최근월 중위값">
          <BarChart
            ariaLabel="구별 중위 평당가 막대 그래프"
            points={pricePoints}
            formatValue={formatPyeongPrice}
            formatLabel={(value) => `${Math.round(value / 10_000).toLocaleString('ko-KR')}만`}
            formatAxis={(value) => (value === 0 ? '0' : `${Math.round(value / 10_000).toLocaleString('ko-KR')}만`)}
            height={156}
            width={360}
            color="#1c2533"
          />
        </Card>
        <Card title="구별 중위 전세가율" subtitle="80% 이상은 경고 구간">
          <BarChart
            ariaLabel="구별 중위 전세가율 막대 그래프"
            points={ratioPoints}
            formatValue={(value) => `${value.toFixed(1)}%`}
            height={156}
            width={360}
            color="#0e7c6b"
          />
        </Card>
        <Card title="구별 12개월 거래량" subtitle="표본 수 기준">
          <BarChart
            ariaLabel="구별 12개월 거래량 막대 그래프"
            points={volumePoints}
            formatValue={(value) => `${Math.round(value)}건`}
            height={156}
            width={360}
            color="#5b6a86"
          />
        </Card>
      </div>

      <Card
        title="전세가율 추이"
        subtitle="단지별 같은 면적 구간 전세가율의 월별 중위값 · 기여 단지가 2곳 미만인 달은 비웁니다"
        action={<span className="text-[11px] text-slate-400">단위: %</span>}
      >
        <LineChart
          ariaLabel="부산 6개 구 전세가율 추이 선 그래프"
          series={trendSeries}
          height={228}
          formatValue={(value) => `${value.toFixed(1)}%`}
          formatAxis={(value) => `${Math.round(value)}%`}
        />
        <DataNote>
          전세가율은 <span className="num text-ink-700">전세 보증금 평당가 ÷ 매매 평당가 × 100</span>으로 계산합니다. 같은 단지라도 59㎡(18평)와
          84㎡(25평)는 평당가 수준이 달라, 같은 면적 구간(5㎡)에서 매칭한 값만 씁니다. 단지 2곳 미만이 남는 달은 비웁니다.
        </DataNote>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card
          title="단지별 리스크"
          subtitle="점수 = 전세가율·가격 흐름·이상 거래·유동성 배점 합(0~100)"
          action={
            <select className="select w-36 text-xs" value={sort} onChange={(event) => setSort(event.target.value as (typeof SORTS)[number]['key'])} aria-label="리스크 정렬">
              {SORTS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}순
                </option>
              ))}
            </select>
          }
        >
          <div className="table-scroll scroll-thin -mx-1 max-h-[552px] overflow-auto px-1">
            <table className="w-full min-w-[640px] border-collapse text-sm" data-testid="risk-table">
              <thead>
                <tr className="table-head">
                  <th className="px-2 py-[7px]">단지</th>
                  <th className="px-2 py-[7px] text-right">전세가율</th>
                  <th className="px-2 py-[7px] text-right">6개월</th>
                  <th className="px-2 py-[7px] text-right">12개월 거래</th>
                  <th className="px-2 py-[7px] text-right">이상</th>
                  <th className="px-2 py-[7px] text-right">점수</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.complexId}
                    className={`cursor-pointer border-b border-line-soft transition-colors last:border-0 hover:bg-canvas ${
                      selectedId === row.complexId ? 'bg-canvas' : ''
                    }`}
                    onClick={() => openComplex(row.complexId, row.complexName)}
                    data-testid={`risk-row-${row.complexId}`}
                  >
                    <td className="px-2 py-[7px]">
                      <span className="text-[12.5px] font-medium text-ink-800">{row.complexName}</span>
                      <span className="ml-1.5 text-[10px] text-ink-300">
                        {row.sigungu} {row.dong}
                      </span>
                    </td>
                    <td className="num px-2 py-[7px] text-right">
                      <span className="text-[12.5px] font-semibold text-ink-900">{row.jeonseRatioPct.toFixed(1)}%</span>
                      <span className="ml-1.5 inline-block align-middle">
                        <RiskBadge level={jeonseRiskLevel(row.jeonseRatioPct)} />
                      </span>
                    </td>
                    <td className={`num px-2 py-[7px] text-right text-[11.5px] ${row.change6mPct < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {formatPct(row.change6mPct)}
                    </td>
                    <td className="num px-2 py-[7px] text-right text-[11.5px] text-ink-500">{row.volume12m}건</td>
                    <td className="num px-2 py-[7px] text-right text-[11.5px] text-ink-500">{row.anomalyCount}건</td>
                    <td className="num px-2 py-[7px] text-right text-[12.5px] font-semibold text-ink-800">
                      {row.score}
                      <span className="ml-1 text-[10px] font-normal text-ink-300">{riskLevelLabel(row.level)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10.5px] text-ink-300">행을 누르면 전세가율·갭·위험 신호가 열립니다.</p>
        </Card>

        <Card title={selected ? `${selected.complexName} 상세` : '단지 상세'} subtitle={selected ? `${selected.sigungu} ${selected.dong} · 기준월 ${selected.asOfMonth}` : '왼쪽 표에서 단지를 선택하세요'}>
          {!selected ? (
            <p className="py-10 text-center text-[12px] text-ink-400">표의 행을 누르면 전세가율·갭·리스크 근거가 표시됩니다.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3 border-b border-line-soft pb-3">
                <div>
                  <p className="label">전세가율</p>
                  <p className="num mt-1 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink-900">{selected.jeonseRatioPct.toFixed(1)}%</p>
                </div>
                <RiskBadge level={selected.level} />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[11px]">
                <div>
                  <dt className="text-ink-400">매매 중위</dt>
                  <dd className="num mt-0.5 text-[12px] font-semibold text-ink-800">{formatKrwKorean(selected.saleMedianKrw)}</dd>
                </div>
                <div>
                  <dt className="text-ink-400">전세 중위</dt>
                  <dd className="num mt-0.5 text-[12px] font-semibold text-ink-800">{formatKrwKorean(selected.jeonseMedianKrw)}</dd>
                </div>
                <div>
                  <dt className="text-ink-400">
                    갭
                    <span className="block text-[10px] text-ink-300">
                      {formatArea(selectedComplexArea)}·{formatPyeong(selectedComplexArea)} 기준
                    </span>
                  </dt>
                  <dd className="num mt-0.5 text-[12px] font-semibold text-ink-800">{formatKrwKorean(selected.gapKrw)}</dd>
                </div>
                <div>
                  <dt className="text-ink-400">12개월 변화</dt>
                  <dd className={`num mt-0.5 text-[12px] font-semibold ${selected.change12mPct < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {formatPct(selected.change12mPct)}
                  </dd>
                </div>
              </dl>
              <div className="flex items-center justify-between gap-2 border-t border-line-soft pt-2.5">
                <p className="label">전세가율 최근 12개월</p>
                <Sparkline values={selectedSeries.slice(-12).map((row) => row.ratioPct)} />
              </div>
              <ul className="space-y-2">
                {selected.signals.length === 0 && <li className="text-[11px] text-ink-400">현재 기준으로 두드러진 위험 신호가 없습니다.</li>}
                {selected.signals.map((signal) => (
                  <li key={signal.code} className="border-l-2 border-line pl-2.5">
                    <RiskBadge level={signal.level}>{signal.label}</RiskBadge>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">{signal.detail}</p>
                  </li>
                ))}
              </ul>
              {selectedAnomalies.length > 0 && (
                <div className="border-t border-line-soft pt-2.5">
                  <p className="label mb-1.5">이상 거래 표본</p>
                  <ul className="divide-y divide-line-soft">
                    {selectedAnomalies.map((row) => (
                      <li key={row.dealHash} className="flex items-center justify-between gap-2 py-1 text-[10.5px] text-ink-500">
                        <span className="num">{formatDate(row.dealDate)}</span>
                        <span className="num">{formatKrwKorean(row.priceKrw)}</span>
                        <span className={`num font-semibold ${row.deviationPct < 0 ? 'text-rose-700' : 'text-amber-700'}`}>{formatPct(row.deviationPct)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <DataNote>
        리스크 점수는 계약 판단을 돕기 위한 화면 지표입니다. 감정평가나 투자 권유가 아니고, 표본이 적은 단지는 점수가 과대·과소
        평가될 수 있습니다. 전세가율·이상 거래 계산은 화면과 API가 같은 정의를 사용합니다.
      </DataNote>
    </div>
  );
}
