import { describe, expect, it } from 'vitest';
import { mockApiResponse } from './api-mock';
import { openApiDocument } from './openapi';

type SpecPath = keyof typeof openApiDocument.paths;
type SpecOperation = { parameters?: ReadonlyArray<{ name?: string; in?: string; example?: unknown }>; requestBody?: unknown };

/** 명세의 path 파라미터 example로 실제 경로를 만든다. 예시가 없으면 표본 값을 쓴다. */
function buildPath(path: string, operation: SpecOperation): string {
  const examples: Record<string, string> = {
    complexId: 'MOLIT-26290-001',
    runId: 'run_20261118_0200_molit',
  };
  return path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const parameter = operation.parameters?.find((row) => row.name === name && row.in === 'path');
    return String(parameter?.example ?? examples[name] ?? '1');
  });
}

const operations = (Object.entries(openApiDocument.paths) as Array<[SpecPath, Record<string, SpecOperation>]>).flatMap(
  ([path, methods]) => Object.entries(methods).map(([method, operation]) => ({ path: String(path), method, operation })),
);

describe('OpenAPI 명세', () => {
  it('모든 경로가 경로·메서드·요약을 갖는다', () => {
    expect(operations.length).toBeGreaterThanOrEqual(18);
    for (const operation of operations) {
      expect(operation.path.startsWith('/')).toBe(true);
      expect(['get', 'post']).toContain(operation.method);
    }
  });

  it('명세의 모든 경로를 데모 응답이 처리한다', () => {
    const unmatched: string[] = [];
    for (const operation of operations) {
      const response = mockApiResponse({
        path: buildPath(operation.path, operation.operation),
        method: operation.method as 'get' | 'post',
        body: operation.method === 'post' ? { events: [{ name: 'page_view', props: { route: '/overview' } }] } : undefined,
      });
      if (response.matchedPath !== buildPath(operation.path, operation.operation)) unmatched.push(`${operation.method} ${operation.path}`);
      expect([200, 202, 400, 404]).toContain(response.status);
    }
    expect(unmatched).toEqual([]);
  });

  it('이벤트 이름 enum이 공유 상수와 같은 값을 쓴다', () => {
    const schema = openApiDocument.components.schemas.BehaviorEvent;
    expect(schema.properties.name.enum).toEqual([
      'page_view',
      'region_filter_change',
      'radar_filter_change',
      'alert_rule_create',
      'complex_compare_add',
      'listing_click',
      'listing_save',
      'api_doc_mock_run',
      'rate_scenario_adjust',
      'pipeline_source_inspect',
      'funnel_step_complete',
    ]);
  });

  it('전월세·전세가율 경로의 응답 예시가 표본과 일치한다', () => {
    const rents = mockApiResponse({ path: '/api/v1/rents', params: { limit: '3' } });
    expect(rents.status).toBe(200);
    expect((rents.body.items as unknown[]).length).toBeLessThanOrEqual(3);

    const ratio = mockApiResponse({ path: '/api/v1/market/jeonse-ratio', params: { complexId: 'MOLIT-26290-001' } });
    expect(ratio.status).toBe(200);
    const series = ratio.body.series as Array<{ month: string; ratioPct: number }>;
    expect(series).toHaveLength(24);
    expect(series.some((row) => row.ratioPct > 50)).toBe(true);
    expect(ratio.body.mock).toBe(true);
  });

  it('없는 단지는 404로 응답한다', () => {
    const response = mockApiResponse({ path: '/api/v1/complexes/MOLIT-00000-999/monthly' });
    expect(response.status).toBe(404);
  });
});
