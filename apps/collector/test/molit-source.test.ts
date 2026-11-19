import { describe, expect, it } from 'vitest';
import { SAMPLE_REGIONS, buildSampleTransactions } from '@prop/shared';
import { HttpClient } from '../src/http';
import { collectMolitMonth, resolveRegion } from '../src/sources/molit';
import { createFixtureTransport } from '../src/fixtures/transport';

const endpoint = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';

function clientWith(fetchImpl: typeof fetch) {
  return new HttpClient({ fetchImpl, retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 } });
}

describe('collectMolitMonth', () => {
  it('페이지를 끝까지 넘겨 전량을 수집한다', async () => {
    const transport = createFixtureTransport();
    const result = await collectMolitMonth(
      {
        endpoint,
        serviceKey: 'fixture',
        http: clientWith(transport.fetch),
        regions: SAMPLE_REGIONS,
        numOfRows: 10,
        maxPages: 20,
        now: () => new Date('2026-11-19T01:00:00Z'),
      },
      { lawdCd: '26290', dealMonth: '2026-09' },
    );

    const expected = buildSampleTransactions().filter(
      (row) => row.lawdCd === '26290' && row.dealMonth === '2026-09',
    );
    expect(result.pagesFetched).toBeGreaterThan(1);
    expect(result.transactions).toHaveLength(expected.length);
    expect(new Set(result.transactions.map((row) => row.dealHash)).size).toBe(expected.length);
    expect(result.transactions.every((row) => row.legalDongCode.startsWith('262905'))).toBe(true);
    expect(result.transactions.every((row) => row.asOfDate === '2026-09-01')).toBe(true);
  });

  it('지역 마스터에 없는 법정동은 건너뛰고 사유를 남긴다', async () => {
    const xml = `<?xml version="1.0"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
      <body><items><item><거래금액>50,000</거래금액><년>2026</년><월>9</월><일>5</일>
      <법정동>없는동</법정동><아파트>테스트아파트</아파트><지번>1</지번><전용면적>84.9</전용면적><층>3</층></item></items>
      <numOfRows>100</numOfRows><pageNo>1</pageNo><totalCount>1</totalCount></body></response>`;
    const result = await collectMolitMonth(
      {
        endpoint,
        serviceKey: 'fixture',
        http: clientWith((async () => new Response(xml, { status: 200 })) as unknown as typeof fetch),
        regions: SAMPLE_REGIONS,
        now: () => new Date('2026-11-19T00:00:00Z'),
      },
      { lawdCd: '26290', dealMonth: '2026-09' },
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.skipped.map((row) => row.reason)).toContain('unknown_legal_dong');
  });

  it('API 오류 코드는 예외로 올려 재시도·DLQ 경로로 보낸다', async () => {
    const xml = `<?xml version="1.0"?><response><header><resultCode>30</resultCode><resultMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</resultMsg></header><body/></response>`;
    const client = clientWith((async () => new Response(xml, { status: 200 })) as unknown as typeof fetch);
    await expect(
      collectMolitMonth(
        { endpoint, serviceKey: 'bad', http: client, regions: SAMPLE_REGIONS },
        { lawdCd: '26290', dealMonth: '2026-09' },
      ),
    ).rejects.toThrow(/molit_api_error:30/);
  });

  it('재시도가 발생하면 결과에 횟수를 남긴다', async () => {
    const transport = createFixtureTransport({ transientFailures: [{ lawdCd: '26290', dealMonth: '2026-09' }] });
    const result = await collectMolitMonth(
      {
        endpoint,
        serviceKey: 'fixture',
        http: clientWith(transport.fetch),
        regions: SAMPLE_REGIONS,
        numOfRows: 100,
      },
      { lawdCd: '26290', dealMonth: '2026-09' },
    );
    expect(result.retries).toBe(1);
    expect(result.transactions.length).toBeGreaterThan(0);
  });

  it('법정동명으로 10자리 코드를 찾는다', () => {
    expect(resolveRegion(SAMPLE_REGIONS, '26290', '문현동')?.legalDongCode).toBe('2629051000');
    expect(resolveRegion(SAMPLE_REGIONS, '26290', '대연동')?.legalDongCode).toBe('2629052000');
    expect(resolveRegion(SAMPLE_REGIONS, '99999', '문현동')).toBeUndefined();
  });
});
