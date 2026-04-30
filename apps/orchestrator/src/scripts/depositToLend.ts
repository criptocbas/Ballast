/**
 * Deposit USDC from the vault into Jupiter Lend Earn.
 *
 *   pnpm --filter @reflux/orchestrator exec tsx src/scripts/depositToLend.ts <amount> [--dry-run]
 *
 * Examples:
 *   pnpm --filter @reflux/orchestrator exec tsx src/scripts/depositToLend.ts 1 --dry-run
 *   pnpm --filter @reflux/orchestrator exec tsx src/scripts/depositToLend.ts 1
 */
import { depositUsdcToLendEarn, readUsdcEarnPosition } from '../lend.js';
import { getVaultWallet } from '../wallet.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const amountArg = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const amount = Number(amountArg);

  if (!Number.isFinite(amount) || amount <= 0) {
    console.error('Usage: depositToLend.ts <amount> [--dry-run]');
    console.error('  amount: number of USDC to deposit (e.g. 1 for $1)');
    process.exit(2);
  }

  const wallet = getVaultWallet();
  console.log(`Vault    : ${wallet.pubkeyBase58}`);
  console.log(`Action   : deposit ${amount} USDC into Jupiter Lend Earn (jlUSDC)`);
  console.log(`Mode     : ${dryRun ? 'DRY RUN (simulate only)' : 'LIVE (will sign and send)'}`);
  console.log('');

  const before = await readUsdcEarnPosition();
  console.log('Position before:');
  if (before === null) {
    console.log('  (no existing jlUSDC position)');
  } else {
    console.log(`  jlUSDC base units : ${before.jlTokenBalanceBaseUnits}`);
    console.log(`  underlying USDC   : ${before.underlyingUsdc.toFixed(6)}`);
  }
  console.log('');

  const result = await depositUsdcToLendEarn(amount, { simulateOnly: dryRun });
  console.log('Deposit result:');
  console.log(`  signature : ${result.signature}`);
  console.log(`  amount    : ${result.amountUsdc} USDC`);
  if (!dryRun) {
    console.log(`  solscan   : https://solscan.io/tx/${result.signature}`);
  }
  console.log('');

  if (!dryRun) {
    // Re-read position to confirm the deposit landed.
    const after = await readUsdcEarnPosition();
    console.log('Position after:');
    if (after === null) {
      console.log('  (still no position — something went wrong)');
    } else {
      console.log(`  jlUSDC base units : ${after.jlTokenBalanceBaseUnits}`);
      console.log(`  underlying USDC   : ${after.underlyingUsdc.toFixed(6)}`);
    }
  }
}

main().catch((err: unknown) => {
  if (err instanceof Error) console.error('\nError:', err.message);
  else console.error('\nError:', err);
  process.exit(1);
});
