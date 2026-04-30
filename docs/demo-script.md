# Ballast — 90-second demo video script

**Goal:** show the "oh" moment cleanly. Yield from one Jupiter product paying for hedges in another, on real mainnet, in real time.

**Total length:** target 75-90 seconds.

---

## Scene 1 — Hook (0:00–0:10) · 10s

**Visual:** open with the Ballast hero. Cursor lands on the headline.

> "This is Ballast. A USDC vault on Solana that earns yield in Jupiter Lend, and uses that yield — *only that yield* — to buy insurance hedges on Jupiter Prediction Markets."

**On screen overlay:** "Built for Solana Frontier · Jupiter sidetrack"

---

## Scene 2 — The flip (0:10–0:25) · 15s

**Visual:** scroll past the hero to the "flip that makes this work" section. Brief pause on the schematic code block (`yield ← Lend.withdrawAccrued(...)` etc.).

> "Jupiter built Prediction as a speculation product. We use it as the underwriting layer of an insurance vault. The depositor never pays a premium directly — the vault self-insures with the yield."

---

## Scene 3 — The live vault (0:25–0:50) · 25s

**Visual:** click "See live vault." The `/vault` page loads with real numbers. Pause on:
- Vault address
- `Lend Earn position` card showing `$1.00 in jlUSDC @ 4.36% APY`
- `Hedges` section with the live NO-contract position

> "This is the actual vault, on mainnet, right now. One dollar in Jupiter Lend Earn, earning 4.36% APY. And one open hedge: 26 NO contracts on 'BTC over 80k by end of 2026', cost basis $4.73."

> "If BTC stays under 80k by EOY 2026, the hedge pays out 26 dollars. If it doesn't, the hedge expires and we pay for it from yield, not principal."

---

## Scene 4 — DX log (0:50–1:05) · 15s

**Visual:** click `/dx`. Show the live observation feed — color-coded family chips (Lend / Predict / Swap), latencies, status codes.

> "Every call our orchestrator made to Jupiter is here, live. The colored chips show which API family — Lend in green, Prediction in amber. This is also the front of our judging package: the developer experience report."

---

## Scene 5 — The DX report (1:05–1:25) · 20s

**Visual:** open the GitHub repo. Scroll past `DX-REPORT.md`'s table of contents. Brief stop on the TL;DR with the 8 highest-leverage findings.

> "The bounty rubric says the developer experience report is 35% of the score. So we built one. Twenty-five concrete findings — every one with a specific endpoint, why it matters, and a suggested fix Jupiter could ship Monday morning."

> "The biggest one: the Jupiter CLI is significantly better-shaped than the raw API. Ship those normalizers as a public SDK package and you fix a third of the friction in this report."

---

## Scene 6 — Outro (1:25–1:30) · 5s

**Visual:** back to the Ballast hero. Logo fade.

> "Ballast. Yield with a built-in tail-risk hedge. Repo and live demo on GitHub."

**End card:** github.com/criptocbas/Reflux · sebastianbarrientosa@gmail.com

---

## Recording checklist

- [ ] Helius RPC env var set so `/vault/info` resolves quickly (no public-RPC 429s on camera)
- [ ] Run `pnpm dev:orchestrator` and `pnpm dev:web` in separate terminals
- [ ] Browser zoom set to 110% so type and numbers are readable
- [ ] Dark theme consistent; no system light-mode flash
- [ ] Cursor visible (1080p screen recordings cut tiny cursors)
- [ ] Clean `/dx` log — restart orchestrator before recording so the feed shows fresh, recent calls
- [ ] Audio: trim and normalize; verbal pace ~150 wpm matches the time budgets above

## Alternate ending (if 90s feels long)

Compress scenes 4–5 into a single 25-second beat showing both `/dx` and the report TOC.
