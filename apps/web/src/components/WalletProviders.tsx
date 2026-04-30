'use client';

import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';

import '@solana/wallet-adapter-react-ui/styles.css';

interface WalletProvidersProps {
  children: React.ReactNode;
}

/**
 * Solana wallet plumbing. Mounted near the root so any client component can call
 * `useWallet()` / `useConnection()`.
 *
 * Wallet Standard discovery picks up Phantom, Solflare, Backpack, Glow, and any
 * other browser-injected wallet, so we don't pass an explicit adapter list here.
 */
export function WalletProviders({ children }: WalletProvidersProps) {
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
