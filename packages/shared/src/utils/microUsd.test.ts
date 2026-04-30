import { describe, expect, it } from 'vitest';
import { formatUsd, microToUsd, usdToMicro } from './microUsd.js';

describe('microUsd helpers', () => {
  it('round-trips usd -> micro -> usd', () => {
    expect(microToUsd(usdToMicro(0.875))).toBeCloseTo(0.875, 6);
    expect(microToUsd(usdToMicro(1234.5678))).toBeCloseTo(1234.5678, 4);
  });

  it('handles zero and large values', () => {
    expect(microToUsd(0n)).toBe(0);
    expect(microToUsd(1_000_000n)).toBe(1);
    expect(microToUsd('414443424494446')).toBeCloseTo(414_443_424.494446, 4);
  });

  it('formatUsd renders en-US currency', () => {
    expect(formatUsd(1_500_000n)).toBe('$1.50');
    expect(formatUsd('1234567890')).toBe('$1,234.57');
  });

  it('rejects non-finite usd input', () => {
    expect(() => usdToMicro(Number.NaN)).toThrow();
    expect(() => usdToMicro(Infinity)).toThrow();
  });
});
