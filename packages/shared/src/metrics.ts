import { PYEONG_M2 } from './constants';
import type { AptTransaction, MacroIndicator, MonthlyPricePoint } from './types';

export function m2ToPyeong(areaM2: number): number {
  return areaM2 / PYEONG_M2;
}

/**
 * 자릿수를 고정하되 정수로 떨어지는 값은 뒤의 0을 지운다(85.00 → 85, 84.90 → 84.9).
 * 화면·알림 문구가 같은 숫자 문자열을 쓰도록 공용으로 둔다.
 */
export function trimFixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

/** 전용면적 ㎡ 표기. 84.98㎡, 59㎡처럼 뒤의 0은 지운다. */
export function formatAreaM2(areaM2: number, digits = 2): string {
  if (!Number.isFinite(areaM2)) return '-';
  return `${trimFixed(areaM2, digits)}㎡`;
}

/** 전용면적 평 표기. 25.7평, 25평처럼 소수점 한 자리까지 쓴다. */
export function formatPyeongUnit(areaM2: number, digits = 1): string {
  if (!Number.isFinite(areaM2)) return '-';
  return `${trimFixed(m2ToPyeong(areaM2), digits)}평`;
}

/**
 * 전용면적을 ㎡와 평으로 함께 표기한다: '84.98㎡ (25.7평)'.
 * 화면 표·상세·알림 문구가 모두 이 함수를 써서 단위와 소수점 정책을 한 곳에서 맞춘다.
 */
export function formatAreaM2AndPyeong(
  areaM2: number,
  options: { m2Digits?: number; pyeongDigits?: number } = {},
): string {
  if (!Number.isFinite(areaM2)) return '-';
  return `${formatAreaM2(areaM2, options.m2Digits ?? 2)} (${formatPyeongUnit(areaM2, options.pyeongDigits ?? 1)})`;
}

export function pyeongToM2(pyeong: number): number {
  return pyeong * PYEONG_M2;
}

export function pricePerPyeongKrw(priceKrw: number, areaM2: number): number {
  if (areaM2 <= 0) return 0;
  return Math.round(priceKrw / m2ToPyeong(areaM2));
}

