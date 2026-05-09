import { Client as LendReadClient } from '@jup-ag/lend-read';
import { getDepositIxs, getWithdrawIxs } from '@jup-ag/lend/earn';
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';
import { getSolanaConnection, getVaultWallet } from './wallet.js';
import { buildSimSignSendConfirmV0 } from './tx.js';

/**
 * Jupiter Lend Earn helpers used by the rebalance loop.
 *
 * v1 supports a single deposit asset (USDC). The vault deposits its USDC into
 * jlUSDC and reads the position back to compute accrued yield.
 *
 * USDC mint on mainnet: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 */

export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

/** USDC has 6 decimals; this converts a human dollar amount to base units. */
export function usdcToBaseUnits(usdc: number): BN {
  if (!Number.isFinite(usdc) || usdc < 0) {
    throw new Error(`Invalid USDC amount: ${usdc}`);
  }
  return new BN(Math.round(usdc * 1_000_000));
}

export function baseUnitsToUsdc(baseUnits: BN | string): number {
  const bn = typeof baseUnits === 'string' ? new BN(baseUnits) : baseUnits;
  // Two-step conversion preserves precision for large bigint amounts.
  const whole = bn.divn(1_000_000).toNumber();
  const frac = bn.modrn(1_000_000);
  return whole + frac / 1_000_000;
}

let cachedReadClient: LendReadClient | undefined;

export function getLendReadClient(): LendReadClient {
  if (!cachedReadClient) {
    cachedReadClient = new LendReadClient(getSolanaConnection());
  }
  return cachedReadClient;
}

export interface LendEarnPosition {
  /** Raw jl-token balance (e.g. jlUSDC), in base units. */
  jlTokenBalanceBaseUnits: string;
  /** Same balance expressed as underlying USDC (multiplied by exchange price). */
  underlyingUsdc: number;
  /** Display-ready APY. */
  totalApyBps: number;
}

/**
 * Read the vault's current jlUSDC position.
 * Returns null if the vault has no position yet (i.e. before any deposit).
 *
 * DX-LOG-REF: Gap #15 — `jupiter-lend` Skill says `client.lend` but the actual SDK
 * exposes `client.lending`. Anyone wiring this from the Skill's prose alone will
 * hit a TS error; we rediscovered the right name by reading the .d.mts.
 *
 * DX-LOG-REF: Gap #16 — `userPosition.underlyingBalance` from `getUserPositions`
 * is the user's wallet balance of the underlying asset, NOT the value of their
 * jlToken position in underlying terms. The naming strongly suggests the latter.
 * We compute the position's underlying value ourselves from jlTokenShares × the
 * lending pool's `convertToAssets` rate (sourced from the public REST API).
 *
 * DX-LOG-REF: Gap #17 — `JlTokenDetails.supplyRate` / `rewardsRate` are returned
 * as BN with an undocumented scale factor; combining them to get APY is non-trivial
 * versus the REST API's clean `supplyRate: "323"` (basis points). We use the REST
 * API for rates and the SDK only for the on-chain position state.
 */
export async function readUsdcEarnPosition(): Promise<LendEarnPosition | null> {
  const wallet = getVaultWallet();
  const client = getLendReadClient();

  const positions = await client.lending.getUserPositions(wallet.publicKey);
  const usdcPosition = positions.find(
    (p) => p.jlTokenDetails.underlyingAddress.toBase58() === USDC_MINT.toBase58(),
  );
  if (!usdcPosition) return null;

  const sharesBn = usdcPosition.userPosition.jlTokenShares;
  if (sharesBn.isZero()) return null;

  // Pull the cleanly-scaled rate + conversion factor from the REST API.
  const restToken = await fetchJlUsdcMeta();

  // convertToAssets is "underlying micro-units per micro-share", scaled by 1e6.
  // So underlying micro-units = shares.toNumber() * convertToAssets / 1e6.
  // For our scale (cents-of-cents) this fits comfortably in a Number.
  const convertToAssets = restToken.convertToAssets;
  const sharesNum = Number(sharesBn.toString());
  const underlyingMicro = (sharesNum * convertToAssets) / 1_000_000;

  return {
    jlTokenBalanceBaseUnits: sharesBn.toString(),
    underlyingUsdc: underlyingMicro / 1_000_000,
    totalApyBps: restToken.totalRateBps,
  };
}

