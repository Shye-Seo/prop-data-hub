import { buildSampleRentTransactions, buildSampleTransactions, SOURCE_IDS } from '@prop/shared';
import { transactionsToMolitXml } from './molit-xml';
import { rentsToMolitXml } from './molit-rent-xml';

export interface FixtureTransportOptions {
  /** 항상 504로 실패시킬 (지역, 월) 조합. 부분 실패와 DLQ 경로를 재현한다. */
  hardFailures?: Array<{ lawdCd: string; dealMonth?: string }>;
  /** 첫 호출만 500으로 실패시킬 (지역, 월) 조합. 재시도 경로를 재현한다. */
  transientFailures?: Array<{ lawdCd: string; dealMonth?: string }>;
}

export interface FixtureTransport {
  fetch: typeof fetch;
  calls: Array<{ url: string; attempt: number }>;
}

/**
 * 실제 API 키 없이 수집 파이프라인 전체 경로를 돌리기 위한 응답 시뮬레이터.
 * 응답 본문은 국토교통부 API와 같은 XML 구조이며, 데이터는 저장소의 샘플 표본을 쓴다.
 */
export function createFixtureTransport(options: FixtureTransportOptions = {}): FixtureTransport {
  const transactions = buildSampleTransactions();
  const rents = buildSampleRentTransactions();
  const calls: Array<{ url: string; attempt: number }> = [];
  const attempts = new Map<string, number>();

  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url);
    const key = `${parsed.pathname}?${parsed.searchParams.toString()}`;
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    calls.push({ url, attempt });

    // ECOS 응답
    if (parsed.pathname.includes('/StatisticSearch/')) {
      return jsonResponse({
        StatisticSearch: {
          RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' },
          row: [
            { TIME: '202608', DATA_VALUE: '2.5', UNIT_NAME: '연%', ITEM_NAME1: '한국은행 기준금리' },
            { TIME: '202609', DATA_VALUE: '2.25', UNIT_NAME: '연%', ITEM_NAME1: '한국은행 기준금리' },
          ],
        },
      });
    }

    const lawdCd = parsed.searchParams.get('LAWD_CD') ?? '';
    const dealYmd = parsed.searchParams.get('DEAL_YMD') ?? '';
    const dealMonth = `${dealYmd.slice(0, 4)}-${dealYmd.slice(4, 6)}`;
    const pageNo = Number(parsed.searchParams.get('pageNo') ?? 1);
    const numOfRows = Number(parsed.searchParams.get('numOfRows') ?? 100);

    const isHardFailure = (options.hardFailures ?? []).some(
      (rule) => rule.lawdCd === lawdCd && (!rule.dealMonth || rule.dealMonth === dealMonth),
    );
    if (isHardFailure) return errorResponse(504, 'Gateway Timeout');

    const isTransient = (options.transientFailures ?? []).some(
      (rule) => rule.lawdCd === lawdCd && (!rule.dealMonth || rule.dealMonth === dealMonth),
    );
    if (isTransient && attempt === 1) return errorResponse(500, 'Internal Server Error');

    // 시군구 단위 응답이므로 법정동 구분 없이 해당 월 전체를 돌려준다.
    if (parsed.pathname.includes('AptRent')) {
      const scopedRents = rents.filter((row) => row.lawdCd === lawdCd && row.dealMonth === dealMonth);
      const rentSlice = scopedRents.slice((pageNo - 1) * numOfRows, pageNo * numOfRows);
      return new Response(
        rentsToMolitXml(rentSlice, { totalCount: scopedRents.length, pageNo, numOfRows }),
        { status: 200, headers: { 'content-type': 'application/xml; charset=utf-8' } },
      );
    }

    const scoped = transactions.filter((row) => row.lawdCd === lawdCd && row.dealMonth === dealMonth);
    const slice = scoped.slice((pageNo - 1) * numOfRows, pageNo * numOfRows);

    return new Response(
      transactionsToMolitXml(slice, { totalCount: scoped.length, pageNo, numOfRows }),
      { status: 200, headers: { 'content-type': 'application/xml; charset=utf-8' } },
    );
  };

  return { fetch: fetchImpl, calls };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><response><header><resultMsg>${message}</resultMsg></header></response>`,
    { status, headers: { 'content-type': 'application/xml' } },
  );
}

export const FIXTURE_SOURCE = SOURCE_IDS.molitAptTrade;
