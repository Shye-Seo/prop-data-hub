import {
  buildMolitTradeUrl,
  parseMolitResponse,
  createDealHash,
  pricePerPyeongKrw,
  SOURCE_IDS,
  type AptTransaction,
  type Region,
} from '@prop/shared';
import type { HttpClient } from '../http';

export interface MolitCollectOptions {
  endpoint: string;
  serviceKey: string;
  http: HttpClient;
  regions: Region[];
  numOfRows?: number;
  /** 페이지 폭주 방지 상한. 100건×20페이지 = 월 2,000건까지 수집한다. */
  maxPages?: number;
  now?: () => Date;
}

export interface MolitMonthResult {
  lawdCd: string;
  dealMonth: string;
  totalCount: number;
  pagesFetched: number;
  transactions: AptTransaction[];
  skipped: Array<{ reason: string; raw: Record<string, unknown> }>;
  retries: number;
  asOfDate: string;
}

/** 실거래 응답은 법정동명만 주므로, 지역 마스터의 (법정동명, 시군구코드)로 10자리 코드를 찾는다. */
export function resolveRegion(regions: Region[], lawdCd: string, dongName: string): Region | undefined {
  return regions.find((region) => region.lawdCd === lawdCd && region.dong === dongName.trim());
}

export async function collectMolitMonth(
  options: MolitCollectOptions,
  task: { lawdCd: string; dealMonth: string },
): Promise<MolitMonthResult> {
  const numOfRows = options.numOfRows ?? 100;
  const maxPages = options.maxPages ?? 20;
  const now = options.now ?? (() => new Date());
  const collectedAt = now().toISOString();
  const before = options.http.stats.retries;

  const transactions: AptTransaction[] = [];
  const skipped: Array<{ reason: string; raw: Record<string, unknown> }> = [];
  let totalCount = 0;
  let pageNo = 1;
  let pagesFetched = 0;

  while (pageNo <= maxPages) {
    const url = buildMolitTradeUrl({
      endpoint: options.endpoint,
      serviceKey: options.serviceKey,
      lawdCd: task.lawdCd,
      dealMonth: task.dealMonth,
      pageNo,
      numOfRows,
    });

    const response = await options.http.get(url);
    pagesFetched += 1;

    const fallbackRegion = options.regions.find((region) => region.lawdCd === task.lawdCd);
    const parsed = parseMolitResponse(response.body, {
      lawdCd: task.lawdCd,
      legalDongCode: fallbackRegion?.legalDongCode ?? `${task.lawdCd}00000`,
      dong: fallbackRegion?.dong ?? '',
      collectedAt,
      dealMonth: task.dealMonth,
    });

    if (parsed.resultCode !== '000' && parsed.resultCode !== '00' && parsed.resultCode !== 'INFO-0') {
      throw new Error(`molit_api_error:${parsed.resultCode}:${parsed.resultMessage}`);
    }

    totalCount = parsed.totalCount;
    skipped.push(...parsed.skipped);

    for (const transaction of parsed.transactions) {
      const region = resolveRegion(options.regions, task.lawdCd, transaction.dong);
      if (!region) {
        skipped.push({ reason: 'unknown_legal_dong', raw: { dong: transaction.dong, lawdCd: task.lawdCd } });
        continue;
      }
      transactions.push({
        ...transaction,
        legalDongCode: region.legalDongCode,
        complexId: transaction.complexId ?? null,
        dealHash: createDealHash({
          lawdCd: transaction.lawdCd,
          aptName: transaction.aptName,
          legalDongCode: region.legalDongCode,
          jibun: transaction.jibun,
          builtYear: transaction.builtYear,
          dealDate: transaction.dealDate,
          floor: transaction.floor,
          areaM2: transaction.areaM2,
          priceKrw: transaction.priceKrw,
          dealType: transaction.dealType,
        }),
        pricePerPyeong:
          transaction.pricePerPyeong || pricePerPyeongKrw(transaction.priceKrw, transaction.areaM2),
      });
    }

    if (parsed.transactions.length === 0) break;
    if (pageNo * numOfRows >= totalCount) break;
    pageNo += 1;
  }

  return {
    lawdCd: task.lawdCd,
    dealMonth: task.dealMonth,
    totalCount,
    pagesFetched,
    transactions,
    skipped,
    retries: options.http.stats.retries - before,
    asOfDate: `${task.dealMonth}-01`,
  };
}

export const MOLIT_SOURCE_ID = SOURCE_IDS.molitAptTrade;
