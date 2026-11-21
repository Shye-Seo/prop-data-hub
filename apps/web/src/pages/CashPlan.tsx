import { useEffect, useMemo, useRef, useState } from 'react';
import { calculateCashPlan, type RepaymentType } from '@prop/shared';
import { Card, DataNote, Field } from '../components/ui';
import { latestMacro } from '../lib/dataset';
import { formatAreaWithPyeong, formatKrwKorean, formatMonth } from '../lib/format';
import {
  COMPLEX_OPTIONS,
  areaOptionsForComplex,
  complexOption,
  defaultAreaOption,
  saleReference,
} from '../lib/tools';
import { tracker } from '../lib/tracker';

const DEFAULT_COMPLEX_ID = COMPLEX_OPTIONS[0]?.complexId ?? '';
const DEFAULT_AREA = defaultAreaOption(DEFAULT_COMPLEX_ID);
const DEFAULT_REFERENCE = DEFAULT_AREA ? saleReference(DEFAULT_COMPLEX_ID, DEFAULT_AREA.band) : null;
const DEFAULT_PRICE_MANWON = DEFAULT_REFERENCE ? String(Math.round(DEFAULT_REFERENCE.medianPriceKrw / 10_000)) : '60000';

const REPAYMENTS: Array<{ key: RepaymentType; label: string; hint: string }> = [
  { key: 'equal_principal_interest', label: '원리금균등', hint: '매월 같은 금액' },
  { key: 'equal_principal', label: '원금균등', hint: '초반 부담 큼' },
  { key: 'interest_only', label: '이자만', hint: '만기 일시상환' },
];

const TERM_OPTIONS = [10, 15, 20, 30, 35, 40];

