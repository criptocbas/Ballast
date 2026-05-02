# CLAUDE.md — Working notes for AI agents

You are working on **Ballast**, a USDC vault that composes Jupiter Lend Earn (yield) with Jupiter Prediction Markets (NO-contract hedges) for the Solana Frontier Hackathon's Jupiter sidetrack. Live on Solana **mainnet** with real (test) funds. Read [`README.md`](./README.md) for the public framing; this file is for what an agent needs to *not break things*.

## Stack at a glance

- **pnpm workspaces**, Node 22+, TypeScript strict + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`.
- `apps/web` — Next.js 16 (App Router), Turbopack dev, Tailwind v4, `@solana/wallet-adapter-react`. **See `apps/web/AGENTS.md`** — the breaking-changes warning is real; consult `node_modules/next/dist/docs/` before guessing API.
- `apps/orchestrator` — Fastify v5 + `@fastify/cors`, Drizzle ORM + `better-sqlite3` (WAL), `pino` logger, `node-cron` for the daily rebalance, `tweetnacl` for ed25519 sign-message verification.
- `packages/shared` — typed Jupiter API clients (Lend Earn + Prediction) with an `onObservation` hook that powers the public DX log.

## Local workflow (the commands that work)

From repo root (`/home/cbas/Documents/Programming/frontier/ballast`):

```bash
pnpm install                          # one-time
pnpm dev:orchestrator                 # → :4000
pnpm dev:web                          # → :3000
pnpm typecheck                        # tsc --noEmit across all 3 packages
pnpm test                             # vitest: 43 tests across the workspace
pnpm --filter @ballast/web run build  # production build
```

The dev orchestrator uses `tsx watch` and auto-restarts on file changes. The web dev uses Turbopack; **clear `apps/web/.next/` if you see "FATAL panic" or stale-cache compile failures** (this happened once during the rename and cost an hour).

## Brand: Reflux ↔ Ballast (read this — judges and agents both stumble here)

The product is **Ballast**. The GitHub URL is `criptocbas/Reflux` (the working name during early scoping). The decision was deliberate (`docs/brand.md`):

- **Ballast** — workspace name, all packages (`@ballast/web`, `@ballast/orchestrator`, `@ballast/shared`), DB filename (`ballast.sqlite`), branding, CSS classes.
- **Reflux** — only the GitHub URL (`https://github.com/criptocbas/Reflux`) and historical snapshots in `docs/dx-log/*` / `docs/api-research/*`. Those are **frozen** — they document what the project was called when each entry was written. **Do not update them retrospectively.**

If you find a `@reflux/*` or `Reflux` reference outside those two zones, it's stale — fix it. Inside those two zones, leave it.

## Conventions and hard constraints

| Thing | Rule | Why |
|---|---|---|
| Vault keypair (`VAULT_KEYPAIR_BASE58`) | **Orchestrator-only.** Never in any `apps/web/*` file, never in `NEXT_PUBLIC_*`, never logged. | Custodial v1; this is the entire trust surface. |
| Solana RPC | Use a paid endpoint (Helius / QuickNode). `api.mainnet-beta.solana.com` rate-limits within seconds of a single rebalance. | Captured in DX-LOG entry 02. |
| SQLite database | `apps/orchestrator/ballast.sqlite{,-shm,-wal}`. Gitignored. Don't rename the file while the orchestrator is running (WAL corruption risk). Stop the process first. | We hit this during the reflux→ballast rename. |
| Sign-message auth | Server issues nonce → client signs canonical message `ballast:<purpose>\nnonce=<n>\n<sorted-bindings>` → server verifies via tweetnacl, one-shot consume. See `apps/orchestrator/src/{nonces,auth}.ts`. | Replay-resistant, deposit-theft-race-resistant. |
| Admin auth | `Authorization: Bearer $ORCHESTRATOR_ADMIN_TOKEN` on `/admin/*`. Constant-time comparison. 503 if env not set; 401 on mismatch. | Production discipline. |
| PII | `/vault/aggregate` is the **public** depositor surface (count + total only). `/admin/depositors` is the full list. Don't add wallet pubkeys to anything public. | Real PII concern. |
| Mainnet test funds | The vault holds real money (~$16 contributed). Reads are free; writes cost SOL gas + real Lend/Prediction commitments. **Always default to dry-run mode** for new write paths until verified. | We have $0.04 SOL of gas headroom. |

