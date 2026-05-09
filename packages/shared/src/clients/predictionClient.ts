import type {
  ClaimPositionRequest,
  ClaimPositionResponse,
  ClosePositionRequest,
  ClosePositionResponse,
  CreateOrderRequest,
  CreateOrderResponse,
  ListPositionsResponse,
  OrderStatusResponse,
  PredictionEvent,
  PredictionEventsResponse,
  PredictionMarket,
  PredictionOrderbook,
} from '../types/prediction.js';
import type { JupiterHttpClient } from './http.js';

export interface ListEventsOptions {
  limit?: number;
  start?: number;
  category?: string;
  subcategory?: string;
  /** "live", "trending", "new", etc. — see /prediction/v1/events. */
  filter?: string;
  /** Free-text search by event title. */
  search?: string;
  sort?: 'volume' | 'volume24h' | 'recent';
}

/**
 * Wraps Jupiter Prediction Market read endpoints used by Ballast's basket selector.
 * Order placement (POST /orders) is in a separate client because it needs auth.
 */
export class PredictionClient {
  constructor(private readonly http: JupiterHttpClient) {}

  /** GET /prediction/v1/events — paginated event listing. */
  async listEvents(options: ListEventsOptions = {}): Promise<PredictionEventsResponse> {
    return this.http.get<PredictionEventsResponse>('/prediction/v1/events', {
      limit: options.limit,
      start: options.start,
      category: options.category,
      subcategory: options.subcategory,
      filter: options.filter,
      search: options.search,
      sort: options.sort,
    });
  }

  /** Convenience: paginate through all events in a category. */
  async listAllEventsInCategory(category: string, pageSize = 50): Promise<PredictionEvent[]> {
    const all: PredictionEvent[] = [];
    let start = 0;
    while (true) {
      const page = await this.listEvents({ category, start, limit: pageSize });
      all.push(...page.data);
      if (!page.pagination.hasNext) break;
      start = page.pagination.end;
    }
    return all;
  }

  /** GET /prediction/v1/markets/{marketId}. */
  async getMarket(marketId: string): Promise<PredictionMarket> {
    return this.http.get<PredictionMarket>(`/prediction/v1/markets/${encodeURIComponent(marketId)}`);
  }

  /** GET /prediction/v1/orderbook/{marketId}. */
  async getOrderbook(marketId: string): Promise<PredictionOrderbook> {
    return this.http.get<PredictionOrderbook>(
      `/prediction/v1/orderbook/${encodeURIComponent(marketId)}`,
    );
  }

  /** POST /prediction/v1/orders — returns a base64 tx caller must sign and submit. */
  async createOrder(req: CreateOrderRequest): Promise<CreateOrderResponse> {
    return this.http.post<CreateOrderResponse>('/prediction/v1/orders', req);
  }

  /** GET /prediction/v1/orders/status/{orderPubkey} — poll a submitted order's fill status. */
  async getOrderStatus(orderPubkey: string): Promise<OrderStatusResponse> {
    return this.http.get<OrderStatusResponse>(
      `/prediction/v1/orders/status/${encodeURIComponent(orderPubkey)}`,
    );
  }

  /** GET /prediction/v1/positions?ownerPubkey=... — list all open positions for a wallet. */
  async listPositions(ownerPubkey: string): Promise<ListPositionsResponse> {
    return this.http.get<ListPositionsResponse>('/prediction/v1/positions', {
      ownerPubkey,
    });
  }

  /** DELETE /prediction/v1/positions/{positionPubkey} — returns a base64 tx that closes the position. */
  async closePosition(
    positionPubkey: string,
    body: ClosePositionRequest,
  ): Promise<ClosePositionResponse> {
    return this.http.delete<ClosePositionResponse>(
      `/prediction/v1/positions/${encodeURIComponent(positionPubkey)}`,
      body,
    );
  }

  /** POST /prediction/v1/positions/{positionPubkey}/claim — returns a base64 tx that claims the payout. */
  async claimPosition(
    positionPubkey: string,
    body: ClaimPositionRequest,
  ): Promise<ClaimPositionResponse> {
    return this.http.post<ClaimPositionResponse>(
      `/prediction/v1/positions/${encodeURIComponent(positionPubkey)}/claim`,
      body,
    );
  }
}
