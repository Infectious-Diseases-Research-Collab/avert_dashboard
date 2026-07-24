import { cn } from "@/lib/cn";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("card p-5", className)}>{children}</div>;
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {subtitle && <p className="muted text-sm mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        {accent && (
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: accent }} />
        )}
        <span className="muted text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="muted text-xs mt-1">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] flex items-center justify-center mb-3">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 3 3 5-6" />
        </svg>
      </div>
      <p className="font-medium">{title}</p>
      {hint && <p className="muted text-sm mt-1 max-w-sm">{hint}</p>}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "open" | "resolved" | "dismissed" | "error" | "warning" | "info";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-[var(--surface-2)] text-[var(--text-muted)]",
    open: "bg-[color-mix(in_srgb,var(--warn)_18%,transparent)] text-[var(--warn)]",
    resolved: "bg-[color-mix(in_srgb,var(--good)_18%,transparent)] text-[var(--good)]",
    dismissed: "bg-[var(--surface-2)] text-[var(--text-muted)]",
    error: "bg-[color-mix(in_srgb,var(--error)_18%,transparent)] text-[var(--error)]",
    warning: "bg-[color-mix(in_srgb,var(--warn)_18%,transparent)] text-[var(--warn)]",
    info: "bg-[color-mix(in_srgb,var(--neg)_18%,transparent)] text-[var(--neg)]",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function fmtPct(n: number | null, digits = 1): string {
  return n == null ? "—" : `${n.toFixed(digits)}%`;
}

export function fmtNum(n: number | null, digits = 1): string {
  return n == null ? "—" : n.toFixed(digits);
}
