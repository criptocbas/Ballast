import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ballast-distribution-'));
  process.env.DATABASE_URL = `file:${join(tmp, 'ballast.sqlite')}`;
});

beforeEach(async () => {
  const { getDb } = await import('./db/index.js');
  const { deposits, withdrawals, depositors, claimDistributions } = await import('./db/schema.js');
  const db = getDb();
  db.delete(claimDistributions).run();
  db.delete(deposits).run();
  db.delete(withdrawals).run();
  db.delete(depositors).run();
});

describe('distributeClaimPayout', () => {
  it('returns no allocations when there are no depositors', async () => {
    const { distributeClaimPayout } = await import('./accountant.js');
    const allocations = distributeClaimPayout({
      positionPubkey: 'POS-EMPTY',
      claimSignature: 'SIG-EMPTY',
      totalPayoutUsd: 100,
    });
    expect(allocations).toEqual([]);
  });

  it('returns no allocations when payout is zero', async () => {
    const { distributeClaimPayout, recordDeposit } = await import('./accountant.js');
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 'sA', blockTime: 1, slot: 1 });
    const allocations = distributeClaimPayout({
      positionPubkey: 'POS-ZERO',
      claimSignature: 'SIG-ZERO',
      totalPayoutUsd: 0,
    });
    expect(allocations).toEqual([]);
  });

  it('allocates 100% to a single depositor', async () => {
    const { distributeClaimPayout, recordDeposit, getDepositorClaimTotal } = await import(
      './accountant.js'
    );
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 'sA1', blockTime: 1, slot: 1 });
    const allocations = distributeClaimPayout({
      positionPubkey: 'POS-1',
      claimSignature: 'SIG-1',
      totalPayoutUsd: 50,
    });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]?.depositorWallet).toBe('wA');
    expect(allocations[0]?.shareFraction).toBeCloseTo(1, 6);
    expect(allocations[0]?.amountUsd).toBeCloseTo(50, 6);
    expect(getDepositorClaimTotal('wA')).toBeCloseTo(50, 6);
  });

  it('allocates pro-rata across two depositors', async () => {
    const { distributeClaimPayout, recordDeposit, getDepositorClaimTotal } = await import(
      './accountant.js'
    );
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 'sA1', blockTime: 1, slot: 1 });
    recordDeposit({ wallet: 'wB', amountUsdc: 300, txSignature: 'sB1', blockTime: 2, slot: 2 });
    const allocations = distributeClaimPayout({
      positionPubkey: 'POS-2',
      claimSignature: 'SIG-2',
      totalPayoutUsd: 100,
    });
    expect(allocations).toHaveLength(2);
    const byWallet = Object.fromEntries(allocations.map((a) => [a.depositorWallet, a]));
    expect(byWallet.wA?.amountUsd).toBeCloseTo(25, 6);
    expect(byWallet.wB?.amountUsd).toBeCloseTo(75, 6);
    // Persistence check
    expect(getDepositorClaimTotal('wA')).toBeCloseTo(25, 6);
    expect(getDepositorClaimTotal('wB')).toBeCloseTo(75, 6);
  });

  it('allocations sum to total payout (within rounding)', async () => {
    const { distributeClaimPayout, recordDeposit } = await import('./accountant.js');
    recordDeposit({ wallet: 'wA', amountUsdc: 33.33, txSignature: 's1', blockTime: 1, slot: 1 });
    recordDeposit({ wallet: 'wB', amountUsdc: 33.33, txSignature: 's2', blockTime: 2, slot: 2 });
    recordDeposit({ wallet: 'wC', amountUsdc: 33.34, txSignature: 's3', blockTime: 3, slot: 3 });
    const allocations = distributeClaimPayout({
      positionPubkey: 'POS-3',
      claimSignature: 'SIG-3',
      totalPayoutUsd: 17.42,
    });
    const sum = allocations.reduce((s, a) => s + a.amountUsd, 0);
    expect(sum).toBeCloseTo(17.42, 6);
  });

  it('share fractions are stable when distribute is called twice (allocations stack additively)', async () => {
    const { distributeClaimPayout, recordDeposit, getDepositorClaimTotal } = await import(
      './accountant.js'
    );
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 's1', blockTime: 1, slot: 1 });
    recordDeposit({ wallet: 'wB', amountUsdc: 100, txSignature: 's2', blockTime: 2, slot: 2 });
    distributeClaimPayout({
      positionPubkey: 'POS-A',
      claimSignature: 'SIG-A',
      totalPayoutUsd: 40,
    });
    distributeClaimPayout({
      positionPubkey: 'POS-B',
      claimSignature: 'SIG-B',
      totalPayoutUsd: 60,
    });
    expect(getDepositorClaimTotal('wA')).toBeCloseTo(50, 6);
    expect(getDepositorClaimTotal('wB')).toBeCloseTo(50, 6);
  });
});

