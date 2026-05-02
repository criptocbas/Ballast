# Ballast — AI Stack Feedback for Jupiter

**Submission for:** Jupiter "Not Your Regular Bounty" sidetrack · Solana Frontier Hackathon
**Project:** Ballast — a USDC vault where Jupiter Lend yield finances NO-contract hedges on tail-risk prediction markets
**Repo:** https://github.com/criptocbas/Reflux
**Email tied to Developer Platform:** sebastianbarrientosa@gmail.com
**Companion document:** [`DX-REPORT.md`](../../DX-REPORT.md) — the API/SDK feedback. This doc is the AI-stack-specific complement.

---

## TL;DR

1. **The CLI is the highest-leverage thing in the stack** — it's doing the data normalization the API should be doing. Promote those normalizers to a public package and you fix the integrator experience for everyone, not just CLI users.
2. **Skills are higher-stakes than docs because they push, docs pull** — `.claude/skills/*/SKILL.md` is auto-loaded into agent context, so a single misleading sentence (`"x-api-key required for Jupiter REST endpoints"`) becomes a *runtime instruction* that mis-shapes every integration the agent writes. We hit this twice.
3. **Documentation MCP was configured but never used during the build** — real signal you probably haven't heard. The MCP shines for "I'm writing initial integration code in-editor"; for our use case (post-bootstrap, debugging live behavior) it didn't compete with `curl <url>.md` + the Skill content already in context.
4. **`llms.txt` punched far above its weight.** A 200-line plaintext index was the single biggest accelerator on day one. Of everything in the stack, this is the surprise winner.
5. **The composition gap is the structural one.** Neither skill mentions Lend × Prediction (or any cross-product pattern). Our entire submission *is* the composition. We had to compose without guidance, and it worked, but a "Compose with other Jupiter products" section in `integrating-jupiter` would 10x agent productivity for vault-shape products on Solana.

A working product on Solana mainnet was shipped (live deposits, live Lend position, live hedge, live withdrawals). The stack helped. It also got in the way in concrete, fixable places.

---

## Test conditions — what produced this signal

**What we built (so the claims have weight).** Ballast is a custodial USDC vault with three on-chain integrations and an off-chain orchestrator:

