import { orchestrator } from '@/lib/orchestrator';

/**
 * Tiny live-TVL strip for the landing hero. Server-rendered, no-store, so it
 * always shows the current state of the vault.
 *
 * Renders nothing if the orchestrator is unreachable — we never want a server
 * error to block the marketing page.
 */
export async function LiveTvl() {
  let tvl = 0;
  let lendUsdc = 0;
  let hedgesValueUsd = 0;
  let hedgesCount = 0;
  let address: string | null = null;

  try {
    const vault = await orchestrator.vaultInfo();
    lendUsdc = vault.lendPosition?.underlyingUsdc ?? 0;
    hedgesValueUsd = vault.hedges.reduce((sum, h) => sum + h.valueUsd, 0);
    hedgesCount = vault.hedges.length;
    tvl = lendUsdc + hedgesValueUsd;
    address = vault.address;
  } catch {
    return null;
  }

  return (
    <div className="mt-10 inline-flex items-stretch gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] text-[13px] sm:text-sm">
      <Cell label="TVL" value={`$${tvl.toFixed(2)}`} accent />
      <Cell label="In Lend Earn" value={`$${lendUsdc.toFixed(2)}`} />
      <Cell
        label="Hedges"
        value={hedgesCount === 0 ? '—' : `${hedgesCount} · $${hedgesValueUsd.toFixed(2)}`}
      />
      {address ? (
        <a
          href={`https://solscan.io/account/${address}`}
          target="_blank"
          rel="noreferrer"
          className="flex flex-col justify-center gap-0.5 bg-[var(--bg-elev)] px-4 py-3 hover:bg-[var(--bg-elev-2)] transition-colors"
        >
          <span className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">
            Vault
          </span>
          <span className="font-mono tabular-nums text-[var(--fg-dim)] hover:text-fg">
            {shortAddress(address)} ↗
          </span>
        </a>
      ) : null}
    </div>
  );
}

function Cell({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-[var(--bg-elev)] px-4 py-3">
      <span className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">{label}</span>
      <span
        className={`font-mono tabular-nums ${accent ? 'text-[var(--accent-bright)] font-semibold' : 'text-fg'}`}
      >
        {value}
      </span>
    </div>
  );
}

function shortAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
