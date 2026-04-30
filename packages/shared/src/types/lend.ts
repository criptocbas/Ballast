/**
 * Types mirroring Jupiter Lend Earn API response shapes.
 * Source: live probe of GET /lend/v1/earn/tokens (see docs/api-research/01-lend-earn-probe.md)
 *
 * DX-LOG-REF: Gap #5 — all numeric values are micro-units strings; we keep them as-is and convert at the boundary.
 */

export interface JupiterLendAsset {
  address: string;
  chainId: 'solana';
  name: string;
  symbol: string;
  uiSymbol: string;
  decimals: number;
  logoUrl: string;
  /** USD price as a string. */
  price: string;
  coingeckoId?: string;
  updatedAt: string;
}

export interface LendEarnLiquiditySupplyData {
  modeWithInterest: boolean;
  /** Total supply in micro-units of the underlying asset. */
  supply: string;
  withdrawalLimit: string;
  lastUpdateTimestamp: string;
  expandPercent: number;
  expandDuration: string;
  baseWithdrawalLimit: string;
  withdrawableUntilLimit: string;
  /** Currently withdrawable amount in micro-units. */
  withdrawable: string;
}

export interface LendEarnToken {
  /** Numeric ID assigned by Jupiter (e.g. 2 for jlUSDC). */
  id: number;
  /** Mint address of the receipt token (jl-token). */
  address: string;
  /** Receipt token name, e.g. "jupiter lend USDC". */
  name: string;
  /** Receipt token symbol, e.g. "jlUSDC". */
  symbol: string;
  /** Display symbol, may differ from `symbol` (e.g. "JUICED" vs "jlJupUSD"). */
  uiSymbol: string;
  decimals: number;
  /** Mint address of the underlying asset. */
  assetAddress: string;
  asset: JupiterLendAsset;
  /** Total underlying assets in the pool, in micro-units. */
  totalAssets: string;
  /** Total receipt tokens issued, in micro-units. */
  totalSupply: string;
  /** Conversion rate: 1 micro-asset = N micro-shares (×1e6). */
  convertToShares: string;
  /** Conversion rate: 1 micro-share = N micro-asset (×1e6). */
  convertToAssets: string;
  /** Rewards APR in basis points. */
  rewardsRate: string;
  /** Supply APR in basis points. */
  supplyRate: string;
  /** Combined APR in basis points. */
  totalRate: string;
  rebalanceDifference: string;
  liquiditySupplyData: LendEarnLiquiditySupplyData;
  rewards: unknown[];
}