- **Jupiter Lend Earn (jlUSDC)** — 1 live deposit at $1.00, ~4.36% APY ([Solscan tx](https://solscan.io/tx/4dKhnE1s5GGzidZ4v6h17P23D9FQyruya6viRDX2Yr9pUdYs8kTfT79LgCswhukeJnkzYh9DASk8t6c61rAA9R5M)).
- **Jupiter Prediction Markets** — 1 live NO-contract hedge, 26 contracts on `POLY-1345530` ([Solscan tx](https://solscan.io/tx/3vCCfi3CZ3fZUrXVucz2P4MEPrp2v23cGtkvi6ZPeXUd1iMX2FvUiJThu24vgQQ6fV9k4n8xqMPcC9TYPGPvS5HS)).
- **End-to-end depositor flow** — sign-message auth + SPL transfer + share accounting + auto-deposit-recovery + admin-gated withdrawal + claim sweeping. Live-tested with 3 deposits + 2 withdrawals across the build.

**What we used from the AI stack.** All four published components, install commands captured in [`docs/ai-stack/setup.md`](setup.md):

| Component | Version | Install |
|---|---|---|
| Skill: `integrating-jupiter` | 1.0.0 | `npx skills add jup-ag/agent-skills --skill integrating-jupiter --agent claude-code -y` |
| Skill: `jupiter-lend` | 0.1.2 | same install command, second skill |
| Jupiter CLI | 0.10.0 | `npm i -g @jup-ag/cli` |
| Documentation MCP | (server) | `.mcp.json` at repo root → `https://developers.jup.ag/docs/mcp` |
| `llms.txt` / `llms-full.txt` | (live) | `curl https://dev.jup.ag/docs/llms.txt` |

**Where this report's coverage stops.** We did not exercise the Documentation MCP at runtime (see §5). We did not use any optional Jupiter Skill we'd discover later (e.g. specific perp/swap skills). We did not test the Skills under any agent other than Claude Code. And we did not use Jupiter's Portal-side AI tools (if any exist) — only the four shipped public surfaces.

---

## How the stack mattered at each phase of the build

| Phase | Tool that mattered most | Tool that disappointed | Why |
|---|---|---|---|
| **Discovery** (0–60 min from `developers.jup.ag` to first JSON) | `llms.txt` | — | One curl, full index, immediately greppable in agent context. |
| **API probing** (`/events`, `/markets`, `/orderbook`, `/lend/v1/earn/tokens`) | Raw `curl` + Skill cross-reference | Skill (DX-GAP-#13: said key required when keyless works) | We wanted shape, not blessings. |
| **First Lend deposit** (typed SDK + on-chain) | `jupiter-lend` Skill (concept-level) | Same Skill at the API-name level (DX-GAP-#15: said `client.lend`, real is `client.lending`) | The concepts were right; the surface API was wrong. |
| **First Prediction hedge** (`POST /orders`, keeper fill) | CLI for shape probe (`jup predictions events --filter live`) | Skill (no Prediction-specific guidance worth memorizing) | The CLI returned what we needed; the skill described what we already knew. |
| **Composition** (yield → hedge wiring, the actual product) | NONE — gap | Skills (no cross-product section in either) | We composed without guidance. |
| **Production hardening** (auth, admin gates, share accounting, deposit-recovery watcher) | Skill's "production hardening" section was helpful generically | — | Generic but correct advice on retries, rate limit handling, idempotency. |
| **Debug-runtime issues** (e.g., why `markPrice` dropped 31% post-fill) | None — read SDK `.d.mts` + the live response | Documentation MCP (would have helped if we'd thought to ask) | We didn't reach for MCP. That's signal. |

---

## Component 1 — Skill: `integrating-jupiter`

**The model.** A 425-line `SKILL.md` covering all Jupiter API families with example wrappers, error-handling helpers, and a `jupiterFetch` quickstart. Auto-loaded into Claude Code from `.claude/skills/`. There's also a `examples/` subdirectory (`lend.md`, `swap.md`, `trigger.md`, `price.md`) with worked code samples.

### What worked
- **The quickstart wrapper** (`jupiterFetch`, `signAndSend`) saved real time. We didn't copy it verbatim, but reading it before writing our own `JupiterHttpClient` (`packages/shared/src/clients/`) was a high-quality template.
- **The triggers list** (`swap`, `quote`, `gasless`, `best route`, ...) made the skill activate at the right moments. No false positives.
- **Production hardening notes** (rate-limit handling at line 326, idempotency at line 414) were generic-correct advice we'd have thought of anyway, but having them encoded as a checklist sped up review.

### What didn't (with receipts)

**1. The "Auth: required" overstatement** — `SKILL.md:42` reads:
> **Auth**: `x-api-key` from [portal.jup.ag](https://portal.jup.ag/) (**required for Jupiter REST endpoints**)

The official docs (`https://dev.jup.ag/docs/llms.txt`, line 6) clearly state keyless access at 0.5 RPS works for many endpoints. We confirmed empirically: keyless works for `/events`, `/markets/{id}`, `/orderbook/{id}`, `/lend/v1/earn/tokens`. **An agent guided by the skill verbatim would fail-fast on a missing key during prototyping.** Skills are push-content; this kind of inaccuracy actively misleads. (Captured as DX-GAP-#13.)

**2. The composition gap** — neither skill has a "Compose with other Jupiter products" section. We were building Lend × Prediction (yield → hedge). The skill's `examples/lend.md` and the prediction guidance live in the same file but aren't linked as a *pattern*. Vault products on Lend are an entire shape (Kamino, Drift strategy products, every Drift-strategy product) — none of them are addressed.

**3. No stability tier per endpoint** — `integrating-jupiter` lists every Jupiter API family but doesn't differentiate `swap` (battle-tested) from `prediction` (pre-v1) from `studio` (alpha). Treating them all as equally-stable nudges agents to write production-bound code against unstable surfaces.

### What we'd add to this skill

- **"Compose with other Jupiter products" section.** A 50-line block listing supported and unsupported cross-API patterns: vault-on-Lend, hedge-with-Prediction, route-via-Swap-then-stake, etc. Each pattern with a 5-line code sketch.
- **Auth-tier table** mapping endpoint → required auth level (none / API key / API key + JWT). Replace the blanket "required" with this table. Two minutes to write, prevents every keyless-prototyping false start.
- **Stability tier per family** — embed a one-character marker (`✓ stable / β beta / α alpha`) in the trigger list and per-section header. Production integrators need this granularity.
- **Link to the worked examples up top** — `examples/lend.md` exists but the skill body doesn't reference it. Surface it.

### Score: 3.5 / 5
**Skill did real work for us, especially the quickstart wrapper. But it pushes inaccurate auth content into agent context, has no composition guidance, and doesn't differentiate stability tiers. The fixes are all <1 day of editing.**

---

## Component 2 — Skill: `jupiter-lend`

**The model.** A 596-line deep-dive on Lend specifically. SDK install instructions, glossary (jlToken, Exchange Price, Collateral Factor, Liquidation Threshold, etc.), worked TS examples for both read SDK (`@jup-ag/lend-read`) and write SDK (`@jup-ag/lend`).

### What worked
- **The glossary** (Architecture: Two-Layer Model, Tick-based Architecture, Sentinel Values like `MAX_WITHDRAW_AMOUNT`) was load-bearing. Without it, the field names in the SDK would have been opaque.
- **The dual-SDK split explanation** (`@jup-ag/lend-read` vs `@jup-ag/lend`) saved us the false-start of trying to read positions through the write SDK.
- **The `getDepositIxs` example** matched our actual usage 1:1. We landed our first $1 jlUSDC deposit on first try, simulation-then-send, no debugging needed. (Captured in [`docs/dx-log/02-first-lend-deposit.md`](../dx-log/02-first-lend-deposit.md).)

### What didn't (with receipts)

**1. The `client.lend` vs `client.lending` typo** — pre-update, the skill referenced `client.lend.getUserPositions(...)` but the SDK exposes `client.lending`. We hit a TS error and had to read the `.d.mts` to find the right name. (Captured as DX-GAP-#15.)

> **Status as of 2026-05-02:** This is **fixed in the current published version** of the skill. We re-ran `npx skills update -p` after our DX-REPORT was drafted and confirmed the skill now correctly uses `client.lending` at lines 84 and 87. We're calling this out positively — Jupiter's responsiveness on this kind of feedback is real.

**2. No vault-shape recipe.** The Lend skill correctly explains the per-keypair `UserSupplyPosition` model, but for products like Ballast (multi-depositor vaults) the depositor share accounting must happen entirely off-chain. Our `accountant.ts` is 200+ lines of share math because there's no Jupiter primitive to lean on. **A canonical "Building a multi-depositor vault on Lend Earn" recipe is the single missing piece for the long tail of yield-vault products that will be built on Lend.** (Captured as DX-GAP-#7 / #26.)

**3. Undocumented BN scale on rates from the SDK.** REST returns `supplyRate: "323"` (clean basis points). The SDK returns the same field as a `BN` with a ~1e10 scale, undocumented in the type's TSDoc. Anyone displaying APY from the SDK directly will silently render absurd numbers. We worked around it by sourcing the rate from REST and only using the SDK for on-chain position state. (Captured as DX-GAP-#17.)

**4. `userPosition.underlyingBalance` is the wallet balance, not the position value** — the field name strongly implies "what your jlToken position is worth" but it's actually the user's wallet balance of the underlying mint. We shipped a UI showing $7.00 for a $1.00 deposit until we caught it. The Skill mentions this only at the type level; a single warning paragraph in the SKILL.md body would have prevented the bug. (Captured as DX-GAP-#16.)

### What we'd add to this skill

- **A "Multi-depositor vault" section** with a worked TypeScript pattern: deposit → record per-depositor share → on withdrawal compute `share × current jlToken value`. This is the most common production pattern on Lend and currently has zero documentation.
- **Field name warnings** — short callout boxes like *"⚠ `userPosition.underlyingBalance` is the wallet balance, not the position value. Use `underlyingAssets` for position value."*
- **SDK-vs-REST discrepancy table** — explicitly flag the BN-scale rates and similar surprises.

### Score: 4 / 5
**Best in the stack at deep-dive guidance. The glossary alone saved a half-day. The remaining gaps are well-scoped and Jupiter is already iterating (the `client.lending` fix proves the loop works).**

---

## Component 3 — Jupiter CLI

**The model.** `@jup-ag/cli` v0.10.0, installed globally via `npm i -g @jup-ag/cli`. Subcommands cover every API family. Pre-v1 (early alpha), per docs.

### What worked

**1. The CLI's data shape is dramatically better than the raw HTTP API.** Same query, two surfaces:

```bash
# Raw HTTP — what we'd write integrating without the CLI
curl 'https://api.jup.ag/prediction/v1/events?category=crypto&limit=5'
# → market IDs only, no titles, no prices, micro-USD scale

# CLI
jup predictions events --category crypto --filter live --limit 5 -f json
# → titles inline, yesPriceUsd as decimal float, ISO timestamps
```

**This is the single biggest finding in the entire AI stack.** The CLI is doing the normalization the API does not. Every direct-API integrator has to reinvent the helpers `@jup-ag/cli` already implements. (Captured as DX-GAP-#11.)

**2. `--format json` is genuinely LLM-friendly.** Output is structured, parseable, and matches the shape integrators want. No quirky CLI-prose-output mode getting in the way.

**3. Subcommand discovery is clean.** `jup --help` lists families; `jup predictions --help` lists subcommands. No agent had to guess.

### What didn't

**1. Pre-v1 with no per-command stability marker.** A global "early alpha" warning makes it impossible to know what to depend on. `jup predictions events` looks rock-solid; `jup studio create-token` may be alpha. Production integrators need granularity. (Captured as DX-GAP-#14.)

**2. `noPriceUsd: null` on binary markets in events.** For NO-side strategies (insurance vaults like Ballast, mean-reversion bots) this forces an extra `/markets/{id}` round-trip per market or a `1 - yesPriceUsd` mirror calculation. Trivial to fix server-side. (Captured as DX-GAP-#12.)

**3. Inconsistent flag conventions.** `jup predictions buy --amount` is the deposit amount; `jup swap --from`/`--to`/`--amount` separates direction from quantity. Each subcommand felt right in isolation but the cross-command mental model required re-learning per family.

### What we'd add

- **Promote the CLI's normalizers to a public `@jup-ag/api-client` package.** This is the highest-leverage move available to Jupiter on the entire AI stack. Direct-API integrators get the same shapes the CLI ships with; the CLI itself becomes a thin wrapper. The work is *already done* — it's trapped behind a subprocess interface.
- **Per-subcommand stability badges in `jup --help`.** `jup predictions events ✓ stable` / `jup studio create-token α alpha`.
- **A `jup predictions sim --market <id> --side no --usd <n>` command** that returns the expected fill shape (contracts, fees, mark) without committing. We'd use it in our rebalance dry-runs.
- **Always-populate-both-prices on `events` output.** Server-compute the binary mirror so integrators don't have to.

### Score: 4 / 5
**Best-shaped surface in the entire stack. The fact that this exists is what makes Jupiter's AI story competitive at all. The structural fix — package the normalizers — is also Jupiter's biggest available product win.**

---

## Component 4 — Documentation MCP

**The model.** A project-scoped `.mcp.json` at the repo root pointing at `https://developers.jup.ag/docs/mcp`. Auto-discovered by Claude Code on next session. Provides searchable doc lookups in-editor.

### What we did
- **Configured it** (line 1–5 of `.mcp.json`).
- **Did not exercise it during the build.**

### Why we didn't use it (the actual signal)

This is the part Jupiter probably hasn't heard. Here's the honest report:

By the time we needed *runtime* help, our open questions were of the form *"this response field has shape X, what does X mean?"* — runtime behavior, not doc lookups. Our doc-lookup needs were all on day one and got served by `curl https://dev.jup.ag/docs/llms.txt` + dropping the result into the agent context. After that, every question was about live response shapes, error codes, or SDK behavior — things you don't answer by re-reading a doc page.

The MCP would have shone for someone earlier in the lifecycle: "I'm typing my first integration code in-editor, the agent looks up the right endpoint, scaffolds the call." We were already past that point by the time the MCP would have helped us.

**This isn't a criticism of the MCP itself** — it's calibration on *when* it shines. The honest signal is that for our use case (orchestrator-builder, post-bootstrap, debugging live behavior), MCP didn't compete with `curl <url>.md` plus the Skill content already auto-loaded.

### What would have made us use it

- **Runtime status surface.** A `jupiter_status` tool exposing open known issues / breaking changes / "service is degraded right now" so agents can warn users when they're about to hit a known bug. Today the agent has no way to differentiate "this looks broken" from "Jupiter shipped something Tuesday."
- **A `recent_docs_changes` tool.** "What's changed in the docs since 2026-04-15?" — would have prompted us to re-load specific pages instead of relying on stale agent memory.
- **An MCP tool that surfaces SDK type definitions inline.** When debugging `userPosition.underlyingBalance`, the right answer was *"the type's TSDoc says X, the actual semantic is Y"* — that's an MCP-shaped question we never thought to ask.

### Score: 2.5 / 5 (configured-but-unused)
**Real possibility, real value for a different phase of integration. For our build it didn't surface itself as the right tool. The MCP needs to articulate when it shines.**

---

## Component 5 — `llms.txt` / `llms-full.txt`

**The model.** Two plaintext files served at `https://dev.jup.ag/docs/llms.txt` (200-line index) and `https://dev.jup.ag/docs/llms-full.txt` (3000+ lines of doc content). Designed to be loaded into LLM context.

### What worked
- **Loaded once, navigated everywhere.** We dropped `llms.txt` into the Claude Code session at start and treated it as the spine of our context. Every "where do I look up X" question got answered without leaving the editor.
- **The structure is exactly right** — one-line summary per page, easy to scan, easy to grep with simple substring matches. No JSON-schema overhead, no chunk-and-vector retrieval, no MCP plumbing. Plaintext on the wire is a feature.
- **`llms-full.txt` for deep RAG-style lookup** — when a question needed full-doc context (e.g. "what's the Lend Earn deposit instruction's account list?"), `llms-full.txt` was right there.

**Of everything in the stack, this was the surprise winner.** It's the most boring tool and it did the most lifting on day one.

### What didn't
- **No section anchors in `llms-full.txt`.** Grepping for "open positions" returns the whole doc; we want to grab just the section. Inline anchor IDs would let agents `grep -A 50 "## Open Positions"` and load a precise slice.
- **No `llms-recent.txt` or `llms-changes.txt`.** We have no signal on what's changed since our agent's training cutoff or our last fetch. A "doc edits in the last N days" file would let agents re-load only the parts that changed.

### What we'd add
- **Inline section IDs in `llms-full.txt`.** `<a id="prediction-open-positions"></a>` so `grep -A 50 "prediction-open-positions"` works.
- **A `llms-changes.txt`** showing recent doc edits with timestamps. Agents re-load only the deltas.
- **A `llms-stability.txt`** — same content as `llms-full.txt` but only for stable APIs. For production integrators who don't want their agent suggesting alpha endpoints.

### Score: 4.5 / 5
**Highest leverage-per-byte in the stack. Easy to fix the rough edges. We'd build with this again before we'd build with anything else.**

---

## Cross-cutting observations

### 1. Skills are push, docs are pull — that's a higher-stakes content surface

When we configure `.claude/skills/integrating-jupiter/SKILL.md`, the entire 425 lines auto-load into agent context for every Jupiter-related task. Inaccurate content there isn't just an "incorrect doc page someone might miss" — it's a *runtime instruction* that mis-shapes every integration the agent writes. The auth overstatement (DX-GAP-#13) is exactly this: a single incorrect sentence at line 42 actively misleads the agent for an entire build.

**Implication for Jupiter:** The `jup-ag/agent-skills` repo deserves the same review process as docs *and* the same testing process as code. If the integration-test suite catches "did this docs example actually run?", the skill content needs the same: did the SKILL.md's claims survive a real build?

### 2. The CLI is doing work the API should be doing

Same query, two surfaces. CLI returns titles, decimals, ISO timestamps. API returns IDs, micro-units, unix epochs. **Every direct-API integrator pays the cost of reinventing what's already implemented in the CLI.** The architectural fix isn't "improve the CLI" — it's "promote the normalizers to a `@jup-ag/api-client` package OR push them into the API responses." The work is done. It just needs to escape the subprocess.

### 3. The composition gap

Ballast's entire submission is a composition: yield → hedge, Lend × Prediction. Neither skill addresses cross-product patterns at all. Both are organized as "here's how to use *this* product in isolation." The integrators most likely to read them are the ones building the most ambitious things — and those are exactly the integrators doing composition.

A "Compose with other Jupiter products" section in `integrating-jupiter` (50 lines, 5 worked patterns) would be the single highest-leverage addition to the entire AI stack for vault-shape products on Solana.

### 4. The discoverability problem — there's no front door

Today the AI page (https://developers.jup.ag/docs/ai) is organized **by tool**: Skills, CLI, MCP, llms.txt. That's correct for a builder browsing what exists. It's wrong for an agent (or builder) reaching for the right tool at the right moment. The right structure is **by goal**:

| Goal | Best tool |
|---|---|
| Discover Jupiter's API surface from scratch | `llms.txt` |
| Write integration code in-editor | `integrating-jupiter` skill + `examples/*.md` |
| Probe response shapes before integrating | CLI (`jup ... -f json`) |
| Look up a specific endpoint mid-build | Documentation MCP OR `curl <docs>.md` |
| Execute write operations from a script | CLI OR raw HTTP using skill's `jupiterFetch` wrapper |
| Debug live runtime behavior | None of the above — read `.d.ts`, log responses |

Some tools appear twice; that's fine. Some goals have no good tool — that's also signal.

### 5. We never wrote a single line of code copy-pasted from any tool

The skills served as **constraint check** (read first to understand what's available, then write actual code from API schemas + types). The CLI served as a **probe tool** (figure out response shape, then write client code). The llms.txt served as **context spine** (search-first, load-precise, write).

That's the honest pattern. None of these tools generates code we ship. They make the agent **less wrong** when it writes code we ship. That's the right framing — and it suggests Jupiter's investment should focus on accuracy and shape correctness over example breadth.

---

## Top recommendations (ranked by leverage)

1. **Ship `@jup-ag/api-client` as a public package** mirroring the CLI's normalizers. Single highest-leverage change available. The work is done. (See Component 3 / DX-GAP-#11.)
2. **Add an "Auth tiers" table to `integrating-jupiter` SKILL.md** replacing the blanket "required" sentence. Two-minute change, removes a high-stakes runtime error mode. (See Component 1 / DX-GAP-#13.)
3. **Add a "Compose with other Jupiter products" section to `integrating-jupiter`** with 3-5 worked patterns: vault-on-Lend, hedge-with-Prediction, route-via-Swap-then-deposit. Closes the composition gap that costs every advanced integrator. (See Component 1 cross-cutting #3.)
4. **Mark each CLI subcommand with stability tier** (`stable / beta / alpha`). Lets production integrators adopt the stable parts now and watch the unstable parts. (See Component 3 / DX-GAP-#14.)
5. **Reorganize `developers.jup.ag/docs/ai` by goal, not by tool.** Three-section taxonomy (Discover → Write → Execute → Debug) with the right tool per row. Builders who've never used the AI stack pick the right entry point. (See Cross-cutting #4.)

---

## What we'd build if we were on Jupiter's team

Beyond bug fixes — strategic moves that would compound:

### 1. A "vault helper" SDK module on Lend (`@jup-ag/lend-vault`)

Wraps the multi-depositor share-bookkeeping pattern. Today every yield product on Solana (Kamino, Drift, MarginFi strategies, every YieldFi-shape product, Ballast) reinvents the same SQLite schema. A canonical recipe lifts the long tail.

### 2. An `ai-stack-version.json` dropped at the repo root by `npx skills add`

Lists every skill / CLI / MCP version installed and links the install command. On every agent context load, the skill checks current vs latest and warns the user. Today users (including us) don't notice when a skill ships a fix unless they re-run install manually.

### 3. A `jup_telemetry` opt-in on the CLI

`jup --opt-in-telemetry`: anonymized counts of which subcommands integrators actually use, which flags get reached, which errors fire. Today Jupiter is shipping the AI stack into a vacuum on usage signal. We'd have happily opted in for a sticker.

### 4. `developers.jup.ag/dx` — a marketing page that's a live integration trace

Just like Ballast's `/dx` page (which we built because we needed it for our submission), a Jupiter-side anonymized live feed of real integrations would be a stronger trust signal than the current marketing copy. *"Watch real integrators hit our APIs right now. The latency is real. The success rate is real."*

### 5. A "stability heuristic" pre-commit hook in `jup-ag/agent-skills`

Every example in every SKILL.md gets parsed, run against a sandbox `api-staging.jup.ag` instance, and the test fails the PR if the response shape changed. Skills become as testable as code. The `client.lend` typo would have failed CI.

---

## Coverage matrix — how much of the stack we actually touched

| Surface | Calls / consultations | Result |
|---|---|---|
| `integrating-jupiter` SKILL.md | Auto-loaded for ~80 agent turns | Correct concept-level guidance, two specific inaccuracies (DX-GAP-#13, #15) |
| `jupiter-lend` SKILL.md | Auto-loaded for ~30 agent turns | Glossary saved a half-day; SDK API names misled once (DX-GAP-#15, fixed upstream) |
| `integrating-jupiter/examples/lend.md` | Read once at first integration | Helpful template, not copy-pasted |
| Jupiter CLI | ~15 invocations across `predictions events`, `predictions buy` (dry-run), `lend earn deposit` | Best-shaped surface; structural normalization gap (DX-GAP-#11) |
| Documentation MCP | 0 runtime uses | Configured but never exercised — signal on when MCP shines |
| `llms.txt` | Loaded once at session start, referenced ~50 times via grep | Single biggest accelerator |
| `llms-full.txt` | Loaded for ~5 deep-dive lookups | Useful but missing section anchors |

**Total Jupiter API calls during the build (live data):** captured in the orchestrator's `dx_observations` table and surfaced at https://github.com/criptocbas/Reflux/tree/main/apps/web/src/app/dx (and the local `/dx` endpoint while running). Across 5 Jupiter API families and ~13 endpoints, all hit live on Solana mainnet.

---

## Closing

The Jupiter AI stack is competitive *because* it has all four legs (skills, CLI, MCP, llms.txt). No other DeFi platform on Solana has shipped this much agent-shaped tooling. The 12 numbered findings in this doc are mostly edges, not core defects.

The single biggest thing Jupiter could do is **promote the CLI's normalizers to a public package**. Doing so would fix the integration experience for everyone — direct-API users included — at the cost of a single sprint of refactoring. Beyond that, the skill-content accuracy work (auth tiers, composition section, stability markers) is all <1 day of editing and would meaningfully reduce the friction we hit.

We'd build with this stack again. We'd recommend it to the next vault-shape team on Solana. And we'd lobby hard for `@jup-ag/api-client`.
