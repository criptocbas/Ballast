# Ballast — Architecture

**Status:** v1 design (draft)
**Captured:** 2026-04-30

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
- Largest TVL on Jupiter Lend Earn ($414M)
- 4.36% APY (3.23% supply + 1.13% rewards)
- Most familiar to non-power-user depositors

**v1.5 stretch: JUICED (jlJupUSD)** — 5.12% APY, plus signals "Jupiter-native" composition (depositing Jupiter's stablecoin into Jupiter's lender). Worth highlighting in the demo if we have time.

---

## Hedge basket selection (v1: curated, deterministic)

For v1 we **manually curate** a basket of tail-risk markets. We do not let AI pick markets in v1 — that's a separate complexity surface. Curation lives in a single config file the orchestrator reads.

Candidate categories:
1. **BTC downside** — buy NO on bullish-strike BTC markets (e.g., "BTC > $X by date" markets where current implied probability suggests pricing inefficiency)
2. **Macro shocks** — Fed decision markets, oil price markets, recession-related markets
3. **Volatility events** — short-dated daily markets ("BTC up/down today")
4. **Geopolitical** — ceasefire-extension markets that affect global risk (correlated with crypto)

Sizing algorithm (v1):
1. Compute available premium budget = accrued yield since last rebalance × hedgeBudgetFraction (default 50%)
2. Split budget equally across N markets in basket (default N=8)
3. Place limit BUY NO orders sized to the per-market budget at current ask

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
| Frontend | Next.js 15 (App Router) | Server components for data-heavy pages |
| Style | Tailwind v4 + shadcn/ui | Fast, professional defaults |
| Orchestrator | Node 22 + TypeScript | Same language as frontend; easier reuse |
| State store | SQLite + Drizzle ORM | File-based, zero-config, perfect for hackathon scale |
| Solana | `@solana/web3.js` + `@solana/spl-token` | Standard, well-documented |
| Jupiter SDK | `@jup-ag/lend`, `@jup-ag/lend-read` | Per Jupiter docs |
| AI Stack | Jupiter CLI + Skills + Docs MCP | **Required for the AI Stack feedback category (25%)** — used during development |
| Wallet | `@solana/wallet-adapter-react` | Standard Solana wallet adapter |
| Test | Vitest | Modern, fast, TS-native |
| Lint/format | ESLint + Prettier | Standard |

---

## Project layout

```
reflux/
├── apps/
│   ├── web/                 # Next.js 15 (App Router)
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

## What the AI Stack does for us (the 25% category)

| AI tool | Where used | What we'll feedback on |
|---|---|---|
| `@jup-ag/cli` | Orchestrator's hedge executor — spawn `jup` for order placement and verify behavior matches direct API | Telegram support, JSON output schema stability, error reporting clarity |
| Jupiter Skills (`integrating-jupiter`, `jupiter-lend`) | Imported into Claude Code as we develop the orchestrator and frontend | Coverage: does it know about Prediction × Lend composition? Where does it default to outdated v1 endpoints? |
| Docs MCP | Connected to editor; used for endpoint lookups in real time | Search ranking, doc freshness, schema completeness in MCP responses |
| `llms.txt` / `llms-full.txt` | Loaded into Claude Code at session start | Whether structure helps the agent stay on-track for cross-API tasks |

We will keep a **DX log** during development — every friction point with timestamp and link — and roll it into the final report.

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

## Definition of "done" for v1 demo

- [ ] User can deposit USDC via connected wallet
- [ ] Vault deposits to Jupiter Lend Earn (jlUSDC) automatically
- [ ] Daily rebalance loop runs end-to-end on real mainnet (or one rebalance manually triggered)
- [ ] At least 5 hedges currently open across diverse tail-risk markets
- [ ] Depositor can see their share, projected P&L scenarios, and claim status
- [ ] DX log is publicly readable and rolled into DX-REPORT.md
- [ ] Submission includes: link to repo, deployed app, demo video, DX-REPORT.md
