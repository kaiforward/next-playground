# Demand Elasticity — Necessity as a Physical Property of a Good

## Headline

Civilian demand is currently a single number per good — `demanded = perCapitaNeed × population` — that
never responds to price, scarcity or anything else. That is the **height** of a demand curve with no
**slope**, and the slope is where necessity lives: how much of the wanting survives when the good
cannot be had. Water's demand does not budge when the taps run dry; luxuries' demand simply
evaporates. The model cannot presently tell those apart, so it grades a luxury drought and a famine
with the same instrument.

The proposal is one new per-good property — **elasticity**, how readily demand gives way under
scarcity — feeding demand, unrest, pricing, rationing and logistics priority. The payoff is that
deprivation stops needing a definition:

> **Unmet demand for an elastic good is not deprivation — it is simply not buying something.**

Elastic goods cancel themselves out. Their demand shrinks to meet supply, so they cannot carry a
standing deficit, so they cannot drive unrest. Only inelastic goods can. The chronic higher-tier
scarcity that has been poisoning galaxy-wide unrest stops existing at its source instead of being
filtered out downstream by a threshold.

## Why the current model cannot express necessity

**Tier is wearing three hats and pretending to be three signals.**

| Signal | What it looks like | What it actually is |
| --- | --- | --- |
| `GOOD_CONSUMPTION` per-capita need | a necessity ranking | a tier gradient — its own docstring says "higher tier → lower need… only their relative shape matters" |
| `GOODS.priceFloor` / `priceCeiling` | per-good price behaviour | a pure tier lookup: **every** tier-0 good is 0.5–2.0, every tier-1 0.5–2.5, every tier-2 0.5–3.0, with zero per-good variation |
| `GOODS.volatility` | how sharply a good reacts | authored for trade flavour, read by nothing (dead field); it puts medicine at 1.5, near the top — backwards for necessity |

The consequence is concrete: **medicine's per-capita need (0.001) sits below gas (0.004)** purely
because medicine is tier-1 and gas is tier-0. Nothing in the data says people need medicine more than
they need gas. Any fold that reads consumption volume as importance inherits that inversion.

## Measured evidence — do not re-derive

All figures from the shipped constants. World-gen creates a market for **every system × every good**,
so the folds see the whole basket: **26 goods carry positive civilian demand**, not the six-good
civilian subset earlier drafts assumed.

### Per-good demand share, ordinary unskilled world (pop 1000, federation)

| Good | Share | Good | Share | Good | Share |
| --- | --- | --- | --- | --- | --- |
| water | 16.63% | fuel | 3.56% | radioactives | 1.90% |
| food | 14.25% | metals | 3.56% | machinery | 1.90% |
| gas | 9.50% | chemicals | 3.56% | munitions | 1.19% |
| ore | 4.75% | consumer_goods | 3.56% | hull_plating | 1.19% |
| textiles | 4.75% | polymers | 2.85% | weapons | 1.19% |
| minerals | 4.75% | alloys | 2.38% | luxuries | 1.19% |
| biomass | 4.75% | components | 2.38% | targeting_arrays | 0.95% |
| medicine | 4.75% | electronics | 2.38% | weapons_systems / reactor_cores / ship_frames | 0.71% each |

Caveat on medicine: its 4.75% includes a **flat** federation government consumption boost that does
not scale with population. Raw per-capita medicine is 0.001 → ~2.4% of the basket, and its share
falls back toward that as population grows. The medicine-vs-gas inversion is therefore wider than the
table suggests, not narrower.

Basket composition shifts with skilled heads, which is required behaviour — importance must come from
what a population actually consumes:

| | Unskilled | Mature hub (15% tech / 4% eng) | Engineer-heavy |
| --- | --- | --- | --- |
| water | 16.6% | 14.1% | 9.9% |
| food | 14.3% | 12.1% | 8.5% |
| consumer_goods | 3.6% | 9.2% | 14.9% |
| luxuries | 1.2% | 3.0% | 11.3% |
| tier-2 civilian trio | 10.7% | 20.7% | 34.7% |
| all tier-1+2 | 38.7% | 46.5% | 62.0% |

### Scenario behaviour of the candidate folds

`sum` = share of demand in goods below `SHORTAGE_SATISFACTION`; `D` = the shipped convex
`dissatisfaction()`; `maxWeight` = largest short good's demand share; `maxContrib` = largest single
term of D.

| Scenario (everything else fully stocked) | sum | D | maxWeight | maxContrib |
| --- | --- | --- | --- | --- |
| water at 0 | 16.6% | 0.166 | 16.6% | 0.166 |
| water at 0.49 | 16.6% | 0.043 | 16.6% | 0.043 |
| water at 0.51 | 0.0% | 0.040 | 0.0% | 0.040 |
| water + food at 0 | 30.9% | 0.309 | 16.6% | 0.166 |
| all tier-1+2 at 0 (import blackout) | 38.7% | 0.387 | 4.8% | 0.048 |
| all tier-1+2 at 0.3 (chronic, thin) | 38.7% | 0.190 | 4.8% | 0.023 |
| all tier-1+2 at 0.45 (chronic, mild) | 38.7% | 0.117 | 4.8% | 0.014 |
| all tier-1+2 at 0.55 (chronic, just OK) | 0.0% | 0.078 | 0.0% | 0.010 |
| luxuries at 0 | 1.2% | 0.012 | 1.2% | 0.012 |

