# Necessity-Weighted Unrest — Not Every Empty Shelf Is a Famine

## Headline

Every good a population wants currently hits unrest with the same instrument. A system with full food
and water and empty luxuries is graded like a system in famine, because the fold that picks the unrest
accumulation rate fires on the **worst single demanded good** — one good below half-satisfaction flips
the whole system into the fast rate. In the barren-by-design galaxy nearly every system carries a
chronic higher-tier deficit, so the fast rate is the ambient state rather than the exception, and the
galaxy strikes and collapses for reasons that are not emergencies.

The change is one authored table and one bound:

- **`GOOD_NECESSITY`** — a per-good weight on how much *not having it* counts, sitting beside
  `GOOD_CONSUMPTION` as a peer table. Water and food weigh full; luxuries barely register. People still
  want the luxuries; the model just stops calling not having them suffering.
- **A per-good cap on that contribution** — the amount of unrest one good can ever add, whatever its
  demand share. Survival goods are uncapped (they *must* be able to drive collapse). Everything else is
  capped below the level that could reach a strike on its own.

Demand itself does not move. Neither does pricing, the market band, the ration threshold, logistics,
the build planner, or infrastructure decay — the whole change lives in the fold from per-good
satisfaction to system unrest.

The weights do the grading; the caps make the guarantee. A luxuries drought produces grumbling that
*adds* to tax pressure and to other goods' shortfalls — so high tax plus a broad multi-good shortage
still crosses into striking — but luxuries alone provably cannot get there, and no future calibration
pass can accidentally make them able to.

## Why the current model cannot express necessity

**Tier is wearing three hats and pretending to be three signals.**

| Signal | What it looks like | What it actually is |
| --- | --- | --- |
| `GOOD_CONSUMPTION` per-capita need | a necessity ranking | a tier gradient — its own docstring says "higher tier → lower need… only their relative shape matters" |
| `GOODS.priceFloor` / `priceCeiling` | per-good price behaviour | a pure tier lookup: **every** tier-0 good is 0.5–2.0, every tier-1 0.5–2.5, every tier-2 0.5–3.0, with zero per-good variation |
| `GOODS.volatility` | how sharply a good reacts | authored for trade flavour, read by nothing (dead field); it puts medicine at 1.5, near the top — backwards for necessity |

The consequence is concrete: **medicine's per-capita need (0.001) sits below gas's (0.004)** purely
because medicine is tier-1 and gas is tier-0. Nothing in the data says people need medicine less than
gas. Any fold that reads consumption volume as importance inherits that inversion — which is why
necessity has to be its own authored number rather than a proxy derived from an existing one.

## The government consumption boost is deleted in the same pass

`GOVERNMENT_TYPES[…].consumptionBoosts` adds a **flat, population-independent** term inside
`consumptionRate` — federation `{ medicine: 1 }`, militarist `{ weapons: 1, fuel: 1, machinery: 1 }`,
and so on. At `ECONOMY_SCALE` that term is 100 units per system regardless of whether the system holds
a thousand people or two:

| Federation system | medicine share of the demand basket |
| --- | --- |
| pop 1000 | 2.4% — plausibly what the constant was authored against |
| pop 26 | ~50% |
| pop 2 (a fresh colony seed) | **~93%** |

It is a constant authored for a typical developed system and applied at every population. Its damage is
not theoretical: the colony founding manifest sizes each line as
`FOUNDING_STOCK_ANCHOR_FRAC × TARGET_COVER × consumptionRate`, so a 2-pop federation seed asks its
founder for ~3006 medicine against ~36 food — the endowment is ~99% medicine by quantity, and founding
a colony strips the founder's entire drawable medicine reserve. Under any necessity weighting, a
colony would also read as a permanent famine from birth on a good it cannot produce.

The boost is removed outright rather than re-based per-capita. Government types keep their event
weights and danger baseline and become economically inert until the government layer is revisited;
that is an accepted, temporary loss of texture, and it buys clean economy/colonisation/logistics
readings now. Removing the term also unthreads the `governmentType` parameter from `consumptionRate`
and `capacityGoodRates` — a wide mechanical diff with no behaviour in it beyond the term's removal.
The band-reconciliation plumbing that folded the boost into `demandRate` stays correct and stays
needed; only the boost stops existing.

## Measured evidence — do not re-derive

All figures from the shipped constants, **after** the government boost is removed, which makes the
unskilled basket population-independent (no flat term, so the same shares at any population).
26 goods carry positive civilian demand; every settled system carries a market row for every good, so
the fold sees the whole basket. Unsettled systems have no market at all and are not part of any fold.

### Per-good demand share, ordinary unskilled world

| Good | Share | Good | Share | Good | Share |
| --- | --- | --- | --- | --- | --- |
| water | 17.03% | fuel | 3.65% | medicine | 2.43% |
| food | 14.60% | metals | 3.65% | radioactives | 1.95% |
| gas | 9.73% | chemicals | 3.65% | machinery | 1.95% |
| ore | 4.87% | consumer_goods | 3.65% | munitions | 1.22% |
| textiles | 4.87% | polymers | 2.92% | hull_plating | 1.22% |
| minerals | 4.87% | alloys | 2.43% | weapons | 1.22% |
| biomass | 4.87% | components | 2.43% | luxuries | 1.22% |
| | | electronics | 2.43% | targeting_arrays | 0.97% |
| | | | | weapons_systems / reactor_cores / ship_frames | 0.73% each |

