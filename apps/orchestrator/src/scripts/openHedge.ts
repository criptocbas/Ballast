/**
 * Open a NO-contract hedge order on a Jupiter Prediction market.
 *
 *   pnpm --filter @ballast/orchestrator exec tsx src/scripts/openHedge.ts <marketId> <usdc> [--side=yes|no] [--dry-run]
 *
 * Examples:
 *   # Simulate buying $0.50 of NO contracts on a market
 *   pnpm --filter @ballast/orchestrator exec tsx src/scripts/openHedge.ts POLY-2114146-0 0.5 --dry-run
 *
 *   # Live: buy $0.50 of NO contracts (default side)
 *   pnpm --filter @ballast/orchestrator exec tsx src/scripts/openHedge.ts POLY-2114146-0 0.5
 */
import { openHedgeOrder, waitForOrderFill } from '../prediction.js';
import { getJupiterClients } from '../jupiter.js';
import { getVaultWallet } from '../wallet.js';
import { getDb } from '../db/index.js';
import { hedges as hedgesTable } from '../db/schema.js';

interface ParsedArgs {
  marketId: string;
  depositUsdc: number;
  isYes: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let isYes = false;
  let dryRun = false;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--side=')) isYes = a.slice('--side='.length) === 'yes';
    else positional.push(a);
  }
  const [marketIdRaw, usdcRaw] = positional;
  if (!marketIdRaw || !usdcRaw) {
    console.error(
      'Usage: openHedge.ts <marketId> <usdc> [--side=yes|no] [--dry-run]\n' +
        '  Default side is NO (the typical Ballast hedge direction).',
    );
    process.exit(2);
  }
  const depositUsdc = Number(usdcRaw);
  if (!Number.isFinite(depositUsdc) || depositUsdc <= 0) {
    console.error(`Invalid USDC amount: ${usdcRaw}`);
    process.exit(2);
  }
  return { marketId: marketIdRaw, depositUsdc, isYes, dryRun };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const wallet = getVaultWallet();
  const { prediction } = getJupiterClients();

  // Pretty-print the target market for confirmation before sending.
  const market = await prediction.getMarket(args.marketId);
  const yesAsk = market.pricing.buyYesPriceUsd / 1_000_000;
  const noAsk = market.pricing.buyNoPriceUsd / 1_000_000;
  const sideLabel = args.isYes ? 'YES' : 'NO';
  const sideAsk = args.isYes ? yesAsk : noAsk;

  console.log('Vault     :', wallet.pubkeyBase58);
  console.log('Market    :', `${market.title} (${args.marketId})`);
  console.log('Side      :', sideLabel);
  console.log('Ask       :', `$${sideAsk.toFixed(4)}`);
  console.log('Deposit   :', `$${args.depositUsdc.toFixed(2)} USDC`);
  console.log('Implied   :', `~${(args.depositUsdc / sideAsk).toFixed(2)} contracts`);
  console.log('Mode      :', args.dryRun ? 'DRY RUN (simulate only)' : 'LIVE (will sign and send)');
  console.log('');

  const result = await openHedgeOrder(args, { simulateOnly: args.dryRun });
  console.log('Order placed:');
  console.log(`  signature      : ${result.signature}`);
  console.log(`  orderPubkey    : ${result.orderPubkey}`);
  console.log(`  positionPubkey : ${result.positionPubkey}`);
  console.log(`  contracts      : ${result.contracts}`);
  if (!args.dryRun) {
    console.log(`  solscan        : https://solscan.io/tx/${result.signature}`);

    // Persist to the local hedges table so /vault/hedges and the rebalance
    // loop see this position alongside ones the cron itself opened. Idempotent
    // on positionPubkey — re-running this script is safe.
    try {
      getDb()
        .insert(hedgesTable)
        .values({
          positionPubkey: result.positionPubkey,
          marketId: result.marketId,
          marketTitle: market.title,
          eventTitle: market.title,
          side: args.isYes ? 'YES' : 'NO',
          contracts: Number(result.contracts),
          costBasisUsd: result.depositUsdc,
          openSignature: result.signature,
        })
        .onConflictDoNothing()
        .run();
      console.log('  persisted to hedges table');
    } catch (err) {
      console.error(
        '  WARN: failed to persist hedge row (non-fatal):',
        err instanceof Error ? err.message : err,
      );
    }
  }
  console.log('');

  if (!args.dryRun) {
    console.log('Polling order status (up to 60s)...');
    const status = await waitForOrderFill(result.orderPubkey, {
      timeoutMs: 60_000,
      intervalMs: 3_000,
    });
    console.log('Final status:');
    console.log(`  status            : ${status.status}`);
    if (status.contractsFilled) console.log(`  contractsFilled  : ${status.contractsFilled}`);
    if (status.positionPubkey) console.log(`  positionPubkey   : ${status.positionPubkey}`);
  }
}

main().catch((err: unknown) => {
  if (err && typeof err === 'object' && 'bodyText' in err) {
    const e = err as { message: string; bodyText?: string };
    console.error('\nError:', e.message);
    if (e.bodyText) console.error('Body:', e.bodyText);
  } else if (err instanceof Error) {
    console.error('\nError:', err.message);
  } else {
    console.error('\nError:', err);
  }
  process.exit(1);
});
