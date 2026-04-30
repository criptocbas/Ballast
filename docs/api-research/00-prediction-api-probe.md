# Prediction API — Live Probe Results

**Probed:** 2026-04-30
**Auth:** Keyless (no API key, 0.5 RPS limit on `api.jup.ag`)
**Verdict:** ✅ Reflux is economically viable on Prediction API

---

## What we validated

| Question | Answer |
|---|---|
| Are there enough markets? | **YES** — 4,054 total events, 724 in `crypto` alone |
| Categories relevant to tail-risk? | `crypto/btc`, `crypto/eth`, `economics/economy`, `finance` all present and liquid |
| Liquidity sufficient for v1 vault? | **YES** — top BTC markets have $34M+ event-level volume, individual markets $1-40K orderbook depth |
| Aggregation source? | Polymarket-prefixed IDs (`POLY-*`); presumably Kalshi prefixed `KAL-*` (not seen yet, need to check) |
| Auth needed for read endpoints? | NO — keyless works at 0.5 RPS for `/events`, `/markets/{id}`, `/orderbook/{id}` |

---

## Endpoints exercised

```
GET /prediction/v1/events                      → list events with markets array (ids only)
GET /prediction/v1/events?category=crypto      → filterable by category
GET /prediction/v1/markets/{marketId}          → market title, pricing, rules
GET /prediction/v1/orderbook/{marketId}        → bid depth (yes/no arrays)
```

---

## Pricing model

All prices are in **micro-USD** (1 USD = 1,000,000). For "BTC > $80k by EOY 2026":

```json
{
  "buyYesPriceUsd": 875000,    // $0.8750 - ask for YES contract
  "sellYesPriceUsd": 814000,   // $0.8140 - bid for YES contract
  "sellNoPriceUsd": 125000,    // $0.1250 - bid for NO contract
  "buyNoPriceUsd": 186000,     // $0.1860 - ask for NO contract
  "volume": 693600,            // $0.6936 (this market's total volume — small!)
  "outcomePrices": ["0.844", "0.156"]   // human-readable mid prices
}
```

Buy NO at $0.186 → if event resolves NO, you receive $1.00. Profit = $0.814 per contract.
For Reflux: we BUY NO contracts on bullish-thesis markets to act as crash insurance.

---

## DX gaps captured (for the report)

### Gap #1: Events list returns market IDs only — no titles, no prices
- `/events` returns `markets: [{ marketId: "POLY-..." }]` array, no title or pricing.
- Forces N+1 calls to `/markets/{id}` to display anything meaningful.
- **Fix suggestion**: include `title`, `outcomePrices`, `volume` in the markets array on `/events`.

### Gap #2: Orderbook format is undocumented and non-obvious
Sample response for "BTC hits $150k by EOY 2026":
```json
{
  "yes": [[1, 935817], [2, 44703], [3, 4423], ...],
  "no":  [[1, 2120021], [2, 90000], [3, 68008], ...]
}
```
- Tuples are presumably `[priceCents, sizeContracts]` but format isn't documented.
- For "BTC > $80k" we saw `[[0, 17324671], [0, 530014], [0, 800], ...]` — multiple entries at price 0, unclear semantics.
- It's also unclear whether these are bids only, asks only, or both sides.
- **Fix suggestion**: document the tuple format, normalize so it can't have two entries at the same price level, and consider returning structured `{ bids, asks, lastPrice }`.

### Gap #3: Volume scale is inconsistent
- `event.volumeUsd` looked like `164204009000000` — initially read as $164 trillion until I recalled docs say "micro USD." Same scale on market `pricing.volume`.
- **Fix suggestion**: document the unit on every numeric field, ideally with a `_micro` suffix or explicit unit field.

### Gap #4: No filter for "tail-risk-relevant" / asset-mapped markets
- We want "all markets that resolve based on BTC < $X by date" — there's no asset filter, only category. We'd have to keyword-search titles.
- **Fix suggestion**: structured `underlyingAsset` + `direction` (above/below) + `strike` fields on markets.

---

## Sample inventory of usable markets (for v1 vault)

From the first 20 crypto events alone, viable tail-risk hedge candidates:

| Event | Volume | Why useful |
|---|---|---|
| What price will Bitcoin hit in 2026? (34 markets) | $34M | Wide range of strike prices, can buy NO on bullish strikes |
| When will Bitcoin hit $150k? (5 markets) | $18M | Date-range YES contracts on bullish thesis |
| Bitcoin above $X on May 3? (11 markets) | $126K | Short-dated, daily-rebalanceable |
| Ethereum above $X on May 1? (11 markets) | $140K | Same |
| Fed Decision in June? (5 markets) | $13M | Macro hedge |
| What will WTI Crude Oil hit in April 2026? (39 markets) | $58M | Macro/inflation proxy |

This is enough variety to construct a diversified hedge portfolio for a v1 vault.

---

## Open questions for further investigation

1. Does Kalshi-sourced data show up alongside Polymarket? Filter / search ergonomics?
2. What are the resolution timestamps and how reliable is settlement timing?
3. Order placement (`POST /orders`) — what's the auth model, slippage handling, error codes?
4. Position management at scale — pagination, batched claim endpoints?
5. Are there programmatic ways to discover "all markets relevant to underlying asset X"?
