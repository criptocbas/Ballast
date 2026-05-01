/**
 * Admin-only: re-run the on-chain deposit verification + record for an
 * existing transaction. Useful when the orchestrator was unreachable at the
 * moment of deposit (e.g. mid-restart) but the SPL transfer landed on chain.
 *
 *   pnpm --filter @reflux/orchestrator exec tsx \
 *     src/scripts/recordDeposit.ts <signature> <depositor> <amount>
 */
import { recordDeposit } from '../accountant.js';
import { verifyDeposit, DepositVerifyError } from '../deposits.js';

async function main(): Promise<void> {
  const [signature, depositorPubkey, amountArg] = process.argv.slice(2);
  if (!signature || !depositorPubkey || !amountArg) {
    console.error(
      'Usage: recordDeposit.ts <signature> <depositor> <amount>\n' +
        '  signature   tx signature of the SPL transfer to the vault USDC ATA\n' +
        '  depositor   base58 pubkey of the wallet that made the deposit\n' +
        '  amount      USDC amount in human dollars (e.g. 2 for $2)',
    );
    process.exit(2);
  }
  const amount = Number(amountArg);
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error(`Invalid amount: ${amountArg}`);
    process.exit(2);
  }

  console.log(`Verifying deposit on-chain...`);
  console.log(`  signature: ${signature}`);
  console.log(`  depositor: ${depositorPubkey}`);
  console.log(`  amount   : $${amount.toFixed(4)}`);

  try {
    const verified = await verifyDeposit({ signature, depositorPubkey, amount });
    console.log(`  ✓ verified at slot ${verified.slot}`);
    const recorded = recordDeposit({
      wallet: depositorPubkey,
      amountUsdc: amount,
      txSignature: signature,
      blockTime: verified.blockTime,
      slot: verified.slot,
    });
    if (recorded.inserted) {
      console.log(
        `  ✓ recorded in SQLite (firstDeposit=${recorded.firstDeposit ? 'yes' : 'no'})`,
      );
    } else {
      console.log(`  · already recorded (idempotent — txSignature already in deposits table)`);
    }
    process.exit(0);
  } catch (err) {
    if (err instanceof DepositVerifyError) {
      console.error(`\n✗ Verification failed: [${err.code}] ${err.message}`);
    } else {
      console.error(`\n✗ Unexpected error:`, err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('\nFatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
