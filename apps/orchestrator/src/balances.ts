import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { USDC_MINT, readUsdcEarnPosition } from './lend.js';
import { getVaultWallet, withRpcFallback } from './wallet.js';

/**
 * Vault liquidity helpers.
 *
 * `fetchVaultUsdcBalance` is the freely-spendable USDC sitting in the vault's
 * USDC ATA — what the rebalance loop and withdrawal settler actually have at
 * hand without any further Lend round-trip.
 *
 * `fetchVaultRedeemableUsdc` is the broader "what the vault could pay out *now*"
 * number — wallet USDC + Lend Earn underlying value. It deliberately EXCLUDES
 * the mark value of open Prediction positions: those are illiquid until the
 * market resolves, and showing depositors a withdrawable balance that includes
 * mid-market hedge value would re-introduce the exact UX trap that DX-GAP-#28
 * is the field report on.
 */

export async function fetchVaultUsdcBalance(): Promise<number> {
  const wallet = getVaultWallet();
  const ata = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
  try {
    const acct = await withRpcFallback((conn) => getAccount(conn, ata));
    return Number(acct.amount) / 1_000_000;
  } catch {
    return 0;
  }
}

export async function fetchVaultRedeemableUsdc(): Promise<number> {
  const [walletUsdc, lendPosition] = await Promise.all([
    fetchVaultUsdcBalance(),
    readUsdcEarnPosition().catch(() => null),
  ]);
  return walletUsdc + (lendPosition?.underlyingUsdc ?? 0);
}
