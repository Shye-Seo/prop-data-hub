import { useMemo, useRef, useState } from 'react';
import { SCHEMA_RELATIONS, SCHEMA_TABLES, mockApiResponse, openApiDocument } from '@prop/shared';
import { Card, DataNote } from '../components/ui';
import { tracker } from '../lib/tracker';

type Method = 'get' | 'post';

interface Operation {
  path: string;
  method: Method;
  tags?: readonly string[];
  summary?: string;
  description?: string;
  parameters?: ReadonlyArray<{
    name?: string;
    in?: string;
    required?: boolean;
    description?: string;
    schema?: Record<string, unknown>;
    example?: unknown;
  }>;
  requestBody?: {
    content?: Record<string, { example?: unknown; schema?: Record<string, unknown> }>;
  };
}

const TAG_LABEL: Record<string, string> = {
  reference: '기준정보',
  transactions: '실거래',
  market: '전월세·전세가율',
  radar: '급매 레이더',
  macro: '거시지표',
  pipeline: '수집 파이프라인',
  events: '행동 이벤트',
};

const OPERATIONS: Operation[] = Object.entries(openApiDocument.paths).flatMap(([path, methods]) =>
  Object.entries(methods as Record<string, Omit<Operation, 'path' | 'method'>>).map(([method, operation]) => ({
    path,
    method: method as Method,
    ...operation,
  })),
);

function defaultValue(parameter: NonNullable<Operation['parameters']>[number]): string {
  const schema = parameter.schema ?? {};
  if (parameter.example !== undefined) return String(parameter.example);
  if (schema.example !== undefined) return String(schema.example);
  if (schema.default !== undefined) return String(schema.default);
  return '';
}

function groupByTag(): Array<{ tag: string; operations: Operation[] }> {
  const order = Object.keys(TAG_LABEL);
  return order
    .map((tag) => ({ tag, operations: OPERATIONS.filter((operation) => operation.tags?.includes(tag)) }))
    .filter((group) => group.operations.length > 0);
}

