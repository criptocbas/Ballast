import { VersionedTransaction } from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import { getJupiterClients } from './jupiter.js';
import { getSolanaConnection, getVaultWallet } from './wallet.js';
import { getDb } from './db/index.js';
import { hedges as hedgesTable } from './db/schema.js';
import { createLogger } from './logger.js';

const log = createLogger('claimer');

/**
 * Ballast claim flow.
 *
 * Lifecycle of a hedge position:
 *   1. Open via openHedgeOrder (rebalance loop or manual)
 *   2. Live: pricing fluctuates, contracts unchanged
 *   3. Market closes → resolution → claimable: true on the matching side
 *   4. claim → POST /prediction/v1/positions/{pubkey}/claim → sign → submit
 *   5. Position record reflects claimed: true, payoutUsd shows USDC delivered to vault
 *   6. Distribution to depositors via SQLite share table happens on the next rebalance
 *      tick when the payout USDC lands in the vault wallet.
 *
 * Note (DX-LOG-REF: keeper auto-claim): Jupiter docs say keepers auto-claim claimable
 * positions within 24 hours. Our sweep is a "claim faster" optimization, not a
 * correctness requirement.
 */

export interface ClaimResult {
  positionPubkey: string;
  signature: string;
  payoutUsd: number;
  marketId: string;
}

export interface ClaimSweepResult {
  startedAt: number;
  finishedAt: number;
  claimable: number;
  claimed: ClaimResult[];
  errors: Array<{ positionPubkey: string; error: string }>;
}

/**
 * Claim a single resolved position. Returns the signature and payout in human dollars.
 */
export async function claimPosition(positionPubkey: string): Promise<ClaimResult> {
  const wallet = getVaultWallet();
  const conn = getSolanaConnection();
  const { prediction } = getJupiterClients();

  const claim = await prediction.claimPosition(positionPubkey, {
    ownerPubkey: wallet.pubkeyBase58,
  });

  const tx = VersionedTransaction.deserialize(Buffer.from(claim.transaction, 'base64'));

  const sim = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  if (sim.value.err) {
    throw new Error(
      `Claim simulation failed for ${positionPubkey}: ${JSON.stringify(sim.value.err)}\n` +
        `Logs:\n${(sim.value.logs ?? []).join('\n')}`,
    );
  }

  tx.sign([wallet.keypair]);
  const signature = await conn.sendRawTransaction(tx.serialize(), {
    maxRetries: 0,
    skipPreflight: true,
    preflightCommitment: 'confirmed',
  });
  await conn.confirmTransaction(
    {
      signature,
      blockhash: claim.blockhash,
      lastValidBlockHeight: claim.lastValidBlockHeight,
    },
    'confirmed',
  );

  const payoutUsd = Number(claim.position.payoutAmountUsd) / 1_000_000;

  // Mark our SQLite hedge row as claimed.
  try {
    getDb()
      .update(hedgesTable)
      .set({
        closedAt: Date.now(),
        resolvedOutcome: 'won',
        payoutUsd,
      })
      .where(eq(hedgesTable.positionPubkey, positionPubkey))
      .run();
  } catch (err) {
    log.warn({ err, positionPubkey }, 'Failed to update hedge row after claim (non-fatal)');
  }

  return {
    positionPubkey,
    signature,
    payoutUsd,
    marketId: '', // filled by sweep when caller has it; manual single-claim leaves blank
  };
}

/**
 * Sweep all claimable positions for the vault. Idempotent: skips already-claimed
 * positions and skips positions where claimable is false. Errors per position are
 * logged but don't abort the sweep.
 */
export async function runClaimSweep(): Promise<ClaimSweepResult> {
  const startedAt = Date.now();
  const wallet = getVaultWallet();
  const { prediction } = getJupiterClients();

  let claimable = 0;
  const claimed: ClaimResult[] = [];
  const errors: ClaimSweepResult['errors'] = [];

  let positions: Awaited<ReturnType<typeof prediction.listPositions>>;
  try {
    positions = await prediction.listPositions(wallet.pubkeyBase58);
  } catch (err) {
    log.error({ err }, 'Claim sweep: listPositions failed');
    return {
      startedAt,
      finishedAt: Date.now(),
      claimable: 0,
      claimed: [],
      errors: [
        {
          positionPubkey: '*',
          error: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  for (const p of positions.data) {
    // The list endpoint exposes the position as `pubkey` (DX-LOG-REF: Gap #19);
    // we expose both for consumers but use `pubkey` here since it's authoritative.
    if (!p.claimable || p.claimed) continue;
    claimable += 1;
    try {
      const result = await claimPosition(p.pubkey);
      result.marketId = p.marketId;
      claimed.push(result);
      log.info(
        {
          positionPubkey: p.pubkey,
          payoutUsd: result.payoutUsd,
          signature: result.signature,
        },
        'Claim succeeded',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ positionPubkey: p.pubkey, error: message.slice(0, 240) });
      log.warn({ positionPubkey: p.pubkey, err: message }, 'Claim failed');
    }
  }

  return {
    startedAt,
    finishedAt: Date.now(),
    claimable,
    claimed,
    errors,
  };
}
