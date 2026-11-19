import { XMLParser } from 'fast-xml-parser';
import { createDealHash } from '../deal-hash';
import { pricePerPyeongKrw } from '../metrics';
import { SOURCE_IDS } from '../constants';
import type { AptTransaction } from '../types';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
});

export interface MolitParseContext {
  lawdCd: string;
  legalDongCode: string;
  dong: string;
  /** 응답을 받은 시각(ISO). 원천의 기준일과 구분해 저장한다. */
  collectedAt: string;
  /** 요청한 계약 연월(YYYY-MM). 응답에 연·월이 비어 있을 때 보정에 쓴다. */
  dealMonth: string;
}

export interface MolitParseResult {
  totalCount: number;
  pageNo: number;
  numOfRows: number;
  resultCode: string;
  resultMessage: string;
  transactions: AptTransaction[];
  skipped: Array<{ reason: string; raw: Record<string, unknown> }>;
}

interface RawItem {
  [key: string]: unknown;
}

/**
 * 국토교통부 아파트 매매 실거래가 API(apartment trade) 응답을 정규화한다.
 * 공공데이터포털은 XML/JSON 두 형식을 모두 주므로 한 파서에서 처리한다.
 * JSON 응답은 XML 노드명이 그대로 key로 오지만, 일부 항목은 띄어쓰기 없는 이름으로 온다.
 */
export function parseMolitResponse(payload: string | unknown, context: MolitParseContext): MolitParseResult {
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

  const itemsNode = body.items as RawItem | undefined;
  const rawItems = extractItems(itemsNode);
  const transactions: AptTransaction[] = [];
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

function normalizeItem(
  raw: RawItem,
  context: MolitParseContext,
): AptTransaction | { reason: string; raw: Record<string, unknown> } {
  const aptName = pick(raw, ['아파트', 'aptNm', 'AptName']);
  const priceManwon = toNumber(pick(raw, ['거래금액', 'dealAmount', 'DealAmount']));
  const areaM2 = toNumber(pick(raw, ['전용면적', 'excluUseAr', 'ExcluUseAr']));
  const year = toNumber(pick(raw, ['년', 'dealYear', 'DealYear']));
  const month = toNumber(pick(raw, ['월', 'dealMonth', 'DealMonth']));
  const day = toNumber(pick(raw, ['일', 'dealDay', 'DealDay']));

  if (!aptName) return { reason: 'missing_apt_name', raw };
  if (priceManwon === null || priceManwon <= 0) return { reason: 'invalid_price', raw };
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

  const dealMonth = `${resolvedYear}-${String(resolvedMonth).padStart(2, '0')}`;
  const dealDate = `${dealMonth}-${String(resolvedDay).padStart(2, '0')}`;
  const priceKrw = Math.round(priceManwon * 10_000);
  const builtYear = toNumber(pick(raw, ['건축년도', 'buildYear', 'BuildYear']));
  const floor = toNumber(pick(raw, ['층', 'floor', 'Floor']));
  const jibun = pick(raw, ['지번', 'jibun', 'Jibun']);
  const dealType = pick(raw, ['거래유형', 'dealingGbn', 'DealingGbn']) || '중개거래';
  const canceled = ['O', 'Y', '1'].includes(pick(raw, ['해제여부', 'cdealType', 'CdealType']).toUpperCase());
  if (canceled) notes.push('contract_canceled');
  const asOfDate = `${dealMonth}-01`;

  const dealHash = createDealHash({
    lawdCd: context.lawdCd,
    aptName,
    legalDongCode: context.legalDongCode,
    jibun,
    builtYear,
    dealDate,
    floor,
    areaM2,
    priceKrw,
    dealType,
  });

  return {
    dealHash,
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
    priceKrw,
    pricePerPyeong: pricePerPyeongKrw(priceKrw, areaM2),
    dealType,
    canceled,
    sourceId: SOURCE_IDS.molitAptTrade,
    asOfDate,
    collectedAt: context.collectedAt,
    sourceNote: notes.length > 0 ? notes.join(',') : null,
  };
}

/** 실거래가 공개 API의 요청 URL. 서비스키는 로그에 남기지 않도록 호출부에서만 붙인다. */
export function buildMolitTradeUrl(params: {
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
