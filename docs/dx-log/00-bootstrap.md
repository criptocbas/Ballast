# DX Log — 00 — Bootstrap

Findings captured during initial API probes (2026-04-30) and orchestrator stand-up.

## Read-API surface

### DX-GAP-#1 — Events list returns market IDs only, no titles or prices
- **Endpoint:** `GET /prediction/v1/events`
- **Friction:** to render any meaningful list of markets, you must N+1 call `/markets/{id}`
- **Suggested fix:** include `title`, `outcomePrices`, `volume` per market on the events response
- **Severity:** medium (latency hit + N+1 cost)

### DX-GAP-#2 — Orderbook tuple format is undocumented
- **Endpoint:** `GET /prediction/v1/orderbook/{id}`
- **Response shape:** `{ yes: [[priceCents, size], ...], no: [[priceCents, size], ...] }`
- **Friction:** unclear whether tuples are bids only, asks only, or both; multiple entries at price `0` observed
- **Suggested fix:** structured `{ bids: [...], asks: [...], lastTrade?: {} }` with explicit field names; document units inline
- **Severity:** high (we cannot confidently size hedge orders without knowing the format)

### DX-GAP-#3 — Volume / pricing units are undocumented per-field
- **Endpoint:** `GET /prediction/v1/events`, `/markets/{id}`
- **Friction:** values like `volumeUsd: 164204009000000` initially read as $164 trillion until the docs revealed "micro USD" globally
- **Suggested fix:** suffix fields with `_micro` (e.g. `volumeUsdMicro`) or include a `units` field in the response root
- **Severity:** medium

### DX-GAP-#4 — No filter for "tail-risk-relevant" / underlying-asset markets
- **Endpoint:** `GET /prediction/v1/events`
- **Friction:** to find markets that hedge a SOL holder, we have to keyword-search titles or category-walk
- **Suggested fix:** structured `underlyingAsset` + `direction` + `strike` fields on markets where applicable
- **Severity:** low (workaround exists)

### DX-GAP-#5 — Lend Earn returns raw integer micro-units with no helper
- **Endpoint:** `GET /lend/v1/earn/tokens`
- **Friction:** every consumer must convert `totalAssets: "414443424494446"` into a human number using the asset's `decimals`
- **Suggested fix:** ship `@jup-ag/api-client` package with normalized shapes, OR include a `humanReadable` block per token
- **Severity:** low-medium (annoying enough to warrant a shared utility)

### DX-GAP-#6 — Rates are basis points but field names don't say so
- **Endpoint:** `GET /lend/v1/earn/tokens`
- **Friction:** `supplyRate: 113` — bps? percent? per-block? Inferred from context but not labeled
- **Suggested fix:** rename to `supplyRateBps` or include unit field
- **Severity:** low (cosmetic but nudges integration mistakes)

### DX-GAP-#7 — Vault attribution patterns missing from Lend Earn surface
- **Endpoint:** `GET /lend/v1/earn/positions`, `/earn/deposit` (instructions)
- **Friction:** for a multi-depositor vault product, depositor share accounting must be done off-chain — no built-in primitive
- **Suggested fix:** documentation page on "building a multi-depositor vault on Lend Earn," even just a TS recipe
- **Severity:** medium (this is the entire shape of products like Reflux, Kamino vaults, etc.)

### DX-GAP-#8 — More tokens visible with API key than keyless
- **Endpoint:** `GET /lend/v1/earn/tokens`
- **Friction:** keyless probe returned 5 tokens (USDC, USDT, SOL, EURC, JUICED). Authenticated returned 7 (added USDG, USDS). No documentation that the token list is gated.
- **Suggested fix:** either expose all tokens regardless of auth, or document the gating
- **Severity:** medium (could trip up agents prototyping with keyless)

## AI Stack surface (preview — full coverage in `01-ai-stack.md`)

See `01-ai-stack.md` for DX-GAP-#10 onward (CLI shape > raw API shape, NO prices null in CLI events response, Skill overstating auth requirement, etc.)
