import { describe, expect, it } from 'vitest';
import { bpsToApr, bpsToPercentString } from './bps.js';

describe('bps helpers', () => {
  it('bpsToApr divides by 10_000', () => {
    expect(bpsToApr(0)).toBe(0);
    expect(bpsToApr(100)).toBe(0.01);
    expect(bpsToApr(436)).toBeCloseTo(0.0436, 6);
  });

  it('bpsToPercentString formats as percent', () => {
    expect(bpsToPercentString(0)).toBe('0.00%');
    expect(bpsToPercentString(436)).toBe('4.36%');
    expect(bpsToPercentString(512, 1)).toBe('5.1%');
  });
});
