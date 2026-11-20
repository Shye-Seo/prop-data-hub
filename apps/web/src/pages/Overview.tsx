import { useMemo, useState } from 'react';
import { FUNNEL_STEPS } from '@prop/shared';
import { Card, Kpi, StatusBadge, DataNote } from '../components/ui';
import { BarChart, LineChart, Sparkline } from '../components/charts';
import { DISTRICT_OPTIONS, MONTHS, REGION_OPTIONS, latestMacro, regionKpi, seriesForDong, seriesForLawdCd, dataset } from '../lib/dataset';
import { formatKrwKorean, formatMonth, formatPct, formatPyeongPrice } from '../lib/format';
import { tracker } from '../lib/tracker';
import type { RouteKey } from '../lib/router';

/** 구 단위 선 색. 차트에서 한 눈에 구를 구분하도록 고정한다. */
const DISTRICT_COLORS: Record<string, string> = {
  '26230': '#0f766e',
  '26260': '#1d4ed8',
  '26290': '#7c3aed',
  '26350': '#b45309',
  '26470': '#be185d',
  '26500': '#0e7490',
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
          color: DISTRICT_COLORS[REGION_OPTIONS.find((row) => row.legalDongCode === selected)?.lawdCd ?? ''] ?? '#0f766e',
          points: seriesForDong(selected).map((row) => ({ label: row.month, value: row.medianPriceKrw })),
        },
      ];
    }
    // 전체 보기에서는 동 16개가 아니라 구 6개 선으로 묶어 보여준다.
    return DISTRICT_OPTIONS.map((district) => ({
      key: district.lawdCd,
      label: district.sigungu,
      color: DISTRICT_COLORS[district.lawdCd] ?? '#0f766e',
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label mr-1">지역</span>
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
        <span className="ml-auto text-[11px] text-slate-500">
          표본 {dataset.transactions.filter((row) => !row.canceled).length.toLocaleString('ko-KR')}건 · 24개월
          <button type="button" className="ml-2 font-semibold text-teal-700" onClick={() => navigate('risk')}>
            구별 리스크 →
          </button>
          <button type="button" className="ml-2 font-semibold text-teal-700" onClick={() => navigate('radar')}>
            급매 레이더 →
          </button>
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="관측 거래"
          value={`${kpi.transactionCount.toLocaleString('ko-KR')}건`}
          hint={`최근 12개월 ${kpi.twelveMonthVolume.toLocaleString('ko-KR')}건 · 해제 ${kpi.canceledCount}건 제외`}
        />
        <Kpi
          label="최근월 중위 매매가"
          value={formatKrwKorean(kpi.latestMedianPriceKrw)}
          hint={`${formatMonth(kpi.latestMonth)} · 표본 중위값`}
        />
        <Kpi
          label="최근월 평당가"
          value={formatPyeongPrice(kpi.medianPricePerPyeong)}
          hint={`전체 기간 중위 ${formatPyeongPrice(kpi.medianPricePerPyeong)}`}
        />
        <Kpi
          label="전년 동월 대비"
          value={formatPct(kpi.yoyChangePct)}
          hint={`${formatMonth(kpi.latestMonth)} vs ${formatMonth(MONTHS[MONTHS.length - 13] ?? MONTHS[0]!)}`}
          tone={kpi.yoyChangePct >= 0 ? 'up' : 'down'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card
          title={selected ? `${REGION_OPTIONS.find((row) => row.legalDongCode === selected)?.label} 중위 매매가 추이` : '지역별 중위 매매가 추이'}
          subtitle="계약 연월 기준 · 해제 거래 제외 · 표본 중위값"
          action={<span className="text-[11px] text-slate-400">단위: 원</span>}
        >
          <LineChart
            ariaLabel="지역별 중위 매매가 월별 추이 선 그래프"
            series={series}
            height={260}
            formatValue={formatKrwKorean}
          />
        </Card>

        <div className="space-y-4">
          <Card title="금리·물가지표" subtitle="한국은행 ECOS · 월간 지표는 말일 기준">
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
              금리 시나리오는 위 주담대 금리를 기준값으로 시작합니다. 지표 기준일과 수집 시점을 함께 저장해 화면에 표시합니다.
            </DataNote>
          </Card>

          <Card title="최근 수집 실행" subtitle="부분 성공·실패는 실행 상세에서 태스크 단위로 확인" action={
            <button type="button" className="text-xs font-semibold text-teal-700" onClick={() => navigate('pipeline')}>
              전체 보기
            </button>
          }>
            <ul className="divide-y divide-slate-100">
              {recentRuns.map((run) => (
                <li key={run.runId} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-slate-700">{run.sourceId === 'molit_apt_trade' ? '실거래가' : 'ECOS 지표'} · {run.jobType}</p>
                    <p className="num truncate text-[11px] text-slate-400">{run.startedAt.slice(0, 16).replace('T', ' ')}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-right">
                    <span className="num text-[11px] text-slate-500">{run.recordsUpserted.toLocaleString('ko-KR')}건</span>
                    <StatusBadge status={run.status} />
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
            height={170}
            color="#12355f"
          />
        </Card>

        <Card title="이 화면의 데이터가 만들어지는 과정" subtitle="수집 → 정규화 → 멱등 업서트 → 지표 계산">
          <ol className="space-y-3">
            {[
              ['공공데이터 수집', '국토교통부 실거래가 XML/JSON, 한국은행 ECOS 월간 지표'],
              ['정규화·검증', '금액 만원→원 환산, 계약일 보정, 해제 거래 표시, 법정동 코드 매핑'],
              ['멱등 업서트', 'deal_hash 충돌 시 값만 갱신해 재수집 중복을 막음'],
              ['지표 계산', '중위가·평당가·거래량, 기준일(as-of) 메타데이터 유지'],
            ].map(([title, description], index) => (
              <li key={title} className="flex gap-3">
                <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-800 text-[10px] font-semibold text-white">
                  {index + 1}
                </span>
                <span>
                  <span className="block text-xs font-semibold text-slate-800">{title}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{description}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {FUNNEL_STEPS.slice(0, 4).map((step) => (
              <span key={step.key} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                {step.label}
              </span>
            ))}
            <button type="button" className="text-[10px] font-semibold text-teal-700" onClick={() => navigate('dictionary')}>
              정의서 보기 →
            </button>
          </div>
        </Card>
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
      <div>
        <p className="text-xs font-medium text-slate-700">{label}</p>
        <p className="num text-[10px] text-slate-400">기준일 {asOf ?? '-'}</p>
      </div>
      <div className="flex items-center gap-2">
        <Sparkline values={trend.slice(-18)} />
        <span className="num w-16 text-right text-sm font-semibold text-ink-800">{value}</span>
      </div>
    </div>
  );
}
