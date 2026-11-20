import { describe, expect, it } from 'vitest';
import { SAMPLE_REGIONS } from '@prop/shared';
import { HttpClient } from '../src/http';
import { collectMolitRentMonth } from '../src/sources/molit-rent';
import { createFixtureTransport } from '../src/fixtures/transport';

const endpoint = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';

function http(fetchImpl: typeof fetch): HttpClient {
  return new HttpClient({ fetchImpl, retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 } });
}

describe('collectMolitRentMonth', () => {
  it('시군구·월 단위로 전월세를 수집하고 법정동 코드를 채운다', async () => {
    const result = await collectMolitRentMonth(
      {
        endpoint,
        serviceKey: 'fixture',
        http: http(createFixtureTransport().fetch),
        regions: SAMPLE_REGIONS,
        now: () => new Date('2026-11-19T02:00:00Z'),
      },
      { lawdCd: '26290', dealMonth: '2026-09' },
    );

    expect(result.transactions.length).toBeGreaterThan(0);
    expect(result.asOfDate).toBe('2026-09-01');
    for (const row of result.transactions) {
      expect(row.lawdCd).toBe('26290');
      expect(row.dealMonth).toBe('2026-09');
      expect(row.sourceId).toBe('molit_apt_rent');
      expect(['jeonse', 'monthly']).toContain(row.contractType);
      expect(row.legalDongCode).toHaveLength(10);
      expect(row.depositKrw).toBeGreaterThan(0);
      if (row.contractType === 'jeonse') expect(row.monthlyRentKrw).toBe(0);
      if (row.contractType === 'monthly') expect(row.monthlyRentKrw).toBeGreaterThan(0);
    }
    expect(new Set(result.transactions.map((row) => row.complexId)).size).toBeGreaterThan(0);
  });

  it('페이지 상한을 넘기지 않고 numOfRows 단위로 나눠 받는다', async () => {
    const transport = createFixtureTransport();
    const result = await collectMolitRentMonth(
      {
        endpoint,
        serviceKey: 'fixture',
        http: http(transport.fetch),
        regions: SAMPLE_REGIONS,
        numOfRows: 5,
        maxPages: 2,
      },
      { lawdCd: '26500', dealMonth: '2026-09' },
    );
    expect(result.pagesFetched).toBe(2);
    expect(result.transactions.length).toBeLessThanOrEqual(10);
    expect(transport.calls.filter((call) => call.url.includes('AptRent')).length).toBe(2);
  });

  it('지역 마스터에 없는 법정동은 건너뛰고 사유를 남긴다', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
  <body>
    <items>
      <item>
        <보증금액>30,000</보증금액><월세금액>0</월세금액><계약구분>전세</계약구분>
        <년>2026</년><월>9</월><일>5</일><법정동>없는동</법정동><아파트>테스트아파트</아파트>
        <지번>1</지번><전용면적>84.9</전용면적><층>3</층>
      </item>
    </items>
    <numOfRows>1</numOfRows><pageNo>1</pageNo><totalCount>1</totalCount>
  </body>
</response>`;
    const result = await collectMolitRentMonth(
      {
        endpoint,
        serviceKey: 'fixture',
        http: http(async () => new Response(xml, { status: 200 })),
        regions: SAMPLE_REGIONS,
      },
      { lawdCd: '26290', dealMonth: '2026-09' },
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.skipped.map((row) => row.reason)).toContain('unknown_legal_dong');
  });

  it('API 오류 코드는 예외로 올려 실행을 실패 처리하게 한다', async () => {
    const xml = `<?xml version="1.0"?><response><header><resultCode>30</resultCode><resultMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</resultMsg></header><body/></response>`;
    await expect(
      collectMolitRentMonth(
        {
          endpoint,
          serviceKey: 'fixture',
          http: http(async () => new Response(xml, { status: 200 })),
          regions: SAMPLE_REGIONS,
        },
        { lawdCd: '26290', dealMonth: '2026-09' },
      ),
    ).rejects.toThrow(/molit_rent_api_error:30/);
  });
});
