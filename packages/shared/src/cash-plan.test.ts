import { describe, expect, it } from 'vitest';
import {
  acquisitionTax,
  acquisitionTaxRatePct,
  brokerageFee,
  brokerageTierFor,
  calculateCashPlan,
  loanCapacity,
} from './cash-plan';

describe('acquisitionTaxRatePct', () => {
  it('6억 이하 1%, 6~9억 누진, 9억 초과 3%를 적용한다', () => {
    expect(acquisitionTaxRatePct(500_000_000)).toBe(1);
    expect(acquisitionTaxRatePct(600_000_000)).toBe(1);
    expect(acquisitionTaxRatePct(750_000_000)).toBe(2);
    expect(acquisitionTaxRatePct(900_000_000)).toBe(3);
    expect(acquisitionTaxRatePct(1_000_000_000)).toBe(3);
  });
});

describe('acquisitionTax', () => {
  it('5억·84㎡는 취득세 1%와 지방교육세 0.1%만 붙는다', () => {
    const result = acquisitionTax({ priceKrw: 500_000_000, areaM2: 84.9 });
    expect(result.ratePct).toBe(1);
    expect(result.acquisitionTaxKrw).toBe(5_000_000);
    expect(result.localEducationTaxKrw).toBe(500_000);
    expect(result.ruralSpecialTaxKrw).toBe(0);
    expect(result.totalKrw).toBe(5_500_000);
  });

  it('8억·102㎡는 누진세율 2.3333%와 농어촌특별세 0.2%를 더한다', () => {
    const result = acquisitionTax({ priceKrw: 800_000_000, areaM2: 101.9 });
    expect(result.ratePct).toBe(2.3333);
    expect(result.acquisitionTaxKrw).toBe(18_666_400);
    expect(result.localEducationTaxKrw).toBe(1_866_640);
    expect(result.ruralSpecialTaxKrw).toBe(1_600_000);
    expect(result.totalKrw).toBe(22_133_040);
  });

  it('생애최초는 취득세 본세에서 200만원을 감면하고 교육세는 그대로 둔다', () => {
    const result = acquisitionTax({ priceKrw: 500_000_000, areaM2: 84.9, firstTimeBuyer: true });
    expect(result.reductionKrw).toBe(2_000_000);
    expect(result.acquisitionTaxKrw - result.reductionKrw).toBe(3_000_000);
    expect(result.localEducationTaxKrw).toBe(500_000);
    expect(result.totalKrw).toBe(3_500_000);
  });

  it('12억을 넘는 주택은 생애최초 감면을 적용하지 않는다', () => {
    const result = acquisitionTax({ priceKrw: 1_300_000_000, areaM2: 84.9, firstTimeBuyer: true });
    expect(result.reductionKrw).toBe(0);
    expect(result.notes.join(' ')).toMatch(/12억원 이하/);
  });
});

describe('brokerageFee', () => {
  it('5억 매매는 0.4% 상한 200만원과 부가세 20만원이다', () => {
    const result = brokerageFee(500_000_000);
    expect(result.ratePct).toBe(0.4);
    expect(result.feeKrw).toBe(2_000_000);
    expect(result.vatKrw).toBe(200_000);
    expect(result.totalKrw).toBe(2_200_000);
  });

  it('저가 구간은 요율보다 한도액이 작으면 한도액을 쓴다', () => {
    const low = brokerageFee(45_000_000, { includeVat: false });
    expect(low.ratePct).toBe(0.6);
    expect(low.capApplied).toBe(true);
    expect(low.feeKrw).toBe(250_000);

    const mid = brokerageFee(190_000_000, { includeVat: false });
    expect(mid.ratePct).toBe(0.5);
    expect(mid.capApplied).toBe(true);
    expect(mid.feeKrw).toBe(800_000);
  });

  it('9억을 넘으면 0.5%, 15억을 넘으면 0.7% 구간으로 올라간다', () => {
    expect(brokerageTierFor(900_000_000).ratePct).toBe(0.5);
    expect(brokerageTierFor(1_500_000_000).ratePct).toBe(0.7);
    expect(brokerageFee(1_000_000_000, { includeVat: false }).feeKrw).toBe(5_000_000);
  });
});

