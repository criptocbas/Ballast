# Reflux

> A USDC vault where Jupiter Lend yield finances NO-contract hedges on tail-risk prediction markets. In normal times depositors keep residual yield; when tail events hit, payouts sweep back to the vault.

Built for the Frontier Hackathon — Jupiter "Not Your Regular Bounty" sidetrack (3,000 jupUSD).

---

## Why this is "oh"

Jupiter built **Prediction** as a speculation product and **Lend** as a yield product. Reflux flips both:
- Prediction market NO contracts become the **underwriting layer** of an insurance product
- Lend Earn yield becomes the **premium engine** that finances those underwriting positions

The vault is **self-insuring with native primitives** — depositors never directly pay a premium.

---

## Architecture at a glance

- `apps/web` — Next.js 15 frontend (deposit, vault dashboard, depositor P&L, public DX log)
- `apps/orchestrator` — Node service running the rebalance loop, hedge executor, and claim reaper
- `packages/shared` — typed Jupiter API clients and common types

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design.

---

## Development

(Setup instructions to follow once monorepo scaffolding lands.)

---

## DX report

This project is being built as part of Jupiter's bounty — the DX report is **35% of the judging weight** and is being maintained throughout development in [`docs/dx-log/`](./docs/dx-log/) and rolled into [`DX-REPORT.md`](./DX-REPORT.md) at submission.
