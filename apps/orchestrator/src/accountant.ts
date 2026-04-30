import { eq, sql } from 'drizzle-orm';
import { deposits, depositors, withdrawals } from './db/schema.js';
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
