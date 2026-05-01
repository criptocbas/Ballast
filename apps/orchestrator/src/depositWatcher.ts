import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { recordDeposit } from './accountant.js';
import { USDC_MINT } from './lend.js';
import { getDb } from './db/index.js';
import { deposits } from './db/schema.js';
import { getSolanaConnection, getVaultWallet } from './wallet.js';
import { createLogger } from './logger.js';

/**
 * Auto-deposit-recovery watcher.
 *
 * Closes the most realistic operational failure mode for a Ballast-shaped
 * vault: a user signs an SPL transfer that lands on chain, but the
 * orchestrator is unreachable at the moment of confirmation (mid-restart,
 * network blip, browser tab closed). Without recovery, the user's funds are
 * stuck in the vault — they show $0 on /me even though the vault holds their
 * money. Manual admin tooling (`scripts/recordDeposit.ts`) was the v1 patch;
 * this is the v2 production primitive.
 *
 * What it does, every tick:
 *   1. Pulls the last N signatures involving the vault USDC ATA.
 *   2. Drops anything already in the `deposits` table (idempotent).
 *   3. Drops failures, inner-vault-flow, hedge claims (those flow in too but
 *      are recorded under different tables).
 *   4. Drops anything whose source authority is off-curve — that means a
 *      program-derived address (PDA), which is a Jupiter program returning
 *      yield or a hedge claim, NOT a user deposit.
 *   5. For everything left, parses the SPL transferChecked, extracts the
 *      depositor wallet + amount, runs recordDeposit (idempotent on the
 *      txSignature unique constraint).
 *
 * Schedule: invoked from the rebalance loop at the head of every tick, plus
 * a one-shot run at orchestrator boot so any deposits missed while the server
 * was down get caught immediately.
 */

const log = createLogger('deposit-watcher');

const USDC_DECIMALS = 6;
/** SPL Token Classic + Token-2022 program IDs. */
const SPL_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);

export interface RecoveredDeposit {
  signature: string;
  depositorWallet: string;
  amountUsdc: number;
  slot: number;
  blockTime: number | null;
}

export interface DepositWatcherResult {
  scanned: number;
  alreadyRecorded: number;
  skippedOutbound: number;
  skippedPda: number;
  skippedNoTransfer: number;
  skippedFailed: number;
  recovered: RecoveredDeposit[];
  errors: Array<{ signature: string; error: string }>;
}

export interface DepositWatcherOptions {
  /** How many recent signatures to scan. Default 50. */
  limit?: number;
  /** Don't actually record — just report what we'd do. */
  dryRun?: boolean;
}

interface ParsedSplTransfer {
  programId: string;
  parsed: {
    type: 'transfer' | 'transferChecked';
    info: {
      amount?: string;
      tokenAmount?: { amount: string; decimals: number };
      authority?: string;
      source?: string;
      destination?: string;
      mint?: string;
    };
  };
}

/**
 * Pure helper: given a parsed Solana transaction's instructions, find the
 * SPL transfer (top-level OR inner) whose destination is `vaultAta`. Returns
 * the parsed instruction or null. Exported for test coverage.
 */
export function findInboundTransferToVault(
  topInstructions: unknown[],
  innerInstructions: unknown[][],
  vaultAtaBase58: string,
): ParsedSplTransfer | null {
  const all = [...topInstructions, ...innerInstructions.flat()];
  for (const ix of all) {
    if (!isParsedSplTransfer(ix)) continue;
    if (ix.parsed.info.destination !== vaultAtaBase58) continue;
    return ix;
  }
  return null;
}

function isParsedSplTransfer(ix: unknown): ix is ParsedSplTransfer {
  if (!ix || typeof ix !== 'object') return false;
  const obj = ix as { programId?: { toBase58: () => string } | string; parsed?: unknown };
  let programIdStr: string | undefined;
  if (typeof obj.programId === 'string') {
    programIdStr = obj.programId;
  } else if (obj.programId && typeof obj.programId === 'object' && 'toBase58' in obj.programId) {
    programIdStr = obj.programId.toBase58();
  }
  if (!programIdStr || !SPL_PROGRAMS.has(programIdStr)) return false;
  if (!obj.parsed || typeof obj.parsed !== 'object') return false;
  const p = obj.parsed as { type?: unknown; info?: unknown };
  return (p.type === 'transfer' || p.type === 'transferChecked') && typeof p.info === 'object';
}

