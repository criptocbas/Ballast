import type {
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
}

/**
 * Wraps Jupiter Prediction Market read endpoints used by Reflux's basket selector.
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
}