export default function ApiDocs() {
  const [tab, setTab] = useState<'endpoints' | 'schema'>('endpoints');
  const [selectedKey, setSelectedKey] = useState<string>('get /api/v1/transactions');
  const [params, setParams] = useState<Record<string, string>>({
    complexId: 'MOLIT-26290-001',
    runId: 'run_20261118_0200_molit',
  });
  const [result, setResult] = useState<{ status: number; body: string; path: string } | null>(null);
  const [schemaTable, setSchemaTable] = useState<string>('apt_rent_transactions');
  const responseRef = useRef<HTMLDivElement | null>(null);

  const groups = useMemo(groupByTag, []);
  const selected = OPERATIONS.find((operation) => `${operation.method} ${operation.path}` === selectedKey) ?? OPERATIONS[0]!;
  const pathParams = (selected.parameters ?? []).filter((parameter) => parameter.in === 'path');
  const queryParams = (selected.parameters ?? []).filter((parameter) => parameter.in === 'query');
  const requestExample = selected.requestBody?.content?.['application/json']?.example;
  const table = SCHEMA_TABLES.find((row) => row.name === schemaTable) ?? SCHEMA_TABLES[0]!;
  const relations = SCHEMA_RELATIONS.filter((relation) => relation.from === table.name || relation.to === table.name);

  const resolvedPath = selected.path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    return value ? encodeURIComponent(value) : `{${name}}`;
  });

  const curl = useMemo(() => {
    const query = queryParams
      .filter((parameter) => parameter.name && params[parameter.name])
      .map((parameter) => `${parameter.name}=${encodeURIComponent(params[parameter.name!]!)}`)
      .join('&');
    const base = `${resolvedPath}${query ? `?${query}` : ''}`;
    if (selected.method === 'post') {
      return `curl -X POST http://localhost:8080${base} \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify(requestExample ?? {}).slice(0, 160)}…'`;
    }
    return `curl http://localhost:8080${base}`;
  }, [params, queryParams, requestExample, resolvedPath, selected.method]);

  const runMock = () => {
    const query: Record<string, string> = {};
    for (const parameter of queryParams) {
      const name = parameter.name;
      if (!name) continue;
      const value = params[name];
      if (value) query[name] = value;
    }
    const response = mockApiResponse({
      path: resolvedPath,
      method: selected.method,
      params: query,
      body: selected.method === 'post' ? (requestExample as unknown) : undefined,
    });
    setResult({ status: response.status, body: JSON.stringify(response.body, null, 2), path: resolvedPath });
    tracker.track('api_doc_mock_run', { endpoint: selected.path, method: selected.method, status: response.status });
    window.setTimeout(() => responseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist" aria-label="API 문서 탭">
          {[
            ['endpoints', '엔드포인트'],
            ['schema', '스키마·ERD'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key as 'endpoints' | 'schema')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${tab === key ? 'bg-ink-800 text-white' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="num text-[11px] text-slate-400">
          OpenAPI {openApiDocument.info.version} · {OPERATIONS.length}개 오퍼레이션 · {SCHEMA_TABLES.length}개 테이블/뷰
        </span>
        <span className="ml-auto rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800">
          데모: 예시 응답 실행 · 실제 서버 호출 아님
        </span>
      </div>

      {tab === 'endpoints' ? (
        <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
          <Card title="엔드포인트" subtitle="명세에서 읽은 태그 순서">
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.tag}>
                  <p className="mb-1.5 text-[11px] font-semibold text-slate-500">{TAG_LABEL[group.tag] ?? group.tag}</p>
                  <ul className="space-y-1">
                    {group.operations.map((operation) => {
                      const key = `${operation.method} ${operation.path}`;
                      const active = key === selectedKey;
                      return (
                        <li key={key}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedKey(key);
                              setResult(null);
                            }}
                            aria-current={active ? 'true' : undefined}
                            className={`flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
                              active ? 'border-teal-500/60 bg-teal-50/70' : 'border-transparent hover:bg-slate-50'
                            }`}
                          >
                            <span className={`mt-0.5 w-9 shrink-0 text-[10px] font-bold uppercase ${operation.method === 'get' ? 'text-emerald-700' : 'text-orange-700'}`}>
                              {operation.method}
                            </span>
                            <span className="min-w-0">
                              <span className="num block truncate text-[11px] font-medium text-slate-800">{operation.path}</span>
                              <span className="block truncate text-[10px] text-slate-500">{operation.summary}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </Card>

          <div className="space-y-4">
            <Card
              title={`${selected.method.toUpperCase()} ${selected.path}`}
              subtitle={selected.summary}
              action={
                <button type="button" className="btn text-xs" onClick={runMock} data-testid="run-mock">
                  Mock 응답 실행
                </button>
              }
            >
              {selected.description && <p className="mb-3 text-[12px] leading-relaxed text-slate-600">{selected.description}</p>}

              {(pathParams.length > 0 || queryParams.length > 0) && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {[...pathParams, ...queryParams].map((parameter) => (
                    <label key={`${parameter.in}-${parameter.name}`} className="block">
                      <span className="mb-1 flex items-baseline justify-between text-[11px] font-medium text-slate-600">
                        <span className="num">{parameter.name}</span>
                        <span className="text-[10px] text-slate-400">
                          {parameter.in}
                          {parameter.required ? ' · 필수' : ''}
                        </span>
                      </span>
                      <input
                        className="select num text-xs"
                        value={params[parameter.name ?? ''] ?? defaultValue(parameter)}
                        onChange={(event) =>
                          setParams((previous) => ({ ...previous, [parameter.name ?? '']: event.target.value }))
                        }
                        aria-label={`${parameter.name} 값`}
                      />
                    </label>
                  ))}
                </div>
              )}

              <div className="mt-3">
                <p className="label mb-1">요청 예시</p>
                <pre className="scroll-thin max-h-28 overflow-auto rounded-lg bg-ink-900 p-3 text-[10px] leading-relaxed text-slate-200">{curl}</pre>
              </div>

              <DataNote>
                이 화면은 서버 없이 명세와 표본 데이터로 같은 형태의 응답을 만들어 보여줍니다. 실제 수집 API는 같은 스키마로
                검증하고 <span className="num">user_behavior_events</span>에 적재합니다.
              </DataNote>
            </Card>

            <div ref={responseRef}>
            <Card
              title="응답"
              subtitle={result ? `${result.path} · 표본 응답` : 'Mock 응답 실행을 누르면 표시됩니다'}
              action={
                result && (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      result.status < 300 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'
                    }`}
                  >
                    {result.status}
                  </span>
                )
              }
            >
              {result ? (
                <pre className="scroll-thin max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] leading-relaxed text-emerald-200" data-testid="mock-response">
                  {result.body}
                </pre>
              ) : (
                <p className="py-8 text-center text-sm text-slate-400">오른쪽 위 'Mock 응답 실행'을 눌러 보세요.</p>
              )}
            </Card>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
          <Card title="테이블·뷰" subtitle="infra/postgres/init.sql 기준">
            <ul className="space-y-1">
              {SCHEMA_TABLES.map((row) => (
                <li key={row.name}>
                  <button
                    type="button"
                    onClick={() => setSchemaTable(row.name)}
                    aria-current={row.name === table.name ? 'true' : undefined}
                    className={`w-full rounded-lg border px-2 py-1.5 text-left transition ${
                      row.name === table.name ? 'border-teal-500/60 bg-teal-50/70' : 'border-transparent hover:bg-slate-50'
                    }`}
                  >
                    <span className="num block truncate text-[11px] font-medium text-slate-800">{row.name}</span>
                    <span className="block truncate text-[10px] text-slate-500">
                      {row.kind === 'table' ? 'table' : row.kind} · {row.purpose}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-4">
            <Card title={table.name} subtitle={table.purpose} action={<span className="text-[11px] text-slate-400">{table.kind}</span>}>
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-sm" data-testid="schema-table">
                  <thead>
                    <tr className="table-head">
                      <th className="px-2 py-2">컬럼</th>
                      <th className="px-2 py-2">타입</th>
                      <th className="px-2 py-2">키</th>
                      <th className="px-2 py-2">설명</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.columns.map((column) => (
                      <tr key={column.name} className="border-b border-slate-100 last:border-0">
                        <td className="num px-2 py-1.5 text-[12px] text-slate-800">{column.name}</td>
                        <td className="num px-2 py-1.5 text-[11px] text-slate-500">{column.type}</td>
                        <td className="px-2 py-1.5 text-[10px]">
                          {column.key ? (
                            <span
                              className={`rounded px-1.5 py-0.5 font-semibold ${
                                column.key === 'PK'
                                  ? 'bg-ink-800 text-white'
                                  : column.key === 'FK'
                                    ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
                                    : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {column.key}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] text-slate-500">{column.note ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {table.indexes.length > 0 && (
                <div className="mt-3">
                  <p className="label mb-1">인덱스</p>
                  <div className="scroll-thin flex flex-wrap gap-1 overflow-x-auto">
                    {table.indexes.map((index) => (
                      <span key={index} className="num rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                        {index}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {table.note && <p className="mt-2 text-[11px] text-slate-500">{table.note}</p>}
            </Card>

            <Card title="관계" subtitle="외래키 기준 · ERD 요약">
              {relations.length === 0 ? (
                <p className="text-[11px] text-slate-400">이 테이블을 참조하는 관계가 없습니다.</p>
              ) : (
                <ul className="space-y-1.5">
                  {relations.map((relation) => (
                    <li key={`${relation.from}-${relation.fromColumn}-${relation.to}`} className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                      <span className="num rounded bg-slate-100 px-1.5 py-0.5">{relation.from}.{relation.fromColumn}</span>
                      <span className="text-slate-400">→</span>
                      <span className="num rounded bg-slate-100 px-1.5 py-0.5">{relation.to}.{relation.toColumn}</span>
                      <span className="text-[10px] text-slate-400">{relation.label}</span>
                    </li>
                  ))}
                </ul>
              )}
              <DataNote>
                파티션(<span className="num">user_behavior_events</span>는 <span className="num">occurred_date</span> 월 단위)과
                전세가율 뷰(<span className="num">v_jeonse_ratio_monthly</span>)는 API와 화면이 같은 정의를 쓰도록 DDL에 고정했습니다.
                이 요약이 init.sql과 어긋나면 shared 테스트가 실패합니다.
              </DataNote>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
