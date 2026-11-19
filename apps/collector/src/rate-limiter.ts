/**
 * 소스별 호출 한도 관리.
 * 공공데이터포털은 일일 호출 한도와 초당 제한을 함께 두므로,
 * 짧은 구간의 버스트를 허용하되 평균 속도를 유지하는 토큰 버킷을 쓴다.
 */
export interface RateLimiterOptions {
  /** 초당 허용 요청 수(평균). */
  ratePerSecond: number;
  /** 순간 버스트 허용량. 기본 ratePerSecond. */
  burst?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class TokenBucketLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly ratePerSecond: number;
  private readonly burst: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: RateLimiterOptions) {
    this.ratePerSecond = Math.max(0.1, options.ratePerSecond);
    this.burst = Math.max(1, options.burst ?? Math.ceil(this.ratePerSecond));
    this.tokens = this.burst;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.lastRefill = this.now();
  }

  private refill(): void {
    const now = this.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    if (elapsedSeconds <= 0) return;
    this.tokens = Math.min(this.burst, this.tokens + elapsedSeconds * this.ratePerSecond);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - this.tokens) / this.ratePerSecond) * 1000);
      await this.sleep(Math.max(1, waitMs));
    }
  }

  /** 남은 토큰(디버그·모니터링용). */
  available(): number {
    this.refill();
    return this.tokens;
  }
}
