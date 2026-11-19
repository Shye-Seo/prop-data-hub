export {
  formatKrwKorean,
  formatKrwWon,
  formatPct,
  formatPyeongPrice,
  formatPyeongPrice as formatPerPyeong,
} from '@prop/shared';

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

export function formatArea(areaM2: number): string {
  return `${areaM2.toFixed(2)}㎡`;
}

export function formatPyeong(areaM2: number): string {
  return `${(areaM2 / 3.305785).toFixed(1)}평`;
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
