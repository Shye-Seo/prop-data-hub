import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ALERT_CHANNEL_LABEL,
  AREA_BAND_RANGES,
  DEAL_GRADE_THRESHOLDS,
  DEAL_SCORE_WEIGHTS,
  LARGE_COMPLEX_HOUSEHOLDS,
  dealGradeLabel,
  describeAlertRule,
  type AlertChannel,
  type AlertRule,
  type AreaBandKey,
} from '@prop/shared';
import { Card, DataNote, EmptyState, Field, FilterLabel, Stat, StatGrid } from '../components/ui';
import {
  formatArea,
  formatAreaWithPyeong,
  formatDate,
  formatKrwKorean,
  formatNumber,
  formatPct,
  formatPyeong,
  formatPyeongPrice,
} from '../lib/format';
import {
  DEFAULT_RADAR_UI_FILTER,
  RADAR_DISTRICTS,
  RADAR_SET,
  createRule,
  filterToRuleDraft,
  previewRule,
  radarResults,
  readAlertRules,
  writeAlertRules,
  type RadarFilterState,
  type RulePreviewResult,
} from '../lib/radar';
import { tracker } from '../lib/tracker';

const AREA_OPTIONS: Array<{ key: AreaBandKey | 'all'; label: string }> = [
  { key: 'all', label: '전체 면적' },
  ...(Object.entries(AREA_BAND_RANGES) as Array<[AreaBandKey, { label: string }]>).map(([key, value]) => ({
    key,
    label: value.label,
  })),
];

const DISCOUNT_OPTIONS = [4, 8, 10, 12, 15];
const SCORE_OPTIONS = [
  { value: 0, label: '점수 무관' },
  { value: DEAL_GRADE_THRESHOLDS.watch, label: `${DEAL_GRADE_THRESHOLDS.watch}점 이상(관찰)` },
  { value: DEAL_GRADE_THRESHOLDS.good, label: `${DEAL_GRADE_THRESHOLDS.good}점 이상(검토)` },
  { value: DEAL_GRADE_THRESHOLDS.strong, label: `${DEAL_GRADE_THRESHOLDS.strong}점 이상(적극)` },
];

const GRADE_DOT: Record<string, string> = {
  strong: 'bg-emerald-500',
  good: 'bg-sky-500',
  watch: 'bg-amber-500',
  marginal: 'bg-slate-400',
};