## Documentation discipline (this is a hackathon submission)

The repo doubles as bounty deliverables. Two docs are first-class:

- [`DX-REPORT.md`](./DX-REPORT.md) — 35% rubric weight. 27 numbered findings on Jupiter APIs/SDKs. Tightly edited. **Do not bloat it** with general observations; every entry has the form *Where / What happens / Why it matters / Fix / Severity*.
- [`docs/ai-stack/FEEDBACK.md`](./docs/ai-stack/FEEDBACK.md) — 25% rubric weight. Per-tool analysis (Skills × 2, CLI, MCP, llms.txt). Same discipline.

Snapshot directories — **frozen, do not edit retroactively**:

- `docs/dx-log/*` — chronological friction log captured during the build. Each entry is dated and references the project's then-current name (Reflux). The DX-REPORT crystallizes from these.
- `docs/api-research/*` — raw probe outputs from initial API exploration. Same freeze rule.

If you find a new gap during continued work, add a **new** dx-log file (e.g. `05-<topic>.md`) and propagate the finding into DX-REPORT — don't retcon old entries.

## Common gotchas

- **`bigint: Failed to load bindings, pure JS will be used`** — cosmetic, comes from the `bigint-buffer` transitive dep loaded by the Lend SDK. Pure-JS path works. Ignore.
- **`.agents/` and `.junie/`** — skills-CLI / JetBrains agent caches. Both gitignored. Restorable from `skills-lock.json` via `npx skills experimental_install`.
- **`apps/web/.next/`** — Turbopack cache. If a build complains about non-existent absolute paths (esp. paths under the old `/frontier/reflux/` directory name), wipe `.next/` and `.turbo/`.
- **Next.js 16 ≠ training data** — `apps/web/AGENTS.md` flags this explicitly. Check `node_modules/next/dist/docs/` before writing routes/middleware/config.
- **`@reflux/*` package names anywhere in **code/configs/markdown** outside the two snapshot zones** — they are leftover from the rename. Fix them.

## Where to find things (quick map)

| Looking for | File |
|---|---|
| Workspace layout | `pnpm-workspace.yaml`, root `package.json` |
| Architecture overview | `ARCHITECTURE.md` |
| Brand decision | `docs/brand.md` |
| Demo script (~90s) | `docs/demo-script.md` |
| Public env vars | `.env.example` (committed) |
| Vault keypair handling | `apps/orchestrator/src/wallet.ts` |
| Sign-message auth | `apps/orchestrator/src/{nonces,auth}.ts`, tests at `nonces.test.ts` |
| Admin auth middleware | `apps/orchestrator/src/auth.ts` (`requireAdmin`) |
| Share accounting | `apps/orchestrator/src/accountant.ts` (cumulative-deposit model — see DX-REPORT v1 share-accounting model row for the why) |
| Pro-rata payout distribution | `apps/orchestrator/src/{accountant,claimer}.ts` |
| Withdrawal flow | `apps/orchestrator/src/withdrawals.ts` |
| Auto-deposit-recovery watcher | `apps/orchestrator/src/depositWatcher.ts` (12 unit tests) |
| Rebalance loop | `apps/orchestrator/src/rebalance.ts` |
| Hedge order placement | `apps/orchestrator/src/prediction.ts` |
| Lend deposit/withdraw | `apps/orchestrator/src/lend.ts` |
| Drizzle schema | `apps/orchestrator/src/db/schema.ts` |
| Web pages | `apps/web/src/app/{page,vault/page,me/page,deposit/page,dx/page,about/page}.tsx` |
| Wallet adapter setup | `apps/web/src/components/WalletProviders.tsx` |
| Design system tokens | `apps/web/src/app/globals.css` |
| Public DX log feed | `/dx/observations` (orchestrator) → `/dx` (web) |

## Style notes

- Match the existing voice in `DX-REPORT.md` and `FEEDBACK.md` — sharp, specific, with file:line receipts. No marketing fluff in technical docs.
- Default to writing no comments. Add one only when the *why* is non-obvious. Never restate what well-named code already says.
- Keep test descriptions accurate to current count when editing test-related docs (43 total = 6 shared + 37 orchestrator). Update both `README.md` and `DX-REPORT.md` if you add tests.
- Commit messages match the existing style — short imperative subject, blank line, then a structured body explaining *why*. See `git log --oneline -5` for examples.
