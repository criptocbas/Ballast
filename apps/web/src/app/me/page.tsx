import type { Metadata } from 'next';
import { MePageClient } from '@/components/MePageClient';

export const metadata: Metadata = {
  title: 'You',
  description: 'Your Ballast share, contributions, payouts, and withdrawals.',
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ORCHESTRATOR_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:4000';

export default function MePage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <MePageClient orchestratorUrl={ORCHESTRATOR_URL} />
    </div>
  );
}
