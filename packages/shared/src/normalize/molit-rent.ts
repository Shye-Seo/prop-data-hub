import { XMLParser } from 'fast-xml-parser';
import { sha256Hex } from '../hash';
import { SOURCE_IDS } from '../constants';
import type { AptRentTransaction, RentContractType } from '../types';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
});

export interface MolitRentParseContext {
  lawdCd: string;
  legalDongCode: string;
  dong: string;
  /** 응답을 받은 시각(ISO). 원천 계약 시점과 구분해 저장한다. */
  collectedAt: string;
  /** 요청한 계약 연월(YYYY-MM). 응답에 연·월이 비어 있을 때 보정에 쓴다. */
  dealMonth: string;
}

export interface MolitRentParseResult {
  totalCount: number;
  pageNo: number;
  numOfRows: number;
  resultCode: string;
  resultMessage: string;
  transactions: AptRentTransaction[];
  skipped: Array<{ reason: string; raw: Record<string, unknown> }>;
}

interface RawItem {
  [key: string]: unknown;
}

export interface RentHashInput {
  lawdCd: string;
  legalDongCode: string;
  aptName: string;
  jibun: string;
  builtYear: number | null;
  dealDate: string;
  floor: number | null;
  areaM2: number;
  depositKrw: number;
  monthlyRentKrw: number;
  contractType: RentContractType;
  contractTermMonths: number | null;
}

/**
 * 전월세 거래 멱등 해시.
 * 매매(deal_hash)와 입력이 다르므로 별도 해시를 쓴다. 보증금·월세·계약유형이 다르면 다른 계약으로 본다.
 * 같은 계약을 재수집할 때 값이 같아야 하므로 정규화 규칙(표기 차이 제거)을 매매와 동일하게 둔다.
 */
export function createRentHash(input: RentHashInput): string {
  const normalizeName = (value: string) =>
    value
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, '')
      .replace(/아파트$/u, '')
      .trim();
  const floor = input.floor === null || Number.isNaN(input.floor) ? '' : String(input.floor);
  const builtYear = input.builtYear === null || Number.isNaN(input.builtYear) ? '' : String(input.builtYear);
  const term = input.contractTermMonths === null ? '' : String(input.contractTermMonths);

  return sha256Hex(
    [
      'rent',
      input.lawdCd.trim(),
      input.legalDongCode.trim(),
      normalizeName(input.aptName),
      input.jibun.trim().replace(/\s+/g, ''),
      builtYear,
      input.dealDate.trim(),
      floor,
      Number(input.areaM2).toFixed(2),
      Math.round(input.depositKrw),
      Math.round(input.monthlyRentKrw),
      input.contractType,
      term,
    ].join('|'),
  );
}

/**
 * 국토교통부 아파트 전월세 실거래가 API(getRTMSDataSvcAptRent) 응답을 정규화한다.
 * XML/JSON을 모두 받고, 금액은 만원 단위 문자열을 원으로 환산한다.
 * 월세 계약은 보증금과 월세를 함께 저장한다(전세가율은 contractType='jeonse'만 쓴다).
 */
export function parseMolitRentResponse(payload: string | unknown, context: MolitRentParseContext): MolitRentParseResult {
  const normalized = normalizeEnvelope(payload);
  const header = (normalized.header ?? {}) as RawItem;
  const body = (normalized.body ?? {}) as RawItem;
  const resultCode = String(header.resultCode ?? '');
  const resultMessage = String(header.resultMsg ?? '');
  const totalCount = Number(body.totalCount ?? 0);
  const pageNo = Number(body.pageNo ?? 1);
  const numOfRows = Number(body.numOfRows ?? 0);

  if (resultCode !== '000' && resultCode !== '00' && resultCode !== 'INFO-0') {
    return {
      totalCount,
      pageNo,
      numOfRows,
      resultCode,
      resultMessage,
      transactions: [],
      skipped: [{ reason: `api_error:${resultCode}`, raw: { resultMessage } }],
    };
  }

  const rawItems = extractItems(body.items as RawItem | undefined);
  const transactions: AptRentTransaction[] = [];
  const skipped: Array<{ reason: string; raw: Record<string, unknown> }> = [];

  for (const raw of rawItems) {
    const parsed = normalizeItem(raw, context);
    if ('reason' in parsed) {
      skipped.push(parsed);
      continue;
    }
    transactions.push(parsed);
  }

  return { totalCount, pageNo, numOfRows, resultCode, resultMessage, transactions, skipped };
}

function normalizeEnvelope(payload: string | unknown): RawItem {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return normalizeEnvelope(JSON.parse(trimmed));
    }
    const parsed = xmlParser.parse(trimmed) as RawItem;
    return (parsed.response ?? parsed) as RawItem;
  }
  const value = (payload ?? {}) as RawItem;
  return (value.response ?? value) as RawItem;
}

function extractItems(itemsNode: RawItem | undefined): RawItem[] {
  if (!itemsNode) return [];
  const item = itemsNode.item;
  if (!item) return [];
  return (Array.isArray(item) ? item : [item]) as RawItem[];
}

