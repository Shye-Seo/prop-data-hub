import { jeonseRiskLevel, riskLevelLabel } from './risk';
import type { RiskLevel } from './types';

/**
 * 전세 보증금 안전진단.
 *
 * 실거주 목적의 전세 세입자가 계약 전에 확인해야 하는 세 가지를 한 번에 계산한다.
 * 1) 전세가율 = (보증금 + 선순위 근저당) ÷ 최근 매매 실거래가 × 100
 * 2) 최우선변제금 해당 여부 — 주택임대차보호법 시행령 제10조·제11조 (2023.2.21 시행분)
 * 3) HUG 전세보증금반환보증 가입 가능성 — 보증금 한도·전세가율 90%·선순위 60%
 *
 * 계산은 화면·테스트가 같은 함수를 쓰도록 여기 한 곳에 둔다. 법령·상품 조건이 바뀌면
 * 아래 상수와 `docs`(화면 하단 기준 문구)를 함께 고친다.
 */

export type PriorityZone = 'seoul' | 'overconcentration' | 'metro' | 'other';
export type HugRegion = 'capital' | 'non_capital';
export type JeonseSafetyVerdict = 'safe' | 'caution' | 'risk' | 'danger' | 'unknown';

export const PRIORITY_ZONE_LABEL: Record<PriorityZone, string> = {
  seoul: '서울특별시',
  overconcentration: '수도권 과밀억제권역·세종·용인·화성·김포',
  metro: '광역시(과밀억제권역 제외)·안산·광주·파주·이천·평택',
  other: '그 밖의 지역',
};

/**
 * 소액임차인 최우선변제 기준. 2023.2.21 시행 주택임대차보호법 시행령 제10조·제11조.
 * - `depositThresholdKrw`: 이 금액 이하 보증금이면 소액임차인
 * - `statutoryAmountKrw`: 보증금 중 최우선변제로 인정되는 최대 금액
 * 부산은 광역시이므로 `metro`(8,500만원 이하 → 2,800만원)를 쓴다.
 */
export const PRIORITY_REPAYMENT_TABLE: Record<
  PriorityZone,
  { depositThresholdKrw: number; statutoryAmountKrw: number }
> = {
  seoul: { depositThresholdKrw: 165_000_000, statutoryAmountKrw: 55_000_000 },
  overconcentration: { depositThresholdKrw: 145_000_000, statutoryAmountKrw: 48_000_000 },
  metro: { depositThresholdKrw: 85_000_000, statutoryAmountKrw: 28_000_000 },
  other: { depositThresholdKrw: 75_000_000, statutoryAmountKrw: 25_000_000 },
};

export const PRIORITY_LAW_BASIS = '주택임대차보호법 시행령 제10조·제11조(2023.2.21 시행)';

/**
 * HUG 전세보증금반환보증의 재무 요건.
 * - 보증 대상 전세보증금: 수도권 7억원, 그 외 5억원 이하
 * - 보증한도: 주택가격 × 90% − 선순위채권
 * - 선순위채권: 주택가액(주택가격 × 90%)의 60% 이내 = 주택가격의 54%
 * 실제 심사는 KB시세·공시가격(140%) 기준이고, 전입신고·확정일자·계약기간 1년 이상 등
 * 비재무 요건도 있다. 여기서는 실거래가를 주택가격으로 둔 사전 점검만 한다.
 */
export const HUG_GUARANTEE = {
  maxDepositKrw: {
    capital: 700_000_000,
    non_capital: 500_000_000,
  } as Record<HugRegion, number>,
  collateralRatio: 0.9,
  seniorLienRatio: 0.6,
} as const;

export interface JeonseSafetyInput {
  /** 희망 전세 보증금(원). */
  depositKrw: number;
  /** 등기부등본 을구의 선순위 근저당 채권최고액(원). 없으면 0. */
  seniorMortgageKrw: number;
  /** 주택가격(원). 보통 같은 단지·면적의 최근 매매 실거래 중위값. */
  marketPriceKrw: number;
  /** 최우선변제 권역. 부산은 'metro'. */
  priorityZone?: PriorityZone;
  /** HUG 보증금 한도 지역. 부산은 'non_capital'. */
  hugRegion?: HugRegion;
}

export interface JeonseSafetySignal {
  code: 'jeonse_ratio' | 'senior_lien' | 'priority_repayment' | 'hug' | 'stress_loss';
  level: RiskLevel;
  label: string;
  detail: string;
}

