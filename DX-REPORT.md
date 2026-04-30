# Ballast — Developer Experience Report

**Submission for:** Jupiter "Not Your Regular Bounty" sidetrack · Solana Frontier Hackathon
**Project:** Ballast — a USDC vault where Jupiter Lend yield finances NO-contract hedges on tail-risk prediction markets
**Repo:** https://github.com/criptocbas/Reflux
**Live demo:** the orchestrator's `/dx` page renders every Jupiter API call we made in real time
**Email tied to Developer Platform:** sebastianbarrientosa@gmail.com (per cross-reference instructions in the bounty)

---

## What we built (so the rest of this report has context)

Ballast composes Jupiter's Lend Earn and Prediction Markets in a way neither product was designed for. Depositors send USDC into a vault wallet; the orchestrator deposits that USDC into Jupiter Lend Earn (currently `jlUSDC` at ~4.36% APY); a daily rebalance loop withdraws accrued yield and routes a configurable fraction of it into NO-contract hedges on a curated basket of tail-risk prediction markets (e.g. "BTC > $80k by EOY 2026"). When a hedged event resolves YES, the prediction-market payout sweeps back to depositors. The vault self-insures — depositors never directly pay a premium.

We are live on Solana mainnet:
- **Lend deposit** ([Solscan](https://solscan.io/tx/4dKhnE1s5GGzidZ4v6h17P23D9FQyruya6viRDX2Yr9pUdYs8kTfT79LgCswhukeJnkzYh9DASk8t6c61rAA9R5M)): $1.00 USDC into `jlUSDC`
- **First hedge** ([Solscan](https://solscan.io/tx/3vCCfi3CZ3fZUrXVucz2P4MEPrp2v23cGtkvi6ZPeXUd1iMX2FvUiJThu24vgQQ6fV9k4n8xqMPcC9TYPGPvS5HS)): 26 NO contracts on POLY-1345530 ($4.73 cost basis at $0.182 avg)

The rest of this document is the honest engineering report Jupiter asked for: what worked, what bit us, what we'd change. Twenty-five concrete findings with suggested fixes.

---

## TL;DR — the 8 things you should change first

1. **The CLI is significantly better-shaped than the raw HTTP API.** Ship the CLI's normalizers as a public `@jup-ag/api-client` package. The biggest single DX win available to you. ([#11](#dx-gap-11--cli-returns-better-shaped-data-than-the-raw-http-api))
2. **`userPosition.underlyingBalance` from the Lend SDK is the user's wallet balance, not the position value** — easy to misread; we shipped a buggy UI for one render cycle because of it. Rename to `underlyingWalletBalance`. ([#16](#dx-gap-16--userpositionunderlyingbalance-is-the-wallet-balance-not-the-position-value))
3. **Document numeric units inline.** Volumes are micro-USD, rates on Lend REST are bps, `JlTokenDetails.supplyRate` from the SDK is an opaque BN scale. Suffix fields with `_micro` / `_bps` or include a `units` block. ([#3](#dx-gap-3--volume--pricing-units-are-undocumented-per-field), [#6](#dx-gap-6--rates-are-basis-points-but-field-names-dont-say-so), [#17](#dx-gap-17--jltokendetailssupplyrate-and-rewardsrate-use-an-undocumented-bn-scale))
4. **Open-positions docs are missing the $5 minimum order** — we discovered it by trying $0.30, then $0.50. Add a "Limits" section. ([#18](#dx-gap-18--5-minimum-order-not-documented-in-the-open-positions-guide))
5. **Position list endpoint uses `pubkey`; management endpoints use `positionPubkey`** — naming inconsistency that will trip everyone. ([#19](#dx-gap-19--pubkey-vs-positionpubkey-field-naming-inconsistency))
6. **The `integrating-jupiter` SKILL.md says `client.lend`; the actual SDK exposes `client.lending`** — agents following the Skill verbatim hit a TS error and have to spelunk the .d.ts. ([#15](#dx-gap-15--jupiter-lend-skill-says-clientlend-sdk-exposes-clientlending))
7. **Events listing returns market IDs only — no title, no price.** Forces N+1 calls. Inline the basics. ([#1](#dx-gap-1--events-list-returns-market-ids-only-no-titles-or-prices))
8. **`integrating-jupiter` SKILL.md overstates auth requirement** ("API key required") — keyless 0.5 RPS works for many read endpoints. Replace with an Auth Tiers table. ([#13](#dx-gap-13--integrating-jupiter-skillmd-overstates-auth-requirement))

The full 25 findings are below, organised by surface. None of these are dealbreakers; we shipped a working product on top of all of them. They are all things you can act on Monday morning.

---

## Onboarding — how long from zero to first API call?

**~7 minutes from `developers.jup.ag` to a successful response.** The blockers in order:

1. **0:00–0:30** Land on developers.jup.ag, read the index, click "Get Started." Clean.
2. **0:30–1:30** Hit `https://dev.jup.ag/docs/llms.txt` because it's prominent in the AI section, dump it into Claude Code as initial context. **Worked perfectly** — this is the right pattern.
3. **1:30–2:30** First curl to `GET /lend/v1/earn/tokens` with no auth header. Got 200, full data. Discovery: keyless 0.5 RPS works without sign-up. (The Skill we'd later install would tell us "API key required" — see [#13](#dx-gap-13--integrating-jupiter-skillmd-overstates-auth-requirement).)
4. **2:30–4:30** First curl to `GET /prediction/v1/events?category=crypto`. Got 4054 events back. Volumes look like $164,204,009,000,000 — panic for ~30s until we re-read the docs and find "micro USD" mentioned somewhere. ([#3](#dx-gap-3--volume--pricing-units-are-undocumented-per-field))
5. **4:30–6:00** Sign up at developers.jup.ag/portal, generate a key, retry with `x-api-key` — got more tokens back than keyless ([#8](#dx-gap-8--more-tokens-visible-with-api-key-than-keyless)).
6. **6:00–7:00** Install `@jup-ag/cli` globally, run `jup predictions events`. Pretty output, JSON output, clean.

By the 7-minute mark we had a typed shell script and a Claude Code session loaded with `llms.txt` and could ask the agent to write integration code. **Onboarding score: 8/10 — slowed mostly by the units-not-labeled friction.**

---

## What's broken or missing in the docs

### DX-GAP-#1 — Events list returns market IDs only, no titles or prices
- **Where:** `GET /prediction/v1/events`
- **What happens:** every market in the response has shape `{ marketId: "POLY-..." }` with no title, no price, no volume.
- **Why it matters:** to render any meaningful list — a basket selector, a market explorer, a feed — you N+1 to `/markets/{id}` per market.
- **Fix:** include `title`, `outcomePrices`, `volume`, and `closeTime` in each market entry on `/events`. The CLI already returns these; just propagate them through the API response.
- **Severity:** medium (latency hit + N+1 cost)

### DX-GAP-#2 — Orderbook tuple format is undocumented
- **Where:** `GET /prediction/v1/orderbook/{id}`
- **Response shape:** `{ yes: [[1, 935817], [2, 44703], ...], no: [[1, 2120021], ...] }`
- **What's unclear:** Is `1` cents? micro-USD? Are entries bids only? Asks only? We've seen `[[0, 17324671], [0, 530014], ...]` (multiple entries at price 0) — what does that mean?
- **Fix:** structured `{ bids: [...], asks: [...], lastTrade?: {} }` with explicit field names; document units inline; normalize so a single price level can't appear twice.
- **Severity:** high — we cannot confidently size hedge orders without knowing the format.

### DX-GAP-#3 — Volume / pricing units are undocumented per-field
- **Where:** `/events`, `/markets/{id}`, basically every numeric field in Prediction
- **What happens:** values like `volumeUsd: 164204009000000` parse as $164 trillion until you remember the docs mention "micro USD" globally.
- **Fix:** suffix every micro-unit field with `_micro` (e.g. `volumeUsdMicro`), or include a `units` field at the response root, or both.
- **Severity:** medium — first impression is "the API is broken."

### DX-GAP-#6 — Rates are basis points but field names don't say so
- **Where:** `GET /lend/v1/earn/tokens` — `supplyRate: "113"`
- **What's unclear:** is this bps? percent? per-block?
- **Fix:** rename to `supplyRateBps` or include a unit field. Same fix as #3.
- **Severity:** low (cosmetic but nudges integration mistakes)

### DX-GAP-#18 — $5 minimum order not documented in the open-positions guide
- **Where:** [open-positions](https://developers.jup.ag/docs/prediction/open-positions)
- **What's missing:** the docs example uses `depositAmount: '2000000'` ($2) and the parameter table doesn't mention any minimum. Reality: orders below $5 reject with `"Minimum order is $5"`.
- **Fix:** add a "Limits" section to the doc, or include `min_deposit_usd` in `GET /markets/{id}` (markets may have different mins).
- **Severity:** medium

### DX-GAP-#20 — List response wrapped in `{ data: [...] }`, docs imply `{ positions: [...] }`
- **Where:** [manage-positions](https://developers.jup.ag/docs/prediction/manage-positions)
- **What happens:** the doc example shows `console.log(positions)` and never reveals the wrapper shape.
- **Fix:** show actual response shape per endpoint with a one-line "this returns" line, or embed an OpenAPI snippet.
- **Severity:** low (cosmetic but mislead-by-omission)

### DX-GAP-#13 — `integrating-jupiter` SKILL.md overstates auth requirement
- **Where:** `.claude/skills/integrating-jupiter/SKILL.md`
- **The Skill says:** *"Auth: x-api-key from portal.jup.ag (**required for Jupiter REST endpoints**)."*
- **Reality:** keyless access at 0.5 RPS works for many read endpoints. We used it successfully for `/events`, `/markets`, `/orderbook`, `/lend/v1/earn/tokens` before having a key.
- **Fix:** replace the blanket statement with an Auth Tiers table mapping endpoint → auth requirement. Or alias the rule to "write endpoints + higher tiers require a key; read endpoints work keyless at 0.5 RPS."
- **Severity:** medium — agents that fail-fast on missing API key during prototyping will give up too early.

---

## Where the APIs bit us — concrete examples

### DX-GAP-#11 — CLI returns better-shaped data than the raw HTTP API
**Same query, two surfaces:**

```bash
# Raw HTTP — what we'd write integrating without the CLI
curl 'https://api.jup.ag/prediction/v1/events?category=crypto&limit=5'
# → market IDs only, no titles, no prices in markets array
# → pricing must be fetched via N+1 calls to /markets/{id}
# → all numeric fields in micro-USD (1234567 = $1.23)

# CLI
jup predictions events --category crypto --filter live --limit 5 -f json
# → titles inline, yesPriceUsd as decimal float, ISO timestamps
```

**The CLI is doing the normalization the API does not.** This is the single biggest DX gap we found. Every direct-API integrator has to reinvent the helpers `@jup-ag/cli` already implements.

**Fix (pick one):**
1. Ship the CLI's normalizers as a public `@jup-ag/api-client` package.
2. Push the normalization into the API responses themselves (units field, decoded titles, ISO timestamps).
3. At minimum, link the CLI's source from each API doc so integrators can grep for "this is how the CLI handles it."

**Severity:** high. This is an asymmetric DX investment — fixing it in one place unblocks every direct-API integrator.

### DX-GAP-#16 — `userPosition.underlyingBalance` is the wallet balance, not the position value
After our $1 Lend deposit, the SDK returned:

```
userPosition.jlTokenShares      = 960_147        (≈ 0.96 jlUSDC, the actual position)
userPosition.underlyingBalance  = 7_000_000      (≈ $7 USDC, our wallet's USDC)
userPosition.underlyingAssets   = ?              (unclear distinction)
```

Field names suggest `underlyingBalance` is "what your jlToken position is worth in underlying terms." It isn't — it's the user's wallet balance. We shipped a vault page that displayed `$7.00` for a `$1.00` deposit until we caught it.

**Fix:** rename to `underlyingWalletBalance` (or remove from the position type entirely — wallet balance is a separate concern). At minimum, document the distinction with `underlyingAssets` in the type's TSDoc.

**Severity:** high.

### DX-GAP-#17 — `JlTokenDetails.supplyRate` and `rewardsRate` use an undocumented BN scale
The REST endpoint returns clean basis points:
```json
{ "supplyRate": "323", "rewardsRate": "113" }
```

The SDK returns the same fields as `BN` with an undocumented scale (~1e10 — combining them produces ~`1.1×10¹²` instead of 436 bps).

**Fix:** document the scale in the field's TSDoc, or expose a normalized `apyBps: number` derived field on `JlTokenDetails`. Or just remove the rate fields from the SDK and direct integrators to the REST endpoint.

**Severity:** medium — anyone displaying APY from the SDK directly will silently render absurd numbers.

### DX-GAP-#21 — Short-dated markets often have empty NO orderbooks while listed as "live"
We initially tried placing a NO order on a 15-minute "Bitcoin Up or Down" market (POLY-2114168-0). Events listing returned it as `isLive: true`; `/markets/{id}` returned reasonable YES pricing ($0.66) but `buyNoPriceUsd: 0`. Order endpoint rejected with `"No shares available at this price"`.

**Fix:** add `noLiquidity: bool` / `yesLiquidity: bool` (or per-side depth) to market metadata, OR document the convention clearly on the events doc page.

**Severity:** medium — for any NO-strategy product (insurance vaults, mean-reversion bots, etc.) this is a discovery-step gap.

### DX-GAP-#22 — Fees were ~5.5% on a $4.74 trade
For a $5 hedge, the position record showed `feesPaidUsd: 261687` micro-USD = $0.262 on `totalCostUsd: 4732000` ($4.73). **5.5% effective fee.**

For Ballast's whole thesis (yield finances tiny hedges), this is a hard economic blocker — at sub-$10 hedges, more than half of any positive P&L is being eaten by fees.

**Fix:** consider a flat-fee model below $X order size, or document the breakeven order size where fees become a < 1% drag. For Reflux specifically, this means we need to size hedges at $25-50+ to keep fee drag under 1%.

**Severity:** high for our use case (low for high-volume traders).

### DX-GAP-#23 — Mark price moved ~31% between order placement and first poll
Filled at `avgPriceUsd: 0.182`. Within ~2 minutes the position record showed `markPriceUsd: 0.125` — a 31% drop on a market dated end of 2026 (so genuine market move is implausible in 2 minutes). Either the mark we entered was a stale or "best-effort" price, or the keeper's actual fill price differed.

**Fix:** clarify whether `markPriceUsd` is last-trade or mid; expose `entryPriceUsd` separately; OR include a `settlement_pending` flag during the keeper's fill window.

**Severity:** medium — for a vault we display to the public, a -31% pnl on entry would be alarming for users.

### DX-GAP-#19 — `pubkey` vs `positionPubkey` field naming inconsistency
Management endpoints use `positionPubkey` (e.g. `DELETE /positions/{positionPubkey}`); `POST /orders` response uses `order.positionPubkey`. The list endpoint `/prediction/v1/positions?ownerPubkey=...` returns each position with `pubkey`.

```json
{ "pubkey": "YKVnoBPD8vqUZgSH5Md88ztmHSouKkXMFc1dLERRfMt", "owner": "...", "marketId": "POLY-1345530", ... }
```

**Fix:** rename `pubkey` → `positionPubkey` in the list response, or alias both server-side.

**Severity:** low-medium.

### DX-GAP-#25 — Claim response uses a different envelope than other write endpoints
- `POST /orders` returns `{ transaction, txMeta: { blockhash, lastValidBlockHeight } }`
- `DELETE /positions/{id}` returns `{ transaction, txMeta: { blockhash, lastValidBlockHeight } }`
- `POST /positions/{id}/claim` returns `{ transaction, blockhash, lastValidBlockHeight, position }` — top-level, no `txMeta` wrapper

**Fix:** move `blockhash` / `lastValidBlockHeight` into a `txMeta` wrapper for consistency. Or pick the flat shape and migrate the others — either way, pick one.

**Severity:** low (cosmetic but a pebble in every integrator's shoe).

### DX-GAP-#5 — Lend Earn returns raw integer micro-units with no helper
- `totalAssets: "414443424494446"` — every consumer derives the value via the asset's `decimals` separately.
- **Fix:** ship an `@jup-ag/api-client` package with normalized shapes, OR include a `humanReadable` block per token. (See #11 — same fix.)

### DX-GAP-#7 — Vault attribution patterns missing from Lend Earn surface
For a multi-depositor vault (Ballast, Kamino vaults, every YieldFi-shape product), depositor share accounting must be off-chain. The Lend Earn `UserSupplyPosition` is per-keypair, not per-attributed-depositor.

**Fix:** documentation page on "building a multi-depositor vault on Lend Earn" — even just a TS recipe. Better: a thin "vault helper" SDK module that wraps the bookkeeping.

### DX-GAP-#8 — More tokens visible with API key than keyless
Keyless probe returned 5 tokens (USDC, USDT, SOL, EURC, JUICED). Authenticated returned 7 (added USDG, USDS). No documentation that the token list is gated.

**Fix:** either expose all tokens regardless of auth, or document the gating.

### DX-GAP-#15 — `jupiter-lend` Skill says `client.lend`, SDK exposes `client.lending`
```ts
// Skill says:
const positions = await client.lend.getUserPositions(...);
// SDK reality:
declare class Client {
  readonly liquidity: Liquidity;
  readonly lending: Lending;   // ← actual namespace
  readonly vault: Vault;
}
```

Anyone following the Skill verbatim hits a TS error and has to read the .d.mts.

**Fix:** rename in the Skill, or alias `client.lend` → `client.lending` in the SDK.

### DX-GAP-#24 — $5 minimum compounds badly at small TVL
The combination of Jupiter Prediction's $5 minimum and a diversified 5-market basket creates a hard floor: the vault needs ~$28.57 of free USDC for the heaviest-weighted market (35%) to clear, and ~$100 for the lightest (10%).

For yield-financed hedges (Ballast's whole thesis), this means principal needs to be $10k+ before the loop can operate with monthly cadence.

**Fix:** lower the minimum to $1 with a per-market metadata flag (`micro_orders_supported`); OR introduce a "vault tier" with batched-order execution; OR subsidize matching cost on small orders against API-key tier credits.

**Severity:** structural-economics, high for vault-shape products.

---

## AI Stack — what worked, what didn't, what's missing

We used all four pieces of Jupiter's AI stack during the build:

### Skills (`integrating-jupiter`, `jupiter-lend`)
- **What worked:** Auto-discovered by Claude Code from `.claude/skills/`. The `integrating-jupiter` skill has a clean intent-router structure. Tags are well-chosen.
- **What didn't:** see [#13](#dx-gap-13--integrating-jupiter-skillmd-overstates-auth-requirement) (auth overstatement) and [#15](#dx-gap-15--jupiter-lend-skill-says-clientlend-sdk-exposes-clientlending) (`client.lend` vs `client.lending`).
- **Install gotcha — DX-GAP-#10:** the documented install command `npx skills add jup-ag/agent-skills --skill "integrating-jupiter"` is not headless-safe. Defaults to interactive prompts that hang in CI / sandbox environments. The working command is `npx skills add jup-ag/agent-skills --skill integrating-jupiter --agent claude-code --yes`. **Fix:** update the doc snippet.
- **Coverage gap:** neither skill covered the cross-product composition Ballast needed (Lend × Prediction). When we asked Claude to "place a NO contract using accrued Lend yield," the agent produced reasonable-looking code that wired the two skills together — but didn't surface that this composition was novel. **Fix:** add a "Compose with other Jupiter products" section to each skill, listing supported and unsupported cross-API patterns.

### Jupiter CLI
- **What worked superbly:** all the things we caught the raw HTTP API doing wrong, the CLI gets right (titles, decimal prices, ISO timestamps). The `--format json` mode is genuinely LLM-friendly.
- **What didn't:** see [#12](#dx-gap-12--nopriceusd-null-on-binary-markets-in-cli-events-response) (NO prices null on binary markets) and [#14](#dx-gap-14--cli-is-pre-v1-early-alpha-with-no-per-command-stability-marker) (no per-command stability marker).
- **Wish-list:**
  - `jup predictions buy` should accept `--side no` (it does) AND a `--budget-usd <n>` flag that auto-handles the deposit. Currently `--amount` is the deposit; this is fine but inconsistent with Spot's `--from`/`--to`/`--amount` mental model.
  - `jup lend earn deposit` should print the post-deposit jlToken balance to stdout in JSON. Currently you have to chain it with `jup lend earn positions` to confirm.

### Documentation MCP
We configured `https://developers.jup.ag/docs/mcp` via project-scoped `.mcp.json`. **Did not exercise during the build** because the autoload point was after our session was already running, and most of our questions were about runtime behavior (response shapes, error codes) rather than docs lookup. We expect MCP to shine for new builders who are actively writing initial integration code in-editor; for our use case (post-bootstrap, debugging live behavior) it was less critical.

**Suggestion:** the MCP server could expose a `runtime_status` tool that surfaces open known issues / breaking changes from the changelog, so agents can warn users when they're about to hit a known bug. Today the agent has no way to differentiate "this looks broken" from "this is broken because Jupiter shipped something Tuesday."

### llms.txt / llms-full.txt
- **Used heavily.** Loaded `llms.txt` into the Claude Code session at start; treated it as the spine of our context.
- **What worked:** the structure (one-line summary per page) is exactly right. Easy to scan, easy for agents to grep.
- **What didn't:** `llms-full.txt` would benefit from inline anchors / section IDs so we can grep for specific concepts ("how do I claim a payout") and grab the right slice without dumping 3000+ lines into context.
- **Wish-list:** an `llms-changes.txt` or `llms-recent.txt` showing the most recent N doc edits, so agents can re-load only the parts that changed since their last cached snapshot.

---

## How would we rebuild developers.jup.ag?

(Per the bounty prompt — engineering opinion, not surface bug-list.)

**1. Lead with a "build something now" path.**
Today the docs lead with "Get an API key." That's correct but slow. Our path was: try keyless → realize it works → build a test → only then sign up. We'd flip the front page to: *"Hit our API right now, no signup needed. Here's a curl. Now you have a JSON. Now sign up for higher tier."*

**2. Make the response shape visible above the fold of every endpoint page.**
Every endpoint we touched required us to either curl it ourselves or read `.d.mts` to find out what it actually returns. Embed a real (or auto-generated) response sample at the top of every endpoint, with field-by-field unit annotations. The example body you do show on /open-positions ([open-positions docs](https://developers.jup.ag/docs/prediction/open-positions)) is great for the request side; we want the same for the response.

**3. Auto-generate a `units` annotation for every numeric field in every response.**
Pick a convention (`_micro`, `_bps`, `_lamports`) or a runtime field (`__units: { ... }`) and apply it everywhere. The current "everything is micro-USD, except basis points, except scaled BN" makes integrators slower and bug-prone. This is a one-week change with a year of payoff.

**4. Ship a public `@jup-ag/api-client` package mirroring the CLI's normalizers.**
The CLI is doing the right work; the work is just trapped behind a subprocess interface. Promote the normalizers to a published TS package so direct-API integrators don't have to re-implement them. This is the single highest-leverage doc/SDK change available to you.

**5. Differentiate the AI Stack pages by *intent*, not by tool.**
Today the AI page is organized by tool (CLI, Skills, MCP, llms.txt). Better structure: organize by user goal — *"I want to discover endpoints" → llms.txt + MCP*; *"I want my agent to write code" → Skills*; *"I want my agent to execute trades" → CLI*. Three goals × the right tool each, with the same tool sometimes appearing twice.

**6. Stability tier per CLI subcommand.**
Today the CLI has a global "pre-v1 (early alpha)" warning. For production integrators that's a binary blocker. Per-command stability tiers (`stable`, `beta`, `alpha`) would let teams adopt the stable parts now and watch the unstable parts.

**7. Real changelog with breaking-change call-outs that actually call out the breakage.**
The current `/changelog` is brief. Each entry should include: what broke, what migration is required, deadline if any. We're hesitant to depend on Trigger v2 specifically because we have no signal on its stability cadence.

**8. Make `/dx` (or similar) the marketing page.**
Builders trust live numbers. A "watch live integrations" page with anonymized real API call traces from active users would be a stronger trust signal than the current copy. (We built one at `/dx` because we needed it for our bounty submission; you should build one for the platform.)

---

## What we wish existed

- **`POST /prediction/v1/markets/by-asset?underlying=BTC&direction=below&strikeRange=...`** — let us discover hedge-relevant markets without keyword-grepping titles. ([#4](#))
- **A `lend earn vault` recipe** — official guide for "I'm building a multi-depositor vault on Lend Earn." Most yield products on Solana are this shape; the absence of a canonical pattern means everyone re-invents. ([#7](#dx-gap-7--vault-attribution-patterns-missing-from-lend-earn-surface))
- **Batched order placement on Prediction** — submit N small orders in one keeper match so vault-shape products can size below $5 per market. ([#24](#dx-gap-24--5-minimum-compounds-badly-at-small-tvl))
- **Webhook-style position resolution events** — long-poll or Server-Sent-Events feed of "this position resolved" / "this position became claimable" so orchestrators don't have to poll `/positions` on a cron.
- **A `simulateOrder` endpoint for Prediction** — given `{ marketId, isYes, depositAmount }`, return the expected fill shape (contracts, fees, mark) without committing. We'd use this in the rebalance dry-run to surface "this hedge would cost $X in fees" before placing.
- **Cross-product portfolio in one call** — `GET /portfolio/v1/positions/{wallet}` already exists, but it's currently sectioned by Jupiter product. A "unified P&L across all Jupiter products" view would let us show depositor performance without wiring three separate clients.

---

## Coverage — Jupiter API surface we touched

| Family | Endpoint | Used in |
|---|---|---|
| Lend | `GET /lend/v1/earn/tokens` | bootstrap; live in `/vault` page |
| Lend | `getDepositIxs` (SDK) | first deposit, rebalance compound |
| Lend | `getWithdrawIxs` (SDK) | available for future withdrawal flow |
| Lend | `client.lending.getUserPositions` (SDK) | position read on every `/vault/info` |
| Prediction | `GET /prediction/v1/events` | basket curation, market discovery |
| Prediction | `GET /prediction/v1/markets/{id}` | per-market pricing for `findMarket.ts` |
| Prediction | `GET /prediction/v1/orderbook/{id}` | depth check (planned for v1.5) |
| Prediction | `POST /prediction/v1/orders` | hedge placement |
| Prediction | `GET /prediction/v1/orders/status/{id}` | post-place fill confirmation |
| Prediction | `GET /prediction/v1/positions?ownerPubkey=...` | vault state on every `/vault/info` |
| Prediction | `POST /prediction/v1/positions/{id}/claim` | claim flow + sweep |
| Prediction | `DELETE /prediction/v1/positions/{id}` | typed wrapper available; not exercised in v1 |
| Tokens | `GET /tokens/v2/search` | sanity probes only |
| Price | `GET /price/v3` | sanity probes only |

**Total: 5 Jupiter API families, ~13 endpoints, all hit live on mainnet during dev.** The orchestrator's `/dx/observations` endpoint exposes the full call log.

---

## Closing

The Jupiter Developer Platform is good — the new unified base URL, the AI Stack investment, the keyless tier for prototyping, the CLI's design principles. The 25 findings above are mostly edges, not core defects. The biggest single thing you could do is **ship the CLI's normalizers as a public SDK** and **annotate units in every numeric field**; together those two changes would account for maybe a third of the friction we hit.

We'd build with this platform again. Good luck with the read-through — we ran out of pixels in our `/dx` page tracking how many calls we made, but the answer is "a lot, mostly successful, and the ones that weren't are now in this report."
