import { JupiterHttpClient, LendEarnClient, PredictionClient } from '@ballast/shared';
import { loadConfig } from './config.js';
import type { ApiObservation } from '@ballast/shared';
import { recordObservation } from './eventLog.js';

/**
 * Singleton Jupiter API clients used by the orchestrator. Each call is captured
 * by the eventLog so the public DX dashboard can replay it.
 */

let clientsCache:
  | {
      http: JupiterHttpClient;
      lend: LendEarnClient;
      prediction: PredictionClient;
    }
  | undefined;

export function getJupiterClients(): {
  http: JupiterHttpClient;
  lend: LendEarnClient;
  prediction: PredictionClient;
} {
  if (clientsCache) return clientsCache;

  const cfg = loadConfig();
  const http = new JupiterHttpClient({
    baseUrl: cfg.JUPITER_API_BASE_URL,
    apiKey: cfg.JUPITER_API_KEY,
    onObservation: (obs: ApiObservation) => recordObservation(obs),
  });

  clientsCache = {
    http,
    lend: new LendEarnClient(http),
    prediction: new PredictionClient(http),
  };
  return clientsCache;
}
