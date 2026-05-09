# Ballast — Developer Experience Report

**Submission for:** Jupiter "Not Your Regular Bounty" sidetrack · Solana Frontier Hackathon
**Project:** Ballast — a USDC vault where Jupiter Lend yield finances NO-contract hedges on tail-risk prediction markets
**Repo:** https://github.com/criptocbas/Ballast
**Live demo:** the orchestrator's `/dx` page renders every Jupiter API call we made in real time
**Email tied to Developer Platform:** sebastianbarrientosa@gmail.com (per cross-reference instructions in the bounty)

---

## What we built (so the rest of this report has context)

Ballast composes Jupiter's Lend Earn and Prediction Markets in a way neither product was designed for. Depositors send USDC into a vault wallet; the orchestrator deposits that USDC into Jupiter Lend Earn (`jlUSDC`, currently ~4.24% APY); a daily rebalance loop withdraws accrued yield and routes a configurable fraction of it into NO-contract hedges on a curated basket of tail-risk prediction markets (e.g. "BTC > $90k by EOY 2026"). When a hedged event resolves YES, the prediction-market payout sweeps back to depositors. The vault self-insures — depositors never directly pay a premium.

We are live on Solana mainnet (state at submission time):
- **Lend Earn position:** ~$19.75 in `jlUSDC` at ~4.24% APY ([first deposit, 2026-05-01](https://solscan.io/tx/4dKhnE1s5GGzidZ4v6h17P23D9FQyruya6viRDX2Yr9pUdYs8kTfT79LgCswhukeJnkzYh9DASk8t6c61rAA9R5M))
- **Open hedge:** 16 NO contracts on POLY-1345531 (BTC > $90k by EOY 2026), $5.12 cost basis ([opening tx, 2026-05-07](https://solscan.io/tx/5JKzdxci3jskXW6XqhskJ1fEu6A9Cw38y82a81TUY6WJ99Fzea3GXUmSdczf2Bc5F3fiezHgmpBohMkqfzY5dqbL))
- **Earlier hedge (now closed):** 26 NO contracts on POLY-1345530 (BTC > $80k EOY 2026, $4.73 cost basis, [opening tx, 2026-05-02](https://solscan.io/tx/3vCCfi3CZ3fZUrXVucz2P4MEPrp2v23cGtkvi6ZPeXUd1iMX2FvUiJThu24vgQQ6fV9k4n8xqMPcC9TYPGPvS5HS)) — market resolved as BTC crossed $80k during the build (see [DX-GAP-#31](#dx-gap-31--marketsid-returns-nullable-liquidity-fields-with-undocumented-status-conventions))

The rest of this document is the honest engineering report Jupiter asked for: what worked, what bit us, what we'd change. Thirty-one concrete findings with suggested fixes.

---

## TL;DR — the 7 highest-leverage findings

If you only read this section, these are the changes that would compound across every Jupiter integrator:

1. **Ship a `@jup-ag/lend-vault` helper module** that wraps multi-depositor share-bookkeeping AND clamps notional balances to redeemable vault liquidity. We shipped a vault on Lend Earn, then hit our own #26 in production: the `/me` page promised a depositor $8 of withdrawable when only $1 was actually liquid (rest hedge-locked). Every yield-vault on Solana that touches Prediction (or perps, or any settled-on-resolution position) needs this helper. We re-implemented it; everyone else will too. ([#28](#dx-gap-28--we-shipped-a-vault-on-lend-earn-hit-dx-gap-26-in-production-fixed-it-ourselves))
2. **Ship the CLI's normalizers as a public `@jup-ag/api-client` package.** The CLI returns titles, decimal prices, ISO timestamps; the raw HTTP API returns IDs, micro-USD, unix epochs. Every direct-API integrator reinvents this. ([#11](#dx-gap-11--cli-returns-better-shaped-data-than-the-raw-http-api))
3. **Rename `userPosition.underlyingBalance` to `underlyingWalletBalance`** in the `@jup-ag/lend-read` SDK. We shipped a vault page that displayed `$7.00` for a `$1.00` position for one render cycle because of this naming. ([#16](#dx-gap-16--userpositionunderlyingbalance-is-the-wallet-balance-not-the-position-value))
4. **Annotate numeric units in every API response.** Suffix `_micro` / `_bps` or add a `__units` block. The "panicking-at-$164-trillion" moment shouldn't happen to anyone. ([#3](#dx-gap-3--volume--pricing-units-are-undocumented-per-field), [#6](#dx-gap-6--rates-are-basis-points-but-field-names-dont-say-so), [#17](#dx-gap-17--jltokendetailssupplyrate-and-rewardsrate-use-an-undocumented-bn-scale))
5. **Add the $5 prediction minimum to the open-positions doc** — the error is good ("Minimum order is $5"), but the docs let us discover it the hard way. ([#18](#dx-gap-18--5-minimum-order-not-documented-in-the-open-positions-guide))
6. **Fix the `integrating-jupiter` Skill's `client.lend` → `client.lending` typo.** Agents following the Skill verbatim hit a TS error and have to read the `.d.mts`. ([#15](#dx-gap-15--jupiter-lend-skill-says-clientlend-sdk-exposes-clientlending))
7. **Inline market titles + prices on `/prediction/v1/events`.** The CLI does it; the API doesn't, forcing N+1 calls per market. ([#1](#dx-gap-1--events-list-returns-market-ids-only-no-titles-or-prices))

A long tail of smaller findings (#4, #10, #12, #13, #14, #19, #20, #25, #29–#32 — missing discovery endpoint, install gotcha, CLI prices/stability, Skill phrasing, response wrapper conventions, naming consistency, hot-reload + cache invalidation traps) follows. They are real but mostly cosmetic; the seven above are the structural ones.

**Total: 31 numbered findings across 5 categories.** All reproducible, all with concrete suggested fixes. None are dealbreakers — we shipped a fully working product on top of every one. Findings #28–#32 are field reports from real production incidents during the build: #28 is hitting #26 ourselves and shipping the fix, #29–#32 emerged from this week's deeper integration work (basket reload, partial fills, market-state field conventions, cache invalidation contracts).

**One finding upstreamed as a PR.** [jup-ag/agent-skills#20](https://github.com/jup-ag/agent-skills/pull/20) proposes the fix for DX-GAP-#13 (auth-tier overstatement in the `integrating-jupiter` skill). We picked the cleanest finding to ship as code rather than just prose; the rest live in this report.

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
- **Status:** **PR open upstream** at [jup-ag/agent-skills#20](https://github.com/jup-ag/agent-skills/pull/20) — proposes the bulleted auth-tiers replacement. This is the only finding in this report we've upstreamed as a code change so far; the rest are written-up here for Jupiter to action.
- **Severity:** medium — agents that fail-fast on missing API key during prototyping will give up too early.

### DX-GAP-#10 — `npx skills add` install command isn't headless-safe

The skills CLI's documented install command:

```bash
npx skills add jup-ag/agent-skills --skill "integrating-jupiter"
```

defaults to interactive prompts (agent selection, auto-accept) that hang in CI / sandbox / non-TTY environments. We hit this trying to install the skill from a fresh agent session.

**The working command** (we discovered empirically):

```bash
npx skills add jup-ag/agent-skills --skill integrating-jupiter --agent claude-code --yes
```

Three required additions: `--skill <name>` without quotes, `--agent <agent>` (otherwise prompts for agent selection), and `--yes` (auto-accept the rest of the prompts).

**Fix:** update the install snippet in the AI-stack docs to include all three flags. Or detect non-TTY and skip prompts automatically (defaulting `--yes` and the most-recently-used agent).

**Severity:** medium — blocks headless installation; CI integration paths fail by default; agents trying to install at the start of a session experience a hang and have to abort.

---

## Where the APIs bit us — concrete examples

### DX-GAP-#4 — No structured market-discovery endpoint; basket curators must keyword-grep titles

The current `/prediction/v1/events` endpoint accepts a `category` filter (e.g. `crypto`) and a free-text `search` parameter, but no structured way to find markets by underlying asset, strike direction, or strike range. To curate Ballast's tail-risk basket we had to:

1. Pull all crypto events
2. For each event, walk its markets and call `/markets/{id}` to read the title
3. Regex titles like `↑ 80,000` for direction + strike, `by December 31, 2026` for close-time intent

This is brittle (string parsing) and slow (N+1 calls per event). Painful for any product that programmatically curates baskets — insurance vaults, structured-product launchers, hedging bots, indexers.

**Fix:** add a structured discovery endpoint, e.g.:

```
POST /prediction/v1/markets/by-asset
{
  "underlying": "BTC",
  "direction": "above",
  "strikeRangeUsd": [80000, 120000],
  "closeTimeAfter": 1798743600,
  "minNoSideDepthUsd": 25
}
```

OR include structured metadata (`underlying`, `strikePrice`, `direction`, `closeTimeUnix`) in each market response so a single filter pass against `/events` works without N+1 title-grepping.

**Severity:** medium for vault-shape products curating baskets at scale; low for one-off integrators with a single market in mind.

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

### DX-GAP-#12 — `noPriceUsd: null` on binary markets in CLI events response

```bash
jup predictions events --filter live --limit 5 -f json
# binary market entry:
{ "yesPriceUsd": 0.43, "noPriceUsd": null, ... }
```

For NO-side strategies (insurance vaults like Ballast, mean-reversion bots, etc.), this forces the integrator to compute NO price as `1 - yesPriceUsd` defensively (relying on the binary-mirror invariant) OR call `/markets/{id}` per market for the actual ask. Both are extra work the CLI could eliminate by just populating both prices.

**Fix:** always populate both `yesPriceUsd` and `noPriceUsd` on the CLI's `events` output. Server-compute the binary mirror (`noPriceUsd = 1 - yesPriceUsd` for binary markets) so integrators don't have to.

**Severity:** medium — for any NO-side product, this is a per-event extra round-trip or per-event defensive arithmetic.

### DX-GAP-#14 — CLI is pre-v1 (early alpha) with no per-command stability marker

The CLI carries a global "early alpha — interfaces may change" warning in `jup --version` output and in the docs, but there's no per-command granularity. Some subcommands are battle-tested (`jup predictions events`, `jup lend earn deposit` — both worked first try for us); others may be experimental or unstable. From an integrator's perspective, the global warning is binary: either accept the entire surface as alpha or don't depend on it at all.

**Fix:** per-subcommand stability badges in `jup --help` output:

```
jup predictions events    ✓ stable
jup predictions buy       ✓ stable
jup studio create-token   α alpha
```

Lets production teams adopt the stable parts now and watch the unstable parts. For Ballast specifically, we'd happily depend on `jup predictions events` and `jup lend earn deposit` if we knew they were stable — without that signal, we wrote our own typed HTTP wrappers for everything we ship to mainnet.

**Severity:** medium — production integrators block on this; results in extra implementation cost (we re-implemented what the CLI already provides because we couldn't depend on the CLI for production).

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

**Fix:** consider a flat-fee model below $X order size, or document the breakeven order size where fees become a < 1% drag. For Ballast specifically, this means we need to size hedges at $25-50+ to keep fee drag under 1%.

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

### DX-GAP-#26 — Vault-shape products need a "share token" pattern from Lend Earn

When you build a multi-depositor vault on top of Lend Earn, depositor share accounting is entirely on you (Ballast does it in `accountant.ts`). For products like Ballast, Kamino vaults, every Drift-strategy product, this creates a near-universal off-chain SQLite schema that everyone reinvents.

The cleaner pattern would be a Jupiter-side share-token primitive: deposit X to Lend, receive Y vault-shares, where vault-share value floats relative to underlying. This is exactly what jlTokens already do at the protocol level — but the user-facing accounting is per-keypair, not per-vault-with-attributed-depositors.

**Fix:** publish a "Lend Earn vault helper" recipe in `integrating-jupiter` skill, OR ship a `@jup-ag/lend-vault` package that wraps the share-bookkeeping pattern.

**Severity:** medium-high for the long tail of yield-vault products that will be built on Lend Earn.

### DX-GAP-#27 — `userPosition.underlyingAssets` vs `userPosition.underlyingBalance` distinction is not in the SDK TSDoc

Related to #16 but worth its own number: even after we figured out that `underlyingBalance` is wallet-balance, the function of `underlyingAssets` is also unclear from the type alone. We had to test empirically: deposit, then read both fields. `underlyingAssets` does represent the position's underlying value — but neither field's TSDoc says so.

**Fix:** TSDoc lines on each field of `UserPosition$1` describing source and units. Five-minute change with permanent payoff.

**Severity:** low-medium.

### DX-GAP-#28 — We shipped a vault on Lend Earn, hit DX-GAP-#26 in production, and fixed it ourselves

This is the field report from #26. Read the two together — they're the same finding from two angles, but #26 is the architectural diagnosis and #28 is what hitting it actually felt like in production.

**The setup.** Our orchestrator's depositor accountant uses a cumulative-deposit model: `net = contributed − withdrawn + payouts`. After 4 confirmed mainnet deposits totalling **$16** and 3 successful withdrawals totalling **$8**, the accountant correctly reported a $8 net claim for the depositor. Mathematically clean. We shipped that number to the `/me` page and it sat there for a few days.

**The bite.** When we tested the withdrawal flow at $8, the orchestrator dutifully built the SPL transfer, tried to top up the vault wallet by withdrawing ~$7 from Lend Earn, and the simulation returned:

```
InstructionError: [0, { Custom: 1 }]
Program log: Instruction: Withdraw
Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]
Program log: Instruction: Burn
Program log: Error: insufficient funds
```

`Burn` failed because Lend only had **$1.00 of jlUSDC** to burn — the rest of the $8 had been routed into a NO-contract hedge two days earlier (`POLY-1345530`, $4.73 cost basis), which won't be liquid until that market resolves at end of 2026. The withdrawal aborted at simulation, no funds moved, the row got marked `failed` — exactly what the framework should do.

**The bug isn't the rejection. The bug is that the UI ever offered a withdrawal the vault couldn't honor.** Cumulative-deposit accounting tracks notional *claim*, not redeemable *NAV*. The moment any vault capital flows into a non-instant-redeemable position (a hedge, a perp, anything that settles at resolution), notional balance and what-the-vault-can-pay diverge — invisibly, until a depositor tries to withdraw.

**Side-finding discovered while diagnosing this:** the failed withdrawal row was being silently counted toward the depositor's `withdrawn` total. The SQL summed every row regardless of `status`. So a failed simulation was permanently reducing the depositor's notional balance by funds that never left the vault. Filtering `status != 'failed'` in `getDepositorNetBalance` was a one-line fix.

**The fix we shipped (after hitting it ourselves):**

```ts
// apps/orchestrator/src/accountant.ts
export function getDepositorWithdrawable(args: {
  wallet: string;
  redeemableVaultUsdc: number; // wallet free USDC + Lend Earn underlying — NO hedge mark
}): DepositorWithdrawable {
  const notionalNet = Math.max(0, getDepositorNetBalance(args.wallet).net);
  const totalNet = Math.max(0, getTotalNetBalance());
  const shareFraction = totalNet > 0 ? notionalNet / totalNet : 0;
  const shareOfRedeemable = shareFraction * args.redeemableVaultUsdc;
  return {
    notionalNet,
    shareFraction,
    redeemableVaultUsdc: args.redeemableVaultUsdc,
    shareOfRedeemable,
    withdrawableNow: Math.min(notionalNet, shareOfRedeemable),
    hedgeLockedUsdc: Math.max(0, notionalNet - shareOfRedeemable),
  };
}
```

The `/me` page now shows **"Withdrawable now"** prominently (clamped to `min(notional, share-of-redeemable)`) and an inline warning when the gap is non-zero — *"$X locked in open hedges. Your notional balance is $Y, but the vault's redeemable USDC right now is $Z (wallet + Lend Earn). The remainder is in open NO-contract positions that become liquid only when those markets resolve."* The `requestWithdrawal` endpoint validates against `withdrawableNow`, so the UI never offers an unfulfillable amount.

**Why share-of-redeemable, not share-of-contributed.** A subtle but important detail: the share fraction must use *net* contributions (`contributed - non-failed-withdrawn + payouts`), not gross. Otherwise `Σ withdrawableNow > redeemable` after any depositor partially withdraws — the vault would over-promise across depositors. With net-share, `Σ withdrawableNow ≡ redeemable` is an invariant. Tested at `distribution.test.ts`.

**What Jupiter could ship.** The architecturally clean fix lives at #26: a `@jup-ag/lend-vault` SDK module that wraps multi-depositor share-bookkeeping AND clamps notional to redeemable for any vault that holds non-instant-redeemable positions alongside Lend. Every yield product on Solana that touches Prediction (or perps, or any settled-on-resolution position) reinvents this same math. Today it's ~200 lines of accountant + balance + UI logic per team. As a Jupiter-side helper it would be ~50 lines that every vault inherits.

The full diff for the fix lives in this repo's commit history under "DX-GAP-#28 fix" — accountant + balances + withdrawals + me-page UI + 9 new tests. Use it as the starter pattern for the helper.

**Production validation note.** The same coordinated robustness pass that shipped the #28 fix also added a blockhash-expired retry helper at `apps/orchestrator/src/tx.ts`. It fired in production on 2026-05-07 during the rebalance compound deposit — the helper caught a real `TransactionExpiredBlockheightExceededError` on a $12.50 jlUSDC deposit, refreshed the blockhash, retried, and confirmed signature `53gKbomXbhZNa9nQHqizZk57nrSyk3dRsSm35YNcjam1HvAbxoVsGZKSHtqKRsa7MssBUj2Kc8zWpYu7knLha5Ex`. Real-world validation of the same engineering pass that produced this finding.

**Severity:** high. UX integrity for any vault-shape product on Lend Earn.

### DX-GAP-#29 — Basket config not hot-reloaded; tsx watch only tracks imports

The orchestrator's hedge basket lives at `apps/orchestrator/basket.config.json` and is read at runtime via `readFileSync(path)` in `rebalance.ts:loadBasket`. When we needed to swap markets mid-build, we edited the file and triggered a rebalance — and the orchestrator placed the order against the *old* market ID anyway. Two compounding causes:

1. `tsx watch` only watches files imported via `import` statements. JSON files read via `readFileSync` are invisible to its dependency graph, so the dev process never restarts on a JSON edit.
2. We cache the parsed basket in module-level `cachedBasket`. Even if tsx watch had detected the change, the cache wouldn't refresh until the process actually restarts.

Cost: ~10 minutes of confusion plus an unnecessary on-chain attempt against a market that returned 400 (`No shares available at this price`) before we figured out why the new basket wasn't taking effect.

**Fix on our side (already shipped):** documented in `CLAUDE.md` that JSON config changes require a hard restart. Cleaner alternative would be `import basketJson from '../basket.config.json'` (with `resolveJsonModule: true` in `tsconfig`), so tsx's dependency graph picks it up — but then we'd lose the runtime-edit-and-trigger pattern entirely. Tradeoff worth being aware of.

**Fix Jupiter could ship:** a "Production hardening" section in the `integrating-jupiter` Skill flagging this generic Node DX trap. Not Jupiter-specific per se, but the integrating-vault pattern (curated config + hot-reload-without-restart) is common enough that the Skill is the right place for the warning.

**Severity:** low (one-time confusion per integrator; obvious in hindsight).

### DX-GAP-#30 — Partial fill is silent; placement-time contract count drifts from final fill

Placed an order via `POST /prediction/v1/orders` with $6 USDC deposit at NO ask $0.32 → response said `contracts: 17`. The keeper filled only **16** of those contracts. The order status went to `partiallyfilled` and stayed there (the unfilled portion sits as a resting limit order indefinitely until matched).

```
# Placement (POST /orders response):
{ "contracts": "17", "depositAmount": "6000000", ... }

# Final (GET /positions/{id}, queried minutes later):
{ "contracts": 16, "totalCostUsd": 5120000, ... }
```

The 1-contract gap is real USDC sitting as a resting bid. For vault products that maintain local mirrors of position state (we do, in `apps/orchestrator/src/db/schema.ts:hedges`), the placement-time count drifts permanently from the on-chain truth until reconciled.

We hit this two ways:
1. The `openHedge.ts` script wrote `contracts=17` to the local table at placement time. The actual filled value is 16. We had to manually `UPDATE hedges SET contracts=16, cost_basis_usd=5.12 WHERE position_pubkey='Z8vTm...'` to reconcile.
2. The `partiallyfilled` state is mentioned nowhere in [open-positions](https://developers.jup.ag/docs/prediction/open-positions). An integrator hitting small markets with shallow NO-side depth will encounter it on first try and have to figure out the convention from the response.

**Fix:**
- **API:** extend `POST /orders` response with `contractsFilled` that the server polls-and-updates, OR ship a webhook / SSE feed of order-state transitions so integrators don't have to poll `/positions/{id}` to discover final state.
- **Docs:** add a "Partial fills" section to the open-positions guide. Cover the `partiallyfilled` lifecycle, the resting-bid implication, and the recommended polling interval.
- **SDK pattern:** the eventual `@jup-ag/api-client` package (per #11) should expose a `placeAndAwaitFinalFill` helper that polls until `filled` or `partiallyfilled` (resting), with timeout, and returns the final contract count.

**Severity:** medium for vault products (local-state drift is invisible until reconciled); low for one-shot consumers.

### DX-GAP-#31 — `/markets/{id}` returns nullable liquidity fields with undocumented status conventions

We queried 5 markets from our basket. 3 returned `status: "closed"` with all liquidity-relevant fields nullable; 2 returned `status: "open"` with real numbers. Compressed example:

```json
{ "title": "↑ 80,000",  "status": "closed", "pricing": { "buyYesPriceUsd": null, "buyNoPriceUsd": null }, ... }
{ "title": "↑ 90,000",  "status": "open",   "pricing": { "buyYesPriceUsd": 690000, "buyNoPriceUsd": 320000 }, ... }
```

Two compounding friction points for an integrator probing markets:

1. **Field name inconsistency between endpoints.** `GET /events` returns markets with an `isLive` boolean (we rely on it in `findMarket.ts:21`). `GET /markets/{id}` doesn't have `isLive` — it has `status` (with values `"open" | "closed"` we discovered empirically). Same concept, different field name, no cross-endpoint documentation.
2. **Pricing fields go null instead of returning structured "not tradeable" reasons.** Integrators have to grep for `status === 'closed'` AND null-check `pricing.buyNoPriceUsd` defensively, because the response shape doesn't tell them which signal to trust. We initially queried `.buyNoPriceUsd` at the response root (where it doesn't live — it's nested under `.pricing`), got null, and concluded the markets had no liquidity. They actually had different problems (some closed, some had real prices we missed because of the wrong jq path). Cost: ~15 minutes of misdiagnosis.

**Fix:**
- **Field naming:** unify on either `isLive: boolean` everywhere or `status: "open"|"closed"|...` everywhere. Pick one and migrate. `status` is the more flexible choice (room for `paused`, `resolving`, etc.) but `isLive` is the simpler one. Either is better than both.
- **Response shape annotation:** every endpoint doc page should show a real example response inline, with field paths called out. We hit this against #20 too — same fix.
- **Structured tradability:** consider `tradability: { yesAvailable: boolean, noAvailable: boolean, reason?: string }` instead of nullable pricing fields. Lets integrators write `if (m.tradability.noAvailable) { … }` without null-checking gymnastics.

**Severity:** medium. Every integrator probing markets at runtime hits this.

### DX-GAP-#32 — Multiple in-process caches with no documented invalidation contract

Our orchestrator has a 15-second TTL cache on `/vault/info` (the most-read endpoint), wired to a `bustVaultInfoCache()` helper that admin HTTP endpoints call after any mutation. We hit the contract gap when we opened a hedge via the `openHedge.ts` script (which talks straight to Jupiter + Solana, bypassing the orchestrator's HTTP layer): `/vault/info` continued serving "no hedges" for ~15 seconds after the hedge confirmed on chain, until the TTL expired naturally.

**Caches in our orchestrator that need explicit invalidation contracts:**

| Cache | Module | Invalidation today |
|---|---|---|
| `vaultInfoCache` | `index.ts` | Busted on `/admin/*` HTTP mutations only |
| `cachedBasket` | `rebalance.ts` | Restart only (see #29) |
| `cachedJlUsdcMeta` | `lend.ts` | 30s TTL, no manual bust |
| `fallbackConnectionCache` | `wallet.ts` | Never invalidated (process lifetime) |
| `cached` (vault keypair) | `wallet.ts` | Never invalidated (process lifetime) |

Plus the SQLite tables, which are the fact-of-record — but the cached *views* of them above all need invalidation when state mutates outside the HTTP layer.

This is the same family as #29: state changes that the running process needs to be told about, with no canonical pattern for telling it. Vault-shape products are inherently multi-modal in how state changes (HTTP admin actions, scripted writes, scheduled rebalances, SQLite migrations), and the right invalidation pattern depends on which entry point fired. We discovered our four entry points empirically.

**Fix on our side:**
- A `POST /admin/cache/bust` endpoint that scripts can hit before exiting. Two lines of code.
- Or: a SQLite trigger on `hedges`/`deposits`/`withdrawals` that writes a `version` row to `vault_state`; HTTP cache reads check the version before serving. More plumbing but no manual invalidation needed.

**Fix Jupiter could ship:** the eventual `@jup-ag/lend-vault` helper (per #26 / #28) should bake in a recommended cache-invalidation pattern. State changes in vault-shape products on Lend Earn aren't ad-hoc — they happen at known moments (deposit confirmed, hedge opened, claim swept, withdrawal settled). A canonical "lifecycle hooks" surface (`onHedgeOpened`, `onClaimSwept`, etc.) would let vault builders plug invalidation in without reinventing the contract.

**Severity:** low-medium. Dev-time confusion; in production a 15-second cache lag is invisible to depositors. But the pattern compounds — every cache layer added without an explicit contract is one more thing future-you has to remember.

---

## AI Stack — what worked, what didn't, what's missing

> **Detailed companion document:** [`docs/ai-stack/FEEDBACK.md`](./docs/ai-stack/FEEDBACK.md) is the primary deliverable for the bounty's 25% AI-stack feedback weight. It covers each of the four components (Skills × 2, CLI, MCP, llms.txt) with structured per-tool analysis, scores, and prioritized recommendations. The summary below is an executive recap; the FEEDBACK.md is where the depth lives.

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

## What we shipped, end to end (so this report's claims match the code)

Because we believe a DX report shouldn't be measured against a product description that overpromises, here's what's actually wired in `apps/orchestrator/`:

| Surface | Where | What it does |
|---|---|---|
| **Yield → hedge composition** | `rebalance.ts:179-221` | Reads accrued yield as `min(sum-of-deposits, lendUsdc)` vs `lendUsdc`, withdraws the delta from Lend Earn, persists to `yield_withdrawals`, re-reads wallet balance, then allocates per `HEDGE_BUDGET_FRACTION`. The "yield finances hedges" claim matches the code. |
| **Pro-rata payout distribution** | `accountant.ts:140-190`, `claimer.ts:106-129` | Every claim sweep allocates the gross payout per share fraction, persists per-depositor entitlements in `claim_distributions` keyed on `(positionPubkey, depositorWallet)`. Sum of allocations is checked to equal gross payout in tests. |
| **Withdrawal flow** | `withdrawals.ts`, `/api/withdrawals/request` | Signed-message proof, balance validation (`contributed - withdrawn + payouts`), inline settlement if vault has free USDC, otherwise queue + auto-settle on next rebalance via `processPendingWithdrawals`. Tops up from Lend Earn if needed. |
| **Sign-message auth** | `nonces.ts`, `auth.ts` | Server-issued nonces bound to `(wallet, purpose)`, canonical message format `ballast:<purpose>\nnonce=<n>\n<sorted-bindings>`, ed25519 verification via tweetnacl. Replay-resistant (one-shot consume). |
| **Admin auth** | `auth.ts:requireAdmin` | Bearer token middleware on `/admin/*`. `/rebalance/trigger`, `/claim/sweep`, `/claim/:id`, `/withdrawals/process`, `/depositors` are all gated. Constant-time comparison; 503 if env not set, 401 if mismatch. |
| **Public depositor PII fix** | `/vault/aggregate` replaces `/api/depositors` | Public endpoint returns only `{ depositorCount, totalContributedUsdc }`. Full list is admin-only. |
| **Auto-deposit-recovery watcher** | `depositWatcher.ts`, runs at boot + every rebalance tick | Periodic scan of recent vault USDC ATA signatures, cross-referenced with the `deposits` table. For anything not yet recorded, parses the SPL transfer, classifies the source authority via `PublicKey.isOnCurve()` (off-curve = PDA = vault internal flow → skip; on-curve = user wallet → record). This closes the most realistic real-world failure mode: a user signs an SPL transfer, it lands on chain, but the orchestrator was unreachable when the confirm endpoint fired. Without it, funds are stuck until an admin manually runs a recovery script. With it, the next rebalance tick (within minutes) reconciles automatically. We discovered this gap during live testing (a user's $3 deposit was stranded; manual recovery fixed it; this watcher prevents it next time). 12 unit tests cover the on-curve/off-curve classifier, the SPL-transfer-finder for top-level + inner instructions, and the amount extraction. |
| **v1 share-accounting model** | `accountant.ts`, `db/schema.ts` | Cumulative-deposit share accounting: each depositor's share fraction = `theirContributed / totalContributed`. Position value rendered on `/me` is `vaultTvl × shareFraction`. This is a deliberate v1 scope choice forced by Jupiter Lend Earn's per-keypair `UserSupplyPosition` (see [DX-GAP-#26](#dx-gap-26--vault-shape-products-need-a-share-token-pattern-from-lend-earn)): a multi-depositor vault on Lend has to keep its own off-chain ledger because the protocol surface doesn't expose a share-token primitive. The trade-off is that a depositor entering after the vault has earned yield gets the same share-per-dollar as an early depositor — fine for a hackathon vault, would migrate to share tokens or vault-shape Lend SDK if Jupiter ships one. |
| **DX-GAP-#28 fix (honest withdrawable)** | `accountant.ts`, `balances.ts`, `withdrawals.ts`, `index.ts`, `MePageClient.tsx` | New `getDepositorWithdrawable({ wallet, redeemableVaultUsdc })` clamps the depositor's notional balance to `min(notional, shareFraction × redeemable)`, where `redeemable = walletUsdc + lendUsdc` (excludes hedge mark). The `/me` page surfaces "Withdrawable now" as the headline number with an amber callout when notional > redeemable. The `requestWithdrawal` endpoint validates against `withdrawableNow` so the UI never offers an unfulfillable amount. Side-fix: `getDepositorNetBalance` now filters `status != 'failed'` (failed simulations were silently leaking from depositor balances). 9 new tests at `distribution.test.ts`. See [DX-GAP-#28](#dx-gap-28--we-shipped-a-vault-on-lend-earn-hit-dx-gap-26-in-production-and-fixed-it-ourselves) for the full field report. |
| **Robustness layer** (2026-05-06/07) | `tx.ts`, `balances.ts`, `wallet.ts`, `index.ts`, `rebalance.ts`, `withdrawals.ts` | Six-item coordinated pass: (1) **persisted rebalance cooldown** in the `vault_state` SQLite table — survives orchestrator restart, prevents a crash inside the cooldown window from bypassing the gate; (2) **decoupled withdrawal worker** cron (`*/10 * * * *`) with race-safe atomic soft-lock so the rebalance and withdrawal crons can't double-settle a row; (3) **`/vault/info` cache bust** on every admin mutation; (4) optional **multi-RPC fallback** (`SOLANA_RPC_URL_FALLBACK` + `withRpcFallback` helper for read paths only — write paths preserve blockhash freshness contract); (5) **per-route rate limit** on `/api/me/:wallet` (60 req/min/IP via `@fastify/rate-limit`, registered in an encapsulated sub-plugin so its `onRoute` hook fires correctly); (6) **blockhash-expired retry helper** at `tx.ts` for V0 transactions we control fully (Lend deposit/withdraw + depositor SPL settlement). **One item validated by a live mainnet fault** on 2026-05-07: the blockhash retry caught a real `TransactionExpiredBlockheightExceededError` on a $12.50 jlUSDC compound deposit, refreshed the blockhash, retried, and confirmed signature `53gKbomXbhZNa9nQHqizZk57nrSyk3dRsSm35YNcjam1HvAbxoVsGZKSHtqKRsa7MssBUj2Kc8zWpYu7knLha5Ex`. The pass shipped on 2026-05-06; the production validation hit landed the next day on the same engineering surface. |
| **Tests** | `*.test.ts` | 46 tests across share math, distribution allocation, balance computation, redeemable-share math (the DX-GAP-#28 fix — 9 new tests covering single-depositor, multi-depositor, hedge-locked, failed-withdrawal-exclusion edge cases), nonce verification (replay/wrong-wallet/wrong-purpose/tampered-amount), basket-config validation, deposit-watcher classification. |

These are the pieces we judged ourselves on after an internal review: the things a careful judge would grep for. Nothing in this DX report describes a feature that doesn't ship.

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

- **`POST /prediction/v1/markets/by-asset?underlying=BTC&direction=below&strikeRange=...`** — let us discover hedge-relevant markets without keyword-grepping titles. (See [#4](#dx-gap-4--no-structured-market-discovery-endpoint-basket-curators-must-keyword-grep-titles).)
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

The Jupiter Developer Platform is good — the new unified base URL, the AI Stack investment, the keyless tier for prototyping, the CLI's design principles. The 31 findings above are mostly edges, not core defects. The biggest single thing you could do is **ship the CLI's normalizers as a public SDK** and **annotate units in every numeric field**; together those two changes would account for maybe a third of the friction we hit. The single highest-leverage SDK addition is **`@jup-ag/lend-vault`** — see #26 / #28 / #32 for why every vault on Lend Earn re-implements the same 200 lines.

**One finding upstreamed.** [jup-ag/agent-skills#20](https://github.com/jup-ag/agent-skills/pull/20) proposes the fix for #13. Five field reports (#28–#32) are real production incidents we caught and shipped fixes for during the build — including a blockhash-expired retry that fired in production on the same day it shipped (signature [`53gKbom...`](https://solscan.io/tx/53gKbomXbhZNa9nQHqizZk57nrSyk3dRsSm35YNcjam1HvAbxoVsGZKSHtqKRsa7MssBUj2Kc8zWpYu7knLha5Ex)). The robustness layer that produced that fix is itself a deliverable; see the "What we shipped" table.

We'd build with this platform again. Good luck with the read-through — we ran out of pixels in our `/dx` page tracking how many calls we made, but the answer is "a lot, mostly successful, and the ones that weren't are now in this report."
