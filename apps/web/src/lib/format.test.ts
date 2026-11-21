import { describe, expect, it } from 'vitest';
import {
  formatArea,
  formatAreaWithPyeong,
  formatCompactKrw,
  formatDate,
  formatKrwKorean,
  formatMonth,
  formatMonthShort,
  formatPct,
  formatPyeong,
} from './format';

describe('표기 형식', () => {
  it('금액을 억·만원으로 읽기 쉽게 바꾼다', () => {
    expect(formatKrwKorean(845_000_000)).toBe('8억 4,500만원');
    expect(formatKrwKorean(0)).toBe('0원');
    expect(formatCompactKrw(628_000_000)).toBe('6.3억');
    expect(formatCompactKrw(41_000_000)).toBe('4,100만');
  });

  it('월·일 표기를 화면 기준으로 맞춘다', () => {
    expect(formatMonth('2026-09')).toBe('2026.09');
    expect(formatMonthShort('2026-09')).toBe('26.09');
    expect(formatDate('2026-09-12')).toBe('2026.09.12');
  });

  it('면적과 평을 함께 표기한다', () => {
    expect(formatArea(84.98)).toBe('84.98㎡');
    expect(formatPyeong(84.98)).toBe('25.7평');
  });

  it('면적 옆에 평 환산을 괄호로 붙인다', () => {
    // 1평 = 3.305785㎡ 기준. 84.98㎡ = 25.7평
    expect(formatAreaWithPyeong(84.98)).toBe('84.98㎡ (25.7평)');
    expect(formatAreaWithPyeong(59.98)).toBe('59.98㎡ (18.1평)');
    // 정수로 떨어지는 면적은 뒤의 0을 지워 84㎡ (25평)처럼 읽히게 한다.
    expect(formatAreaWithPyeong(84)).toBe('84㎡ (25.4평)');
    expect(formatAreaWithPyeong(115)).toBe('115㎡ (34.8평)');
    expect(formatAreaWithPyeong(Number.NaN)).toBe('-');
  });

  it('증감률은 부호를 붙인다', () => {
    expect(formatPct(3.25)).toBe('+3.3%');
    expect(formatPct(-1.2)).toBe('-1.2%');
    expect(formatPct(0)).toBe('0.0%');
  });
});