export function computePricePerPyeong(priceKrw: number, areaM2: number): number {
  return pricePerPyeongKrw(priceKrw, areaM2);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(Math.max(q, 0), 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

export function changeRatePct(current: number, previous: number): number {
  if (previous === 0) return 0;
  return Number((((current - previous) / previous) * 100).toFixed(2));
}

/** 계약 해제 건은 시세 집계에서 제외한다. */
export function isCountableTransaction(transaction: AptTransaction): boolean {
  return !transaction.canceled;
}

export function aggregateMonthly(transactions: AptTransaction[], months: string[]): MonthlyPricePoint[] {
  const byMonth = new Map<string, AptTransaction[]>();
  for (const month of months) byMonth.set(month, []);
  for (const transaction of transactions) {
    if (!isCountableTransaction(transaction)) continue;
    const bucket = byMonth.get(transaction.dealMonth);
    if (!bucket) continue;
    bucket.push(transaction);
  }

  return months.map((month) => {
    const bucket = byMonth.get(month) ?? [];
    return {
      month,
      sampleCount: bucket.length,
      medianPriceKrw: median(bucket.map((row) => row.priceKrw)),
      medianPricePerPyeong: median(bucket.map((row) => row.pricePerPyeong)),
      medianAreaM2: Number(median(bucket.map((row) => row.areaM2)).toFixed(1)),
      totalVolumeKrw: bucket.reduce((sum, row) => sum + row.priceKrw, 0),
    };
  });
}

/** 최근 N개월 목록. 데이터 기준월(2026-09 등)을 끝으로 계산한다. */
export function recentMonths(endMonth: string, count: number): string[] {
  const [yearText, monthText] = endMonth.split('-');
  let year = Number(yearText);
  let month = Number(monthText);
  const months: string[] = [];
  for (let i = 0; i < count; i += 1) {
    months.unshift(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

export function shiftMonth(month: string, delta: number): string {
  const [yearText, monthText] = month.split('-');
  let year = Number(yearText);
  let value = Number(monthText) + delta;
  while (value > 12) {
    value -= 12;
    year += 1;
  }
  while (value < 1) {
    value += 12;
    year -= 1;
  }
  return `${year}-${String(value).padStart(2, '0')}`;
}

export type RepaymentType = 'equal_principal_interest' | 'equal_principal' | 'interest_only';

export interface LoanScenario {
  priceKrw: number;
  equityKrw: number;
  annualRatePct: number;
  termMonths: number;
  repayment: RepaymentType;
}

export interface LoanResult {
  loanKrw: number;
  ltvPct: number;
  monthlyPaymentKrw: number;
  firstMonthInterestKrw: number;
  totalInterestKrw: number;
  totalPaymentKrw: number;
  requiredAnnualIncomeKrw: number;
}

/**
 * 원리금균등/원금균등/이자만 상환의 월 상환액을 계산한다.
 * 실제 금융기관은 거치기간·인지세·보증료·우대금리를 더 얹지만,
 * 이 화면은 금리 민감도를 비교하는 도구이므로 원금·이자만 다룬다.
 */
export function calculateLoan(scenario: LoanScenario, dsrRatio = 0.4): LoanResult {
  const loanKrw = Math.max(0, Math.round(scenario.priceKrw - scenario.equityKrw));
  const monthlyRate = scenario.annualRatePct / 100 / 12;
  const months = Math.max(1, Math.round(scenario.termMonths));

  let monthlyPaymentKrw = 0;
  let totalPaymentKrw = 0;

  if (loanKrw === 0) {
    monthlyPaymentKrw = 0;
    totalPaymentKrw = 0;
  } else if (scenario.repayment === 'interest_only') {
    monthlyPaymentKrw = Math.round(loanKrw * monthlyRate);
    totalPaymentKrw = monthlyPaymentKrw * months + loanKrw;
  } else if (scenario.repayment === 'equal_principal') {
    const principal = loanKrw / months;
    let total = 0;
    for (let i = 0; i < months; i += 1) {
      const remaining = loanKrw - principal * i;
      total += principal + remaining * monthlyRate;
    }
    monthlyPaymentKrw = Math.round(principal + loanKrw * monthlyRate);
    totalPaymentKrw = Math.round(total);
  } else {
    if (monthlyRate === 0) {
      monthlyPaymentKrw = Math.round(loanKrw / months);
      totalPaymentKrw = loanKrw;
    } else {
      const factor = Math.pow(1 + monthlyRate, months);
      monthlyPaymentKrw = Math.round((loanKrw * monthlyRate * factor) / (factor - 1));
      totalPaymentKrw = monthlyPaymentKrw * months;
    }
  }

  return {
    loanKrw,
    ltvPct: scenario.priceKrw === 0 ? 0 : Number(((loanKrw / scenario.priceKrw) * 100).toFixed(1)),
    monthlyPaymentKrw,
    firstMonthInterestKrw: Math.round(loanKrw * monthlyRate),
    totalInterestKrw: Math.max(0, totalPaymentKrw - loanKrw),
    totalPaymentKrw,
    requiredAnnualIncomeKrw: Math.round((monthlyPaymentKrw * 12) / dsrRatio),
  };
}

export interface RateSensitivityRow {
  annualRatePct: number;
  monthlyPaymentKrw: number;
  totalInterestKrw: number;
  requiredAnnualIncomeKrw: number;
}

/** 0.5%p 간격으로 금리 시나리오를 훑어 월 상환액 변화를 만든다. */
export function rateSensitivity(base: Omit<LoanScenario, 'annualRatePct'>, rates: number[], dsrRatio = 0.4): RateSensitivityRow[] {
  return rates.map((annualRatePct) => {
    const result = calculateLoan({ ...base, annualRatePct }, dsrRatio);
    return {
      annualRatePct,
      monthlyPaymentKrw: result.monthlyPaymentKrw,
      totalInterestKrw: result.totalInterestKrw,
      requiredAnnualIncomeKrw: result.requiredAnnualIncomeKrw,
    };
  });
}

export function formatKrwWon(amount: number): string {
  if (!Number.isFinite(amount)) return '-';
  return `${Math.round(amount).toLocaleString('ko-KR')}원`;
}

/** 억/만원 표기. 예: 845000000 → 8억 4,500만원, 72500000 → 7,250만원 */
export function formatKrwKorean(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return '0원';
  const sign = amount < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(amount));
  const eok = Math.floor(absolute / 100_000_000);
  const man = Math.round((absolute % 100_000_000) / 10_000);
  const parts: string[] = [];
  if (eok > 0) parts.push(`${eok}억`);
  if (man > 0) parts.push(`${man.toLocaleString('ko-KR')}만`);
  if (parts.length === 0) return `${sign}${absolute.toLocaleString('ko-KR')}원`;
  return `${sign}${parts.join(' ')}원`;
}

export function formatPyeongPrice(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return '-';
  const man = Math.round(amount / 10_000);
  return `${man.toLocaleString('ko-KR')}만원/평`;
}

export function formatPct(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function latestMacroValue(indicators: MacroIndicator[], indicatorCode: string): MacroIndicator | undefined {
  return indicators
    .filter((row) => row.indicatorCode === indicatorCode)
    .sort((a, b) => a.periodDate.localeCompare(b.periodDate))
    .at(-1);
}
