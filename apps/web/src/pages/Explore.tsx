import { useEffect, useMemo, useRef, useState } from 'react';
import { median } from '@prop/shared';
import { Card, DataNote, EmptyState, Field, RiskBadge } from '../components/ui';
import {
  AREA_BANDS,
  COMPLEX_BY_ID,
  REGION_OPTIONS,
  dataset,
  transactionsFor,
  type AreaBandKey,
} from '../lib/dataset';
import { ANOMALY_BY_DEAL_HASH, RISK_BY_COMPLEX, readSavedComplexes, writeSavedComplexes } from '../lib/risk';
import { formatArea, formatDate, formatKrwKorean, formatNumber, formatPyeong, formatPyeongPrice } from '../lib/format';
import { tracker } from '../lib/tracker';

const PAGE_SIZE = 30;
const SORTS = [
  { key: 'deal_date_desc', label: '최근 계약순' },
  { key: 'price_desc', label: '금액 높은순' },
  { key: 'price_asc', label: '금액 낮은순' },
  { key: 'ppp_desc', label: '평당가 높은순' },
] as const;

export default function Explore() {
  const [legalDongCode, setLegalDongCode] = useState<string>('');
  const [complexId, setComplexId] = useState<string>('');
  const [areaBand, setAreaBand] = useState<AreaBandKey>('all');
  const [months, setMonths] = useState(12);
  const [sort, setSort] = useState<(typeof SORTS)[number]['key']>('deal_date_desc');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>(() => (typeof window === 'undefined' ? [] : readSavedComplexes()));
  const initial = useRef(true);

  const complexes = useMemo(
    () => dataset.complexes.filter((complex) => (legalDongCode ? complex.legalDongCode === legalDongCode : true)),
    [legalDongCode],
  );

  const rows = useMemo(() => {
    const scoped = transactionsFor({ legalDongCode: legalDongCode || null, complexId: complexId || null, areaBand, months });
    const sorters: Record<(typeof SORTS)[number]['key'], (a: (typeof scoped)[number], b: (typeof scoped)[number]) => number> = {
      deal_date_desc: (a, b) => b.dealDate.localeCompare(a.dealDate),
      price_desc: (a, b) => b.priceKrw - a.priceKrw,
      price_asc: (a, b) => a.priceKrw - b.priceKrw,
      ppp_desc: (a, b) => b.pricePerPyeong - a.pricePerPyeong,
    };
    return [...scoped].sort(sorters[sort]);
  }, [legalDongCode, complexId, areaBand, months, sort]);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [legalDongCode, complexId, areaBand, months, sort]);

  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      const region = REGION_OPTIONS.find((row) => row.legalDongCode === legalDongCode);
      tracker.track('region_filter_change', {
        lawdCd: region?.lawdCd ?? '00000',
        dong: region?.dong ?? '전체',
        complexId: complexId || undefined,
        areaBand,
        periodMonths: months,
        resultCount: rows.length,
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [legalDongCode, complexId, areaBand, months, rows.length]);

  const summary = {
    count: rows.length,
    medianPrice: median(rows.map((row) => row.priceKrw)),
    medianPpp: median(rows.map((row) => row.pricePerPyeong)),
    medianArea: median(rows.map((row) => row.areaM2)),
  };

  const selected = selectedHash ? rows.find((row) => row.dealHash === selectedHash) : undefined;
  const selectedRisk = selected?.complexId ? RISK_BY_COMPLEX.get(selected.complexId) : undefined;

  /** 매물 클릭: 상세를 열고 listing_click 이벤트를 남긴다. */
  const openDeal = (row: (typeof rows)[number]) => {
    setSelectedHash(row.dealHash === selectedHash ? null : row.dealHash);
    if (row.dealHash === selectedHash) return;
    tracker.track('listing_click', {
      complexId: row.complexId ?? row.aptName,
      aptName: row.aptName,
      dealHash: row.dealHash,
      priceKrw: row.priceKrw,
      areaM2: row.areaM2,
      source: 'explore_table',
      jeonseRatioPct: row.complexId ? RISK_BY_COMPLEX.get(row.complexId)?.jeonseRatioPct : undefined,
    });
  };

  /** 관심 등록: 브라우저에 저장하고 listing_save 이벤트를 남긴다. */
  const toggleSaved = (complexId: string, aptName: string, priceKrw?: number) => {
    const isSaved = saved.includes(complexId);
    const next = isSaved ? saved.filter((id) => id !== complexId) : [...saved, complexId].slice(0, 50);
    setSaved(next);
    writeSavedComplexes(next);
    tracker.track('listing_save', {
      complexId,
      aptName,
      action: isSaved ? 'remove' : 'add',
      savedCount: next.length,
      priceKrw,
    });
    setToast(isSaved ? `${aptName}을(를) 관심에서 뺐습니다.` : `${aptName}을(를) 관심에 담았습니다. (${next.length}곳)`);
    window.setTimeout(() => setToast(null), 3000);
  };

  const exportCsv = () => {
    const header = ['계약일', '법정동', '단지명', '전용면적(㎡)', '층', '거래금액(원)', '평당가(원)', '거래유형'];
    const lines = rows.slice(0, 500).map((row) =>
      [row.dealDate, row.dong, row.aptName, row.areaM2, row.floor ?? '', row.priceKrw, row.pricePerPyeong, row.dealType].join(','),
    );
    const csv = `\uFEFF${[header.join(','), ...lines].join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `prop-data-hub-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    tracker.track('funnel_step_complete', {
      step: 'report_export',
      route: '/explore',
      detail: { rows: Math.min(rows.length, 500), format: 'csv' },
    });
    setToast(`${Math.min(rows.length, 500)}건을 CSV로 저장했습니다. (이벤트: report_export)`);
    window.setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className="space-y-4">
      <Card title="조회 조건" subtitle="조건을 바꾸면 800ms 뒤 region_filter_change 이벤트가 1건 기록됩니다.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="지역">
            <select
              className="select"
              value={legalDongCode}
              onChange={(event) => {
                setLegalDongCode(event.target.value);
                setComplexId('');
              }}
              aria-label="지역 선택"
            >
              <option value="">전체 지역</option>
              {REGION_OPTIONS.map((region) => (
                <option key={region.legalDongCode} value={region.legalDongCode}>
                  {region.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="단지">
            <select
              className="select"
              value={complexId}
              onChange={(event) => setComplexId(event.target.value)}
              aria-label="단지 선택"
            >
              <option value="">전체 단지</option>
              {complexes.map((complex) => (
                <option key={complex.complexId} value={complex.complexId}>
                  {complex.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="기간" hint={`${months}개월`}>
            <select className="select" value={months} onChange={(event) => setMonths(Number(event.target.value))} aria-label="기간 선택">
              <option value={6}>최근 6개월</option>
              <option value={12}>최근 12개월</option>
              <option value={24}>최근 24개월</option>
            </select>
          </Field>
          <Field label="정렬">
            <select
              className="select"
              value={sort}
              onChange={(event) => setSort(event.target.value as (typeof SORTS)[number]['key'])}
              aria-label="정렬 기준"
            >
              {SORTS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="면적 구간">
          {AREA_BANDS.map((band) => (
            <button
              key={band.key}
              type="button"
              className={`chip ${areaBand === band.key ? 'chip-active' : ''}`}
              onClick={() => setAreaBand(band.key)}
              aria-pressed={areaBand === band.key}
            >
              {band.label}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label="조회 결과" value={`${formatNumber(summary.count)}건`} />
        <SummaryTile label="중위 거래금액" value={formatKrwKorean(summary.medianPrice)} />
        <SummaryTile label="중위 평당가" value={formatPyeongPrice(summary.medianPpp)} />
        <SummaryTile label="중위 전용면적" value={`${summary.medianArea.toFixed(1)}㎡`} hint={formatPyeong(summary.medianArea)} />
      </div>

      <Card
        title="실거래 목록"
        subtitle={`전체 ${formatNumber(summary.count)}건 중 ${Math.min(visible, summary.count)}건 표시 · 관심 ${saved.length}곳`}
        action={
          <button type="button" className="btn" onClick={exportCsv} data-testid="export-csv" disabled={rows.length === 0}>
            CSV 저장
          </button>
        }
      >
        {selected && (
          <div className="mb-3 rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2.5" data-testid="deal-detail">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink-900">
                  {selected.aptName} · {formatDate(selected.dealDate)} 계약
                </p>
                <p className="num mt-0.5 text-[11px] text-slate-600">
                  {formatKrwKorean(selected.priceKrw)} · {formatArea(selected.areaM2)}㎡ · {selected.floor ?? '-'}층 · 평당가{' '}
                  {formatPyeongPrice(selected.pricePerPyeong)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedRisk && <RiskBadge level={selectedRisk.level}>{`전세가율 ${selectedRisk.jeonseRatioPct.toFixed(1)}%`}</RiskBadge>}
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => toggleSaved(selected.complexId ?? selected.aptName, selected.aptName, selected.priceKrw)}
                  data-testid="save-listing"
                >
                  {saved.includes(selected.complexId ?? selected.aptName) ? '관심 해제' : '관심 등록'}
                </button>
              </div>
            </div>
            {selectedRisk && selectedRisk.signals.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {selectedRisk.signals.map((signal) => (
                  <li key={signal.code} className="rounded bg-white px-2 py-1 text-[10px] text-slate-600 ring-1 ring-slate-200">
                    <span className="font-semibold text-slate-700">{signal.label}</span> · {signal.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {rows.length === 0 ? (
          <EmptyState title="조건에 맞는 거래가 없습니다" description="기간을 늘리거나 면적 구간을 '전체 면적'으로 바꿔 보세요." />
        ) : (
          <>
            <div className="scroll-thin -mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[720px] border-collapse text-sm" data-testid="transaction-table">
                <thead>
                  <tr className="table-head">
                    <th className="px-2 py-2">계약일</th>
                    <th className="px-2 py-2">단지</th>
                    <th className="px-2 py-2">법정동</th>
                    <th className="px-2 py-2 text-right">전용면적</th>
                    <th className="px-2 py-2 text-right">층</th>
                    <th className="px-2 py-2 text-right">거래금액</th>
                    <th className="px-2 py-2 text-right">평당가</th>
                    <th className="px-2 py-2">리스크</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, visible).map((row) => {
                    const anomaly = ANOMALY_BY_DEAL_HASH.get(row.dealHash);
                    const risk = row.complexId ? RISK_BY_COMPLEX.get(row.complexId) : undefined;
                    return (
                    <tr
                      key={row.dealHash}
                      className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50/70 ${selectedHash === row.dealHash ? 'bg-teal-50/50' : ''}`}
                      onClick={() => openDeal(row)}
                      data-testid={`deal-row-${row.dealHash.slice(0, 6)}`}
                    >
                      <td className="num px-2 py-2 text-xs text-slate-500">{formatDate(row.dealDate)}</td>
                      <td className="px-2 py-2">
                        <span className="text-[13px] font-medium text-slate-800">{row.aptName}</span>
                        <span className="ml-1 text-[10px] text-slate-400">{row.dealType}</span>
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-600">{row.dong}</td>
                      <td className="num px-2 py-2 text-right text-xs text-slate-600">
                        {formatArea(row.areaM2)}
                        <span className="ml-1 text-[10px] text-slate-400">({formatPyeong(row.areaM2)})</span>
                      </td>
                      <td className="num px-2 py-2 text-right text-xs text-slate-600">{row.floor ?? '-'}</td>
                      <td className="num px-2 py-2 text-right text-[13px] font-semibold text-ink-800">{formatKrwKorean(row.priceKrw)}</td>
                      <td className="num px-2 py-2 text-right text-xs text-slate-600">{formatPyeongPrice(row.pricePerPyeong)}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          {anomaly && (
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                anomaly.kind === 'sharp_drop' ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                              }`}
                              title={`단지 중위 평당가 대비 ${anomaly.deviationPct}%`}
                            >
                              {anomaly.kind === 'sharp_drop' ? '급락' : anomaly.kind === 'outlier_high' ? '고가 이상' : '저가 이상'}
                            </span>
                          )}
                          {risk && risk.level !== 'low' && <RiskBadge level={risk.level} />}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[11px] text-slate-400">금액은 원, 평당가는 전용면적 기준입니다. 해제 거래는 목록에서 제외했습니다.</p>
              {visible < rows.length && (
                <button type="button" className="btn-ghost" onClick={() => setVisible((value) => value + PAGE_SIZE)}>
                  {Math.min(PAGE_SIZE, rows.length - visible)}건 더 보기
                </button>
              )}
            </div>
          </>
        )}
      </Card>

      <DataNote>
        목록은 계약일·단지·면적·층·금액 조건으로 정렬됩니다. 실서비스에서는 이 조회가 PostgreSQL의
        (지역, 월, 금액) 복합 인덱스와 BRIN 기간 스캔을 타도록 설계했습니다. 행을 누르면 상세가 열리고
        listing_click, 관심 등록은 listing_save 이벤트로 남습니다. 리스크 배지는 단지의 전세가율·급락·이상 거래를 합산한
        점수입니다.
      </DataNote>

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-ink-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card card-pad">
      <p className="label">{label}</p>
      <p className="num mt-1 text-lg font-semibold text-ink-800">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}
