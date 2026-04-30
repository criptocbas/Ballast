import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { getJupiterClients } from './jupiter.js';
import { readRecentObservations } from './eventLog.js';
import { bpsToPercentString, microToUsd } from '@reflux/shared';
import { getVaultSolBalance, getVaultWallet } from './wallet.js';
import { readUsdcEarnPosition } from './lend.js';
import { listVaultPositions } from './prediction.js';
import { DepositVerifyError, verifyDeposit } from './deposits.js';
import { getDepositorTotal, listDepositors, recordDeposit } from './accountant.js';
import { getDb } from './db/index.js';
import {
  listPersistedHedges,
  runRebalanceTick,
  scheduleRebalanceCron,
} from './rebalance.js';
import { claimPosition, runClaimSweep } from './claimer.js';

/**
 * Reflux Orchestrator — entrypoint.
 *
 * Surfaces:
 *  - HTTP API consumed by apps/web
 *  - DX log endpoint exposing live API observations (the public transparency surface)
 *  - Periodic rebalance loop (cron, configured via REBALANCE_CRON)
 */

const cfg = loadConfig();
const log = createLogger('orchestrator');

const server = Fastify({ loggerInstance: log });

server.get('/health', async () => ({ status: 'ok', cluster: cfg.SOLANA_CLUSTER }));

server.get('/vault/info', async () => {
  const wallet = getVaultWallet();
  const [sol, lendPosition, hedgePositionsResponse] = await Promise.all([
    getVaultSolBalance(),
    readUsdcEarnPosition().catch(() => null),
    listVaultPositions().catch((): null => null),
  ]);
  const hedges =
    hedgePositionsResponse?.data.map((p) => ({
      positionPubkey: p.pubkey,
      marketId: p.marketId,
      eventTitle: p.eventMetadata?.title ?? 'Unknown event',
      marketTitle: p.marketMetadata?.title ?? p.marketId,
      side: p.isYes ? ('YES' as const) : ('NO' as const),
      contracts: Number(p.contracts),
      costBasisUsd: Number(p.totalCostUsd) / 1_000_000,
      valueUsd: Number(p.valueUsd) / 1_000_000,
      pnlUsd: Number(p.pnlUsd) / 1_000_000,
      pnlPct: p.pnlUsdPercent,
      avgPriceUsd: Number(p.avgPriceUsd) / 1_000_000,
      markPriceUsd: Number(p.markPriceUsd) / 1_000_000,
      claimable: p.claimed,
      closeTime: p.marketMetadata?.closeTime ?? null,
    })) ?? [];

  return {
    address: wallet.pubkeyBase58,
    cluster: cfg.SOLANA_CLUSTER,
    solBalance: sol.sol,
    solBalanceLamports: sol.lamports,
    solscanUrl: `https://solscan.io/account/${wallet.pubkeyBase58}`,
    lendPosition: lendPosition
      ? {
          jlTokenSymbol: 'jlUSDC',
          underlyingSymbol: 'USDC',
          underlyingUsdc: lendPosition.underlyingUsdc,
          jlTokenBalanceBaseUnits: lendPosition.jlTokenBalanceBaseUnits,
          totalApyBps: lendPosition.totalApyBps,
        }
      : null,
    hedges,
  };
});

server.post('/api/deposits/confirm', async (req, reply) => {
  const body = req.body as
    | { signature?: unknown; depositorPubkey?: unknown; amount?: unknown }
    | undefined;
  if (!body) return reply.code(400).send({ error: 'missing_body' });
  const { signature, depositorPubkey, amount } = body;
  if (typeof signature !== 'string' || signature.length < 32) {
    return reply.code(400).send({ error: 'invalid_signature' });
  }
  if (typeof depositorPubkey !== 'string' || depositorPubkey.length < 32) {
    return reply.code(400).send({ error: 'invalid_depositor' });
  }
  const amountNum = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return reply.code(400).send({ error: 'invalid_amount' });
  }
  try {
    const result = await verifyDeposit({ signature, depositorPubkey, amount: amountNum });
    const recorded = recordDeposit({
      wallet: depositorPubkey,
      amountUsdc: amountNum,
      txSignature: signature,
      blockTime: result.blockTime,
      slot: result.slot,
    });
    log.info(
      {
        signature: result.signature,
        depositorPubkey,
        amount: amountNum,
        firstDeposit: recorded.firstDeposit,
        inserted: recorded.inserted,
      },
      'Deposit verified and recorded',
    );
    return { ...result, recorded };
  } catch (err) {
    if (err instanceof DepositVerifyError) {
      return reply.code(400).send({ error: err.code, message: err.message });
    }
    log.error({ err }, 'Deposit confirm failed');
    return reply.code(500).send({
      error: 'internal_error',
      message: err instanceof Error ? err.message : 'unknown',
    });
  }
});

