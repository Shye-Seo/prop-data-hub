import { describe, expect, it } from 'vitest';
import { buildDrawdownRanking, selectDrawdownRanking, summarizeDrawdown } from './drawdown';
import type { ApartmentComplex, AptTransaction, Region } from './types';

const MONTHS = [
  '2025-10',
  '2025-11',
  '2025-12',
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
];

const REGIONS: Region[] = [
  { lawdCd: '26290', legalDongCode: '2629010900', sido: '부산광역시', sigungu: '남구', dong: '문현동' },
  { lawdCd: '26500', legalDongCode: '2650010400', sido: '부산광역시', sigungu: '수영구', dong: '광안동' },
];

function complex(id: string, households: number, legalDongCode = '2629010900', lawdCd = '26290'): ApartmentComplex {
  return {
    complexId: id,
    name: `단지${id}`,
    legalDongCode,
    lawdCd,
    builtYear: 2010,
    households,
    representativeAreaM2: 84.9,
  };
}

function deal(params: {
  complexId: string;
  month: string;
  ppp: number;
  areaM2?: number;
  canceled?: boolean;
  seq?: number;
}): AptTransaction {
  const areaM2 = params.areaM2 ?? 84.9;
  return {
    dealHash: `${params.complexId}-${params.month}-${params.ppp}-${params.areaM2 ?? 0}-${params.seq ?? 0}`,
    lawdCd: '26290',
    legalDongCode: '2629010900',
    dong: '문현동',
    aptName: `단지${params.complexId}`,
    complexId: params.complexId,
    jibun: '',
    builtYear: 2010,
    dealMonth: params.month,
    dealDate: `${params.month}-15`,
    floor: 10,
    areaM2,
    priceKrw: Math.round(params.ppp * (areaM2 / 3.305785)),
    pricePerPyeong: params.ppp,
    dealType: '중개거래',
    canceled: params.canceled ?? false,
    sourceId: 'molit_apt_trade',
    asOfDate: `${params.month}-01`,
    collectedAt: `${params.month}-28T02:10:00.000Z`,
    sourceNote: null,
  };
}

function monthlySeries(complexId: string, pppByMonth: number[], areaM2 = 84.9): AptTransaction[] {
  return MONTHS.flatMap((month, index) => [
    deal({ complexId, month, ppp: pppByMonth[index]!, areaM2, seq: 0 }),
    deal({ complexId, month, ppp: pppByMonth[index]!, areaM2, seq: 1 }),
  ]);
}

describe('buildDrawdownRanking', () => {
  it('3개월 이동 중위값으로 전고점 대비 하락률을 계산한다', () => {
    const txs = monthlySeries('A', [10_000_000, 10_000_000, 10_000_000, 9_000_000, 9_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000]);
    const result = buildDrawdownRanking({
      transactions: txs,
      complexes: [complex('A', 500)],
      regions: REGIONS,
      months: MONTHS,
    });
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.peakMonth).toBe('2025-10');
    expect(row.peakPricePerPyeong).toBe(10_000_000);
    expect(row.currentPricePerPyeong).toBe(8_000_000);
    expect(row.drawdownPct).toBe(-20);
    expect(row.drawdownKrw).toBeGreaterThan(0);
    expect(row.areaM2).toBe(84.9);
    expect(row.monthCount).toBe(12);
    expect(row.sampleCount).toBe(24);
  });

  it('계약 해제 거래는 전고점·현재 시세에서 제외한다', () => {
    const txs = [
      ...monthlySeries('A', [9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000]),
      deal({ complexId: 'A', month: '2025-10', ppp: 20_000_000, canceled: true, seq: 9 }),
    ];
    const result = buildDrawdownRanking({
      transactions: txs,
      complexes: [complex('A', 500)],
      regions: REGIONS,
      months: MONTHS,
    });
    expect(result.rows[0]?.peakPricePerPyeong).toBe(9_000_000);
    expect(result.rows[0]?.drawdownPct).toBe(0);
  });

  it('350세대 미만 단지와 표본이 부족한 구간은 순위에서 뺀다', () => {
    const txs = [
      ...monthlySeries('SMALL', [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000, 8_000_000]),
      ...MONTHS.slice(0, 4).flatMap((month) =>
        [0, 1].map((seq) => deal({ complexId: 'THIN', month, ppp: 9_000_000, seq })),
      ),
    ];
    const result = buildDrawdownRanking({
      transactions: txs,
      complexes: [complex('SMALL', 300), complex('THIN', 800)],
      regions: REGIONS,
      months: MONTHS,
    });
    expect(result.rows).toHaveLength(0);
    expect(result.universe.largeComplexes).toBe(1);
    expect(result.universe.skippedThinBands).toBe(1);
  });

  it('면적 구간을 나눠 같은 단지의 59㎡와 84㎡를 따로 계산한다', () => {
    const txs = [
      ...monthlySeries('A', [10_000_000, 10_000_000, 10_000_000, 9_500_000, 9_500_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000], 84.9),
      ...monthlySeries('A', [12_000_000, 12_000_000, 12_000_000, 11_000_000, 10_000_000, 9_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000], 59.9),
    ];
    const result = buildDrawdownRanking({
      transactions: txs,
      complexes: [complex('A', 500)],
      regions: REGIONS,
      months: MONTHS,
    });
    expect(result.rows).toHaveLength(2);
    const defaultRank = selectDrawdownRanking(result.rows);
    expect(defaultRank).toHaveLength(1);
    expect(defaultRank[0]?.areaM2).toBe(84.9);
    expect(defaultRank[0]?.drawdownPct).toBe(-10);
    const bandRank = selectDrawdownRanking(result.rows, { areaBand: 'under60' });
    expect(bandRank).toHaveLength(1);
    expect(bandRank[0]?.areaM2).toBe(59.9);
    expect(bandRank[0]?.drawdownPct).toBeLessThan(-30);
  });

  it('하락률 오름차순으로 정렬하고 구·면적 조건과 요약을 적용한다', () => {
    const txs = [
      ...monthlySeries('A', [10_000_000, 10_000_000, 10_000_000, 9_500_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000, 9_000_000]),
      ...monthlySeries('B', [8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 8_000_000, 7_000_000, 6_500_000, 6_000_000]),
    ];
    const result = buildDrawdownRanking({
      transactions: txs,
      complexes: [
        complex('A', 500),
        complex('B', 1200, '2650010400', '26500'),
      ],
      regions: REGIONS,
      months: MONTHS,
    });
    const ranked = selectDrawdownRanking(result.rows, { onlyDeclined: true });
    expect(ranked.map((row) => row.complexId)).toEqual(['B', 'A']);
    expect(ranked[0]?.rank).toBe(1);
    expect(ranked[0]?.sigungu).toBe('수영구');

    const filtered = selectDrawdownRanking(result.rows, { lawdCds: ['26290'] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.complexId).toBe('A');

    const summary = summarizeDrawdown(ranked);
    expect(summary.count).toBe(2);
    expect(summary.declinedCount).toBe(2);
    expect(summary.worstComplexName).toBe('단지B');
    expect(summary.worstDrawdownPct).toBeLessThan(-15);
  });
});
