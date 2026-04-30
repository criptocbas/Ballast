/**
 * Jupiter Prediction API expresses prices and volumes in micro-USD (1 USD = 1_000_000).
 * These helpers convert between human-readable USD floats and the on-wire integers.
 *
 * DX-LOG-REF: Gap #3 — units are not labeled in API responses; we wrap them here.
 */

const MICRO_USD_PER_USD = 1_000_000n;

export type MicroUsd = bigint;

export function usdToMicro(usd: number): MicroUsd {
  if (!Number.isFinite(usd)) throw new Error('usdToMicro: non-finite input');
  return BigInt(Math.round(usd * 1_000_000));
}

export function microToUsd(micro: MicroUsd | string | number): number {
  const big = typeof micro === 'bigint' ? micro : BigInt(micro);
  // Two-step conversion preserves precision for values up to ~1e15 USD
  const whole = big / MICRO_USD_PER_USD;
  const frac = big % MICRO_USD_PER_USD;
  return Number(whole) + Number(frac) / 1_000_000;
}

export function formatUsd(micro: MicroUsd | string | number, fractionDigits = 2): string {
  const usd = microToUsd(micro);
  return usd.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}