describe('loanCapacity', () => {
  it('LTV와 DSR 중 작은 값을 한도로 쓰고 제약을 표시한다', () => {
    const result = loanCapacity({
      priceKrw: 600_000_000,
      annualIncomeKrw: 60_000_000,
      annualRatePct: 4,
      termMonths: 480,
      repayment: 'equal_principal_interest',
    });
    expect(result.ltvLimitKrw).toBe(420_000_000);
    expect(result.dsrLimitKrw).toBeGreaterThan(420_000_000);
    expect(result.limitKrw).toBe(420_000_000);
    expect(result.binding).toBe('ltv');
  });

  it('소득이 낮으면 DSR 한도가 LTV 한도보다 작아진다', () => {
    const result = loanCapacity({
      priceKrw: 600_000_000,
      annualIncomeKrw: 36_000_000,
      annualRatePct: 4,
      termMonths: 480,
      repayment: 'equal_principal_interest',
    });
    expect(result.dsrLimitKrw).toBeLessThan(result.ltvLimitKrw);
    expect(result.binding).toBe('dsr');
    expect(result.limitKrw).toBe(result.dsrLimitKrw);
    expect(result.monthlyPaymentKrw).toBeLessThanOrEqual(1_200_000 + 2_000);
  });

  it('기존 대출 연 원리금을 DSR에서 차감한다', () => {
    const base = loanCapacity({
      priceKrw: 600_000_000,
      annualIncomeKrw: 60_000_000,
      annualRatePct: 4,
      termMonths: 480,
      repayment: 'equal_principal_interest',
    });
    const withDebt = loanCapacity({
      priceKrw: 600_000_000,
      annualIncomeKrw: 60_000_000,
      annualRatePct: 4,
      termMonths: 480,
      repayment: 'equal_principal_interest',
      existingAnnualDebtServiceKrw: 12_000_000,
    });
    expect(withDebt.dsrLimitKrw).toBeLessThan(base.dsrLimitKrw);
    expect(withDebt.binding).toBe('dsr');
  });

  it('스트레스 금리를 더하면 한도가 줄어든다', () => {
    const normal = loanCapacity({
      priceKrw: 1_000_000_000,
      annualIncomeKrw: 60_000_000,
      annualRatePct: 4,
      termMonths: 480,
      repayment: 'equal_principal_interest',
      ltvPct: 90,
    });
    const stressed = loanCapacity({
      priceKrw: 1_000_000_000,
      annualIncomeKrw: 60_000_000,
      annualRatePct: 4,
      termMonths: 480,
      repayment: 'equal_principal_interest',
      ltvPct: 90,
      stressRatePct: 1.5,
    });
    expect(stressed.dsrLimitKrw).toBeLessThan(normal.dsrLimitKrw);
    expect(stressed.appliedRatePct).toBe(5.5);
  });
});

describe('calculateCashPlan', () => {
  it('매매가 − 대출 + 취득세 + 중개보수로 필요 현금을 계산한다', () => {
    const plan = calculateCashPlan({
      priceKrw: 600_000_000,
      areaM2: 84.9,
      annualIncomeKrw: 60_000_000,
      annualRatePct: 4,
      termMonths: 480,
      repayment: 'equal_principal_interest',
      firstTimeBuyer: false,
      otherCostsKrw: 0,
    });
    expect(plan.loan.limitKrw).toBe(420_000_000);
    expect(plan.equityKrw).toBe(180_000_000);
    expect(plan.acquisitionTax.totalKrw).toBe(6_600_000);
    expect(plan.brokerage.totalKrw).toBe(2_640_000);
    expect(plan.cashNeededKrw).toBe(189_240_000);
    expect(plan.breakdown).toHaveLength(4);
  });

  it('생애최초 감면과 기타 비용을 반영한다', () => {
    const plan = calculateCashPlan({
      priceKrw: 500_000_000,
      areaM2: 84.9,
      annualIncomeKrw: 60_000_000,
      annualRatePct: 4,
      termMonths: 480,
      repayment: 'equal_principal_interest',
      firstTimeBuyer: true,
      otherCostsKrw: 3_000_000,
    });
    expect(plan.acquisitionTax.totalKrw).toBe(3_500_000);
    expect(plan.otherCostsKrw).toBe(3_000_000);
    expect(plan.cashNeededKrw).toBe(plan.equityKrw + 3_500_000 + plan.brokerage.totalKrw + 3_000_000);
  });

  it('소득이 없으면 대출 없이 매매가 전액이 자기자본이 된다', () => {
    const plan = calculateCashPlan({
      priceKrw: 300_000_000,
      areaM2: 59.9,
      annualIncomeKrw: 0,
      annualRatePct: 4,
      termMonths: 480,
      repayment: 'equal_principal_interest',
    });
    expect(plan.loanKrw).toBe(0);
    expect(plan.equityKrw).toBe(300_000_000);
    expect(plan.cashNeededKrw).toBeGreaterThan(300_000_000);
  });
});
