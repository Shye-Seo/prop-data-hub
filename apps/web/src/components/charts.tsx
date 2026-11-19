import { useId, useState } from 'react';

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

const PADDING = { top: 16, right: 18, bottom: 26, left: 76 };
const WIDTH = 760;

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
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const labels = series[0]?.points.map((point) => point.label) ?? [];
  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = height - PADDING.top - PADDING.bottom;

  if (labels.length === 0) {
    return <div className="flex h-40 items-center justify-center text-sm text-slate-400">{emptyMessage ?? '표시할 데이터가 없습니다.'}</div>;
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
  const xTickStep = Math.max(1, Math.ceil(labels.length / xTickCount));

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
    <div>
      <div className="mb-2 flex min-h-[22px] flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {series.map((row) => {
          const point = hoverIndex === null ? latestValue(row) : row.points[hoverIndex];
          return (
            <span key={row.key} className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: row.color }} />
              {row.label}
              <span className="num font-semibold text-slate-900">
                {point && point.value > 0 ? formatValue(point.value) : '—'}
              </span>
            </span>
          );
        })}
        <span className="ml-auto text-[11px] text-slate-400">{hoveredLabel ?? '마우스를 올리면 월별 값이 표시됩니다'}</span>
      </div>

      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full touch-none select-none"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          {series.map((row) => (
            <linearGradient key={row.key} id={`${gradientId}-${row.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={row.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={row.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        <g transform={`translate(${PADDING.left},${PADDING.top})`}>
          {tickValues.map((value) => (
            <g key={value}>
              <line x1={0} x2={innerWidth} y1={yAt(value)} y2={yAt(value)} stroke="#e2e8f0" strokeWidth="1" />
              <text x={-10} y={yAt(value) + 4} textAnchor="end" fontSize="9.5" fill="#94a3b8">
                {axisFormatter(value)}
              </text>
            </g>
          ))}

          {labels.map((label, index) =>
            index % xTickStep === 0 || index === labels.length - 1 ? (
              <text key={label} x={xAt(index)} y={innerHeight + 18} textAnchor="middle" fontSize="10" fill="#94a3b8">
                {label.replace('-', '.')}
              </text>
            ) : null,
          )}

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
                  strokeWidth={2.2}
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
  formatValue: (value: number) => string;
  ariaLabel: string;
}

export function BarChart({ points, height = 160, color = '#12355f', formatValue, ariaLabel }: BarChartProps) {
  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = height - PADDING.top - PADDING.bottom;
  const max = Math.max(1, ...points.map((point) => point.value));
  const barWidth = Math.max(2, innerWidth / points.length - 2);

  return (
    <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${WIDTH} ${height}`} className="h-auto w-full">
      <g transform={`translate(${PADDING.left},${PADDING.top})`}>
        <line x1={0} x2={innerWidth} y1={innerHeight} y2={innerHeight} stroke="#e2e8f0" />
        {points.map((point, index) => {
          const barHeight = (point.value / max) * innerHeight;
          const x = (index / points.length) * innerWidth + 1;
          return (
            <g key={point.label}>
              <rect
                x={x}
                y={innerHeight - barHeight}
                width={barWidth}
                height={barHeight}
                rx={2}
                fill={color}
                opacity={0.85}
              >
                <title>{`${point.label} · ${formatValue(point.value)}`}</title>
              </rect>
            </g>
          );
        })}
        <text x={-10} y={10} textAnchor="end" fontSize="9.5" fill="#94a3b8">
          {formatValue(max)}
        </text>
        <text x={-10} y={innerHeight} textAnchor="end" fontSize="9.5" fill="#94a3b8">
          0
        </text>
      </g>
    </svg>
  );
}

export function Sparkline({ values, color = '#0f766e' }: { values: number[]; color?: string }) {
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
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
