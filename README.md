# Ballast

> A USDC vault where Jupiter Lend yield finances NO-contract hedges on tail-risk prediction markets. The yield is the premium engine; the hedges are the ballast that keeps depositors stable when crypto markets storm.

Built for the Solana Frontier Hackathon — Jupiter *"Not Your Regular Bounty"* sidetrack.

> **Note on the name.** This repo is `criptocbas/Reflux` (the project's working name during early scoping); the product name landed at **Ballast** during design review. We kept the repo URL and `@reflux/*` package names intact for git-history continuity. See [`docs/brand.md`](./docs/brand.md) for the full brand decision.

---

## Why this is "oh"

Jupiter built **Prediction** as a speculation product and **Lend** as a yield product. Ballast composes them as the *underwriting layer* and the *premium engine* of a yield-bearing insurance vault — a flip neither product was designed for, but which the public APIs make possible. Depositors never directly pay a premium; the vault self-insures with native Jupiter primitives.

---

## Live state

As of the last commit, the vault is operational on Solana mainnet:

- **Vault wallet:** [`B6MtVeqn7BrJ8HTX6CeP8VugNWyCqqbfcDMxYBknzPt7`](https://solscan.io/account/B6MtVeqn7BrJ8HTX6CeP8VugNWyCqqbfcDMxYBknzPt7)
- **Lend Earn position:** $1.00 in `jlUSDC` ([first-deposit tx](https://solscan.io/tx/4dKhnE1s5GGzidZ4v6h17P23D9FQyruya6viRDX2Yr9pUdYs8kTfT79LgCswhukeJnkzYh9DASk8t6c61rAA9R5M))
- **Open hedge:** 26 NO contracts on *BTC > $80k by EOY 2026* ([first-hedge tx](https://solscan.io/tx/3vCCfi3CZ3fZUrXVucz2P4MEPrp2v23cGtkvi6ZPeXUd1iMX2FvUiJThu24vgQQ6fV9k4n8xqMPcC9TYPGPvS5HS))

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
pnpm --filter @reflux/orchestrator exec tsx src/scripts/checkVaultBalance.ts

# Print the vault public key (handy for funding)
pnpm --filter @reflux/orchestrator exec tsx src/scripts/derivePubkey.ts

# Manually deposit USDC into Jupiter Lend Earn (--dry-run simulates first)
pnpm --filter @reflux/orchestrator exec tsx src/scripts/depositToLend.ts 1 --dry-run

# Discover live "Up or Down" markets for an asset
pnpm --filter @reflux/orchestrator exec tsx src/scripts/findMarket.ts Bitcoin

# Open a NO-contract hedge on a specific market (--dry-run simulates first)
pnpm --filter @reflux/orchestrator exec tsx src/scripts/openHedge.ts POLY-1345530 5 --dry-run
```

### 4) Manual rebalance + claim during demos

```bash
# Dry-run: shows what the loop *would* do without affecting state
curl http://localhost:4000/rebalance/preview | jq

# Live rebalance (claims any resolved positions, places new hedges, compounds)
curl -X POST http://localhost:4000/rebalance/trigger | jq

# Claim sweep only — useful when a market just resolved
curl -X POST http://localhost:4000/claim/sweep | jq
```

The rebalance cron runs daily at 00:00 UTC by default (`REBALANCE_CRON` env var); the manual endpoints exist for demos and testing.

### Quality gates

```bash
pnpm typecheck      # all packages
pnpm test           # vitest suites: shared (microUsd, bps), orchestrator (accountant, basket)
pnpm --filter @reflux/web run build   # production Next.js build
```

All green at the time of the final commit.

---

## DX report

This project is built for Jupiter's bounty, where the **Developer Experience report is 35% of the judging weight** and the **AI Stack feedback is 25%**.

- The full report lives at [`DX-REPORT.md`](./DX-REPORT.md) — 25 concrete findings, each with the specific endpoint, why it matters, and a suggested Monday-morning fix.
- The running raw log is in [`docs/dx-log/`](./docs/dx-log/), captured in real time during development.
- The orchestrator's `/dx/observations` endpoint streams every Jupiter API call live, and the public `/dx` page renders it as a transparency surface judges can verify in real time.

The 90-second demo script is at [`docs/demo-script.md`](./docs/demo-script.md).
