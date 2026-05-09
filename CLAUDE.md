# CLAUDE.md — Working notes for AI agents

You are working on **Ballast**, a USDC vault that composes Jupiter Lend Earn (yield) with Jupiter Prediction Markets (NO-contract hedges) for the Solana Frontier Hackathon's Jupiter sidetrack. Live on Solana **mainnet** with real (test) funds. Read [`README.md`](./README.md) for the public framing; this file is for what an agent needs to *not break things*.

## Stack at a glance

- **pnpm workspaces**, Node 22+, TypeScript strict + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`.
- `apps/web` — Next.js 16 (App Router), Turbopack dev, Tailwind v4, `@solana/wallet-adapter-react`. **See `apps/web/AGENTS.md`** — the breaking-changes warning is real; consult `node_modules/next/dist/docs/` before guessing API.
- `apps/orchestrator` — Fastify v5 + `@fastify/cors` + `@fastify/rate-limit`, Drizzle ORM + `better-sqlite3` (WAL), `pino` logger, `node-cron` for the daily rebalance + the 10-minute withdrawal worker, `tweetnacl` for ed25519 sign-message verification.
- `packages/shared` — typed Jupiter API clients (Lend Earn + Prediction) with an `onObservation` hook that powers the public DX log.

## Local workflow (the commands that work)

From repo root (`/home/cbas/Documents/Programming/frontier/ballast`):

```bash
pnpm install                          # one-time
pnpm dev:orchestrator                 # → :4000
pnpm dev:web                          # → :3000
pnpm typecheck                        # tsc --noEmit across all 3 packages
pnpm test                             # vitest: 52 tests across the workspace
pnpm --filter @ballast/web run build  # production build
pnpm --filter @ballast/orchestrator run build  # tsc -p tsconfig.json (production)
```

The dev orchestrator uses `tsx watch` and auto-restarts on file changes. The web dev uses Turbopack; **clear `apps/web/.next/` if you see "FATAL panic" or stale-cache compile failures** (this happened once during the rename and cost an hour).

## Brand: legacy "Reflux" references

The product is **Ballast** — workspace name, all packages (`@ballast/web`, `@ballast/orchestrator`, `@ballast/shared`), DB filename (`ballast.sqlite`), GitHub URL (`https://github.com/criptocbas/Ballast`), branding, CSS classes. See `docs/brand.md` for the naming decision.

The only legitimate "Reflux" references are inside `docs/dx-log/*` and `docs/api-research/*` — frozen historical snapshots that document what the project was called when each entry was written. **Do not update them retrospectively.** The git remote URL still points at `Reflux.git` but GitHub redirects the rename — the user will eventually run `git remote set-url origin https://github.com/criptocbas/Ballast.git`; until then both URLs resolve.

If you find a `@reflux/*` or `Reflux` reference outside those two directories, it's stale — fix it.

## Conventions and hard constraints

