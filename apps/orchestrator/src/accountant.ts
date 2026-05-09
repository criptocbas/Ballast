import { eq, ne, sql } from 'drizzle-orm';
import { claimDistributions, deposits, depositors, withdrawals } from './db/schema.js';
import { getDb } from './db/index.js';

/**
 * Pro-rata share accounting (v1: cumulative-deposit model).
 *
 * Trade-off captured in DX log: this model is unfair to early depositors when later
 * depositors join after the vault has grown. Proper share-token accounting (yvault-style:
 * mint shares = amount / pricePerShare at deposit time, burn at withdrawal) lands in v2.
 *
 * For the hackathon demo with one or two test depositors over a short window, the
 * cumulative model produces sensible, easy-to-explain numbers.
 */

export interface RecordDepositArgs {
  wallet: string;
  amountUsdc: number;
  txSignature: string;
  blockTime: number | null;
  slot: number | null;
}

export interface RecordDepositResult {
  inserted: boolean;
  /** True iff this is the wallet's first-ever deposit (the depositor row was created). */
  firstDeposit: boolean;
}

export function recordDeposit(args: RecordDepositArgs): RecordDepositResult {
  const db = getDb();

  // Insert depositor (first time only).
  const depositorBefore = db
    .select()
    .from(depositors)
    .where(eq(depositors.wallet, args.wallet))
    .all();
  const firstDeposit = depositorBefore.length === 0;
  if (firstDeposit) {
    db.insert(depositors).values({ wallet: args.wallet }).run();
  }

  // Insert deposit. txSignature is unique — duplicate inserts silently no-op.
  try {
    db.insert(deposits)
      .values({
        depositorWallet: args.wallet,
        amountUsdc: args.amountUsdc,
        txSignature: args.txSignature,
        confirmedAt: Date.now(),
        blockTime: args.blockTime,
        slot: args.slot,
      })
      .run();
    return { inserted: true, firstDeposit };
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint/i.test(err.message)) {
      return { inserted: false, firstDeposit: false };
    }
    throw err;
  }
}

export function listDepositors(): Array<{ wallet: string; joinedAt: number; totalUsdc: number }> {
  const db = getDb();
  const rows = db
    .select({
      wallet: depositors.wallet,
      joinedAt: depositors.joinedAt,
      total: sql<number>`coalesce(sum(${deposits.amountUsdc}), 0)`,
    })
    .from(depositors)
    .leftJoin(deposits, eq(deposits.depositorWallet, depositors.wallet))
    .groupBy(depositors.wallet)
    .all();
  return rows.map((r) => ({
    wallet: r.wallet,
    joinedAt: Number(r.joinedAt),
    totalUsdc: Number(r.total ?? 0),
  }));
}

export function getDepositorTotal(wallet: string): number {
  const db = getDb();
  const row = db
    .select({ total: sql<number>`coalesce(sum(${deposits.amountUsdc}), 0)` })
    .from(deposits)
    .where(eq(deposits.depositorWallet, wallet))
    .get();
  return Number(row?.total ?? 0);
}

export function getTotalContributed(): number {
  const db = getDb();
  const row = db
    .select({ total: sql<number>`coalesce(sum(${deposits.amountUsdc}), 0)` })
    .from(deposits)
    .get();
  return Number(row?.total ?? 0);
}

/**
 * Returns the wallet's pro-rata share of the vault as a fraction in [0, 1].
 * Returns 0 when the vault is empty (no deposits yet).
 */
export function getDepositorShareFraction(wallet: string): number {
  const total = getTotalContributed();
  if (total === 0) return 0;
  return getDepositorTotal(wallet) / total;
}

/**
 * Apply share fraction to a vault dollar amount. Helper for "what would this depositor
 * receive if we paid out `amountUsdc` right now?"
 */
export function pro_rata(amountUsdc: number, wallet: string): number {
  const fraction = getDepositorShareFraction(wallet);
  return amountUsdc * fraction;
}

export interface WithdrawalRequest {
  wallet: string;
  amountUsdc: number;
}

export function queueWithdrawal(args: WithdrawalRequest): { id: number } {
  const db = getDb();
  const row = db
    .insert(withdrawals)
    .values({
      depositorWallet: args.wallet,
      amountUsdc: args.amountUsdc,
    })
    .returning({ id: withdrawals.id })
    .get();
  return { id: row.id };
}

export interface DistributionAllocation {
  depositorWallet: string;
  shareFraction: number;
  amountUsd: number;
}

/**
 * Distribute a claim payout pro-rata across depositors based on share fraction.
 * Returns the per-depositor allocations and persists them in claim_distributions.
 *
 * NOTE: this records *entitlement*. Actual on-chain disbursement happens via the
 * withdrawal flow — depositors withdraw their accumulated entitlement on demand.
 */
export function distributeClaimPayout(args: {
  positionPubkey: string;
  claimSignature: string;
  totalPayoutUsd: number;
}): DistributionAllocation[] {
  const db = getDb();
  if (args.totalPayoutUsd <= 0) return [];

  const totalContributed = getTotalContributed();
  if (totalContributed <= 0) return [];

  const rows = db
    .select({
      wallet: depositors.wallet,
      total: sql<number>`coalesce(sum(${deposits.amountUsdc}), 0)`,
    })
    .from(depositors)
    .leftJoin(deposits, eq(deposits.depositorWallet, depositors.wallet))
    .groupBy(depositors.wallet)
    .all();

  const allocations: DistributionAllocation[] = [];
  const inserts = rows
    .filter((r) => Number(r.total ?? 0) > 0)
    .map((r) => {
      const fraction = Number(r.total) / totalContributed;
      const amount = args.totalPayoutUsd * fraction;
      allocations.push({
        depositorWallet: r.wallet,
        shareFraction: fraction,
        amountUsd: amount,
      });
      return {
        positionPubkey: args.positionPubkey,
        depositorWallet: r.wallet,
        shareFraction: fraction,
        amountUsd: amount,
        claimSignature: args.claimSignature,
      };
    });

  if (inserts.length > 0) {
    db.insert(claimDistributions).values(inserts).run();
  }
  return allocations;
}

