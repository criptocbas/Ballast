import { VersionedTransaction } from '@solana/web3.js';
import type {
  CreateOrderRequest,
  CreateOrderResponse,
  ListPositionsResponse,
  OrderStatusResponse,
} from '@reflux/shared';
import { getJupiterClients } from './jupiter.js';
import { getSolanaConnection, getVaultWallet } from './wallet.js';
import { USDC_MINT } from './lend.js';

/**
 * Jupiter Prediction Markets — order placement on behalf of the vault.
 *
 * Flow (per https://developers.jup.ag/docs/prediction/open-positions):
 *   1. POST /prediction/v1/orders → returns base64 tx + order/position pubkeys
 *   2. Sign tx with vault keypair, submit via RPC
 *   3. Poll /orders/status/{orderPubkey} until 'filled' or 'failed'
 *
 * Important: order creation is asynchronous — returns immediately as 'pending'.
 * Filling happens via Jupiter's keeper network.
 */

export interface OpenHedgeArgs {
  marketId: string;
  /** true = buy YES, false = buy NO. For our tail-risk hedges we use isYes=false. */
  isYes: boolean;
  /** Deposit in USDC (human dollars, e.g. 0.5 for $0.50). */
  depositUsdc: number;
}

export interface OpenHedgeResult {
  signature: string;
  orderPubkey: string;
  positionPubkey: string;
  contracts: string;
  marketId: string;
  depositUsdc: number;
}

export async function openHedgeOrder(
  args: OpenHedgeArgs,
  options: { simulateOnly?: boolean } = {},
): Promise<OpenHedgeResult> {
  if (args.depositUsdc <= 0) {
    throw new Error(`openHedgeOrder: depositUsdc must be > 0, got ${args.depositUsdc}`);
  }
  const wallet = getVaultWallet();
  const conn = getSolanaConnection();
  const { prediction } = getJupiterClients();

  const depositAmount = String(Math.round(args.depositUsdc * 1_000_000));

  const req: CreateOrderRequest = {
    ownerPubkey: wallet.pubkeyBase58,
    marketId: args.marketId,
    isYes: args.isYes,
    isBuy: true,
    depositAmount,
    depositMint: USDC_MINT.toBase58(),
  };

  const orderResponse: CreateOrderResponse = await prediction.createOrder(req);

  const tx = VersionedTransaction.deserialize(Buffer.from(orderResponse.transaction, 'base64'));

  const sim = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  if (sim.value.err) {
    throw new Error(
      `Hedge order simulation failed: ${JSON.stringify(sim.value.err)}\nLogs:\n${(sim.value.logs ?? []).join('\n')}`,
    );
  }

  if (options.simulateOnly) {
    return {
      signature: '(simulated)',
      orderPubkey: orderResponse.order.orderPubkey,
      positionPubkey: orderResponse.order.positionPubkey,
      contracts: orderResponse.order.contracts,
      marketId: args.marketId,
      depositUsdc: args.depositUsdc,
    };
  }

  tx.sign([wallet.keypair]);
  const raw = tx.serialize();
  const signature = await conn.sendRawTransaction(raw, {
    maxRetries: 0,
    skipPreflight: true,
    preflightCommitment: 'confirmed',
  });
  await conn.confirmTransaction(
    {
      signature,
      blockhash: orderResponse.txMeta.blockhash,
      lastValidBlockHeight: orderResponse.txMeta.lastValidBlockHeight,
    },
    'confirmed',
  );

  return {
    signature,
    orderPubkey: orderResponse.order.orderPubkey,
    positionPubkey: orderResponse.order.positionPubkey,
    contracts: orderResponse.order.contracts,
    marketId: args.marketId,
    depositUsdc: args.depositUsdc,
  };
}

/**
 * Wait for a placed order to reach 'filled' or 'failed' state.
 * Per the docs, polling immediately can return 'pending' or 404 — backoff is
 * mandatory.
 */
export async function waitForOrderFill(
  orderPubkey: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<OrderStatusResponse> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 3_000;
  const { prediction } = getJupiterClients();

  const deadline = Date.now() + timeoutMs;
  let lastStatus: OrderStatusResponse | null = null;
  while (Date.now() < deadline) {
    try {
      const s = await prediction.getOrderStatus(orderPubkey);
      lastStatus = s;
      if (s.status === 'filled' || s.status === 'failed') return s;
    } catch {
      // Per docs: polling too soon returns 'no order history found'. Just keep retrying.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  if (lastStatus) return lastStatus;
  throw new Error(`waitForOrderFill: timed out after ${timeoutMs}ms with no status`);
}

export async function listVaultPositions(): Promise<ListPositionsResponse> {
  const wallet = getVaultWallet();
  const { prediction } = getJupiterClients();
  return prediction.listPositions(wallet.pubkeyBase58);
}
