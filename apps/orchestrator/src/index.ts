import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { getJupiterClients } from './jupiter.js';
import { readRecentObservations } from './eventLog.js';
import { bpsToPercentString, microToUsd } from '@reflux/shared';
import { getVaultSolBalance, getVaultWallet } from './wallet.js';
import { readUsdcEarnPosition } from './lend.js';

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
  const [sol, lendPosition] = await Promise.all([
    getVaultSolBalance(),
    readUsdcEarnPosition().catch(() => null),
  ]);
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
  };
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
  await server.listen({ port: cfg.ORCHESTRATOR_PORT, host: '0.0.0.0' });
  log.info({ port: cfg.ORCHESTRATOR_PORT }, 'Reflux orchestrator listening');
}

main().catch((err: unknown) => {
  log.fatal({ err }, 'Orchestrator failed to start');
  process.exit(1);
});