export default function Radar() {
  const [filter, setFilter] = useState<RadarFilterState>(DEFAULT_RADAR_UI_FILTER);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [channels, setChannels] = useState<AlertChannel[]>(['kakao_alimtalk']);
  const [rules, setRules] = useState<AlertRule[]>(() => (typeof window === 'undefined' ? [] : readAlertRules()));
  const [saved, setSaved] = useState<RulePreviewResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const initial = useRef(true);

  const { deals, summary } = useMemo(() => radarResults(filter), [filter]);
  const selected = selectedHash ? deals.find((deal) => deal.dealHash === selectedHash) : undefined;

  const draft = useMemo(() => filterToRuleDraft(filter, ruleName), [filter, ruleName]);
  const draftRuleText = useMemo(
    () => describeAlertRule({ ...draft, ruleId: 'preview', minScore: draft.minScore, createdAt: '' }),
    [draft],
  );

  // 조건이 바뀌면 800ms 뒤 radar_filter_change 이벤트를 남긴다(탐색 화면과 같은 규칙).
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      tracker.track('radar_filter_change', {
        lawdCds: draft.lawdCds,
        minHouseholds: draft.minHouseholds,
        largeComplexOnly: filter.largeComplexOnly,
        areaBand: filter.areaBand,
        maxDiscountPct: filter.maxDiscountPct,
        minScore: filter.minScore,
        resultCount: deals.length,
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draft.lawdCds.join(','), draft.minHouseholds, filter.areaBand, filter.maxDiscountPct, filter.minScore, deals.length]);

  const toggleDistrict = (lawdCd: string) => {
    setFilter((current) => ({
      ...current,
      lawdCds: current.lawdCds.includes(lawdCd)
        ? current.lawdCds.filter((code) => code !== lawdCd)
        : [...current.lawdCds, lawdCd],
    }));
    setSelectedHash(null);
  };

  const openDeal = (deal: (typeof deals)[number]) => {
    setSelectedHash(deal.dealHash === selectedHash ? null : deal.dealHash);
    if (deal.dealHash === selectedHash) return;
    tracker.track('listing_click', {
      complexId: deal.complexId,
      aptName: deal.complexName,
      dealHash: deal.dealHash,
      priceKrw: deal.priceKrw,
      areaM2: deal.areaM2,
      source: 'radar',
      jeonseRatioPct: deal.jeonseRatioPct ?? undefined,
      dealScore: deal.dealScore,
    });
  };

  const saveRule = () => {
    if (channels.length === 0) {
      setToast('알림 채널을 하나 이상 선택해야 합니다.');
      window.setTimeout(() => setToast(null), 3000);
      return;
    }
    const rule = createRule({ ...draft, channels });
    const result = previewRule(rule);
    const next = [rule, ...rules.filter((row) => row.ruleId !== rule.ruleId)].slice(0, 20);
    setRules(next);
    writeAlertRules(next);
    setSaved(result);

    tracker.track('alert_rule_create', {
      ruleId: rule.ruleId,
      lawdCds: rule.lawdCds,
      minHouseholds: rule.minHouseholds,
      areaBand: rule.areaBand,
      maxDiscountPct: rule.maxDiscountPct,
      minScore: rule.minScore,
      channels: rule.channels,
      matchedCount: result.preview.matchedCount,
      source: 'radar_builder',
    });
    setToast(`알림 규칙을 저장했습니다. 지금 조건에 ${result.preview.matchedCount}건이 걸립니다.`);
    window.setTimeout(() => setToast(null), 4000);
  };

  const removeRule = (ruleId: string) => {
    const next = rules.filter((row) => row.ruleId !== ruleId);
    setRules(next);
    writeAlertRules(next);
    if (saved?.rule.ruleId === ruleId) setSaved(null);
  };

  const reapplyRule = (rule: AlertRule) => {
    setFilter({
      lawdCds: rule.lawdCds,
      largeComplexOnly: rule.minHouseholds > 0,
      areaBand: rule.areaBand,
      maxDiscountPct: rule.maxDiscountPct,
      minScore: rule.minScore,
    });
    setSaved(previewRule(rule));
  };

  return (
    <div className="space-y-4">
      <Card
        title="레이더 조건"
        subtitle={`세대수 ${LARGE_COMPLEX_HOUSEHOLDS}세대 이상 · 최근 6개월 동일 단지·면적 중위가 대비 할인율`}
        action={
          <span className="num text-[10.5px] text-ink-300">
            기준월 {RADAR_SET.asOfMonth} · 후보 {formatNumber(RADAR_SET.universe.scannedDeals)}건 · 대단지 {RADAR_SET.universe.largeComplexes}곳
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1" role="group" aria-label="구 선택">
          <FilterLabel>구</FilterLabel>
          <button
            type="button"
            className={`chip ${filter.lawdCds.length === 0 ? 'chip-active' : ''}`}
            aria-pressed={filter.lawdCds.length === 0}
            onClick={() => setFilter((current) => ({ ...current, lawdCds: [] }))}
          >
            전체 6개 구
          </button>
          {RADAR_DISTRICTS.map((row) => (
            <button
              key={row.lawdCd}
              type="button"
              className={`chip ${filter.lawdCds.includes(row.lawdCd) ? 'chip-active' : ''}`}
              aria-pressed={filter.lawdCds.includes(row.lawdCd)}
              onClick={() => toggleDistrict(row.lawdCd)}
              data-testid={`radar-district-${row.lawdCd}`}
            >
              {row.sigungu}
              <span className="chip-count">{row.largeComplexCount}곳</span>
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-3 border-t border-line-soft pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="세대수">
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-2.5">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-accent"
                checked={filter.largeComplexOnly}
                onChange={(event) => setFilter((current) => ({ ...current, largeComplexOnly: event.target.checked }))}
                data-testid="radar-large-only"
                aria-label="350세대 이상만 보기"
              />
              <span className="text-[12px] text-ink-700">{LARGE_COMPLEX_HOUSEHOLDS}세대 이상만</span>
            </label>
          </Field>

          <Field label="목표 할인율">
            <select
              className="select"
              value={filter.maxDiscountPct}
              onChange={(event) => setFilter((current) => ({ ...current, maxDiscountPct: Number(event.target.value) }))}
              aria-label="목표 할인율"
            >
              {DISCOUNT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  중위가 대비 -{value}% 이하
                </option>
              ))}
            </select>
          </Field>

          <Field label="최소 점수">
            <select
              className="select"
              value={filter.minScore}
              onChange={(event) => setFilter((current) => ({ ...current, minScore: Number(event.target.value) }))}
              aria-label="최소 점수"
            >
              {SCORE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="평형대">
            <select
              className="select"
              value={filter.areaBand}
              onChange={(event) =>
                setFilter((current) => ({ ...current, areaBand: event.target.value as AreaBandKey | 'all' }))
              }
              aria-label="평형대"
            >
              {AREA_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <StatGrid>
        <Stat label="매칭 매물" value={`${formatNumber(summary.count)}건`} hint={`대상 단지 ${summary.complexCount}곳`} testId="radar-count" />
        <Stat label="최대 할인" value={summary.count === 0 ? '-' : formatPct(summary.maxDiscountPct)} hint={`중위 ${formatPct(summary.medianDiscountPct)}`} tone={summary.count === 0 ? 'default' : 'accent'} />
        <Stat label="중위 점수" value={summary.count === 0 ? '-' : `${summary.medianScore}점`} hint={`적극 검토 ${summary.strongCount}건`} />
        <Stat
          label="대상 단지 세대 합계"
          value={`${formatNumber(summary.totalHouseholds)}세대`}
          hint={summary.medianGapKrw > 0 ? `갭 중위 ${formatKrwKorean(summary.medianGapKrw)}` : '갭 계산 표본 없음'}
        />
      </StatGrid>

      <Card
        title="급매·저평가 매물"
        subtitle={`점수 = 할인율 45 + 전세가율 20 + 3개월 거래량 15 + 단지 규모 20 (100점 만점) · 표본 3건 미만 단지·면적은 제외`}
        action={
          <span className="flex flex-wrap items-center gap-3 text-[10.5px] text-ink-400">
            {(['strong', 'good', 'watch'] as const).map((grade) => (
              <span key={grade} className="inline-flex items-center gap-1.5">
                <span className={`dot ${GRADE_DOT[grade]}`} aria-hidden="true" />
                {dealGradeLabel(grade)}
              </span>
            ))}
          </span>
        }
      >
        {deals.length === 0 ? (
          <EmptyState
            title="조건에 맞는 매물이 없습니다"
            description="할인율 기준을 낮추거나 세대수 조건을 끄고 범위를 넓혀 보세요."
          />
        ) : (
          <>
            {selected && (
              <div className="mb-3 rounded-md border border-line bg-canvas/70 px-3 py-2.5" data-testid="radar-detail">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[12.5px] font-semibold text-ink-900">
                      {selected.complexName} · {formatDate(selected.dealDate)} 계약
                    </p>
                    <p className="num mt-0.5 text-[11px] text-ink-500">
                      {formatKrwKorean(selected.priceKrw)} · {formatAreaWithPyeong(selected.areaM2)} · {selected.floor ?? '-'}층 · 평당가{' '}
                      {formatPyeongPrice(selected.pricePerPyeong)} · {selected.dealType}
                    </p>
                  </div>
                  <span className="status">
                    <span className={`dot ${GRADE_DOT[selected.grade] ?? 'bg-slate-400'}`} aria-hidden="true" />
                    {dealGradeLabel(selected.grade)} · {selected.dealScore}점
                  </span>
                </div>
                <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line-soft pt-2.5 text-[11px] sm:grid-cols-4">
                  <div>
                    <dt className="text-ink-400">기준 시세(중위)</dt>
                    <dd className="num mt-0.5 text-[12px] font-semibold text-ink-800">{formatKrwKorean(selected.medianPriceKrw)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">기준 표본</dt>
                    <dd className="num mt-0.5 text-[12px] font-semibold text-ink-800">{selected.referenceSamples}건</dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">전세가율 · 갭</dt>
                    <dd className="num mt-0.5 text-[12px] font-semibold text-ink-800">
                      {selected.jeonseRatioPct === null ? '표본 없음' : `${selected.jeonseRatioPct.toFixed(1)}%`}
                      {selected.gapKrw !== null ? ` · ${formatKrwKorean(selected.gapKrw)}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">최근 3개월 거래</dt>
                    <dd className="num mt-0.5 text-[12px] font-semibold text-ink-800">{selected.volume3m}건</dd>
                  </div>
                </dl>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {selected.signals.map((signal) => (
                    <li key={signal.code} className="text-[10.5px] text-ink-500">
                      <span className="font-medium text-ink-700">
                        {signal.label} {signal.points > 0 ? `+${signal.points}` : ''}
                      </span>{' '}
                      · {signal.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="scroll-thin -mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[860px] border-collapse text-sm" data-testid="radar-table">
                <thead>
                  <tr className="table-head">
                    <th className="px-2 py-[7px]">단지</th>
                    <th className="px-2 py-[7px]">구·동</th>
                    <th className="px-2 py-[7px] text-right">면적(㎡·평)</th>
                    <th className="px-2 py-[7px]">계약일</th>
                    <th className="px-2 py-[7px] text-right">거래가</th>
                    <th className="px-2 py-[7px] text-right">중위가 대비</th>
                    <th className="px-2 py-[7px] text-right">전세가율</th>
                    <th className="px-2 py-[7px] text-right">3개월</th>
                    <th className="px-2 py-[7px] text-right">점수</th>
                  </tr>
                </thead>
                <tbody>
                  {deals.map((deal) => (
                    <tr
                      key={deal.dealHash}
                      className={`cursor-pointer border-b border-line-soft transition-colors last:border-0 hover:bg-canvas ${
                        selectedHash === deal.dealHash ? 'bg-canvas' : ''
                      }`}
                      onClick={() => openDeal(deal)}
                      data-testid={`radar-row-${deal.dealHash.slice(0, 6)}`}
                    >
                      <td className="px-2 py-[7px]">
                        <span className="text-[12.5px] font-medium text-ink-800">{deal.complexName}</span>
                        <span className="ml-1.5 text-[10px] text-ink-300">{formatNumber(deal.households)}세대</span>
                      </td>
                      <td className="px-2 py-[7px] text-[11.5px] text-ink-500">
                        {deal.sigungu} {deal.dong}
                      </td>
                      <td className="num px-2 py-[7px] text-right text-[11.5px] text-ink-500">
                        {formatArea(deal.areaM2)} <span className="text-[10px] text-ink-300">({formatPyeong(deal.areaM2)})</span>
                      </td>
                      <td className="num px-2 py-[7px] text-[11.5px] text-ink-400">{formatDate(deal.dealDate)}</td>
                      <td className="num px-2 py-[7px] text-right text-[12.5px] font-semibold text-ink-900">
                        {formatKrwKorean(deal.priceKrw)}
                      </td>
                      <td className="num px-2 py-[7px] text-right text-[12.5px] font-semibold text-accent">{formatPct(deal.discountPct)}</td>
                      <td className="num px-2 py-[7px] text-right text-[11.5px] text-ink-500">
                        {deal.jeonseRatioPct === null ? '-' : `${deal.jeonseRatioPct.toFixed(1)}%`}
                      </td>
                      <td className="num px-2 py-[7px] text-right text-[11.5px] text-ink-500">{deal.volume3m}건</td>
                      <td className="px-2 py-[7px] text-right">
                        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-800">
                          <span className={`dot ${GRADE_DOT[deal.grade] ?? 'bg-slate-400'}`} aria-hidden="true" />
                          {deal.dealScore}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10.5px] text-ink-300">행을 누르면 기준 시세·갭·점수 근거가 열립니다.</p>
          </>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
        <Card title="맞춤 알림 규칙" subtitle="현재 조건을 저장하고 알림 문구를 미리 봅니다">
          <div className="space-y-3">
            <Field label="규칙 이름">
              <input
                className="select"
                value={ruleName}
                placeholder={draft.name}
                onChange={(event) => setRuleName(event.target.value)}
                maxLength={60}
                aria-label="알림 규칙 이름"
                data-testid="radar-rule-name"
              />
            </Field>

            <div>
              <p className="mb-1.5 text-[11.5px] font-medium text-ink-600">알림 채널</p>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(ALERT_CHANNEL_LABEL) as AlertChannel[]).map((channel) => {
                  const active = channels.includes(channel);
                  return (
                    <button
                      key={channel}
                      type="button"
                      className={`chip ${active ? 'chip-active' : ''}`}
                      aria-pressed={active}
                      onClick={() =>
                        setChannels((current) =>
                          current.includes(channel) ? current.filter((row) => row !== channel) : [...current, channel],
                        )
                      }
                    >
                      {ALERT_CHANNEL_LABEL[channel]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-line-soft pt-3">
              <p className="label">저장될 조건</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-700" data-testid="radar-rule-condition">
                {draftRuleText}
              </p>
              <p className="num mt-1 text-[10.5px] text-ink-400">현재 조건 매칭 {summary.count}건</p>
            </div>

            <button type="button" className="btn w-full" onClick={saveRule} data-testid="radar-save-rule">
              알림 규칙 저장 · 미리보기
            </button>

            {saved && (
              <div className="space-y-2 rounded-md border border-line px-3 py-2.5" data-testid="radar-preview">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[12px] font-semibold text-ink-900">알림 미리보기</p>
                  <span className="num text-[10px] text-ink-400">
                    {saved.preview.channels.join(' · ')} · 매칭 {saved.preview.matchedCount}건
                  </span>
                </div>
                <div className="rounded-md bg-[#fee500] px-3 py-2 text-[11px] leading-relaxed text-[#3c1e1e]">
                  <pre className="whitespace-pre-wrap font-sans">{saved.preview.kakao.message}</pre>
                  <p className="mt-1 border-t border-black/10 pt-1 text-[10px] text-[#3c1e1e]/70">
                    {saved.preview.kakao.provider} · 템플릿 {saved.preview.kakao.templateCode}
                  </p>
                </div>
                <details className="border-t border-line-soft pt-2 text-[10px] text-ink-500">
                  <summary className="cursor-pointer font-medium text-ink-600">웹훅 payload</summary>
                  <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-ink-500">
                    {JSON.stringify(saved.preview.webhook, null, 2)}
                  </pre>
                </details>
                <p className="text-[10px] leading-relaxed text-ink-400">{saved.preview.note}</p>
              </div>
            )}
          </div>
        </Card>

        <Card title="저장한 규칙" subtitle="이 브라우저에 보관됩니다">
          {rules.length === 0 ? (
            <EmptyState title="저장한 규칙이 없습니다" description="조건을 정하고 '알림 규칙 저장'을 누르면 여기에 쌓입니다." />
          ) : (
            <ul className="divide-y divide-line-soft" data-testid="radar-rule-list">
              {rules.map((rule) => {
                const matched = radarResults({
                  lawdCds: rule.lawdCds,
                  largeComplexOnly: rule.minHouseholds > 0,
                  areaBand: rule.areaBand,
                  maxDiscountPct: rule.maxDiscountPct,
                  minScore: rule.minScore,
                }).summary.count;
                return (
                  <li key={rule.ruleId} className="flex flex-wrap items-start justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-ink-800">{rule.name}</p>
                      <p className="mt-0.5 text-[11px] text-ink-500">{describeAlertRule(rule)}</p>
                      <p className="num mt-0.5 text-[10px] text-ink-400">
                        {rule.channels.map((channel) => ALERT_CHANNEL_LABEL[channel]).join(' · ')} · 현재 {matched}건 · {rule.createdAt.slice(0, 10)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" className="btn-ghost" onClick={() => reapplyRule(rule)}>
                        조건 적용
                      </button>
                      <button type="button" className="btn-ghost text-rose-700" onClick={() => removeRule(rule.ruleId)}>
                        삭제
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <details className="card group">
        <summary className="card-head cursor-pointer items-center">
          <div>
            <h2 className="card-title">점수 구성</h2>
            <p className="card-sub">할인율 45 · 전세가율 20 · 3개월 거래량 15 · 단지 규모 20</p>
          </div>
          <span aria-hidden="true" className="text-[11px] text-ink-300 transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="card-pad">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <WeightCard
              title="할인율"
              hint="기준 시세(최근 6개월 중위가) 대비"
              bands={DEAL_SCORE_WEIGHTS.discount.map((band) => ({ label: band.label, points: band.points }))}
            />
            <WeightCard
              title="전세가율"
              hint="낮을수록 갭 부담이 작다"
              bands={DEAL_SCORE_WEIGHTS.jeonse.map((band) => ({ label: band.label, points: band.points }))}
            />
            <WeightCard
              title="3개월 거래량"
              hint="같은 단지·면적 표본"
              bands={DEAL_SCORE_WEIGHTS.liquidity.map((band) => ({ label: band.label, points: band.points }))}
            />
            <WeightCard
              title="단지 규모"
              hint="350세대 이상 가중치"
              bands={DEAL_SCORE_WEIGHTS.scale.map((band) => ({ label: band.label, points: band.points }))}
            />
          </div>
          <DataNote>
            기준 시세는 같은 단지·같은 면적 구간(60·85·115㎡ = 18·26·35평 경계)의 최근 6개월 중위 매매가에서 해당 거래를 제외해 계산합니다.
            표본이 3건 미만이면 그 매물은 목록에서 빠지고, 전세 표본이 없으면 갭 항목은 0점 처리됩니다. 감정평가가 아니라
            계약 전 확인 지표이므로 호가·수리 상태·층·향은 별도로 확인해야 합니다.
          </DataNote>
        </div>
      </details>

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-md bg-ink-900 px-3.5 py-2 text-[11.5px] font-medium text-white shadow-pop">
          {toast}
        </div>
      )}
    </div>
  );
}

function WeightCard({ title, hint, bands }: { title: string; hint: string; bands: Array<{ label: string; points: number }> }) {
  return (
    <div>
      <p className="text-[12px] font-semibold text-ink-800">{title}</p>
      <p className="mt-0.5 text-[10px] text-ink-400">{hint}</p>
      <ul className="num mt-1.5 space-y-0.5 border-t border-line-soft pt-1.5 text-[10.5px] text-ink-500">
        {bands.map((band) => (
          <li key={band.label} className="flex justify-between gap-2">
            <span className="truncate">{band.label}</span>
            <span className="font-medium text-ink-700">{band.points}점</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