interface RestJlTokenMeta {
  convertToAssets: number;
  totalRateBps: number;
}

let cachedJlUsdcMeta: { meta: RestJlTokenMeta; at: number } | undefined;

async function fetchJlUsdcMeta(): Promise<RestJlTokenMeta> {
  // Cache for 30s — rates change slowly relative to our rebalance cadence.
  const now = Date.now();
  if (cachedJlUsdcMeta && now - cachedJlUsdcMeta.at < 30_000) {
    return cachedJlUsdcMeta.meta;
  }
  const res = await fetch('https://api.jup.ag/lend/v1/earn/tokens', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`jl tokens fetch failed: ${res.status}`);
  const tokens = (await res.json()) as Array<{
    assetAddress: string;
    convertToAssets: string;
    totalRate: string;
  }>;
  const usdc = tokens.find((t) => t.assetAddress === USDC_MINT.toBase58());
  if (!usdc) throw new Error('jlUSDC not found in /lend/v1/earn/tokens response');
  const meta: RestJlTokenMeta = {
    convertToAssets: Number(usdc.convertToAssets),
    totalRateBps: Number(usdc.totalRate),
  };
  cachedJlUsdcMeta = { meta, at: now };
  return meta;
}

export interface DepositResult {
  signature: string;
  amountUsdc: number;
  vaultAddress: string;
}

/**
 * Deposit USDC into Jupiter Lend Earn. Returns the transaction signature once confirmed.
 *
 * Safety:
 *  - Always pre-flight-simulates the transaction; throws cleanly if simulation fails.
 *  - Uses skipPreflight=false on send so RPC double-checks before broadcasting.
 *  - Caller must already be sure the vault holds at least `amountUsdc` USDC.
 */
export async function depositUsdcToLendEarn(
  amountUsdc: number,
  options: { simulateOnly?: boolean } = {},
): Promise<DepositResult> {
  if (amountUsdc <= 0) {
    throw new Error(`depositUsdcToLendEarn: amount must be positive, got ${amountUsdc}`);
  }

  const wallet = getVaultWallet();
  const connection = getSolanaConnection();
  const amount = usdcToBaseUnits(amountUsdc);

  const result = (await getDepositIxs({
    amount,
    asset: USDC_MINT,
    signer: wallet.publicKey,
    connection,
  })) as { ixs: TransactionInstruction[] };
  const ixs = result.ixs;
  if (!ixs.length) {
    throw new Error('Lend SDK returned zero deposit instructions');
  }

  const signatureOrSim = await buildSimSignSendConfirmV0({
    conn: connection,
    signer: wallet.keypair,
    payer: wallet.publicKey,
    ixs,
    ...(options.simulateOnly ? { simulateOnly: true as const } : {}),
  });

  return { signature: signatureOrSim, amountUsdc, vaultAddress: wallet.pubkeyBase58 };
}

/**
 * Withdraw USDC from Jupiter Lend Earn. Symmetric counterpart to depositUsdcToLendEarn.
 */
export async function withdrawUsdcFromLendEarn(
  amountUsdc: number,
  options: { simulateOnly?: boolean } = {},
): Promise<DepositResult> {
  if (amountUsdc <= 0) {
    throw new Error(`withdrawUsdcFromLendEarn: amount must be positive, got ${amountUsdc}`);
  }

  const wallet = getVaultWallet();
  const connection = getSolanaConnection();
  const amount = usdcToBaseUnits(amountUsdc);

  const result = (await getWithdrawIxs({
    amount,
    asset: USDC_MINT,
    signer: wallet.publicKey,
    connection,
  })) as { ixs: TransactionInstruction[] };
  const ixs = result.ixs;
  if (!ixs.length) {
    throw new Error('Lend SDK returned zero withdraw instructions');
  }

  const signature = await buildSimSignSendConfirmV0({
    conn: connection,
    signer: wallet.keypair,
    payer: wallet.publicKey,
    ixs,
    ...(options.simulateOnly ? { simulateOnly: true as const } : {}),
  });

  return { signature, amountUsdc, vaultAddress: wallet.pubkeyBase58 };
}
