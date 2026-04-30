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
