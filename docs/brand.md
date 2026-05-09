# Ballast — Brand & Design System

**Status:** v1 (locked for hackathon submission)
**Captured:** 2026-04-30

---

## Name

**Ballast.**

A ship's ballast is the weight at the bottom that keeps it stable in storms. For our product, the prediction-market hedges are the ballast — they keep the vault stable when crypto markets storm.

The name was chosen over "Reflux" after a brief audit found:
- `reflux.finance` already taken by another DeFi project
- The first Google result for "Reflux" is a medical condition
- "Ballast" has no DeFi taker, a clean Solana-DeFi search result, and a metaphor that explains the product in one word

Everything ships as Ballast — workspace name, packages (`@ballast/*`), database file, GitHub repo, branding. The only surviving "Reflux" references are inside `docs/dx-log/*` and `docs/api-research/*`, which are frozen historical snapshots from before the rename.

## One-line description

> A USDC vault where Jupiter Lend yield finances NO-contract hedges on tail-risk prediction markets. The yield is the premium engine; the hedges are the ballast.

## Tagline

> **Yield with a built-in tail-risk hedge.**

Used on the landing hero. Direct, no metaphor — leaves room for the metaphor to land later.

---

## Voice & Tone

| Be | Don't be |
|---|---|
| Engineering-honest. Explain what it does without hyperbole. | Crypto-bro. No "degens," "wagmi," "GM." |
| Quietly confident. Show, don't shout. | Loud. No exclamation marks unless something is genuinely surprising. |
| Specific. Numbers, named primitives, real positions. | Vague. No "powerful," "innovative," "next-gen." |
| Honest about limits. Disclaim what we're not. | Aspirational. No "the future of insurance" pitching. |
| Sparingly metaphorical. Maritime metaphors fit; use them once or twice, not in every sentence. | Cute. No anchors, ships, or sailor emojis in body copy. |

Examples:

- ✅ *"The vault deposits your USDC into Jupiter Lend Earn, then routes the yield it generates into NO-contract hedges on tail-risk prediction markets."*
- ❌ *"Smooth sailing through crypto storms with Ballast's revolutionary auto-hedge engine!"*

- ✅ *"v1 is a transparent custodial vault. Don't deposit funds you can't afford to lose."*
- ❌ *"Battle-tested, audit-ready, institutional-grade vault infrastructure."*

---

## Color system

Dark, deep, structural. Single warm accent — amber, like a lighthouse beacon — against deep ocean navy.

```
--bg            #08090f   (very dark navy, near-black with blue undertone)
--bg-elev       #0f1118   (one step up, surfaces / cards)
--bg-elev-2     #161922   (two steps up, hover / focus)

--fg            #f0f2f5   (off-white, subtle warmth)
--fg-dim        #9aa3b0   (secondary text)
--fg-muted      #6a7280   (tertiary / labels / metadata)

--border        rgba(255, 255, 255, 0.08)
--border-strong rgba(255, 255, 255, 0.16)

--accent        #d97706   (amber 600 — primary actions, brand)
--accent-soft   rgba(217, 119, 6, 0.16)   (accent backgrounds)

--positive      #10b981   (emerald — gains, fills, confirmed)
--warn          #eab308   (yellow — alerts, pending state)
--danger        #ef4444   (red — losses, errors)
```

**Accent rules:**
- Reserved for *one* moment of attention per view (primary CTA, current value, single key metric)
- Never used decoratively on more than one element in the viewport
- Don't tint backgrounds with it; use `--accent-soft` for subtle highlights only

---

## Typography

We keep the **Geist** family loaded (Sans + Mono). It's modern, clean, and pairs well with the structural feel.

- Headings: Geist Sans, weight 600, tight letter-spacing on display sizes
- Body: Geist Sans, weight 400, comfortable line-height (1.55-1.65)
- Numbers and code: Geist Mono with `tabular-nums`. Always.
- No serifs in v1 (room for a display serif like Fraunces later if we need extra brand differentiation)

Sizes (Tailwind scale):
- Hero h1: `text-5xl sm:text-6xl`, leading-tight, balance-text
- Section h2: `text-2xl` to `text-3xl`
- Card titles: `text-base` to `text-lg`
- Body: `text-[15px]` for substance, `text-sm` for UI
- Labels: `text-xs uppercase tracking-wider`

---

## The mark

A **plumb bob** glyph: a vertical line dropping to a filled circle at the bottom.

The plumb bob is the simplest tool for finding a stable vertical — gravity does the work. It's the most direct metaphor we could draw for what Ballast does. It also reads as a clean geometric mark at any size.

```
   │
   │
   │
   ●
```

24×24 SVG, paired with the wordmark in the header (`Ballast` set in Geist Sans 600).

The pill `BETA` (or `ALPHA` for now) sits next to the wordmark — small, uppercase, tracking-wider, low-contrast.

---

## Layout principles

- **Generous whitespace.** A view should breathe. Default to more vertical rhythm than feels right.
- **One column per concept.** Don't pack three different ideas across in side-by-side grids unless they're a logical set.
- **Borders > shadows.** Subtle 1px borders define cards and dividers; no drop shadows.
- **Live data badges** (`Live`, `Live feed`, etc.) use the StatusPill component with a soft pulse — quietly signal that the page is real.
- **Tabular numbers everywhere financial values appear.** Always.
- **Address shortening** uses `XXXXXX…XXXXXX` (6 left, ellipsis, 6 right).

---

## Component patterns

- `card` — bg-elev, 1px border, 12px radius. Used for stat tiles, position rows, info blocks.
- `card-hover` — same, with subtle border and bg shift on hover.
- `StatusPill` — small uppercase badge, optionally with a pulsing dot, for liveness/state indicators.
- `Stat` — label + value tile. Default mono for numeric values; sans for short text.
- `HedgeCard` — full-width tile for an open prediction position; side badge, market title, value/PnL, sub-grid of contracts/avg/mark/cost basis/resolution date.

---

## What's still open

- A display serif for headings (currently all Geist Sans). Decide in next visual polish pass.
- Iconography set — currently using inline SVG line-icons; consider a tiny icon component.
- Favicon — currently the auto-generated Next.js favicon; replace with the plumb-bob mark.
- Open Graph image — replace with a Ballast-branded card.
