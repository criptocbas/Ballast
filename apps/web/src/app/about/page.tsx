import type { Metadata } from 'next';
import { ExternalLink } from '@/components/ExternalLink';

export const metadata: Metadata = {
  title: 'About',
  description: 'How Ballast works and why we built it.',
};

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">About Ballast</h1>

      <Section title="The thesis">
        <p>
          DeFi has yield. DeFi does not have well-priced tail-risk insurance. Existing options —
          custodial cover protocols, options-based hedges, manual position management — are all
          expensive, illiquid, or operationally ugly.
        </p>
        <p>
          Ballast is a small experiment: what if you used Jupiter&apos;s prediction-market product
          (built for retail speculation) as the underwriting engine of a yield product (built for
          retail savings)? The two were designed for different audiences. The composition exists
          only because the public APIs allow it.
        </p>
      </Section>

      <Section title="What Ballast does">
        <p>
          Depositors send USDC to a vault wallet. The vault deposits the USDC into Jupiter Lend
          Earn (currently jlUSDC at ~4.24% APY). On every rebalance tick, the vault withdraws the
          accrued yield and uses a configurable fraction of it to buy NO contracts on a curated
          basket of tail-risk prediction markets — BTC drawdowns, macro shocks, depeg events. If a
          hedged event resolves YES, the prediction-market payout sweeps back to the vault and is
          distributed pro-rata to depositors.
        </p>
        <p>
          The vault is custodial in v1 — a transparent single-keypair design that lets us focus all
          time on the Jupiter integration depth. Every deposit, withdrawal, and hedge is on-chain
          and publicly verifiable. v2 contemplates an on-chain vault program with audited share
          accounting.
        </p>
      </Section>

      <Section title="Why we built it">
        <p>
          Ballast is our submission for the{' '}
          <ExternalLink href="https://superteam.fun/earn/hackathon/frontier" className="inline">
            Solana Frontier Hackathon
          </ExternalLink>{' '}
          — Jupiter&apos;s &quot;Not Your Regular Bounty&quot; sidetrack. Jupiter said they were
          tired of &quot;best app built with Jupiter&quot; submissions and wanted compositions that
          would make them go &quot;oh.&quot; Predictions-as-actuarial-machinery is our attempt at
          that.
        </p>
        <p>
          More importantly, the bounty rubric weights the developer experience report at 35% and
          AI-stack feedback at 25%. The build exists partly to generate honest, actionable signal
          on Jupiter&apos;s platform — what worked, what didn&apos;t, what should change. That
          signal lives publicly at{' '}
          <ExternalLink href="/dx" className="inline">
            /dx
          </ExternalLink>{' '}
          and in{' '}
          <ExternalLink
            href="https://github.com/criptocbas/Ballast/tree/main/docs/dx-log"
            className="inline"
          >
            docs/dx-log/
          </ExternalLink>
          .
        </p>
      </Section>

      <Section title="What this is not">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong className="text-fg">Not insurance.</strong> Ballast offsets some downside while
            principal earns yield. It is not a regulated insurance product and the hedges may be
            insufficient for a given event.
          </li>
          <li>
            <strong className="text-fg">Not custody-grade.</strong> v1 is a transparent custodial
            vault built to ship in two weeks. Don&apos;t deposit funds you can&apos;t afford to
            lose.
          </li>
          <li>
            <strong className="text-fg">Not financial advice.</strong> Tail risk is, by definition,
            hard to price. Every hedge has a thesis baked into it; we may be wrong.
          </li>
        </ul>
      </Section>
    </div>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="mt-14">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-[var(--fg-dim)]">
        {children}
      </div>
    </section>
  );
}