export interface PriorityRepaymentResult {
  zone: PriorityZone;
  zoneLabel: string;
  eligible: boolean;
  depositThresholdKrw: number;
  statutoryAmountKrw: number;
  /** 시세의 1/2 한도(시행령 제10조②)를 적용한 뒤의 인정 금액. */
  recognizedKrw: number;
  /** 최우선변제로 회수하지 못하는 보증금. */
  uncoveredDepositKrw: number;
}

export interface HugEligibilityResult {
  eligible: boolean;
  depositWithinLimit: boolean;
  depositLimitKrw: number;
  /** 주택가격 × 90%. */
  collateralCapKrw: number;
  /** 주택가액(주택가격 × 90%)의 60%. */
  seniorCapKrw: number;
  /** 보증한도 = 주택가격 × 90% − 선순위채권. */
  maxGuaranteeKrw: number;
  /** (보증금 + 선순위) − 보증한도. 0 이하면 여유. */
  shortfallKrw: number;
  /** HUG가 보증할 수 있는 금액(보증금과 보증한도 중 작은 값). */
  coveredDepositKrw: number;
  reasons: string[];
}

export interface StressScenario {
  dropPct: number;
  assumedPriceKrw: number;
  recoverableKrw: number;
  lossKrw: number;
}

export interface JeonseSafetyResult {
  depositKrw: number;
  seniorMortgageKrw: number;
  marketPriceKrw: number;
  totalClaimKrw: number;
  /** (보증금 + 선순위) ÷ 주택가격 × 100. */
  jeonseRatioPct: number;
  ratioLevel: RiskLevel;
  ratioLabel: string;
  priority: PriorityRepaymentResult;
  hug: HugEligibilityResult;
  /** 시세 하락 시 보증금 회수 시나리오. 최우선변제 → 선순위 근저당 → 보증금 순으로 배당한다고 가정. */
  stress: StressScenario[];
  verdict: JeonseSafetyVerdict;
  verdictLabel: string;
  headline: string;
  signals: JeonseSafetySignal[];
}

const VERDICT_LABEL: Record<JeonseSafetyVerdict, string> = {
  safe: '안전',
  caution: '주의',
  risk: '위험',
  danger: '깡통 위험',
  unknown: '판정 불가',
};

