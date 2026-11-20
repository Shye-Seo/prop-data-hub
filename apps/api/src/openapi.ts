import { openApiDocument } from '@prop/shared';

/**
 * API 서버의 문서 페이지.
 * 명세 본문은 packages/shared/src/openapi.ts에서 오고(웹 데모와 공유), 이 파일은
 * 서버에서만 쓰는 HTML 렌더링을 담당한다.
 */
export { openApiDocument };

export const openApiHtml = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>prop-data-hub API 명세</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", sans-serif; color: #0f172a; background: #f8fafc; }
  header { padding: 20px 24px; background: #0b2545; color: #fff; }
  header h1 { margin: 0 0 4px; font-size: 20px; }
  header p { margin: 0; color: #b9cbe4; font-size: 13px; }
  main { padding: 20px 24px 60px; max-width: 1040px; }
  section { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
  h2 { font-size: 15px; margin: 0 0 10px; color: #0b2545; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
  th { color: #475569; font-weight: 600; background: #f8fafc; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #eef2f7; padding: 1px 5px; border-radius: 4px; }
  .method { display: inline-block; min-width: 52px; font-weight: 700; font-size: 11px; letter-spacing: .04em; }
  .get { color: #166534; } .post { color: #9a3412; }
  .muted { color: #64748b; }
  .param { font-weight: 600; }
  a { color: #1d4ed8; }
</style>
</head>
<body>
<header>
  <h1>prop-data-hub API <span class="muted" style="color:#8fb3dd">v1.2.0</span></h1>
  <p>부동산 실거래·거시지표·수집 파이프라인·행동 이벤트 API · 본 문서는 <code style="background:#12305a;color:#cfe0f7">openapi.json</code>을 읽어 렌더링한다.</p>
</header>
<main>
  <section>
    <h2>엔드포인트</h2>
    <table id="endpoints"><tbody><tr><td class="muted">명세를 불러오는 중…</td></tr></tbody></table>
  </section>
  <section>
    <h2>스키마</h2>
    <table id="schemas"><tbody><tr><td class="muted">…</td></tr></tbody></table>
  </section>
  <p class="muted" style="font-size:12px">금액 단위: 원 · 면적: ㎡ · 평당가: 원/평 · 평 환산 3.305785㎡</p>
</main>
<script>
fetch('./openapi.json')
  .then((response) => response.json())
  .then((doc) => {
    const endpointRows = [];
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const params = (operation.parameters || []).map((param) => {
          return '<span class="param">' + param.name + '</span> <span class="muted">(' + param.in + (param.required ? ', 필수' : '') + ')</span>';
        }).join('<br>') || '<span class="muted">-</span>';
        endpointRows.push(
          '<tr><td><span class="method ' + method + '">' + method.toUpperCase() + '</span><code>' + path + '</code></td>' +
          '<td>' + (operation.summary || '') + (operation.description ? '<br><span class="muted" style="font-size:12px">' + operation.description + '</span>' : '') + '</td>' +
          '<td style="font-size:12px">' + params + '</td></tr>'
        );
      }
    }
    document.querySelector('#endpoints tbody').innerHTML =
      '<tr><th>경로</th><th>설명</th><th>파라미터</th></tr>' + endpointRows.join('');

    const schemaRows = Object.entries(doc.components.schemas).map(([name, schema]) => {
      const entries = schema.properties ? Object.entries(schema.properties) : [];
      const fields = entries.map(([key, value]) => {
        const type = value.type || (value.$ref ? value.$ref.split('/').pop() : 'object');
        return '<span class="param">' + key + '</span> <span class="muted">' + type + '</span>';
      }).join(' · ');
      return '<tr><td><code>' + name + '</code></td><td style="font-size:12px">' + fields + '</td></tr>';
    });
    document.querySelector('#schemas tbody').innerHTML = '<tr><th>스키마</th><th>필드</th></tr>' + schemaRows.join('');
  })
  .catch(() => {
    document.querySelector('#endpoints tbody').innerHTML = '<tr><td>명세를 불러오지 못했습니다. /api-docs/openapi.json을 확인하세요.</td></tr>';
  });
</script>
</body>
</html>`;
