import { RETRY_POLICY } from '@prop/shared';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
}

export interface HttpClientOptions {
  timeoutMs?: number;
  retry?: RetryPolicy;
  /** 재시도 사이 대기. 테스트에서는 즉시 통과하도록 주입한다. */
  sleep?: (ms: number) => Promise<void>;
  /** 요청 전 호출. rate-limit 토큰 획득에 쓴다. */
  beforeRequest?: () => Promise<void>;
  fetchImpl?: typeof fetch;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
    readonly attempts: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface HttpResult {
  status: number;
  body: string;
  attempts: number;
  headers: Record<string, string>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function shouldRetry(status: number | null): boolean {
  if (status === null) return true; // 네트워크 오류·타임아웃
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500;
}

/**
 * 공공데이터 API 호출용 HTTP 클라이언트.
 * - 요청별 타임아웃
 * - 429/5xx/네트워크 오류만 지수 백오프로 재시도(4xx는 즉시 실패)
 * - Retry-After 헤더를 우선 적용
 * - 재시도 전 rate-limit 토큰 획득
 */
export class HttpClient {
  private readonly timeoutMs: number;
  private readonly policy: RetryPolicy;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly beforeRequest: () => Promise<void>;
  private readonly fetchImpl: typeof fetch;
  readonly stats = { requests: 0, retries: 0 };

  constructor(options: HttpClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.policy = options.retry ?? RETRY_POLICY;
    this.sleep = options.sleep ?? defaultSleep;
    this.beforeRequest = options.beforeRequest ?? (async () => {});
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private backoffDelay(attempt: number): number {
    const raw = Math.min(this.policy.maxDelayMs, this.policy.baseDelayMs * 2 ** (attempt - 1));
    const jitter = raw * this.policy.jitterRatio * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(raw + jitter));
  }

  async get(url: string): Promise<HttpResult> {
    let lastError: HttpError | null = null;

    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt += 1) {
      await this.beforeRequest();
      this.stats.requests += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(url, { signal: controller.signal });
        const body = await response.text();
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });

        if (!response.ok) {
          const retryable = shouldRetry(response.status);
          lastError = new HttpError(`HTTP ${response.status}`, response.status, url, attempt, retryable);
          if (!retryable || attempt === this.policy.maxAttempts) throw lastError;
          this.stats.retries += 1;
          const retryAfter = parseRetryAfter(headers['retry-after'] ?? null);
          await this.sleep(retryAfter ?? this.backoffDelay(attempt));
          continue;
        }

        return { status: response.status, body, attempts: attempt, headers };
      } catch (error) {
        const isAbort = error instanceof Error && error.name === 'AbortError';
        const httpError =
          error instanceof HttpError
            ? error
            : new HttpError(isAbort ? 'timeout' : (error as Error).message, null, url, attempt, true);
        lastError = httpError;
        if (!httpError.retryable || attempt === this.policy.maxAttempts) throw httpError;
        this.stats.retries += 1;
        await this.sleep(this.backoffDelay(attempt));
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new HttpError('request_failed', null, url, this.policy.maxAttempts, false);
  }
}
