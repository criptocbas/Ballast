/**
 * Diagnostic: prints SOL + token balances for the vault wallet.
 *
 *   pnpm --filter @reflux/orchestrator exec tsx src/scripts/checkVaultBalance.ts
 */
import { PublicKey } from '@solana/web3.js';
import { getSolanaConnection, getVaultWallet } from '../wallet.js';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

async function main(): Promise<void> {
  const wallet = getVaultWallet();
  const conn = getSolanaConnection();

  const lamports = await conn.getBalance(wallet.publicKey);

  // Inspect SPL token holdings owned by the vault wallet.
  const tokenAccounts = await conn.getParsedTokenAccountsByOwner(wallet.publicKey, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  });

  const balances: Record<string, { mint: string; uiAmount: number }> = {};
  for (const acct of tokenAccounts.value) {
    const info = acct.account.data.parsed.info as {
      mint: string;
      tokenAmount: { uiAmount: number | null; decimals: number };
    };
    const ui = info.tokenAmount.uiAmount;
    if (ui && ui > 0) {
      let label = info.mint;
      if (info.mint === USDC_MINT.toBase58()) label = 'USDC';
      else if (info.mint === USDT_MINT.toBase58()) label = 'USDT';
      balances[label] = { mint: info.mint, uiAmount: ui };
    }
  }

  console.log('Vault address    :', wallet.pubkeyBase58);
  console.log('SOL balance      :', (lamports / 1_000_000_000).toFixed(6), 'SOL');
  if (Object.keys(balances).length === 0) {
    console.log('Token balances   : (none)');
  } else {
    console.log('Token balances   :');
    for (const [label, b] of Object.entries(balances)) {
      console.log(`  ${label.padEnd(8)} ${b.uiAmount.toString().padStart(15)}`);
    }
  }
}

main().catch((err: unknown) => {
  if (err instanceof Error) console.error('Error:', err.message);
  else console.error('Error:', err);
  process.exit(1);
});
