import { useEffect, useId, useRef, useState } from 'react';

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  points: ChartPoint[];
  dashed?: boolean;
}

/**
 * 차트는 그리는 폭에 맞춰 좌표계를 다시 잡는다.
 * 고정 폭(viewBox)으로 두면 좁은 화면에서 글자가 함께 줄어 읽을 수 없게 된다.
 */
function useChartWidth(fallback = 760) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next > 0) setWidth(Math.max(240, Math.round(next)));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return { hostRef, width };
}

interface LineChartProps {
  series: ChartSeries[];
  height?: number;
  formatValue: (value: number) => string;
  /** 축 라벨용 짧은 표기. 생략하면 값 크기에 따라 억/만 단위로 줄인다. */
  formatAxis?: (value: number) => string;
  /** x축에 표시할 라벨 개수(전체 라벨 중 균등 선택). */
  xTickCount?: number;
  ariaLabel: string;
  emptyMessage?: string;
}

const BASE_PADDING = { top: 16, right: 18, bottom: 26, left: 76 };

/** 의존성 없는 SVG 라인 차트. 마우스를 올린 지점의 값을 위쪽 요약줄에 보여준다. */
export function LineChart({
  series,
  height = 240,
  formatValue,
  formatAxis,
  xTickCount = 6,
  ariaLabel,
  emptyMessage,
}: LineChartProps) {
  const gradientId = useId().replace(/:/g, '');
  const { hostRef, width } = useChartWidth();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const labels = series[0]?.points.map((point) => point.label) ?? [];
  const narrow = width < 520;
  const padding = { ...BASE_PADDING, left: narrow ? 54 : 76, right: narrow ? 10 : 18 };
  const chartHeight = narrow ? Math.min(height, 250) : height;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  if (labels.length === 0) {
    return (
      <div ref={hostRef} className="flex h-40 items-center justify-center text-[12px] text-ink-400">
        {emptyMessage ?? '표시할 데이터가 없습니다.'}
      </div>
    );
  }

  const allValues = series.flatMap((row) => row.points.filter((point) => point.value > 0).map((point) => point.value));
  const maxValue = allValues.length > 0 ? Math.max(...allValues) : 1;
  const minValue = allValues.length > 0 ? Math.min(...allValues) : 0;
  const span = Math.max(1, maxValue - minValue);
  const paddedMax = maxValue + span * 0.12;
  const paddedMin = Math.max(0, minValue - span * 0.18);

  const xAt = (index: number) => (labels.length === 1 ? innerWidth / 2 : (index / (labels.length - 1)) * innerWidth);
  const yAt = (value: number) => innerHeight - ((value - paddedMin) / (paddedMax - paddedMin)) * innerHeight;

  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, index) =>
    Math.round(paddedMin + ((paddedMax - paddedMin) * index) / yTicks),
  );
  const visibleTicks = Math.max(3, Math.min(xTickCount, Math.floor(width / 96)));
  const xTickStep = Math.max(1, Math.ceil(labels.length / visibleTicks));

  const hoveredLabel = hoverIndex === null ? null : labels[hoverIndex];
  const axisFormatter =
    formatAxis ??
    ((value: number) => {
      if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
      if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만`;
      return String(Math.round(value));
    });

  /** 마우스를 올리지 않았을 때는 가장 최근 값(마지막 유효 표본)을 보여준다. */
  const latestValue = (row: ChartSeries): ChartPoint | undefined => [...row.points].reverse().find((point) => point.value > 0);

  return (
    <div ref={hostRef}>
      <div className="mb-2 flex min-h-[20px] flex-wrap items-center gap-x-4 gap-y-1">
        {series.map((row) => {
          const point = hoverIndex === null ? latestValue(row) : row.points[hoverIndex];
          return (
            <span key={row.key} className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-500">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: row.color }} />
              {row.label}
              <span className="num text-[11.5px] font-semibold text-ink-900">
                {point && point.value > 0 ? formatValue(point.value) : '—'}
              </span>
            </span>
          );
        })}
        <span className="ml-auto hidden text-[10.5px] text-ink-300 sm:block">
          {hoveredLabel ?? '마우스를 올리면 월별 값이 표시됩니다'}
        </span>
      </div>

      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${width} ${chartHeight}`}
        className="h-auto w-full touch-none select-none"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          {series.map((row) => (
            <linearGradient key={row.key} id={`${gradientId}-${row.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={row.color} stopOpacity="0.12" />
              <stop offset="100%" stopColor={row.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        <g transform={`translate(${padding.left},${padding.top})`}>
          {tickValues.map((value) => (
            <g key={value}>
              <line x1={0} x2={innerWidth} y1={yAt(value)} y2={yAt(value)} stroke="#eef1f4" strokeWidth="1" />
              <text x={-10} y={yAt(value) + 4} textAnchor="end" fontSize="9.5" fill="#9aa3af">
                {axisFormatter(value)}
              </text>
            </g>
          ))}

          {labels.map((label, index) => {
            if (index % xTickStep !== 0 && index !== labels.length - 1) return null;
            // 양 끝 라벨은 잘리지 않도록 축 안쪽으로 붙인다.
            const anchor = index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle';
            return (
              <text key={label} x={xAt(index)} y={innerHeight + 18} textAnchor={anchor} fontSize="9.5" fill="#9aa3af">
                {label.replace('-', '.')}
              </text>
            );
          })}

          {series.map((row) => {
            const valid = row.points
              .map((point, index) => ({ index, value: point.value }))
              .filter((point) => point.value > 0);
            if (valid.length === 0) return null;
            const line = valid.map((point) => `${xAt(point.index)},${yAt(point.value)}`).join(' ');
            const area = `${xAt(valid[0]!.index)},${innerHeight} ${line} ${xAt(valid[valid.length - 1]!.index)},${innerHeight}`;
            return (
              <g key={row.key}>
                {series.length === 1 && <polygon points={area} fill={`url(#${gradientId}-${row.key})`} />}
                <polyline
                  points={line}
                  fill="none"
                  stroke={row.color}
                  strokeWidth={1.8}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={row.dashed ? '5 4' : undefined}
                />
              </g>
            );
          })}

          {hoverIndex !== null && (
            <line
              x1={xAt(hoverIndex)}
              x2={xAt(hoverIndex)}
              y1={0}
              y2={innerHeight}
              stroke="#0f766e"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}

          {series.map((row) => {
            const point = hoverIndex === null ? undefined : row.points[hoverIndex];
            if (!point || point.value <= 0) return null;
            return (
              <circle
                key={row.key}
                cx={xAt(hoverIndex!)}
                cy={yAt(point.value)}
                r={4}
                fill="#ffffff"
                stroke={row.color}
                strokeWidth={2.5}
              />
            );
          })}

          {labels.map((label, index) => (
            <rect
              key={`hit-${label}`}
              x={xAt(index) - innerWidth / labels.length / 2}
              y={0}
              width={Math.max(6, innerWidth / labels.length)}
              height={innerHeight}
              fill="transparent"
              onMouseEnter={() => setHoverIndex(index)}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

interface BarChartProps {
  points: ChartPoint[];
  height?: number;
  color?: string;
  /** 좁은 카드에 놓을 때의 가로 기준. 지정하면 실측 폭 대신 이 값을 쓴다. */
  width?: number;
  formatValue: (value: number) => string;
  /** 축 라벨용 짧은 표기. 생략하면 값 크기에 따라 억/만 단위로 줄인다. */
  formatAxis?: (value: number) => string;
  ariaLabel: string;
  /** 막대 위에 값을 표시할지. 항목이 6개 이하일 때 읽기 쉽다. */
  showValues?: boolean;
  /** 막대 위 짧은 값 표기. 생략하면 formatValue를 쓴다. */
  formatLabel?: (value: number) => string;
}

/** 의존성 없는 SVG 막대 차트. 항목 이름과 축 값을 함께 그려 표만 봐도 읽히게 한다. */
export function BarChart({
  points,
  height = 170,
  color = '#1c2533',
  width: fixedWidth,
  formatValue,
  formatAxis,
  ariaLabel,
  showValues = true,
  formatLabel,
}: BarChartProps) {
  const gradientId = useId().replace(/:/g, '');
  const { hostRef, width: measuredWidth } = useChartWidth();
  const width = fixedWidth ?? measuredWidth;
  const narrow = width < 520;
  const leftPad = narrow ? 44 : BASE_PADDING.left;
  const rightPad = narrow ? 8 : BASE_PADDING.right;
  const chartHeight = narrow ? Math.min(height, 210) : height;
  const innerWidth = width - leftPad - rightPad;
  const innerHeight = chartHeight - BASE_PADDING.top - BASE_PADDING.bottom;
  const max = Math.max(1, ...points.map((point) => point.value));
  const slot = points.length === 0 ? innerWidth : innerWidth / points.length;
  const barWidth = Math.max(4, slot * 0.42);
  const showBarValues = showValues && slot >= 44;
  const axisFormatter =
    formatAxis ??
    ((value: number) => {
      if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
      if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만`;
      return String(Math.round(value));
    });
  const ticks = [1, 0.5, 0];

  return (
    <div ref={hostRef}>
      <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${chartHeight}`} className="h-auto w-full">
        <defs>
          <linearGradient id={`${gradientId}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.88" />
          </linearGradient>
        </defs>
        <g transform={`translate(${leftPad},${BASE_PADDING.top})`}>
          {ticks.map((ratio) => {
            const value = max * ratio;
            const y = innerHeight - ratio * innerHeight;
            return (
              <g key={ratio}>
                <line x1={0} x2={innerWidth} y1={y} y2={y} stroke={ratio === 0 ? '#dfe3e8' : '#f1f3f6'} strokeWidth={1} />
                <text x={-10} y={y + 4} textAnchor="end" fontSize="9.5" fill="#9aa3af">
                  {axisFormatter(value)}
                </text>
              </g>
            );
          })}
          {points.map((point, index) => {
            const barHeight = (point.value / max) * innerHeight;
            const x = index * slot + (slot - barWidth) / 2;
            return (
              <g key={point.label}>
                <rect
                  x={x}
                  y={innerHeight - barHeight}
                  width={barWidth}
                  height={Math.max(1, barHeight)}
                  rx={2}
                  fill={`url(#${gradientId}-bar)`}
                >
                  <title>{`${point.label} · ${formatValue(point.value)}`}</title>
                </rect>
                {showBarValues && (
                  <text
                    x={x + barWidth / 2}
                    y={innerHeight - barHeight - 6}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="600"
                    fill="#2c3849"
                  >
                    {(formatLabel ?? formatValue)(point.value)}
                  </text>
                )}
                <text x={x + barWidth / 2} y={innerHeight + 16} textAnchor="middle" fontSize="10" fill="#6b7686">
                  {point.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export function Sparkline({ values, color = '#0e7c6b' }: { values: number[]; color?: string }) {
  const width = 96;
  const height = 28;
  if (values.length < 2) return <svg width={width} height={height} />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const points = values
    .map((value, index) => `${(index / (values.length - 1)) * width},${height - ((value - min) / span) * (height - 4) - 2}`)
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
