import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Share-math tests. Each test runs against a fresh temp SQLite so they don't pollute
 * the dev orchestrator's reflux.sqlite.
 *
 * We point DATABASE_URL at an absolute file path before importing the modules under test
 * so getDb() picks it up.
 */

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ballast-test-'));
  process.env.DATABASE_URL = `file:${join(tmp, 'reflux.sqlite')}`;
});

afterEach(() => {
  // Clear tables between tests for isolation.
  // (We avoid recreating the temp dir to keep migrations cached.)
});

beforeEach(async () => {
  const { getDb } = await import('./db/index.js');
  const { deposits, withdrawals, depositors } = await import('./db/schema.js');
  const db = getDb();
  db.delete(deposits).run();
  db.delete(withdrawals).run();
  db.delete(depositors).run();
});

describe('accountant', () => {
  it('records a first deposit and reports correct totals', async () => {
    const { recordDeposit, getTotalContributed, getDepositorTotal } = await import('./accountant.js');
    const result = recordDeposit({
      wallet: 'wA',
      amountUsdc: 100,
      txSignature: 'sigA1',
      blockTime: 1,
      slot: 100,
    });
    expect(result.inserted).toBe(true);
    expect(result.firstDeposit).toBe(true);
    expect(getDepositorTotal('wA')).toBe(100);
    expect(getTotalContributed()).toBe(100);
  });

  it('is idempotent on duplicate signature', async () => {
    const { recordDeposit, getTotalContributed } = await import('./accountant.js');
    recordDeposit({ wallet: 'wA', amountUsdc: 50, txSignature: 'sigDup', blockTime: 1, slot: 1 });
    const second = recordDeposit({
      wallet: 'wA',
      amountUsdc: 50,
      txSignature: 'sigDup',
      blockTime: 1,
      slot: 1,
    });
    expect(second.inserted).toBe(false);
    expect(getTotalContributed()).toBe(50);
  });

  it('computes pro-rata share fractions correctly across multiple depositors', async () => {
    const {
      recordDeposit,
      getDepositorShareFraction,
      getTotalContributed,
    } = await import('./accountant.js');
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 's1', blockTime: 1, slot: 1 });
    recordDeposit({ wallet: 'wB', amountUsdc: 300, txSignature: 's2', blockTime: 2, slot: 2 });
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 's3', blockTime: 3, slot: 3 });
    expect(getTotalContributed()).toBe(500);
    expect(getDepositorShareFraction('wA')).toBeCloseTo(200 / 500, 6);
    expect(getDepositorShareFraction('wB')).toBeCloseTo(300 / 500, 6);
  });

  it('share fraction is 0 for unknown wallets and empty vault', async () => {
    const { getDepositorShareFraction } = await import('./accountant.js');
    expect(getDepositorShareFraction('nobody')).toBe(0);
  });

  it('queueWithdrawal returns an id and rows show pending status', async () => {
    const { recordDeposit, queueWithdrawal } = await import('./accountant.js');
    const { getDb } = await import('./db/index.js');
    const { withdrawals } = await import('./db/schema.js');
    recordDeposit({ wallet: 'wA', amountUsdc: 100, txSignature: 's1', blockTime: 1, slot: 1 });
    const { id } = queueWithdrawal({ wallet: 'wA', amountUsdc: 25 });
    expect(id).toBeGreaterThan(0);
    const rows = getDb().select().from(withdrawals).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.amountUsdc).toBe(25);
  });
});

afterEach(() => {
  // No-op: state cleanup happens in beforeEach.
});

import { afterAll } from 'vitest';
afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});
