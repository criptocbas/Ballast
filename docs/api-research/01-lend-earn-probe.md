# Lend Earn API — Live Probe Results

**Probed:** 2026-04-30
**Endpoint:** `GET /lend/v1/earn/tokens` (keyless)
**Verdict:** ✅ Yields adequate to fund hedges + return residual

---

## Supported deposit assets and current rates

| Asset | jl-token | Supply rate | Rewards rate | Total rate (APY) | TVL |
|---|---|---|---|---|---|
| **JupUSD** (JUICED) | jlJupUSD | 2.62% | 2.50% | **5.12%** | $90M |
| **USDC** | jlUSDC | 3.23% | 1.13% | **4.36%** | $414M |
| **WSOL** | jlWSOL | 3.79% | 0.00% | **3.79%** | $407M (≈$34B in SOL terms) |
| **USDT** | jlUSDT | 2.47% | 0.00% | **2.47%** | $23M |
| **EURC** | jlEURC | 2.38% | 0.00% | **2.38%** | $4.5M |

Rates are in basis points (e.g., `supplyRate: 323` = 3.23%). All values from a single live snapshot at 2026-04-30 07:54 UTC.

---

## Implications for Reflux

### Asset choice for v1 vault
- **USDC** is the obvious choice for v1 — largest TVL ($414M = real liquidity), familiar to depositors, 4.36% APY.
- **JUICED (jlJupUSD)** is intriguing: 5.12% APY beats USDC, and depositing into a JupUSD-Lend-wrapped token (Jupiter's stablecoin, deposited in Jupiter's lender) is a "Jupiter-native" composition that itself signals creativity. Worth considering as a v1.5 asset class.

### Hedge budget math (illustrative)
Per $10,000 deposited at USDC's 4.36% APY:
- Annual yield: **~$436**
- Allocate 50% to hedges: ~$218/yr in NO-contract premiums
- At average NO contract price of $0.20, that's **~1,090 contracts** of payout coverage
- If a tail event hits and contracts settle at $1.00, payout = $1,090 → ~10.9% payout-to-deposit ratio

Per $10,000 in JUICED at 5.12% APY:
- Annual yield: **~$512**
- Same 50% allocation: ~$256/yr in premiums → ~1,280 contracts → ~12.8% payout-to-deposit ratio

This is a meaningful insurance product. Not "you'll be made whole if SOL crashes 50%" — but a real soft-hedge that offsets some downside while the principal still earns yield.

---

## Withdrawal limits (capacity)

USDC vault has `withdrawable: 73,173,865,925,584` micro-units = **$73M** currently available to withdraw without delay. This is way more than Reflux v1 will ever need.

JUICED vault has `withdrawable: 26,634,741,333,757` micro-units = **$26.6M**. Plenty.

---

## DX gaps captured

### Gap #5: All numeric values use raw integer micro-units, no decimal helpers in API
- `totalAssets: "414443424494446"` requires manual `/ 10^6` (or `/ 10^9` for SOL) conversion.
- The asset object exposes `decimals` so it's derivable, but every consumer has to do this.
- **Fix suggestion**: ship a thin SDK helper or include a `humanReadable` field on key amounts. Or at minimum a sample TS conversion utility.

### Gap #6: Rates are in basis points but no documentation in response
- `supplyRate: 113` → is this bps? %? 1/10000? Inferred from context but not labeled.
- **Fix suggestion**: name the field `supplyRateBps` or include a unit field.

### Gap #7: No "vault attribution" primitives in /lend/v1/earn surface
- For a vault product like Reflux that pools many depositors into one Jupiter Lend position, we have to bookkeep depositor shares ourselves.
- The Jupiter Lend Earn UserSupplyPosition is per-keypair, not per-attributed-depositor.
- **Fix suggestion**: not an API gap exactly, but a missing "vault helper" pattern in the docs/SDK. A doc page on "building a multi-depositor vault on top of Lend Earn" would help.

---

## Open questions

1. Is JUICED itself usable as collateral for Borrow? Could enable looped/leveraged Reflux strategies later.
2. Rate volatility — how often do supply/rewards rates change? Need this for hedge sizing.
3. Are there fees on deposit/withdraw? Couldn't find any in the response shape.
4. What's the cadence of rewards distribution? Continuous accrual vs periodic claim?
