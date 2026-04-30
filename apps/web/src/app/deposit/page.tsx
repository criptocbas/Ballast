import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusPill } from '@/components/StatusPill';
import { orchestrator } from '@/lib/orchestrator';
import { ExternalLink } from '@/components/ExternalLink';
import { DepositForm } from '@/components/DepositForm';

export const metadata: Metadata = {
  title: 'Deposit',
  description: 'Deposit USDC into the Ballast vault.',
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? '';
const ORCHESTRATOR_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:4000';

export default async function DepositPage() {
  let vault: Awaited<ReturnType<typeof orchestrator.vaultInfo>> | null = null;
  try {
    vault = await orchestrator.vaultInfo();
  } catch {
    // Orchestrator unavailable — page still renders, deposit form still works
    // (it talks to the vault directly via the wallet adapter).
  }

  const vaultAddress = vault?.address ?? VAULT_ADDRESS;
  const tvl =
    (vault?.lendPosition?.underlyingUsdc ?? 0) +
    (vault?.hedges.reduce((sum, h) => sum + h.valueUsd, 0) ?? 0);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <StatusPill pulse>Live on Solana mainnet</StatusPill>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Deposit</h1>
      <p className="mt-3 text-[var(--fg-dim)]">
        Deposit USDC into the Ballast vault. Funds flow into Jupiter Lend Earn on the next
        rebalance tick; the yield they generate finances NO-contract hedges.
      </p>

      {vaultAddress ? (
        <div className="mt-10">
          <DepositForm vaultAddress={vaultAddress} orchestratorUrl={ORCHESTRATOR_URL} />
        </div>
      ) : (
        <div className="mt-10 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">
          Vault address not configured. Set <code className="font-mono">NEXT_PUBLIC_VAULT_ADDRESS</code>{' '}
          in <code className="font-mono">.env</code>.
        </div>
      )}

      <div className="mt-10 card p-6">
        <div className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">
          Vault details
        </div>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-[var(--fg-muted)]">Address</div>
            <div className="mt-1 font-mono break-all text-fg">{vaultAddress || '—'}</div>
          </div>
          <div>
            <div className="text-[var(--fg-muted)]">Current TVL</div>
            <div className="mt-1 font-mono tabular-nums text-fg">
              {vault ? `$${tvl.toFixed(2)}` : '—'}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {vaultAddress && (
            <ExternalLink href={`https://solscan.io/account/${vaultAddress}`}>
              View on Solscan
            </ExternalLink>
          )}
          <span className="text-[var(--fg-muted)]">·</span>
          <span className="text-[var(--fg-dim)]">Cluster: {vault?.cluster ?? 'mainnet-beta'}</span>
          <span className="text-[var(--fg-muted)]">·</span>
          <span className="text-[var(--fg-dim)]">USDC only</span>
        </div>
      </div>

      <div className="mt-10 rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5 text-sm text-[var(--fg-dim)]">
        <strong className="text-fg">Alpha software.</strong> v1 is a transparent custodial vault
        built for the Solana Frontier Hackathon. Don&apos;t deposit funds you can&apos;t afford to
        lose. The deposit flow signs an SPL transfer to the vault address; the orchestrator records
        your contribution and routes it into Lend Earn on the next rebalance.{' '}
        <Link href="/about" className="text-fg underline-offset-4 hover:underline">
          Read more
        </Link>
        .
      </div>
    </div>
  );
}