/**
 * Total payout entitlement a depositor has accumulated across all claim distributions.
 */
export function getDepositorClaimTotal(wallet: string): number {
  const db = getDb();
  const row = db
    .select({ total: sql<number>`coalesce(sum(${claimDistributions.amountUsd}), 0)` })
    .from(claimDistributions)
    .where(eq(claimDistributions.depositorWallet, wallet))
    .get();
  return Number(row?.total ?? 0);
}

/**
 * Net depositor balance: contributed principal − live withdrawals + payout entitlements.
 *
 * "Live" means status in (pending, processing, sent). Failed withdrawals do NOT
 * count — when a settlement attempt aborts at simulation, no funds leave the
 * vault, so the depositor's balance must NOT be reduced. We surfaced this exact
 * bug during the build (a failed simulation row was leaking $8 from the
 * depositor's notional balance) — see DX-GAP-#28 in DX-REPORT.md.
 */
export function getDepositorNetBalance(wallet: string): {
  contributed: number;
  withdrawn: number;
  payouts: number;
  net: number;
} {
  const db = getDb();
  const contributed = getDepositorTotal(wallet);
  const withdrawnRow = db
    .select({ total: sql<number>`coalesce(sum(${withdrawals.amountUsdc}), 0)` })
    .from(withdrawals)
    .where(
      sql`${withdrawals.depositorWallet} = ${wallet} AND ${withdrawals.status} != 'failed'`,
    )
    .get();
  const withdrawn = Number(withdrawnRow?.total ?? 0);
  const payouts = getDepositorClaimTotal(wallet);
  return {
    contributed,
    withdrawn,
    payouts,
    net: contributed - withdrawn + payouts,
  };
}

/**
 * Sum of every depositor's net notional balance — the total claim against the
 * vault. Used to compute share fractions for the *redeemable* model: each
 * depositor's right to liquid vault assets is `theirNet / totalNet`.
 */
export function getTotalNetBalance(): number {
  const db = getDb();
  const totalContributedRow = db
    .select({ total: sql<number>`coalesce(sum(${deposits.amountUsdc}), 0)` })
    .from(deposits)
    .get();
  const totalContributed = Number(totalContributedRow?.total ?? 0);

  const totalWithdrawnRow = db
    .select({ total: sql<number>`coalesce(sum(${withdrawals.amountUsdc}), 0)` })
    .from(withdrawals)
    .where(ne(withdrawals.status, 'failed'))
    .get();
  const totalWithdrawn = Number(totalWithdrawnRow?.total ?? 0);

  const totalPayoutsRow = db
    .select({ total: sql<number>`coalesce(sum(${claimDistributions.amountUsd}), 0)` })
    .from(claimDistributions)
    .get();
  const totalPayouts = Number(totalPayoutsRow?.total ?? 0);

  return totalContributed - totalWithdrawn + totalPayouts;
}

export interface DepositorWithdrawable {
  /** What the depositor's notional ledger says they're owed. */
  notionalNet: number;
  /** Their share of the total net claim, in [0, 1]. */
  shareFraction: number;
  /** Vault USDC immediately payable: wallet free + Lend Earn underlying. */
  redeemableVaultUsdc: number;
  /** shareFraction × redeemableVaultUsdc — their slice of liquid vault assets. */
  shareOfRedeemable: number;
  /** What they can actually withdraw right now: `min(notional, share-of-redeemable)`. */
  withdrawableNow: number;
  /** Notional minus withdrawableNow — capital locked in non-instant-redeemable positions. */
  hedgeLockedUsdc: number;
}

/**
 * Compute a depositor's *honestly* withdrawable balance. The notional ledger
 * (contributed − withdrawn + payouts) describes what they're owed; this
 * function clamps that to what the vault can actually pay out *now*, given
 * its current redeemable USDC. The difference is "hedge-locked" capital —
 * USDC that left the vault for Prediction positions and won't return until
 * those positions resolve (or are closed at fee + slippage cost).
 *
 * This is the production fix for DX-GAP-#28 — see DX-REPORT.md for the field
 * report on shipping a vault on Lend Earn and discovering, in production,
 * that cumulative-deposit accounting promises depositors balances the vault
 * cannot honor the moment any capital flows into hedges.
 */
export function getDepositorWithdrawable(args: {
  wallet: string;
  redeemableVaultUsdc: number;
}): DepositorWithdrawable {
  const notionalNet = Math.max(0, getDepositorNetBalance(args.wallet).net);
  const totalNet = Math.max(0, getTotalNetBalance());
  const redeemable = Math.max(0, args.redeemableVaultUsdc);
  const shareFraction = totalNet > 0 ? notionalNet / totalNet : 0;
  const shareOfRedeemable = shareFraction * redeemable;
  const withdrawableNow = Math.min(notionalNet, shareOfRedeemable);
  const hedgeLockedUsdc = Math.max(0, notionalNet - withdrawableNow);
  return {
    notionalNet,
    shareFraction,
    redeemableVaultUsdc: redeemable,
    shareOfRedeemable,
    withdrawableNow,
    hedgeLockedUsdc,
  };
}
