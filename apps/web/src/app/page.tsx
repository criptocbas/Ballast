import Link from 'next/link';
import { StatusPill } from '@/components/StatusPill';

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <section className="hero-glow relative overflow-hidden border-b border-[var(--border)]">
        <div className="mx-auto max-w-6xl px-6 pt-24 pb-32">
          <StatusPill pulse>Live on Solana mainnet</StatusPill>
          <h1 className="mt-6 max-w-3xl text-balance text-5xl font-semibold tracking-tight text-fg sm:text-6xl">
            Yield with a built-in tail-risk hedge.
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-[var(--fg-dim)]">
            Ballast deposits your USDC into Jupiter Lend Earn, then routes the yield it generates
            into NO-contract hedges on tail-risk prediction markets. In normal times you keep the
            residual yield; if a hedged event hits, the payout sweeps back to depositors.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/deposit"
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--accent)] px-5 text-sm font-medium text-white hover:bg-[var(--accent)]/90 transition-colors"
            >
              Deposit USDC
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="/vault"
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elev)] px-5 text-sm font-medium text-fg hover:bg-[var(--bg-elev-2)] transition-colors"
            >
              See live vault
            </Link>
          </div>
          <p className="mt-8 text-xs uppercase tracking-[0.18em] text-[var(--fg-muted)]">
            Built for the Solana Frontier Hackathon · Jupiter sidetrack
          </p>
        </div>
      </section>

      <section className="border-b border-[var(--border)]">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-px bg-[var(--border)] sm:grid-cols-3">
          <Step
            num="01"
            title="Deposit USDC"
            body="You connect your Solana wallet and deposit USDC into the vault. Funds go directly into Jupiter Lend Earn (jlUSDC, currently earning 4.36% APY)."
          />
          <Step
            num="02"
            title="Yield is routed into hedges"
            body="On every rebalance, accrued yield finances NO-contract positions on a curated basket of tail-risk prediction markets — BTC drawdowns, macro shocks, depeg events."
          />
          <Step
            num="03"
            title="Payouts sweep back"
            body="If a hedged event resolves YES (i.e. the bad thing happens), the prediction-market payout returns to the vault and is distributed pro-rata to depositors."
          />
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="grid gap-10 sm:grid-cols-[1.1fr_1fr] sm:gap-16">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              The flip that makes this work
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-[var(--fg-dim)]">
              Jupiter built Prediction as a speculation product and Lend as a yield product. Ballast
              treats them as the underwriting layer and the premium engine of an insurance vault —
              a composition the Jupiter SDKs don&apos;t directly support, but the public APIs make
              possible.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-[var(--fg-dim)]">
              Depositors never directly pay a premium. The vault self-insures with native
              primitives.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-6 font-mono text-[13px] leading-relaxed text-[var(--fg-dim)]">
            <div className="text-[var(--fg-muted)]"># A rebalance tick, schematically</div>
            <div className="mt-3">
              yield <span className="text-[var(--accent)]">←</span> Lend.withdrawAccrued(
              <span className="text-[var(--positive)]">vault</span>)
            </div>
            <div>
              hedges <span className="text-[var(--accent)]">←</span>{' '}
              Prediction.openNo(curatedBasket, yield × 0.5)
            </div>
            <div>
              compounded <span className="text-[var(--accent)]">←</span> Lend.deposit(
              <span className="text-[var(--positive)]">vault</span>, yield × 0.5)
            </div>
            <div className="mt-3">
              payouts <span className="text-[var(--accent)]">←</span>{' '}
              Prediction.claimResolved(hedges)
            </div>
            <div>
              shares <span className="text-[var(--accent)]">←</span>{' '}
              Vault.distribute(payouts ⊕ compounded)
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

interface StepProps {
  num: string;
  title: string;
  body: string;
}

function Step({ num, title, body }: StepProps) {
  return (
    <div className="bg-[var(--bg)] p-8 sm:p-10">
      <div className="font-mono text-xs text-[var(--fg-muted)]">{num}</div>
      <h3 className="mt-4 text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--fg-dim)]">{body}</p>
    </div>
  );
}
