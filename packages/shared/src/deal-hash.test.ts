import { describe, expect, it } from 'vitest';
import { canonicalDealKey, createDealHash } from './deal-hash';

const base = {
  lawdCd: '26290',
  aptName: '문현베스티움',
  legalDongCode: '2629051000',
  jibun: '806',
  builtYear: 2019,
  dealDate: '2026-09-12',
  floor: 12,
  areaM2: 84.98,
  priceKrw: 845_000_000,
  dealType: '중개거래',
};

describe('createDealHash', () => {
  it('같은 거래는 여러 번 계산해도 같은 해시를 낸다', () => {
    expect(createDealHash(base)).toBe(createDealHash({ ...base }));
    expect(createDealHash(base)).toHaveLength(64);
  });

  it('단지명 표기 차이(공백·괄호·"아파트" 접미사)는 같은 거래로 묶는다', () => {
    expect(createDealHash({ ...base, aptName: '문현 베스티움' })).toBe(createDealHash(base));
    expect(createDealHash({ ...base, aptName: '문현베스티움아파트' })).toBe(createDealHash(base));
    expect(createDealHash({ ...base, aptName: '문현베스티움(101동)' })).toBe(createDealHash(base));
  });

  it('금액·층·계약일이 다르면 다른 거래로 본다', () => {
    const hash = createDealHash(base);
    expect(createDealHash({ ...base, priceKrw: 845_500_000 })).not.toBe(hash);
    expect(createDealHash({ ...base, floor: 13 })).not.toBe(hash);
    expect(createDealHash({ ...base, dealDate: '2026-09-13' })).not.toBe(hash);
  });

  it('면적은 소수 둘째 자리까지만 반영한다', () => {
    expect(createDealHash({ ...base, areaM2: 84.9801 })).toBe(createDealHash({ ...base, areaM2: 84.98 }));
  });

  it('canonical key는 구분자 충돌 없이 필드를 이어 붙인다', () => {
    expect(canonicalDealKey(base)).toBe('26290|2629051000|문현베스티움|806|2019|2026-09-12|12|84.98|845000000|중개거래');
  });
});
