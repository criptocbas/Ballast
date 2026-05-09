import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { and, eq } from 'drizzle-orm';
import { getDb } from './db/index.js';
import { withdrawals } from './db/schema.js';
import { getSolanaConnection, getVaultWallet } from './wallet.js';
import { USDC_MINT, withdrawUsdcFromLendEarn } from './lend.js';
import { getDepositorWithdrawable, queueWithdrawal } from './accountant.js';
import { fetchVaultRedeemableUsdc } from './balances.js';
import { createLogger } from './logger.js';
import { buildSimSignSendConfirmV0 } from './tx.js';

const log = createLogger('withdrawals');

const USDC_DECIMALS = 6;

export class WithdrawalError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'amount_invalid'
      | 'insufficient_balance'
      | 'wallet_invalid',
  ) {
    super(message);
    this.name = 'WithdrawalError';
  }
}

/**
 * Submit a withdrawal request. Validates the depositor has enough net balance,
 * queues the row as pending, and immediately tries to settle if the vault has
 * enough free USDC. Otherwise the row stays pending and the next rebalance tick
 * (or a /admin/withdrawals/process call) will settle it.
 */
export async function requestWithdrawal(args: {
  wallet: string;
  amountUsdc: number;
}): Promise<{
  id: number;
  status: 'sent' | 'pending';
  signature?: string;
  reason?: string;
}> {
  if (!Number.isFinite(args.amountUsdc) || args.amountUsdc <= 0) {
    throw new WithdrawalError(`Invalid amount: ${args.amountUsdc}`, 'amount_invalid');
  }
  // Pubkey shape check
  try {
    new PublicKey(args.wallet);
  } catch {
    throw new WithdrawalError(`Invalid Solana pubkey: ${args.wallet}`, 'wallet_invalid');
  }

  // Validate against *honest* withdrawable, not just notional net. Notional says
  // "you're owed $X"; withdrawable says "the vault can actually pay $Y right now"
  // where Y can be lower if some of the principal is locked in hedges. We enforce
  // the lower of the two so the request never reaches simulation if it would be
  // unfulfillable. See DX-GAP-#28 for the field report on why this matters.
  const redeemable = await fetchVaultRedeemableUsdc().catch(() => 0);
  const withdrawable = getDepositorWithdrawable({
    wallet: args.wallet,
    redeemableVaultUsdc: redeemable,
  });
  if (args.amountUsdc > withdrawable.withdrawableNow + 1e-6) {
    throw new WithdrawalError(
      `Withdraw amount $${args.amountUsdc.toFixed(4)} exceeds withdrawable now $${withdrawable.withdrawableNow.toFixed(4)} ` +
        `(notional $${withdrawable.notionalNet.toFixed(4)}, of which $${withdrawable.hedgeLockedUsdc.toFixed(4)} is locked in open hedges; ` +
        `vault redeemable $${withdrawable.redeemableVaultUsdc.toFixed(4)} × your share ${(withdrawable.shareFraction * 100).toFixed(2)}%)`,
      'insufficient_balance',
    );
  }

  const queued = queueWithdrawal({ wallet: args.wallet, amountUsdc: args.amountUsdc });

  const settled = await trySettleWithdrawal(queued.id).catch((err: unknown) => {
    log.warn({ err, withdrawalId: queued.id }, 'Inline settlement attempt failed');
    return { settled: false as const, reason: err instanceof Error ? err.message : String(err) };
  });

  if (settled.settled) {
    return { id: queued.id, status: 'sent', signature: settled.signature };
  }
  return { id: queued.id, status: 'pending', reason: settled.reason };
}

/**
 * Try to settle a single pending withdrawal. Pulls vault wallet USDC, falls
 * back to withdrawing from Lend Earn if there's not enough, then signs an SPL
 * transfer to the depositor wallet.
 */
