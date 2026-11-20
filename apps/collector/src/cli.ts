import pg from 'pg';
import { RADAR_SIGUNGU, SOURCE_CATALOG, SAMPLE_COMPLEXES, SAMPLE_END_MONTH, SAMPLE_REGIONS } from '@prop/shared';
import { HttpClient } from './http';
import { TokenBucketLimiter } from './rate-limiter';
import { MemorySink, type IngestionSink } from './sink';
import { PgSink } from './db/pg-sink';
import {
  runEcosIngestion,
  runMolitIngestion,
  runMolitRentIngestion,
  retryMolitDeadLetter,
  retryMolitRentDeadLetter,
  type PipelineDeps,
} from './pipeline';
import { createFixtureTransport } from './fixtures/transport';

/**
 * 수집 워커 CLI.
 *
 *   pnpm --filter @prop/collector once                 # 로컬 시뮬레이션(샘플 데이터, 키 불필요)
 *   pnpm --filter @prop/collector once -- --live       # 실제 공공데이터 API 호출(키 필요)
 *   pnpm --filter @prop/collector once -- --rent      # 전월세 실거래도 함께 수집(전세가율 원천)
 *   pnpm --filter @prop/collector once -- --retry-dlq  # 시뮬레이션에서 실패한 건 재시도
 *
 * 환경변수는 .env.example을 참고한다.
 */
interface CliOptions {
  live: boolean;
  retryDlq: boolean;
  months: number;
  lawdCds: string[];
  json: boolean;
  /** 전월세 수집도 함께 실행한다. 전세가율 화면은 이 결과를 읽는다. */
  rent: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const getValue = (flag: string): string | undefined => {
    const index = argv.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
    if (index === -1) return undefined;
    const arg = argv[index]!;
    return arg.includes('=') ? arg.split('=').slice(1).join('=') : argv[index + 1];
  };

  return {
    live: argv.includes('--live'),
    retryDlq: argv.includes('--retry-dlq'),
    months: Number(getValue('--months') ?? 6),
    // 기본값은 레이더 대상 6개 구다. --lawdCd=26230,26290 처럼 좁혀 실행할 수 있다.
    lawdCds: (getValue('--lawdCd') ?? RADAR_SIGUNGU.map((row) => row.lawdCd).join(',')).split(',').map((value) => value.trim()),
    json: argv.includes('--json'),
    rent: argv.includes('--rent'),
  };
}

