import { useMemo, useState } from 'react';
import { Card, DataNote, FilterLabel, Stat, StatGrid } from '../components/ui';
import { BarChart, LineChart, Sparkline } from '../components/charts';
import { DISTRICT_OPTIONS, MONTHS, REGION_OPTIONS, latestMacro, regionKpi, seriesForDong, seriesForLawdCd, dataset } from '../lib/dataset';
import { formatAreaWithPyeong, formatKrwKorean, formatMonth, formatPct, formatPyeongPrice } from '../lib/format';
import { tracker } from '../lib/tracker';
import type { RouteKey } from '../lib/router';

/** 구 단위 선 색. 차트에서 한 눈에 구를 구분하도록 고정한다. */
const DISTRICT_COLORS: Record<string, string> = {
  '26230': '#0e7c6b',
  '26260': '#2f5fd0',
  '26290': '#7c4ddb',
  '26350': '#b06a1f',
  '26470': '#c04b7a',
  '26500': '#2b8a9a',
};

export default function Overview({ navigate }: { navigate: (route: RouteKey) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const kpi = regionKpi(selected);

  const series = useMemo(() => {
    if (selected) {
      const region = REGION_OPTIONS.find((row) => row.legalDongCode === selected);
      return [
        {
          key: selected,
          label: `${region?.dong ?? ''} 중위 매매가`,
          color: DISTRICT_COLORS[REGION_OPTIONS.find((row) => row.legalDongCode === selected)?.lawdCd ?? ''] ?? '#0e7c6b',
          points: seriesForDong(selected).map((row) => ({ label: row.month, value: row.medianPriceKrw })),
        },
      ];
    }
    // 전체 보기에서는 동 16개가 아니라 구 6개 선으로 묶어 보여준다.
    return DISTRICT_OPTIONS.map((district) => ({
      key: district.lawdCd,
      label: district.sigungu,
      color: DISTRICT_COLORS[district.lawdCd] ?? '#0e7c6b',
      points: seriesForLawdCd(district.lawdCd).map((row) => ({ label: row.month, value: row.medianPriceKrw })),
    }));
  }, [selected]);

  const volumePoints = useMemo(
    () =>
      seriesForDong(selected)
        .slice(-12)
        .map((row) => ({ label: row.month, value: row.sampleCount })),
    [selected],
  );

  const applyRegion = (legalDongCode: string | null) => {
    const region = REGION_OPTIONS.find((row) => row.legalDongCode === legalDongCode);
    setSelected(legalDongCode);
    tracker.track('region_filter_change', {
      lawdCd: region?.lawdCd ?? '00000',
      dong: region?.dong ?? '전체',
      previousLawdCd: REGION_OPTIONS.find((row) => row.legalDongCode === selected)?.lawdCd ?? '00000',
      areaBand: 'all',
      periodMonths: 24,
      resultCount: dataset.transactions.filter(
        (row) => !row.canceled && (!legalDongCode || row.legalDongCode === legalDongCode),
      ).length,
    });
  };

  const recentRuns = dataset.pipelineRuns.slice(0, 3);
  const baseRate = latestMacro('base_rate');
  const mortgage = latestMacro('mortgage_rate');
  const cpi = latestMacro('cpi');
  const totalSamples = dataset.transactions.filter((row) => !row.canceled).length;

  return (
    <div className="space-y-4">
      <div className="filter-bar">
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 lg:flex-wrap lg:overflow-visible">
          <FilterLabel>지역</FilterLabel>
          <button
            type="button"
            className={`chip ${selected === null ? 'chip-active' : ''}`}
            onClick={() => applyRegion(null)}
            aria-pressed={selected === null}
          >
            전체
          </button>
          {REGION_OPTIONS.map((region) => (
            <button
              key={region.legalDongCode}
              type="button"
              className={`chip ${selected === region.legalDongCode ? 'chip-active' : ''}`}
              onClick={() => applyRegion(region.legalDongCode)}
              aria-pressed={selected === region.legalDongCode}
            >
              {region.label}
            </button>
          ))}
          <div className="ml-auto hidden shrink-0 items-center gap-3 pl-2 text-[11px] text-ink-400 lg:flex">
            <span className="num">
              표본 {totalSamples.toLocaleString('ko-KR')}건 · 24개월 · 중위 {formatAreaWithPyeong(kpi.medianAreaM2)}
            </span>
            <span aria-hidden="true" className="h-3 w-px bg-line" />
            <button type="button" className="font-medium text-ink-700 hover:text-accent" onClick={() => navigate('risk')}>
              구별 리스크
            </button>
            <button type="button" className="font-medium text-ink-700 hover:text-accent" onClick={() => navigate('radar')}>
              급매 레이더
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3 border-t border-line-soft pt-2 text-[10.5px] text-ink-400 lg:hidden">
          <span className="num truncate">
            표본 {totalSamples.toLocaleString('ko-KR')}건 · 24개월 · 중위 {formatAreaWithPyeong(kpi.medianAreaM2)}
          </span>
          <button type="button" className="ml-auto shrink-0 font-medium text-ink-700" onClick={() => navigate('risk')}>
            리스크
          </button>
          <button type="button" className="shrink-0 font-medium text-ink-700" onClick={() => navigate('radar')}>
            레이더
          </button>
        </div>
      </div>

      <StatGrid>
        <Stat
          label="관측 거래"
          value={`${kpi.transactionCount.toLocaleString('ko-KR')}건`}
          hint={`최근 12개월 ${kpi.twelveMonthVolume.toLocaleString('ko-KR')}건 · 해제 ${kpi.canceledCount}건 제외`}
        />
        <Stat
          label="최근월 중위 매매가"
          value={formatKrwKorean(kpi.latestMedianPriceKrw)}
          hint={`${formatMonth(kpi.latestMonth)} · 표본 중위값`}
        />
        <Stat
          label="최근월 평당가"
          value={formatPyeongPrice(kpi.medianPricePerPyeong)}
          hint={`전체 기간 중위 ${formatPyeongPrice(kpi.medianPricePerPyeong)}`}
        />
        <Stat
          label="전년 동월 대비"
          value={formatPct(kpi.yoyChangePct)}
          hint={`${formatMonth(kpi.latestMonth)} vs ${formatMonth(MONTHS[MONTHS.length - 13] ?? MONTHS[0]!)}`}
          tone={kpi.yoyChangePct >= 0 ? 'up' : 'down'}
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card
          title={selected ? `${REGION_OPTIONS.find((row) => row.legalDongCode === selected)?.label} 중위 매매가 추이` : '지역별 중위 매매가 추이'}
          subtitle="계약 연월 기준 · 해제 거래 제외 · 표본 중위값"
          action={<span className="num text-[10.5px] text-ink-300">단위: 원</span>}
        >
          <LineChart
            ariaLabel="지역별 중위 매매가 월별 추이 선 그래프"
            series={series}
            height={356}
            formatValue={formatKrwKorean}
          />
          <p className="note">
            계약 연월 기준 중위값입니다. 최근월은 신고 지연으로 표본이 적을 수 있어 전월과 함께 보는 편이 안전합니다.
          </p>
        </Card>

        <div className="space-y-4">
          <Card title="금리·물가지표" subtitle="한국은행 월간 지표 · 말일 기준">
            <div className="space-y-3">
              <MacroRow
                label="기준금리"
                value={baseRate ? `${baseRate.value.toFixed(2)}%` : '-'}
                asOf={baseRate?.periodDate}
                trend={dataset.macro.filter((row) => row.indicatorCode === 'base_rate').map((row) => row.value)}
              />
              <MacroRow
                label="주담대 금리"
                value={mortgage ? `${mortgage.value.toFixed(2)}%` : '-'}
                asOf={mortgage?.periodDate}
                trend={dataset.macro.filter((row) => row.indicatorCode === 'mortgage_rate').map((row) => row.value)}
              />
              <MacroRow
                label="소비자물가지수"
                value={cpi ? cpi.value.toFixed(1) : '-'}
                asOf={cpi?.periodDate}
                trend={dataset.macro.filter((row) => row.indicatorCode === 'cpi').map((row) => row.value)}
              />
            </div>
            <DataNote>
              금리 시나리오는 위 주담대 금리를 기준값으로 시작합니다. 각 지표의 기준일을 함께 표시합니다.
            </DataNote>
          </Card>

          <Card title="최근 갱신 현황" subtitle="최근 반영 이력">
            <ul className="divide-y divide-line-soft">
              {recentRuns.map((run) => (
                <li key={run.runId} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-ink-700">
                      {run.sourceId === 'molit_apt_trade' ? '매매 실거래' : '금리·물가 지표'}
                    </p>
                    <p className="num truncate text-[10.5px] text-ink-400">{run.startedAt.slice(0, 16).replace('T', ' ')}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="num text-[11px] text-ink-500">{run.recordsUpserted.toLocaleString('ko-KR')}건</span>
                    <span className="status">
                      <span
                        aria-hidden="true"
                        className={`dot ${run.status === 'succeeded' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                      />
                      {run.status === 'succeeded' ? '반영 완료' : '부분 반영'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card title="월별 거래 표본" subtitle="최근 12개월 · 해제 거래 제외">
          <BarChart
            ariaLabel="월별 거래 표본 수 막대 그래프"
            points={volumePoints}
            formatValue={(value) => `${Math.round(value)}건`}
            height={140}
            color="#1c2533"
          />
        </Card>

        <details className="card group">
          <summary className="card-head cursor-pointer items-center">
            <div>
              <h2 className="card-title">지표를 읽는 법</h2>
              <p className="card-sub">같은 기간·같은 면적 기준으로 비교합니다</p>
            </div>
            <span aria-hidden="true" className="text-[11px] text-ink-300 transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="card-pad">
            <ol className="space-y-3">
              {[
                ['중위 매매가', '그 달·그 지역 거래 금액의 가운데 값입니다. 평균 대신 중위값을 쓰면 이상치인 거래 한 건이 시세를 끌고가지 않습니다.'],
                ['평당가', '거래금액을 전용면적(3.3058㎡ = 1평)으로 나눠 면적이 다른 단지를 같은 자로 비교합니다.'],
                ['전세가율', '매매 중위가 대비 전세 보증금 비중입니다. 높을수록 보증금 반환 위험이 커집니다.'],
              ].map(([title, description], index) => (
                <li key={title} className="flex gap-3">
                  <span className="num mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line text-[9.5px] font-semibold text-ink-500">
                    {index + 1}
                  </span>
                  <span>
                    <span className="block text-[12px] font-medium text-ink-800">{title}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-400">{description}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </details>
      </div>
    </div>
  );
}

function MacroRow({
  label,
  value,
  asOf,
  trend,
}: {
  label: string;
  value: string;
  asOf?: string;
  trend: number[];
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-ink-700">{label}</p>
        <p className="num text-[10px] text-ink-400">기준일 {asOf ?? '-'}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <Sparkline values={trend.slice(-18)} />
        <span className="num w-16 text-right text-[13px] font-semibold text-ink-900">{value}</span>
      </div>
    </div>
  );
}
