'use client';

import { useCallback, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { ExternalLink } from './ExternalLink';
import { buildCanonicalMessage, requestNonce, type NoncePurpose } from '@/lib/auth';

interface WithdrawFormProps {
  orchestratorUrl: string;
  /**
   * Honest cap on this withdrawal — `withdrawableNow` from the depositor view.
   * This is `min(notionalNet, shareOfRedeemable)`, NOT raw notional, so the
   * UI never offers a withdrawal the vault would reject at simulation. The
   * gap between this and notional is hedge-locked capital — see DX-GAP-#28.
   */
  maxUsdc: number;
  onSettled?: () => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'authenticating' }
  | { kind: 'submitting' }
  | { kind: 'success'; status: 'sent' | 'pending'; signature?: string; reason?: string }
  | { kind: 'error'; message: string };

export function WithdrawForm({ orchestratorUrl, maxUsdc, onSettled }: WithdrawFormProps) {
  const { publicKey, signMessage } = useWallet();
  const [amount, setAmount] = useState<string>('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const numericAmount = Number(amount);
  const validAmount =
    Number.isFinite(numericAmount) && numericAmount > 0 && numericAmount <= maxUsdc;

  const submit = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setPhase({
        kind: 'error',
        message: 'Wallet not connected or does not support sign-message.',
      });
      return;
    }
    if (!validAmount) return;
    setPhase({ kind: 'authenticating' });
    try {
      const purpose: NoncePurpose = 'withdraw-request';
      const { nonce } = await requestNonce(orchestratorUrl, {
        wallet: publicKey.toBase58(),
        purpose,
      });
      const message = buildCanonicalMessage({
        purpose,
        nonce,
        bindings: { amount: numericAmount.toFixed(6) },
      });
      const signedProof = bs58.encode(await signMessage(new TextEncoder().encode(message)));

      setPhase({ kind: 'submitting' });
      const res = await fetch(`${orchestratorUrl}/api/withdrawals/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey.toBase58(),
          amount: numericAmount,
          nonce,
          signedProof,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body.slice(0, 240));
      }
      const result = (await res.json()) as {
        status: 'sent' | 'pending';
        signature?: string;
        reason?: string;
      };
      const successPayload: Phase = {
        kind: 'success',
        status: result.status,
        ...(result.signature ? { signature: result.signature } : {}),
        ...(result.reason ? { reason: result.reason } : {}),
      };
      setPhase(successPayload);
      onSettled?.();
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }, [publicKey, signMessage, validAmount, numericAmount, orchestratorUrl, onSettled]);

  const disabled =
    !validAmount ||
    phase.kind === 'authenticating' ||
    phase.kind === 'submitting' ||
    !publicKey;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      <label className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">
          Withdraw amount (USDC)
        </span>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 focus-within:border-[var(--border-strong)]">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            max={maxUsdc}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Up to $${maxUsdc.toFixed(4)}`}
            className="w-full bg-transparent font-mono tabular-nums text-lg text-fg outline-none placeholder:text-[var(--fg-muted)]"
          />
          <span className="text-sm text-[var(--fg-dim)]">USDC</span>
        </div>
      </label>
      <div className="flex items-center justify-between text-xs text-[var(--fg-muted)]">
        <span>Capped at the vault&apos;s redeemable share for your wallet.</span>
        <button
          type="button"
          onClick={() => setAmount(String(Math.max(0, maxUsdc)))}
          className="font-mono tabular-nums hover:text-fg transition-colors"
        >
          Max: ${maxUsdc.toFixed(4)}
        </button>
      </div>
      <button
        type="submit"
        disabled={disabled}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elev)] px-5 text-sm font-medium text-fg hover:bg-[var(--bg-elev-2)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {phase.kind === 'authenticating' && 'Signing proof…'}
        {phase.kind === 'submitting' && 'Submitting…'}
        {phase.kind !== 'authenticating' &&
          phase.kind !== 'submitting' &&
          (validAmount ? `Withdraw $${numericAmount.toFixed(2)} USDC` : 'Enter amount')}
      </button>

      {phase.kind === 'success' && phase.status === 'sent' && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-200">
          <span className="font-medium text-fg">Withdrawal settled.</span>{' '}
          {phase.signature && (
            <ExternalLink href={`https://solscan.io/tx/${phase.signature}`} className="inline">
              View on Solscan
            </ExternalLink>
          )}
        </div>
      )}
      {phase.kind === 'success' && phase.status === 'pending' && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">
          <span className="font-medium text-fg">Withdrawal queued.</span>{' '}
          Will settle on the next rebalance tick.{' '}
          {phase.reason && (
            <span className="text-[var(--fg-dim)]">({phase.reason})</span>
          )}
        </div>
      )}
      {phase.kind === 'error' && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-200">
          <span className="font-medium text-fg">Withdrawal failed.</span>{' '}
          <span className="text-[var(--fg-dim)]">{phase.message}</span>
        </div>
      )}
    </form>
  );
}
