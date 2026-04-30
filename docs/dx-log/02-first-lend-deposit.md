# DX Log — 02 — First on-chain Lend deposit

Notes captured while wiring `@jup-ag/lend` and `@jup-ag/lend-read` and landing the
vault's first real `jlUSDC` position on Solana mainnet.

**Mainnet transaction:** `4dKhnE1s5GGzidZ4v6h17P23D9FQyruya6viRDX2Yr9pUdYs8kTfT79LgCswhukeJnkzYh9DASk8t6c61rAA9R5M`
([Solscan](https://solscan.io/tx/4dKhnE1s5GGzidZ4v6h17P23D9FQyruya6viRDX2Yr9pUdYs8kTfT79LgCswhukeJnkzYh9DASk8t6c61rAA9R5M))

---

## ✅ What worked beautifully

### `getDepositIxs` is dead simple
The deposit-side API in `@jup-ag/lend/earn` is exactly what an integrator wants:

```ts
const { ixs } = await getDepositIxs({
  amount: new BN(1_000_000),  // 1 USDC
  asset: USDC_MINT,
  signer: vaultPubkey,
  connection,
});
```

We wrap the instructions in a `VersionedTransaction`, simulate, sign, and send. End-to-end clean. No surprises.

### Simulation worked first try
`connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true })` returned no errors and the live send confirmed in seconds. This is exactly the kind of "boring success" we want at this layer — no instruction-account-mismatch debugging, no surprises about ATA setup.

### Position read returns the on-chain truth
`client.lending.getUserPositions(vaultPubkey)` correctly returned our `jlUSDC` position immediately after the deposit confirmed.

---

## ⚠ DX-GAP-#15 — `jupiter-lend` Skill says `client.lend`, SDK exposes `client.lending`

**Path:** `.claude/skills/jupiter-lend/SKILL.md`

The Skill's prose mentions `client.lend.getUserPositions(...)` but the actual SDK
(`@jup-ag/lend-read@0.0.12`) exposes the namespace as `client.lending`. We
confirmed by reading `dist/index.d.mts`:

```ts
declare class Client {
  readonly liquidity: Liquidity;
  readonly lending: Lending;     // ← actual namespace
  readonly vault: Vault;
}
```

**Severity:** medium. An agent following the Skill verbatim will hit a TS error and
then have to spelunk the .d.ts to find the right name.

**Suggested fix:** rename in the Skill, or alias `client.lend` → `client.lending`
in the SDK.

---

## ⚠ DX-GAP-#16 — `userPosition.underlyingBalance` is the wallet balance, not the position value

When we read our position right after depositing $1, the SDK returned:

```
userPosition.jlTokenShares      = 960_147     (≈ 0.96 jlUSDC, the actual position)
userPosition.underlyingBalance  = 7_000_000   (≈ $7 USDC, our wallet's USDC balance)
userPosition.underlyingAssets   = ?           (unclear distinction)
```

The field name **strongly suggests** `underlyingBalance` is "what your jlToken
position is worth in underlying terms" — that's what every integrator will
assume. In reality it's the user's wallet balance of the underlying mint, which
is unrelated to the position.

We discovered this only because the number was suspiciously identical to our
post-deposit USDC wallet balance (which dropped from 8 → 7 after the $1 deposit).

**Severity:** high. Anyone surfacing this number as "your position value" will
display garbage. Our first version of the vault page UI showed `$7.00` for a
$1.00 deposit until we caught it.

**Suggested fix:** rename to `underlyingWalletBalance` (or remove it entirely
from the position type — it's a wallet concern, not a position concern). At
minimum, document the distinction with `underlyingAssets` in the type
declaration.

---

## ⚠ DX-GAP-#17 — `JlTokenDetails.supplyRate` and `rewardsRate` use an undocumented BN scale

The REST endpoint `/lend/v1/earn/tokens` returns rates as clean basis points:

```json
{ "supplyRate": "323", "rewardsRate": "113" }   // 3.23% + 1.13% = 4.36%
```

The SDK's `JlTokenDetails` returns the same fields as `BN`:

```
supplyRate.toString()  = "<huge number>"
rewardsRate.toString() = "<huge number>"
```

Combining them with `supplyRate.add(rewardsRate).toNumber()` and using as bps
returns ~`1.1×10¹²` — clearly not 436 bps. The scale factor isn't documented in
the type or in the Skill.

We worked around it by sourcing the rate from the REST endpoint and only using
the SDK for the on-chain position state.

**Severity:** medium. Anyone trying to display APY from the SDK directly will
silently render absurd numbers.

**Suggested fix:** either document the scale (likely `1e10` or `1e12`) in the
field's TSDoc, or expose a normalized `apyBps: number` derived field on
`JlTokenDetails`.

---

## Operational note (not a Jupiter gap, but worth flagging)

Solana's public RPC (`api.mainnet-beta.solana.com`) returned **constant 429 Too Many Requests**
during a single deposit flow. The Lend SDK's internal retry policy ate them gracefully
(default: 4 retries with backoff) but added several seconds of latency.

After switching to a Helius paid RPC, the entire deposit + position read completed in ~3 seconds with no retries. **For any agent automation hitting Lend SDK or Solana RPC, a paid endpoint is essentially mandatory.**

This isn't a Jupiter API issue, but `integrating-jupiter` SKILL.md recommends
"any Solana RPC" without a tier suggestion. A short note like *"Free public
endpoints will rate-limit you within seconds; budget for a paid RPC like Helius
or QuickNode"* would save integrators an afternoon.

---

## Bonus: `bigint: Failed to load bindings, pure JS will be used`

A noisy stderr line printed every time the Lend SDK loaded — coming from `bigint-buffer` (a transitive dep). It's cosmetic (pure-JS path works) but unsettling
in a clean dev experience. Worth pinning the dep up the chain or suppressing
the warning.
