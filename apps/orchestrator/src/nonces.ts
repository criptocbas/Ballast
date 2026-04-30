import { randomBytes } from 'node:crypto';
import { and, eq, isNull, lt } from 'drizzle-orm';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { getDb } from './db/index.js';
import { nonces } from './db/schema.js';

/**
 * Sign-message authentication for end-user actions on the orchestrator.
 *
 * Flow:
 *   1. Client requests a nonce bound to its wallet pubkey via POST /api/auth/nonce.
 *   2. Server stores `(nonce, wallet, purpose, createdAt)` and returns the nonce.
 *   3. Client builds a canonical message string `"<purpose>:<nonce>:<bound-args>"`
 *      and signs it with the wallet keypair.
 *   4. Client submits the signature alongside the action payload.
 *   5. Server verifies the signature with tweetnacl, ensures the nonce was issued
 *      to this wallet for this purpose, and consumes it (one-time use).
 *
 * The nonces table doubles as an audit log — consumed nonces are kept, not deleted.
 */

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type NoncePurpose = 'deposit-confirm' | 'withdraw-request';

export function buildCanonicalMessage(args: {
  purpose: NoncePurpose;
  nonce: string;
  bindings: Record<string, string | number>;
}): string {
  const sortedBindings = Object.entries(args.bindings)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return `ballast:${args.purpose}\nnonce=${args.nonce}\n${sortedBindings}`;
}

export function issueNonce(args: { wallet: string; purpose: NoncePurpose }): {
  nonce: string;
  message: string;
  expiresAt: number;
} {
  const db = getDb();
  const nonce = randomBytes(24).toString('base64url');
  db.insert(nonces)
    .values({
      nonce,
      wallet: args.wallet,
      purpose: args.purpose,
    })
    .run();
  return {
    nonce,
    message: '', // caller fills with buildCanonicalMessage() once they know bindings
    expiresAt: Date.now() + NONCE_TTL_MS,
  };
}

export class NonceVerifyError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'nonce_unknown'
      | 'nonce_consumed'
      | 'nonce_expired'
      | 'nonce_wrong_wallet'
      | 'nonce_wrong_purpose'
      | 'signature_invalid'
      | 'signature_format',
  ) {
    super(message);
    this.name = 'NonceVerifyError';
  }
}

export interface VerifySignedMessageArgs {
  wallet: string;
  purpose: NoncePurpose;
  nonce: string;
  message: string;
  /** Base58-encoded 64-byte ed25519 signature. */
  signature: string;
}

/**
 * Verify a signed message and consume the nonce. Throws NonceVerifyError on failure.
 *
 * On success, the nonce is marked consumed (one-time use) — replays fail.
 */
export function verifySignedMessageAndConsume(args: VerifySignedMessageArgs): void {
  const db = getDb();

  // 1) Look up the nonce
  const row = db.select().from(nonces).where(eq(nonces.nonce, args.nonce)).get();
  if (!row) throw new NonceVerifyError('Unknown nonce', 'nonce_unknown');
  if (row.consumedAt !== null) throw new NonceVerifyError('Nonce already consumed', 'nonce_consumed');
  if (Date.now() - row.createdAt > NONCE_TTL_MS) {
    throw new NonceVerifyError('Nonce expired (5 min TTL)', 'nonce_expired');
  }
  if (row.wallet !== args.wallet) {
    throw new NonceVerifyError(
      `Nonce was issued to a different wallet (${row.wallet})`,
      'nonce_wrong_wallet',
    );
  }
  if (row.purpose !== args.purpose) {
    throw new NonceVerifyError(
      `Nonce was issued for a different purpose (${row.purpose}, not ${args.purpose})`,
      'nonce_wrong_purpose',
    );
  }

  // 2) Decode the signature and verify
  let signatureBytes: Uint8Array;
  let walletBytes: Uint8Array;
  try {
    signatureBytes = bs58.decode(args.signature);
    walletBytes = new PublicKey(args.wallet).toBytes();
  } catch {
    throw new NonceVerifyError('Signature or wallet not valid base58', 'signature_format');
  }
  if (signatureBytes.length !== 64) {
    throw new NonceVerifyError(
      `Signature must decode to 64 bytes, got ${signatureBytes.length}`,
      'signature_format',
    );
  }

  const messageBytes = new TextEncoder().encode(args.message);
  const ok = nacl.sign.detached.verify(messageBytes, signatureBytes, walletBytes);
  if (!ok) throw new NonceVerifyError('Signature does not verify', 'signature_invalid');

  // 3) Consume — atomic update (still mark consumed even if a parallel request beat us;
  //    the where-clause guards against double-consume).
  const updated = db
    .update(nonces)
    .set({ consumedAt: Date.now() })
    .where(and(eq(nonces.nonce, args.nonce), isNull(nonces.consumedAt)))
    .run();
  if (updated.changes === 0) {
    throw new NonceVerifyError('Nonce already consumed (race)', 'nonce_consumed');
  }
}

/** Periodic janitor: removes expired-and-unconsumed nonces older than 24h. */
export function pruneStaleNonces(): number {
  const db = getDb();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const result = db.delete(nonces).where(and(lt(nonces.createdAt, cutoff), isNull(nonces.consumedAt))).run();
  return result.changes;
}
