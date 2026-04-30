import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Locate and load the .env at the workspace root, regardless of the cwd from which
 * the orchestrator was invoked. We walk up looking for `pnpm-workspace.yaml` — that's
 * the canonical workspace root marker.
 */
function loadEnvFromWorkspaceRoot(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
      dotenv.config({ path: resolve(dir, '.env') });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to dotenv default — useful in tests / standalone deployments.
  dotenv.config();
}

loadEnvFromWorkspaceRoot();

/**
 * Environment configuration. Validated at boot — fail loud if anything's missing.
 */

const ConfigSchema = z.object({
  JUPITER_API_KEY: z.string().min(1).optional(),
  JUPITER_API_BASE_URL: z.string().url().default('https://api.jup.ag'),
  SOLANA_RPC_URL: z.string().url().optional(),
  SOLANA_CLUSTER: z.enum(['mainnet-beta', 'devnet']).default('mainnet-beta'),
  VAULT_KEYPAIR_BASE58: z.string().min(1).optional(),
  DATABASE_URL: z.string().default('file:./reflux.sqlite'),
  ORCHESTRATOR_PORT: z.coerce.number().int().positive().default(4000),
  REBALANCE_CRON: z.string().default('0 0 * * *'),
  HEDGE_BUDGET_FRACTION: z.coerce.number().min(0).max(1).default(0.5),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Required for admin-only endpoints (rebalance trigger, claim, depositor list). */
  ORCHESTRATOR_ADMIN_TOKEN: z.string().min(16).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | undefined;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${parsed.error.issues
        .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  cached = parsed.data;
  return cached;
}
