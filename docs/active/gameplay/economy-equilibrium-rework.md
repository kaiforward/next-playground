# Economy Equilibrium Rework — Anchor-Relative Production & Satisfaction (+ Scale Calibration)

> Was sub-project **2** of the Economy Scaling & Trade Rework (doc deleted with the grand-strategy
> pivot; the equilibrium model and calibration described here are fully shipped and stay). Builds on
> the shipped [economy-scale knob](./economy-scale-knob.md).

## Headline

The economy equilibrates with stock floating up to the **storage ceiling** (~2× the days-of-supply
anchor) instead of resting at the **anchor**, because both self-limiting factors — the production
throttle *and* pop satisfaction — are measured against `maxStock` (the storage ceiling) rather than
`targetStock` (the demand anchor). Two bugs fall out of that one fact:

1. **Prices pin near the floor almost everywhere.** A live audit at tick 4844 (10k scale, 7886 systems)
   found **90.7% of markets below 0.9× base, median 0.63×**, with the entire 60-region spread compressed
   into 0.63×–0.71× — *zero* geographic price variation. Tier-0 raws sit dead on the 0.50× floor at
   93–98% of markets. There is nothing to arbitrage.
2. **Abundance can't buy contentment.** Satisfaction (`sqrt((stock−min)/(max−min))`) only reaches 1.0 at
   the storage ceiling, so a system sitting exactly at its days-of-supply anchor reads only ~0.58
   satisfied; since equilibrium unrest ≈ dissatisfaction, **unrest floors at ~0.13–0.3 no matter how
   well-supplied a system is** (audit: mean satisfaction 0.65, mean unrest 0.13).

This phase reframes **both** self-limiting factors to be **anchor-relative**: a producer holds roughly
its days-of-supply and then idles excess capacity (instead of filling the warehouse), and a population is
fully content once its days-of-supply is met (instead of needing the warehouse full). Then we pick the
real `ECONOMY_SCALE = S` on the settled economy, and add a price-dispersion metric to the simulator so
the change can be iterated in-memory.

### Scope boundary (read this — it sets honest expectations)

This phase fixes two **bugs** and makes magnitudes legible. It does **not**, on its own, deliver a deep,
durable price spread. The galaxy still carries **1.24–1.70× latent production capacity** (tier-0 1.70×,
tier-1 1.24×, tier-2 1.42×), so once standing inventory is fixed, any local shortfall is still answered by
idle capacity ramping up — scarcity is shallow and *responsive*. A real, durable spread (value accruing
**up the production chain**, advanced goods genuinely dear) needs a **cost of capacity** — upkeep /
maintenance / treasury — so that over-provisioning is *unprofitable* and prunes itself. **None of that
exists today, and it is deliberately [SP5](./economy-simulation-vision.md) (full faction agency).** This
phase lifts prices off the floor and removes the *artificial abundance*; SP5 creates the *genuine
scarcity*. Doing the cost-of-capacity work here would be imposing scarcity by fiat — the opposite of the
emergent-realism north star.

Also out of scope: the contract-model rework (bounty / marketplace / discrete) is **SP3**; ship
re-pricing is **SP4**.

## Diagnosis — the mechanism (verified against code)

The per-market band (`lib/engine/market-pricing.ts:120`):

- `targetStock` (the **anchor**, where `price = base`) = `TARGET_COVER × demandRate × anchorMult`.
- `minStock = targetStock / priceCeiling^(1/k)` — the expensive end (`price = priceCeiling × base`).
- `maxStock = targetStock / priceFloor^(1/k) + storageCapacity` — the **storage ceiling**, far above the
  anchor. Even with zero storage the floor-reach term alone is ~2× the anchor; built storage pushes it
  higher, so *better-developed systems hold even more idle stock and read even cheaper*.

Both self-limiting factors (`lib/engine/tick.ts:45`) run over the full `[minStock, maxStock]` band:

- **Produce:** `sqrt((maxStock − stock) / range)` — production only throttles toward zero as stock nears
  `maxStock`.
- **Consume (satisfaction):** `sqrt((stock − minStock) / range)` — only reaches 1.0 at `maxStock`.

