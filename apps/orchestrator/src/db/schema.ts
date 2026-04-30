import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Ballast persistent state — local SQLite, owned by the orchestrator process.
 *
 * v1 keeps the model intentionally simple:
 *   - Depositors and deposits are append-only — every confirmed on-chain deposit is one row.
 *   - Withdrawals are queued requests and resolve when the orchestrator settles them on chain.
 *   - Hedges are mirrored from Jupiter Prediction so we have a local "what does the vault hold"
 *     index that survives orchestrator restarts.
 *   - Observations are the same shape as the in-memory ApiObservation buffer; we persist them
 *     here so the public DX log can survive process restarts.
 *
 * All timestamps are stored as raw millisecond integers (Unix epoch) to keep the
 * driver-side mapping trivial. Conversion to Date happens at the API boundary if needed.
 *
 * Pro-rata accounting in v1 is cumulative-deposit based: depositorShare(wallet) =
 * sum(my deposits) / sum(all deposits). This is fair-enough for the hackathon demo and is
 * documented in the DX log as a known v1 limitation; v2 would issue share tokens at deposit
 * time and burn them at withdrawal so payouts compose correctly across late and early depositors.
 */

export const depositors = sqliteTable('depositors', {
  wallet: text('wallet').primaryKey(),
  joinedAt: integer('joined_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const deposits = sqliteTable('deposits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  depositorWallet: text('depositor_wallet')
    .notNull()
    .references(() => depositors.wallet),
  amountUsdc: real('amount_usdc').notNull(),
  txSignature: text('tx_signature').notNull().unique(),
  confirmedAt: integer('confirmed_at').notNull(),
  blockTime: integer('block_time'),
  slot: integer('slot'),
});

export const withdrawals = sqliteTable('withdrawals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  depositorWallet: text('depositor_wallet')
    .notNull()
    .references(() => depositors.wallet),
  amountUsdc: real('amount_usdc').notNull(),
  status: text('status', { enum: ['pending', 'processing', 'sent', 'failed'] })
    .notNull()
    .default('pending'),
  requestedAt: integer('requested_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  settledAt: integer('settled_at'),
  txSignature: text('tx_signature'),
  errorMessage: text('error_message'),
});

export const hedges = sqliteTable('hedges', {
  positionPubkey: text('position_pubkey').primaryKey(),
  marketId: text('market_id').notNull(),
  eventId: text('event_id'),
  marketTitle: text('market_title'),
  eventTitle: text('event_title'),
  side: text('side', { enum: ['YES', 'NO'] }).notNull(),
  contracts: integer('contracts').notNull(),
  costBasisUsd: real('cost_basis_usd').notNull(),
  feesPaidUsd: real('fees_paid_usd'),
  openedAt: integer('opened_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  closedAt: integer('closed_at'),
  resolvedOutcome: text('resolved_outcome', { enum: ['won', 'lost'] }),
  payoutUsd: real('payout_usd'),
  openSignature: text('open_signature'),
});

export const observations = sqliteTable('observations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  method: text('method').notNull(),
  path: text('path').notNull(),
  startedAt: integer('started_at').notNull(),
  durationMs: integer('duration_ms').notNull(),
  status: integer('status').notNull(),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  errorMessage: text('error_message'),
});

/**
 * Pro-rata payout allocations recorded when a hedge resolves and the vault claims.
 * One row per (depositor, claim) pair; sum across all rows for a depositor is their
 * total accrued payout entitlement.
 */
export const claimDistributions = sqliteTable('claim_distributions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  positionPubkey: text('position_pubkey').notNull(),
  depositorWallet: text('depositor_wallet')
    .notNull()
    .references(() => depositors.wallet),
  /** Depositor's pro-rata share fraction at distribution time, in [0, 1]. */
  shareFraction: real('share_fraction').notNull(),
  /** Dollar amount allocated to this depositor (= totalPayout × shareFraction). */
  amountUsd: real('amount_usd').notNull(),
  claimSignature: text('claim_signature').notNull(),
  distributedAt: integer('distributed_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * Server-issued nonces for sign-message authentication. Used by the deposit-confirm
 * endpoint to prove the caller controls the depositorPubkey they're claiming.
 *
 * Lifecycle: server issues → stored with createdAt → client signs `(nonce, signature, amount)`
 * → server verifies signature against the depositorPubkey and consumes the nonce.
 * Consumed nonces are kept for audit but cannot be re-used.
 */
export const nonces = sqliteTable('nonces', {
  nonce: text('nonce').primaryKey(),
  /** The wallet this nonce is bound to (server commits this at issue time). */
  wallet: text('wallet').notNull(),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  consumedAt: integer('consumed_at'),
  /** What the nonce was used for, e.g. 'deposit-confirm', 'withdrawal'. */
  purpose: text('purpose').notNull(),
});

/**
 * Yield withdrawals from Lend Earn that fund the rebalance loop's hedge bucket.
 * Audit trail for the "yield finances hedges" composition — one row per yield-extraction
 * during a rebalance tick.
 */
export const yieldWithdrawals = sqliteTable('yield_withdrawals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  amountUsdc: real('amount_usdc').notNull(),
  txSignature: text('tx_signature').notNull(),
  rebalanceStartedAt: integer('rebalance_started_at').notNull(),
  performedAt: integer('performed_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Depositor = typeof depositors.$inferSelect;
export type Deposit = typeof deposits.$inferSelect;
export type Withdrawal = typeof withdrawals.$inferSelect;
export type Hedge = typeof hedges.$inferSelect;
export type Observation = typeof observations.$inferSelect;
export type ClaimDistribution = typeof claimDistributions.$inferSelect;
export type Nonce = typeof nonces.$inferSelect;
export type YieldWithdrawal = typeof yieldWithdrawals.$inferSelect;
