import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('wallet');

/**
 * Vault wallet — owned by the orchestrator. Holds depositor float and Jupiter Lend / Prediction
 * positions on-chain. Loaded once from VAULT_KEYPAIR_BASE58 (gitignored .env).
 *
 * Security:
 *  - Never logged as JSON (would leak secret bytes)
 *  - Public key is safe to expose; secret never leaves this module
 *  - Wallet is for devnet/v1 demo; production would migrate to multisig or program-derived custody
 */

let cached:
  | {
      keypair: Keypair;
      publicKey: PublicKey;
      pubkeyBase58: string;
    }
  | undefined;

export function getVaultWallet(): {
  keypair: Keypair;
  publicKey: PublicKey;
  pubkeyBase58: string;
} {
  if (cached) return cached;
  const cfg = loadConfig();
  if (!cfg.VAULT_KEYPAIR_BASE58) {
    throw new Error(
      'VAULT_KEYPAIR_BASE58 is not set. Generate or import a Solana keypair into .env before running the orchestrator.',
    );
  }

  const decoded = bs58.decode(cfg.VAULT_KEYPAIR_BASE58);
  if (decoded.length !== 64) {
    throw new Error(
      `VAULT_KEYPAIR_BASE58 must decode to 64 bytes; got ${decoded.length}. ` +
        `Expected a full Solana secret key (Phantom export format).`,
    );
  }

  const keypair = Keypair.fromSecretKey(decoded);
  cached = {
    keypair,
    publicKey: keypair.publicKey,
    pubkeyBase58: keypair.publicKey.toBase58(),
  };
  return cached;
}

let connectionCache: Connection | undefined;
let fallbackConnectionCache: Connection | undefined | null;

export function getSolanaConnection(): Connection {
  if (connectionCache) return connectionCache;
  const cfg = loadConfig();
  if (!cfg.SOLANA_RPC_URL) {
    throw new Error('SOLANA_RPC_URL is not set in .env');
  }
  connectionCache = new Connection(cfg.SOLANA_RPC_URL, 'confirmed');
  return connectionCache;
}

/**
 * Returns the optional fallback Solana RPC connection, or null if not configured.
 * Used by `withRpcFallback` to retry RPC reads when the primary fails.
 */
export function getFallbackSolanaConnection(): Connection | null {
  if (fallbackConnectionCache !== undefined) return fallbackConnectionCache;
  const cfg = loadConfig();
  fallbackConnectionCache = cfg.SOLANA_RPC_URL_FALLBACK
    ? new Connection(cfg.SOLANA_RPC_URL_FALLBACK, 'confirmed')
    : null;
  return fallbackConnectionCache;
}

/**
 * Run an RPC read with automatic fallback. Tries the primary connection first;
 * if it throws (rate-limit, transient 5xx, network blip) and a fallback is
 * configured, retries against the fallback. Use only for *reads* — write paths
 * have their own retry semantics keyed to blockhash freshness, and switching
 * RPCs mid-write would break that contract.
 */
export async function withRpcFallback<T>(
  fn: (conn: Connection) => Promise<T>,
): Promise<T> {
  const primary = getSolanaConnection();
  try {
    return await fn(primary);
  } catch (err) {
    const fallback = getFallbackSolanaConnection();
    if (!fallback) throw err;
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Primary RPC failed; retrying read against fallback',
    );
    return await fn(fallback);
  }
}

/**
 * Returns vault SOL balance in lamports and the lamport-equivalent SOL float.
 * Useful for the /vault/info endpoint and the public dashboard.
 */
export async function getVaultSolBalance(): Promise<{ lamports: number; sol: number }> {
  const { publicKey } = getVaultWallet();
  const lamports = await withRpcFallback((conn) => conn.getBalance(publicKey));
  return { lamports, sol: lamports / 1_000_000_000 };
}