export default function CashPlan() {
  const mortgageRate = latestMacro('mortgage_rate')?.value ?? 4.1;

  const [complexId, setComplexId] = useState(DEFAULT_COMPLEX_ID);
  const [band, setBand] = useState(DEFAULT_AREA?.band ?? '60to85');
  const [customPrice, setCustomPrice] = useState(false);
  const [priceManwon, setPriceManwon] = useState(DEFAULT_PRICE_MANWON);
  const [incomeManwon, setIncomeManwon] = useState('6000');
  const [existingDebtManwon, setExistingDebtManwon] = useState('0');
  const [ltvPct, setLtvPct] = useState(70);
  const [dsrPct, setDsrPct] = useState(40);
  const [rate, setRate] = useState(mortgageRate);
  const [stressRate, setStressRate] = useState(0);
  const [termYears, setTermYears] = useState(40);
  const [repayment, setRepayment] = useState<RepaymentType>('equal_principal_interest');
  const [firstTimeBuyer, setFirstTimeBuyer] = useState(false);
  const [brokerageVat, setBrokerageVat] = useState(true);
  const [otherManwon, setOtherManwon] = useState('0');
  const initial = useRef(true);

  const complex = complexOption(complexId);
  const areaOptions = useMemo(() => areaOptionsForComplex(complexId), [complexId]);
  const area = areaOptions.find((row) => row.band === band) ?? areaOptions[0];
  const reference = area ? saleReference(complexId, area.band) : null;
  const priceKrw = Number(priceManwon.replace(/[^0-9]/g, '')) * 10_000;
  const annualIncomeKrw = Number(incomeManwon.replace(/[^0-9]/g, '')) * 10_000;
  const existingAnnualDebtServiceKrw = Number(existingDebtManwon.replace(/[^0-9]/g, '')) * 10_000;
  const otherCostsKrw = Number(otherManwon.replace(/[^0-9]/g, '')) * 10_000;

  const plan = useMemo(
    () =>
      calculateCashPlan({
        priceKrw,
        areaM2: area?.areaM2 ?? complex?.representativeAreaM2 ?? 84.9,
        annualIncomeKrw,
        existingAnnualDebtServiceKrw,
        ltvPct,
        dsrPct,
        annualRatePct: rate,
        stressRatePct: stressRate,
        termMonths: termYears * 12,
        repayment,
        firstTimeBuyer,
        brokerageVat,
        otherCostsKrw,
      }),
    [
      priceKrw,
      area?.areaM2,
      complex?.representativeAreaM2,
      annualIncomeKrw,
      existingAnnualDebtServiceKrw,
      ltvPct,
      dsrPct,
      rate,
      stressRate,
      termYears,
      repayment,
      firstTimeBuyer,
      brokerageVat,
      otherCostsKrw,
    ],
  );

  const changeComplex = (nextId: string) => {
    setComplexId(nextId);
    const nextArea = defaultAreaOption(nextId);
    if (!nextArea) return;
    setBand(nextArea.band);
    if (!customPrice) {
      const nextReference = saleReference(nextId, nextArea.band);
      if (nextReference) setPriceManwon(String(Math.round(nextReference.medianPriceKrw / 10_000)));
    }
  };

  const changeBand = (nextBand: typeof band) => {
    setBand(nextBand);
    if (!customPrice) {
      const nextReference = saleReference(complexId, nextBand);
      if (nextReference) setPriceManwon(String(Math.round(nextReference.medianPriceKrw / 10_000)));
    }
  };

  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    if (priceKrw <= 0) return;
    const timer = window.setTimeout(() => {
      tracker.track('cash_plan_calculate', {
        complexId: complexId || undefined,
        priceKrw,
        loanKrw: plan.loanKrw,
        cashNeededKrw: plan.cashNeededKrw,
        annualIncomeKrw,
        firstTimeBuyer,
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [priceKrw, plan.loanKrw, plan.cashNeededKrw, annualIncomeKrw, firstTimeBuyer, complexId]);

  const breakdownPoints = plan.breakdown.filter((row) => row.amountKrw > 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Card title="매매·대출 조건" subtitle="단지·면적을 고르면 최근 6개월 중위 매매가를 채웁니다.">
          <div className="space-y-3.5">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">단지</span>
              <select
                className="select"
                value={complexId}
                onChange={(event) => changeComplex(event.target.value)}
                aria-label="계산할 단지"
                data-testid="cash-complex"
              >
                {COMPLEX_OPTIONS.map((option) => (
                  <option key={option.complexId} value={option.complexId}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-600">
                전용면적 구간
                {area && <span className="num text-[11px] text-slate-400">{formatAreaWithPyeong(area.areaM2)}</span>}
              </span>
              <select
                className="select"
                value={band}
                onChange={(event) => changeBand(event.target.value as typeof band)}
                aria-label="전용면적 구간"
              >
                {areaOptions.map((option) => (
                  <option key={option.band} value={option.band}>
                    {option.label} · {formatAreaWithPyeong(option.areaM2)}
                  </option>
                ))}
              </select>
            </label>

            <Field label="매매가" hint={formatKrwKorean(priceKrw)}>
              <input
                type="number"
                className="select num"
                min={0}
                step={100}
                value={priceManwon}
                onChange={(event) => {
                  setCustomPrice(true);
                  setPriceManwon(event.target.value);
                }}
                aria-label="매매가(만원)"
                data-testid="cash-price"
              />
            </Field>
            <p className="-mt-2 flex flex-wrap items-center gap-2 text-[10px] leading-relaxed text-slate-400">
              <span>
                {customPrice
                  ? '직접 입력값을 쓰고 있습니다. 단지를 바꿔도 매매가는 유지됩니다.'
                  : reference
                    ? `최근 6개월 중위 ${formatKrwKorean(reference.medianPriceKrw)} · ${reference.sampleCount}건 · ${formatMonth(reference.latestMonth)}`
                    : '최근 6개월 표본이 없어 직접 입력이 필요합니다.'}
              </span>
              {customPrice && reference && (
                <button
                  type="button"
                  className="underline decoration-dotted text-teal-700"
                  onClick={() => {
                    setCustomPrice(false);
                    setPriceManwon(String(Math.round(reference.medianPriceKrw / 10_000)));
                  }}
                >
                  시세 자동으로
                </button>
              )}
            </p>

            <Field label="연소득" hint={formatKrwKorean(annualIncomeKrw)}>
              <input
                type="number"
                className="select num"
                min={0}
                step={100}
                value={incomeManwon}
                onChange={(event) => setIncomeManwon(event.target.value)}
                aria-label="연소득(만원)"
                data-testid="cash-income"
              />
            </Field>
            <Field label="기존 대출 연 원리금" hint={formatKrwKorean(existingAnnualDebtServiceKrw)}>
              <input
                type="number"
                className="select num"
                min={0}
                step={100}
                value={existingDebtManwon}
                onChange={(event) => setExistingDebtManwon(event.target.value)}
                aria-label="기존 대출 연 원리금(만원)"
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="LTV 상한" hint={`${ltvPct}%`}>
                <input
                  type="number"
                  className="select num"
                  min={0}
                  max={100}
                  step={5}
                  value={ltvPct}
                  onChange={(event) => setLtvPct(Math.min(100, Math.max(0, Number(event.target.value))))}
                  aria-label="LTV 상한"
                  data-testid="cash-ltv"
                />
              </Field>
              <Field label="DSR 상한" hint={`${dsrPct}%`}>
                <input
                  type="number"
                  className="select num"
                  min={0}
                  max={100}
                  step={5}
                  value={dsrPct}
                  onChange={(event) => setDsrPct(Math.min(100, Math.max(0, Number(event.target.value))))}
                  aria-label="DSR 상한"
                  data-testid="cash-dsr"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="대출 금리" hint={`${rate.toFixed(2)}%`}>
                <input
                  type="number"
                  className="select num"
                  min={0}
                  max={20}
                  step={0.1}
                  value={rate}
                  onChange={(event) => setRate(Math.max(0, Number(event.target.value)))}
                  aria-label="대출 금리"
                />
              </Field>
              <Field label="스트레스 가산" hint={`${stressRate.toFixed(2)}%p`}>
                <input
                  type="number"
                  className="select num"
                  min={0}
                  max={5}
                  step={0.25}
                  value={stressRate}
                  onChange={(event) => setStressRate(Math.max(0, Number(event.target.value)))}
                  aria-label="스트레스 가산금리"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="상환 기간" hint={`${termYears}년`}>
                <select
                  className="select"
                  value={termYears}
                  onChange={(event) => setTermYears(Number(event.target.value))}
                  aria-label="상환 기간"
                >
                  {TERM_OPTIONS.map((years) => (
                    <option key={years} value={years}>
                      {years}년
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="상환 방식" hint={REPAYMENTS.find((row) => row.key === repayment)?.hint}>
                <select
                  className="select"
                  value={repayment}
                  onChange={(event) => setRepayment(event.target.value as RepaymentType)}
                  aria-label="상환 방식"
                >
                  {REPAYMENTS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="space-y-1.5 rounded-lg bg-slate-50 px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-teal-600"
                  checked={firstTimeBuyer}
                  onChange={(event) => setFirstTimeBuyer(event.target.checked)}
                  data-testid="cash-first-time"
                />
                생애최초 주택 구입(취득세 200만원 한도 감면)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-teal-600"
                  checked={brokerageVat}
                  onChange={(event) => setBrokerageVat(event.target.checked)}
                />
                중개보수 부가세 10% 포함
              </label>
            </div>

            <Field label="기타 비용(등기·이사 등)" hint={formatKrwKorean(otherCostsKrw)}>
              <input
                type="number"
                className="select num"
                min={0}
                step={10}
                value={otherManwon}
                onChange={(event) => setOtherManwon(event.target.value)}
                aria-label="기타 비용(만원)"
              />
            </Field>
          </div>
        </Card>

        <div className="space-y-4">
          <section className="card border border-teal-500/40 ring-1 ring-teal-500/20" data-testid="cash-result">
            <div className="card-pad">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="label">입주에 필요한 자기자본(현금)</p>
                  <p className="num mt-1 text-3xl font-semibold tracking-tight text-teal-700">{formatKrwKorean(plan.cashNeededKrw)}</p>
                  <p className="mt-1 text-[12px] text-slate-500">
                    매매가의 <span className="num font-semibold text-slate-700">{plan.cashRatioPct.toFixed(1)}%</span> · 매매가 {formatKrwKorean(plan.priceKrw)}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-right">
                  <p className="label">대출 한도</p>
                  <p className="num text-lg font-semibold text-ink-800">{formatKrwKorean(plan.loanKrw)}</p>
                  <p className="text-[10px] text-slate-400">
                    {plan.loan.binding === 'ltv' ? `LTV ${plan.loan.ltvPct}% 제약` : plan.loan.binding === 'dsr' ? `DSR ${plan.loan.dsrPct}% 제약` : '대출 불가'}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile label="자기자본" value={formatKrwKorean(plan.equityKrw)} hint={`매매가 − 대출 ${formatKrwKorean(plan.loanKrw)}`} />
                <Tile label="취득세 합계" value={formatKrwKorean(plan.acquisitionTax.totalKrw)} hint={`취득세율 ${plan.acquisitionTax.ratePct}%`} />
                <Tile label="중개보수" value={formatKrwKorean(plan.brokerage.totalKrw)} hint={`상한 ${plan.brokerage.ratePct}%${plan.brokerage.vatKrw > 0 ? ' · 부가세 포함' : ''}`} />
                <Tile label="월 상환액" value={formatKrwKorean(plan.loan.monthlyPaymentKrw)} hint={`${termYears}년 ${REPAYMENTS.find((row) => row.key === repayment)?.label}`} />
              </div>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <Card title="필요 현금 구성" subtitle="자기자본 + 취득세 + 중개보수 + 기타 비용">
              {breakdownPoints.length > 0 ? (
                <CashComposition rows={breakdownPoints} totalKrw={plan.cashNeededKrw} />
              ) : (
                <p className="py-8 text-center text-sm text-slate-400">매매가를 입력하면 구성이 표시됩니다.</p>
              )}
            </Card>

            <Card title="계산 내역" subtitle="원 단위 반올림 · 부가세·감면 반영">
              <dl className="divide-y divide-slate-100 text-[12px]">
                {plan.breakdown.map((row) => (
                  <div key={row.key} className="flex items-start justify-between gap-3 py-2">
                    <dt className="text-slate-600">
                      <span className="font-medium text-slate-700">{row.label}</span>
                      <span className="mt-0.5 block text-[10px] text-slate-400">{row.note}</span>
                    </dt>
                    <dd className="num shrink-0 font-semibold text-slate-800">{formatKrwKorean(row.amountKrw)}</dd>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-3 py-2.5">
                  <dt className="font-semibold text-ink-900">필요 현금 합계</dt>
                  <dd className="num text-base font-semibold text-teal-700">{formatKrwKorean(plan.cashNeededKrw)}</dd>
                </div>
              </dl>
              <div className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500">
                취득세 본세 {formatKrwKorean(plan.acquisitionTax.acquisitionTaxKrw)} · 지방교육세 {formatKrwKorean(plan.acquisitionTax.localEducationTaxKrw)}
                {plan.acquisitionTax.ruralSpecialTaxKrw > 0 ? ` · 농특세 ${formatKrwKorean(plan.acquisitionTax.ruralSpecialTaxKrw)}` : ''}
                {plan.acquisitionTax.reductionKrw > 0 ? ` · 감면 −${formatKrwKorean(plan.acquisitionTax.reductionKrw)}` : ''}
              </div>
            </Card>
          </div>

          <Card title="대출 한도 계산" subtitle="LTV 한도와 DSR 한도 중 작은 값을 씁니다">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="LTV 한도" value={formatKrwKorean(plan.loan.ltvLimitKrw)} hint={`매매가 × ${plan.loan.ltvPct}%`} />
              <Tile label="DSR 한도" value={formatKrwKorean(plan.loan.dsrLimitKrw)} hint={`연소득 × ${plan.loan.dsrPct}% − 기존 대출`} />
              <Tile label="적용 금리" value={`${plan.loan.appliedRatePct.toFixed(2)}%`} hint={`기본 ${rate.toFixed(2)}% + 스트레스 ${stressRate.toFixed(2)}%p`} />
              <Tile label="필요 연소득" value={formatKrwKorean(plan.loan.requiredAnnualIncomeKrw)} hint="이 대출을 유지하려면" />
            </div>
            <ul className="mt-3 space-y-1">
              {plan.notes.map((note) => (
                <li key={note} className="rounded bg-slate-50 px-3 py-1.5 text-[10px] leading-relaxed text-slate-500">
                  {note}
                </li>
              ))}
            </ul>
          </Card>

          <DataNote>
            취득세는 지방세법 제11조①8호(6억 이하 1%, 6~9억 누진, 9억 초과 3%)와 지방교육세(취득세의 10%),
            전용 85㎡ 초과 농어촌특별세 0.2%를 반영합니다. 생애최초 감면은 지방세특례제한법 제36조의3에 따라
            취득당시가액 12억원 이하 주택의 취득세를 200만원 한도로 줄입니다(2028.12.31까지). 중개보수는 공인중개사법
            시행규칙 별표1의 한쪽 상한요율이며 협의로 낮출 수 있습니다. 대출 한도는 LTV·DSR만 본 참고값으로, 실제 심사에서는
            기존 신용대출·카드론·전세대출과 스트레스 DSR, 금융기관 우대금리가 함께 반영됩니다.
          </DataNote>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2">
      <p className="label">{label}</p>
      <p className="num mt-0.5 text-base font-semibold text-ink-800">{value}</p>
      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{hint}</p>
    </div>
  );
}

const COMPOSITION_COLORS = ['#0f766e', '#f59e0b', '#6366f1', '#94a3b8'];

function CashComposition({
  rows,
  totalKrw,
}: {
  rows: Array<{ key: string; label: string; amountKrw: number; note: string }>;
  totalKrw: number;
}) {
  return (
    <div>
      <div
        className="flex h-5 w-full overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={`필요 현금 구성: ${rows.map((row) => `${row.label} ${formatKrwKorean(row.amountKrw)}`).join(', ')}`}
      >
        {rows.map((row, index) => (
          <span
            key={row.key}
            className="block h-full"
            style={{
              width: `${totalKrw > 0 ? (row.amountKrw / totalKrw) * 100 : 0}%`,
              backgroundColor: COMPOSITION_COLORS[index % COMPOSITION_COLORS.length],
            }}
            title={`${row.label} ${formatKrwKorean(row.amountKrw)}`}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-2">
        {rows.map((row, index) => (
          <li key={row.key} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex min-w-0 items-center gap-1.5 text-slate-600">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: COMPOSITION_COLORS[index % COMPOSITION_COLORS.length] }}
              />
              <span className="truncate">{row.label}</span>
            </span>
            <span className="num shrink-0 font-semibold text-slate-700">
              {formatKrwKorean(row.amountKrw)}
              <span className="ml-1 font-normal text-slate-400">
                {totalKrw > 0 ? `${((row.amountKrw / totalKrw) * 100).toFixed(1)}%` : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