/**
 * Pure helper: classify the source authority of a parsed inbound transfer.
 *
 *   'user'     — on-curve pubkey, treat as a regular wallet → record as deposit
 *   'pda'      — off-curve pubkey, program-derived → skip (vault internal flow)
 *   'self'     — the vault wallet itself → skip (sanity, shouldn't happen on inbound)
 *   'invalid'  — authority missing or unparseable → skip
 *
 * Exported for test coverage.
 */
export function classifyAuthority(
  authorityBase58: string | undefined,
  vaultBase58: string,
): 'user' | 'pda' | 'self' | 'invalid' {
  if (!authorityBase58) return 'invalid';
  if (authorityBase58 === vaultBase58) return 'self';
  let key: PublicKey;
  try {
    key = new PublicKey(authorityBase58);
  } catch {
    return 'invalid';
  }
  return PublicKey.isOnCurve(key.toBytes()) ? 'user' : 'pda';
}

export function extractAmountUsdc(transfer: ParsedSplTransfer): number | null {
  const amountStr = transfer.parsed.info.tokenAmount?.amount ?? transfer.parsed.info.amount;
  if (!amountStr) return null;
  let big: bigint;
  try {
    big = BigInt(amountStr);
  } catch {
    return null;
  }
  return Number(big) / 10 ** USDC_DECIMALS;
}

export async function runDepositWatcher(
  options: DepositWatcherOptions = {},
): Promise<DepositWatcherResult> {
  const limit = options.limit ?? 50;
  const dryRun = options.dryRun ?? false;
  const wallet = getVaultWallet();
  const conn = getSolanaConnection();

  const vaultAta = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
  const vaultAtaStr = vaultAta.toBase58();

  // Pull recent signatures
  const sigs = await conn.getSignaturesForAddress(vaultAta, { limit });

  // Pre-compute the recorded set so we don't N+1 the DB per signature.
  const db = getDb();
  const recordedRows = db.select({ sig: deposits.txSignature }).from(deposits).all();
  const recorded = new Set(recordedRows.map((r) => r.sig));

  const result: DepositWatcherResult = {
    scanned: sigs.length,
    alreadyRecorded: 0,
    skippedOutbound: 0,
    skippedPda: 0,
    skippedNoTransfer: 0,
    skippedFailed: 0,
    recovered: [],
    errors: [],
  };

  for (const sigInfo of sigs) {
    if (sigInfo.err) {
      result.skippedFailed += 1;
      continue;
    }
    if (recorded.has(sigInfo.signature)) {
      result.alreadyRecorded += 1;
      continue;
    }

    let tx: Awaited<ReturnType<typeof conn.getParsedTransaction>>;
    try {
      tx = await conn.getParsedTransaction(sigInfo.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
    } catch (err) {
      result.errors.push({
        signature: sigInfo.signature,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!tx || tx.meta?.err) {
      result.skippedFailed += 1;
      continue;
    }

    const transfer = findInboundTransferToVault(
      tx.transaction.message.instructions,
      tx.meta?.innerInstructions?.map((g) => g.instructions) ?? [],
      vaultAtaStr,
    );
    if (!transfer) {
      result.skippedNoTransfer += 1;
      continue;
    }

    const authClass = classifyAuthority(transfer.parsed.info.authority, wallet.pubkeyBase58);
    if (authClass === 'self') {
      result.skippedOutbound += 1;
      continue;
    }
    if (authClass === 'pda' || authClass === 'invalid') {
      result.skippedPda += 1;
      continue;
    }

    // Mint check — don't record non-USDC transfers (defensive; vault ATA is USDC-specific)
    if (transfer.parsed.info.mint && transfer.parsed.info.mint !== USDC_MINT.toBase58()) {
      result.skippedNoTransfer += 1;
      continue;
    }

    const amountUsdc = extractAmountUsdc(transfer);
    if (amountUsdc === null || amountUsdc <= 0) {
      result.skippedNoTransfer += 1;
      continue;
    }

    const depositorWallet = transfer.parsed.info.authority as string;
    const recovered: RecoveredDeposit = {
      signature: sigInfo.signature,
      depositorWallet,
      amountUsdc,
      slot: tx.slot,
      blockTime: tx.blockTime ?? null,
    };

    if (dryRun) {
      result.recovered.push(recovered);
      continue;
    }

    try {
      recordDeposit({
        wallet: depositorWallet,
        amountUsdc,
        txSignature: sigInfo.signature,
        blockTime: tx.blockTime ?? null,
        slot: tx.slot,
      });
      log.info(
        { signature: sigInfo.signature, depositorWallet, amountUsdc },
        'Auto-recovered missed deposit',
      );
      result.recovered.push(recovered);
    } catch (err) {
      result.errors.push({
        signature: sigInfo.signature,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
