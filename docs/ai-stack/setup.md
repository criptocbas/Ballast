# Jupiter AI Stack — Setup Log

**Captured:** 2026-04-30
**Reference:** https://developers.jup.ag/docs/ai

---

## What we installed

| Tool | Status | Method |
|---|---|---|
| **Docs MCP** | ✅ Configured (project-scoped) | `.mcp.json` at repo root pointing at `https://developers.jup.ag/docs/mcp` |
| **Skills: integrating-jupiter** | ✅ Installed | `npx skills add jup-ag/agent-skills --skill integrating-jupiter --agent claude-code -y` |
| **Skills: jupiter-lend** | ✅ Installed | Same install command, second skill |
| **Jupiter CLI** | ✅ v0.10.0 | `npm i -g @jup-ag/cli` |
| **llms.txt / llms-full.txt** | ✅ Available | Fetched via curl to `/tmp/`, kept in research notes |

---

## Where they live

```
ballast/
├── .mcp.json                                    # Docs MCP config
├── .claude/skills/integrating-jupiter/          # SKILL.md for cross-API guidance
├── .claude/skills/jupiter-lend/                 # SKILL.md for Lend deep-dive
├── skills-lock.json                             # skills CLI lockfile (re-installable)
└── docs/api-research/                           # raw probe outputs
```

Global: `jup` CLI at `/home/cbas/.local/share/mise/installs/node/25.2.1/bin/jup`.

---

## How we use each tool

### Docs MCP
- **Used for**: in-editor doc lookups during development
- **Activation**: project-scoped via `.mcp.json` — picked up on next Claude Code session
- **Risk if alpha**: it's read-only docs, very low risk
- **Skipping for now if needed**: we can always fall back to `curl <docs-url>.md` (worked in our research probes)

### Skills (`integrating-jupiter`, `jupiter-lend`)
- **Used for**: Claude Code reads SKILL.md as context when writing Jupiter integration code
- **Auto-loaded**: yes — `.claude/skills/*` are picked up by Claude Code automatically
- **Coverage check we plan to do**: when our orchestrator hits a cross-API composition (Lend × Prediction), does the skill guide it well? (Probably not — this is itself DX content.)

### Jupiter CLI (`jup`)
- **Used for**: write-path operations in the orchestrator (hedge placement, deposits, claims)
- **Why CLI not direct API**: forces real signal on the AI Stack feedback category (25%)
- **Caveat**: CLI is pre-v1 (early alpha) per docs — we'll capture every breaking change / surprise
- **Hybrid pattern**: CLI for write ops, raw HTTP for high-throughput reads (basket scanning) — gives best of both

### llms.txt / llms-full.txt
- **Used for**: bulk doc context when starting a new dev session in Claude Code
- **llms.txt** loaded per-session for navigation; **llms-full.txt** for deep RAG-style lookup

---

## First-pass observations (will become DX report content)

### ✅ Positive: CLI is significantly better-shaped than raw HTTP API

We probed the same data via both. The CLI normalizes things the raw API does not.

**Same query, two surfaces:**

```bash
# Raw HTTP — what we'd write integrating without the CLI
curl 'https://api.jup.ag/prediction/v1/events?category=crypto&limit=5'
# Returns: market IDs only, no titles, no prices in markets array
# Pricing must be fetched via N+1 calls to /markets/{id}
# All numeric fields in micro-USD (1234567 = $1.23)

# CLI
jup predictions events --category crypto --filter live --limit 5 -f json
# Returns: titles inline, yesPriceUsd as decimal float, ISO timestamps
```

**The CLI is doing the normalization the API doesn't.** This is great for CLI users but exposes a real gap for direct-API integrators: they have to reinvent every helper the CLI ships with.

→ **DX report bullet**: "We were initially writing custom transformers to normalize event/market data shape. Then we tried the CLI and saw that all of these transformations are already implemented in `@jup-ag/cli`. Either ship them as a `@jup-ag/api-client` package, or include a 'shape transformers' section in `integrating-jupiter` skill, or just ship them in the API itself."

### ⚠️ Gap: `noPriceUsd: null` in CLI response

In `predictions events --filter live` the CLI returns `yesPriceUsd: 0.43, noPriceUsd: null` for binary markets.

For Ballast, where we systematically buy NO contracts, this means we have to:
1. Compute NO price as `1 - yesPriceUsd` (relying on the binary-mirror invariant)
2. Or call `/markets/{id}` for every market to get the actual ask price

→ **DX report bullet**: "The CLI events response gives `yesPriceUsd` but `noPriceUsd: null`. For NO-side strategies (insurance, mean-reversion, etc.) this forces an extra round-trip per market. Suggest always returning both, computed if needed."

### ⚠️ Gap: CLI is "pre-v1 (early alpha)" with no upgrade path documented

The CLI docs say breaking changes may be introduced without warning. For production use we'd want either:
- Pinned-version install (`npm i -g @jup-ag/cli@0.10.0`) with semver-stable interface guarantees
- Or a stability indicator per command (e.g., `jup predictions open` is stable, `jup studio create` is alpha)

→ **DX report bullet**: "Stability tier markers per CLI subcommand would help integrators know what to depend on."

### ⚠️ Gap: `integrating-jupiter` SKILL.md says API key is "required" but keyless works

The skill's "Auth" section states:
> **Auth**: `x-api-key` from [portal.jup.ag](https://portal.jup.ag/) (**required for Jupiter REST endpoints**)

But the official docs (`https://dev.jup.ag/docs/llms.txt`, line 6) clearly state:
> Keyless access is available at 0.5 RPS on `api.jup.ag` with no sign-up — ideal for prototyping and lightweight agent use cases.

We've actually used keyless successfully for all read endpoints we've tested so far. The skill should differentiate between read-only endpoints (keyless OK) and write endpoints / higher tiers (key required).

→ **DX report bullet**: "The `integrating-jupiter` SKILL.md overstates auth requirements; this would push agents to fail/halt during prototyping when keyless would have worked. Suggest a 'Tier' table in the skill clearly mapping endpoint → auth requirement."

### Process-of-installing-skills observation

`npx skills add jup-ag/agent-skills --skill integrating-jupiter --agent claude-code` defaulted to interactive prompts (we had to add `--yes` and discover the `--agent` flag from `--help`). Jupiter's docs show:

```bash
npx skills add jup-ag/agent-skills --skill "integrating-jupiter"
```

— missing the `--agent` and `--yes` flags. For headless/CI use this command will hang waiting for input.

→ **DX report bullet**: "Update the install snippet in https://developers.jup.ag/docs/ai/skills.md to include `--agent claude-code --yes` (and a CI-style note) so headless users don't get stuck on interactive prompts."

---

## What we'll log going forward

The orchestrator's `ApiObservation` hook (in `packages/shared/src/clients/http.ts`) will emit one event per HTTP call. We'll cross-reference those with CLI invocations and Skill consultations as we build, and roll the whole thing into the final DX-REPORT.md.

The `/dx` page in the frontend shows this in real-time — judges can verify our integration depth live.
