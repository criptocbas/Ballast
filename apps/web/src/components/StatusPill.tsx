interface StatusPillProps {
  variant?: 'default' | 'positive' | 'warn' | 'danger';
  pulse?: boolean;
  children: React.ReactNode;
}

const VARIANT_STYLES: Record<NonNullable<StatusPillProps['variant']>, string> = {
  default: 'bg-[var(--bg-elev-2)] text-[var(--fg-dim)] border-[var(--border)]',
  positive: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  warn: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  danger: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
};

export function StatusPill({ variant = 'default', pulse = false, children }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider ${VARIANT_STYLES[variant]}`}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-75 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}