With tier-0 capacity at 1.70× consumption, production stays near full until stock climbs to ~65% of the
band — landing at **~2× the anchor** (the audit's median cover of 2.0–2.5 confirms it). Then
`price = base × (anchor/stock)^k` pins toward the 0.50× floor. The satisfaction mirror floors unrest.
**One root cause — equilibrium stock settles at the ceiling, not the anchor — drives both symptoms.**

The production throttle is also reused by infrastructure-decay as its "is this capacity selling?" signal
(`outputUptake`, `lib/engine/tick.ts:67`). That coupling is a key interaction (see below).

## The change

### 1. Anchor-relative production throttle (fixes overstocking)

Introduce an **operating ceiling** `operatingCeiling = HOLD_COVER × targetStock`, where `HOLD_COVER` is a
small multiple (initial guess **1.2–1.5**, calibrated). The production self-limiting factor operates over
`[minStock, operatingCeiling]` instead of `[minStock, maxStock]`.

- **Effect:** equilibrium stock rests just above the anchor → producer prices rise from the floor toward
  base; excess capacity simply idles.
- **Exports are preserved** because export drainage holds a producer's stock *low* — while diffusion /
  logistics keep pulling, stock stays below `operatingCeiling`, the throttle stays high, and the producer
  keeps making goods to export. With `HOLD_COVER = 1.3`, a producer sitting *at* its anchor still runs at
  ~61% capacity (≈1.04× local consumption for a 1.70×-capacity exporter), so it makes a small export
  surplus and holds near the anchor; drained harder, it makes more. It idles only when nobody wants the
  good.
- **`maxStock` is demoted** from "throttle ceiling" to what it should be: the absolute storage clamp and
  the price-curve's floor-reach. Stock is still clamped to `[minStock, maxStock]` (a market *can*
  physically pile up in a demand collapse), but in normal operation it never approaches `maxStock`.

### 2. Anchor-relative satisfaction (fixes the unrest floor)

The consume-side self-limiting factor saturates at the **anchor**:
`satisfaction = sqrt(clamp((stock − minStock) / (targetStock − minStock), 0, 1))` → reaches 1.0 once
`stock ≥ targetStock` and stays there.

- **Effect:** a system with its days-of-supply met reads fully content; unrest is no longer floored by an
  abundance the model refuses to credit. Pops don't need a full warehouse to be calm — just to not be
  running dry.
- This is the §13 SP4-booked "satisfaction should saturate at the anchor, not the storage ceiling" item,
  **pulled forward** because it is the *same mechanism* as the pricing fix — both are "measure against the
  anchor, not the ceiling."

`HOLD_COVER` (produce) and the satisfaction cover (=1.0, saturate at anchor) are separate knobs: a
producer holds a little *above* days-of-supply before idling; a population is content *at* days-of-supply.

### 3. Pick `S` (`ECONOMY_SCALE`) — last, on the settled economy

