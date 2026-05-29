# Stock-Based Economy — PR 3: Calibration + Docs

**Status:** Not started — notes/open-questions only. The full task list gets built when PR 3 begins.

**Goal:** Replace the *mechanically-derived* per-good `targetStock` / initial-stock values (PR 2 used the midpoint of the legacy supply band) with **deliberately calibrated** values, validated against the simulator's equilibrium targets, and update the functional docs (`docs/active/gameplay/economy.md` still describes the old dual supply/demand model).

**Design reference:** `docs/planned/stock-based-market-economy.md`. Pricing core: `lib/engine/market-pricing.ts` + `lib/constants/market-economy.ts`.

---

## Open question — `targetStock` is the same across all economies (raised in PR 2 review discussion)

**Observation (Kai):** for a given good, the hidden `targetStock` (the stock level where `mid price == basePrice`) is **per-good and identical across every economy type**. `getTargetStock(goodId)` ignores economy type entirely:

```ts
targetStock = round((equilibrium.produces.supply + equilibrium.consumes.supply) / 2)
// food → round((155 + 110)/2) = 133, the same anchor at an agricultural, tech, or neutral world
```

So the "cheap at producers / expensive at consumers" arbitrage signal comes **only** from where the *stock* sits relative to that shared anchor:
- Producer (ag world) seeds high (`produces.supply` 155 > 133) → mid ≈ 26 (cheap); production keeps refilling.
- Consumer (tech world) seeds below the anchor (~117 < 133) → mid ≈ 34 (expensive); consumption keeps draining.
- Neutral seeds at the anchor → mid == base.

This works and is self-correcting (buying out a producer pushes its stock toward the anchor, raising the price). **But it's worth a deliberate decision in PR 3:**

1. **Is a shared per-good anchor the right model, or should `targetStock` be economy-specific?** A per-economy anchor would let us tune "where price == base" independently for producers vs consumers, rather than relying solely on seed + production/consumption pressure to separate them. Trade-off: more knobs vs. more emergent. Current leaning: keep the shared anchor (simpler, self-correcting) and calibrate the *gap* via seed/production/consumption magnitudes — but confirm.
2. **Is the midpoint derivation producing good arbitrage gaps per good?** Today each good's gap is whatever `(produces.supply + consumes.supply)/2` happens to yield — not deliberately balanced. Sweep the simulator and set per-good targets/seeds so every tradable good has a meaningful, intentional spread between its producer and consumer economies (and so cheap goods aren't drowned by rounding).
3. **Cross-check against the elasticity `k`** (currently 1) — the gap also depends on curve steepness, not just the anchor.

## Related (already shipped in PR 2 review pass, context for PR 3)

- Instant same-market buy→resell is guarded by the **bid-ask spread only** (slippage is symmetric on a round-trip — it cancels). Reputation perks were bounded to ±2% so they can't invert the spread; see `economy-resell-invariant` memory + the anti-arbitrage test in `lib/constants/__tests__/reputation.test.ts`. The richer reputation reward is slated to move **off** the price spread (BACKLOG: "Decouple reputation reward from market price").
- Market table decluttered: dropped the redundant "Current Price" (mid) column; shows Base / Stock / Buy / Sell / Trend.

## Docs to update in PR 3

- `docs/active/gameplay/economy.md` — still documents the legacy `price = basePrice × (demand/supply)` dual-axis model, mean reversion, and dual supply/demand bounds. Rewrite for the single-stock model (anchor curve, self-limiting production/consumption, no demand axis, prosperity).
