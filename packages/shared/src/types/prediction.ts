/**
 * Types mirroring Jupiter Prediction Market API response shapes.
 * Source: live probe of GET /prediction/v1/events, /markets/{id}, /orderbook/{id}
 * (see docs/api-research/00-prediction-api-probe.md).
 *
 * DX-LOG-REF: Gap #1 — events list omits market titles + prices; forces N+1 calls.
 * DX-LOG-REF: Gap #2 — orderbook tuple format is undocumented.
 */

export type PredictionCategory =
  | 'politics'
  | 'crypto'
  | 'finance'
  | 'culture'
  | 'economics'
  | 'sports'
  | string;

export interface PredictionEventMarketRef {
  marketId: string;
  // Other fields exist in the response but are reliably opaque without /markets/{id}.
}

export interface PredictionEvent {
  eventId: string;
  isActive: boolean;
  isLive: boolean;
  category: PredictionCategory;
  subcategory?: string;
  tags?: string[];
  metadata?: {
    title?: string;
    description?: string;
    [k: string]: unknown;
  };
  /** Total event volume in micro-USD. */
  volumeUsd: string;
  volume24hr?: string;
  beginAt?: number;
  closeCondition?: string;
  rulesPdf?: string | null;
  markets: PredictionEventMarketRef[];
}

export interface PredictionEventsPagination {
  start: number;
  end: number;
  total: number;
  hasNext: boolean;
}

export interface PredictionEventsResponse {
  data: PredictionEvent[];
  pagination: PredictionEventsPagination;
}

export type MarketStatus = 'open' | 'closed' | 'resolved' | string;

export interface PredictionMarketPricing {
  /** Ask for YES contract, in micro-USD (e.g. 875000 = $0.8750). */
  buyYesPriceUsd: number;
  /** Bid for YES contract, in micro-USD. */
  sellYesPriceUsd: number;
  /** Bid for NO contract, in micro-USD. */
  sellNoPriceUsd: number;
  /** Ask for NO contract, in micro-USD. */
  buyNoPriceUsd: number;
  /** Total market volume in micro-USD. */
  volume: number;
}

export interface PredictionMarket {
  marketId: string;
  status: MarketStatus;
  result: string | null;
  marketResultPubkey: string | null;
  title: string;
  openTime: number;
  closeTime: number;
  isTeamMarket: boolean;
  rulesPrimary: string;
  rulesSecondary?: string;
  resolveAt: number | null;
  pricing: PredictionMarketPricing;
  imageUrl: string | null;
  team?: unknown;
  outcomes: ['Yes', 'No'] | string[];
  /** Mid prices for each outcome as decimal strings (e.g. "0.844"). */
  outcomePrices: string[];
  clobTokenIds: string[];
  resolution: string | null;
  marketOptions: { label: string; buyYes: boolean }[];
  sportsMarketType?: string | null;
  sportsLine?: string | null;
  eventId: string;
}

/**
 * Orderbook entry: tuple of [priceCents, sizeMicroUsd] — best guess from probing.
 * Format is not documented in Jupiter docs (DX gap #2).
 */
export type OrderbookLevel = readonly [priceCents: number, size: number];

export interface PredictionOrderbook {
  yes: OrderbookLevel[];
  no: OrderbookLevel[];
}

// ─── Write-side: order placement, position management, claims ─────────────────

/**
 * Body for POST /prediction/v1/orders.
 *
 * `depositAmount` is in native token base units of `depositMint`
 * (USDC has 6 decimals → 1_000_000 = $1.00). DX-LOG-REF: Gap #18 — this scaling
 * convention is documented but easy to miss if you're skimming.
 */
export interface CreateOrderRequest {
  ownerPubkey: string;
  marketId: string;
  isYes: boolean;
  isBuy: boolean;
  /** Native token base units (e.g. "500000" = $0.50 USDC). */
  depositAmount: string;
  /** Mint address of the deposit asset (USDC or JupUSD). */
  depositMint: string;
  /** Optional: number of contracts to purchase. */
  contracts?: string;
}

export interface CreateOrderResponse {
  /** Base64-encoded VersionedTransaction. */
  transaction: string;
  txMeta: {
    blockhash: string;
    lastValidBlockHeight: number;
  };
  order: {
    orderPubkey: string;
    positionPubkey: string;
    contracts: string;
  };
}

export type OrderFillStatus = 'pending' | 'filled' | 'failed';

export interface OrderStatusResponse {
  status: OrderFillStatus;
  orderPubkey?: string;
  positionPubkey?: string;
  contractsFilled?: string;
}

/**
 * Shape returned by `GET /prediction/v1/positions?ownerPubkey=...`.
 *
 * DX-LOG-REF: Gap #19 — the position field is named `pubkey` in this response,
 * but the management endpoints (and the docs prose for /open-positions) call it
 * `positionPubkey`. We expose both names for consumers.
 *
 * DX-LOG-REF: Gap #20 — list response is wrapped in `{ data: [...] }`, not
 * `{ positions: [...] }` as the manage-positions docs vaguely imply.
 */
export interface PredictionPosition {
  /** Position account address — known by both names depending on endpoint. */
  pubkey: string;
  positionPubkey?: string;
  /** On-chain market account (NOT the polymarket id). */
  market: string;
  /** Polymarket-prefixed id (e.g. "POLY-1345530") used by /events and /markets. */
  marketId: string;
  ownerPubkey: string;
  isYes: boolean;
  /** Contract count, integer string (each contract pays $1 if outcome wins). */
  contracts: string;
  /** Total cost basis in micro-USD. */
  totalCostUsd: string;
  /** Cumulative fees in micro-USD. */
  feesPaidUsd: string;
  /** Current liquidation value in micro-USD. */
  valueUsd: string;
  /** Average fill price in micro-USD. */
  avgPriceUsd: string;
  /** Current mark price in micro-USD. */
  markPriceUsd: string;
  /** Unrealized P&L in micro-USD (excludes fees). */
  pnlUsd: string;
  pnlUsdPercent: number;
  pnlUsdAfterFees: string;
  pnlUsdAfterFeesPercent: number;
  /** Whether the market resolved in this position's favor and a payout is available. */
  claimable?: boolean;
  /** Whether the payout has already been claimed (or auto-claimed by the keeper after 24h). */
  claimed: boolean;
  claimedUsd: string;
  /** Available payout in micro-USD when claimable. */
  payoutUsd?: string;
  openOrders: number;
  openedAt: number;
  updatedAt: number;
  eventId: string;
  eventMetadata?: {
    title?: string;
    subtitle?: string;
    category?: string;
    subcategory?: string;
    imageUrl?: string;
  };
  marketMetadata?: {
    title?: string;
    subtitle?: string;
    description?: string;
    status?: string;
    closeTime?: number;
  };
}

export interface ListPositionsResponse {
  data: PredictionPosition[];
}

export interface ClosePositionRequest {
  ownerPubkey: string;
}

export interface ClosePositionResponse {
  transaction: string;
  txMeta: {
    blockhash: string;
    lastValidBlockHeight: number;
  };
}

export interface ClaimPositionRequest {
  ownerPubkey: string;
}

/**
 * `POST /positions/{positionPubkey}/claim` response.
 *
 * DX-LOG-REF: Gap #25 — the claim response uses top-level `blockhash` /
 * `lastValidBlockHeight` instead of the `txMeta` envelope used by /orders and
 * /positions/{id} (DELETE). Inconsistent shape across closely-related write
 * endpoints in the same product.
 */
export interface ClaimPositionResponse {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  position: {
    pubkey: string;
    contracts: string;
    payoutAmountUsd: string;
  };
}
