import type { Metadata } from 'next';
import { orchestrator } from '@/lib/orchestrator';
import { StatusPill } from '@/components/StatusPill';
import { ExternalLink } from '@/components/ExternalLink';

export const metadata: Metadata = {
  title: 'Vault',
  description: 'Live state of the Reflux vault — TVL, hedges, yield budget, and payout exposure.',
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function VaultPage() {
  let vault: Awaited<ReturnType<typeof orchestrator.vaultInfo>> | null = null;
  let lend: Awaited<ReturnType<typeof orchestrator.lendTokens>> | null = null;
  let error: string | null = null;
  try {
    [vault, lend] = await Promise.all([orchestrator.vaultInfo(), orchestrator.lendTokens()]);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex items-end justify-between">
        <div>
          <StatusPill pulse={!error} variant={error ? 'danger' : 'default'}>
            {error ? 'Orchestrator unreachable' : 'Live'}
          </StatusPill>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Vault</h1>
          <p className="mt-2 text-[var(--fg-dim)]">
            Real-time state of the Reflux vault and its Jupiter Lend Earn position.
          </p>
        </div>
        {vault && (
          <ExternalLink href={vault.solscanUrl} className="text-sm">
            View on Solscan
          </ExternalLink>
        )}
      </div>

      {error && (
        <div className="mt-8 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">
          Couldn&apos;t reach the orchestrator. Make sure it&apos;s running:{' '}
          <code className="font-mono text-rose-200">pnpm dev:orchestrator</code>
          <br />
          <span className="text-rose-300/80">Detail: {error}</span>
        </div>
      )}

      {vault && (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Vault address" value={shortAddress(vault.address)} mono small />
            <Stat label="Cluster" value={vault.cluster} mono />
            <Stat
              label="SOL for gas"
              value={`${vault.solBalance.toFixed(4)} SOL`}
              mono
              tone={vault.solBalance > 0.01 ? 'positive' : 'warn'}
            />
          </div>

          {vault.lendPosition && (
            <section className="mt-10 rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">
                    Lend Earn position
                  </div>
                  <div className="mt-2 flex items-baseline gap-3">
                    <span className="font-mono tabular-nums text-3xl font-semibold text-fg">
                      ${vault.lendPosition.underlyingUsdc.toFixed(4)}
                    </span>
                    <span className="text-sm text-[var(--fg-dim)]">
                      held in {vault.lendPosition.jlTokenSymbol}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">
                    APY
                  </div>
                  <div className="mt-2 font-mono tabular-nums text-2xl font-semibold text-emerald-400">
                    {(vault.lendPosition.totalApyBps / 100).toFixed(2)}%
                  </div>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--border)] pt-4 text-xs text-[var(--fg-dim)]">
                <span>
                  jlUSDC base units:{' '}
                  <span className="font-mono text-fg">
                    {vault.lendPosition.jlTokenBalanceBaseUnits}
                  </span>
                </span>
                <span>
                  Underlying:{' '}
                  <span className="font-mono text-fg">
                    {vault.lendPosition.underlyingSymbol}
                  </span>
                </span>
              </div>
            </section>
          )}
        </>
      )}

      {lend && (
        <section className="mt-14">
          <h2 className="text-xl font-semibold tracking-tight">Jupiter Lend Earn rates</h2>
          <p className="mt-2 text-sm text-[var(--fg-dim)]">
            Live snapshot from <span className="font-mono">/lend/v1/earn/tokens</span>. Reflux v1
            uses jlUSDC; higher-yield assets like JUICED and USDG are candidates for v1.5.
          </p>
          <div className="mt-5 overflow-hidden rounded-xl border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-elev)] text-left text-xs uppercase tracking-wider text-[var(--fg-muted)]">
                <tr>
                  <th className="px-5 py-3 font-medium">Receipt</th>
                  <th className="px-5 py-3 font-medium">Underlying</th>
                  <th className="px-5 py-3 font-medium text-right">APY</th>
                  <th className="px-5 py-3 font-medium text-right">TVL</th>
                  <th className="px-5 py-3 font-medium text-right">Withdrawable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {lend.tokens.map((t) => (
                  <tr key={t.symbol} className="hover:bg-[var(--bg-elev)]">
                    <td className="px-5 py-3.5 font-medium">{t.symbol}</td>
                    <td className="px-5 py-3.5 text-[var(--fg-dim)]">{t.assetSymbol}</td>
                    <td className="px-5 py-3.5 text-right font-mono tabular-nums text-emerald-400">
                      {t.totalRateApy}
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono tabular-nums text-[var(--fg-dim)]">
                      {formatUsd(t.totalAssetsUsd)}
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono tabular-nums text-[var(--fg-muted)]">
                      {formatUsd(t.withdrawableUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Hedges</h2>
            <p className="mt-2 text-sm text-[var(--fg-dim)]">
              Open prediction-market positions financed by the vault&apos;s yield.
            </p>
          </div>
          {vault?.hedges.length ? (
            <span className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">
              {vault.hedges.length} position{vault.hedges.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
        {vault && vault.hedges.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-[var(--border)] p-12 text-center">
            <p className="font-mono text-sm text-[var(--fg-muted)]">
              No open hedges yet. Run{' '}
              <code className="text-fg">scripts/openHedge.ts</code> or wait for the rebalance loop.
            </p>
          </div>
        ) : null}
        {vault && vault.hedges.length > 0 ? (
          <div className="mt-5 grid gap-3">
            {vault.hedges.map((h) => (
              <HedgeCard key={h.positionPubkey} hedge={h} />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
  tone?: 'default' | 'positive' | 'warn' | 'danger';
}

function Stat({ label, value, mono = false, small = false, tone = 'default' }: StatProps) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-400'
        : tone === 'danger'
          ? 'text-rose-400'
          : 'text-fg';
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">{label}</div>
      <div
        className={`mt-2 ${small ? 'text-base' : 'text-2xl'} font-medium ${toneClass} ${mono ? 'font-mono tabular-nums' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}

interface HedgeCardProps {
  hedge: import('@/lib/orchestrator').HedgeSummary;
}

function HedgeCard({ hedge }: HedgeCardProps) {
  const closeDate = hedge.closeTime ? new Date(hedge.closeTime * 1000) : null;
  const sideStyle =
    hedge.side === 'NO'
      ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
  const pnlPositive = hedge.pnlUsd >= 0;
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${sideStyle}`}
            >
              {hedge.side}
            </span>
            <span className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">
              Hedge
            </span>
          </div>
          <h3 className="mt-2 text-base font-medium">{hedge.eventTitle}</h3>
          <p className="mt-0.5 text-sm text-[var(--fg-dim)]">{hedge.marketTitle}</p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">Value</div>
          <div className="mt-1 font-mono tabular-nums text-lg font-semibold">
            ${hedge.valueUsd.toFixed(2)}
          </div>
          <div
            className={`text-xs font-mono tabular-nums ${pnlPositive ? 'text-emerald-400' : 'text-rose-400'}`}
          >
            {pnlPositive ? '+' : ''}${hedge.pnlUsd.toFixed(2)} (
            {pnlPositive ? '+' : ''}
            {hedge.pnlPct.toFixed(1)}%)
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--border)] pt-3 text-xs sm:grid-cols-4">
        <div>
          <div className="uppercase tracking-wider text-[var(--fg-muted)]">Contracts</div>
          <div className="font-mono tabular-nums text-fg">{hedge.contracts}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider text-[var(--fg-muted)]">Avg / Mark</div>
          <div className="font-mono tabular-nums text-fg">
            ${hedge.avgPriceUsd.toFixed(3)} / ${hedge.markPriceUsd.toFixed(3)}
          </div>
        </div>
        <div>
          <div className="uppercase tracking-wider text-[var(--fg-muted)]">Cost basis</div>
          <div className="font-mono tabular-nums text-fg">
            ${hedge.costBasisUsd.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="uppercase tracking-wider text-[var(--fg-muted)]">Resolves</div>
          <div className="font-mono tabular-nums text-fg">
            {closeDate ? closeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

function shortAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

function formatUsd(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(2)}K`;
  return `$${usd.toFixed(2)}`;
}
