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

**Visual:** scroll past the hero to the "**The composition** — Yield is the premium. Prediction is the underwriter." section. Brief pause on the schematic code block (`yield ← Lend.withdrawAccrued(...)` etc.).

> "Jupiter built Prediction as a speculation product. We use it as the underwriting layer of an insurance vault. The depositor never pays a premium directly — the vault self-insures with the yield."

---

## Scene 3 — The live vault (0:25–0:50) · 25s

**Visual:** click "See live vault." The `/vault` page loads with real numbers. Pause on:
- Vault address
- `Lend Earn position` card showing `~$19.75 in jlUSDC @ ~4.24% APY`
- `Hedges` section with the live NO-contract position

> "This is the actual vault, on mainnet, right now. About twenty dollars in Jupiter Lend Earn at four-and-a-quarter percent APY. And one open hedge: sixteen NO contracts on 'Bitcoin over ninety thousand by end of 2026,' cost basis five dollars and twelve cents."

> "If BTC stays under 90k by EOY 2026, the hedge pays out 16 dollars on a $5.12 cost basis — a ten-dollar gain financed entirely by Lend yield, not depositor principal. If it doesn't, the hedge expires and we paid for it from yield, not principal. Either way, depositor principal is intact in Lend."

**Optional pause** (pick if you have time): scroll to the `/me` page briefly, point at the **Withdrawable now** number being clamped beneath the notional balance.

> "And here's the depositor view. Your notional balance is what you've put in; withdrawable now is what the vault can actually pay out instantly — the rest is locked in the hedge. We hit this exact UX trap during the build, fixed it, and shipped a finding for Jupiter. It's DX-GAP-#28 in the report — our headline finding."

---

## Scene 4 — DX log (0:50–1:05) · 15s

**Visual:** click `/dx`. Show the live observation feed — color-coded family chips (Lend / Predict / Swap), latencies, status codes. Briefly highlight the call count and median latency cards at the top.

> "Every call our orchestrator made to Jupiter is here, live. Color-coded by API family — Lend in green, Prediction in amber. Latencies, status codes, the whole call log. We built this because we needed honest evidence of integration depth for the bounty — but it's also the kind of page Jupiter could ship for `developers.jup.ag` itself."

---

## Scene 5 — The DX report (1:05–1:25) · 20s

**Visual:** open the GitHub repo. Scroll past `DX-REPORT.md`'s table of contents. Brief stop on the TL;DR with the 7 highest-leverage findings.

> "The bounty rubric says the developer experience report is 35% of the score. So we built one. Thirty-one concrete findings — every one with a specific endpoint, why it matters, and a suggested fix Jupiter could ship Monday morning. The biggest finding is one we hit ourselves during this build: shipping a vault on Lend Earn surfaced a UX trap nobody else has documented yet. Five of those findings are field reports — real production incidents we caught during the build, fixed, and documented. One we upstreamed as a PR to jup-ag/agent-skills."

> "The biggest one: the Jupiter CLI is significantly better-shaped than the raw API. Ship those normalizers as a public SDK package and you fix a third of the friction in this report."

---

## Scene 6 — Outro (1:25–1:30) · 5s

**Visual:** back to the Ballast hero. Logo fade.

> "Ballast. Yield with a built-in tail-risk hedge. Live on Solana mainnet. Repo and report linked below."

**End card:** github.com/criptocbas/Ballast · sebastianbarrientosa@gmail.com

---

## Recording checklist

- [ ] Helius (or other paid) RPC env var set so `/vault/info` resolves quickly — no public-RPC 429s on camera
- [ ] Run `pnpm dev:orchestrator` and `pnpm dev:web` in separate terminals; wait for the boot log line `Ballast orchestrator listening` before recording
- [ ] Browser zoom set to 110% so type and numbers are readable at 1080p
- [ ] Dark theme consistent; no system light-mode flash on initial page load
- [ ] Cursor visible (1080p screen recordings cut tiny cursors)
- [ ] Hard-refresh `/vault` and `/me` immediately before recording so the 15-second `vaultInfoCache` serves fresh data and the hedge card renders
- [ ] Optional: trigger a quick read like `curl http://localhost:4000/lend/tokens` so the `/dx` feed has a few recent entries when you land there
- [ ] Connect your wallet on `/me` *before* recording starts so the connect-wallet UX doesn't eat 5 seconds of the 25s vault scene
- [ ] Audio: trim and normalize; verbal pace ~150 wpm matches the time budgets above

## Alternate ending (if 90s feels long)

Compress scenes 4–5 into a single 25-second beat showing both `/dx` and the report TOC.
