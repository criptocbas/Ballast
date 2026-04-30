/**
 * One-off utility: prints the vault public key from .env.
 *
 *   pnpm --filter @reflux/orchestrator exec tsx src/scripts/derivePubkey.ts
 */
import { getVaultWallet } from '../wallet.js';

const wallet = getVaultWallet();
process.stdout.write(`${wallet.pubkeyBase58}\n`);
