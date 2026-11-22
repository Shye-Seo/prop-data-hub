import type { ReactNode } from 'react';
import { riskLevelLabel, type RiskLevel } from '@prop/shared';

/**
 * 화면의 기본 판. 제목 줄과 본문 사이는 헤어라인 하나로만 나눈다.
 * 그림자·색 배경 없이 정보가 먼저 보이게 두는 것이 이 화면의 규칙이다.
 */
export function Card({
  children,
  className = '',
  title,
  subtitle,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          <div className="min-w-0">
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="card-pad">{children}</div>
    </section>
  );
}

/** 상단 KPI 스트립. 한 장의 흰 판에 칸을 나누고 칸 사이만 헤어라인으로 긋는다. */
export function StatGrid({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`stat-grid ${className}`}>{children}</div>;
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
  testId,
  action,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  tone?: 'default' | 'up' | 'down' | 'accent';
  testId?: string;
  action?: ReactNode;
}) {
  const toneClass =
    tone === 'up'
      ? 'text-emerald-700'
      : tone === 'down'
        ? 'text-rose-700'
        : tone === 'accent'
          ? 'text-accent'
          : 'text-ink-900';
  return (
    <div className="stat">
      {action ? (
        <div className="flex items-start justify-between gap-2">
          <p className="label">{label}</p>
          {action}
        </div>
      ) : (
        <p className="label">{label}</p>
      )}
      <p className={`stat-value ${toneClass}`} data-testid={testId}>
        {value}
      </p>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

/** 기존 호출부를 위한 별칭. 새 코드는 Stat을 쓴다. */
export function Kpi(props: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'up' | 'down';
}) {
  return <Stat {...props} />;
}

const STATUS_TONE: Record<string, { dot: string; label: string }> = {
  succeeded: { dot: 'bg-emerald-500', label: '성공' },
  partial: { dot: 'bg-amber-500', label: '부분 성공' },
  failed: { dot: 'bg-rose-500', label: '실패' },
  running: { dot: 'bg-sky-500', label: '실행 중' },
  queued: { dot: 'bg-slate-400', label: '대기' },
  resolved: { dot: 'bg-emerald-500', label: '해결' },
  pending: { dot: 'bg-amber-500', label: '대기' },
  local: { dot: 'bg-slate-400', label: '로컬 적재' },
  api: { dot: 'bg-emerald-500', label: 'API 적재' },
  rejected: { dot: 'bg-rose-500', label: '검증 제외' },
};

/**
 * 상태는 색을 칠한 배지가 아니라 작은 점 + 텍스트로 보여준다.
 * 색을 구분하지 못해도 라벨만 읽으면 상태를 알 수 있어야 한다.
 */
export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? { dot: 'bg-slate-400', label: status };
  return (
    <span className="status">
      <span className={`dot ${tone.dot}`} aria-hidden="true" />
      {tone.label}
    </span>
  );
}

/** 전세가율·리스크 단계. 같은 단계가 화면마다 같은 점 색으로 보이게 한다. */
export function RiskBadge({ level, children }: { level: RiskLevel; children?: ReactNode }) {
  const dot: Record<RiskLevel, string> = {
    low: 'bg-slate-400',
    moderate: 'bg-amber-500',
    high: 'bg-orange-500',
    critical: 'bg-rose-500',
  };
  return (
    <span className="status text-[10.5px] font-medium text-ink-600">
      <span className={`dot ${dot[level]}`} aria-hidden="true" />
      {children ?? riskLevelLabel(level)}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-[11.5px] font-medium text-ink-600">
        {label}
        {hint && <span className="num text-[10.5px] font-normal text-ink-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-canvas/60 px-4 py-8 text-center">
      <p className="text-[12.5px] font-medium text-ink-700">{title}</p>
      <p className="mt-1 text-[11px] text-ink-400">{description}</p>
    </div>
  );
}

/** 카드 하단의 각주. 별도 회색 상자 대신 헤어라인 하나로 본문과 나눈다. */
export function DataNote({ children }: { children: ReactNode }) {
  return <div className="note">{children}</div>;
}

/** 필터 줄 왼쪽에 붙는 작은 제목. */
export function FilterLabel({ children }: { children: ReactNode }) {
  return <span className="label mr-1 shrink-0">{children}</span>;
}