Tier-0 totals 62.8%, tier-1 27.3%, tier-2 10.0%. **All tier-1+2 = 37.2%** — the barren-chronic deficit.

Basket composition still shifts with skilled heads, which is required behaviour: importance must come
from what a population actually consumes, and the engineer basket is luxuries-exclusive, so an
engineer-heavy world genuinely does want more luxuries than a mining colony. Necessity weighting is
orthogonal to that — it changes how much the *shortfall* counts, not how much is wanted.

### Why the previous fold failed, in one line

Summed demand share cannot separate the two cases: a total water failure covers 17.0% of the basket
while the ambient chronic deficit covers 37.2%, so no cut grades the acute case worse than the
ambient one. That is a **missing-weight** problem, not a structural limit of summing — eighteen goods
nobody needs badly should not outweigh the one good everybody needs absolutely. Adding the weight
fixes it (next section). The genuinely disqualified approaches are those that read necessity off an
existing signal: consumption volume (`maxWeight`, `maxContrib`) inherits the medicine-vs-gas
inversion, and anything gated on a satisfaction cliff scores water at 0.49 identically to water at
0.00 while real severity differs fourfold.

## The fold

Vocabulary: `sat_g` is per-good civilian satisfaction (delivered ÷ demanded, the flow measured at the
economy pulse); `demanded_g` is that good's civilian demand.

```
weight_g   = demanded_g × necessity_g
share_g    = weight_g / Σ weight
term_g     = min( share_g × (1 − sat_g)² , cap_g )
D          = Σ term_g
```

Three properties, none of which the current fold has:

1. **`necessity_g` is authored, not derived.** It is the one thing in the model that says a good is
   needed rather than merely bought, and every attempt to read it off tier, price band, or consumption
   volume gets it wrong (see the table above).
2. **The convex `(1 − sat)²` shape is unchanged.** A deep shortage still dominates many shallow ones;
   this pass changes *whose* shortage counts, not how severity scales.
3. **`cap_g` bounds one good's total contribution.** Omitted for survival goods (water, food) — they
   are the goods that must be able to drive a collapse. Present on everything else, sized so a single
   capped good's equilibrium unrest lands below the strike threshold with room for the tax floor.

**Regime selection** (the rate class that `accumulateUnrest` consumes) becomes a cut on `D` itself
rather than the worst-good satisfaction cliff:

- `supplied` — `D` within `RATION_EXIT_EPS` of 0
- `rationing` — below the shortage cut
- `shortage` — at or above the shortage cut

with the enter/exit hysteresis band the presentation pass calibrates, so systems parked at a boundary
do not flap chips or spam the future alert feed. `SHORTAGE_SATISFACTION` (0.5) is **not** retired — it
stays exactly where it is as the per-good *display* severity band in the needs ledger. Only the
sim-side regime selection moves off it, so no constant is orphaned.

### First-cut necessity values

Coarse first draft; the simulator owns the finals, and only the relative shape matters.

| Band | Goods | necessity |
| --- | --- | --- |
| Survival (uncapped) | water, food | 1.0 |
| Health | medicine | 0.8 |
| Daily life | gas, textiles | 0.4 |
| Broad utility | consumer_goods, fuel | 0.3–0.35 |
| Industrial staples | biomass, chemicals, electronics | 0.15 |
| Industrial inputs | ore, minerals, metals, polymers | 0.1 |
| Discretionary / military | radioactives, alloys, components, machinery, luxuries | 0.05 |
| Pure war matériel | munitions, hull_plating, weapons, weapons_systems, targeting_arrays, reactor_cores, ship_frames | 0.01–0.02 |

### What those values do to the measured scenarios

Weighted denominator ≈ 45.7 (in units of raw-basket %). Every short good at satisfaction 0:

| Scenario | D today (unweighted) | D under this fold |
| --- | --- | --- |
| Water empty alone | 0.170 | **0.373** |
| Food empty alone | 0.146 | **0.320** |
| Water + food empty | 0.316 | **0.693** |
| All tier-1+2 empty (barren-chronic) | 0.372 | **0.140** |
| Luxuries empty alone | 0.012 | **0.001** |

The ordering inverts the right way. Today the ambient deficit scores **2.2× a total water failure**;
under the weighted fold a water failure scores **2.7× the ambient deficit**. Any shortage cut in
`(0.14, 0.32]` — initial 0.25 — grades famine as Shortage and ambient scarcity as Rationing, which is
the two-sided goal a summed *unweighted* share could not reach at any cut.

### Why this fixes the striking galaxy

Unrest settles at `floor + (gain ÷ decay) × D`, and an uncrowded system declines exactly when
`unrest > 1 − D` (growth is `rate × pop × (1 − D)`, decline is `rate × pop × unrest`, at equal rates).

