import { describe, expect, it } from 'vitest';
import { buildMolitRentUrl, createRentHash, parseMolitRentResponse } from './molit-rent';
import { MOLIT_RENT_ERROR_XML_SAMPLE, MOLIT_RENT_XML_SAMPLE } from '../fixtures/molit-rent-samples';

const context = {
  lawdCd: '26290',
  legalDongCode: '2629051000',
  dong: '문현동',
  collectedAt: '2026-11-18T02:00:10.000Z',
  dealMonth: '2026-09',
};

describe('parseMolitRentResponse', () => {
  it('전세·월세 계약을 보증금·월세와 함께 정규화한다', () => {
    const result = parseMolitRentResponse(MOLIT_RENT_XML_SAMPLE, context);
    expect(result.resultCode).toBe('000');
    expect(result.transactions).toHaveLength(3);
    expect(result.skipped.map((row) => row.reason)).toEqual(['invalid_deposit']);

    const jeonse = result.transactions[0];
    expect(jeonse?.aptName).toBe('문현베스티움');
    expect(jeonse?.contractType).toBe('jeonse');
    expect(jeonse?.depositKrw).toBe(428_000_000);
    expect(jeonse?.monthlyRentKrw).toBe(0);
    expect(jeonse?.contractTermMonths).toBe(24);
    expect(jeonse?.renewalRequested).toBe(false);
    expect(jeonse?.sourceId).toBe('molit_apt_rent');

    const monthly = result.transactions[1];
    expect(monthly?.contractType).toBe('monthly');
    expect(monthly?.depositKrw).toBe(300_000_000);
    expect(monthly?.monthlyRentKrw).toBe(950_000);
    expect(monthly?.renewalRequested).toBe(true);
  });

  it('계약일이 비면 1일로 보정하고 근거를 남긴다', () => {
    const result = parseMolitRentResponse(MOLIT_RENT_XML_SAMPLE, context);
    const noDay = result.transactions.find((row) => row.aptName === '광안자이');
    expect(noDay?.dealDate).toBe('2026-09-01');
    expect(noDay?.dealMonth).toBe('2026-09');
    expect(noDay?.sourceNote).toContain('contract_day_missing_defaulted_to_1');
    expect(noDay?.contractTermMonths).toBeNull();
  });

  it('같은 계약을 다시 파싱하면 rentHash가 같다', () => {
    const first = parseMolitRentResponse(MOLIT_RENT_XML_SAMPLE, context);
    const second = parseMolitRentResponse(MOLIT_RENT_XML_SAMPLE, { ...context, collectedAt: '2026-11-19T02:00:00.000Z' });
    expect(first.transactions.map((row) => row.rentHash)).toEqual(second.transactions.map((row) => row.rentHash));
    expect(new Set(first.transactions.map((row) => row.rentHash)).size).toBe(3);
  });

  it('보증금·월세·계약유형이 다르면 다른 해시를 만든다', () => {
    const base = {
      lawdCd: '26290',
      legalDongCode: '2629051000',
      aptName: '문현베스티움',
      jibun: '806',
      builtYear: 2019,
      dealDate: '2026-09-14',
      floor: 9,
      areaM2: 84.98,
      depositKrw: 428_000_000,
      monthlyRentKrw: 0,
      contractType: 'jeonse' as const,
      contractTermMonths: 24,
    };
    expect(createRentHash(base)).toBe(createRentHash({ ...base }));
    expect(createRentHash(base)).not.toBe(createRentHash({ ...base, depositKrw: 430_000_000 }));
    expect(createRentHash(base)).not.toBe(createRentHash({ ...base, monthlyRentKrw: 50_000, contractType: 'monthly' }));
  });

  it('API 오류 응답은 거래를 만들지 않고 사유를 남긴다', () => {
    const result = parseMolitRentResponse(MOLIT_RENT_ERROR_XML_SAMPLE, context);
    expect(result.transactions).toHaveLength(0);
    expect(result.resultCode).toBe('SERVICE_KEY_IS_NOT_REGISTERED_ERROR');
    expect(result.skipped[0]?.reason).toContain('api_error');
  });

  it('요청 URL에 시군구·계약연월·페이지를 채운다', () => {
    const url = new URL(
      buildMolitRentUrl({
        endpoint: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
        serviceKey: 'test-key',
        lawdCd: '26500',
        dealMonth: '2026-09',
        pageNo: 2,
        numOfRows: 50,
      }),
    );
    expect(url.searchParams.get('LAWD_CD')).toBe('26500');
    expect(url.searchParams.get('DEAL_YMD')).toBe('202609');
    expect(url.searchParams.get('pageNo')).toBe('2');
    expect(url.searchParams.get('numOfRows')).toBe('50');
  });
});
