# DX Log — 04 — Rebalance economics + small-TVL floor

Notes captured while wiring the rebalance loop and running its first dry-runs
against the live vault state.

## Composite economics finding

When the vault holds $2 of free USDC and the configured `HEDGE_BUDGET_FRACTION`
is `0.5`, the rebalance tick allocates **$1** to hedges spread across a
five-market basket with weights summing to 1.0. The largest single allocation
is `0.35 × $1 = $0.35` — far below Jupiter Prediction's $5 minimum order size
(captured separately as DX-GAP-#18).

In practice, this means Reflux's rebalance loop is a no-op until either:

1. The vault's free USDC × HEDGE_BUDGET_FRACTION × top_basket_weight ≥ $5, OR
2. We collapse the basket to a single market temporarily so the allocation
   exceeds $5 (a regression vs the diversification-by-design model)

For our basket of 5 markets with the heaviest at 35% weight, that means the
**vault needs at least `$5 / 0.35 / 0.5 ≈ $28.57 of free USDC** for the loop
to place even its largest hedge. The smallest weighted market (10%) needs
`$5 / 0.10 / 0.5 = $100` of free USDC.

## DX-GAP-#24 — $5 minimum compounds badly at small TVL

The combination of the per-order minimum and a diversified basket creates
a floor below which the orchestrator simply can't operate. For Reflux
specifically — a vault that scales hedge size with **yield**, not principal
— this is severe. At a 5% APY on $1,000 of principal, the vault generates
~$0.14/day in yield. Even with monthly rebalances ($4.20/mo), the loop is
stuck below the floor unless principal is $10k+ or rebalance cadence is
quarterly+.

**Severity for Reflux:** high. This is a structural product economics
issue, not a bug.

**Severity for Jupiter:** medium. The minimum protects market quality at
high-volume trading sizes but blocks vault products that operate at
sub-$10 hedge granularity.

**Suggested fixes (Jupiter-side):**
- Lower the minimum to $1 with a per-market metadata flag (`micro_orders_supported`)
- Or: introduce a "vault tier" with batched-order execution (5 small orders aggregated into one keeper match)
- Or: subsidize the matching cost on small orders against API-key tier credits

**Mitigations (Ballast-side, post-v1):**
- Collapse the basket to a single highest-conviction market when free USDC < $30
- Buffer multiple ticks of yield into a "hedge bucket" SQLite row, only fire when bucket ≥ $5
- Allow depositors to opt into a "concentrated" basket (1-2 markets) when small

For v1 we accept the no-op behavior at our test scale and note it explicitly
in the demo script — judges should see the loop produce a clean dry-run with
allocation reasoning visible.
