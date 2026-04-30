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

## Development

```bash
# install
pnpm install

# build the shared package (orchestrator + web depend on it)
pnpm build:shared

# run the orchestrator and frontend in two terminals
pnpm dev:orchestrator   # http://localhost:4000
pnpm dev:web            # http://localhost:3000
```

Configuration lives in `.env` at the repo root (see [`.env.example`](./.env.example)). The Jupiter API key, Solana RPC, and vault keypair all read from there.

### Useful scripts

```bash
# inspect the vault's current on-chain balances
pnpm --filter @reflux/orchestrator exec tsx src/scripts/checkVaultBalance.ts

# deposit USDC into Jupiter Lend Earn (--dry-run simulates)
pnpm --filter @reflux/orchestrator exec tsx src/scripts/depositToLend.ts 1 --dry-run

# discover live "Up or Down" markets for an asset
pnpm --filter @reflux/orchestrator exec tsx src/scripts/findMarket.ts Bitcoin

# open a NO-contract hedge on a specific market (--dry-run simulates)
pnpm --filter @reflux/orchestrator exec tsx src/scripts/openHedge.ts POLY-1345530 5 --dry-run
```

---

## DX report

This project is built for Jupiter's bounty, where the **Developer Experience report is 35% of the judging weight** and the **AI Stack feedback is 25%**. We maintain a running DX log in [`docs/dx-log/`](./docs/dx-log/) — every friction point captured in real time, with timestamps, the specific endpoint or SDK call, and a concrete suggested fix.

The orchestrator's `/dx/observations` endpoint streams every Jupiter API call live, and the public `/dx` page in the frontend renders it as a transparency surface judges can verify in real time.

At submission, the running log is consolidated into a single `DX-REPORT.md`.
