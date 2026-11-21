import { useEffect, useState } from 'react';

export type RouteKey =
  | 'overview'
  | 'explore'
  | 'compare'
  | 'risk'
  | 'radar'
  | 'jeonse'
  | 'cash'
  | 'drawdown'
  | 'rate'
  | 'pipeline'
  | 'events'
  | 'api'
  | 'dictionary';

export interface RouteDefinition {
  key: RouteKey;
  label: string;
  short: string;
  description: string;
}

/**
 * 사이드바·모바일 탭에 노출하는 화면.
 *
 * 운영·개발용 화면(`pipeline`·`events`·`api`·`dictionary`)은 여기에 넣지 않는다. 그 화면들은
 * 수집 파이프라인·이벤트 스키마·API 명세를 그대로 보여 주는 내부 콘솔이라 제품 화면에는 걸지 않고,
 * 주소(#pipeline 등)로만 접근한다. 라우팅 자체는 남겨 두어 운영 점검과 E2E가 같은 코드를 검증한다.
 */
export const NAV_ROUTES: RouteDefinition[] = [
  { key: 'overview', label: '시장 개요', short: '개요', description: '지역별 중위가·거래량·금리 지표' },
  { key: 'explore', label: '실거래 탐색', short: '실거래', description: '조건별 실거래 필터와 평당가' },
  { key: 'compare', label: '단지 비교', short: '비교', description: '최대 3개 단지의 가격·전세가율 비교' },
  { key: 'risk', label: '구별 리스크', short: '리스크', description: '부산 6개 구 전세가율과 이상 거래' },
  { key: 'radar', label: '급매 레이더', short: '레이더', description: '350세대+ 매매 저평가·급매 알림' },
  { key: 'jeonse', label: '전세 안전진단', short: '전세안전', description: '보증금·선순위 근저당 위험도와 HUG 가능성' },
  { key: 'cash', label: '입주 현금 계산', short: '현금', description: '취득세·복비·DSR 대출 한도로 필요 자기자본' },
  { key: 'drawdown', label: '전고점 하락률', short: '하락률', description: '350세대+ 단지 전고점 대비 낙폭 순위' },
  { key: 'rate', label: '금리 민감도', short: '금리', description: '대출 조건별 월 상환액과 DSR' },
];

/** 내부 운영 화면. 메뉴에는 걸지 않고 주소로만 연다. */
export const OPERATOR_ROUTES: RouteDefinition[] = [
  { key: 'pipeline', label: '수집 파이프라인', short: '수집', description: '실행 이력·출처·기준일·DLQ' },
  { key: 'events', label: '행동 이벤트', short: '이벤트', description: '퍼널·이벤트 스트림 실시간 확인' },
  { key: 'api', label: 'API 문서', short: 'API', description: 'OpenAPI 명세·Mock 실행·스키마' },
  { key: 'dictionary', label: '지표 정의서', short: '정의', description: '이벤트·퍼널·품질 규칙' },
];

export const ALL_ROUTES: RouteDefinition[] = [...NAV_ROUTES, ...OPERATOR_ROUTES];

export const ROUTE_TITLES: Record<RouteKey, { title: string; description: string }> = {
  overview: { title: '시장 개요', description: '부산 6개 구(부산진·동래·남·해운대·연제·수영) 실거래와 금리 지표를 한 화면에서 봅니다.' },
  explore: { title: '실거래 탐색', description: '지역·단지·면적·기간으로 실거래를 좁히고 평당가를 비교합니다.' },
  compare: { title: '단지 비교', description: '최대 3개 단지의 가격 추이·전세가율·리스크를 같은 축에서 비교합니다.' },
  risk: { title: '구별 리스크', description: '전세가율·급락·이상 거래로 부산 6개 구를 비교합니다.' },
  radar: { title: '급매 레이더', description: '350세대 이상 단지의 매매가를 최근 중위가와 비교해 급매·저평가만 모읍니다.' },
  jeonse: {
    title: '전세 안전진단',
    description: '희망 보증금과 선순위 근저당을 최근 매매 실거래가와 대조해 전세가율·최우선변제·HUG 가입 가능성을 판정합니다.',
  },
  cash: {
    title: '입주 현금 계산',
    description: '매매가·취득세·중개보수와 DSR 기반 대출 한도를 합쳐 입주에 필요한 자기자본을 계산합니다.',
  },
  drawdown: {
    title: '전고점 대비 하락률',
    description: '350세대 이상 단지의 24개월 전고점 대비 하락률을 ㎡ (평) 기준으로 비교합니다.',
  },
  rate: { title: '금리 민감도', description: '대출 조건을 바꾸며 월 상환액과 필요 소득(DSR)을 계산합니다.' },
  pipeline: { title: '수집 파이프라인', description: '공공데이터 수집 실행, 실패 재시도, 데이터 기준일을 확인합니다.' },
  events: { title: '행동 이벤트', description: '이 화면에서 발생한 이벤트와 퍼널 전환을 실시간으로 봅니다.' },
  api: { title: 'API 문서', description: 'OpenAPI 3.0 명세와 PostgreSQL 스키마를 열람하고 예시 응답을 실행합니다.' },
  dictionary: { title: '지표 정의서', description: '이벤트·퍼널·데이터 품질 규칙을 정의 단위로 정리했습니다.' },
};

const VALID = new Set(ALL_ROUTES.map((route) => route.key));

export function parseRoute(hash: string): RouteKey {
  const value = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  return VALID.has(value as RouteKey) ? (value as RouteKey) : 'overview';
}

export function useRoute(): [RouteKey, (next: RouteKey) => void] {
  const [route, setRoute] = useState<RouteKey>(() =>
    parseRoute(typeof window === 'undefined' ? '' : window.location.hash),
  );

  useEffect(() => {
    const handler = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const navigate = (next: RouteKey) => {
    if (window.location.hash === `#${next}`) return;
    window.location.hash = next;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return [route, navigate];
}
