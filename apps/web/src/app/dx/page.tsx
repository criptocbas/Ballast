import type { Metadata } from 'next';
import type { ApiObservation } from '@reflux/shared';
import { orchestrator } from '@/lib/orchestrator';
import { StatusPill } from '@/components/StatusPill';

export const metadata: Metadata = {
  title: 'DX log',
  description:
    'Live feed of every Jupiter API call the Ballast orchestrator has made — judges can verify integration depth in real time.',
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DxLogPage() {
  let data: Awaited<ReturnType<typeof orchestrator.dxObservations>> | null = null;
  let error: string | null = null;
  try {
    data = await orchestrator.dxObservations(200);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const observations = data?.observations ?? [];
  const stats = computeStats(observations);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <StatusPill pulse={!error} variant={error ? 'danger' : 'default'}>
        {error ? 'Orchestrator unreachable' : 'Live feed'}
      </StatusPill>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Developer Experience log</h1>
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-[var(--fg-dim)]">
        Every Jupiter API call the orchestrator makes is captured here. This is the public
        transparency surface for our submission — judges can verify our integration breadth and
        latency in real time, alongside the captured DX gaps in{' '}
        <code className="font-mono text-fg">docs/dx-log/</code>.
      </p>

      {error ? (
        <div className="mt-8 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">
          Orchestrator unreachable. Run{' '}
          <code className="font-mono text-rose-200">pnpm dev:orchestrator</code> to populate this
          page.
          <br />
          <span className="text-rose-300/80">Detail: {error}</span>
        </div>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Total calls" value={stats.total.toString()} />
            <Metric label="Success rate" value={stats.successRate} tone="positive" />
            <Metric label="Median latency" value={`${stats.medianMs}ms`} mono />
            <Metric label="Distinct paths" value={stats.distinctPaths.toString()} />
          </div>

          <div className="mt-8 overflow-hidden rounded-xl border border-[var(--border)]">
            <table className="w-full text-[13px]">
              <thead className="bg-[var(--bg-elev)] text-left text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Family</th>
                  <th className="px-3 py-2.5 font-medium">Method</th>
                  <th className="px-4 py-2.5 font-medium">Path</th>
                  <th className="px-4 py-2.5 font-medium text-right">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] font-mono">
                {observations.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-[var(--fg-muted)]"
                    >
                      No observations yet. The orchestrator records one per outbound Jupiter API
                      call.
                    </td>
                  </tr>
                ) : (
                  observations.map((obs, i) => <ObservationRow key={i} obs={obs} />)
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ObservationRow({ obs }: { obs: ApiObservation }) {
  const time = new Date(obs.startedAt).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
  const statusColor = obs.ok
    ? 'text-emerald-400'
    : obs.status >= 500
      ? 'text-rose-400'
      : 'text-amber-400';
  const latencyColor =
    obs.durationMs < 200
      ? 'text-emerald-400'
      : obs.durationMs < 800
        ? 'text-amber-400'
        : 'text-rose-400';
  const family = endpointFamily(obs.path);
  return (
    <tr className="hover:bg-[var(--bg-elev)]">
      <td className="px-4 py-2 text-[var(--fg-muted)] tabular-nums">{time}</td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${family.style}`}
        >
          {family.label}
        </span>
      </td>
      <td className="px-3 py-2 text-[var(--fg-dim)]">{obs.method}</td>
      <td className="px-4 py-2 text-fg">{obs.path}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${statusColor}`}>{obs.status}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${latencyColor}`}>{obs.durationMs}ms</td>
    </tr>
  );
}

interface FamilyTag {
  label: string;
  style: string;
}

function endpointFamily(path: string): FamilyTag {
  if (path.startsWith('/lend/')) {
    return { label: 'Lend', style: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
  }
  if (path.startsWith('/prediction/')) {
    return { label: 'Predict', style: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
  }
  if (path.startsWith('/swap/')) {
    return { label: 'Swap', style: 'bg-sky-500/10 text-sky-400 border-sky-500/30' };
  }
  if (path.startsWith('/tokens/')) {
    return { label: 'Tokens', style: 'bg-violet-500/10 text-violet-400 border-violet-500/30' };
  }
  if (path.startsWith('/portfolio/')) {
    return {
      label: 'Portfolio',
      style: 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/30',
    };
  }
  if (path.startsWith('/price/')) {
    return { label: 'Price', style: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' };
  }
  if (path.startsWith('/tx/')) {
    return { label: 'Tx', style: 'bg-rose-500/10 text-rose-400 border-rose-500/30' };
  }
  return {
    label: 'Other',
    style: 'bg-[var(--bg-elev-2)] text-[var(--fg-dim)] border-[var(--border)]',
  };
}

interface MetricProps {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'default' | 'positive';
}

function Metric({ label, value, mono = false, tone = 'default' }: MetricProps) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">{label}</div>
      <div
        className={`mt-1.5 text-lg font-semibold ${
          tone === 'positive' ? 'text-emerald-400' : 'text-fg'
        } ${mono ? 'font-mono tabular-nums' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}

interface DxStats {
  total: number;
  successRate: string;
  medianMs: number;
  distinctPaths: number;
}

function computeStats(obs: ApiObservation[]): DxStats {
  if (obs.length === 0) {
    return { total: 0, successRate: '—', medianMs: 0, distinctPaths: 0 };
  }
  const successes = obs.filter((o) => o.ok).length;
  const sortedMs = [...obs].map((o) => o.durationMs).sort((a, b) => a - b);
  const midIndex = Math.floor(sortedMs.length / 2);
  const median =
    sortedMs.length % 2 === 1
      ? (sortedMs[midIndex] ?? 0)
      : Math.round(((sortedMs[midIndex - 1] ?? 0) + (sortedMs[midIndex] ?? 0)) / 2);
  const distinct = new Set(obs.map((o) => o.path)).size;
  return {
    total: obs.length,
    successRate: `${((successes / obs.length) * 100).toFixed(1)}%`,
    medianMs: median,
    distinctPaths: distinct,
  };
}
