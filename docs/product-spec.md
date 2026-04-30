# Reflux — Product Spec (v1)

**Status:** v1 scope locked
**Captured:** 2026-04-30

---

## Product summary

Reflux is a yield-bearing USDC vault for Solana DeFi users who want passive yield with built-in tail-risk hedging. Depositors earn Jupiter Lend Earn yield on their USDC. The vault automatically uses a portion of that yield to buy NO contracts on tail-risk prediction markets — events that, if they happen, would correlate with bad outcomes for crypto holders. If a hedged event resolves NO (i.e. the bad thing doesn't happen), depositors keep the residual yield. If it resolves YES (bad thing happens), the payout sweeps back to depositors.

**Reflux is a soft hedge, not full insurance.** It offsets some downside while principal still earns yield. It is explicitly framed as "tail-risk-hedged yield" not as an insurance product (regulatory caution).

---

## Target user

- Existing Solana DeFi users holding $1k–$100k in stables
- Want yield (would otherwise hold USDC in Lend Earn or similar)
- Have crypto exposure elsewhere; nervous about drawdowns
- Comfortable with a custodial vault that's transparent and auditable

---

## Core flows

### 1. Deposit
1. User connects Solana wallet (Phantom, Solflare, etc. via `@solana/wallet-adapter-react`)
2. User chooses deposit amount in USDC
3. Frontend constructs SPL token transfer → vault keypair
4. User signs and submits transaction
5. Frontend posts the signature to the orchestrator's `/api/deposits/confirm` endpoint
6. Orchestrator validates the on-chain transfer landed, credits depositor's share in SQLite, returns confirmation
7. UI shows: "Deposited. Your USDC is earning yield in Jupiter Lend Earn. Hedges will adjust on next rebalance."

### 2. Vault rebalance (orchestrator-driven, daily 00:00 UTC)
1. Read current Lend Earn position (jlUSDC balance + accrued yield since last tick)
2. Withdraw realized yield from Lend Earn
3. Claim any resolved Prediction Market positions
4. Convert non-USDC payouts to USDC via Swap V2 if needed
5. Compute available premium budget = realized yield × hedgeBudgetFraction (default 50%)
6. Compound the other 50% back into Lend Earn
7. Run basket selector: load `basket.config.json`, fetch live prices for each market via Prediction API, reject markets whose orderbook depth is below threshold
8. Place limit BUY NO orders on each market in basket, sized to (premiumBudget / N markets)
9. Persist event log entry (timestamp, before/after state, every API call's request/response)

### 3. Withdraw
1. User connects wallet, requests withdraw amount
2. Frontend submits a signed withdraw intent to orchestrator
3. Orchestrator validates depositor share, queues the withdrawal for next rebalance window
4. At rebalance, orchestrator: withdraws proportional jlUSDC from Lend Earn → transfers USDC to depositor wallet → marks withdraw fulfilled
5. UI shows "Withdraw queued for next rebalance window (X hours)"

### 4. Payout (when a hedged event resolves YES)
1. Orchestrator detects resolution via Prediction Market position state
2. Calls `claim` endpoint to receive payout USDC
3. Distributes payout pro-rata to depositors based on their share at the time of position open
4. Compounds the rest back into Lend Earn (depositor share grows)
5. Notification shown on `/me` page

---

## UI pages

### `/` — Landing
- Hero: "Yield with a built-in tail-risk hedge."
- Three-block explanation: how it works
- TVL + APY estimate + currently-hedged events
- "Deposit USDC" CTA

### `/deposit`
- Connect wallet
- Choose amount, see preview: estimated yield, share %, current hedge basket
- Sign & deposit

### `/vault` — public dashboard
- TVL, depositors count, total yield generated, total premium spent on hedges, total payout received
- Currently-open hedge positions: market, position size, projected payout if YES resolves
- Recent rebalances log (last 10)
- Vault keypair address (clickable to Solscan)
- Lend Earn position address (clickable)

### `/me` — depositor view
- Wallet-gated (must connect)
- Your share %, current value (principal + accrued yield - premiums spent + payouts received)
- Your projected payout if any current hedge resolves YES
- Withdraw button
- Personal event log

### `/dx` — public DX log (transparency + judging)
- Read-only feed of every API call the orchestrator made (last 1000)
- Each entry: endpoint, params, response time, success/failure, status
- Friction-flagged entries highlighted (`⚠️ DX gap captured`)
- This page is **part of the submission strategy** — judges can verify our integration depth in real time.

---

## Out of scope for v1

- On-chain vault program (v2 — would require audit; out of scope for hackathon)
- Multi-asset deposits (USDC only in v1)
- Mobile-native UI
- Email/push notifications
- Fee mechanism / protocol revenue
- DAO governance over hedge basket
- AI agent for dynamic basket selection
- Sophisticated hedge sizing (Kelly criterion, mean-variance optimization)
- Yield-leveraging via Lend Borrow (could compound hedge budget by borrowing against jlUSDC)
- JUICED-backed vault tier (v1.5 stretch if time)

---

## Success metrics for the demo

| Metric | Target |
|---|---|
| End-to-end deposit → Lend Earn → first hedge placed | Working on mainnet |
| Number of distinct Prediction markets hedged | ≥5, ≥3 categories |
| Number of distinct Jupiter API endpoints exercised | ≥12 across 5 APIs |
| Rebalance loop runs autonomously | At least 3 successful rebalance cycles before submission |
| DX log entries with `⚠️ DX gap captured` flag | ≥15 (translates to a substantive report) |
| AI Stack tools exercised in the dev loop | All four: CLI, Skills, Docs MCP, llms.txt |
| Demo video length | 60-90 seconds, walking through deposit → vault state → simulated rebalance |

---

## Submission deliverables

Per Jupiter's bounty requirements:
- ✅ Link to project: GitHub repo + deployed Vercel URL
- ✅ DX Report: `DX-REPORT.md` in repo, also mirrored on `/dx` page in app
- ✅ Email tied to Developer Platform account: cross-references API key usage data

Also planned:
- 60-90s demo video
- Architecture diagram (ASCII in repo + visual in submission)
