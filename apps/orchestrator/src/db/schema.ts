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

export type Depositor = typeof depositors.$inferSelect;
export type Deposit = typeof deposits.$inferSelect;
export type Withdrawal = typeof withdrawals.$inferSelect;
export type Hedge = typeof hedges.$inferSelect;
export type Observation = typeof observations.$inferSelect;
