/**
 * Jupiter Lend Earn returns rates in basis points but doesn't label the units.
 *
 * DX-LOG-REF: Gap #6 — `supplyRate: 113` is not labeled as bps in the response.
 */

export function bpsToApr(bps: number): number {
  return bps / 10_000;
}

export function bpsToPercentString(bps: number, fractionDigits = 2): string {
  return `${(bps / 100).toFixed(fractionDigits)}%`;
}
