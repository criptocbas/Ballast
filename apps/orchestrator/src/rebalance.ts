import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from './db/index.js';
import { hedges as hedgesTable, yieldWithdrawals } from './db/schema.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import {
  readUsdcEarnPosition,
  depositUsdcToLendEarn,
  withdrawUsdcFromLendEarn,
  USDC_MINT,
} from './lend.js';
import { getJupiterClients } from './jupiter.js';
import { getSolanaConnection, getVaultWallet } from './wallet.js';
import { openHedgeOrder, listVaultPositions } from './prediction.js';
import { runClaimSweep } from './claimer.js';
import { getTotalContributed } from './accountant.js';
import { processPendingWithdrawals } from './withdrawals.js';
import { runDepositWatcher } from './depositWatcher.js';

/**
 * Ballast rebalance loop.
 *
 * Cadence: cron-driven (REBALANCE_CRON, default daily 00:00 UTC) plus a manual
 * HTTP trigger for demos. A tick is idempotent: if another tick ran in the last
 * REBALANCE_MIN_INTERVAL_MS, the new run is short-circuited.
 *
 * Tick recipe:
 *   1. Pull live state — Lend Earn position, current open hedges, USDC wallet balance.
 *   2. Decide budgets:
 *        availableHedgeBudget = max(0, walletUsdc - SOL-rent-buffer)
 *      (We treat new wallet USDC as freshly-arrived deposits or accrued yield —
 *       both want to flow into hedges + Lend per the configured fraction.)
 *   3. Split per HEDGE_BUDGET_FRACTION: that share goes into hedges, the rest
 *      is compounded back into Lend Earn.
 *   4. For the hedge bucket: walk the curated basket, allocate per-market weights,
 *      skip any allocation < $5 (Jupiter Prediction's documented minimum), skip
 *      any market we already hold, place each remaining order via openHedgeOrder.
 *   5. Persist the resulting hedge rows in SQLite for restart-safe history.
 *   6. Compound: deposit the remainder back into Lend Earn.
 *
 * Failure modes are deliberately tolerant — a single market that rejects shouldn't
 * abort the whole tick; we record the error in the event log and move to the next.
 */

const log = createLogger('rebalance');

const BasketEntrySchema = z.object({
  marketId: z.string().min(4),
  weight: z.number().min(0).max(1),
  thesis: z.string().optional(),
});

const BasketSchema = z.object({
  minOrderSizeUsd: z.number().positive().default(5),
  minOrderbookDepthUsd: z.number().positive().default(2),
  markets: z.array(BasketEntrySchema).min(1),
});

export type BasketEntry = z.infer<typeof BasketEntrySchema>;
export type Basket = z.infer<typeof BasketSchema>;

let cachedBasket: Basket | undefined;

export function loadBasket(): Basket {
  if (cachedBasket) return cachedBasket;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, '..', 'basket.config.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  cachedBasket = BasketSchema.parse(raw);
  return cachedBasket;
}

// Last-tick gate. We persist this to SQLite via a sentinel hedge row? No —
// simpler: keep in-memory + reload from the most recent hedge.openedAt as
// a soft floor. For v1 the in-memory gate is fine; if the orchestrator restarts
// inside the cooldown the next tick proceeds, which is acceptable.
let lastTickStartedAt = 0;

const DEFAULT_MIN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour cooldown by default

export interface RebalanceResult {
  startedAt: number;
  finishedAt: number;
  skipped: boolean;
  reason?: string;
  // Snapshot before
  before: {
    walletUsdc: number;
    lendUsdc: number;
    lendPrincipalUsdc: number;
    accruedYieldUsdc: number;
    hedgesCount: number;
  };
  yieldWithdrawal: {
    attempted: number;
    confirmedSignature: string | null;
    error: string | null;
  };
  budget: {
    totalAvailableUsdc: number;
    hedgeBudgetUsdc: number;
    compoundBudgetUsdc: number;
  };
  hedgesPlaced: Array<{
    marketId: string;
    side: 'YES' | 'NO';
    contracts: string;
    depositUsdc: number;
    signature: string;
    positionPubkey: string;
  }>;
  hedgesSkipped: Array<{
    marketId: string;
    reason: string;
  }>;
  compounded: {
    attempted: number;
    confirmedSignature: string | null;
    error: string | null;
  };
}

