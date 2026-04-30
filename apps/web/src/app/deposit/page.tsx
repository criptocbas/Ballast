import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusPill } from '@/components/StatusPill';
import { orchestrator } from '@/lib/orchestrator';
import { ExternalLink } from '@/components/ExternalLink';

export const metadata: Metadata = {
  title: 'Deposit',
  description: 'Deposit USDC into the Reflux vault.',
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DepositPage() {
  let vault: Awaited<ReturnType<typeof orchestrator.vaultInfo>> | null = null;
  let error: string | null = null;
  try {
    vault = await orchestrator.vaultInfo();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <StatusPill variant="warn">Deposit flow — coming online</StatusPill>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Deposit</h1>
      <p className="mt-3 text-[var(--fg-dim)]">
        The wallet-adapter deposit flow lands with the next orchestrator update. In the meantime,
        if you&apos;re testing the vault directly, send USDC to the vault address below — the
        orchestrator will detect the transfer and credit your share on the next rebalance tick.
      </p>

      <div className="mt-10 card p-6">
        <div className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">
          Vault address
        </div>
        {vault ? (
          <>
            <div className="mt-2 font-mono break-all text-fg">{vault.address}</div>
            <div className="mt-3 flex gap-3 text-sm">
              <ExternalLink href={vault.solscanUrl}>View on Solscan</ExternalLink>
              <span className="text-[var(--fg-muted)]">·</span>
              <span className="text-[var(--fg-dim)]">Cluster: {vault.cluster}</span>
            </div>
          </>
        ) : (
          <div className="mt-2 text-sm text-rose-400">
            {error ?? 'Orchestrator unavailable'}
          </div>
        )}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <InfoBlock title="USDC mint">
          <code className="font-mono text-[12px] break-all">
            EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
          </code>
        </InfoBlock>
        <InfoBlock title="Minimum deposit">$10 USDC</InfoBlock>
      </div>

      <div className="mt-12 rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5 text-sm text-[var(--fg-dim)]">
        <strong className="text-fg">⚠ Alpha software.</strong> v1 is a transparent custodial vault
        built for the Solana Frontier Hackathon. Don&apos;t deposit funds you can&apos;t afford to
        lose.{' '}
        <Link href="/about" className="text-fg underline-offset-4 hover:underline">
          Read more
        </Link>
        .
      </div>
    </div>
  );
}

interface InfoBlockProps {
  title: string;
  children: React.ReactNode;
}

function InfoBlock({ title, children }: InfoBlockProps) {
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">{title}</div>
      <div className="mt-2 text-fg">{children}</div>
    </div>
  );
}
