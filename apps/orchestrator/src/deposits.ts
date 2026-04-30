import { PublicKey } from '@solana/web3.js';
import { getSolanaConnection, getVaultWallet } from './wallet.js';
import { USDC_MINT } from './lend.js';

/**
 * Deposit confirmation — verifies that an end-user's USDC transfer to the vault landed
 * on-chain, matched the claimed amount, and originated from the claimed wallet. Once
 * verified, callers can record the deposit (in v1.5 that means SQLite share accounting).
 *
 * For v1, we just verify and return; the share table comes online with task #14.
 */

export class DepositVerifyError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'tx_not_found'
      | 'tx_failed'
      | 'transfer_not_found'
      | 'wrong_recipient'
      | 'wrong_sender'
      | 'wrong_amount'
      | 'wrong_mint',
  ) {
    super(message);
    this.name = 'DepositVerifyError';
  }
}

export interface VerifyDepositArgs {
  signature: string;
  depositorPubkey: string;
  /** Expected amount in human USDC dollars (we convert to base units internally). */
  amount: number;
}

export interface VerifyDepositResult {
  signature: string;
  slot: number;
  blockTime: number | null;
  depositorPubkey: string;
  amountUsdc: number;
  vaultAddress: string;
}

const USDC_DECIMALS = 6;

/**
 * Pull the parsed transaction for the supplied signature, walk its instructions,
 * and confirm it contains an SPL transfer of `amount` USDC from `depositorPubkey`
 * to the vault's USDC ATA.
 */
export async function verifyDeposit(args: VerifyDepositArgs): Promise<VerifyDepositResult> {
  const conn = getSolanaConnection();
  const vault = getVaultWallet();

  const tx = await conn.getParsedTransaction(args.signature, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });
  if (!tx) {
    throw new DepositVerifyError('Transaction not found yet — may still be propagating', 'tx_not_found');
  }
  if (tx.meta?.err) {
    throw new DepositVerifyError(
      `Transaction failed on-chain: ${JSON.stringify(tx.meta.err)}`,
      'tx_failed',
    );
  }

  // Walk all instructions (top-level + inner) looking for an SPL transfer that matches.
  const allInstructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions?.flatMap((g) => g.instructions) ?? []),
  ];

  type ParsedSplTransfer = {
    programId: PublicKey;
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
  };

  const splPrograms = new Set([
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  ]);

  const transfers: ParsedSplTransfer[] = [];
  for (const ix of allInstructions) {
    if (!('parsed' in ix)) continue;
    const programId = ix.programId.toBase58();
    if (!splPrograms.has(programId)) continue;
    const p = ix.parsed as ParsedSplTransfer['parsed'];
    if (p?.type === 'transfer' || p?.type === 'transferChecked') {
      transfers.push({
        programId: new PublicKey(programId),
        parsed: p,
      });
    }
  }

  if (transfers.length === 0) {
    throw new DepositVerifyError(
      'Transaction contains no SPL transfer instructions',
      'transfer_not_found',
    );
  }

  // Vault USDC ATA. Compute deterministically rather than fetching account state.
  const { getAssociatedTokenAddress } = await import('@solana/spl-token');
  const vaultAta = await getAssociatedTokenAddress(USDC_MINT, vault.publicKey);
  const expectedBaseUnits = BigInt(Math.round(args.amount * 10 ** USDC_DECIMALS));
  const depositorKey = new PublicKey(args.depositorPubkey);

  // Find a transfer whose destination is the vault's USDC ATA.
  // We can't strongly verify the sender because the parsed instruction's `source`
  // is the source ATA (not the wallet pubkey). But the `authority` field on transfers
  // is the signer, which IS the wallet pubkey for direct user transfers — so we use
  // that for sender-attribution.
  let match: ParsedSplTransfer | undefined;
  for (const t of transfers) {
    if (t.parsed.info.destination !== vaultAta.toBase58()) continue;
    // Mint check (transferChecked includes it inline; transfer doesn't, but if it did go to
    // the vault's USDC ATA, the mint is implied)
    if (t.parsed.info.mint && t.parsed.info.mint !== USDC_MINT.toBase58()) continue;
    match = t;
    break;
  }

  if (!match) {
    throw new DepositVerifyError(
      `No SPL transfer to vault USDC ATA (${vaultAta.toBase58()}) found in transaction`,
      'wrong_recipient',
    );
  }

  // Verify amount.
  const actualAmountStr =
    match.parsed.info.tokenAmount?.amount ?? match.parsed.info.amount ?? '0';
  const actualBaseUnits = BigInt(actualAmountStr);
  if (actualBaseUnits !== expectedBaseUnits) {
    throw new DepositVerifyError(
      `Amount mismatch: claimed ${expectedBaseUnits} base units, on-chain transferred ${actualBaseUnits}`,
      'wrong_amount',
    );
  }

  // Verify the authority (signer) matches the depositor pubkey when available.
  if (
    match.parsed.info.authority &&
    match.parsed.info.authority !== depositorKey.toBase58()
  ) {
    throw new DepositVerifyError(
      `Authority mismatch: claimed depositor ${depositorKey.toBase58()}, on-chain authority ${match.parsed.info.authority}`,
      'wrong_sender',
    );
  }

  return {
    signature: args.signature,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    depositorPubkey: args.depositorPubkey,
    amountUsdc: args.amount,
    vaultAddress: vault.pubkeyBase58,
  };
}