| Thing | Rule | Why |
|---|---|---|
| Vault keypair (`VAULT_KEYPAIR_BASE58`) | **Orchestrator-only.** Never in any `apps/web/*` file, never in `NEXT_PUBLIC_*`, never logged. | Custodial v1; this is the entire trust surface. |
| Solana RPC | Use a paid endpoint (Helius / QuickNode). `api.mainnet-beta.solana.com` rate-limits within seconds of a single rebalance. Optional `SOLANA_RPC_URL_FALLBACK` is wired through `withRpcFallback()` for read paths. | Captured in DX-LOG entry 02. |
| SQLite database | `apps/orchestrator/ballast.sqlite{,-shm,-wal}`. Gitignored. Don't rename the file while the orchestrator is running (WAL corruption risk). Stop the process first. | We hit this during the reflux→ballast rename. |
| Sign-message auth | Server issues nonce → client signs canonical message `ballast:<purpose>\nnonce=<n>\n<sorted-bindings>` → server verifies via tweetnacl, one-shot consume. See `apps/orchestrator/src/{nonces,auth}.ts`. | Replay-resistant, deposit-theft-race-resistant. |
| Admin auth | `Authorization: Bearer $ORCHESTRATOR_ADMIN_TOKEN` on `/admin/*`. Constant-time comparison. 503 if env not set; 401 on mismatch. The Fastify error handler now passes through 4xx errors with their structured statusCode (so rate-limit 429 reaches the client correctly); only 5xx becomes the generic `internal_error`. | Production discipline. |
| PII | `/vault/aggregate` is the **public** depositor surface (count + total only). `/admin/depositors` is the full list. Don't add wallet pubkeys to anything public. The `/api/me/:wallet` endpoint is rate-limited (60 req/min/IP). | Real PII concern + DoS surface. |
| Mainnet test funds | The vault holds real money (~$26 contributed once the user funds the demo). Reads are free; writes cost SOL gas + real Lend/Prediction commitments. **Always default to dry-run mode** for new write paths until verified. | We have ~$0.04 SOL of gas headroom. |
| Rebalance cooldown | Persisted in the `vault_state` SQLite table (key `rebalance.last_tick_started_at_ms`). Survives orchestrator restart by design — a crash inside the cooldown window MUST NOT bypass the gate. Default 1-hour cooldown; admin trigger respects it. To force a rebalance during testing: `DELETE FROM vault_state WHERE key = 'rebalance.last_tick_started_at_ms';` | Prevents crash-loops from spamming Lend withdrawals. |
| Tx confirmation | Use `buildSimSignSendConfirmV0` from `apps/orchestrator/src/tx.ts` for any V0 transaction we control fully (Lend deposit/withdraw, depositor SPL settlement). It retries once on blockhash-expired errors with a fresh blockhash. **Do NOT wrap Jupiter-supplied transactions** (Prediction order, claim) — those embed Jupiter's blockhash and re-signing under a fresh one would break the keeper contract. | Robustness against mainnet RPC blockhash-expiry. |

## Documentation discipline (this is a hackathon submission)

The repo doubles as bounty deliverables. Two docs are first-class:

