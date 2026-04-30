'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { ConnectButton } from './ConnectButton';
import { WithdrawForm } from './WithdrawForm';
import { StatusPill } from './StatusPill';
import type { DepositorMeResponse, VaultInfo } from '@/lib/orchestrator';

interface MePageClientProps {
  orchestratorUrl: string;
}

export function MePageClient({ orchestratorUrl }: MePageClientProps) {
  const { publicKey, connected } = useWallet();
  const [me, setMe] = useState<DepositorMeResponse | null>(null);
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setMe(null);
      setVault(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [meRes, vaultRes] = await Promise.all([
        fetch(`${orchestratorUrl}/api/me/${publicKey.toBase58()}`),
        fetch(`${orchestratorUrl}/vault/info`),
      ]);
      if (!meRes.ok) throw new Error(`me endpoint: ${meRes.status}`);
      if (!vaultRes.ok) throw new Error(`vault info: ${vaultRes.status}`);
      setMe((await meRes.json()) as DepositorMeResponse);
      setVault((await vaultRes.json()) as VaultInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [publicKey, orchestratorUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!connected || !publicKey) {
    return (
      <div className="card p-8">
        <StatusPill>Wallet required</StatusPill>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">You</h1>
        <p className="mt-2 text-[var(--fg-dim)]">
          Connect your Solana wallet to see your share, contributions, accrued payouts, and to
          withdraw.
        </p>
        <div className="mt-6">
          <ConnectButton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6">
        <StatusPill variant="danger">Orchestrator unreachable</StatusPill>
        <p className="mt-3 text-sm text-rose-300">{error}</p>
      </div>
    );
  }

  if (loading || !me) {
    return (
      <div className="card p-6">
        <StatusPill>Loading…</StatusPill>
      </div>
    );
  }

  // Vault current value × my share % = my position value (rough approximation —
  // proper accounting in v2 will use share tokens).
  const vaultTvl =
    (vault?.lendPosition?.underlyingUsdc ?? 0) +
    (vault?.hedges.reduce((s, h) => s + h.valueUsd, 0) ?? 0);
  const positionValue = vaultTvl * (me.sharePct / 100);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <StatusPill pulse>You · live</StatusPill>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Your Ballast position</h1>
        <p className="mt-2 text-sm text-[var(--fg-dim)]">
          Wallet:{' '}
          <span className="font-mono text-fg">
            {publicKey.toBase58().slice(0, 6)}…{publicKey.toBase58().slice(-6)}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Share"
          value={`${me.sharePct.toFixed(2)}%`}
          tone={me.sharePct > 0 ? 'accent' : 'muted'}
        />
        <Stat label="Contributed" value={`$${me.contributedUsdc.toFixed(2)}`} />
        <Stat label="Position value" value={`$${positionValue.toFixed(2)}`} />
        <Stat
          label="Payouts accrued"
          value={`$${me.payoutsAccruedUsdc.toFixed(4)}`}
          tone={me.payoutsAccruedUsdc > 0 ? 'positive' : 'muted'}
        />
      </div>

      <section className="card p-6">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="text-lg font-semibold">Withdraw</h2>
            <p className="mt-1 text-sm text-[var(--fg-dim)]">
              Withdraw any portion of your net balance back to your wallet. The orchestrator
              settles immediately if the vault has free USDC, otherwise queues for the next
              rebalance tick (which pulls from Lend Earn).
            </p>
          </div>
          <Stat label="Net balance" value={`$${me.balance.net.toFixed(4)}`} mono small />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-[var(--border)] pt-4 text-xs">
          <div>
            <div className="uppercase tracking-wider text-[var(--fg-muted)]">Contributed</div>
            <div className="mt-1 font-mono tabular-nums text-fg">
              ${me.balance.contributed.toFixed(4)}
            </div>
          </div>
          <div>
            <div className="uppercase tracking-wider text-[var(--fg-muted)]">Withdrawn</div>
            <div className="mt-1 font-mono tabular-nums text-fg">
              ${me.balance.withdrawn.toFixed(4)}
            </div>
          </div>
          <div>
            <div className="uppercase tracking-wider text-[var(--fg-muted)]">+ Payouts</div>
            <div className="mt-1 font-mono tabular-nums text-fg">
              ${me.balance.payouts.toFixed(4)}
            </div>
          </div>
        </div>
        <div className="mt-6">
          {me.balance.net > 0 ? (
            <WithdrawForm
              orchestratorUrl={orchestratorUrl}
              maxUsdc={me.balance.net}
              onSettled={() => void refresh()}
            />
          ) : (
            <p className="text-sm text-[var(--fg-muted)]">
              Nothing to withdraw yet — make a deposit first.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  tone?: 'accent' | 'positive' | 'muted' | 'default';
  mono?: boolean;
  small?: boolean;
}

function Stat({ label, value, tone = 'default', mono = false, small = false }: StatProps) {
  const toneClass =
    tone === 'accent'
      ? 'text-[var(--accent-bright)]'
      : tone === 'positive'
        ? 'text-emerald-400'
        : tone === 'muted'
          ? 'text-[var(--fg-muted)]'
          : 'text-fg';
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">{label}</div>
      <div
        className={`mt-2 ${small ? 'text-base' : 'text-xl'} font-semibold ${toneClass} ${mono ? 'font-mono tabular-nums' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}