## Rejected approaches, and exactly why

Each was considered against the two-sided goal: ambient higher-tier scarcity must stop selecting the
fast unrest rate, **and** a real food/water failure must still select it.

- **Summed demand share of short goods** (the fold the band-reconciliation spec originally locked, cut
  0.25). **Impossible at any cut**: grading a total water failure as Shortage needs `≤ 0.166`, keeping
  the barren-chronic deficit at Rationing needs `> 0.387`. Summing knows only *how much* demand is
  short, and the ambient deficit covers more of the basket than an acute one — eighteen small goods
  against one large one. Also badly non-monotonic in severity: the **fifteen least-consumed goods**
  (ship_frames through consumer_goods) total 25.18%, so full water, full food and fifteen industrial
  goods merely half-stocked grades as famine.
- **Any fold gated on `SHORTAGE_SATISFACTION`.** A good contributes its entire weight the instant it
  crosses below the line and nothing above it — a cliff, not a ramp. Water at 0.49 and water at 0.00
  score identically (16.6%) while real severity differs 4×; water at 0.51 vs 0.49 swings the fold
  0% → 16.6% while D moves 0.040 → 0.043. The 0.5 line is the defect, and elasticity removes the need
  for it entirely.
- **Largest short good's demand share** (`maxWeight`, cut ~0.10). Fixes *which* goods count but keeps
  the same cliff — see the water rows above. A proxy for necessity via consumption volume, and it
  inherits the medicine-vs-gas inversion.
- **Threshold on D itself.** Same inversion as summed share: ambient chronic D ≈ 0.4 exceeds a
  water-only failure's 0.166, because D is a breadth measure.
- **Largest single term of D** (`maxContrib`, cut ~0.10). The best of the stopgaps — continuous, no
  cliff, separates every scenario above correctly. Still reads necessity as consumption volume, so
  gas would outrank medicine. **Viable fallback if elasticity is judged too large**, not the intended
  answer.
- **A per-good "vital goods" list.** Rejected on principle: a magic list, and it cannot express the
  same good mattering differently to different populations (engineer luxuries vs mining-colony
  luxuries).

## The primitive

Necessity is **inelasticity**: how much demand refuses to go away when the good is unavailable.

- Water — perfectly inelastic. Unavailable means unmet need; there is no substitution.
- Medicine — inelastic despite tiny volume. You need what you need.
- Luxuries — highly elastic. Unavailable means people stop wanting them.

The regime fold then measures **unmet inelastic demand** and nothing else. No vital list, no
satisfaction cliff, no `SHORTAGE_DEMAND_SHARE`, and no separate rule for "which goods count".

### Why this is a primitive and not a magic list in disguise

It stays a hand-authored per-good number, exactly like `basePrice` and `perCapitaNeed`. What
distinguishes it:

1. It is **continuous**, not a boolean "vital" flag.
2. It has **several independent consumers**, so it is calibrated against multiple observable
   behaviours rather than tuned until one fold comes out right:
   - **Unrest / D** — deprivation becomes unmet inelastic demand.
   - **Pricing** — inelastic goods should spike hard under scarcity, elastic ones should not. Today
     water and ore have byte-identical price behaviour because both are tier-0; this replaces a tier
     gradient with a real driver.
   - **Rationing** (`consumptionFactor`) — currently rations every good identically. A household drops
     luxuries long before it drops water.
   - **Logistics priority** — what ships first when not everything can.
   - Plausibly absorbs or retires the dead `volatility` field.
3. It expresses a physical/economic property rather than an authorial verdict about which goods matter.

**This is the claim to pressure-test before building.** If the multi-consumer defence does not hold —
if in practice only the unrest fold reads it — then it *is* a vital list with extra steps and the
`maxContrib` fallback is the better answer.

## Open questions

- Where does the elasticity number come from? Authored per good is the honest default; deriving it
  from tier reproduces the exact bug this doc exists to fix.
- Does elastic demand **shrink** (the good is dropped from the basket under scarcity) or is it merely
  **discounted** when measuring deprivation? Shrinking is more physical and feeds pricing correctly;
  discounting is a far smaller change. Shrinking changes `demandRate`, which is the days-of-supply
  pricing denominator — that interaction needs mapping before either is chosen.
- Interaction with the skilled baskets: an engineer's luxuries should presumably be *less* elastic
  than an unskilled worker's, which the basket structure can express without a new field.
- Does this subsume `SHORTAGE_SATISFACTION` entirely, or does the Rationing/Supplied boundary still
  need it?

## Sequencing

This is a foundational change to demand feeding pricing and rationing, so it is not a slice of the
band-reconciliation containment work. The intended order is: finish band-reconciliation PR5
Tasks 2–6 (collapse ramp, housing occupancy floor, colony housing sizing, planner unblocking, colony
founding stock — none of which touch the fold), then take elasticity as its own slice, after which the
rate regime and the unrest ceilings fall out of it cheaply.

PR5 therefore ships without its largest unrest lever, and its simulator read should be expected to
show collapse and colony recovery but little movement in mean unrest or striking share.