interface RebalanceOptions {
  /** When true, runs the loop logic but doesn't sign or submit any tx. */
  dryRun?: boolean;
  /** Override the per-tick cooldown (ms). 0 disables. */
  minIntervalMs?: number;
  /** Don't compound back into Lend (e.g. when caller wants raw budget allocation only). */
  skipCompound?: boolean;
}

/**
 * Execute one rebalance tick. Safe to call from cron, HTTP, or scripts.
 */
export async function runRebalanceTick(options: RebalanceOptions = {}): Promise<RebalanceResult> {
  const startedAt = Date.now();
  const minInterval = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;

  if (minInterval > 0 && startedAt - lastTickStartedAt < minInterval) {
    return shortCircuit({
      startedAt,
      reason: `Cooldown: last tick ran ${Math.floor((startedAt - lastTickStartedAt) / 1000)}s ago`,
    });
  }
  lastTickStartedAt = startedAt;

  const cfg = loadConfig();
  const basket = loadBasket();

  // 0a) Auto-recover any inbound USDC transfers the orchestrator missed during
  //     downtime. User SPL transfers that landed on chain but couldn't reach
  //     /api/deposits/confirm get reconciled here. Idempotent on the txSignature
  //     unique constraint, off-curve authority filter so PDA-sourced transfers
  //     (Lend yield, Prediction claims) don't get misclassified as user deposits.
  if (!options.dryRun) {
    try {
      const recovered = await runDepositWatcher();
      if (recovered.recovered.length > 0) {
        log.info(
          {
            count: recovered.recovered.length,
            totalUsdc: recovered.recovered.reduce((s, r) => s + r.amountUsdc, 0),
          },
          'Pre-rebalance deposit recovery',
        );
      }
    } catch (err) {
      log.warn({ err }, 'Pre-rebalance deposit watcher failed (non-fatal)');
    }
  }

  // 0b) Sweep any claimable resolved positions BEFORE we look at the wallet —
  //     payouts arrive as USDC and become part of the available budget.
  if (!options.dryRun) {
    try {
      const sweep = await runClaimSweep();
      if (sweep.claimed.length > 0) {
        log.info(
          {
            claimed: sweep.claimed.length,
            totalPayout: sweep.totalPayoutUsd,
            distributed: sweep.totalDistributedToDepositors,
          },
          'Pre-rebalance claim sweep',
        );
      }
    } catch (err) {
      log.warn({ err }, 'Pre-rebalance claim sweep failed (non-fatal)');
    }

    // 0.5) Settle any pending depositor withdrawals before we plan new hedges.
    try {
      const result = await processPendingWithdrawals();
      if (result.attempted > 0) {
        log.info(result, 'Pre-rebalance withdrawal settlement');
      }
    } catch (err) {
      log.warn({ err }, 'Pre-rebalance withdrawal settlement failed (non-fatal)');
    }
  }

  // 1) Snapshot live state
  const wallet = getVaultWallet();
  const conn = getSolanaConnection();

  const [lendPosition, currentPositionsRes, walletUsdcInitial] = await Promise.all([
    readUsdcEarnPosition().catch(() => null),
    listVaultPositions().catch(() => ({ data: [] })),
    fetchVaultUsdcBalance().catch(() => 0),
  ]);
  const currentPositions = currentPositionsRes.data;

  const heldMarkets = new Set(currentPositions.map((p) => p.marketId));

  // Compute principal vs accrued yield in the Lend position.
  // Principal is what depositors collectively contributed (sum of deposit rows
  // that haven't been withdrawn). The lend position's underlying value above
  // principal is yield we have the right to withdraw and route to hedges.
  const lendUsdc = lendPosition?.underlyingUsdc ?? 0;
  const principalContributed = getTotalContributed();
  // Cap principal at the actual lend position — depositors might have contributed
  // more than is currently in Lend if some sits as wallet USDC pre-rebalance.
  const lendPrincipalUsdc = Math.min(principalContributed, lendUsdc);
  const accruedYieldUsdc = Math.max(0, lendUsdc - lendPrincipalUsdc);

  log.info(
    {
      vault: wallet.pubkeyBase58,
      walletUsdc: walletUsdcInitial,
      lendUsdc,
      lendPrincipalUsdc,
      accruedYieldUsdc,
      heldMarketCount: heldMarkets.size,
    },
    'Rebalance tick — snapshot',
  );

  // 2) Yield-to-hedge composition (the flagship Ballast claim):
  //    Withdraw accrued yield from Lend Earn. After this, the hedge budget reflects
  //    actual yield (or actual deposits the depositor table already accounts for),
  //    not "all wallet USDC happens to be there for some reason."
  let yieldWithdrawalResult: RebalanceResult['yieldWithdrawal'] = {
    attempted: 0,
    confirmedSignature: null,
    error: null,
  };
  let walletUsdc = walletUsdcInitial;
  // Only attempt yield withdrawal if there's enough yield to be worth a tx
  // (Solana fees + Lend rounding combined are ~$0.001, but avoid the
  //  call entirely below 1 cent of yield).
  const minYieldWithdrawUsdc = 0.01;
  if (!options.dryRun && accruedYieldUsdc >= minYieldWithdrawUsdc) {
    yieldWithdrawalResult = {
      attempted: round6(accruedYieldUsdc),
      confirmedSignature: null,
      error: null,
    };
    try {
      const result = await withdrawUsdcFromLendEarn(round6(accruedYieldUsdc));
      yieldWithdrawalResult.confirmedSignature = result.signature;
      // Persist for audit
      try {
        getDb()
          .insert(yieldWithdrawals)
          .values({
            amountUsdc: yieldWithdrawalResult.attempted,
            txSignature: result.signature,
            rebalanceStartedAt: startedAt,
          })
          .run();
      } catch (err) {
        log.warn({ err }, 'Failed to persist yield withdrawal row (non-fatal)');
      }
      // Refresh wallet balance to pick up the freshly-withdrawn yield.
      walletUsdc = await fetchVaultUsdcBalance().catch(() => walletUsdcInitial);
      log.info(
        {
          yieldUsdc: yieldWithdrawalResult.attempted,
          newWalletUsdc: walletUsdc,
        },
        'Yield withdrawn from Lend Earn',
      );
    } catch (err) {
      yieldWithdrawalResult.error = err instanceof Error ? err.message : String(err);
      log.warn({ err: yieldWithdrawalResult.error }, 'Yield withdrawal failed (continuing)');
    }
  }

  // 3) Compute budgets. With yield now in the wallet, split per HEDGE_BUDGET_FRACTION:
  //    that share goes to hedges, the rest is compounded back to Lend.
  //    Tiny dust reserve so Lend rounding doesn't leave the wallet at literally zero.
  const dustReserveUsdc = 0.01;
  const totalAvailableUsdc = Math.max(0, walletUsdc - dustReserveUsdc);
  const hedgeBudgetUsdc = totalAvailableUsdc * cfg.HEDGE_BUDGET_FRACTION;
  const compoundBudgetUsdc = totalAvailableUsdc - hedgeBudgetUsdc;

  // 3) Hedge allocation across the basket
  const hedgesPlaced: RebalanceResult['hedgesPlaced'] = [];
  const hedgesSkipped: RebalanceResult['hedgesSkipped'] = [];
  for (const entry of basket.markets) {
    const allocation = hedgeBudgetUsdc * entry.weight;
    if (allocation < basket.minOrderSizeUsd) {
      hedgesSkipped.push({
        marketId: entry.marketId,
        reason: `Allocation $${allocation.toFixed(2)} below min order size $${basket.minOrderSizeUsd}`,
      });
      continue;
    }
    if (heldMarkets.has(entry.marketId)) {
      hedgesSkipped.push({
        marketId: entry.marketId,
        reason: 'Already holding a position on this market — skipping for v1',
      });
      continue;
    }
    if (options.dryRun) {
      hedgesSkipped.push({
        marketId: entry.marketId,
        reason: `Dry run — would deposit $${allocation.toFixed(2)} of NO contracts`,
      });
      continue;
    }
    try {
      const result = await openHedgeOrder({
        marketId: entry.marketId,
        isYes: false,
        depositUsdc: round2(allocation),
      });
      hedgesPlaced.push({
        marketId: entry.marketId,
        side: 'NO',
        contracts: result.contracts,
        depositUsdc: result.depositUsdc,
        signature: result.signature,
        positionPubkey: result.positionPubkey,
      });
      // Persist hedge row
      try {
        getDb()
          .insert(hedgesTable)
          .values({
            positionPubkey: result.positionPubkey,
            marketId: entry.marketId,
            side: 'NO',
            contracts: Number(result.contracts),
            costBasisUsd: result.depositUsdc,
            openSignature: result.signature,
          })
          .onConflictDoNothing()
          .run();
      } catch (err) {
        log.warn({ err }, 'Failed to persist hedge row (non-fatal)');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      hedgesSkipped.push({ marketId: entry.marketId, reason: message.slice(0, 200) });
      log.warn({ marketId: entry.marketId, err: message }, 'Hedge placement failed');
    }
  }

  // 4) Compound — put the remaining budget back into Lend Earn
  let compounded: RebalanceResult['compounded'] = {
    attempted: 0,
    confirmedSignature: null,
    error: null,
  };
  if (!options.skipCompound && compoundBudgetUsdc >= 1 && !options.dryRun) {
    compounded = { attempted: round2(compoundBudgetUsdc), confirmedSignature: null, error: null };
    try {
      const result = await depositUsdcToLendEarn(round2(compoundBudgetUsdc));
      compounded.confirmedSignature = result.signature;
    } catch (err) {
      compounded.error = err instanceof Error ? err.message : String(err);
      log.warn({ err: compounded.error }, 'Compound deposit failed');
    }
  }

  const finishedAt = Date.now();

  log.info(
    {
      durationMs: finishedAt - startedAt,
      hedgesPlaced: hedgesPlaced.length,
      hedgesSkipped: hedgesSkipped.length,
      compounded: compounded.confirmedSignature ? 'success' : compounded.error ? 'failed' : 'skipped',
    },
    'Rebalance tick — done',
  );

  return {
    startedAt,
    finishedAt,
    skipped: false,
    before: {
      walletUsdc: walletUsdcInitial,
      lendUsdc,
      lendPrincipalUsdc,
      accruedYieldUsdc,
      hedgesCount: currentPositions.length,
    },
    yieldWithdrawal: yieldWithdrawalResult,
    budget: {
      totalAvailableUsdc: round2(totalAvailableUsdc),
      hedgeBudgetUsdc: round2(hedgeBudgetUsdc),
      compoundBudgetUsdc: round2(compoundBudgetUsdc),
    },
    hedgesPlaced,
    hedgesSkipped,
    compounded,
  };
}

void getSolanaConnection;

function shortCircuit(args: { startedAt: number; reason: string }): RebalanceResult {
  return {
    startedAt: args.startedAt,
    finishedAt: args.startedAt,
    skipped: true,
    reason: args.reason,
    before: {
      walletUsdc: 0,
      lendUsdc: 0,
      lendPrincipalUsdc: 0,
      accruedYieldUsdc: 0,
      hedgesCount: 0,
    },
    yieldWithdrawal: { attempted: 0, confirmedSignature: null, error: null },
    budget: { totalAvailableUsdc: 0, hedgeBudgetUsdc: 0, compoundBudgetUsdc: 0 },
    hedgesPlaced: [],
    hedgesSkipped: [],
    compounded: { attempted: 0, confirmedSignature: null, error: null },
  };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

async function fetchVaultUsdcBalance(): Promise<number> {
  const wallet = getVaultWallet();
  const conn = getSolanaConnection();
  const { getAssociatedTokenAddress, getAccount } = await import('@solana/spl-token');
  const ata = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
  try {
    const acct = await getAccount(conn, ata);
    return Number(acct.amount) / 1_000_000;
  } catch {
    return 0;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

let cronTask: ReturnType<typeof cron.schedule> | undefined;

/**
 * Schedule the rebalance loop using REBALANCE_CRON. Safe to call multiple times —
 * we keep a single task reference and replace if reconfigured.
 */
export function scheduleRebalanceCron(): void {
  const cfg = loadConfig();
  if (!cron.validate(cfg.REBALANCE_CRON)) {
    log.warn(
      { cron: cfg.REBALANCE_CRON },
      'REBALANCE_CRON failed cron.validate — rebalance loop NOT scheduled',
    );
    return;
  }
  cronTask?.stop();
  cronTask = cron.schedule(
    cfg.REBALANCE_CRON,
    () => {
      void runRebalanceTick().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err: message }, 'Rebalance tick threw');
      });
    },
    {
      // Type widening: node-cron v3 declares this differently across versions
      timezone: 'UTC',
    } as Parameters<typeof cron.schedule>[2],
  );
  log.info({ cron: cfg.REBALANCE_CRON, timezone: 'UTC' }, 'Rebalance cron scheduled');
}

export function stopRebalanceCron(): void {
  cronTask?.stop();
  cronTask = undefined;
}

/** Inspector: most recent persisted hedge rows, newest-first. */
export function listPersistedHedges(limit = 50): Array<typeof hedgesTable.$inferSelect> {
  const db = getDb();
  return db.select().from(hedgesTable).orderBy(desc(hedgesTable.openedAt)).limit(limit).all();
}