async function resolveSink(): Promise<{ sink: IngestionSink; close: () => Promise<void> }> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { sink: new MemorySink(), close: async () => {} };
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  return {
    sink: new PgSink({
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        const result = await pool.query(sql, params as unknown[]);
        return { rows: result.rows as T[] };
      },
    }),
    close: async () => {
      await pool.end();
    },
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { sink, close } = await resolveSink();
  const logger = options.json ? undefined : (message: string) => console.log(message);

  const molitSource = SOURCE_CATALOG.find((source) => source.sourceId === 'molit_apt_trade')!;
  const molitRentSource = SOURCE_CATALOG.find((source) => source.sourceId === 'molit_apt_rent')!;
  const ecosSource = SOURCE_CATALOG.find((source) => source.sourceId === 'ecos_rates')!;
  const fixture = createFixtureTransport({
    hardFailures: options.live ? [] : [{ lawdCd: '26350', dealMonth: '2026-08' }],
    transientFailures: options.live ? [] : [{ lawdCd: '26290', dealMonth: '2026-09' }],
  });

  if (options.retryDlq && !(sink instanceof MemorySink)) {
    console.log('DLQ 재시도는 DB 적재 건에 대해 운영 잡(EventBridge + 워커)에서 처리합니다. CLI는 시뮬레이션(메모리) 모드만 지원합니다.');
  }

  const http = new HttpClient({
    fetchImpl: options.live ? fetch : fixture.fetch,
    beforeRequest: () => limiter.acquire(),
    retry: { maxAttempts: 4, baseDelayMs: options.live ? 500 : 0, maxDelayMs: 8_000, jitterRatio: 0.2 },
  });
  const limiter = new TokenBucketLimiter({
    ratePerSecond: Number(process.env.MOLIT_REQUESTS_PER_SECOND ?? 5),
  });

  const deps: PipelineDeps = { sink, http, logger };

  const molitResult = await runMolitIngestion(
    {
      endpoint: options.live ? molitSource.endpoint : 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
      serviceKey: options.live ? requireEnv('MOLIT_SERVICE_KEY') : 'fixture-key',
      regions: SAMPLE_REGIONS,
      lawdCds: options.lawdCds,
      endMonth: SAMPLE_END_MONTH,
      months: options.months,
      jobType: 'incremental',
      triggeredBy: options.live ? 'cli:live' : 'cli:fixture',
      numOfRows: 100,
      maxPages: 20,
    },
    deps,
  );

  const rentResult = options.rent
    ? await runMolitRentIngestion(
        {
          endpoint: options.live ? molitRentSource.endpoint : 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
          serviceKey: options.live ? requireEnv('MOLIT_SERVICE_KEY') : 'fixture-key',
          regions: SAMPLE_REGIONS,
          lawdCds: options.lawdCds,
          endMonth: SAMPLE_END_MONTH,
          months: options.months,
          jobType: 'incremental',
          triggeredBy: options.live ? 'cli:live' : 'cli:fixture',
        },
        deps,
      )
    : null;

  const ecosResult = await runEcosIngestion(
    {
      endpoint: options.live ? ecosSource.endpoint : 'https://ecos.bok.or.kr/api',
      apiKey: options.live ? requireEnv('ECOS_API_KEY') : 'fixture-key',
      endMonth: SAMPLE_END_MONTH,
      months: options.months,
      jobType: 'incremental',
      triggeredBy: options.live ? 'cli:live' : 'cli:fixture',
    },
    deps,
  );

  let retryResult: Array<{ id: string; resolved: boolean; error?: string }> = [];
  if (options.retryDlq && sink instanceof MemorySink) {
    for (const entry of sink.deadLetters.values()) {
      if (entry.resolvedAt) continue;
      const isRent = entry.sourceId === 'molit_apt_rent';
      const retryDeps = { ...deps, http: new HttpClient({ fetchImpl: createFixtureTransport().fetch }) };
      const result = isRent
        ? await retryMolitRentDeadLetter(
            entry,
            {
              endpoint: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
              serviceKey: 'fixture-key',
              regions: SAMPLE_REGIONS,
            },
            retryDeps,
          )
        : await retryMolitDeadLetter(
            entry,
            {
              endpoint: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
              serviceKey: 'fixture-key',
              regions: SAMPLE_REGIONS,
            },
            retryDeps,
          );
      retryResult.push({ id: entry.id, resolved: result.resolved, error: result.error });
    }
  }

  const summary = {
    mode: options.live ? 'live' : 'fixture',
    sink: sink instanceof MemorySink ? 'memory' : 'postgres',
    molit: {
      runId: molitResult.run.runId,
      status: molitResult.run.status,
      tasks: `${molitResult.run.taskSucceeded}/${molitResult.run.taskTotal} succeeded`,
      recordsUpserted: molitResult.run.recordsUpserted,
      recordsSkipped: molitResult.run.recordsSkipped,
      retries: molitResult.run.retryCount,
      errorSummary: molitResult.run.errorSummary,
      dealCount: molitResult.dealCount,
      canceledCount: molitResult.canceledCount,
    },
    rent: rentResult
      ? {
          runId: rentResult.run.runId,
          status: rentResult.run.status,
          tasks: `${rentResult.run.taskSucceeded}/${rentResult.run.taskTotal} succeeded`,
          recordsUpserted: rentResult.run.recordsUpserted,
          recordsSkipped: rentResult.run.recordsSkipped,
          jeonseCount: rentResult.jeonseCount,
          monthlyCount: rentResult.monthlyCount,
        }
      : null,
    ecos: {
      runId: ecosResult.run.runId,
      status: ecosResult.run.status,
      recordsUpserted: ecosResult.run.recordsUpserted,
      retries: ecosResult.run.retryCount,
    },
    deadLetters: sink instanceof MemorySink ? [...sink.deadLetters.values()] : 'see /api/v1/pipeline/dlq',
    retryResult,
    sampleComplexes: SAMPLE_COMPLEXES.length,
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('\n=== 수집 파이프라인 결과 ===');
    console.log(`모드: ${summary.mode} · 스토어: ${summary.sink}`);
    console.log(`MOLIT ${summary.molit.runId}: ${summary.molit.status} (${summary.molit.tasks}, ${summary.molit.recordsUpserted}건 반영, 재시도 ${summary.molit.retries})`);
    if (summary.molit.errorSummary) console.log(`실패 요약: ${summary.molit.errorSummary}`);
    if (summary.rent) {
      console.log(
        `MOLIT 전월세 ${summary.rent.runId}: ${summary.rent.status} (${summary.rent.tasks}, ${summary.rent.recordsUpserted}건 반영, 전세 ${summary.rent.jeonseCount}·월세 ${summary.rent.monthlyCount})`,
      );
    }
    console.log(`ECOS ${summary.ecos.runId}: ${summary.ecos.status} (${summary.ecos.recordsUpserted}건 반영)`);
    console.log(`DLQ: ${Array.isArray(summary.deadLetters) ? summary.deadLetters.length : 'API에서 조회'}건`);
    if (retryResult.length > 0) console.log(`재시도: ${JSON.stringify(retryResult)}`);
  }

  await close();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 환경변수가 없습니다. .env.example을 참고해 설정하세요.`);
  }
  return value;
}

main().catch((error) => {
  console.error(`수집 실패: ${(error as Error).message}`);
  process.exit(1);
});
