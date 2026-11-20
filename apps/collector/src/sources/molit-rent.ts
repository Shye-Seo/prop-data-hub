import {
  buildMolitRentUrl,
  createRentHash,
  parseMolitRentResponse,
  SOURCE_IDS,
  type AptRentTransaction,
  type Region,
} from '@prop/shared';
import type { HttpClient } from '../http';
import { resolveRegion } from './molit';

export interface MolitRentCollectOptions {
  endpoint: string;
  serviceKey: string;
  http: HttpClient;
  regions: Region[];
  numOfRows?: number;
  /** 페이지 폭주 방지 상한. 100건×20페이지 = 월 2,000건까지 수집한다. */
  maxPages?: number;
  now?: () => Date;
}

export interface MolitRentMonthResult {
  lawdCd: string;
  dealMonth: string;
  totalCount: number;
  pagesFetched: number;
  transactions: AptRentTransaction[];
  skipped: Array<{ reason: string; raw: Record<string, unknown> }>;
  retries: number;
  asOfDate: string;
}

/**
 * 국토교통부 전월세 실거래가 API에서 한 달치를 수집한다.
 * 실거래(매매) 수집과 같은 페이지네이션·법정동 매핑 규칙을 쓰고, 전세·월세를 모두 받는다.
 * 계약 유형에 따라 보증금·월세가 함께 저장되며, 전세가율 계산은 contractType='jeonse'만 쓴다.
 */
export async function collectMolitRentMonth(
  options: MolitRentCollectOptions,
  task: { lawdCd: string; dealMonth: string },
): Promise<MolitRentMonthResult> {
  const numOfRows = options.numOfRows ?? 100;
  const maxPages = options.maxPages ?? 20;
  const now = options.now ?? (() => new Date());
  const collectedAt = now().toISOString();
  const before = options.http.stats.retries;

  const transactions: AptRentTransaction[] = [];
  const skipped: Array<{ reason: string; raw: Record<string, unknown> }> = [];
  let totalCount = 0;
  let pageNo = 1;
  let pagesFetched = 0;

  while (pageNo <= maxPages) {
    const url = buildMolitRentUrl({
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
    const parsed = parseMolitRentResponse(response.body, {
      lawdCd: task.lawdCd,
      legalDongCode: fallbackRegion?.legalDongCode ?? `${task.lawdCd}00000`,
      dong: fallbackRegion?.dong ?? '',
      collectedAt,
      dealMonth: task.dealMonth,
    });

    if (parsed.resultCode !== '000' && parsed.resultCode !== '00' && parsed.resultCode !== 'INFO-0') {
      throw new Error(`molit_rent_api_error:${parsed.resultCode}:${parsed.resultMessage}`);
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
        rentHash: createRentHash({
          lawdCd: transaction.lawdCd,
          legalDongCode: region.legalDongCode,
          aptName: transaction.aptName,
          jibun: transaction.jibun,
          builtYear: transaction.builtYear,
          dealDate: transaction.dealDate,
          floor: transaction.floor,
          areaM2: transaction.areaM2,
          depositKrw: transaction.depositKrw,
          monthlyRentKrw: transaction.monthlyRentKrw,
          contractType: transaction.contractType,
          contractTermMonths: transaction.contractTermMonths,
        }),
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

export const MOLIT_RENT_SOURCE_ID = SOURCE_IDS.molitAptRent;
