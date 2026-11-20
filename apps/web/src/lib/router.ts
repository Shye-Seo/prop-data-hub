import { useEffect, useState } from 'react';

export type RouteKey =
  | 'overview'
  | 'explore'
  | 'compare'
  | 'risk'
  | 'radar'
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

export const ROUTES: RouteDefinition[] = [
  { key: 'overview', label: '시장 개요', short: '개요', description: '지역별 중위가·거래량·금리 지표' },
  { key: 'explore', label: '실거래 탐색', short: '실거래', description: '조건별 실거래 필터와 평당가' },
  { key: 'compare', label: '단지 비교', short: '비교', description: '최대 3개 단지의 가격·전세가율 비교' },
  { key: 'risk', label: '구별 리스크', short: '리스크', description: '부산 6개 구 전세가율과 이상 거래' },
  { key: 'radar', label: '급매 레이더', short: '레이더', description: '350세대+ 매매 저평가·급매 알림' },
  { key: 'rate', label: '금리 민감도', short: '금리', description: '대출 조건별 월 상환액과 DSR' },
  { key: 'pipeline', label: '수집 파이프라인', short: '수집', description: '실행 이력·출처·기준일·DLQ' },
  { key: 'events', label: '행동 이벤트', short: '이벤트', description: '퍼널·이벤트 스트림 실시간 확인' },
  { key: 'api', label: 'API 문서', short: 'API', description: 'OpenAPI 명세·Mock 실행·스키마' },
  { key: 'dictionary', label: '지표 정의서', short: '정의', description: '이벤트·퍼널·품질 규칙' },
];

const VALID = new Set(ROUTES.map((route) => route.key));

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
