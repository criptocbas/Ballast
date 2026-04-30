import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { getJupiterClients } from './jupiter.js';
import { readRecentObservations } from './eventLog.js';
import { bpsToPercentString, microToUsd } from '@reflux/shared';
import { getVaultSolBalance, getVaultWallet } from './wallet.js';
import { readUsdcEarnPosition } from './lend.js';
import { listVaultPositions } from './prediction.js';
import { DepositVerifyError, verifyDeposit } from './deposits.js';
import {
  getDepositorClaimTotal,
  getDepositorNetBalance,
  getDepositorTotal,
  getTotalContributed,
  listDepositors,
  recordDeposit,
} from './accountant.js';
import { getDb } from './db/index.js';
import {
  listPersistedHedges,
  runRebalanceTick,
  scheduleRebalanceCron,
} from './rebalance.js';
import { claimPosition, runClaimSweep } from './claimer.js';
import { requireAdmin } from './auth.js';
import {
  buildCanonicalMessage,
  issueNonce,
  NonceVerifyError,
  verifySignedMessageAndConsume,
} from './nonces.js';
import {
  processPendingWithdrawals,
  requestWithdrawal,
  WithdrawalError,
} from './withdrawals.js';

/**
 * Ballast Orchestrator — entrypoint.
 *
 * Public endpoints:
 *  GET  /health
 *  GET  /vault/info — TVL, Lend position, hedges, vault address
 *  GET  /vault/aggregate — anonymous aggregates (depositor count, total contributed)
 *  GET  /vault/hedges — persisted hedge history
 *  GET  /lend/tokens, /prediction/events — pass-through reads
 *  GET  /dx/observations — public DX log
 *  GET  /rebalance/preview — dry-run with cooldown disabled
 *  POST /api/auth/nonce — issue a sign-in nonce for end-user actions
 *  POST /api/deposits/confirm — verify a signed deposit + record the share
 *  POST /api/withdrawals/request — verify a signed withdrawal + queue/settle
 *  GET  /api/me/:wallet — depositor view (share %, contributions, payouts, balance)
 *
 * Admin endpoints (require `Authorization: Bearer <ORCHESTRATOR_ADMIN_TOKEN>`):
 *  POST /admin/rebalance/trigger
 *  POST /admin/claim/sweep
 *  POST /admin/claim/:positionPubkey
 *  POST /admin/withdrawals/process
 *  GET  /admin/depositors
 */

const cfg = loadConfig();
const log = createLogger('orchestrator');

const server = Fastify({ loggerInstance: log });

// ─── Public read endpoints ────────────────────────────────────────────────────

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

/** Anonymous aggregates — replaces the public depositor list (privacy fix). */
server.get('/vault/aggregate', async () => {
  const depositorRows = listDepositors();
  return {
    depositorCount: depositorRows.length,
    totalContributedUsdc: depositorRows.reduce((s, r) => s + r.totalUsdc, 0),
  };
});

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
  return prediction.listEvents(opts);
});

server.get('/rebalance/preview', async () => {
  return runRebalanceTick({ dryRun: true, minIntervalMs: 0 });
});

// ─── Sign-message authenticated endpoints (end-user actions) ──────────────────

interface NonceRequestBody {
  wallet?: unknown;
  purpose?: unknown;
}

server.post<{ Body: NonceRequestBody | undefined }>('/api/auth/nonce', async (req, reply) => {
  const body = req.body ?? {};
  if (typeof body.wallet !== 'string' || body.wallet.length < 32) {
    return reply.code(400).send({ error: 'invalid_wallet' });
  }
  if (body.purpose !== 'deposit-confirm' && body.purpose !== 'withdraw-request') {
    return reply.code(400).send({ error: 'invalid_purpose' });
  }
  const issued = issueNonce({ wallet: body.wallet, purpose: body.purpose });
  return {
    nonce: issued.nonce,
    expiresAt: issued.expiresAt,
    purpose: body.purpose,
    instructions:
      'Build the canonical message via buildCanonicalMessage() with your bindings, sign it with your wallet, then submit { signature, nonce, ...bindings } to the corresponding action endpoint.',
  };
});

interface DepositConfirmBody {
  signature?: unknown;
  depositorPubkey?: unknown;
  amount?: unknown;
  nonce?: unknown;
  signedProof?: unknown;
}

server.post<{ Body: DepositConfirmBody | undefined }>(
  '/api/deposits/confirm',
  async (req, reply) => {
    const body = req.body;
    if (!body) return reply.code(400).send({ error: 'missing_body' });
    const { signature, depositorPubkey, amount, nonce, signedProof } = body;

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
    if (typeof nonce !== 'string' || nonce.length === 0) {
      return reply.code(400).send({ error: 'missing_nonce' });
    }
    if (typeof signedProof !== 'string' || signedProof.length === 0) {
      return reply.code(400).send({ error: 'missing_signed_proof' });
    }

    // 1) Verify the signed proof — depositor controls depositorPubkey
    const message = buildCanonicalMessage({
      purpose: 'deposit-confirm',
      nonce,
      bindings: { signature, amount: amountNum.toFixed(6) },
    });
    try {
      verifySignedMessageAndConsume({
        wallet: depositorPubkey,
        purpose: 'deposit-confirm',
        nonce,
        message,
        signature: signedProof,
      });
    } catch (err) {
      if (err instanceof NonceVerifyError) {
        return reply.code(401).send({ error: err.code, message: err.message });
      }
      log.error({ err }, 'Nonce verification failed unexpectedly');
      return reply.code(500).send({ error: 'internal_error' });
    }

    // 2) Verify the on-chain transfer matches
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
      return reply.code(500).send({ error: 'internal_error' });
    }
  },
);

