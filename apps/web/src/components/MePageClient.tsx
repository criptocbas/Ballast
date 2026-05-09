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

  const vaultTvl =
    (vault?.lendPosition?.underlyingUsdc ?? 0) +
    (vault?.hedges.reduce((s, h) => s + h.valueUsd, 0) ?? 0);
  const positionValue = vaultTvl * (me.sharePct / 100);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <StatusPill>Your position</StatusPill>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Your Ballast position</h1>
        <p className="mt-2 text-sm text-[var(--fg-dim)]">
          Wallet:{' '}
          <span className="font-mono text-fg">
            {publicKey.toBase58().slice(0, 6)}…{publicKey.toBase58().slice(-6)}
          </span>
        </p>
      </div>

      <div className="card p-6">
        <div className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">
          Position value
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono tabular-nums text-4xl font-semibold text-fg">
            ${positionValue.toFixed(2)}
          </span>
          <span className="text-sm text-[var(--fg-dim)]">
            <span className="font-mono tabular-nums text-[var(--accent-bright)]">
              {me.sharePct.toFixed(2)}%
            </span>{' '}
            of vault TVL
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Contributed" value={`$${me.contributedUsdc.toFixed(2)}`} />
        <Stat
          label="Payouts accrued"
          value={`$${me.payoutsAccruedUsdc.toFixed(4)}`}
          tone={me.payoutsAccruedUsdc > 0 ? 'positive' : 'muted'}
        />
      </div>

      <section className="card p-6">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Withdraw</h2>
            <p className="mt-1 text-sm text-[var(--fg-dim)]">
              Withdraw any portion of your <em>withdrawable now</em> balance back to your wallet.
              The orchestrator settles immediately if the vault has free USDC, otherwise queues
              for the next rebalance tick (which pulls from Lend Earn).
            </p>
          </div>
          <Stat
            label="Withdrawable now"
            value={`$${me.withdrawable.withdrawableNow.toFixed(4)}`}
            mono
            small
            tone="positive"
          />
        </div>

        {me.withdrawable.hedgeLockedUsdc > 0.0001 && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
            <span className="font-medium text-fg">
              ${me.withdrawable.hedgeLockedUsdc.toFixed(2)} locked in open hedges.
            </span>{' '}
            Your notional balance is{' '}
            <span className="font-mono tabular-nums text-fg">
              ${me.withdrawable.notionalNet.toFixed(2)}
            </span>
            , but the vault&apos;s redeemable USDC right now is{' '}
            <span className="font-mono tabular-nums text-fg">
              ${me.withdrawable.redeemableVaultUsdc.toFixed(2)}
            </span>{' '}
            (wallet + Lend Earn). The remainder is in open NO-contract positions that become
            liquid only when those markets resolve.
          </div>
        )}

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
          {me.withdrawable.withdrawableNow > 0.0001 ? (
            <WithdrawForm
              orchestratorUrl={orchestratorUrl}
              maxUsdc={me.withdrawable.withdrawableNow}
              onSettled={() => void refresh()}
            />
          ) : me.balance.net > 0.0001 ? (
            <p className="text-sm text-[var(--fg-muted)]">
              Vault has no redeemable USDC right now — your $
              {me.balance.net.toFixed(2)} notional is all hedge-locked. Withdrawable will recover
              when a rebalance tick withdraws yield from Lend Earn or a hedge resolves.
            </p>
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
