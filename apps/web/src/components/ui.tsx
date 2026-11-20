import type { ReactNode } from 'react';
import { riskLevelLabel, type RiskLevel } from '@prop/shared';

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
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200/80 px-4 py-3 sm:px-5">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink-800">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="card-pad">{children}</div>
    </section>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'up' | 'down';
}) {
  const toneClass = tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-rose-600' : 'text-ink-800';
  return (
    <div className="card card-pad">
      <div className="label">{label}</div>
      <div className={`num mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  succeeded: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  running: 'bg-sky-50 text-sky-700 border-sky-200',
  queued: 'bg-slate-100 text-slate-600 border-slate-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  local: 'bg-slate-100 text-slate-600 border-slate-200',
  api: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
};

const STATUS_LABEL: Record<string, string> = {
  succeeded: '성공',
  partial: '부분 성공',
  failed: '실패',
  running: '실행 중',
  queued: '대기',
  resolved: '해결',
  pending: '대기',
  local: '로컬 적재',
  api: 'API 적재',
  rejected: '검증 제외',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        STATUS_STYLES[status] ?? 'border-slate-200 bg-slate-50 text-slate-600'
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** 전세가율·리스크 단계 배지. 같은 단계가 화면마다 같은 색으로 보이게 한다. */
export function RiskBadge({ level, children }: { level: RiskLevel; children?: ReactNode }) {
  const styles: Record<RiskLevel, string> = {
    low: 'border-slate-200 bg-slate-50 text-slate-600',
    moderate: 'border-amber-200 bg-amber-50 text-amber-800',
    high: 'border-orange-300 bg-orange-50 text-orange-800',
    critical: 'border-rose-300 bg-rose-50 text-rose-700',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${styles[level]}`}>
      {children ?? riskLevelLabel(level)}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-600">
        {label}
        {hint && <span className="num text-[11px] text-slate-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>
  );
}

export function DataNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">{children}</p>
  );
}
