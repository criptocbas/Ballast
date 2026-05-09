# Ballast — Architecture

**Status:** v1 shipped on Solana mainnet — captured as a live design doc
**Originally drafted:** 2026-04-30 (planning)
**Last refreshed:** 2026-05-07 (post-build, reflects what actually shipped)

> This doc started as a v1 design plan and was kept in sync as we built. Where the build deviates from the plan, the deviation is noted (and usually backed by a DX-REPORT finding that explains why). For the public-facing summary see [`README.md`](./README.md); for the depth on integration findings see [`DX-REPORT.md`](./DX-REPORT.md) and [`docs/ai-stack/FEEDBACK.md`](./docs/ai-stack/FEEDBACK.md).

---

## One-line product

> A USDC vault where Jupiter Lend yield finances NO-contract hedges on tail-risk prediction markets. Depositors keep residual yield in normal times; receive payouts when tail events hit.

---

## System diagram (text)

```
                  ┌──────────────────────────────────────────────────┐
                  │                    BALLAST                       │
                  ├──────────────────────────────────────────────────┤
                  │                                                  │
   USER ─wallet──▶│  apps/web (Next.js)                              │
                  │   ├─ /deposit                                    │
                  │   ├─ /vault (TVL, hedges, projected payouts)     │
                  │   ├─ /me (depositor share, P&L, claim)           │
                  │   └─ /dx (read-only DX log for transparency)     │
                  │                                                  │
                  │             ▲                  ▲                 │
                  │   read API  │                  │  signs / claims │
                  │             │                  │                 │
                  │  apps/orchestrator (Node service)                │
                  │   ├─ rebalanceLoop()  (cron, daily)              │
                  │   ├─ depositorAccountant (share math)            │
                  │   ├─ basketSelector (tail-risk market curator)   │
                  │   ├─ hedgeExecutor (places NO orders)            │
                  │   ├─ claimReaper (settles winning positions)     │
                  │   └─ eventLog (audit + DX log surface)           │
                  │             │                                    │
                  │             ▼                                    │
                  │  packages/shared (types + Jupiter API clients)   │
                  │                                                  │
                  └──────────────────────────────────────────────────┘
                              │
                              │ HTTP/JSON
                              ▼
              ┌──────────────────────────────────────┐
              │   Jupiter Developer Platform APIs    │
              │   ├─ /lend/v1/earn/*  (Earn vault)   │
              │   ├─ /prediction/v1/* (markets, ord) │
              │   ├─ /swap/v2/*       (conv & settle)│
              │   ├─ /tokens/v2/*     (asset meta)   │
              │   └─ /portfolio/v1/*  (positions)    │
              └──────────────────────────────────────┘
                              │
                              ▼
                    Solana mainnet (Lend Earn position,
                    Prediction Market YES/NO contracts)
```

---

## Custody model (v1: transparent custodial)

For the hackathon scope, Ballast v1 is **explicitly custodial**:
- A single Solana keypair (the "vault keypair") holds all deposits and Jupiter positions.
- The keypair is owned by the orchestrator (private key in env var, server-side only).
- Depositors trust Ballast to honor the share accounting and withdrawal flow.

