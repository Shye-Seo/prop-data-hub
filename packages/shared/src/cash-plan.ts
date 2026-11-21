import { calculateLoan, type RepaymentType } from './metrics';

/**
 * 입주에 필요한 자기자본(현금) 계산.
 *
 * 매매가에서 DSR·LTV로 계산한 대출 한도를 빼고, 취득세·중개보수·기타 비용을 더한다.
 * 세율·요율은 2026년 현행 법령을 기준으로 하되, 화면과 테스트가 같은 상수를 쓰도록 여기 모은다.
 * - 취득세: 지방세법 제11조①8호 (6억 이하 1%, 6~9억 누진, 9억 초과 3%)
 * - 지방교육세: 취득세의 10% (지방세법 제151조)
 * - 농어촌특별세: 전용 85㎡ 초과 주택 취득가액의 0.2% (농어촌특별세법)
 * - 생애최초 감면: 지방세특례제한법 제36조의3, 12억 이하 주택 취득세 200만원 한도(2028.12.31까지)
 * - 중개보수: 공인중개사법 시행규칙 별표1 (2021.10.19 신설, 2026.8.28 시행본도 요율 동일)
 *
 * 다주택 중과, 조정대상지역, 법인 취득, 지분 취득은 다루지 않는다(1주택 실수요 기준).
 */

export const ACQUISITION_TAX_BASIS = {
  /** 6억원 이하 세율(%) */
  lowRatePct: 1,
  lowPriceKrw: 600_000_000,
  /** 9억원 초과 세율(%) */
  highRatePct: 3,
  highPriceKrw: 900_000_000,
  /** 지방교육세 = 취득세 본세 × 10% */
  localEducationRate: 0.1,
  /** 농어촌특별세 = 취득가액 × 0.2% (전용 85㎡ 초과) */
  ruralTaxRate: 0.002,
  ruralAreaThresholdM2: 85,
  /** 생애최초 감면 한도(일반 주택) */
  firstTimeReductionKrw: 2_000_000,
  firstTimePriceLimitKrw: 1_200_000_000,
} as const;

/** 취득세율(%). 6억~9억 구간은 (취득가액[억] × 2/3 − 3)% 누진. */
export function acquisitionTaxRatePct(priceKrw: number): number {
  if (!Number.isFinite(priceKrw) || priceKrw <= 0) return 0;
  if (priceKrw <= ACQUISITION_TAX_BASIS.lowPriceKrw) return ACQUISITION_TAX_BASIS.lowRatePct;
  if (priceKrw <= ACQUISITION_TAX_BASIS.highPriceKrw) {
    const eok = priceKrw / 100_000_000;
    // 지방세법은 소수점 다섯째 자리에서 반올림해 넷째 자리까지 계산한다.
    return Number((eok * (2 / 3) - 3).toFixed(4));
  }
  return ACQUISITION_TAX_BASIS.highRatePct;
}

export interface AcquisitionTaxInput {
  priceKrw: number;
  areaM2: number;
  /** 본인·배우자 모두 주택을 소유한 적이 없는 생애최초 구입. */
  firstTimeBuyer?: boolean;
}

export interface AcquisitionTaxResult {
  ratePct: number;
  acquisitionTaxKrw: number;
  localEducationTaxKrw: number;
  ruralSpecialTaxKrw: number;
  reductionKrw: number;
  totalKrw: number;
  effectiveRatePct: number;
  notes: string[];
}