export function jeonseSafetyVerdictLabel(verdict: JeonseSafetyVerdict): string {
  return VERDICT_LABEL[verdict];
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

/** 시세가 `dropPct`% 하락했을 때 보증금 회수액. 경매비용·최저매각가·다른 채권자는 반영하지 않는다. */
export function recoverableDepositAtDrop(input: {
  depositKrw: number;
  seniorMortgageKrw: number;
  marketPriceKrw: number;
  priorityAmountKrw: number;
  dropPct: number;
}): { assumedPriceKrw: number; recoverableKrw: number; lossKrw: number } {
  const assumedPriceKrw = Math.max(0, Math.round(input.marketPriceKrw * (1 + input.dropPct / 100)));
  const priorityPaid = Math.min(input.priorityAmountKrw, assumedPriceKrw);
  const afterPriority = Math.max(0, assumedPriceKrw - priorityPaid);
  const seniorPaid = Math.min(input.seniorMortgageKrw, afterPriority);
  const residual = Math.max(0, afterPriority - seniorPaid);
  const recoverableKrw = Math.min(input.depositKrw, priorityPaid + residual);
  return {
    assumedPriceKrw,
    recoverableKrw,
    lossKrw: Math.max(0, input.depositKrw - recoverableKrw),
  };
}

/**
 * 전세 보증금 안전진단 계산.
 * `marketPriceKrw`가 0 이하이면(표본 없음) verdict='unknown'으로 두고 계산 가능한 항목만 채운다.
 */
export function assessJeonseSafety(input: JeonseSafetyInput): JeonseSafetyResult {
  const depositKrw = Math.max(0, Math.round(input.depositKrw));
  const seniorMortgageKrw = Math.max(0, Math.round(input.seniorMortgageKrw));
  const marketPriceKrw = Math.max(0, Math.round(input.marketPriceKrw));
  const priorityZone = input.priorityZone ?? 'metro';
  const hugRegion = input.hugRegion ?? (priorityZone === 'seoul' || priorityZone === 'overconcentration' ? 'capital' : 'non_capital');

  const totalClaimKrw = depositKrw + seniorMortgageKrw;
  const jeonseRatioPct = safeRatio(totalClaimKrw, marketPriceKrw);
  const ratioLevel = marketPriceKrw > 0 ? jeonseRiskLevel(jeonseRatioPct) : 'moderate';

  const priorityRow = PRIORITY_REPAYMENT_TABLE[priorityZone];
  const priorityEligible = depositKrw > 0 && depositKrw <= priorityRow.depositThresholdKrw;
  // 시행령 제10조②: 보증금 중 일정액이 주택가액의 1/2을 넘으면 1/2까지만 우선변제한다.
  const halfPriceKrw = marketPriceKrw > 0 ? Math.floor(marketPriceKrw / 2) : 0;
  const recognizedKrw = priorityEligible
    ? Math.min(depositKrw, priorityRow.statutoryAmountKrw, marketPriceKrw > 0 ? halfPriceKrw : priorityRow.statutoryAmountKrw)
    : 0;
  const priority: PriorityRepaymentResult = {
    zone: priorityZone,
    zoneLabel: PRIORITY_ZONE_LABEL[priorityZone],
    eligible: priorityEligible,
    depositThresholdKrw: priorityRow.depositThresholdKrw,
    statutoryAmountKrw: priorityRow.statutoryAmountKrw,
    recognizedKrw,
    uncoveredDepositKrw: Math.max(0, depositKrw - recognizedKrw),
  };

  const depositLimitKrw = HUG_GUARANTEE.maxDepositKrw[hugRegion];
  const collateralCapKrw = Math.round(marketPriceKrw * HUG_GUARANTEE.collateralRatio);
  const seniorCapKrw = Math.round(marketPriceKrw * HUG_GUARANTEE.collateralRatio * HUG_GUARANTEE.seniorLienRatio);
  const maxGuaranteeKrw = Math.max(0, collateralCapKrw - seniorMortgageKrw);
  const shortfallKrw = Math.max(0, totalClaimKrw - maxGuaranteeKrw);
  const depositWithinLimit = depositKrw > 0 && depositKrw <= depositLimitKrw;
  const collateralWithinLimit = marketPriceKrw > 0 && totalClaimKrw <= collateralCapKrw;
  const seniorWithinLimit = marketPriceKrw > 0 && seniorMortgageKrw <= seniorCapKrw;
  const reasons: string[] = [];
  if (!depositWithinLimit) {
    reasons.push(`보증금이 ${Math.round(depositLimitKrw / 100_000_000)}억원 한도를 넘습니다.`);
  }
  if (marketPriceKrw <= 0) {
    reasons.push('주택가격(최근 매매 실거래가)이 없어 전세가율을 계산할 수 없습니다.');
  } else if (!collateralWithinLimit) {
    reasons.push(
      `보증금+선순위 ${(totalClaimKrw / 100_000_000).toFixed(2)}억원이 주택가격의 90%(${(collateralCapKrw / 100_000_000).toFixed(2)}억원)를 넘습니다.`,
    );
  }
  if (marketPriceKrw > 0 && !seniorWithinLimit) {
    reasons.push(
      `선순위 근저당 ${(seniorMortgageKrw / 100_000_000).toFixed(2)}억원이 주택가액의 60%(${(seniorCapKrw / 100_000_000).toFixed(2)}억원)를 넘습니다.`,
    );
  }
  const hug: HugEligibilityResult = {
    eligible: reasons.length === 0,
    depositWithinLimit,
    depositLimitKrw,
    collateralCapKrw,
    seniorCapKrw,
    maxGuaranteeKrw,
    shortfallKrw,
    coveredDepositKrw: Math.max(0, Math.min(depositKrw, maxGuaranteeKrw)),
    reasons,
  };

  const stress = [-10, -20, -30].map((dropPct) => {
    const row = recoverableDepositAtDrop({
      depositKrw,
      seniorMortgageKrw,
      marketPriceKrw,
      priorityAmountKrw: recognizedKrw,
      dropPct,
    });
    return { dropPct, ...row };
  });

  const minus20 = stress.find((row) => row.dropPct === -20);
  let verdict: JeonseSafetyVerdict;
  if (marketPriceKrw <= 0 || depositKrw <= 0) verdict = 'unknown';
  else if (jeonseRatioPct >= 100) verdict = 'danger';
  else if (jeonseRatioPct >= 90) verdict = 'risk';
  else if (jeonseRatioPct >= 80 || (minus20?.lossKrw ?? 0) > 0) verdict = 'caution';
  else verdict = 'safe';

  const signals: JeonseSafetySignal[] = [];
  if (marketPriceKrw > 0) {
    signals.push({
      code: 'jeonse_ratio',
      level: ratioLevel,
      label: '전세가율',
      detail: `(보증금 ${(depositKrw / 100_000_000).toFixed(2)}억 + 선순위 ${(seniorMortgageKrw / 100_000_000).toFixed(2)}억) ÷ 시세 ${(marketPriceKrw / 100_000_000).toFixed(2)}억 = ${jeonseRatioPct.toFixed(1)}%`,
    });
  }
  if (seniorMortgageKrw > 0) {
    signals.push({
      code: 'senior_lien',
      level: seniorWithinLimit ? 'low' : 'high',
      label: seniorWithinLimit ? '선순위 근저당 반영' : '선순위 근저당 과다',
      detail: seniorWithinLimit
        ? `선순위 ${(seniorMortgageKrw / 100_000_000).toFixed(2)}억원을 보증금과 합산했습니다. HUG 기준(주택가격 60%) 이내입니다.`
        : `선순위 ${(seniorMortgageKrw / 100_000_000).toFixed(2)}억원이 HUG 기준(주택가액의 60% = ${(seniorCapKrw / 100_000_000).toFixed(2)}억원)을 넘습니다.`,
    });
  }
  signals.push({
    code: 'priority_repayment',
    level: priorityEligible ? 'low' : 'moderate',
    label: priorityEligible ? '소액임차인 최우선변제 대상' : '최우선변제 대상 아님',
    detail: priorityEligible
      ? `${priority.zoneLabel} 기준 보증금 ${(priority.depositThresholdKrw / 100_000_000).toFixed(2)}억원 이하 — 최대 ${(priority.statutoryAmountKrw / 10_000).toLocaleString('ko-KR')}만원까지 최우선변제(시세 1/2 한도 적용 시 ${(recognizedKrw / 10_000).toLocaleString('ko-KR')}만원).`
      : `보증금이 ${priority.zoneLabel} 기준 ${(priority.depositThresholdKrw / 100_000_000).toFixed(2)}억원을 넘어 최우선변제를 받지 못합니다.`,
  });
  signals.push({
    code: 'hug',
    level: hug.eligible ? 'low' : collateralWithinLimit && seniorWithinLimit ? 'moderate' : 'high',
    label: hug.eligible ? 'HUG 가입 요건 충족' : 'HUG 가입 요건 미달',
    detail: hug.eligible
      ? `보증금 ${(depositLimitKrw / 100_000_000).toFixed(0)}억원 이하 · 보증금+선순위 90% 이하 · 선순위 60% 이하를 모두 충족합니다. 보증 가능 금액 ${(hug.coveredDepositKrw / 10_000).toLocaleString('ko-KR')}만원.`
      : hug.reasons.join(' '),
  });
  if (minus20 && minus20.lossKrw > 0) {
    signals.push({
      code: 'stress_loss',
      level: minus20.lossKrw >= depositKrw * 0.3 ? 'high' : 'moderate',
      label: '시세 -20% 시 손실',
      detail: `시세가 20% 빠지면 회수 가능액 ${(minus20.recoverableKrw / 10_000).toLocaleString('ko-KR')}만원, 손실 ${(minus20.lossKrw / 10_000).toLocaleString('ko-KR')}만원으로 계산됩니다.`,
    });
  }

  const headline =
    verdict === 'unknown'
      ? '최근 매매 실거래 표본이 없어 판정할 수 없습니다. 시세를 직접 입력해 주세요.'
      : verdict === 'danger'
        ? `보증금+선순위가 시세의 ${jeonseRatioPct.toFixed(1)}%입니다. 시세가 내려가면 보증금 전액을 돌려받기 어렵습니다.`
        : verdict === 'risk'
          ? `전세가율 ${jeonseRatioPct.toFixed(1)}% — 90% 이상이라 시세가 조금만 빠져도 회수 위험이 커집니다.`
          : verdict === 'caution'
            ? `전세가율 ${jeonseRatioPct.toFixed(1)}% — 계약 전 선순위·보증금 한도와 시세 하락 시나리오를 확인하세요.`
            : !hug.eligible
              ? `전세가율 ${jeonseRatioPct.toFixed(1)}% — 보증금 회수 위험은 낮지만 ${hug.reasons[0] ?? 'HUG 가입 요건을 충족하지 못합니다.'} 보증보험 없이 계약하게 됩니다.`
              : priorityEligible
                ? `전세가율 ${jeonseRatioPct.toFixed(1)}% — HUG 재무 요건과 최우선변제 요건을 함께 충족합니다.`
                : `전세가율 ${jeonseRatioPct.toFixed(1)}% — HUG 재무 요건을 충족합니다. 보증금이 소액임차인 기준을 넘어 최우선변제 대상은 아닙니다.`;

  return {
    depositKrw,
    seniorMortgageKrw,
    marketPriceKrw,
    totalClaimKrw,
    jeonseRatioPct,
    ratioLevel,
    ratioLabel: riskLevelLabel(ratioLevel),
    priority,
    hug,
    stress,
    verdict,
    verdictLabel: VERDICT_LABEL[verdict],
    headline,
    signals,
  };
}
