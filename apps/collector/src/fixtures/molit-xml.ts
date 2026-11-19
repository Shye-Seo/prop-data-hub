import type { AptTransaction } from '@prop/shared';

/** 실거래 응답을 XML로 직렬화한다(로컬 시뮬레이션·테스트용). 실제 API와 같은 노드명을 쓴다. */
export function transactionsToMolitXml(
  rows: AptTransaction[],
  options: { totalCount?: number; pageNo?: number; numOfRows?: number } = {},
): string {
  const items = rows
    .map((row) => {
      const [, month, day] = row.dealDate.split('-');
      const manwon = Math.round(row.priceKrw / 10_000).toLocaleString('en-US');
      return `      <item>
        <거래금액>${manwon}</거래금액>
        <거래유형>${escapeXml(row.dealType)}</거래유형>
        <건축년도>${row.builtYear ?? ''}</건축년도>
        <년>${row.dealDate.slice(0, 4)}</년>
        <월>${Number(month)}</월>
        <일>${row.dealDate.endsWith('-01') ? '' : Number(day)}</일>
        <법정동>${escapeXml(row.dong)}</법정동>
        <아파트>${escapeXml(row.aptName)}</아파트>
        <지번>${escapeXml(row.jibun)}</지번>
        <지역코드>${row.lawdCd}</지역코드>
        <전용면적>${row.areaM2}</전용면적>
        <층>${row.floor ?? ''}</층>
        <해제여부>${row.canceled ? 'O' : ''}</해제여부>
        <해제사유발생일>${row.canceled ? row.dealDate : ''}</해제사유발생일>
      </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<response>
  <header>
    <resultCode>000</resultCode>
    <resultMsg>OK</resultMsg>
  </header>
  <body>
    <items>
${items}
    </items>
    <numOfRows>${options.numOfRows ?? rows.length}</numOfRows>
    <pageNo>${options.pageNo ?? 1}</pageNo>
    <totalCount>${options.totalCount ?? rows.length}</totalCount>
  </body>
</response>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