export function acquisitionTax(input: AcquisitionTaxInput): AcquisitionTaxResult {
  const priceKrw = Math.max(0, Math.round(input.priceKrw));
  const areaM2 = Number.isFinite(input.areaM2) ? input.areaM2 : 0;
  const ratePct = acquisitionTaxRatePct(priceKrw);
  const acquisitionTaxKrw = Math.round((priceKrw * ratePct) / 100);
  const localEducationTaxKrw = Math.round(acquisitionTaxKrw * ACQUISITION_TAX_BASIS.localEducationRate);
  const ruralSpecialTaxKrw =
    areaM2 > ACQUISITION_TAX_BASIS.ruralAreaThresholdM2
      ? Math.round(priceKrw * ACQUISITION_TAX_BASIS.ruralTaxRate)
      : 0;

  const notes: string[] = [];
  let reductionKrw = 0;
  if (input.firstTimeBuyer) {
    if (priceKrw <= ACQUISITION_TAX_BASIS.firstTimePriceLimitKrw) {
      reductionKrw = Math.min(acquisitionTaxKrw, ACQUISITION_TAX_BASIS.firstTimeReductionKrw);
      notes.push(
        `생애최초 감면 ${(reductionKrw / 10_000).toLocaleString('ko-KR')}만원(취득세 본세 한도 200만원)을 반영했습니다. 지방교육세·농어촌특별세는 감면 전 취득세 기준입니다.`,
      );
    } else {
      notes.push('생애최초 감면은 취득당시가액 12억원 이하 주택에만 적용됩니다.');
    }
  }
  if (ruralSpecialTaxKrw > 0) {
    notes.push('전용면적 85㎡ 초과로 농어촌특별세 0.2%가 붙었습니다.');
  }
  if (priceKrw > ACQUISITION_TAX_BASIS.lowPriceKrw && priceKrw <= ACQUISITION_TAX_BASIS.highPriceKrw) {
    notes.push('6억~9억 구간은 단일 세율이 아니라 취득가액에 따라 1~3%로 올라가는 누진식입니다.');
  }

  const totalKrw = Math.max(0, acquisitionTaxKrw - reductionKrw) + localEducationTaxKrw + ruralSpecialTaxKrw;
  return {
    ratePct,
    acquisitionTaxKrw,
    localEducationTaxKrw,
    ruralSpecialTaxKrw,
    reductionKrw,
    totalKrw,
    effectiveRatePct: priceKrw > 0 ? Number(((totalKrw / priceKrw) * 100).toFixed(3)) : 0,
    notes,
  };
}

export interface BrokerageTier {
  minKrw: number;
  maxKrw: number;
  ratePct: number;
  /** 한쪽 당사자가 내는 상한액(원). 없으면 null. */
  capKrw: number | null;
  label: string;
}

/** 주택 매매·교환 중개보수 상한요율(한쪽 기준, 부가세 별도). */
export const BROKERAGE_TIERS: BrokerageTier[] = [
  { minKrw: 0, maxKrw: 50_000_000, ratePct: 0.6, capKrw: 250_000, label: '5천만원 미만' },
  { minKrw: 50_000_000, maxKrw: 200_000_000, ratePct: 0.5, capKrw: 800_000, label: '5천만~2억원 미만' },
  { minKrw: 200_000_000, maxKrw: 900_000_000, ratePct: 0.4, capKrw: null, label: '2억~9억원 미만' },
  { minKrw: 900_000_000, maxKrw: 1_200_000_000, ratePct: 0.5, capKrw: null, label: '9억~12억원 미만' },
  { minKrw: 1_200_000_000, maxKrw: 1_500_000_000, ratePct: 0.6, capKrw: null, label: '12억~15억원 미만' },
  { minKrw: 1_500_000_000, maxKrw: Number.POSITIVE_INFINITY, ratePct: 0.7, capKrw: null, label: '15억원 이상' },
];

export interface BrokerageFeeResult {
  ratePct: number;
  feeKrw: number;
  vatKrw: number;
  totalKrw: number;
  tierLabel: string;
  capApplied: boolean;
}

export function brokerageTierFor(priceKrw: number): BrokerageTier {
  const tier = BROKERAGE_TIERS.find((row) => priceKrw >= row.minKrw && priceKrw < row.maxKrw);
  return tier ?? BROKERAGE_TIERS[BROKERAGE_TIERS.length - 1]!;
}

/**
 * 중개보수 상한. 요율표는 상한이므로 실제 금액은 협의로 낮출 수 있다.
 * `includeVat`은 일반과세 중개사무소의 부가세 10%를 더할지 여부다.
 */
export function brokerageFee(priceKrw: number, options: { includeVat?: boolean } = {}): BrokerageFeeResult {
  const safePrice = Math.max(0, Math.round(priceKrw));
  const tier = brokerageTierFor(safePrice);
  const raw = Math.round((safePrice * tier.ratePct) / 100);
  const capApplied = tier.capKrw !== null && raw > tier.capKrw;
  const feeKrw = capApplied ? tier.capKrw! : raw;
  const vatKrw = options.includeVat === false ? 0 : Math.round(feeKrw * 0.1);
  return {
    ratePct: tier.ratePct,
    feeKrw,
    vatKrw,
    totalKrw: feeKrw + vatKrw,
    tierLabel: tier.label,
    capApplied,
  };
}

