import { describe, expect, it } from 'vitest';
import { TokenBucketLimiter } from '../src/rate-limiter';

describe('TokenBucketLimiter', () => {
  it('버스트 한도까지는 대기 없이 통과한다', async () => {
    let time = 0;
    const sleeps: number[] = [];
    const limiter = new TokenBucketLimiter({
      ratePerSecond: 5,
      burst: 3,
      now: () => time,
      sleep: async (ms) => {
        sleeps.push(ms);
        time += ms;
      },
    });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(sleeps).toEqual([]);
    expect(limiter.available()).toBeCloseTo(0, 5);
  });

  it('한도를 넘으면 평균 속도에 맞춰 대기한다', async () => {
    let time = 0;
    const sleeps: number[] = [];
    const limiter = new TokenBucketLimiter({
      ratePerSecond: 2,
      burst: 1,
      now: () => time,
      sleep: async (ms) => {
        sleeps.push(ms);
        time += ms;
      },
    });
    await limiter.acquire();
    await limiter.acquire();
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(400);
    expect(sleeps[0]).toBeLessThanOrEqual(500);
    expect(time).toBeGreaterThanOrEqual(500);
  });

  it('경과 시간만큼 토큰이 보충된다', async () => {
    let time = 0;
    const limiter = new TokenBucketLimiter({ ratePerSecond: 1, burst: 2, now: () => time, sleep: async () => {} });
    await limiter.acquire();
    await limiter.acquire();
    time += 1500;
    expect(limiter.available()).toBeGreaterThanOrEqual(1);
  });
});
