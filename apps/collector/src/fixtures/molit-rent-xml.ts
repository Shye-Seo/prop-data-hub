import type { AptRentTransaction } from '@prop/shared';

/** 전월세 응답을 XML로 직렬화한다(로컬 시뮬레이션·테스트용). 실제 API와 같은 노드명을 쓴다. */
export function rentsToMolitXml(
  rows: AptRentTransaction[],
  options: { totalCount?: number; pageNo?: number; numOfRows?: number } = {},
): string {
  const items = rows
    .map((row) => {
      const [, month, day] = row.dealDate.split('-');
      return `      <item>
        <보증금액>${Math.round(row.depositKrw / 10_000).toLocaleString('en-US')}</보증금액>
        <월세금액>${Math.round(row.monthlyRentKrw / 10_000).toLocaleString('en-US')}</월세금액>
        <계약구분>${row.contractType === 'jeonse' ? '전세' : '월세'}</계약구분>
        <계약기간>${row.contractTermMonths ?? ''}</계약기간>
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
        <갱신요구권사용>${row.renewalRequested ? 'O' : ''}</갱신요구권사용>
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
