# Ballast

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-52%20passing-success)](#quality-gates)
[![Solana](https://img.shields.io/badge/Solana-mainnet-9945FF)](https://solscan.io/account/B6MtVeqn7BrJ8HTX6CeP8VugNWyCqqbfcDMxYBknzPt7)
[![Hackathon](https://img.shields.io/badge/Frontier_Hackathon-Jupiter_sidetrack-F59E0B)](https://superteam.fun/earn/hackathon/frontier)
[![Upstream PR](https://img.shields.io/badge/upstream_PR-jup--ag%2Fagent--skills%2320-blueviolet)](https://github.com/jup-ag/agent-skills/pull/20)

> A USDC vault where Jupiter Lend yield finances NO-contract hedges on tail-risk prediction markets. The yield is the premium engine; the hedges are the ballast that keeps depositors stable when crypto markets storm.

**Live demo:** _coming soon_ · **Mainnet vault:** [`B6Mt…2zsX`](https://solscan.io/account/B6MtVeqn7BrJ8HTX6CeP8VugNWyCqqbfcDMxYBknzPt7) · **Cluster:** mainnet-beta

Built for the Solana Frontier Hackathon — Jupiter *"Not Your Regular Bounty"* sidetrack.

<!-- Drop a screenshot at docs/screenshots/hero.png (suggested 1600×900) and uncomment to render at the top of the README:
<p align="center"><img src="docs/screenshots/hero.png" alt="Ballast — yield with a built-in tail-risk hedge" width="900"></p>
-->

---

## Why this is "oh"

Jupiter built **Prediction** as a speculation product and **Lend** as a yield product. Ballast composes them as the *underwriting layer* and the *premium engine* of a yield-bearing insurance vault — a flip neither product was designed for, but which the public APIs make possible. Depositors never directly pay a premium; the vault self-insures with native Jupiter primitives.

---

## Bounty deliverables

Jupiter's rubric weights this submission across four buckets. We treat each as a first-class deliverable:

| Weight | Deliverable | Where |
|---|---|---|
| **35%** | DX report | [`DX-REPORT.md`](./DX-REPORT.md) — 31 concrete findings on the Jupiter APIs / SDKs we touched, each with the specific endpoint, why it matters, and a suggested Monday-morning fix. Findings #28–#32 are field reports from real production incidents during the build, plus one finding upstreamed as a PR ([jup-ag/agent-skills#20](https://github.com/jup-ag/agent-skills/pull/20)). |
| **25%** | AI Stack feedback | [`docs/ai-stack/FEEDBACK.md`](./docs/ai-stack/FEEDBACK.md) — per-tool analysis (Skills × 2, CLI, MCP, llms.txt) with what worked, what misled, file:line receipts, scores, and a top-5 prioritized recommendation list. |
| **25%** | Technical execution | This repo — live on Solana mainnet, 52 passing tests, end-to-end deposit / withdraw / rebalance / claim flow, sign-message auth, admin-gated mutations, auto-deposit-recovery watcher, persistent-state robustness layer (cooldown, RPC fallback, tx retry, rate limit). See [Live state](#live-state) and [How to run](#how-to-run). |
| **15%** | Creativity & ambition | The composition itself — yield → hedge, Lend × Prediction, an insurance vault that self-insures with native Jupiter primitives. See [Why this is "oh"](#why-this-is-oh). |

Companion materials: [`docs/dx-log/`](./docs/dx-log/) (raw friction log, captured during build), [`docs/demo-script.md`](./docs/demo-script.md) (90-second demo walkthrough), and the orchestrator's `/dx/observations` endpoint (live Jupiter API call feed, surfaced at the public `/dx` page).

---

## Live state

As of the last commit, the vault is operational on Solana mainnet:

- **Vault wallet:** [`B6MtVeqn7BrJ8HTX6CeP8VugNWyCqqbfcDMxYBknzPt7`](https://solscan.io/account/B6MtVeqn7BrJ8HTX6CeP8VugNWyCqqbfcDMxYBknzPt7)
- **Lend Earn position:** ~$19.75 in `jlUSDC` at ~4.24% APY ([first deposit](https://solscan.io/tx/4dKhnE1s5GGzidZ4v6h17P23D9FQyruya6viRDX2Yr9pUdYs8kTfT79LgCswhukeJnkzYh9DASk8t6c61rAA9R5M), 2026-05-01)
- **Open hedge:** 16 NO contracts on POLY-1345531 (*BTC > $90k by EOY 2026*), cost basis $5.12, mark ~$4.96 ([opening tx](https://solscan.io/tx/5JKzdxci3jskXW6XqhskJ1fEu6A9Cw38y82a81TUY6WJ99Fzea3GXUmSdczf2Bc5F3fiezHgmpBohMkqfzY5dqbL), 2026-05-07)
- **Earlier hedge (now closed):** 26 NO contracts on POLY-1345530 (*BTC > $80k by EOY 2026*, $4.73 cost basis), placed 2026-05-02 ([opening tx](https://solscan.io/tx/3vCCfi3CZ3fZUrXVucz2P4MEPrp2v23cGtkvi6ZPeXUd1iMX2FvUiJThu24vgQQ6fV9k4n8xqMPcC9TYPGPvS5HS)) — market resolved as BTC crossed $80k during the build. See [DX-GAP-#31](./DX-REPORT.md) for the field report on `/markets/{id}` field-name + nullability conventions.

---

## Architecture at a glance

- `apps/web` — Next.js 16 frontend (landing, vault dashboard, depositor P&L, public DX log)
- `apps/orchestrator` — Node service: rebalance loop, hedge executor, claim reaper, vault wallet, HTTP API
- `packages/shared` — typed Jupiter API clients (Lend Earn, Prediction) + utilities

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the system design and [`docs/brand.md`](./docs/brand.md) for the design system.

---

## How to run

**Prerequisites:** Node 22+, pnpm 10+, a Jupiter API key from [developers.jup.ag/portal](https://developers.jup.ag/portal), and a Solana wallet keypair holding USDC + a little SOL for gas (mainnet).

### 1) Install + configure

```bash
pnpm install

# Copy the template and fill in your keys (gitignored, never commit)
cp .env.example .env
$EDITOR .env  # set JUPITER_API_KEY, SOLANA_RPC_URL, VAULT_KEYPAIR_BASE58
```

You'll need a paid RPC for production-quality reads — the public `api.mainnet-beta.solana.com` will rate-limit a single rebalance flow within seconds. Helius free tier or QuickNode developer tier are both adequate; just set `SOLANA_RPC_URL` accordingly.

### 2) Boot the orchestrator and the web app

```bash
# Terminal 1
pnpm dev:orchestrator        # http://localhost:4000

# Terminal 2
pnpm dev:web                 # http://localhost:3000
```

The orchestrator opens SQLite, runs migrations on first boot, schedules the rebalance cron, and starts serving the HTTP API. The web app reads `/vault/info`, `/lend/tokens`, and `/dx/observations` directly from the orchestrator.

### 3) Inspect / operate the vault

```bash
# Vault on-chain balances (SOL + SPL tokens)
pnpm --filter @ballast/orchestrator exec tsx src/scripts/checkVaultBalance.ts

# Print the vault public key (handy for funding)
pnpm --filter @ballast/orchestrator exec tsx src/scripts/derivePubkey.ts

# Manually deposit USDC into Jupiter Lend Earn (--dry-run simulates first)
pnpm --filter @ballast/orchestrator exec tsx src/scripts/depositToLend.ts 1 --dry-run

# Discover live "Up or Down" markets for an asset
pnpm --filter @ballast/orchestrator exec tsx src/scripts/findMarket.ts Bitcoin

# Open a NO-contract hedge on a specific market (--dry-run simulates first).
# (POLY-1345531 was tradeable as of 2026-05-07 — use findMarket.ts above to
#  discover currently-open markets, since binary markets resolve and become
#  unreplaceable. See DX-GAP-#31 in DX-REPORT.md.)
pnpm --filter @ballast/orchestrator exec tsx src/scripts/openHedge.ts POLY-1345531 5 --dry-run
```

### 4) Manual rebalance + claim during demos

Mutating endpoints are gated behind `Authorization: Bearer $ORCHESTRATOR_ADMIN_TOKEN`. Set the token in `.env` (`openssl rand -hex 32`), then:

```bash
TOKEN=$(grep ORCHESTRATOR_ADMIN_TOKEN .env | cut -d= -f2)

# Dry-run: shows what the loop *would* do (public, unauthenticated)
curl http://localhost:4000/rebalance/preview | jq

# Live rebalance — withdraws yield from Lend, places hedges, compounds, settles withdrawals
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:4000/admin/rebalance/trigger | jq

# Claim sweep — claims resolved positions and distributes pro-rata to depositors
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:4000/admin/claim/sweep | jq

# Process queued depositor withdrawals
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:4000/admin/withdrawals/process | jq

# Full depositor list (admin)
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/admin/depositors | jq
```

The rebalance cron runs daily at 00:00 UTC by default (`REBALANCE_CRON` env var); the admin endpoints exist for demos and operations.

### Public endpoints (no auth)

```
GET  /health                   liveness
GET  /vault/info               vault address, Lend position, hedges, TVL
GET  /vault/aggregate          depositor count + total contributed (no PII)
GET  /vault/hedges             persisted hedge history
GET  /lend/tokens              Jupiter Lend Earn rates snapshot
GET  /prediction/events?...    pass-through to Jupiter Prediction events
GET  /dx/observations          live Jupiter API call log
GET  /api/me/:wallet           depositor view (share %, contributions, payouts)
GET  /rebalance/preview        dry-run rebalance with cooldown disabled
POST /api/auth/nonce           issue a sign-message nonce
POST /api/deposits/confirm     verify on-chain deposit + signed proof
POST /api/withdrawals/request  signed withdrawal (settles inline if possible)
```

### Quality gates

```bash
pnpm typecheck      # all packages
pnpm test           # vitest: 52 tests — shared (unit conversions), accountant (share math + withdrawable),
                    # distribution (pro-rata payouts), nonces (sign-message + replay protection),
                    # rebalance (cooldown / preview), deposit-watcher (PDA classification +
                    # SPL transfer parsing)
pnpm --filter @ballast/web run build   # production Next.js build
```

All passing on `main`.

---

## License

[MIT](./LICENSE) © 2026 Sebastian Barrientos.
