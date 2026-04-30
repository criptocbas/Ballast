'use client';

import dynamic from 'next/dynamic';

/**
 * The default `WalletMultiButton` from @solana/wallet-adapter-react-ui must be
 * loaded client-side only — it pokes at `window.crypto` at import time and would
 * blow up during SSR. We dynamic-import it with `ssr: false`.
 */
export const ConnectButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((m) => m.WalletMultiButton),
  { ssr: false },
);
