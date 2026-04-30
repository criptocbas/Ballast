import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { loadConfig } from './config.js';

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
 * Returns vault SOL balance in lamports and the lamport-equivalent SOL float.
 * Useful for the /vault/info endpoint and the public dashboard.
 */
export async function getVaultSolBalance(): Promise<{ lamports: number; sol: number }> {
  const { publicKey } = getVaultWallet();
  const conn = getSolanaConnection();
  const lamports = await conn.getBalance(publicKey);
  return { lamports, sol: lamports / 1_000_000_000 };
}
