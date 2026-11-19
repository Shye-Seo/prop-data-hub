import { buildEcosUrl, parseEcosResponse, SOURCE_IDS, type MacroIndicator } from '@prop/shared';
import type { HttpClient } from '../http';

export interface EcosIndicatorSpec {
  indicatorCode: string;
  indicatorName: string;
  statCode: string;
  itemCode?: string;
  cycle: 'M' | 'D' | 'A';
}

/**
 * ECOS 통계표 코드는 키 발급 후 통계표 조회 화면에서 확인해야 한다.
 * 아래 기본값은 기준금리(722Y001/0101000) 예시이며, 소비자물가지수·주담대 금리는
 * 운영 시 환경변수나 DB의 소스 정의로 교체한다.
 */
export const ECOS_INDICATORS: EcosIndicatorSpec[] = [
  { indicatorCode: 'base_rate', indicatorName: '한국은행 기준금리', statCode: '722Y001', itemCode: '0101000', cycle: 'M' },
  { indicatorCode: 'mortgage_rate', indicatorName: '주택담보대출 금리', statCode: '121Y006', cycle: 'M' },
  { indicatorCode: 'cpi', indicatorName: '소비자물가지수', statCode: '901Y009', cycle: 'M' },
];

export interface EcosCollectOptions {
  endpoint: string;
  apiKey: string;
  http: HttpClient;
  now?: () => Date;
}

export interface EcosCollectResult {
  indicators: MacroIndicator[];
  retries: number;
  requests: number;
}

export async function collectEcosSeries(
  options: EcosCollectOptions,
  spec: EcosIndicatorSpec,
  range: { startPeriod: string; endPeriod: string },
): Promise<EcosCollectResult> {
  const now = options.now ?? (() => new Date());
  const before = options.http.stats.retries;
  const url = buildEcosUrl({
    endpoint: options.endpoint,
    apiKey: options.apiKey,
    statCode: spec.statCode,
    cycle: spec.cycle,
    startPeriod: range.startPeriod,
    endPeriod: range.endPeriod,
    itemCode: spec.itemCode,
  });

  const response = await options.http.get(url);
  const parsed = parseEcosResponse(response.body, {
    statCode: spec.statCode,
    indicatorCode: spec.indicatorCode,
    indicatorName: spec.indicatorName,
    cycle: spec.cycle,
    collectedAt: now().toISOString(),
  });

  if (parsed.resultCode !== 'INFO-000') {
    throw new Error(`ecos_api_error:${parsed.resultCode}:${parsed.resultMessage}`);
  }

  return {
    indicators: parsed.indicators,
    retries: options.http.stats.retries - before,
    requests: 1,
  };
}

export const ECOS_SOURCE_ID = SOURCE_IDS.ecosRates;