server.post<{ Body: { dryRun?: boolean; minIntervalMs?: number; skipCompound?: boolean } | undefined }>(
  '/rebalance/trigger',
  async (req) => {
    const body = (req.body ?? {}) as {
      dryRun?: boolean;
      minIntervalMs?: number;
      skipCompound?: boolean;
    };
    const opts: Parameters<typeof runRebalanceTick>[0] = {};
    if (typeof body.dryRun === 'boolean') opts.dryRun = body.dryRun;
    if (typeof body.minIntervalMs === 'number') opts.minIntervalMs = body.minIntervalMs;
    if (typeof body.skipCompound === 'boolean') opts.skipCompound = body.skipCompound;
    return runRebalanceTick(opts);
  },
);

server.get('/rebalance/preview', async () => {
  // Dry-run with cooldown disabled so callers can preview without affecting state.
  return runRebalanceTick({ dryRun: true, minIntervalMs: 0 });
});

server.post('/claim/sweep', async () => {
  return runClaimSweep();
});

server.post<{ Params: { positionPubkey: string } }>(
  '/claim/:positionPubkey',
  async (req, reply) => {
    try {
      return await claimPosition(req.params.positionPubkey);
    } catch (err) {
      return reply.code(400).send({
        error: 'claim_failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
  },
);

server.get('/vault/hedges', async () => {
  const rows = listPersistedHedges(100);
  return {
    hedges: rows.map((r) => ({
      positionPubkey: r.positionPubkey,
      marketId: r.marketId,
      side: r.side,
      contracts: r.contracts,
      costBasisUsd: r.costBasisUsd,
      openedAt: r.openedAt,
      closedAt: r.closedAt,
      resolvedOutcome: r.resolvedOutcome,
      payoutUsd: r.payoutUsd,
      openSignature: r.openSignature,
    })),
  };
});

server.get('/api/depositors', async () => {
  const rows = listDepositors();
  return {
    depositors: rows.map((r) => ({
      wallet: r.wallet,
      totalUsdc: r.totalUsdc,
      joinedAt: r.joinedAt,
    })),
    totalDepositors: rows.length,
    totalContributedUsdc: rows.reduce((sum, r) => sum + r.totalUsdc, 0),
  };
});

server.get<{ Params: { wallet: string } }>('/api/depositors/:wallet', async (req) => {
  const total = getDepositorTotal(req.params.wallet);
  return { wallet: req.params.wallet, totalUsdc: total };
});

server.setNotFoundHandler((_req, reply) => {
  void reply.code(404).send({ error: 'not_found' });
});

server.setErrorHandler((err, _req, reply) => {
  const message = err instanceof Error ? err.message : 'unknown error';
  log.error({ err }, 'Unhandled request error');
  void reply.code(500).send({ error: 'internal_error', message });
});

server.get('/dx/observations', async (req) => {
  const limit = Math.min(Number((req.query as { limit?: string }).limit) || 100, 500);
  return { observations: readRecentObservations(limit) };
});

server.get('/lend/tokens', async () => {
  const { lend } = getJupiterClients();
  const tokens = await lend.listTokens();
  return {
    tokens: tokens.map((t) => ({
      symbol: t.uiSymbol,
      assetAddress: t.assetAddress,
      assetSymbol: t.asset.symbol,
      totalRateApy: bpsToPercentString(Number(t.totalRate)),
      totalAssetsUsd: microToUsd(t.totalAssets) * Number(t.asset.price),
      withdrawableUsd: microToUsd(t.liquiditySupplyData.withdrawable) * Number(t.asset.price),
    })),
  };
});

server.get('/prediction/events', async (req) => {
  const { prediction } = getJupiterClients();
  const q = req.query as { category?: string; limit?: string };
  const opts: Parameters<typeof prediction.listEvents>[0] = { limit: Number(q.limit) || 20 };
  if (q.category) opts.category = q.category;
  const events = await prediction.listEvents(opts);
  return events;
});

async function main(): Promise<void> {
  // Open the database eagerly so migrations apply before the first request.
  getDb();
  scheduleRebalanceCron();
  await server.listen({ port: cfg.ORCHESTRATOR_PORT, host: '0.0.0.0' });
  log.info({ port: cfg.ORCHESTRATOR_PORT }, 'Ballast orchestrator listening');
}

main().catch((err: unknown) => {
  log.fatal({ err }, 'Orchestrator failed to start');
  process.exit(1);
});
