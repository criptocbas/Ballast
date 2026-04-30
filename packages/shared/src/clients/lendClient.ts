import type { LendEarnToken } from '../types/lend.js';
import type { JupiterHttpClient } from './http.js';

/**
 * Wraps the subset of Jupiter Lend Earn endpoints Reflux uses.
 * Read-only operations work with keyless access; transaction crafting needs an API key.
 */
export class LendEarnClient {
  constructor(private readonly http: JupiterHttpClient) {}

  /** GET /lend/v1/earn/tokens — list supported deposit assets and current rates. */
  async listTokens(): Promise<LendEarnToken[]> {
    return this.http.get<LendEarnToken[]>('/lend/v1/earn/tokens');
  }

  /**
   * Find a Lend Earn token by underlying asset mint address.
   * Throws if not found.
   */
  async getTokenByAssetMint(assetMint: string): Promise<LendEarnToken> {
    const tokens = await this.listTokens();
    const match = tokens.find((t) => t.assetAddress === assetMint);
    if (!match) {
      throw new Error(
        `LendEarnClient.getTokenByAssetMint: no Lend Earn token found for asset ${assetMint}`,
      );
    }
    return match;
  }
}