export interface LoanCapacityInput {
  priceKrw: number;
  annualIncomeKrw: number;
  /** LTV 상한(%). 기본 70. */
  ltvPct?: number;
  /** DSR 상한(%). 기본 40. */
  dsrPct?: number;
  annualRatePct: number;
  termMonths: number;
  repayment: RepaymentType;
  /** 기존 대출의 연 원리금 상환액(원). DSR에서 함께 차감한다. */
  existingAnnualDebtServiceKrw?: number;
  /** 스트레스 DSR 가산금리(%p). 화면에서 직접 입력한다. */
  stressRatePct?: number;
}

export interface LoanCapacityResult {
  limitKrw: number;
  ltvLimitKrw: number;
  dsrLimitKrw: number;
  /** 한도를 결정한 제약: LTV 또는 DSR. */
  binding: 'ltv' | 'dsr' | 'none';
  ltvPct: number;
  dsrPct: number;
  appliedRatePct: number;
  monthlyPaymentKrw: number;
  /** 이 대출을 유지하는 데 필요한 연소득(기존 대출 포함). */
  requiredAnnualIncomeKrw: number;
  availableAnnualDebtServiceKrw: number;
}

/**
 * DSR·LTV 기반 예상 대출 한도.
 *
 * DSR 한도는 "연소득 × DSR − 기존 대출 연 원리금"을 12로 나눈 월 상환 가능액으로 역산한다.
 * 원리금균등은 연금현가식, 원금균등은 1회차 상환액, 이자만은 이자액 기준이다.
 * 실제 심사에서는 신용대출·카드론·전세대출까지 합산하고 스트레스 금리를 적용하므로 참고값이다.
 */
export function loanCapacity(input: LoanCapacityInput): LoanCapacityResult {
  const priceKrw = Math.max(0, Math.round(input.priceKrw));
  const annualIncomeKrw = Math.max(0, Math.round(input.annualIncomeKrw));
  const ltvPct = Math.min(100, Math.max(0, input.ltvPct ?? 70));
  const dsrPct = Math.min(100, Math.max(0, input.dsrPct ?? 40));
  const appliedRatePct = Math.max(0, input.annualRatePct + (input.stressRatePct ?? 0));
  const termMonths = Math.max(1, Math.round(input.termMonths));
  const existing = Math.max(0, Math.round(input.existingAnnualDebtServiceKrw ?? 0));
  const monthlyRate = appliedRatePct / 100 / 12;

  const availableAnnualDebtServiceKrw = Math.max(0, (annualIncomeKrw * dsrPct) / 100 - existing);
  const monthlyAvailable = availableAnnualDebtServiceKrw / 12;

  let dsrLimitKrw = 0;
  if (monthlyAvailable > 0) {
    if (input.repayment === 'interest_only') {
      dsrLimitKrw = monthlyRate > 0 ? Math.round(monthlyAvailable / monthlyRate) : priceKrw;
    } else if (input.repayment === 'equal_principal') {
      dsrLimitKrw = Math.round(monthlyAvailable / (1 / termMonths + monthlyRate));
    } else if (monthlyRate === 0) {
      dsrLimitKrw = Math.round(monthlyAvailable * termMonths);
    } else {
      const factor = Math.pow(1 + monthlyRate, termMonths);
      dsrLimitKrw = Math.round((monthlyAvailable * (factor - 1)) / (monthlyRate * factor));
    }
  }

  const ltvLimitKrw = Math.round((priceKrw * ltvPct) / 100);
  const limitKrw = Math.max(0, Math.min(ltvLimitKrw, dsrLimitKrw));
  const binding: LoanCapacityResult['binding'] =
    limitKrw === 0 ? 'none' : ltvLimitKrw <= dsrLimitKrw ? 'ltv' : 'dsr';

  const monthlyPaymentKrw =
    limitKrw === 0
      ? 0
      : calculateLoan({
          priceKrw: limitKrw,
          equityKrw: 0,
          annualRatePct: appliedRatePct,
          termMonths,
          repayment: input.repayment,
        }).monthlyPaymentKrw;

  return {
    limitKrw,
    ltvLimitKrw,
    dsrLimitKrw,
    binding,
    ltvPct,
    dsrPct,
    appliedRatePct,
    monthlyPaymentKrw,
    requiredAnnualIncomeKrw:
      dsrPct > 0 ? Math.round(((monthlyPaymentKrw * 12 + existing) * 100) / dsrPct) : 0,
    availableAnnualDebtServiceKrw: Math.round(availableAnnualDebtServiceKrw),
  };
}

