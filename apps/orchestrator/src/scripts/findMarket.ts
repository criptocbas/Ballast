/**
 * Find a candidate market for a quick on-chain hedge test. Prints the next-to-resolve
 * 5-minute "Up or Down" market on a chosen asset.
 *
 *   pnpm --filter @reflux/orchestrator exec tsx src/scripts/findMarket.ts [asset]
 *
 * `asset` defaults to "Bitcoin". Try "Solana", "Ethereum", "XRP".
 */
import { getJupiterClients } from '../jupiter.js';

interface PolyMarketRef {
  marketId: string;
}

interface PolyEventLite {
  eventId: string;
  isLive: boolean;
  isActive: boolean;
  metadata?: { title?: string };
  beginAt?: number;
  closeCondition?: string;
  markets: PolyMarketRef[];
}

async function main(): Promise<void> {
  const asset = process.argv[2] ?? 'Bitcoin';
  const { prediction } = getJupiterClients();

  console.log(`Searching live crypto events with title containing "${asset}"...`);
  const page = await prediction.listEvents({
    category: 'crypto',
    filter: 'live',
    search: asset,
    limit: 50,
  });

  const candidates = (page.data as unknown as PolyEventLite[])
    .filter((e) => (e.metadata?.title ?? '').includes('Up or Down'))
    .filter((e) => (e.metadata?.title ?? '').includes(asset))
    .sort(
      (a, b) =>
        ((a.beginAt as number | undefined) ?? 0) - ((b.beginAt as number | undefined) ?? 0),
    );

  if (candidates.length === 0) {
    console.log('No live "Up or Down" market found for this asset.');
    process.exit(1);
  }

  const ev = candidates[0];
  if (!ev) {
    console.log('No live "Up or Down" market found for this asset.');
    process.exit(1);
  }
  console.log('');
  console.log(`Event   : ${ev.metadata?.title ?? '(no title)'}`);
  console.log(`EventId : ${ev.eventId}`);
  console.log(`Markets :`);

  for (const m of ev.markets) {
    const md = await prediction.getMarket(m.marketId);
    const yesAsk = md.pricing.buyYesPriceUsd / 1_000_000;
    const noAsk = md.pricing.buyNoPriceUsd / 1_000_000;
    console.log(
      `  ${m.marketId.padEnd(20)} title=${md.title.padEnd(8)} ` +
        `YES@$${yesAsk.toFixed(3)}  NO@$${noAsk.toFixed(3)}  closes=${new Date(md.closeTime * 1000).toISOString()}`,
    );
  }
}

main().catch((err: unknown) => {
  if (err instanceof Error) console.error('Error:', err.message);
  else console.error('Error:', err);
  process.exit(1);
});
