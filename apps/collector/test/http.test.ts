import { describe, expect, it } from 'vitest';
import { HttpClient, HttpError } from '../src/http';

function sequenceFetch(handlers: Array<() => Response | Promise<Response>>): typeof fetch {
  let index = 0;
  return (async () => {
    const handler = handlers[Math.min(index, handlers.length - 1)]!;
    index += 1;
    return handler();
  }) as unknown as typeof fetch;
}

const immediateSleep = async () => {};

describe('HttpClient', () => {
  it('5xx는 재시도하고 두 번째 성공을 반환한다', async () => {
    let calls = 0;
    const fetchImpl = sequenceFetch([
      () => {
        calls += 1;
        return new Response('boom', { status: 503 });
      },
      () => {
        calls += 1;
        return new Response('<ok/>', { status: 200 });
      },
    ]);
    const client = new HttpClient({ fetchImpl, sleep: immediateSleep });
    const result = await client.get('https://example.test/items');
    expect(result.status).toBe(200);
    expect(result.body).toBe('<ok/>');
    expect(result.attempts).toBe(2);
    expect(calls).toBe(2);
    expect(client.stats.retries).toBe(1);
  });

  it('4xx는 재시도하지 않고 즉시 실패한다', async () => {
    let calls = 0;
    const client = new HttpClient({
      fetchImpl: (async () => {
        calls += 1;
        return new Response('bad request', { status: 400 });
      }) as unknown as typeof fetch,
      sleep: immediateSleep,
    });
    await expect(client.get('https://example.test/items')).rejects.toMatchObject({ status: 400, attempts: 1 });
    expect(calls).toBe(1);
  });

  it('429는 Retry-After를 존중해 대기한다', async () => {
    const delays: number[] = [];
    const client = new HttpClient({
      fetchImpl: sequenceFetch([
        () => new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
        () => new Response('ok', { status: 200 }),
      ]),
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    await client.get('https://example.test/items');
    expect(delays).toEqual([2000]);
  });

  it('재시도 상한을 넘으면 마지막 오류를 던진다', async () => {
    let calls = 0;
    const client = new HttpClient({
      fetchImpl: (async () => {
        calls += 1;
        return new Response('down', { status: 500 });
      }) as unknown as typeof fetch,
      sleep: immediateSleep,
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 },
    });
    await expect(client.get('https://example.test/items')).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(3);
  });

  it('네트워크 오류도 재시도 대상이다', async () => {
    let calls = 0;
    const client = new HttpClient({
      fetchImpl: (async () => {
        calls += 1;
        if (calls === 1) throw new Error('ECONNRESET');
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch,
      sleep: immediateSleep,
    });
    const result = await client.get('https://example.test/items');
    expect(result.attempts).toBe(2);
  });

  it('타임아웃은 abort로 끊고 재시도한다', async () => {
    let calls = 0;
    const client = new HttpClient({
      timeoutMs: 5,
      retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 },
      sleep: immediateSleep,
      fetchImpl: ((_input: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }) as unknown as typeof fetch,
    });
    await expect(client.get('https://example.test/items')).rejects.toMatchObject({ attempts: 2 });
    expect(calls).toBe(2);
  });

  it('요청 전 rate-limit 훅을 호출한다', async () => {
    let tokens = 0;
    const client = new HttpClient({
      fetchImpl: (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch,
      beforeRequest: async () => {
        tokens += 1;
      },
    });
    await client.get('https://example.test/a');
    await client.get('https://example.test/b');
    expect(tokens).toBe(2);
  });
});
