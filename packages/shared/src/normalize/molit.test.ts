import { describe, expect, it } from 'vitest';
import { buildMolitTradeUrl, parseMolitResponse } from './molit';
import { MOLIT_ERROR_XML_SAMPLE, MOLIT_JSON_SAMPLE, MOLIT_XML_SAMPLE } from '../fixtures/molit-samples';

const context = {
  lawdCd: '26290',
  legalDongCode: '2629051000',
  dong: '문현동',
  collectedAt: '2026-11-18T02:00:10.000Z',
  dealMonth: '2026-09',
};

describe('parseMolitResponse', () => {
  it('XML 응답에서 유효 거래만 정규화한다', () => {
    const result = parseMolitResponse(MOLIT_XML_SAMPLE, context);
    expect(result.resultCode).toBe('000');
    expect(result.transactions).toHaveLength(4);
    // 금액 0원 1건은 invalid_price로 제외된다.
    expect(result.skipped.map((row) => row.reason)).toEqual(['invalid_price']);

    const [first] = result.transactions;
    expect(first?.aptName).toBe('문현베스티움');
    expect(first?.priceKrw).toBe(845_000_000);
    expect(first?.dealDate).toBe('2026-09-12');
    expect(first?.dealMonth).toBe('2026-09');
    expect(first?.areaM2).toBe(84.98);
    expect(first?.pricePerPyeong).toBe(32_871_126);
    expect(first?.canceled).toBe(false);
    expect(first?.sourceId).toBe('molit_apt_trade');
  });

  it('계약일이 비어 있으면 1일로 보정하고 근거를 남긴다', () => {
    const result = parseMolitResponse(MOLIT_XML_SAMPLE, context);
    const noDay = result.transactions.find((row) => row.aptName === '오션파라곤');
    expect(noDay?.dealDate).toBe('2026-09-01');
    expect(noDay?.sourceNote).toContain('contract_day_missing_defaulted_to_1');
  });

  it('해제 거래는 버리지 않고 canceled로 표시한다', () => {
    const result = parseMolitResponse(MOLIT_XML_SAMPLE, context);
    const canceled = result.transactions.find((row) => row.canceled);
    expect(canceled?.dealMonth).toBe('2026-08');
    expect(canceled?.sourceNote).toContain('contract_canceled');
  });

  it('JSON 응답도 같은 형태로 정규화한다', () => {
    const result = parseMolitResponse(MOLIT_JSON_SAMPLE, context);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]?.aptName).toBe('대연롯데캐슬레전드');
    expect(result.transactions[0]?.priceKrw).toBe(810_000_000);
    expect(result.transactions[1]?.pricePerPyeong).toBeGreaterThan(0);
  });

  it('문자열로 직렬화된 JSON도 처리한다', () => {
    const result = parseMolitResponse(JSON.stringify(MOLIT_JSON_SAMPLE), context);
    expect(result.transactions).toHaveLength(2);
  });

  it('API 오류 응답은 거래 없이 오류 코드를 반환한다', () => {
    const result = parseMolitResponse(MOLIT_ERROR_XML_SAMPLE, context);
    expect(result.transactions).toEqual([]);
    expect(result.resultCode).toBe('30');
    expect(result.skipped[0]?.reason).toBe('api_error:30');
  });

  it('같은 응답을 두 번 파싱해도 deal_hash가 같다', () => {
    const first = parseMolitResponse(MOLIT_XML_SAMPLE, context);
    const second = parseMolitResponse(MOLIT_XML_SAMPLE, context);
    expect(first.transactions.map((row) => row.dealHash)).toEqual(second.transactions.map((row) => row.dealHash));
  });

  it('요청 URL에 지역코드·계약월·페이지를 채운다', () => {
    const url = new URL(
      buildMolitTradeUrl({
        endpoint: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
        serviceKey: 'test-key',
        lawdCd: '26290',
        dealMonth: '2026-09',
        pageNo: 3,
        numOfRows: 500,
      }),
    );
    expect(url.searchParams.get('LAWD_CD')).toBe('26290');
    expect(url.searchParams.get('DEAL_YMD')).toBe('202609');
    expect(url.searchParams.get('pageNo')).toBe('3');
    expect(url.searchParams.get('numOfRows')).toBe('500');
  });
});