interface WithdrawalRequestBody {
  wallet?: unknown;
  amount?: unknown;
  nonce?: unknown;
  signedProof?: unknown;
}

server.post<{ Body: WithdrawalRequestBody | undefined }>(
  '/api/withdrawals/request',
  async (req, reply) => {
    const body = req.body;
    if (!body) return reply.code(400).send({ error: 'missing_body' });
    const { wallet, amount, nonce, signedProof } = body;
    if (typeof wallet !== 'string' || wallet.length < 32) {
      return reply.code(400).send({ error: 'invalid_wallet' });
    }
    const amountNum = typeof amount === 'number' ? amount : Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return reply.code(400).send({ error: 'invalid_amount' });
    }
    if (typeof nonce !== 'string' || nonce.length === 0) {
      return reply.code(400).send({ error: 'missing_nonce' });
    }
    if (typeof signedProof !== 'string' || signedProof.length === 0) {
      return reply.code(400).send({ error: 'missing_signed_proof' });
    }

    const message = buildCanonicalMessage({
      purpose: 'withdraw-request',
      nonce,
      bindings: { amount: amountNum.toFixed(6) },
    });
    try {
      verifySignedMessageAndConsume({
        wallet,
        purpose: 'withdraw-request',
        nonce,
        message,
        signature: signedProof,
      });
    } catch (err) {
      if (err instanceof NonceVerifyError) {
        return reply.code(401).send({ error: err.code, message: err.message });
      }
      log.error({ err }, 'Nonce verification failed unexpectedly');
      return reply.code(500).send({ error: 'internal_error' });
    }

    try {
      const result = await requestWithdrawal({ wallet, amountUsdc: amountNum });
      log.info({ wallet, amount: amountNum, status: result.status, id: result.id }, 'Withdrawal requested');
      return result;
    } catch (err) {
      if (err instanceof WithdrawalError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      log.error({ err }, 'Withdrawal request failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  },
);

/**
 * Public per-depositor view: only meaningful if the caller knows the wallet
 * pubkey already. Aggregate amounts only — no PII beyond what's already on chain.
 */
server.get<{ Params: { wallet: string } }>('/api/me/:wallet', async (req) => {
  const wallet = req.params.wallet;
  const totalContributed = getDepositorTotal(wallet);
  const totalContributedAll = getTotalContributed();
  const balance = getDepositorNetBalance(wallet);
  const claimTotal = getDepositorClaimTotal(wallet);
  return {
    wallet,
    contributedUsdc: totalContributed,
    sharePct: totalContributedAll > 0 ? (totalContributed / totalContributedAll) * 100 : 0,
    payoutsAccruedUsdc: claimTotal,
    balance,
  };
});

// ─── Admin endpoints ──────────────────────────────────────────────────────────

server.post<{ Body: { dryRun?: boolean; skipCompound?: boolean } | undefined }>(
  '/admin/rebalance/trigger',
  { preHandler: requireAdmin },
  async (req) => {
    const body = (req.body ?? {}) as { dryRun?: boolean; skipCompound?: boolean };
    const opts: Parameters<typeof runRebalanceTick>[0] = {};
    if (typeof body.dryRun === 'boolean') opts.dryRun = body.dryRun;
    if (typeof body.skipCompound === 'boolean') opts.skipCompound = body.skipCompound;
    // NOTE: minIntervalMs intentionally NOT exposed — admins still respect the cooldown gate.
    return runRebalanceTick(opts);
  },
);

server.post('/admin/claim/sweep', { preHandler: requireAdmin }, async () => runClaimSweep());

server.post<{ Params: { positionPubkey: string } }>(
  '/admin/claim/:positionPubkey',
  { preHandler: requireAdmin },
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

server.post('/admin/withdrawals/process', { preHandler: requireAdmin }, async () => {
  return processPendingWithdrawals();
});

server.get('/admin/depositors', { preHandler: requireAdmin }, async () => {
  const rows = listDepositors();
  return {
    depositors: rows.map((r) => ({
      wallet: r.wallet,
      totalUsdc: r.totalUsdc,
      joinedAt: r.joinedAt,
      claimsAccrued: getDepositorClaimTotal(r.wallet),
    })),
    totalDepositors: rows.length,
    totalContributedUsdc: rows.reduce((sum, r) => sum + r.totalUsdc, 0),
  };
});

// ─── Error / 404 ──────────────────────────────────────────────────────────────

server.setNotFoundHandler((_req, reply) => {
  void reply.code(404).send({ error: 'not_found' });
});

server.setErrorHandler((err, _req, reply) => {
  // Don't echo internal details to clients — log server-side only.
  log.error({ err }, 'Unhandled request error');
  void reply.code(500).send({ error: 'internal_error' });
});

async function main(): Promise<void> {
  // CORS: allow the browser-side web app to call us. Localhost ports during dev,
  // plus an optional WEB_ORIGIN env override for deployed environments.
  await server.register(cors, {
    origin: [
      /^https?:\/\/localhost(:\d+)?$/,
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
      ...(process.env.WEB_ORIGIN ? [process.env.WEB_ORIGIN] : []),
    ],
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token'],
    maxAge: 86_400,
  });

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