**Why custodial v1:**
- Eliminates the smart-contract risk surface (we'd need an audited vault program for trustless v1)
- Keeps the project shippable in 14 days
- Lets us focus all time on Jupiter API integration depth (the actual judging criterion)
- Vault model is well-trodden in DeFi (yearn-v1 style); not a stigma

**v2 path** (out of scope, but documented for narrative): on-chain vault program issuing share tokens, with deposits/withdrawals atomic. We acknowledge this in submission.

**Mitigations in v1:**
- All deposits/withdrawals are on-chain Solana transactions, fully auditable
- Orchestrator publishes the vault address publicly; anyone can verify Lend Earn balance and Prediction positions
- Read-only DX log on `/dx` page shows real-time state
- Withdraw flow requires the depositor's connected wallet to sign

---

## Asset choice

**v1 deposit asset: USDC.**
- Largest TVL on Jupiter Lend Earn (~$437M at submission)
- ~4.24% APY at submission (rate floats; was ~4.36% at planning time — captured in `dx-log/04-rebalance-economics.md`)
- Most familiar to non-power-user depositors

**v1.5 stretch: JUICED (jlJupUSD)** — ~5% APY range, plus signals "Jupiter-native" composition (depositing Jupiter's stablecoin into Jupiter's lender). Surfaced on the `/vault` page rates table for any future depositor who wants the higher-yield asset; v1 keeps USDC for familiarity and price stability.

---

## Hedge basket selection (v1: curated, deterministic)

For v1 we **manually curate** a basket of tail-risk markets. We do not let AI pick markets in v1 — that's a separate complexity surface. Curation lives in a single config file the orchestrator reads.

Candidate categories:
1. **BTC downside** — buy NO on bullish-strike BTC markets (e.g., "BTC > $X by date" markets where current implied probability suggests pricing inefficiency)
2. **Macro shocks** — Fed decision markets, oil price markets, recession-related markets
3. **Volatility events** — short-dated daily markets ("BTC up/down today")
4. **Geopolitical** — ceasefire-extension markets that affect global risk (correlated with crypto)

Sizing algorithm (v1):
1. Compute available premium budget = accrued yield (or wallet inflows during rebalance) × `HEDGE_BUDGET_FRACTION` (default 50%)
2. Walk the basket markets, allocate per-market budget = `hedgeBudget × weight`
3. Skip any market where `allocation < $5` (Jupiter Prediction's documented minimum — DX-GAP-#18, #24)
4. Skip any market the vault already holds a position in (no doubling-up in v1)
5. Place a BUY NO order for each remaining allocation via `POST /prediction/v1/orders`

**Deviation from original design:** the planned 5-market diversified basket (35/25/20/10/10 split) was compressed to a **single-market basket** for the live submission demo (POLY-1345531, BTC > $90k EOY 2026, weight 1.0). Reason: the original $5 minimum × small TVL economics meant no per-market allocation cleared the threshold (DX-GAP-#24 in production). The full diversified basket is preserved in `apps/orchestrator/basket.config.json` under `_inactive_diversified_basket_NEEDS_RECURATION` for v1.5 — the closed markets there need re-curation against current market state before restore.

We deliberately keep this simple for v1. Sophistication = v2.

---

## Rebalance cadence

**Daily, 00:00 UTC.** Run the rebalance loop:
1. Refresh state (Lend Earn position, current hedges, depositor table)
2. Withdraw accrued yield from Lend Earn (computed from share growth)
3. Convert any non-USDC payouts to USDC via Swap V2
4. Settle / claim any resolved positions (Prediction Market `claim`)
5. Allocate freed USDC: 50% back to Lend Earn (compounding), 50% to new hedges
6. Place new hedge orders per the basket selector
7. Persist event log

---

## Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Monorepo | pnpm workspaces | Standard, fast, no Turbo complexity needed |
| Lang | TypeScript (strict) | Required for type-safe Jupiter API clients |
| Frontend | Next.js 16 (App Router) + Turbopack dev | Server components for data-heavy pages. **Note:** Next.js 16 has breaking changes vs LLM training data — see `apps/web/AGENTS.md`. |
| Style | Tailwind v4 + shadcn/ui | Fast, professional defaults |
| Orchestrator | Node 22 + TypeScript | Same language as frontend; easier reuse |
| State store | SQLite + Drizzle ORM | File-based, zero-config, perfect for hackathon scale |
| Solana | `@solana/web3.js` + `@solana/spl-token` | Standard, well-documented |
| Jupiter SDK | `@jup-ag/lend`, `@jup-ag/lend-read` | Per Jupiter docs |
| AI Stack | Jupiter CLI + Skills + Docs MCP | **Required for the AI Stack feedback category (25%)** — used during development |
| Wallet | `@solana/wallet-adapter-react` | Standard Solana wallet adapter |
| Test | Vitest | Modern, fast, TS-native — 52 tests (6 shared + 46 orchestrator) at submission. |
| Robustness | `node-cron` + `@fastify/rate-limit` + custom helpers in `tx.ts` / `balances.ts` | Persisted rebalance cooldown (`vault_state` SQLite table), decoupled withdrawal worker cron (`*/10 * * * *` with race-safe atomic soft-lock), multi-RPC fallback (`SOLANA_RPC_URL_FALLBACK` + `withRpcFallback` for read paths), `/api/me/:wallet` rate-limit, `/vault/info` cache bust on admin mutations, blockhash-expired retry helper for V0 transactions. The retry helper fired in production on 2026-05-07 — caught a real `TransactionExpiredBlockheightExceededError` on a $12.50 Lend deposit and recovered cleanly. Real-world validation. |
| DX-GAP-#28 fix | `accountant.ts`, `balances.ts`, `withdrawals.ts`, `MePageClient.tsx` | Honest withdrawable computation: `min(notional, shareFraction × redeemableVaultUsdc)` where redeemable excludes hedge mark. Surfaced as "Withdrawable now" on `/me` with an amber callout when notional > redeemable. Side-fix: failed withdrawal rows no longer silently leak from depositor balances (filter `status != 'failed'`). |
| Lint/format | ESLint + Prettier | Standard |

---

## Project layout

```
ballast/
├── apps/
│   ├── web/                 # Next.js 16 (App Router)
│   │   ├── app/
│   │   │   ├── page.tsx          (landing)
│   │   │   ├── deposit/page.tsx
│   │   │   ├── vault/page.tsx
│   │   │   ├── me/page.tsx
│   │   │   └── dx/page.tsx
│   │   ├── lib/                  (server-side data fetching)
│   │   └── components/
│   └── orchestrator/        # Node service
│       ├── src/
│       │   ├── index.ts          (entrypoint, cron)
│       │   ├── rebalance.ts
│       │   ├── basket.ts         (curated hedge basket config + selector)
│       │   ├── accountant.ts     (depositor share math)
│       │   ├── executor.ts       (Prediction order placement)
│       │   ├── claimer.ts        (resolved-position claim flow)
│       │   └── eventLog.ts
│       └── basket.config.json    (curated markets)
├── packages/
│   └── shared/              # Types + Jupiter API clients
│       └── src/
│           ├── types/            (Lend, Prediction, Swap, Tokens types)
│           ├── clients/          (typed fetch wrappers)
│           └── utils/            (micro-USD helpers, etc.)
├── docs/
│   ├── api-research/        (live-probe findings)
│   ├── product-spec.md      (this doc + scope)
│   └── dx-log/              (running DX report content)
├── ARCHITECTURE.md
├── DX-REPORT.md             (built incrementally; final submission)
├── README.md
├── pnpm-workspace.yaml
└── package.json
```

---

## API integration depth (the 25% category)

| API | Endpoints used | Purpose in Ballast |
|---|---|---|
| **Lend Earn** | `/lend/v1/earn/tokens`, `/lend/v1/earn/deposit`, `/lend/v1/earn/withdraw`, `/lend/v1/earn/positions`, `/lend/v1/earn/earnings` | Deposit asset float, position reading, yield extraction |
| **Prediction** | `/prediction/v1/events`, `/prediction/v1/markets/{id}`, `/prediction/v1/orderbook/{id}`, `/prediction/v1/orders` (POST), `/prediction/v1/positions`, `/prediction/v1/positions/{id}/claim` | Tail-risk market discovery, hedge order placement, payout claims |
| **Swap V2** | `/swap/v2/order`, `/swap/v2/execute` | Premium currency conversion (e.g., depositor sends SOL, vault converts to USDC); payout settlement |
| **Tokens** | `/tokens/v2/search`, `/tokens/v2` (by mint) | Asset metadata for UI; mapping events to underlying assets |
| **Portfolio** | `/portfolio/v1/positions/{wallet}` | Unified view of vault keypair positions for transparency dashboard |

**Total: 5 Jupiter APIs, ~15 endpoints.** Composition lives at the orchestrator's rebalance loop, where Lend yield → Swap conversion → Prediction order placement happens in sequence within a single tick.

---

## What the AI Stack did for us (the 25% category)

The full per-tool analysis lives in [`docs/ai-stack/FEEDBACK.md`](./docs/ai-stack/FEEDBACK.md). Quick summary:

| AI tool | Score | Headline |
|---|---|---|
| `llms.txt` / `llms-full.txt` | 4.5 / 5 | Surprise winner. Loaded once at session start, served as the spine of context throughout. |
| Jupiter CLI | 4 / 5 | Best-shaped surface. The CLI is doing normalization the API doesn't. Promote those normalizers as `@jup-ag/api-client` (DX-GAP-#11). |
| Skill: `jupiter-lend` | 4 / 5 | Glossary saved a half-day. Surfaced DX-GAP-#15, #16, #17 — Jupiter has already merged the `client.lending` fix. |
| Skill: `integrating-jupiter` | 3.5 / 5 | Clean intent-router. We hit DX-GAP-#13 (auth overstatement) and #10 (install command not headless-safe). **Auth fix upstreamed as [jup-ag/agent-skills#20](https://github.com/jup-ag/agent-skills/pull/20).** |
| Documentation MCP | 2.5 / 5 | Configured but never exercised — honest signal on when MCP shines (early-lifecycle in-editor scaffolding, not post-bootstrap debugging). |

We kept a **DX log** during development at [`docs/dx-log/`](./docs/dx-log/) — every friction point with timestamp — that crystallized into the 31 numbered findings in [`DX-REPORT.md`](./DX-REPORT.md).

---

## Security boundaries (v1)

| Boundary | Mitigation |
|---|---|
| Vault keypair compromise | Stored in env var only; never logged; never exposed to frontend; rotation procedure documented |
| Frontend → orchestrator API | Orchestrator API requires signed-message auth (depositor proves wallet ownership); no admin actions exposed |
| Withdrawal flow | Two-step: depositor signs withdraw intent → orchestrator validates share + queues withdrawal → settles next rebalance window |
| Bad actors placing pump-prediction markets | Curated basket via config file; not user-selectable in v1 |

---

## Non-goals for v1 (out of scope)

- On-chain vault program (v2)
- Multi-asset deposits (USDC only)
- Fee/revenue mechanism (free)
- DAO governance over basket
- Trustless deposits (custodial in v1)
- Mobile UI (responsive web only)
- Sophisticated hedge sizing (Kelly, mean-variance, etc. — v1 is equal-weight)
- Insurance-policy framing in marketing copy (regulatory caution; we frame as "tail-risk-hedged yield vault")

---

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Prediction order placement requires auth/JWT and is more involved than read endpoints | High | Medium | Probe `POST /prediction/v1/orders` early; contains DX-report content either way |
| Prediction market liquidity for our chosen baskets is too thin | Medium | High | Curated basket explicitly selects high-volume markets; smaller per-market position sizes |
| Lend Earn rate volatility breaks our economics | Low | Medium | Daily rebalance recomputes; document in DX report |
| Jupiter rate-limits free/keyless tier | Medium | Low | We'll get an API key for production |
| Vault keypair compromise | Low | Catastrophic | Strong opsec; demo-only deployments use a freshly-funded test keypair |
| Solana mainnet outage during rebalance | Low | Low | Idempotent rebalance + transactional event log |

---

## Definition of "done" for v1 — as shipped

The original DoD was written 2026-04-30. Below is the honest report card on what shipped vs what was planned, with deviations explained.

- [x] **User can deposit USDC via connected wallet** — `apps/web/src/app/deposit/page.tsx` + `DepositForm.tsx` with sign-message proof. Live-tested 4 times.
- [x] **Vault deposits to Jupiter Lend Earn (jlUSDC) automatically** — via the rebalance loop (`rebalance.ts`); fresh wallet USDC is split per `HEDGE_BUDGET_FRACTION` between hedge bucket and Lend compound on every tick. Currently $19.75 in jlUSDC at ~4.24% APY.
- [x] **Rebalance loop runs end-to-end on real mainnet** — both via the daily cron (`REBALANCE_CRON=0 0 * * *`) and via admin trigger (`POST /admin/rebalance/trigger`). Cooldown is now persisted to SQLite (`vault_state` table) so it survives orchestrator restart.
- [ ] **At least 5 hedges currently open across diverse tail-risk markets** — **deviation: 1 hedge currently open** (16 NO contracts on POLY-1345531). The original 5-market basket was compressed to a single market because Jupiter Prediction's $5-per-order minimum × the small live TVL meant no per-market allocation cleared the threshold (DX-GAP-#24 documented this in production). A diversified 5-market basket needs ~$100 vault TVL with the original weights; the v1 demo runs at ~$26 TVL. The full basket is preserved in `basket.config.json` for v1.5 once TVL allows.
- [x] **Depositor can see their share, projected position value, and balance** — `/me` page shows position value, contributed amount, payouts accrued, and **withdrawable now** (the DX-GAP-#28 fix that clamps notional to redeemable).
- [x] **DX log is publicly readable and rolled into DX-REPORT.md** — `docs/dx-log/` has the chronological friction log; `DX-REPORT.md` has 31 numbered findings; `/dx` page (when running locally) renders every Jupiter API call live.
- [ ] **Submission includes link to repo, deployed app, demo video, DX-REPORT.md** — repo ✓, DX-REPORT ✓, **deployed app and demo video pending** (post-/clear, before final submission).

Two unmet items: 5-hedge basket (deferred to v1.5 by capital constraint, documented as DX-GAP-#24) and the deploy + video deliverables (queued for the final submission pass). Everything else shipped as planned.
