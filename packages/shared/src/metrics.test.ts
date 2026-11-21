import { describe, expect, it } from 'vitest';
import {
  aggregateMonthly,
  calculateLoan,
  changeRatePct,
  formatAreaM2,
  formatAreaM2AndPyeong,
  formatKrwKorean,
  formatPct,
  formatPyeongPrice,
  formatPyeongUnit,
  median,
  pricePerPyeongKrw,
  quantile,
  rateSensitivity,
  recentMonths,
  shiftMonth,
} from './metrics';
import { buildSampleTransactions } from './fixtures/sample-dataset';

describe('단위 환산·기초 통계', () => {
  it('㎡를 평으로 바꾸고 평당가를 계산한다', () => {
    expect(pricePerPyeongKrw(845_000_000, 84.98)).toBe(32_871_126);
    expect(pricePerPyeongKrw(0, 84.98)).toBe(0);
    expect(pricePerPyeongKrw(100, 0)).toBe(0);
  });

  it('전용면적을 ㎡와 평으로 함께 표기한다', () => {
    // 1평 = 3.305785㎡. 화면·알림 문구가 같은 함수를 쓰므로 표기 규칙을 여기서 고정한다.
    expect(formatAreaM2(84.98)).toBe('84.98㎡');
    expect(formatPyeongUnit(84.98)).toBe('25.7평');
    expect(formatAreaM2AndPyeong(84.98)).toBe('84.98㎡ (25.7평)');
    // 정수로 떨어지면 뒤의 0을 지운다.
    expect(formatAreaM2(85)).toBe('85㎡');
    expect(formatAreaM2AndPyeong(85)).toBe('85㎡ (25.7평)');
    expect(formatAreaM2AndPyeong(59.98)).toBe('59.98㎡ (18.1평)');
    // 표본이 없어 값이 없으면 대시로 둔다(0㎡로 읽히지 않게).
    expect(formatAreaM2AndPyeong(Number.NaN)).toBe('-');
  });

  it('중위값은 짝수 개에서 가운데 두 값의 평균을 반올림한다', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBe(0);
  });

  it('분위수는 선형 보간으로 계산한다', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
  });

  it('변동률과 표기 형식을 맞춘다', () => {
    expect(changeRatePct(110, 100)).toBe(10);
    expect(changeRatePct(90, 100)).toBe(-10);
    expect(changeRatePct(1, 0)).toBe(0);
    expect(formatKrwKorean(845_000_000)).toBe('8억 4,500만원');
    expect(formatKrwKorean(72_500_000)).toBe('7,250만원');
    expect(formatKrwKorean(-120_000_000)).toBe('-1억 2,000만원');
    expect(formatPyeongPrice(32_871_126)).toBe('3,287만원/평');
    expect(formatPct(3.25)).toBe('+3.3%');
  });

  it('최근 개월 목록을 연 경계까지 거슬러 만든다', () => {
    expect(recentMonths('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(shiftMonth('2026-01', -2)).toBe('2025-11');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
  });
});

describe('aggregateMonthly', () => {
  it('해제 거래를 제외하고 월별 중위가·평당가·거래량을 낸다', () => {
    const transactions = buildSampleTransactions('2026-03', 3);
    const months = recentMonths('2026-03', 3);
    const result = aggregateMonthly(transactions, months);
    expect(result.map((row) => row.month)).toEqual(months);
    expect(result.every((row) => row.sampleCount > 0)).toBe(true);
    expect(result.every((row) => row.medianPriceKrw > 0)).toBe(true);
    expect(result.every((row) => row.medianPricePerPyeong > 0)).toBe(true);
    // 해제 거래는 표본 수에서 빠져야 한다.
    const allCount = transactions.filter((row) => row.dealMonth === '2026-03').length;
    const canceled = transactions.filter((row) => row.dealMonth === '2026-03' && row.canceled).length;
    expect(result[2]?.sampleCount).toBe(allCount - canceled);
  });
});

describe('calculateLoan', () => {
  it('원리금균등 상환의 월 상환액이 표준 공식과 일치한다', () => {
    const result = calculateLoan({
      priceKrw: 628_000_000,
      equityKrw: 200_000_000,
      annualRatePct: 4.1,
      termMonths: 480,
      repayment: 'equal_principal_interest',
    });
    expect(result.loanKrw).toBe(428_000_000);
    expect(result.ltvPct).toBe(68.2);
    // 4.28억, 연 4.1%, 40년 원리금균등 → 월 약 182만원
    expect(result.monthlyPaymentKrw).toBeGreaterThan(1_790_000);
    expect(result.monthlyPaymentKrw).toBeLessThan(1_850_000);
    expect(result.totalInterestKrw).toBeGreaterThan(400_000_000);
    expect(result.requiredAnnualIncomeKrw).toBe(Math.round((result.monthlyPaymentKrw * 12) / 0.4));
  });

  it('원금균등은 첫 달 상환액이 가장 크고 총 이자가 원리금균등보다 적다', () => {
    const base = { priceKrw: 600_000_000, equityKrw: 100_000_000, annualRatePct: 4.5, termMonths: 360 };
    const equalPi = calculateLoan({ ...base, repayment: 'equal_principal_interest' });
    const equalPrincipal = calculateLoan({ ...base, repayment: 'equal_principal' });
    expect(equalPrincipal.monthlyPaymentKrw).toBeGreaterThan(equalPi.monthlyPaymentKrw);
    expect(equalPrincipal.totalInterestKrw).toBeLessThan(equalPi.totalInterestKrw);
  });

  it('이자만 상환은 원금이 줄지 않아 총 이자가 가장 크다', () => {
    const base = { priceKrw: 600_000_000, equityKrw: 100_000_000, annualRatePct: 4.5, termMonths: 360 };
    const interestOnly = calculateLoan({ ...base, repayment: 'interest_only' });
    expect(interestOnly.monthlyPaymentKrw).toBe(1_875_000);
    expect(interestOnly.totalInterestKrw).toBe(1_875_000 * 360);
  });

  it('자기자본이 매매가를 넘으면 대출·상환액이 0이다', () => {
    const result = calculateLoan({
      priceKrw: 300_000_000,
      equityKrw: 400_000_000,
      annualRatePct: 4,
      termMonths: 360,
      repayment: 'equal_principal_interest',
    });
    expect(result.loanKrw).toBe(0);
    expect(result.monthlyPaymentKrw).toBe(0);
    expect(result.totalInterestKrw).toBe(0);
  });

  it('금리 시나리오는 0.5%p 간격으로 월 상환액을 계산한다', () => {
    const rows = rateSensitivity(
      { priceKrw: 628_000_000, equityKrw: 200_000_000, termMonths: 480, repayment: 'equal_principal_interest' },
      [3, 3.5, 4, 4.5],
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]!.monthlyPaymentKrw).toBeLessThan(rows[3]!.monthlyPaymentKrw);
    expect(rows[1]!.monthlyPaymentKrw - rows[0]!.monthlyPaymentKrw).toBeGreaterThan(0);
  });
});
