'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { ConnectButton } from './ConnectButton';
import { ExternalLink } from './ExternalLink';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;
const MIN_DEPOSIT_USDC = 1;

interface DepositFormProps {
  vaultAddress: string;
  orchestratorUrl: string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'confirming'; signature: string }
  | { kind: 'recording'; signature: string }
  | { kind: 'success'; signature: string }
  | { kind: 'error'; message: string; signature?: string };

export function DepositForm({ vaultAddress, orchestratorUrl }: DepositFormProps) {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const [amount, setAmount] = useState<string>('5');
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  // Refresh USDC balance when wallet connects.
  useEffect(() => {
    if (!publicKey) {
      setUsdcBalance(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ata = await getAssociatedTokenAddress(USDC_MINT, publicKey);
        const account = await getAccount(connection, ata);
        if (!cancelled) {
          setUsdcBalance(Number(account.amount) / 10 ** USDC_DECIMALS);
        }
      } catch {
        if (!cancelled) setUsdcBalance(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey, connection]);

  const numericAmount = Number(amount);
  const validAmount =
    Number.isFinite(numericAmount) &&
    numericAmount >= MIN_DEPOSIT_USDC &&
    (usdcBalance === null || numericAmount <= usdcBalance);

  const submit = useCallback(async () => {
    if (!publicKey || !validAmount) return;
    setPhase({ kind: 'sending' });
    try {
      const vaultPubkey = new PublicKey(vaultAddress);
      const fromAta = await getAssociatedTokenAddress(USDC_MINT, publicKey);
      const toAta = await getAssociatedTokenAddress(USDC_MINT, vaultPubkey);

      const tx = new Transaction();

      // Create the vault's USDC ATA if it doesn't exist yet (rare — vault was funded by us
      // earlier, so its ATA exists — but we keep this branch for first-time vaults).
      try {
        await getAccount(connection, toAta);
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(publicKey, toAta, vaultPubkey, USDC_MINT),
        );
      }

      const amountBase = BigInt(Math.round(numericAmount * 10 ** USDC_DECIMALS));
      tx.add(
        createTransferCheckedInstruction(
          fromAta,
          USDC_MINT,
          toAta,
          publicKey,
          amountBase,
          USDC_DECIMALS,
        ),
      );

      const latest = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = latest.blockhash;
      tx.feePayer = publicKey;

      const signature = await sendTransaction(tx, connection);
      setPhase({ kind: 'confirming', signature });

      await connection.confirmTransaction(
        {
          signature,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        'confirmed',
      );

      setPhase({ kind: 'recording', signature });
      const res = await fetch(`${orchestratorUrl}/api/deposits/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature,
          depositorPubkey: publicKey.toBase58(),
          amount: numericAmount,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Orchestrator confirm failed (${res.status}): ${body.slice(0, 240)}`);
      }

      setPhase({ kind: 'success', signature });
      // Refresh balance for a clean follow-up deposit
      try {
        const account = await getAccount(connection, fromAta);
        setUsdcBalance(Number(account.amount) / 10 ** USDC_DECIMALS);
      } catch {
        // ignore
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';
      setPhase((prev) => ({
        kind: 'error',
        message,
        signature: prev.kind === 'confirming' || prev.kind === 'recording' ? prev.signature : undefined,
      }));
    }
  }, [publicKey, validAmount, vaultAddress, connection, sendTransaction, numericAmount, orchestratorUrl]);

  return (
    <div className="card p-6">
      {!connected ? (
        <div className="flex flex-col items-start gap-4">
          <div>
            <h3 className="text-base font-semibold text-fg">Connect a wallet</h3>
            <p className="mt-1 text-sm text-[var(--fg-dim)]">
              Phantom, Solflare, Backpack, Glow — anything compatible with the Solana Wallet
              Standard.
            </p>
          </div>
          <ConnectButton />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-5"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">
                Connected
              </span>
              <span className="font-mono text-sm text-fg">
                {publicKey ? short(publicKey.toBase58()) : '—'}
              </span>
            </div>
            <ConnectButton />
          </div>

          <div className="grid gap-3">
            <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">
                Deposit amount (USDC)
              </span>
              <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 focus-within:border-[var(--border-strong)]">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={MIN_DEPOSIT_USDC}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-transparent font-mono tabular-nums text-lg text-fg outline-none placeholder:text-[var(--fg-muted)]"
                />
                <span className="text-sm text-[var(--fg-dim)]">USDC</span>
              </div>
            </label>
            <div className="flex items-center justify-between text-xs text-[var(--fg-muted)]">
              <span>Min ${MIN_DEPOSIT_USDC.toFixed(2)}</span>
              {usdcBalance !== null && (
                <button
                  type="button"
                  onClick={() => setAmount(String(Math.max(0, usdcBalance)))}
                  className="font-mono tabular-nums hover:text-fg transition-colors"
                >
                  Balance: ${usdcBalance.toFixed(4)} (use max)
                </button>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={
              !validAmount ||
              phase.kind === 'sending' ||
              phase.kind === 'confirming' ||
              phase.kind === 'recording'
            }
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-5 text-sm font-medium text-white hover:bg-[var(--accent-bright)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phaseLabel(phase, numericAmount)}
          </button>

          {phase.kind === 'success' && (
            <Banner tone="positive">
              <span className="font-medium text-fg">Deposit confirmed.</span>{' '}
              <ExternalLink href={`https://solscan.io/tx/${phase.signature}`} className="inline">
                View on Solscan
              </ExternalLink>
              <span className="text-[var(--fg-dim)]">
                {' '}
                · The orchestrator will route your share into Lend Earn on the next rebalance.
              </span>
            </Banner>
          )}
          {phase.kind === 'error' && (
            <Banner tone="danger">
              <span className="font-medium text-fg">Couldn&apos;t complete the deposit.</span>{' '}
              <span className="text-[var(--fg-dim)]">{phase.message}</span>
              {phase.signature && (
                <>
                  {' '}
                  ·{' '}
                  <ExternalLink
                    href={`https://solscan.io/tx/${phase.signature}`}
                    className="inline"
                  >
                    Tx
                  </ExternalLink>
                </>
              )}
            </Banner>
          )}
        </form>
      )}
    </div>
  );
}

function phaseLabel(phase: Phase, amount: number): string {
  switch (phase.kind) {
    case 'idle':
      return Number.isFinite(amount) && amount > 0
        ? `Deposit $${amount.toFixed(2)} USDC`
        : 'Enter amount';
    case 'sending':
      return 'Awaiting wallet signature…';
    case 'confirming':
      return 'Confirming on Solana…';
    case 'recording':
      return 'Recording with orchestrator…';
    case 'success':
      return 'Deposit another';
    case 'error':
      return 'Try again';
  }
}

function Banner({
  tone,
  children,
}: {
  tone: 'positive' | 'danger';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'positive'
      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
      : 'border-rose-500/30 bg-rose-500/5 text-rose-200';
  return (
    <div className={`rounded-lg border p-3 text-sm ${cls}`}>{children}</div>
  );
}

function short(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}
