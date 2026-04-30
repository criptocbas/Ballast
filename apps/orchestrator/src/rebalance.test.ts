import { describe, expect, it } from 'vitest';
import { loadBasket } from './rebalance.js';

describe('rebalance basket config', () => {
  it('loads, validates, and weights sum to ~1.0', () => {
    const basket = loadBasket();
    expect(basket.markets.length).toBeGreaterThan(0);
    expect(basket.minOrderSizeUsd).toBeGreaterThan(0);
    const total = basket.markets.reduce((s, m) => s + m.weight, 0);
    // Allow tiny floating drift.
    expect(total).toBeGreaterThan(0.99);
    expect(total).toBeLessThan(1.01);
  });

  it('every market has a weight in [0, 1] and a non-empty marketId', () => {
    const basket = loadBasket();
    for (const m of basket.markets) {
      expect(m.weight).toBeGreaterThanOrEqual(0);
      expect(m.weight).toBeLessThanOrEqual(1);
      expect(m.marketId.length).toBeGreaterThan(3);
    }
  });
});
