export {
  formatAreaM2AndPyeong as formatAreaWithPyeong,
  formatKrwKorean,
  formatKrwWon,
  formatPct,
  formatPyeongPrice,
  formatPyeongPrice as formatPerPyeong,
} from '@prop/shared';

import { formatAreaM2, formatPyeongUnit } from '@prop/shared';

export function formatMonth(month: string): string {
  const [year, monthText] = month.split('-');
  return `${year}.${monthText}`;
}

export function formatMonthShort(month: string): string {
  const [year, monthText] = month.split('-');
  return `${year.slice(2)}.${monthText}`;
}

export function formatDate(date: string): string {
  return date.replaceAll('-', '.');
}

export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('ko-KR');
}

/** 전용면적 ㎡만 표기. 평을 같이 보여야 하는 곳은 formatAreaWithPyeong을 쓴다. */
export function formatArea(areaM2: number): string {
  return formatAreaM2(areaM2);
}

/** 전용면적의 평 환산(1평 = 3.305785㎡). */
export function formatPyeong(areaM2: number): string {
  return formatPyeongUnit(areaM2);
}

export function formatCompactKrw(amount: number): string {
  if (amount >= 100_000_000) return `${(amount / 100_000_000).toFixed(1)}억`;
  return `${Math.round(amount / 10_000).toLocaleString('ko-KR')}만`;
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}
