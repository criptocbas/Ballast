# DX Log — 01 — AI Stack

Friction points captured while installing and using Jupiter's AI tools.

## DX-GAP-#10 — Skills install command in docs is not headless-safe
- **Reference:** https://developers.jup.ag/docs/ai/skills.md
- **Documented command:** `npx skills add jup-ag/agent-skills --skill "integrating-jupiter"`
- **Reality:** missing `--agent <name>` and `--yes` flags → defaults to interactive prompts that hang in CI / sandbox environments
- **Working command:** `npx skills add jup-ag/agent-skills --skill integrating-jupiter --agent claude-code --yes`
- **Suggested fix:** update the docs to include the headless flags + a sentence on agent selection
- **Severity:** medium (likely to bite anyone running this in a CI agent)

## DX-GAP-#11 — CLI returns better-shaped data than raw HTTP API for the same query
- **Same query, two surfaces:**
  - `curl /prediction/v1/events` → market IDs only, no titles, no inline prices, micro-USD scale
  - `jup predictions events -f json` → full titles, `yesPriceUsd` as decimal float, ISO timestamps
- **Friction:** integrators using the raw API have to reinvent every shape transformation `@jup-ag/cli` already implements internally
- **Suggested fix:** ship the CLI's normalizers as a public `@jup-ag/api-client` package, OR push the normalization into the API responses (units field, decoded titles, etc.)
- **Severity:** high (this is the single biggest gap we've found — it forces a tier of work that the platform should own)

## DX-GAP-#12 — `noPriceUsd: null` on binary markets in CLI events response
- **Command:** `jup predictions events --filter live -f json`
- **Reality:** binary markets return `yesPriceUsd: 0.43, noPriceUsd: null`
- **Friction:** for NO-side strategies (insurance vaults like Reflux, mean-reversion bots) we must either compute `1 - yesPriceUsd` (relying on the binary-mirror invariant) or N+1 to `/markets/{id}`
- **Suggested fix:** always populate both prices in the events response; compute the mirror server-side
- **Severity:** medium (workaround exists but invisible to integrators until they hit it)

## DX-GAP-#13 — `integrating-jupiter` SKILL.md overstates auth requirement
- **In SKILL.md:** "Auth: x-api-key from portal.jup.ag (**required for Jupiter REST endpoints**)"
- **Reality:** keyless access at 0.5 RPS works for many read endpoints (we used it successfully for events, markets, orderbook, lend tokens before getting our API key)
- **Friction:** an agent guided by this skill might fail-fast on missing API key when it could have proceeded with keyless during prototyping
- **Suggested fix:** in SKILL.md, replace the blanket statement with an "Auth tiers" table mapping endpoint → auth level
- **Severity:** medium

## DX-GAP-#14 — CLI is "pre-v1 (early alpha)" with no per-command stability marker
- **Reference:** https://developers.jup.ag/docs/ai/cli.md
- **Friction:** the global pre-v1 warning makes it hard to know what to depend on. `jup predictions events` looks stable; `jup studio create-token` may be alpha. Production integrators need the granularity.
- **Suggested fix:** mark each subcommand with stability tier (`stable`, `beta`, `alpha`)
- **Severity:** low (but matters for production adoption)
