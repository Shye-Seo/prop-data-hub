import type { SourceDescriptor } from './types';
import { SOURCE_IDS } from './constants';

/**
 * 수집 소스 정의. 화면의 '데이터 출처' 카드와 파이프라인 러너가 같은 값을 쓴다.
 *
 * 주의: ECOS 통계표 코드(statCode)와 항목 코드는 실제 키 발급 후
 * 통계표 조회 화면에서 확인해 확정해야 한다. 아래 값은 구현 연결용 기본값이며
 * README의 '미연결·확인 필요' 항목에 포함돼 있다.
 */
export const SOURCE_CATALOG: SourceDescriptor[] = [
  {
    sourceId: SOURCE_IDS.molitAptTrade,
    name: '아파트 매매 실거래가',
    provider: '국토교통부 (공공데이터포털)',
    endpoint: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
    license: '이용허락범위 제한 없음',
    updateCycle: '매월 신고분 반영(계약일 기준, 통상 1~2개월 지연)',
    asOfPolicy: '계약 연월 기준. 수집 시점과 계약 시점을 분리해 저장한다.',
    requiresKey: true,
  },
  {
    sourceId: SOURCE_IDS.ecosRates,
    name: '기준금리·주택담보대출 금리',
    provider: '한국은행 ECOS Open API',
    endpoint: 'https://ecos.bok.or.kr/api/StatisticSearch',
    license: '한국은행 공공데이터 이용약관',
    updateCycle: '월간(기준금리는 변경 시)',
    asOfPolicy: '월간 지표는 해당 월 말일을 기준일로 둔다.',
    requiresKey: true,
  },
  {
    sourceId: SOURCE_IDS.ecosCpi,
    name: '소비자물가지수',
    provider: '한국은행 ECOS Open API',
    endpoint: 'https://ecos.bok.or.kr/api/StatisticSearch',
    license: '한국은행 공공데이터 이용약관',
    updateCycle: '월간',
    asOfPolicy: '월간 지표는 해당 월 말일을 기준일로 둔다.',
    requiresKey: true,
  },
];

export function getSourceDescriptor(sourceId: string): SourceDescriptor | undefined {
  return SOURCE_CATALOG.find((source) => source.sourceId === sourceId);
}