export interface CashPlanInput extends LoanCapacityInput, AcquisitionTaxInput {
  /** 중개보수 부가세 포함 여부. 기본 포함. */
  brokerageVat?: boolean;
  /** 등기·이사 등 기타 비용(원). 기본 0. */
  otherCostsKrw?: number;
}

export interface CashPlanBreakdownRow {
  key: 'equity' | 'acquisition_tax' | 'brokerage' | 'other';
  label: string;
  amountKrw: number;
  note: string;
}

export interface CashPlanResult {
  priceKrw: number;
  loanKrw: number;
  equityKrw: number;
  acquisitionTax: AcquisitionTaxResult;
  brokerage: BrokerageFeeResult;
  otherCostsKrw: number;
  cashNeededKrw: number;
  cashRatioPct: number;
  loan: LoanCapacityResult;
  breakdown: CashPlanBreakdownRow[];
  notes: string[];
}

/**
 * 매매가 + 취득세 + 중개보수 + 기타 비용 − 대출 한도 = 입주 필요 현금.
 * 대출 한도는 LTV·DSR 중 작은 값이며, 한도를 정한 제약을 결과에 남긴다.
 */
export function calculateCashPlan(input: CashPlanInput): CashPlanResult {
  const priceKrw = Math.max(0, Math.round(input.priceKrw));
  const acquisition = acquisitionTax({
    priceKrw,
    areaM2: input.areaM2,
    firstTimeBuyer: input.firstTimeBuyer,
  });
  const brokerage = brokerageFee(priceKrw, { includeVat: input.brokerageVat !== false });
  const loan = loanCapacity({ ...input, priceKrw });
  const loanKrw = Math.min(priceKrw, loan.limitKrw);
  const equityKrw = Math.max(0, priceKrw - loanKrw);
  const otherCostsKrw = Math.max(0, Math.round(input.otherCostsKrw ?? 0));
  const cashNeededKrw = equityKrw + acquisition.totalKrw + brokerage.totalKrw + otherCostsKrw;

  const breakdown: CashPlanBreakdownRow[] = [
    {
      key: 'equity',
      label: '자기자본(매매가 − 대출)',
      amountKrw: equityKrw,
      note: `매매가 ${(priceKrw / 100_000_000).toFixed(2)}억 − 대출 ${(loanKrw / 100_000_000).toFixed(2)}억`,
    },
    {
      key: 'acquisition_tax',
      label: '취득세·지방교육세·농특세',
      amountKrw: acquisition.totalKrw,
      note: `취득세율 ${acquisition.ratePct}%${acquisition.reductionKrw > 0 ? ' · 생애최초 감면 반영' : ''}`,
    },
    {
      key: 'brokerage',
      label: '중개보수(복비)',
      amountKrw: brokerage.totalKrw,
      note: `상한 ${brokerage.ratePct}%${brokerage.vatKrw > 0 ? ' · 부가세 포함' : ''}`,
    },
    {
      key: 'other',
      label: '기타 비용',
      amountKrw: otherCostsKrw,
      note: '등기·이사·인지세 등 직접 입력',
    },
  ];

  const notes: string[] = [];
  if (loanKrw < priceKrw * 0.3) {
    notes.push('대출 한도가 매매가의 30% 미만입니다. DSR·LTV 조건과 기존 대출을 확인하세요.');
  }
  if (loan.binding === 'dsr') {
    notes.push(
      `대출 한도는 DSR ${loan.dsrPct}% 기준(${(loan.dsrLimitKrw / 100_000_000).toFixed(2)}억)이 LTV 한도(${(loan.ltvLimitKrw / 100_000_000).toFixed(2)}억)보다 작아 결정했습니다.`,
    );
  } else if (loan.binding === 'ltv') {
    notes.push(
      `대출 한도는 LTV ${loan.ltvPct}% 기준(${(loan.ltvLimitKrw / 100_000_000).toFixed(2)}억)이 DSR 한도(${(loan.dsrLimitKrw / 100_000_000).toFixed(2)}억)보다 작아 결정했습니다.`,
    );
  }
  notes.push(...acquisition.notes);
  notes.push('취득세 과세표준은 실거래가와 공시가격 중 높은 금액입니다. 여기서는 매매가를 기준으로 계산했습니다.');

  return {
    priceKrw,
    loanKrw,
    equityKrw,
    acquisitionTax: acquisition,
    brokerage,
    otherCostsKrw,
    cashNeededKrw,
    cashRatioPct: priceKrw > 0 ? Number(((cashNeededKrw / priceKrw) * 100).toFixed(1)) : 0,
    loan,
    breakdown,
    notes,
  };
}
