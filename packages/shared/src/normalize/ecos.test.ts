import { describe, expect, it } from 'vitest';
import { buildEcosUrl, parseEcosResponse, toPeriodDate } from './ecos';
import { ECOS_ERROR_JSON_SAMPLE, ECOS_JSON_SAMPLE } from '../fixtures/molit-samples';

const context = {
  statCode: '722Y001',
  indicatorCode: 'base_rate',
  indicatorName: '한국은행 기준금리',
  cycle: 'M' as const,
  collectedAt: '2026-11-18T03:15:02.000Z',
};

describe('parseEcosResponse', () => {
  it('월간 지표를 기준일(말일)과 함께 정규화한다', () => {
    const result = parseEcosResponse(ECOS_JSON_SAMPLE, context);
    expect(result.resultCode).toBe('INFO-000');
    expect(result.indicators).toHaveLength(3);
    expect(result.indicators[0]?.periodDate).toBe('2026-07-31');
    expect(result.indicators[0]?.value).toBe(2.5);
    expect(result.indicators[2]?.value).toBe(2.25);
    expect(result.indicators[2]?.indicatorName).toBe('한국은행 기준금리');
    expect(result.indicators[0]?.sourceId).toBe('ecos_rates');
  });

  it('RESULT 코드가 실패면 지표를 만들지 않는다', () => {
    const result = parseEcosResponse(ECOS_ERROR_JSON_SAMPLE, context);
    expect(result.indicators).toEqual([]);
    expect(result.resultCode).toBe('ERROR-100');
  });

  it('값이 비었거나 숫자가 아닌 행은 건너뛴다', () => {
    const payload = {
      StatisticSearch: {
        RESULT: { CODE: 'INFO-000', MESSAGE: 'OK' },
        row: [
          { TIME: '202601', DATA_VALUE: '2.5', UNIT_NAME: '연%' },
          { TIME: '202602', DATA_VALUE: '잠정', UNIT_NAME: '연%' },
          { TIME: '', DATA_VALUE: '2.5', UNIT_NAME: '연%' },
        ],
      },
    };
    const result = parseEcosResponse(payload, context);
    expect(result.indicators).toHaveLength(1);
  });

  it('일간·연간 주기의 기준일도 변환한다', () => {
    expect(toPeriodDate('20260912', 'D')).toBe('2026-09-12');
    expect(toPeriodDate('2026', 'A')).toBe('2026-12-31');
    expect(toPeriodDate('202613', 'M')).toBeNull();
  });

  it('ECOS 요청 URL에 통계표·주기·기간을 넣는다', () => {
    const url = buildEcosUrl({
      endpoint: 'https://ecos.bok.or.kr/api',
      apiKey: 'KEY',
      statCode: '722Y001',
      cycle: 'M',
      startPeriod: '202401',
      endPeriod: '202612',
      itemCode: '0101000',
    });
    expect(url).toBe(
      'https://ecos.bok.or.kr/api/StatisticSearch/KEY/json/kr/1/1000/722Y001/M/202401/202612/0101000',
    );
  });
});
