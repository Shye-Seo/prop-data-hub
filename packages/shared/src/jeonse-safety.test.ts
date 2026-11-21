import { describe, expect, it } from 'vitest';
import {
  HUG_GUARANTEE,
  PRIORITY_REPAYMENT_TABLE,
  assessJeonseSafety,
  recoverableDepositAtDrop,
} from './jeonse-safety';

describe('assessJeonseSafety', () => {
  it('부산 4억 보증금·시세 6억이면 전세가율 66.7%로 안전하고 HUG 요건을 충족한다', () => {
    const result = assessJeonseSafety({
      depositKrw: 400_000_000,
      seniorMortgageKrw: 0,
      marketPriceKrw: 600_000_000,
      priorityZone: 'metro',
      hugRegion: 'non_capital',
    });
    expect(result.jeonseRatioPct).toBe(66.7);
    expect(result.ratioLevel).toBe('low');
    expect(result.verdict).toBe('safe');
    expect(result.hug.eligible).toBe(true);
    expect(result.hug.maxGuaranteeKrw).toBe(540_000_000);
    expect(result.priority.eligible).toBe(false);
    expect(result.priority.recognizedKrw).toBe(0);
  });

  it('전세가율 90%는 위험으로 판정하고 HUG 90% 경계는 통과한다', () => {
    const result = assessJeonseSafety({
      depositKrw: 450_000_000,
      seniorMortgageKrw: 0,
      marketPriceKrw: 500_000_000,
      priorityZone: 'metro',
      hugRegion: 'non_capital',
    });
    expect(result.jeonseRatioPct).toBe(90);
    expect(result.verdict).toBe('risk');
    expect(result.hug.eligible).toBe(true);
    expect(result.priority.eligible).toBe(false);
  });

  it('보증금이 지방 HUG 한도 5억을 넘으면 가입 불가 사유를 남긴다', () => {
    const result = assessJeonseSafety({
      depositKrw: 600_000_000,
      seniorMortgageKrw: 0,
      marketPriceKrw: 900_000_000,
      priorityZone: 'metro',
      hugRegion: 'non_capital',
    });
    expect(result.jeonseRatioPct).toBe(66.7);
    expect(result.hug.depositWithinLimit).toBe(false);
    expect(result.hug.eligible).toBe(false);
    expect(result.hug.reasons.join(' ')).toMatch(/5억원 한도/);
    expect(result.verdict).toBe('safe');
    expect(result.headline).toMatch(/보증보험 없이/);
  });

  it('수도권은 보증금 한도 7억을 적용한다', () => {
    const result = assessJeonseSafety({
      depositKrw: 650_000_000,
      seniorMortgageKrw: 0,
      marketPriceKrw: 1_000_000_000,
      priorityZone: 'seoul',
      hugRegion: 'capital',
    });
    expect(result.hug.depositLimitKrw).toBe(700_000_000);
    expect(result.hug.eligible).toBe(true);
  });

  it('보증금+선순위가 시세를 넘으면 깡통 위험으로 판정한다', () => {
    const result = assessJeonseSafety({
      depositKrw: 100_000_000,
      seniorMortgageKrw: 300_000_000,
      marketPriceKrw: 400_000_000,
      priorityZone: 'metro',
      hugRegion: 'non_capital',
    });
    expect(result.jeonseRatioPct).toBe(100);
    expect(result.verdict).toBe('danger');
    expect(result.hug.eligible).toBe(false);
    expect(result.hug.reasons.join(' ')).toMatch(/선순위 근저당/);
  });

  it('서울 최우선변제는 1억6,500만원 이하·5,500만원, 부산은 8,500만원 이하·2,800만원이다', () => {
    expect(PRIORITY_REPAYMENT_TABLE.seoul).toEqual({
      depositThresholdKrw: 165_000_000,
      statutoryAmountKrw: 55_000_000,
    });
    const seoul = assessJeonseSafety({
      depositKrw: 150_000_000,
      seniorMortgageKrw: 0,
      marketPriceKrw: 800_000_000,
      priorityZone: 'seoul',
      hugRegion: 'capital',
    });
    expect(seoul.priority.eligible).toBe(true);
    expect(seoul.priority.recognizedKrw).toBe(55_000_000);
  });

  it('최우선변제 인정액은 주택가액의 1/2을 넘지 않는다', () => {
    const result = assessJeonseSafety({
      depositKrw: 40_000_000,
      seniorMortgageKrw: 0,
      marketPriceKrw: 50_000_000,
      priorityZone: 'metro',
      hugRegion: 'non_capital',
    });
    expect(result.priority.statutoryAmountKrw).toBe(28_000_000);
    expect(result.priority.recognizedKrw).toBe(25_000_000);
  });

  it('시세가 없으면 판정 불가로 두고 HUG 사유를 남긴다', () => {
    const result = assessJeonseSafety({
      depositKrw: 300_000_000,
      seniorMortgageKrw: 0,
      marketPriceKrw: 0,
    });
    expect(result.verdict).toBe('unknown');
    expect(result.hug.eligible).toBe(false);
    expect(result.hug.reasons.join(' ')).toMatch(/주택가격/);
  });

  it('HUG 보증한도와 선순위 60% 상한을 함께 계산한다', () => {
    const result = assessJeonseSafety({
      depositKrw: 400_000_000,
      seniorMortgageKrw: 100_000_000,
      marketPriceKrw: 600_000_000,
      hugRegion: 'non_capital',
    });
    expect(result.hug.collateralCapKrw).toBe(540_000_000);
    expect(result.hug.seniorCapKrw).toBe(324_000_000);
    expect(result.hug.maxGuaranteeKrw).toBe(440_000_000);
    expect(result.hug.eligible).toBe(true);
    expect(result.hug.coveredDepositKrw).toBe(400_000_000);
    expect(HUG_GUARANTEE.collateralRatio).toBe(0.9);
  });

  it('시세 -20% 시나리오는 선순위 근저당을 먼저 배당하고 손실을 계산한다', () => {
    const row = recoverableDepositAtDrop({
      depositKrw: 400_000_000,
      seniorMortgageKrw: 100_000_000,
      marketPriceKrw: 600_000_000,
      priorityAmountKrw: 0,
      dropPct: -20,
    });
    expect(row.assumedPriceKrw).toBe(480_000_000);
    expect(row.recoverableKrw).toBe(380_000_000);
    expect(row.lossKrw).toBe(20_000_000);
  });
});
