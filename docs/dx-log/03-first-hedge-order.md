# DX Log — 03 — First on-chain Prediction Market hedge

Notes captured while wiring `POST /prediction/v1/orders` into the orchestrator and
landing the vault's first NO-contract hedge on Solana mainnet.

**Mainnet hedge:**
- Tx: `3vCCfi3CZ3fZUrXVucz2P4MEPrp2v23cGtkvi6ZPeXUd1iMX2FvUiJThu24vgQQ6fV9k4n8xqMPcC9TYPGPvS5HS` ([Solscan](https://solscan.io/tx/3vCCfi3CZ3fZUrXVucz2P4MEPrp2v23cGtkvi6ZPeXUd1iMX2FvUiJThu24vgQQ6fV9k4n8xqMPcC9TYPGPvS5HS))
- Position: `YKVnoBPD8vqUZgSH5Md88ztmHSouKkXMFc1dLERRfMt`
- Market: `POLY-1345530` (BTC > $80k by EOY 2026, NO side)
- Filled: 26 contracts at $0.182 avg, $4.73 cost basis + $0.26 fees

**Reflux is now thesis-complete:** the vault holds $1 in `jlUSDC` (yield) + 26 NO contracts (hedge). The two halves of the composition are live and on-chain.

---

## ✅ What worked beautifully

- `POST /orders` returned the base64 tx and order/position pubkeys exactly per the docs
- Pre-flight simulation against the Helius RPC succeeded first try
- Order placement → keeper fill happened in **a few seconds** of polling
- `GET /orders/status/{orderPubkey}` returned `filled` quickly and accurately
- `GET /positions?ownerPubkey=...` returned a rich, well-typed position record (cost basis, mark, P&L, fees, claimable, event metadata, market metadata)

The async order/keeper model is clean and ergonomic once you understand it.

---

## ⚠ DX-GAP-#18 — $5 minimum order not documented in the open-positions guide

**Endpoint:** `POST /prediction/v1/orders`

The [Open Positions](https://developers.jup.ag/docs/prediction/open-positions) doc shows examples with `depositAmount: '2000000'` ($2) and lists `depositAmount` in the parameter table without any minimum. Reality:

```
Body: { "type": "invalid_request_error",
        "message": "Minimum order is $5",
        "code": "create_order_failed",
        "request_id": "..." }
```

The error is informative and easy to recover from, but the hard floor at $5 is a meaningful product constraint. We had to discover it by trying $0.30, then $0.50.

**Severity:** medium. We had test funds for $5; integrators without slack might burn time tweaking amounts.

**Suggested fix:** add a "Limits" section to the open-positions doc, or include `min_deposit_usd` in a `GET /prediction/v1/limits` endpoint or in the `/markets/{id}` payload (markets may have different mins).

---

## ⚠ DX-GAP-#19 — `pubkey` vs `positionPubkey` field naming inconsistency

The management docs call it `positionPubkey` (e.g. `DELETE /positions/{positionPubkey}`), and the `POST /orders` response also uses `order.positionPubkey`. But the **list** endpoint `/prediction/v1/positions?ownerPubkey=...` returns each position with the field named just `pubkey`:

```json
{
  "pubkey": "YKVnoBPD8vqUZgSH5Md88ztmHSouKkXMFc1dLERRfMt",
  "owner": "...",
  "marketId": "POLY-1345530",
  ...
}
```

Anyone wiring the list endpoint expecting `positionPubkey` will get `undefined`. We caught it because we logged the raw response.

**Severity:** low-medium. Our shared types now expose both names with a comment.

**Suggested fix:** rename `pubkey` → `positionPubkey` in the list response, or alias both server-side.

---

## ⚠ DX-GAP-#20 — List response wrapped in `{ data: [...] }`, docs imply `{ positions: [...] }`

The manage-positions doc shows the list endpoint returning `positions`:

```js
const positions = await response.json();
console.log(positions);
```

Reality: the response is `{ "data": [...] }`. Our types have to accommodate.

**Severity:** low (cosmetic), but it's mislead-by-omission.

**Suggested fix:** show the actual response shape in the doc example. A single response-shape table per endpoint would prevent these.

---

## ⚠ DX-GAP-#21 — Short-dated markets often have empty NO orderbooks

We initially tried placing a NO order on a 15-minute "Bitcoin Up or Down" market (POLY-2114168-0). The market was returned by `GET /events?filter=live` as live and tradeable; `GET /markets/{id}` returned reasonable YES pricing ($0.66) but `buyNoPriceUsd: 0`. The order endpoint rejected with:

```
"No shares available at this price"
```

So the market is live for **YES buys** but completely empty on the **NO** side. There's no signal in the events listing or market metadata that liquidity is one-sided.

**Severity:** medium — for any NO-strategy product (insurance vaults, mean-reversion bots, etc.) this means the discovery step has to validate orderbook depth before placing.

**Suggested fix:** add `noLiquidity: bool` / `yesLiquidity: bool` (or per-side depth) to the market metadata, OR document the convention clearly.

---

## ⚠ DX-GAP-#22 — Fees were ~5.5% on a $4.74 trade ($0.262 of $4.73)

For a $5 hedge, the position record showed `feesPaidUsd: 261687` micro-USD = $0.262, on `totalCostUsd: 4732000` ($4.73). That's a 5.5% effective fee.

The [Fees](https://developers.jup.ag/docs/prediction#fees) page explains the model, but at small order sizes the fee dominates. For Reflux's "yield finances tiny hedges" thesis, this is a pretty hard economic blocker — at sub-$10 hedges, more than half of any positive P&L is being eaten by fees.

**Severity:** high for our use case (low for high-volume traders). Worth adding a "Fees by order size" worked example to the docs so integrators can size orders appropriately.

**Suggested fix:** consider a flat fee model below $X order size, or document the breakeven order size where fees become a < 1% drag. For Reflux specifically, this means we need to size hedges at $25-50+ to keep fee drag under 1%.

---

## ⚠ DX-GAP-#23 — Mark price moved ~31% between order placement and first poll

We placed the order at `avgPriceUsd: 0.182`. Within ~2 minutes, the position record showed `markPriceUsd: 0.125` — a 31% drop. Either:

1. The market moved that much in 2 minutes (possible — short-dated 5-min markets are noisy, but POLY-1345530 is dated end of 2026, so unlikely)
2. The mark we entered was a stale or "best-effort" price, and the keeper's actual fill price was different

There's nothing in the response indicating which. From a P&L display perspective it shows an immediate loss that may be cosmetic.

**Severity:** medium — for a vault we display to the public, a -31% pnl on entry would be alarming for users.

**Suggested fix:** clarify in the docs whether `markPriceUsd` is the last-trade or mid; expose `entryPriceUsd` separately if it differs from `markPriceUsd` immediately after fill; OR include a settlement-pending flag during the keeper's fill window.

---

## Operational note

The keeper-network fill model is great in steady state but adds a non-trivial wait between "submit" and "filled." For an autonomous rebalance loop this means **don't synchronously block on fill confirmation** — record the orderPubkey and reconcile later.

We implemented `waitForOrderFill` for the test script (max 60s, 3s poll interval) but the production rebalance loop will treat orders as fire-and-reconcile.