Once the equilibrium change is in and validated, measure the baseline export/import magnitude
distribution and pick `S` so typical imports/exports land in the **hundreds–thousands** (legibility — 1
pop unit ≈ 1M people; a player hauls one ship-load slice of a much larger flow). Because the knob is
ratio-invariant (proven by `economy-scale-invariance.test.ts`), this is a **linear solve off the
baseline + a validation sweep**, not a search. Decide at calibration time whether to **flip the live
default** or keep `S` staged (default stays 1) until SP3 consumes it — flipping is ratio-invariant and
harmless but changes every displayed magnitude with no player-facing payoff yet; staging keeps the live
UI unchanged. Lean: **stage it** (record the value, don't flip) unless we want the bigger numbers in the
dev UI now.

**Decision (calibrated): `ECONOMY_SCALE = 100`, staged (live default stays `1`).** Measured on the
settled `HOLD_COVER = 1.3` economy (3000-tick sim, seed 42, 8 greedy + 8 random): final-world flow
magnitudes were median **1**, p90 **4**, max **49** units, with per-good typical (median) flows of
**2–3** and busy lanes (p90) of **14–27**. The linear solve to land typical flows in the hundreds–
thousands gives `S ≈ 100` (typical 200–300, busy lanes 1.4K–2.7K, biggest ~4.9K). Ratio-invariance
re-confirmed on the new equilibrium (`economy-scale-invariance.test.ts`, 2/2), so prices and balance are
unchanged at any `S` — this is purely cosmetic magnitude.

**Staged, not flipped — but the flip IS coming in SP3 (this is expected, not a regression).** SP3 will
set the live default to `100`, which **changes every displayed magnitude ×100** (stock, production,
consumption, storage, flows) while prices and gameplay stay identical, and **requires a reseed** (the
seed writes scaled magnitudes). That reseed is a known, planned step — not something to avoid. We stage
here only because there is no player-facing payoff until SP3 consumes the larger numbers; the live UI and
existing dev seed stay on `S = 1` until then.

### 4. Simulator dispersion metric (the test instrument)

The simulator already runs the same economy / population / logistics processor bodies as live, in-memory,
deterministically, thousands of ticks in seconds — but its `marketHealth` output reports only price
*stdev*, not the price-level distribution we need. Port the audit's signals into `SimResults.marketHealth`:

- price/base distribution: median, p10, p90, %cheap (<0.9×) / near (0.9–1.1×) / expensive (>1.1×);
- per-good cover (stock/anchor), %surplus / %deficit.

This becomes a **permanent, wired instrument** for this change and every future economy pass — the coarse
"is there dispersion?" health read, available without touching the DB.

## Key interactions to reconcile (the risky bits)

- **Infra-decay's `outputUptake` signal** (`tick.ts:67`) is currently the *same* call as the production
  throttle (`selfLimitingFactor(stock, min, max, "produce")`), feeding decay's "used" for production:
  `used = count × min(labourFulfillment, outputUptake)`, with disuse decay `count ← count − disuseRate ·
  max(0, count − used)`. **Resolution: split them.** The throttle adopts the operating ceiling
  `[minStock, operatingCeiling]`; `outputUptake` (and thus decay) **stays on the storage band
  `[minStock, maxStock]`**. The two answer different questions — throttle: "make more now?" (anchor-
  relative); decay's uptake: "is output genuinely stuck against the physical wall?" (storage-relative).
  Moving uptake to the operating ceiling reads a healthy producer resting *at* that ceiling as ~0 uptake →
  `used ≈ 0` → catastrophic teardown. Kept on the storage band, that producer sits well below `maxStock`
  → ~0.85+ uptake → correctly "selling"; `min(labourFulfillment, outputUptake)` then resolves to the
  **staffing** term, so decay is staffing-driven in steady state. **Bonus correctness:** because the
  throttle now prevents normal stock pile-up, the selling signal fires only on a genuine glut /
  demand-collapse (stock truly pinned at `maxStock`) — exactly when pruning capacity is right. Pruning
  *normal* over-capacity stays deferred to SP5. **Validate in the sim:** no teardown of healthy exporters;
  genuinely collapsed/unstaffed systems still decay; persisting over-capacity causes no instability.
- **Equilibrium stock roughly halves** (from ~2× anchor to ~anchor). This is why `S` is picked *last* —
  the baseline magnitudes move. Also re-check the absolute-term seams from SP1 and any test fixtures.
- **Unrest recalibration (coarse).** Well-supplied systems get calmer; confirm growth/decline still reads
  sanely, no new instability or pinning. **Coarse health bar only** — no precision tuning (perishable
  pre-SP5).
- **Logistics / diffusion** now have less slop to move and may heal less → more residual deficits (good
  for the spread, consistent with negative-space). Verify it doesn't tip viability into decline.

## Testing & validation

- **Simulator-primary.** Extend the metric (4), run long enough to equilibrate (a config with a higher
  tick count than the 500-tick quick run), and iterate `HOLD_COVER` + the satisfaction cover until:
  prices come off the floor (median moves toward base, dispersion appears), unrest stays calm (no
  striking), no floor/ceiling pinning, growth/decline sane.
- **Coarse health bar** (standing preference): no NaN / runaway / pinning, greedy ≫ random, dispersion
  present, market liquid. Stop there — defer precision.
- **DB audit** (`npm run audit:economy`) as the final real-universe cross-check on a matured DB.
- **Test suite:** the *throttle/satisfaction* change is a behavioural change, so S=1 is **no longer
  byte-identical** to the pre-change economy — update affected fixtures. The `ECONOMY_SCALE` invariance
  test stays valid (scale remains ratio-invariant *on top of* the new equilibrium).

## Sequencing within the phase

1. Add the simulator dispersion metric (4) — gives us eyes.
2. Anchor-relative production throttle (1) + reconcile infra-decay's uptake signal.
3. Anchor-relative satisfaction (2).
4. Iterate `HOLD_COVER` + satisfaction cover against the sim to the coarse health bar.
5. Pick `S` (3) on the settled economy; decide stage-vs-flip.
6. DB-audit cross-check.

## What this phase deliberately does **not** do

- **Cost of capacity / upkeep / maintenance / treasury** → SP5. **One** path to the deep, durable,
  up-the-chain spread: make over-provisioning *unprofitable* so it self-prunes. Imposing it here would
  violate emergent-realism.
- **Rebalancing the production ratios** — facility `OUTPUT_PER_UNIT` : labour-per-facility
  (`labourDemand`) : per-capita `GOOD_CONSUMPTION`. The **other** (money-free) path to a durable spread.
  These are dimensionless **ratio** levers, distinct from `S` (which scales all three together,
  ratio-invariant) and from SP5's cost-of-capacity. Tuned *differentially per tier* — advanced goods
  labour- and input-heavy, raws labour-light — they make the chain genuinely tight while raws stay
  abundant by design, with no money model. Deferred to a dedicated balance pass: it reopens the guarded
  substrate calibration and is cleaner on a fixed equilibrium, sitting naturally alongside **SP4**
  (population ← viability, where labour-per-output and per-capita-need *are* the viability levers). Ground
  changes in a physical rationale, not fudge factors.
- **Contract-model** (bounty / marketplace / discrete) → SP3.
- **Ship re-pricing / capacity** → SP4.
