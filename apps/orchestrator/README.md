# @ballast/orchestrator

The off-chain rebalance engine. Owns the vault keypair, runs the rebalance loop, exposes the HTTP API to the web frontend, and emits the public DX log.

## Run locally

```bash
# from repo root
pnpm --filter @ballast/orchestrator dev
```

Reads env from `.env` at the repo root (see `.env.example` there).

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/dx/observations?limit=100` | Recent Jupiter API observations (the DX log feed) |
| GET | `/lend/tokens` | Live snapshot of Jupiter Lend Earn supported assets + APYs |
| GET | `/prediction/events?category=crypto&limit=20` | Pass-through query of Jupiter Prediction events |

(Full deposit/withdraw/rebalance routes land alongside the SQLite schema.)
