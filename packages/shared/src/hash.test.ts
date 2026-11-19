import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash';

describe('sha256Hex', () => {
  it('알려진 벡터와 일치한다', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('입력 길이가 블록 경계를 넘어도 정확한 값을 낸다', () => {
    // 56바이트는 패딩 블록이 하나 더 붙는 경계다.
    expect(sha256Hex('a'.repeat(56))).toBe(sha256Hex('a'.repeat(56)));
    expect(sha256Hex('a'.repeat(56))).not.toBe(sha256Hex('a'.repeat(55)));
    expect(sha256Hex('한국어 입력')).toHaveLength(64);
  });
});