| | Today | Under this fold |
| --- | --- | --- |
| Ambient D | 0.372 | 0.140 |
| Regime selected | shortage (worst-good cliff) | rationing |
| Equilibrium unrest (tax floor 0.05) | 0.05 + 2×0.372 = **0.82** | 0.05 + 0.140 = **0.19** |
| vs strike threshold 0.65 | striking | calm |
| vs collapse threshold 0.75 | collapsing | far below |
| Declines when unrest > | 0.63 → **net decline** | 0.86 → **strong net growth** |

That is the observed symptom — too many systems striking, systems collapsing, expansion stalling in a
galaxy with no hard mechanics working against it — and it is arithmetic, not a tuning accident: the
ambient deficit was selecting the catastrophe rate and then being integrated at double gain.

## Interactions — the full sweep

**Reads `D`, must be re-checked:**

- **Population processor** — unrest integration and the `(1 − D)` growth term. The intended consumers.
- **The build planner's `fed()` housing gate** (`supplyDissatisfaction` ≤ `D_SETTLE`, currently 0.15).
  Ambient D drops from ~0.37 to ~0.14, so a gate cut at 0.15 stops gating almost everywhere. This is
  correct in direction — a system short only on luxuries genuinely *is* fed — but `D_SETTLE` must be
  re-cut against the measured post-change distribution rather than left at a value calibrated against
  the old one. Note the planner's fold weights by civilian **+ industrial** demand while the population
  fold weights by civilian only; the necessity weight applies to both, and the divergence is
  pre-existing and deliberate.
- **`POPULATION_PARAMS`' symmetric growth/decline rates**, whose docstring justifies the symmetry
  *in terms of* "an unavoidable D ≈ 0.4". That premise is what this pass deletes; the docstring is
  rewritten with the change, not blindly preserved.
- **Harness metrics** that fold satisfaction or D (`build-analysis`, the regime-share read).

**Explicitly untouched** — every one of these reads `demandRate`, and `demandRate` does not move:
market bands and the price anchor, the emergency ration threshold, the producer operating ceiling and
therefore the infrastructure-decay glut signal, directed logistics' deficit/surplus classification and
severity ordering, the build planner's capacity sizing, colony founding-stock sizing, and world-gen
seed stock. The one demand-side change in this pass is the deletion of the government boost, whose
blast radius is exactly the goods those governments boosted.

**Relationship to the band-reconciliation unrest ceilings.** §3 of that spec re-parameterises the
accumulation gains as `gain = ceiling × decay` so each regime carries a named equilibrium bound, and
states the ceilings must ship with the fold because "the containment guarantee is a claim about the
pair". The per-good cap here does that containment job more directly and at finer grain — it bounds
what any individual good can contribute rather than what any regime can settle at — so the ceilings
become an optional tidy-up rather than a co-requirement of this slice. They remain worth doing: they
are what stops a *combination* of capped goods from summing past the strike threshold, which the caps
alone do not bound.

**Naming.** The primitive is `necessity`, not `elasticity` — the earlier framing (necessity as a
demand curve's slope, with demand physically contracting under scarcity) is abandoned. `elasticity` is
also already taken: `DEFAULT_ELASTICITY` / `MarketCurve.k` is the price-curve exponent, with the
opposite polarity (a good whose price should react *most* sharply carries a *high* `k`).

## Sequencing

This slice comes before the arc's presentation PR (PR6). PR6's regime chips name states across the
panels, and this is what settles what those states mean — building them first would mean naming states
the simulation is about to redefine, which is exactly why presentation was split out.

Two follow-ons are booked, not built here: making per-good price response real (a per-good
`MarketCurve.k`, which delivers "water spikes under scarcity, luxuries don't" without touching demand
at all), and the government layer's revisit, which decides what — if anything — replaces the deleted
consumption boosts.

## Validation

Harness targets, on top of the existing coarse health bar:

- **Striking share collapses**, and **collapsed/stranded systems approach zero**. With no hard
  mechanics currently working against expansion, a healthy galaxy should show very few of either;
  both were the loudest signal that the shipped constants were compounding rather than correcting.
- A system supplied in its high-necessity goods and short only in low-necessity ones stays off the
  fast rate and settles below the strike threshold.
- A total water or food failure still selects Shortage and still drives decline.
- A luxuries-only shortage, at any tax level, cannot reach the strike threshold — asserted in a test
  against the caps, not merely observed in a run.
- Sustained Rationing cannot reach the 0.75 collapse threshold at any tax level.
- Colonies no longer open in the Shortage regime; founding manifests are food/water-weighted at a
  small seed, and founding a colony no longer strips the founder's medicine.
- The per-regime share of (system, good) pairs is reported in the simulate output — the permanent
  instrument for this pass and future economy work.

Expect `ECONOMY_SCALE` ratio-invariance to hold by construction (necessity is a dimensionless weight,
the cap is a dimensionless contribution bound), but re-run the invariance bridges: removing the
government boost changes S=1 output, so fixtures move.