describe('getDepositorNetBalance', () => {
  it('reports contributions only when no withdrawals or payouts', async () => {
    const { getDepositorNetBalance, recordDeposit } = await import('./accountant.js');
    recordDeposit({ wallet: 'wA', amountUsdc: 75, txSignature: 's1', blockTime: 1, slot: 1 });
    const balance = getDepositorNetBalance('wA');
    expect(balance.contributed).toBe(75);
    expect(balance.withdrawn).toBe(0);
    expect(balance.payouts).toBe(0);
    expect(balance.net).toBe(75);
  });

  it('subtracts pending withdrawals (status="pending" counts toward balance)', async () => {
    const { getDepositorNetBalance, recordDeposit, queueWithdrawal } = await import(
      './accountant.js'
    );
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 's1', blockTime: 1, slot: 1 });
    queueWithdrawal({ wallet: 'wA', amountUsdc: 30 });
    const balance = getDepositorNetBalance('wA');
    expect(balance.contributed).toBe(100);
    expect(balance.withdrawn).toBe(30);
    expect(balance.net).toBe(70);
  });

  it('does NOT subtract failed withdrawals (the bug DX-GAP-#28 fixed)', async () => {
    const { getDb } = await import('./db/index.js');
    const { withdrawals } = await import('./db/schema.js');
    const { getDepositorNetBalance, recordDeposit, queueWithdrawal } = await import(
      './accountant.js'
    );
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 's1', blockTime: 1, slot: 1 });
    // One successful withdrawal, one failed
    const ok = queueWithdrawal({ wallet: 'wA', amountUsdc: 20 });
    const failed = queueWithdrawal({ wallet: 'wA', amountUsdc: 50 });
    const { eq } = await import('drizzle-orm');
    getDb().update(withdrawals).set({ status: 'sent' }).where(eq(withdrawals.id, ok.id)).run();
    getDb().update(withdrawals).set({ status: 'failed' }).where(eq(withdrawals.id, failed.id)).run();
    const balance = getDepositorNetBalance('wA');
    // Only the $20 sent withdrawal should reduce balance; the $50 failed must not.
    expect(balance.withdrawn).toBe(20);
    expect(balance.net).toBe(80);
  });

  it('adds payout entitlements', async () => {
    const { getDepositorNetBalance, recordDeposit, distributeClaimPayout } = await import(
      './accountant.js'
    );
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 's1', blockTime: 1, slot: 1 });
    distributeClaimPayout({
      positionPubkey: 'POS-N',
      claimSignature: 'SIG-N',
      totalPayoutUsd: 25,
    });
    const balance = getDepositorNetBalance('wA');
    expect(balance.contributed).toBe(100);
    expect(balance.payouts).toBeCloseTo(25, 6);
    expect(balance.net).toBeCloseTo(125, 6);
  });
});

describe('getTotalNetBalance', () => {
  it('returns 0 for empty vault', async () => {
    const { getTotalNetBalance } = await import('./accountant.js');
    expect(getTotalNetBalance()).toBe(0);
  });

  it('sums (contributed - non-failed withdrawn + payouts) across all depositors', async () => {
    const { getDb } = await import('./db/index.js');
    const { withdrawals } = await import('./db/schema.js');
    const { eq } = await import('drizzle-orm');
    const {
      getTotalNetBalance,
      recordDeposit,
      queueWithdrawal,
      distributeClaimPayout,
    } = await import('./accountant.js');
    // Two depositors, one withdrew, one had a payout, one failed-withdrawal.
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 'sA', blockTime: 1, slot: 1 });
    recordDeposit({ wallet: 'wB', amountUsdc: 50, txSignature: 'sB', blockTime: 2, slot: 2 });
    queueWithdrawal({ wallet: 'wA', amountUsdc: 20 }); // pending — counts
    const failedRow = queueWithdrawal({ wallet: 'wB', amountUsdc: 30 });
    getDb()
      .update(withdrawals)
      .set({ status: 'failed' })
      .where(eq(withdrawals.id, failedRow.id))
      .run(); // failed — doesn't count
    distributeClaimPayout({
      positionPubkey: 'POS-T',
      claimSignature: 'SIG-T',
      totalPayoutUsd: 30,
    });
    // Total: $150 contributed - $20 (pending counts) + $30 payouts = $160
    expect(getTotalNetBalance()).toBeCloseTo(160, 6);
  });
});

