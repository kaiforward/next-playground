# S3 — Development-Tiered Civilian Demand (Demand Concentration)

> **Status:** Designed 2026-07-02 (brainstorm). Stage 3 of the economy-specialisation track —
> see [economy-specialisation.md](./economy-specialisation.md) for the umbrella (S1 ✅, S2 ✅,
> **S3 this spec**, S4 guardrails). Agency-free; works entirely through the existing labour
> readout and physical-economy tick.

## Headline

Civilian consumption today is flat — `GOOD_CONSUMPTION[g] × population`, identical basket
everywhere. S3 makes a population's **development** shift its basket up the tiers: systems where
a large share of the workforce performs technician/engineer-grade work additionally demand
consumer goods, medicine, electronics, and luxuries. Frontier extraction worlds keep the basic
basket.

This creates demand gradients **independent of supply**: the tech hub that specialised into
tier-2 via academies + an anchor complex (S1/S2) is *also* the galaxy's big discretionary
importer — and its space and labour are already committed, so it can't broadly self-supply.
Demand concentrates exactly where supply can't. Victoria-style stratified demand, without
stratified pops.

## Core formula

Consumption becomes a three-term additive sum per good:

```
consumption_g = GOOD_CONSUMPTION[g]   × population     // unskilled baseline — unchanged
              + SKILL1_CONSUMPTION[g] × technicians    // technician basket
              + SKILL2_CONSUMPTION[g] × engineers      // engineer basket
```

- **Additive ladder** — basics are never reduced; development only adds demand on top.
- `technicians` / `engineers` come from the existing `computeLabourAllocation`
  (`lib/engine/industry.ts`): skilled work **actually performed** — bounded by jobs, academy
  licence, and headcount. Not merely licensed: an academy town whose factories died sheds its
  discretionary demand with its industry. The unemployed consume base only.
- The signal derives from buildings + population (slow-moving, build/decay cadence) — never
  from consumption, satisfaction, or unrest. **No feedback circularity.**

### Why jobs, not people (the licensing semantics — and the pop-upgrade seam)

Skill remains a licensing ceiling (vision §4: population is one scalar), so "engineers" here are
*jobs performed*, not a persistent stratum. Consequence: a hub's discretionary demand vanishes
with its industry rather than persisting through a bust. That persistence (unemployed engineers
still wanting luxuries — the Victoria misery spiral) only becomes interesting once shocks exist
(events/war layer).

**Distinct pop types are a deliberate later upgrade with a clean seam:** because demand is
defined as *per-grade baskets*, a demographic pop model later swaps only the multiplier source
(stratum headcount instead of licensed jobs). The basket constants, additive formula,
satisfaction weighting, and price effects all survive unchanged. Recorded so the upgrade isn't
re-litigated: build licensing-based now, demographic pops remain a separate future track.

## The baskets

Sparse per-good tables in `lib/constants/physical-economy.ts`, run through `scaleRecord` exactly
like `GOOD_CONSUMPTION`. Each basket spreads over 3–4 goods so no single good carries the
gradient; the *tier centre of gravity* shifts upward per grade:

| Good | Technician (skill-1) | Engineer (skill-2) | Notes |
|---|---|---|---|
| consumer_goods | **dominant** | moderate | the shared mid-tier mass good |
| medicine | moderate | small | healthcare scales with development |
| textiles | small | — | tier-0 arable-gated → raw import pull at hubs |
| electronics | small | moderate | civilian electronics; see S2 anchor interaction |
| luxuries | — | **dominant** | engineer-exclusive: the scarce top-of-ladder signal |

Everything else stays flat, deliberately: food/water are biological, not wealth-scaled (one
food good — rich pops eat differently, not more); industrial goods' civilian base need is
already a household-infrastructure proxy; the military chain doesn't scale with wealth.

### Magnitudes — sizing rule, not final numbers

Skilled heads are a small population share (~10–20% technicians, low-single-digit % engineers
at a mature hub), so per-head basket values must be **large multiples of the per-capita base**
for the hub-level effect to be visible. Sizing rule: at a mature hub, total discretionary
demand on basket goods ≈ **2–3× that system's base demand** for those goods. First-cut
constants are derived from that rule; finals land in the S4 joint calibration pass
(coarse-health-calibration principle — the structure is the commitment, the numbers are
perishable).

## Threading (the five call sites)

1. **`consumptionRate()`** (`lib/engine/physical-economy.ts`) — the chokepoint. Signature grows
   from `(goodId, population)` to a demand basis `{ population, technicians, engineers }`.
2. **Tick adapters** (`lib/tick/adapters/prisma/economy.ts` + `memory/economy.ts`) — compute
   `computeLabourAllocation` once per system, pass the basis. Live and sim stay identical.
3. **`capacityGoodRates`** (`lib/engine/industry.ts` readout) — already has buildings +
   population; same allocation, same formula.
4. **Pricing + satisfaction** — the `demandRate` civilian term (`lib/constants/market-economy.ts`)
   and the population-satisfaction `demanded` weights both consume the consumption rate and
   inherit automatically. Verify no site re-derives `perCapitaNeed × population` inline.
5. **Seed** — seed-time demand floors use the same formula. Academies are already seeded to
   skill demand (S1), so the allocation is well-defined at tick 0.

## Emergent consequences (intended — verify in sim, don't pre-tune)

- **Ladder of needs / fragile rich worlds.** Satisfaction is demand-weighted, so developed
  worlds weight luxuries/consumer-goods shortages heavily → unrest → strikes at the hub.
  Frontier worlds are hardy. Premium routes for the future trade layer (luxuries to the core)
  instead of only bulk food runs.
- **Electronics × S2 anchors.** S2's headline gap: electronics never clears
  `ANCHOR_MIN_THROUGHPUT`, so it never anchors. Civilian electronics demand concentrates where
  skilled work concentrates → raises electronics throughput at developed systems → may help
  electronics anchors fire. Measure in the structural run; feeds the S4 anchor-threshold lever.
- **Textiles import pull.** Tier-0 arable gate means hubs can't self-supply the technician
  textiles line — deposit geography doing demand-side work.
- **Named check — hub self-supply.** A tech hub *has* the academies to build its own
  luxuries/electronics industry; whether it imports or self-supplies depends on S1/S2
  space+labour scarcity actually binding. Measure in an S2-style A/B sim (does discretionary
  demand at hubs resolve via imports or local build?); if hubs self-supply, that's an S4
  pacing/space finding, not a reason to add S3 mechanics.

## Out of scope

- **Distinct pop types / demographic skill** — deferred with the seam recorded above.
- **Unrest-driven demand** — circular with the satisfaction spine (demand weights feed
  dissatisfaction feed unrest) and fast-moving where S3 wants durable gradients. The events
  layer can revisit (e.g. munitions demand under unrest). "Consumption is never suppressed —
  people still eat" stays.
- **UI** — numbers flow through existing readouts (Labour card already shows
  technicians/engineers); demand legibility belongs to the economy-UI interstitial pass.

## Sim validation (structural, S2-style)

Single-seed A/B vs pre-S3 baseline at 4000/8000 ticks: mature price spread (p90,
expensive-fraction) should widen or hold vs S2; discretionary goods' price dispersion should
correlate with skilled-work concentration; coarse health bar holds (no NaN/runaway/pinning,
greedy ≫ random). Record findings as calibration inputs for S4 — do not tune S3 constants in
isolation.
