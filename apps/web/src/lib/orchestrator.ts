/**
 * Server-side fetch helpers that talk to the Reflux orchestrator.
 *
 * All calls run on the server (Next.js Server Components) so the orchestrator's
 * URL never has to be public and we keep API keys / observability hidden.
 *
 * NOTE: every page that consumes these uses `revalidate = 0` (or `cache: 'no-store'`)
 * because we want live data — judges should see real-time numbers when reviewing.
 */
import type { ApiObservation } from '@reflux/shared';

const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ??
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ??
  'http://localhost:4000';

async function get<T>(path: string): Promise<T> {
  const url = `${ORCHESTRATOR_URL}${path}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Orchestrator ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export interface VaultInfo {
  address: string;
  cluster: string;
  solBalance: number;
  solBalanceLamports: number;
  solscanUrl: string;
}

export interface LendTokenSummary {
  symbol: string;
  assetAddress: string;
  assetSymbol: string;
  totalRateApy: string;
  totalAssetsUsd: number;
  withdrawableUsd: number;
}

export interface LendTokensResponse {
  tokens: LendTokenSummary[];
}

export interface DxObservationsResponse {
  observations: ApiObservation[];
}

export const orchestrator = {
  vaultInfo: () => get<VaultInfo>('/vault/info'),
  lendTokens: () => get<LendTokensResponse>('/lend/tokens'),
  dxObservations: (limit = 100) => get<DxObservationsResponse>(`/dx/observations?limit=${limit}`),
  health: () => get<{ status: string; cluster: string }>('/health'),
};