describe('getDepositorWithdrawable', () => {
  it('clamps to redeemable when vault has less liquid than notional', async () => {
    const { getDepositorWithdrawable, recordDeposit } = await import('./accountant.js');
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 's1', blockTime: 1, slot: 1 });
    // Vault opened a $40 hedge → only $60 redeemable.
    const w = getDepositorWithdrawable({ wallet: 'wA', redeemableVaultUsdc: 60 });
    expect(w.notionalNet).toBe(100);
    expect(w.shareFraction).toBeCloseTo(1, 6);
    expect(w.shareOfRedeemable).toBeCloseTo(60, 6);
    expect(w.withdrawableNow).toBeCloseTo(60, 6);
    expect(w.hedgeLockedUsdc).toBeCloseTo(40, 6);
  });

  it('returns notional when vault is fully redeemable', async () => {
    const { getDepositorWithdrawable, recordDeposit } = await import('./accountant.js');
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 's1', blockTime: 1, slot: 1 });
    const w = getDepositorWithdrawable({ wallet: 'wA', redeemableVaultUsdc: 100 });
    expect(w.withdrawableNow).toBeCloseTo(100, 6);
    expect(w.hedgeLockedUsdc).toBe(0);
  });

  it('splits redeemable pro-rata across multi-depositor vaults using net (not gross) shares', async () => {
    const { getDepositorWithdrawable, recordDeposit } = await import('./accountant.js');
    // wA contributed $100, wB contributed $50. No withdrawals or payouts.
    // Vault redeemable = $90 (rest in hedges).
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 'sA', blockTime: 1, slot: 1 });
    recordDeposit({ wallet: 'wB', amountUsdc: 50, txSignature: 'sB', blockTime: 2, slot: 2 });
    const wA = getDepositorWithdrawable({ wallet: 'wA', redeemableVaultUsdc: 90 });
    const wB = getDepositorWithdrawable({ wallet: 'wB', redeemableVaultUsdc: 90 });
    expect(wA.shareFraction).toBeCloseTo(100 / 150, 6);
    expect(wB.shareFraction).toBeCloseTo(50 / 150, 6);
    expect(wA.withdrawableNow).toBeCloseTo(60, 4); // 100/150 × 90
    expect(wB.withdrawableNow).toBeCloseTo(30, 4); // 50/150 × 90
    // Sum of all withdrawable equals redeemable (no over-promise).
    expect(wA.withdrawableNow + wB.withdrawableNow).toBeCloseTo(90, 4);
  });

  it('returns zeros when wallet has no deposits', async () => {
    const { getDepositorWithdrawable, recordDeposit } = await import('./accountant.js');
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 's1', blockTime: 1, slot: 1 });
    const w = getDepositorWithdrawable({ wallet: 'someone-else', redeemableVaultUsdc: 50 });
    expect(w.notionalNet).toBe(0);
    expect(w.shareFraction).toBe(0);
    expect(w.withdrawableNow).toBe(0);
    expect(w.hedgeLockedUsdc).toBe(0);
  });

  it('returns zeros for an empty vault even if redeemable is positive', async () => {
    const { getDepositorWithdrawable } = await import('./accountant.js');
    const w = getDepositorWithdrawable({ wallet: 'wA', redeemableVaultUsdc: 100 });
    expect(w.shareFraction).toBe(0);
    expect(w.withdrawableNow).toBe(0);
  });

  it('reflects payouts in the share fraction (resolution increases withdrawable)', async () => {
    const { distributeClaimPayout, getDepositorWithdrawable, recordDeposit } = await import(
      './accountant.js'
    );
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 's1', blockTime: 1, slot: 1 });
    // After hedge resolved YES, vault got $30 payout, now sitting in wallet.
    distributeClaimPayout({
      positionPubkey: 'POS-Y',
      claimSignature: 'SIG-Y',
      totalPayoutUsd: 30,
    });
    // wA's notional grew to $130; vault redeemable = $130 (initial $100 - hedge cost + $30 payout, simplified for the test).
    const w = getDepositorWithdrawable({ wallet: 'wA', redeemableVaultUsdc: 130 });
    expect(w.notionalNet).toBeCloseTo(130, 6);
    expect(w.withdrawableNow).toBeCloseTo(130, 6);
  });
});

import { afterEach } from 'vitest';

afterEach(() => {
  // No-op: state cleared by beforeEach
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});