export async function trySettleWithdrawal(
  withdrawalId: number,
): Promise<{ settled: true; signature: string } | { settled: false; reason: string }> {
  const db = getDb();
  const row = db
    .select()
    .from(withdrawals)
    .where(and(eq(withdrawals.id, withdrawalId), eq(withdrawals.status, 'pending')))
    .get();
  if (!row) return { settled: false, reason: 'Withdrawal not found or not pending' };

  // Atomic soft-lock — only the worker that wins the conditional UPDATE proceeds.
  // Required now that the rebalance cron and the dedicated withdrawal cron can
  // both call into trySettleWithdrawal concurrently.
  const lock = db
    .update(withdrawals)
    .set({ status: 'processing' })
    .where(and(eq(withdrawals.id, withdrawalId), eq(withdrawals.status, 'pending')))
    .run();
  if (lock.changes === 0) {
    return { settled: false, reason: 'Withdrawal already being processed by another worker' };
  }

  try {
    const wallet = getVaultWallet();
    const conn = getSolanaConnection();
    const recipient = new PublicKey(row.depositorWallet);

    const fromAta = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
    const toAta = await getAssociatedTokenAddress(USDC_MINT, recipient);

    // 1) Ensure the vault wallet has enough USDC; if not, withdraw the shortfall from Lend.
    let walletBalance = 0;
    try {
      const acct = await getAccount(conn, fromAta);
      walletBalance = Number(acct.amount) / 10 ** USDC_DECIMALS;
    } catch {
      walletBalance = 0;
    }
    const dustReserveUsdc = 0.005;
    const needed = row.amountUsdc + dustReserveUsdc - walletBalance;
    if (needed > 0) {
      log.info(
        { withdrawalId, walletBalance, needed, requested: row.amountUsdc },
        'Withdrawal needs Lend top-up before settlement',
      );
      await withdrawUsdcFromLendEarn(roundUp6(needed));
    }

    // 2) Build SPL transfer (V0 versioned tx for consistency with the rest of the orchestrator).
    const ixs: TransactionInstruction[] = [];
    try {
      await getAccount(conn, toAta);
    } catch {
      ixs.push(
        createAssociatedTokenAccountInstruction(wallet.publicKey, toAta, recipient, USDC_MINT),
      );
    }
    const amountBase = BigInt(Math.round(row.amountUsdc * 10 ** USDC_DECIMALS));
    ixs.push(
      createTransferCheckedInstruction(
        fromAta,
        USDC_MINT,
        toAta,
        wallet.publicKey,
        amountBase,
        USDC_DECIMALS,
      ),
    );

    // 3) Build, simulate, sign, send, confirm — with blockhash-expiry retry.
    const signature = await buildSimSignSendConfirmV0({
      conn,
      signer: wallet.keypair,
      payer: wallet.publicKey,
      ixs,
    });

    db.update(withdrawals)
      .set({ status: 'sent', settledAt: Date.now(), txSignature: signature })
      .where(eq(withdrawals.id, withdrawalId))
      .run();

    log.info({ withdrawalId, signature, amount: row.amountUsdc }, 'Withdrawal settled');
    return { settled: true, signature };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    db.update(withdrawals)
      .set({ status: 'failed', errorMessage: reason.slice(0, 500) })
      .where(eq(withdrawals.id, withdrawalId))
      .run();
    log.warn({ withdrawalId, err: reason }, 'Withdrawal settlement failed; row marked failed');
    return { settled: false, reason };
  }
}

/**
 * Settle every pending withdrawal. Tolerant of per-row failures.
 */
export async function processPendingWithdrawals(): Promise<{
  attempted: number;
  settled: number;
  failed: number;
}> {
  const db = getDb();
  const pending = db
    .select()
    .from(withdrawals)
    .where(eq(withdrawals.status, 'pending'))
    .all();

  let settled = 0;
  let failed = 0;
  for (const w of pending) {
    const result = await trySettleWithdrawal(w.id);
    if (result.settled) settled += 1;
    else failed += 1;
  }
  return { attempted: pending.length, settled, failed };
}

function roundUp6(n: number): number {
  return Math.ceil(n * 1_000_000) / 1_000_000;
}
