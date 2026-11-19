import { sha256Hex } from './hash';

export interface DealHashInput {
  lawdCd: string;
  aptName: string;
  legalDongCode: string;
  jibun: string;
  builtYear: number | null;
  dealDate: string;
  floor: number | null;
  areaM2: number;
  priceKrw: number;
  dealType: string;
}

/**
 * 거래 해시 입력을 정규화한다.
 * 같은 거래인데 표기만 다른 경우(공백·법정동 표기·층 표기)가 원천 API에서 흔하므로
 * 비교 가능한 형태로 먼저 맞춘 뒤 해시한다.
 */
export function canonicalDealKey(input: DealHashInput): string {
  const normalizeName = (value: string) =>
    value
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, '')
      .replace(/아파트$/u, '')
      .trim();

  const area = Number(input.areaM2).toFixed(2);
  const price = Math.round(input.priceKrw);
  const floor = input.floor === null || Number.isNaN(input.floor) ? '' : String(input.floor);
  const builtYear = input.builtYear === null || Number.isNaN(input.builtYear) ? '' : String(input.builtYear);

  return [
    input.lawdCd.trim(),
    input.legalDongCode.trim(),
    normalizeName(input.aptName),
    input.jibun.trim().replace(/\s+/g, ''),
    builtYear,
    input.dealDate.trim(),
    floor,
    area,
    price,
    input.dealType.trim() || '중개거래',
  ].join('|');
}

/** 거래 멱등 해시. DB의 apt_transactions.deal_hash 및 ON CONFLICT 키와 같다. */
export function createDealHash(input: DealHashInput): string {
  return sha256Hex(canonicalDealKey(input));
}
