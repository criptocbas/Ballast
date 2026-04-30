import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ballast-distribution-'));
  process.env.DATABASE_URL = `file:${join(tmp, 'reflux.sqlite')}`;
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

  it('subtracts withdrawals (status irrelevant — queueWithdrawal counts toward balance)', async () => {
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

import { afterEach } from 'vitest';

afterEach(() => {
  // No-op: state cleared by beforeEach
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});
