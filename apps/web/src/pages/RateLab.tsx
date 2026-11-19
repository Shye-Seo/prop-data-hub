import { useEffect, useMemo, useRef, useState } from 'react';
import { calculateLoan, rateSensitivity, type RepaymentType } from '@prop/shared';
import { Card, DataNote, Field } from '../components/ui';
import { LineChart } from '../components/charts';
import { latestMacro } from '../lib/dataset';
import { formatKrwKorean, formatNumber } from '../lib/format';
import { tracker } from '../lib/tracker';

const REPAYMENTS: Array<{ key: RepaymentType; label: string; hint: string }> = [
  { key: 'equal_principal_interest', label: '원리금균등', hint: '매월 같은 금액' },
  { key: 'equal_principal', label: '원금균등', hint: '초반 부담 큼' },
  { key: 'interest_only', label: '이자만', hint: '만기 일시상환' },
];

const RATE_POINTS = [2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7];

export default function RateLab() {
  const baseRate = latestMacro('base_rate')?.value ?? 2.25;
  const mortgageRate = latestMacro('mortgage_rate')?.value ?? 4.1;

  const [priceEok, setPriceEok] = useState(6.28);
  const [equityEok, setEquityEok] = useState(2.0);
  const [rate, setRate] = useState(mortgageRate);
  const [termYears, setTermYears] = useState(40);
  const [repayment, setRepayment] = useState<RepaymentType>('equal_principal_interest');
  const initial = useRef(true);

  const result = useMemo(
    () =>
      calculateLoan({
        priceKrw: Math.round(priceEok * 100_000_000),
        equityKrw: Math.round(equityEok * 100_000_000),
        annualRatePct: rate,
        termMonths: termYears * 12,
        repayment,
      }),
    [priceEok, equityEok, rate, termYears, repayment],
  );

  const sensitivity = useMemo(
    () =>
      rateSensitivity(
        {
          priceKrw: Math.round(priceEok * 100_000_000),
          equityKrw: Math.round(equityEok * 100_000_000),
          termMonths: termYears * 12,
          repayment,
        },
        RATE_POINTS,
      ),
    [priceEok, equityEok, termYears, repayment],
  );

  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      tracker.track('rate_scenario_adjust', {
        priceKrw: Math.round(priceEok * 100_000_000),
        loanKrw: result.loanKrw,
        annualRatePct: Number(rate.toFixed(2)),
        termMonths: termYears * 12,
        repayment,
        monthlyPaymentKrw: result.monthlyPaymentKrw,
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [priceEok, equityEok, rate, termYears, repayment, result.loanKrw, result.monthlyPaymentKrw]);

  const interestShare = result.totalPaymentKrw === 0 ? 0 : (result.totalInterestKrw / result.totalPaymentKrw) * 100;
  const current = sensitivity.find((row) => Math.abs(row.annualRatePct - rate) < 0.26);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <Card title="대출 조건" subtitle="값을 바꾸면 400ms 뒤 rate_scenario_adjust 이벤트가 기록됩니다.">
          <div className="space-y-4">
            <Field label="매매가" hint={`${priceEok.toFixed(2)}억원`}>
              <input
                type="range"
                className="range w-full"
                min={2}
                max={20}
                step={0.01}
                value={priceEok}
                onChange={(event) => setPriceEok(Number(event.target.value))}
                aria-label="매매가"
              />
            </Field>
            <Field label="자기자본" hint={`${equityEok.toFixed(2)}억원 (LTV ${result.ltvPct.toFixed(1)}%)`}>
              <input
                type="range"
                className="range w-full"
                min={0}
                max={20}
                step={0.01}
                value={equityEok}
                onChange={(event) => setEquityEok(Number(event.target.value))}
                aria-label="자기자본"
              />
            </Field>
            <Field label="대출 금리" hint={`${rate.toFixed(2)}% · 주담대 기준 ${mortgageRate.toFixed(2)}%`}>
              <input
                type="range"
                className="range w-full"
                min={2}
                max={8}
                step={0.05}
                value={rate}
                onChange={(event) => setRate(Number(event.target.value))}
                aria-label="대출 금리"
              />
            </Field>
            <Field label="상환 기간" hint={`${termYears}년`}>
              <select
                className="select"
                value={termYears}
                onChange={(event) => setTermYears(Number(event.target.value))}
                aria-label="상환 기간"
              >
                {[10, 15, 20, 30, 35, 40].map((years) => (
                  <option key={years} value={years}>
                    {years}년 ({years * 12}개월)
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-slate-600">상환 방식</span>
              <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="상환 방식">
                {REPAYMENTS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setRepayment(option.key)}
                    aria-pressed={repayment === option.key}
                    className={`rounded-lg border px-2 py-2 text-center text-[11px] leading-tight transition ${
                      repayment === option.key
                        ? 'border-teal-600 bg-teal-50 font-semibold text-teal-800'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {option.label}
                    <span className="mt-0.5 block text-[10px] font-normal text-slate-400">{option.hint}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
              기준금리 {baseRate.toFixed(2)}% · 주담대 {mortgageRate.toFixed(2)}% (ECOS 월간, 말일 기준)
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ResultTile label="대출액" value={formatKrwKorean(result.loanKrw)} hint={`LTV ${result.ltvPct.toFixed(1)}%`} />
            <ResultTile label="월 상환액" value={formatKrwKorean(result.monthlyPaymentKrw)} hint={`${termYears}년 ${REPAYMENTS.find((row) => row.key === repayment)?.label}`} highlight />
            <ResultTile label="총 이자" value={formatKrwKorean(result.totalInterestKrw)} hint={`총 상환의 ${interestShare.toFixed(1)}%`} />
            <ResultTile label="필요 연소득" value={formatKrwKorean(result.requiredAnnualIncomeKrw)} hint="DSR 40% 기준" />
          </div>

          <Card title="금리 구간별 월 상환액" subtitle="현재 조건(가격·자기자본·기간·상환방식)을 고정하고 금리만 바꾼 값">
            <LineChart
              ariaLabel="금리 구간별 월 상환액 선 그래프"
              series={[
                {
                  key: 'payment',
                  label: '월 상환액',
                  color: '#1d4ed8',
                  points: sensitivity.map((row) => ({ label: `${row.annualRatePct.toFixed(1)}%`, value: row.monthlyPaymentKrw })),
                },
              ]}
              height={230}
              formatValue={(value) => `${Math.round(value / 10_000).toLocaleString('ko-KR')}만`}
              xTickCount={10}
            />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-[11px] text-slate-500">금리 1%p 상승 시</p>
                <p className="num mt-0.5 text-sm font-semibold text-ink-800">
                  월 {formatKrwKorean(Math.abs((sensitivity.find((row) => Math.abs(row.annualRatePct - (rate + 1)) < 0.26)?.monthlyPaymentKrw ?? result.monthlyPaymentKrw) - result.monthlyPaymentKrw))} 증가
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-[11px] text-slate-500">현재 금리 {rate.toFixed(2)}% 기준</p>
                <p className="num mt-0.5 text-sm font-semibold text-ink-800">
                  월 {formatNumber(result.monthlyPaymentKrw)}원 · 연 {formatKrwKorean(result.monthlyPaymentKrw * 12)}
                </p>
                {current && <p className="text-[10px] text-slate-400">차트 값과 일치</p>}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card title="금리 시나리오 표" subtitle="같은 표를 리포트로 저장할 때 필요한 값(총 이자·필요 소득)을 함께 계산">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="table-head">
                <th className="px-2 py-2">금리</th>
                <th className="px-2 py-2 text-right">월 상환액</th>
                <th className="px-2 py-2 text-right">총 이자</th>
                <th className="px-2 py-2 text-right">필요 연소득(DSR 40%)</th>
                <th className="px-2 py-2 text-right">현재 대비</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sensitivity.map((row) => {
                const diff = row.monthlyPaymentKrw - result.monthlyPaymentKrw;
                return (
                  <tr key={row.annualRatePct} className={Math.abs(row.annualRatePct - rate) < 0.26 ? 'bg-teal-50/60' : ''}>
                    <td className="num px-2 py-1.5 text-xs font-semibold text-slate-700">{row.annualRatePct.toFixed(1)}%</td>
                    <td className="num px-2 py-1.5 text-right text-xs text-slate-700">{formatKrwKorean(row.monthlyPaymentKrw)}</td>
                    <td className="num px-2 py-1.5 text-right text-xs text-slate-500">{formatKrwKorean(row.totalInterestKrw)}</td>
                    <td className="num px-2 py-1.5 text-right text-xs text-slate-500">{formatKrwKorean(row.requiredAnnualIncomeKrw)}</td>
                    <td className={`num px-2 py-1.5 text-right text-xs ${diff > 0 ? 'text-rose-600' : diff < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {diff === 0 ? '기준' : `${diff > 0 ? '+' : '-'}${formatKrwKorean(Math.abs(diff))}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <DataNote>
        월 상환액은 원금·이자만 계산한 값입니다. 실제 금융기관은 인지세, 보증료, 우대금리, 거치기간, DSR 산정 시 다른 대출을
        함께 반영하므로 이 화면의 숫자는 조건 비교용입니다.
      </DataNote>
    </div>
  );
}

function ResultTile({ label, value, hint, highlight = false }: { label: string; value: string; hint: string; highlight?: boolean }) {
  return (
    <div className={`card card-pad ${highlight ? 'border-teal-500/50 ring-1 ring-teal-500/20' : ''}`}>
      <p className="label">{label}</p>
      <p className={`num mt-1 text-lg font-semibold ${highlight ? 'text-teal-700' : 'text-ink-800'}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>
    </div>
  );
}