function pick(raw: RawItem, names: string[]): string {
  for (const name of names) {
    const value = raw[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function toNumber(value: string): number | null {
  if (!value) return null;
  const numeric = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function toContractType(raw: RawItem): RentContractType {
  const text = pick(raw, ['계약구분', 'contractType', 'ContractType', '전월세구분']).toLowerCase();
  if (text.includes('전세') || text === 'jeonse') return 'jeonse';
  if (text.includes('월세') || text === 'monthly') return 'monthly';
  // 계약구분이 비어 있으면 월세 금액 유무로 판별한다.
  const rent = toNumber(pick(raw, ['월세금액', 'monthlyRent', 'MonthlyRent']));
  return rent && rent > 0 ? 'monthly' : 'jeonse';
}

function normalizeItem(
  raw: RawItem,
  context: MolitRentParseContext,
): AptRentTransaction | { reason: string; raw: Record<string, unknown> } {
  const aptName = pick(raw, ['아파트', 'aptNm', 'AptName']);
  const depositManwon = toNumber(pick(raw, ['보증금액', 'deposit', 'Deposit']));
  const monthlyRentManwon = toNumber(pick(raw, ['월세금액', 'monthlyRent', 'MonthlyRent'])) ?? 0;
  const areaM2 = toNumber(pick(raw, ['전용면적', 'excluUseAr', 'ExcluUseAr']));
  const year = toNumber(pick(raw, ['년', 'dealYear', 'DealYear']));
  const month = toNumber(pick(raw, ['월', 'dealMonth', 'DealMonth']));
  const day = toNumber(pick(raw, ['일', 'dealDay', 'DealDay']));

  if (!aptName) return { reason: 'missing_apt_name', raw };
  if (depositManwon === null || depositManwon <= 0) return { reason: 'invalid_deposit', raw };
  if (areaM2 === null || areaM2 <= 0) return { reason: 'invalid_area', raw };
  if (year === null || month === null) return { reason: 'missing_contract_date', raw };

  const notes: string[] = [];
  let resolvedYear = year;
  let resolvedMonth = month;
  if (month < 1 || month > 12) {
    const [fallbackYear, fallbackMonth] = context.dealMonth.split('-').map(Number);
    resolvedYear = fallbackYear ?? year;
    resolvedMonth = fallbackMonth ?? 1;
    notes.push('contract_month_corrected_from_request');
  }
  const resolvedDay = day && day >= 1 && day <= 31 ? day : 1;
  if (!day) notes.push('contract_day_missing_defaulted_to_1');

  const contractType = toContractType(raw);
  if (contractType === 'jeonse' && monthlyRentManwon > 0) notes.push('jeonse_with_monthly_rent_normalized');
  const monthlyRentKrw = contractType === 'jeonse' ? 0 : Math.round(monthlyRentManwon * 10_000);

  const dealMonth = `${resolvedYear}-${String(resolvedMonth).padStart(2, '0')}`;
  const dealDate = `${dealMonth}-${String(resolvedDay).padStart(2, '0')}`;
  const depositKrw = Math.round(depositManwon * 10_000);
  const builtYear = toNumber(pick(raw, ['건축년도', 'buildYear', 'BuildYear']));
  const floor = toNumber(pick(raw, ['층', 'floor', 'Floor']));
  const jibun = pick(raw, ['지번', 'jibun', 'Jibun']);
  const termMonths = toNumber(pick(raw, ['계약기간', 'contractTerm', 'ContractTerm']));
  const renewalRequested = ['O', 'Y', '1'].includes(pick(raw, ['갱신요구권사용', 'useRRRight', 'UseRRRight']).toUpperCase());

  const rentHash = createRentHash({
    lawdCd: context.lawdCd,
    legalDongCode: context.legalDongCode,
    aptName,
    jibun,
    builtYear,
    dealDate,
    floor,
    areaM2,
    depositKrw,
    monthlyRentKrw,
    contractType,
    contractTermMonths: termMonths,
  });

  return {
    rentHash,
    lawdCd: context.lawdCd,
    legalDongCode: context.legalDongCode,
    dong: pick(raw, ['법정동', 'umdNm', 'UmdNm']) || context.dong,
    aptName,
    complexId: null,
    jibun,
    builtYear,
    dealMonth,
    dealDate,
    floor,
    areaM2: Number(areaM2.toFixed(2)),
    depositKrw,
    monthlyRentKrw,
    contractType,
    contractTermMonths: termMonths,
    renewalRequested,
    sourceId: SOURCE_IDS.molitAptRent,
    asOfDate: `${dealMonth}-01`,
    collectedAt: context.collectedAt,
    sourceNote: notes.length > 0 ? notes.join(',') : null,
  };
}

/** 전월세 실거래 API 요청 URL. 서비스키는 로그에 남기지 않도록 호출부에서만 붙인다. */
export function buildMolitRentUrl(params: {
  endpoint: string;
  serviceKey: string;
  lawdCd: string;
  dealMonth: string;
  pageNo?: number;
  numOfRows?: number;
}): string {
  const url = new URL(params.endpoint);
  url.searchParams.set('serviceKey', params.serviceKey);
  url.searchParams.set('LAWD_CD', params.lawdCd);
  url.searchParams.set('DEAL_YMD', params.dealMonth.replace('-', ''));
  url.searchParams.set('pageNo', String(params.pageNo ?? 1));
  url.searchParams.set('numOfRows', String(params.numOfRows ?? 100));
  return url.toString();
}