- [`DX-REPORT.md`](./DX-REPORT.md) — 35% rubric weight. **31 numbered findings** on Jupiter APIs/SDKs (numbers 1–32, skipping #9). Tightly edited. **Do not bloat it** with general observations; every entry has the form *Where / What happens / Why it matters / Fix / Severity*. **DX-GAP-#28 is the headline finding** — the field report on shipping a vault on Lend Earn and discovering the cumulative-deposit accountant diverges from real vault NAV the moment any capital flows into hedges. Promoted to #1 in the TL;DR. **DX-GAP-#29–#32 are field reports from the 2026-05-07 integration session**: basket hot-reload trap, partial-fill silent contract drift, `/markets/{id}` field-name + nullability inconsistencies, and the in-process cache invalidation contract gap. **DX-GAP-#13 is upstreamed** as [jup-ag/agent-skills#20](https://github.com/jup-ag/agent-skills/pull/20).
- [`docs/ai-stack/FEEDBACK.md`](./docs/ai-stack/FEEDBACK.md) — 25% rubric weight. Per-tool analysis (Skills × 2, CLI, MCP, llms.txt). Same discipline.

Snapshot directories — **frozen, do not edit retroactively**:

- `docs/dx-log/*` — chronological friction log captured during the build. Each entry is dated and references the project's then-current name (Reflux). The DX-REPORT crystallizes from these.
- `docs/api-research/*` — raw probe outputs from initial API exploration. Same freeze rule.

If you find a new gap during continued work, add a **new** dx-log file (e.g. `05-<topic>.md`) and propagate the finding into DX-REPORT — don't retcon old entries.

## Robustness layer (added 2026-05-06)

The orchestrator gained a coordinated robustness pass before the demo. Six concrete improvements, all tested:

1. **Persistent rebalance cooldown** — see `vault_state` row above; replaces in-memory `lastTickStartedAt`.
2. **Decoupled withdrawal worker** — `WITHDRAWAL_PROCESS_CRON` (default `*/10 * * * *`). Independent of the daily rebalance cron. Race-safe: `trySettleWithdrawal` uses an atomic `UPDATE ... WHERE status='pending'` with `changes === 0` check.
3. **`/vault/info` cache bust on admin mutations** — `bustVaultInfoCache()` called after every `/admin/*` write so public reads reflect new state immediately instead of serving 15s-stale data.
4. **Optional multi-RPC fallback** — `SOLANA_RPC_URL_FALLBACK` env. Read paths use `withRpcFallback()`; write paths intentionally don't (blockhash freshness contract).
5. **Per-route rate limit on `/api/me/:wallet`** — 60 req/min/IP via `@fastify/rate-limit`. Wrapped in a sub-plugin (`server.register(async (instance) => { ... })`) because the plugin's `onRoute` hook needs to be set up before the routes it decorates — Fastify lifecycle gotcha that lost us 20 minutes when we first wired it as a `main()` registration.
6. **Blockhash-expired retry on tx send** — `buildSimSignSendConfirmV0` in `tx.ts`. Replaces ~80 lines of inline build/sign/send/confirm in `lend.ts` and `withdrawals.ts`. Up to 2 attempts with fresh blockhash on each.

## DX-GAP-#28 fix (added 2026-05-06)

**Problem:** the cumulative-deposit accountant promised depositors a notional balance the vault couldn't actually pay out the moment hedges opened. Plus a side-bug: failed withdrawal rows were silently being counted as `withdrawn`.

**Fix shipped:**
- `accountant.ts:getDepositorNetBalance` filters `status != 'failed'` (the leak)
- `accountant.ts:getTotalNetBalance()` — sum of net across all depositors, also filtering failed
- `accountant.ts:getDepositorWithdrawable({ wallet, redeemableVaultUsdc })` — returns `min(notional, shareFraction × redeemable)` with `shareFraction = myNet / totalNet` so `Σ withdrawable ≡ redeemable` is an invariant
- `balances.ts:fetchVaultRedeemableUsdc()` — `walletUsdc + lendPositionUsdc` (deliberately excludes hedge mark)
- `withdrawals.ts:requestWithdrawal` validates against `withdrawableNow` instead of notional
- `index.ts:/api/me/:wallet` returns the new `withdrawable` block alongside `balance`
- `MePageClient.tsx` displays "Withdrawable now" prominently + amber callout when `hedgeLocked > 0`
- `WithdrawForm.tsx` capped at `withdrawableNow`

**Tests:** 9 new in `distribution.test.ts` covering: failed-withdrawal exclusion, `getTotalNetBalance` empty + multi-depositor, `getDepositorWithdrawable` for hedge-locked, fully-redeemable, multi-depositor pro-rata, unknown wallet, empty vault, and post-payout cases.

## Demo basket override (temporary, revert after submission)

`apps/orchestrator/basket.config.json` is **temporarily compressed to a single-market basket** (POLY-1345530, weight 1.0) for the live demo. Reason: the original 5-market basket × Jupiter Prediction's $5 minimum × small TVL means no market clears the per-weight order minimum (DX-GAP-#24 in production). The full diversified basket is preserved in the JSON file under the `_inactive_diversified_basket` key; restore by moving that array back into `markets`.

This decision should itself become a small finding ("we shipped a 5-market basket but had to ship a 1-market basket for live demos because of the $5 minimum × small TVL economics") — file it under DX-GAP-#24 amplification when adding to DX-REPORT.

## Common gotchas

- **`bigint: Failed to load bindings, pure JS will be used`** — cosmetic, comes from the `bigint-buffer` transitive dep loaded by the Lend SDK. Pure-JS path works. Ignore.
- **`.agents/` and `.junie/`** — skills-CLI / JetBrains agent caches. Both gitignored. Restorable from `skills-lock.json` via `npx skills experimental_install`.
- **`apps/web/.next/`** — Turbopack cache. If a build complains about non-existent absolute paths (esp. paths under the old `/frontier/reflux/` directory name), wipe `.next/` and `.turbo/`.
- **Next.js 16 ≠ training data** — `apps/web/AGENTS.md` flags this explicitly. Check `node_modules/next/dist/docs/` before writing routes/middleware/config.
- **`@reflux/*` package names anywhere in code/configs/markdown outside the two snapshot zones** — they are leftover from the rename. Fix them.
- **Comments containing `*/N * * * *`** (cron schedules) inside JSDoc blocks will close the comment block. Use prose ("every 10 minutes") instead of the literal cron string in JSDoc.
- **Fastify plugin `onRoute` hook ordering** — plugins that decorate per-route configs (`@fastify/rate-limit` with `global: false`) must be registered before the routes they hook. We use an encapsulated `server.register(async (instance) => { ... })` pattern for this.

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
| Fastify error handler (4xx pass-through, 5xx generic) | `apps/orchestrator/src/index.ts` (`server.setErrorHandler`) |
| Rate-limited route (sub-plugin pattern) | `apps/orchestrator/src/index.ts` (search `instance.register(rateLimit`) |
| Share accounting + DX-GAP-#28 fix | `apps/orchestrator/src/accountant.ts` (`getDepositorNetBalance`, `getTotalNetBalance`, `getDepositorWithdrawable`) |
| Vault liquidity helpers | `apps/orchestrator/src/balances.ts` |
| Pro-rata payout distribution | `apps/orchestrator/src/{accountant,claimer}.ts` |
| Withdrawal flow | `apps/orchestrator/src/withdrawals.ts` (validates against `withdrawableNow`) |
| Auto-deposit-recovery watcher | `apps/orchestrator/src/depositWatcher.ts` (12 unit tests) |
| Rebalance loop + crons | `apps/orchestrator/src/rebalance.ts` (`scheduleRebalanceCron`, `scheduleWithdrawalCron`) |
| Persistent cooldown helpers | `apps/orchestrator/src/rebalance.ts` (`loadLastTickStartedAt` / `saveLastTickStartedAt`) |
| Hedge order placement | `apps/orchestrator/src/prediction.ts` |
| Lend deposit/withdraw | `apps/orchestrator/src/lend.ts` (uses `tx.ts` helper) |
| Reusable V0 tx send-confirm-with-retry | `apps/orchestrator/src/tx.ts` |
| Drizzle schema + `vault_state` KV table | `apps/orchestrator/src/db/schema.ts` (`vault_state` is also `CREATE IF NOT EXISTS`-ensured in `db/index.ts`) |
| Manual hedge script (now persists to SQLite) | `apps/orchestrator/src/scripts/openHedge.ts` |
| Web pages | `apps/web/src/app/{page,vault/page,me/page,deposit/page,dx/page,about/page}.tsx` |
| /me page (DX-GAP-#28 UI) | `apps/web/src/components/MePageClient.tsx` |
| Withdraw form (capped at `withdrawableNow`) | `apps/web/src/components/WithdrawForm.tsx` |
| Wallet adapter setup | `apps/web/src/components/WalletProviders.tsx` |
| Design system tokens | `apps/web/src/app/globals.css` |
| Public DX log feed | `/dx/observations` (orchestrator) → `/dx` (web) |
| Curated hedge basket (demo override) | `apps/orchestrator/basket.config.json` |

## Style notes

- Match the existing voice in `DX-REPORT.md` and `FEEDBACK.md` — sharp, specific, with file:line receipts. No marketing fluff in technical docs.
- Default to writing no comments. Add one only when the *why* is non-obvious. Never restate what well-named code already says.
- Test count is currently **52 (6 shared + 46 orchestrator)**. If you add or remove tests, update `README.md` (badge + table), `DX-REPORT.md` (test count row), and this file in lock-step.
- Finding count is currently **31 numbered DX-GAPs**. References are #1–#8, #10–#28 (skipping #9), #29–#32. If you add a finding, increment the count in `README.md` (rubric table), `DX-REPORT.md` (intro + TL;DR + closing), `docs/demo-script.md`, and this file.
- Commit messages match the existing style — short imperative subject, blank line, then a structured body explaining *why*. See `git log --oneline -5` for examples.
