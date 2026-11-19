import { SOURCE_IDS } from '../constants';
import type { MacroIndicator } from '../types';

export interface EcosParseContext {
  statCode: string;
  indicatorCode: string;
  indicatorName: string;
  /** ECOS 응답 주기: M(월), D(일), A(년) */
  cycle: 'M' | 'D' | 'A';
  collectedAt: string;
}

export interface EcosParseResult {
  resultCode: string;
  resultMessage: string;
  indicators: MacroIndicator[];
}

interface EcosRow {
  STAT_CODE?: string;
  STAT_NAME?: string;
  ITEM_CODE1?: string;
  ITEM_NAME1?: string;
  UNIT_NAME?: string;
  TIME?: string;
  DATA_VALUE?: string;
  [key: string]: unknown;
}

/**
 * 한국은행 ECOS Open API 응답(StatisticSearch)을 정규화한다.
 * ECOS는 실패 시에도 HTTP 200으로 `RESULT: {CODE, MESSAGE}`를 주므로
 * 본문의 결과 코드를 반드시 확인해야 한다.
 */
export function parseEcosResponse(payload: string | unknown, context: EcosParseContext): EcosParseResult {
  const root = (typeof payload === 'string' ? JSON.parse(payload) : payload) as Record<string, unknown>;
  const result = (root.RESULT ?? {}) as { CODE?: string; MESSAGE?: string };
  const search = (root.StatisticSearch ?? {}) as { row?: EcosRow | EcosRow[] };

  if (result.CODE && result.CODE !== 'INFO-000') {
    return {
      resultCode: String(result.CODE),
      resultMessage: String(result.MESSAGE ?? ''),
      indicators: [],
    };
  }

  const rows = search.row ? (Array.isArray(search.row) ? search.row : [search.row]) : [];
  const indicators: MacroIndicator[] = [];

  for (const row of rows) {
    const time = String(row.TIME ?? '').trim();
    const rawValue = String(row.DATA_VALUE ?? '').trim();
    const value = Number(rawValue.replace(/,/g, ''));
    if (!time || !rawValue || !Number.isFinite(value)) continue;
    const periodDate = toPeriodDate(time, context.cycle);
    if (!periodDate) continue;

    indicators.push({
      indicatorCode: context.indicatorCode,
      indicatorName: row.ITEM_NAME1 ? String(row.ITEM_NAME1) : context.indicatorName,
      periodDate,
      period: time,
      value,
      unit: String(row.UNIT_NAME ?? '%'),
      sourceId: context.indicatorCode === 'cpi' ? SOURCE_IDS.ecosCpi : SOURCE_IDS.ecosRates,
      asOfDate: periodDate,
      collectedAt: context.collectedAt,
    });
  }

  return { resultCode: 'INFO-000', resultMessage: 'OK', indicators };
}

/**
 * ECOS의 TIME 표기를 기준일로 바꾼다.
 * 월간은 말일, 연간은 12-31, 일간은 그대로 쓴다(월간 지표의 기준일을 말일로 두는 관행).
 */
export function toPeriodDate(time: string, cycle: 'M' | 'D' | 'A'): string | null {
  if (cycle === 'D') {
    if (!/^\d{8}$/.test(time)) return null;
    return `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}`;
  }
  if (cycle === 'M') {
    if (!/^\d{6}$/.test(time)) return null;
    const year = Number(time.slice(0, 4));
    const month = Number(time.slice(4, 6));
    if (month < 1 || month > 12) return null;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${time.slice(0, 4)}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  }
  if (!/^\d{4}$/.test(time)) return null;
  return `${time}-12-31`;
}

export function buildEcosUrl(params: {
  endpoint: string;
  apiKey: string;
  statCode: string;
  cycle: 'M' | 'D' | 'A';
  startPeriod: string;
  endPeriod: string;
  itemCode?: string;
}): string {
  const base = params.endpoint.replace(/\/$/, '');
  const item = params.itemCode ? `/${params.itemCode}` : '';
  return `${base}/StatisticSearch/${encodeURIComponent(params.apiKey)}/json/kr/1/1000/${params.statCode}/${params.cycle}/${params.startPeriod}/${params.endPeriod}${item}`;
}
