import {
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type Keypair,
  type PublicKey,
  type TransactionInstruction,
} from '@solana/web3.js';
import { createLogger } from './logger.js';

/**
 * Build → simulate → sign → send → confirm a V0 transaction with a Solana-correct
 * blockhash retry policy.
 *
 * Why retry: on mainnet, blockhash freshness is the dominant cause of "the tx
 * was sent but the confirm timed out" — the cluster moves past the
 * `lastValidBlockHeight` faster than a slow RPC can confirm. Solana's
 * recommended fix is to refresh the blockhash and re-send. Instructions are
 * independent of blockhash, so we can reuse `ixs` across attempts.
 *
 * Caller contract:
 *   - The instructions must be order-independent of the blockhash (true for
 *     all SPL transfer / Lend deposit/withdraw / SOL transfer instructions).
 *   - The signer keypair must be the only signer; if a different signer set is
 *     required, build the tx manually and call `confirmTransaction` directly.
 *
 * NOT for use with Jupiter-supplied transactions (Prediction order create,
 * claim) — those embed a Jupiter-issued blockhash + lastValidBlockHeight in
 * the response and re-signing under a fresh blockhash invalidates Jupiter's
 * keeper assumption. Those paths use the Jupiter-supplied blockhash directly.
 */
export interface SendV0Args {
  conn: Connection;
  signer: Keypair;
  payer: PublicKey;
  ixs: TransactionInstruction[];
  /** Skip the actual send + confirm — used by `--dry-run` flows. */
  simulateOnly?: boolean;
  /** Default 2 (initial attempt + 1 retry on blockhash expiry). */
  maxAttempts?: number;
}

const log = createLogger('tx');

/**
 * Recognise the family of errors that Solana raises when the cluster has moved
 * past `lastValidBlockHeight` before our tx confirmed. The error class isn't
 * always exposed (depends on web3.js version + RPC error shape), so we match on
 * message + name with a permissive set of patterns.
 */
function isBlockhashExpired(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: string }).name ?? '';
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
  return (
    name === 'TransactionExpiredBlockheightExceededError' ||
    name === 'TransactionExpiredTimeoutError' ||
    /block ?height exceeded/i.test(message) ||
    /blockhash not found/i.test(message) ||
    /transaction was not confirmed/i.test(message)
  );
}

export async function buildSimSignSendConfirmV0(args: SendV0Args): Promise<string> {
  const { conn, signer, payer, ixs, simulateOnly } = args;
  const maxAttempts = Math.max(1, args.maxAttempts ?? 2);

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const latest = await conn.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: latest.blockhash,
      instructions: ixs,
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);

    // Simulate every attempt — if instruction state has shifted between attempts
    // (e.g. an account closed, balance moved) we want the second simulation to
    // catch it rather than burn fees on a doomed send.
    const sim = await conn.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });
    if (sim.value.err) {
      throw new Error(
        `Transaction simulation failed: ${JSON.stringify(sim.value.err)}\nLogs:\n${(sim.value.logs ?? []).join('\n')}`,
      );
    }

    if (simulateOnly) {
      return '(simulated)';
    }

    tx.sign([signer]);
    try {
      const signature = await conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: 'confirmed',
      });
      await conn.confirmTransaction(
        {
          signature,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        'confirmed',
      );
      return signature;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && isBlockhashExpired(err)) {
        log.warn(
          {
            attempt,
            err: err instanceof Error ? err.message : String(err),
          },
          'Blockhash expired during confirm — refreshing and retrying',
        );
        continue;
      }
      throw err;
    }
  }
  // Unreachable in practice — the loop either returns a signature or throws.
  throw lastError ?? new Error('buildSimSignSendConfirmV0: no attempts ran');
}
