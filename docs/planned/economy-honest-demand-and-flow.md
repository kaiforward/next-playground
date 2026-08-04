# Honest demand and flow

**Status: planned, awaiting `/spec-review`.** Three staged changes agreed 2026-08-03/04 from the
pricing-vs-logistics measurement program (direction, all five measurements and Kai's dated inputs:
[pricing-vs-logistics.md](../build-plans/pricing-vs-logistics.md)). Implemented **in order, with a
simulate A/B isolating each stage** — all three touch the same matcher surface, which is why they
share one spec and one review.

## Headline

Three fixes to how goods move, in plain terms:

1. **Demand honesty.** Today a factory's input appetite is counted at what its buildings *could*
   consume at full tilt, even when the factory is stopped by its own full warehouse or a strike.
   The logistics network believes that fiction — measured: 1 in 7 industrial-demand readings
   overstates real draw by 2× or more — and prices every warehouse threshold with it. After this
   change, industrial input demand is counted at what the factory **would actually pull if the
   input were on the shelf**. Civilian want always counts at full rate — a starving town must never
   read as a low-demand town.

2. **Every willing donor serves a deficit, not just the nearest.** The matcher today gives each
   deficit exactly one donor per logistics cycle; measured, that single-donor cap owns 42% of all
   unmet deficit tonnage at equilibrium while stock sits reachable and drawable. After this change
   a deficit draws from its reachable donors in cost order until it is filled, the donors are
   drained to their reserves, or the work budget runs out.

3. **The production brake stops reading the price chart.** A producer today idles when its stock
   passes a multiple of the *price anchor* — a figure floored by a pricing divide-by-zero guard,
   unrelated to warehousing. Measured: a third of all throttling lands on live exporters facing
   real unmet demand. After this change a producer idles against its **warehouse**: the larger of
   "cycles of what this system actually uses" and "cycles of what it makes" (a working inventory —
   while shipments collect output the yard stays low and production runs; when nothing draws, the
   yard fills and the world idles). Price then re-enters only in the later goods-pricing pass, as a
   signal layered on machinery that works without it.

Nothing here monetises or shrinks the haul budget: measured, it never binds (0 funding-bound
events in 10,000 evaluations, 6–8% spent), and Kai's direction is to prove these mechanics against
an ample budget before limiting it (row 10's territory).

## Stage 1 — demand honesty

**The honest figure.** For good `g` at a system, honest industrial input demand is

```
honestInput(g) = Σ over consumer goods c with g in recipe(c):
                   wouldDraw(c) × perOutput(c,g) × INPUT_DEMAND_MULTIPLIER
wouldDraw(c)   = buildingProduction(c)            // capacity × staffing gates × yield × family buff
                 × strikeSuppress(c)              // strike + maintenance malus, as the tick applies it
                 × brakeCeiling(c)                // the consumer's own output brake (stage 3's knee;
                                                  //   the anchor-based ceiling until stage 3 lands)
```

with **no input gates anywhere** — this is "what would this factory pull if its inputs were
abundant" (Kai's stated definition: gated by staffing, strike, and its own output brake — nothing
else). Excluding all input gates, not just `g`'s own, kills input↔input circularity outright: two
mutually-scarce inputs cannot talk each other's demand down. The accepted cost is that a factory
permanently missing input A still claims full appetite for input B; the claim is bounded by the
warehouse target and A's own deficit ranks beside it, so the planner sees both.

The measured bounds bracket this figure: nominal (capacity-based, today's) overstates it; the
realized-based bound understates it exactly where the measured input itself binds — the rationing
death-spiral this definition avoids (a scarce input must not deflate its own demand signal).

**Evaluation order.** `brakeCeiling(c)` (stage 3) depends on c's own honest use, which depends on
*c's* consumers' ceilings. The recipe graph is a DAG, so this resolves in one reverse-topological
pass (`PRODUCTION_GOOD_ORDER` reversed): goods with no industrial consumers first (their use is
civilian-only), then down the chain. Until stage 3 lands, `brakeCeiling` is today's
`productionCeiling(stock, targetStock, HOLD_COVER)` and no ordering subtlety exists.

**Total honest demand** `honestDemand(g) = civilian(g) + honestInput(g)` — civilian always at the
full basis rate, never satisfaction- or event-deflated.

**Who inherits it** (this replaces the capacity-based figure in `GoodMarketState.demand` and
everything derived from it; produced today at `lib/tick/processors/good-market-state.ts:35`):

- the matcher's deficit shortfall + severity (`shortfall × demand`), via `logisticsTarget`
- the donor floor (`donorReserve`) and the deficit line, both `× anchorMult` as today
- the self-supply gate and exporter test (`production` vs `demand`) — honest demand shrinks, so
  some markets flip toward self-supplier/exporter classification; intended
- the exporter's own reserve (`EXPORT_RESERVE_COVER × demand`) — a smaller honest demand means a
  smaller withheld reserve, more drawable stock; intended
- the build planner's rate-deficit test and capacity sizing, including the queued-output term
  (`lib/engine/directed-build.ts:263`)
- the trade-flow read service (`lib/services/trade-flow.ts:85`) — display inherits

**What deliberately does NOT change in stage 1:**

- The persisted pricing `demandRate` (`totalDemandRateForGood`,
  `lib/constants/market-economy.ts:70-74`: capacity-based + `MIN_DEMAND` floor). It anchors price
  (`targetStock`) and the ration knee (`RATION_COVER × demandRate`); both belong to the deferred
  goods-pricing pass. Changing the ration knee here would move *starvation* behaviour under a
  logistics fix — two experiments in one stage.
- The founding manifest (raw civilian rate — already honest, #213).
- Event treatment: demand figures never carried event production/consumption multipliers at the
  logistics read; `anchorMult` remains the one event channel riding the thresholds.

**Data shape.** A new persisted per-market field `honestDemandRate`, written by the population
processor beside its existing `demandRate` rewrite (same cadence, same staleness class — one cycle,
the precedent `demandRate` already sets), read by `toGoodMarketStates` and (stage 3) the economy
adapter. Computed by one pure engine function so the logistics read, the planner and the brake
cannot diverge. Save-shape bump; pre-1.0 saves break by policy.

## Stage 2 — multi-donor matching

In `matchFactionTransfers` (`lib/engine/directed-logistics.ts:197`), the per-deficit body changes
from "pick the single nearest reachable donor" to:

> Collect the reachable donors of the good with drawable stock and a valid route; sort by per-unit
> route cost ascending (tie: stable system order, as today); draw
> `min(remaining shortfall, donor's drawable, budget/perUnit)` from each in turn until the
> shortfall is met, donors are exhausted, or the budget is spent. One transfer row per
> donor→deficit draw. `fundingBound` is recorded exactly as today: the budget capped a draw that a
> donor could have filled.

Unchanged: severity-first triage across deficits, donor reserves as hard floors, fill-to-target
semantics (no overshoot), budget accounting (`work = quantity × route cost`), the dead-band. This
is a flow-efficiency fix inside existing constraints, per Kai's direction that the AI never
withholds where capacity exists.

Expected, to be confirmed by the stage A/B: single-source residual share → ~0 (from 42%); donors
rest at their reserves more of the time; transfer-row count per cycle rises (flow log volume, map
overlay density — a UI observation, not a gameplay change); budget spend rises from ~6–8% but
nowhere near binding (measured headroom ~12–16×); logistics treasury bills rise in proportion to
work actually done.

## Stage 3 — the brake leaves the price anchor

`productionCeiling` keeps its shape (full rate below a knee, linear ramp to zero) but the knee
stops being `targetStock` (the price anchor). Per producing market:

```
knee    = max( BRAKE_USE_COVER × honestDemandRate × anchorMult,   // cycles of what this system uses
               BRAKE_OUTPUT_COVER × capacityProduction )          // cycles of what it makes
knee    = min( knee, maxStock / BRAKE_RAMP )                      // storage guard, see below
ceiling = full rate while stock ≤ knee, ramping linearly to 0 at BRAKE_RAMP × knee
```

- **`BRAKE_USE_COVER = 40`** (cycles of honest use) and **`BRAKE_RAMP = 1.3`** preserve today's
  geometry exactly on markets where honest use equals the old floored `demandRate` — the change is
  confined to the fiction cohort (knee drops → campers idle *and donate* sooner) and to exporters.
- **`BRAKE_OUTPUT_COVER = 8`** (cycles of own capacity output) is the working-inventory term and
  the answer to the pure-exporter trap: a market with ~zero local use gets a finite knee from its
  own output instead of a `MIN_DEMAND`-floored price figure. 8 ≈ several logistics cycles of yard
  buffer; a first-cut value, tuned only by the stage A/B. **Capacity** production, not realized —
  realized already contains the ceiling, and a self-referential denominator can latch shut.
- **Storage guard:** the knee is capped so the ramp completes below `maxStock` — the brake must
  idle a producer before the storage clamp starts silently discarding output into a full
  warehouse.
- **`anchorMult` rides the use term only** — events keep their lever on warehousing thresholds
  (coherent with `logisticsTarget`/`donorReserve`); the output term is own-production physics with
  no business following a price-anchor event.
- The knee is computed in **one shared function** used by all three of today's `productionCeiling`
  call sites — the tick (`lib/engine/supply-chain.ts:122`), the decay/selling signal
  (`lib/tick/processors/economy.ts:205`), and the Industry-panel readout
  (`lib/engine/industry.ts:707`) — so the tick, decay and the UI cannot disagree about why a
  producer is idle.

**Known consequences, owned by this stage's A/B:**

- *Exporters run.* An exporter's knee moves from `1.3 × 40 × (tiny floored local demand)` to
  `8 × its own output` — the live-governor release the brake-cohort measurement demands its own
  A/B for. Expected: exporter throttle share (31.9% of throttled checks at equilibrium) falls
  hard; thin-reachable-stock residual (56.8% of U_inf) falls; consumer cover rises at 12k+.
- *Prices move.* Today's brake is doing price work — `HOLD_COVER`'s own docstring calibrates it as
  the lever that rests equilibrium stock "just above the anchor (price near base)". Decoupling the
  brake from the anchor lets stock rest elsewhere relative to the price curve, so price medians and
  dispersion shift. Accepted by explicit direction (the pricing pass owns price; nothing here may
  lean on it) — but the A/B still gates on the coarse health bar: no floor/ceiling pinning
  epidemics, no runaway.
- *Decay re-reads "selling".* The selling factor that feeds infrastructure decay's
  staffed-and-selling term (`lib/tick/processors/infrastructure-decay.ts:42`) becomes
  warehouse-based. A braked-idle producer still decays as idle — that is the mechanism working —
  but *which* producers idle changes with the knee. Watched in the A/B via building counts and
  idle-reason mix.

**The dead-band, restated in one unit family** (the chosen conservatism stays): brake ceiling
`BRAKE_RAMP × BRAKE_USE_COVER × use` = 52 cycles vs donation line
`SURPLUS_MARGIN × DONOR_RESERVE_COVER × demand` = 56 cycles — both now cycles of the same honest
demand. The `band-constants.test.ts` invariant ("keeps the production brake's ceiling at or below
the donation line", today comparing anchor units to demand units at
`lib/constants/__tests__/band-constants.test.ts:63-72`) is rewritten as
`BRAKE_RAMP × BRAKE_USE_COVER ≤ SURPLUS_MARGIN × DONOR_RESERVE_COVER`. On the output side no such
invariant is needed: an output-denominated knee above the donation line just means a fast producer
holds working inventory it is simultaneously willing to donate — there is no lock, because
`surplusDrawable` never reads the knee.

`TARGET_COVER` loses its "one deliberate physical rider" (its docstring's own words) and becomes
purely a pricing constant; its docstring and `HOLD_COVER`'s are rewritten accordingly, and
`HOLD_COVER` itself is deleted in favour of the three new constants.

## Staging and the A/B gates

Ship order **1 → 2 → 3**, each stage merged only after its own A/B against the previous stage's
head, both horizons, seed 42, 600 systems, scale 100. The brake A/B is read at **12,000+ ticks or
as a trajectory** — the 10k label sits inside the startup transient for high-tier consumer cover
(the horizon artifact documented at `lib/engine/directed-logistics.ts` `surplusDrawable` docstring).
The matcher ships before the brake deliberately: brake-released stock must land on a matcher that
can distribute it, or the brake A/B under-reads its own effect.

| Stage | Primary metrics | Expected direction |
|---|---|---|
| 1 demand honesty | camping cohort (dwell instrument anchors), per-market threshold sizes, planner build mix | campers unlock; aggregate flows near-unchanged (fiction is concentrated: ×1.18 galaxy) |
| 2 multi-donor | single-source residual share, service rate by severity + pop quartile, budget spend %, U_real | single-source → ~0; service up broadly; budget spend up, far from binding |
| 3 brake | exporter throttle share, thin-stock residual, consumer cover (12k+), price health bar, building/idle mix | exporter throttling falls; cover rises; prices move but no pinning/runaway |

Cross-stage regression on every A/B: the coarse health bar (no NaN/runaway/pinning, dispersion,
liquidity), unrest/population aggregates cohorted, and the interval-invariance gate
(`cadence-invariance` pair) which stage 2 touches via per-cycle transfer volume.

## What this spec deliberately leaves alone

- Pricing: `demandRate`, `targetStock`, `MIN_DEMAND`, the price curve — the goods-pricing revisit.
- The haul budget: free and effectively unbounded, by direction, until row 10 prices it.
- The dead-band between brake and donation line: chosen conservatism, restated not resized.
- Sink ordering (severity = shortfall × demand): Kai's flow-priority design space, noted in the
  build plan's inputs, untouched here.
- Hub/chain logistics depth (propagated demand, per-route capacity): later pass;
  `docs/planned/negative-space-economy.md`'s "make the base efficient — NOT OK" bullet is
  reconciled *there* — this spec's stance, per Kai 2026-08-04: the negative space emerges from real
  constraints (budget, infrastructure, scarcity), never from designed algorithmic inefficiency.

---

## Design-hazards worksheet

### 1. One quantity, several unrelated jobs

`npm run impact` outputs, 2026-08-04 (boilerplate trimmed, reader lists verbatim):

```
IMPACT: demandRate — SHARED, 35 references across 15 modules + 2 tick processors (economy 3/9,
directed logistics 6/9; population 4/9 writes it undeclared)
  market-pricing 8× (:43,:63,:76,:80,:100,:105,:118,:125 — targetStock = TARGET_COVER × demandRate × anchorMult)
  tick 5× (:31,:109 ration knee,:137,:165,:274)   market-economy 3× (:98,:102,:107)
  market-tick-builder 3×   supply-chain 2× (:97,:142 ration knee)   adapters/economy 2× (:91,:143)
  adapters/population 1× (:69 the rewrite: totalDemandRateForGood)   directed-logistics-world :19
  economy-world :37   markets :43   world/types :230
  outside tick: market-entry 4×, dev-tools :201, market :26, universe :190
  harness: cohort-analysis 5× (:48 classifyMarketRole reads demandRate vs MIN_DEMAND)
```

```
IMPACT: productionCeiling — SHARED, 8 references across 4 modules
  tick :77 (def), :104 (flat tick)   supply-chain :122 (the live coupled tick)
  economy :205 (selling-factor signal → decay)   industry :707 (readout selling factor → UI)
IMPACT: HOLD_COVER — SHARED, 3 modules: economy (:36 def), industry (:707), tick (world/tick.ts:777 simParams)
```

```
IMPACT: inputDemandFromProduction — SHARED, 7 references across 4 modules
  industry :532 (def)   good-market-state :35 (the matcher/planner demand figure)
  directed-build :263 (queued-output term)   services/trade-flow :85 (outside tick)
IMPACT: inputDemandForGood — CONTAINED, 2 modules: industry :513 (def), market-economy :72
  (inside totalDemandRateForGood — the PRICING figure)
IMPACT: sellingFactorBySystem — SHARED, 3 modules: economy (:194-:234 producer),
  infrastructure-decay :42 (consumer), tick/types :63
IMPACT: matchFactionTransfers — CONTAINED, 1 module: directed-logistics (+30 test references)
```

| Quantity | Readers today | Which this design moves | Intended? |
|---|---|---|---|
| `demandRate` (persisted) | 15 modules above: pricing anchor, ration knee, tick entries, harness role split | **none** — stage 1 deliberately does not touch it | Yes — the pricing/ration jobs stay coupled to each other and separated from logistics, completing the #211/#212/#213 separation |
| `GoodMarketState.demand` (+`logisticsTarget`, `donorReserve`, exporter reserve) | matcher (deficit/severity/self-supply/donor/exporter), planner (deficit test, sizing, queued term), trade-flow service | **all of them, together** — the honest figure replaces the capacity figure at the single producer (`good-market-state.ts:35` → the new shared engine function) | Yes — one figure, one producer, every logistics/planner reader inherits at once; that unity is the point |
| `productionCeiling` knee | supply-chain :122 (tick), economy :205 (decay signal), industry :707 (UI) | all three, re-pointed at the shared knee function | Yes — tick, decay and UI must agree about idleness; three call sites, one knee |
| `HOLD_COVER` | economy/industry/tick above | deleted; replaced by `BRAKE_USE_COVER`/`BRAKE_RAMP`/`BRAKE_OUTPUT_COVER` | Yes — the constant's pricing-calibration meaning dies with the anchor coupling |
| `TARGET_COVER` | pricing curve + band (via `demandRate` readers) | loses the brake rider; no numeric change | Yes — becomes purely pricing, per its own docstring's rider note |

### 2. A constant read for a meaning it was not authored to have

| Constant | Docstring says | This design uses it as | Same thing? |
|---|---|---|---|
| `TARGET_COVER` | "A PRICING constant, plus one deliberate physical rider: productionCeiling's throttle knee runs off the anchor this defines" (`lib/constants/economy.ts:14-19`) | pricing only; the rider is removed | Yes — the design *restores* authored intent; the rider was the exception the docstring itself flags |
| `HOLD_COVER` | "Calibrated against the simulator's coarse health bar: 1.3 lifts the galaxy-wide price median to ~1.08x base" (`economy.ts:26-35`) | deleted — its calibration is price work this design decouples | The docstring is the evidence the brake does price work; consequence owned in stage 3's A/B |
| `MIN_DEMAND` | "Floor on the cycles-of-supply denominator so a near-empty system yields a finite cover instead of a divide-by-zero" (`market-economy.ts:26-28`) | left in pricing, kept out of every new denominator | Yes — the guard guards pricing; stage 3 removes its last physical reader (via the anchor) |
| `WAREHOUSE_COVER`/`DONOR_RESERVE_COVER` | cycles of REAL demand, ride `anchorMult` (`directed-logistics.ts:24-70`) | same roles, denominator upgraded capacity→honest | Yes — same authored meaning, more truthful denominator |
| `EXPORT_RESERVE_COVER` | "cycles of its own demand a structural exporter keeps… immune to anchor_shift" (`directed-logistics.ts:12-23`) | unchanged rule; `demand` becomes honest | Yes; reserve shrinks where demand was fictional — intended |
| `INPUT_DEMAND_MULTIPLIER` | (industry constants) scales desired input draw per output | kept in the honest figure exactly as in the nominal one | Yes — untouched scalar |

### 3. A system you did not think about

| System | Interaction | Reason if none |
|---|---|---|
| Events | `anchorMult` keeps riding `logisticsTarget`/`donorReserve` and the new use-term knee; the output term deliberately ignores it. Event production/consumption mults never reached the logistics demand figure and still don't. `anchor_shift` events therefore keep a (smaller) brake lever. | — |
| Population + migration | Civilian want stays full-rate, so satisfaction/unrest inputs are untouched by stage 1. Better flow (stages 2-3) raises satisfaction → growth/migration shifts; watched in every A/B's cohorted population aggregates. | — |
| Unrest / regime | No formula touched. Ration knee unchanged (kept on pricing `demandRate` by explicit scope). Strike suppression feeds the honest figure (a struck factory claims no input demand) — one-directional, no loop: unrest → strike → demand signal, never back within a cycle. | — |
| Industry + staffing | Staffing gates are *inside* the honest figure via `buildingProduction`. Unstaffable capacity no longer generates input demand — the planner stops seeing phantom input deficits next to idle factories. | — |
| Infrastructure decay | The selling factor decay reads (`infrastructure-decay.ts:42`) becomes warehouse-based in stage 3 — which producers read idle changes. Owned by stage 3's A/B (building counts, idle-reason mix). | — |
| Directed logistics | The subject of the spec. | — |
| Directed build / planner | Inherits honest demand everywhere it reads `GoodMarketState.demand` incl. the queued-output term (`directed-build.ts:263`); proposes less capacity against fictional demand. Complex/academy co-builds inherit via the same deficit tests. | — |
| Colonisation + founding manifest | Manifest already reads the raw civilian rate (#213) — no change. Colonisation ROI reads unmet demand via planner figures → inherits honesty; fewer phantom-deficit colonies scored up; intended, small. | — |
| Treasury / purse | Logistics band bills `workPerformedByFaction` = actual haul work; stage 2 raises it (more transfers). Funding still scales the budget; budget still never binds (measured 6–8% spent, 12–16× headroom). No formula change. | — |
| Factions + relations | Relations drift reads recent trade volume from flow rows; stage 2 raises row counts → mildly warmer intra-faction… no: flows are same-faction only and drift reads *cross-faction* trade. Verify at review: if drift counts only cross-faction flows, no interaction — logistics is faction-internal by construction. | Flagged for the review to confirm the reader, not assumed |
| Save format (`World` shape) | One new persisted market field `honestDemandRate` (population-processor written). Pre-1.0 saves break by policy; serialization stays JSON-safe (finite guard at the writer, as `realizedProductionRate` does at `economy.ts:181-183`). | — |
| Harness metrics | `classifyMarketRole` (cohort-analysis :48) reads floored `demandRate` — unchanged, so cohort splits stay comparable across the A/Bs. The surplus metric reads the donor line → moves with honest demand; noted so A/B readers don't misread the metric shift as a flow regression. | — |

### 4. Claims about current behaviour

All from the pricing-vs-logistics measurement program — falsifiers pre-committed (`f63aed6e`,
`df4640ae`, `05ed9768`, `c71c2589`), raw output in the build plan.

| Claim | Evidence | Horizon | Cohort |
|---|---|---|---|
| Industrial demand overstates real draw: ratio ≤ 0.5 in 14.8% of industrial checks; galaxy ×1.18 | fiction measurement, CONFIRMED via share bar | both; stationary late | industrial-demand checks = 42.5% of developed-market checks; 600 sys, seed 42, scale 100 |
| Realized exceeds nominal in 22.5% of checks (honest figure must handle both directions) | same run, Licenses line | equilibrium | same |
| The brake throttles live exporters: 31.9% of throttled checks exporter-path; ramp is the operative regime (95%) | brake-cohort measurement, claim FALSIFIED | both; composition stationary, level rising | all developed markets, same conditions |
| 71.8% of throttled exporters face reachable same-faction deficits | sated-exporter measurement, FALSIFIED | both; stationary | exporter-path checks above anchor |
| The haul budget owns 0% of persisting deficits; single-donor structure owns 42.0%, thin reachable stock 56.8%, unreachable ~1% | deficit-attribution measurement, FALSIFIED (budget claim) | both; budget reading stationary; structural mix still shifting (ss 29.5%→42.0%) | all matcher deficits, 2,820,188 checks |
| Dead-zone camping is the fiction's tail: campers drain at 0.27× nominal, concentrated in industrial inputs | dwell measurement, confirmed narrowly via ongoing-camp channel | both | all developed markets; camper cohort = industrial-input goods |
| The brake's knee today = `HOLD_COVER × targetStock` (anchor units) | `supply-chain.ts:122`, `economy.ts:205`, `industry.ts:707` | — | code fact |
| Hypothesis, labelled as such: `BRAKE_OUTPUT_COVER = 8` is a workable yard buffer | none — first-cut constant, tuned only by stage 3's A/B | — | — |

### 5. Signals, thresholds, primitives consumed

| Consumes | Produced at | Shape today | Design assumes |
|---|---|---|---|
| `GoodMarketState.demand` etc. | `good-market-state.ts:27-58` | civ (`capacityGoodRates`) + industrial (`inputDemandFromProduction` at capacity); real, unfloored | exists; redefined at this single producer |
| `capacityProduction` | `good-market-state.ts:49` | staffing-gated capacity rate, per market | output-term denominator (stage 3) — already carried |
| `realizedProductionRate` | `economy.ts:170-183`, persisted | realized/catchUp, finite-guarded, ≥ 0 | NOT used as a denominator (self-referential); stays the matcher's `production` figure |
| `productionSuppressed` | `economy.ts:129-130,184` | per-market bool: system suppress < 1 ∧ produces the good | strike input to `wouldDraw` — carried, per-market as required |
| strike multiplier | `economy.ts:116-122` (`strikeMultiplier × maintenanceMalus`) | scalar per system ∈ (0,1] | the honest figure needs the *scalar*, not just the bool — the pure function takes it as an input; the population-processor writer has it available same-tick via signals or recompute from persisted unrest (review confirms which) |
| `anchorMult` | persisted, event-derived (events processor, run 2nd) | ≥ 0 multiplier, default 1 | rides use-side thresholds; read inside the tick (measurement-traps: never read it pre-tick) |
| `maxStock` | `marketBand` (`market-pricing.ts:60-67`) | anchor-derived + storage | storage guard's cap input |
| `PRODUCTION_GOOD_ORDER` | `constants/recipes.ts` | recipe-topological good order | reversed for the honest-demand pass; DAG guaranteed by recipe authoring |
| budget/funding (`fundingByFaction`) | treasury settlement → processor params | latched 0-1 per faction | untouched; stage 2 spends more of the same budget |

### 6. Aggregates that move for other reasons

| Metric | Read at | What else moves it |
|---|---|---|
| consumer cover | per-good, cohorted by market role + world cohort (harness split) | cohort mix (exporter count grew 23→220 in the fuel precedent); stage 3 changes *role classification inputs* — read cover within fixed role definitions (`classifyMarketRole` unchanged, deliberately) |
| price median / dispersion | cohorted; health-bar only | stage 3 moves it *by design* (brake was doing price work); do not tune constants to chase it — pricing pass owns it |
| service rate (severity + pop quartiles) | attribution-instrument definitions | pop quartiles use end-of-run population — galaxy growth shifts quartile boundaries between A/B arms; compare within-arm profiles, not raw boundaries |
| single-source residual share | attribution instrument, equilibrium window | still rising at t=12k (29.5%→42.0%) — compare arms at identical tick windows, never across horizons |
| harness surplus metric | donor-line denominated | moves with honest demand in stage 1 even if physical flows barely change — annotate the A/B read |
| unrest / population aggregates | population-weighted, cohorted | migration re-sorts cohorts when flow improves; read per-cohort, not galaxy-wide |

---

## Open questions for `/spec-review`

1. Does relations drift count only cross-faction trade volume (making stage 2's flow-row increase
   invisible to it), or all flow rows? (Row 3 flag.)
2. Where does the honest-demand writer get the strike *scalar* — same-tick signals or recompute
   from persisted unrest? (Row 5 flag.)
3. Is the storage guard's `maxStock` read coherent at the readout call site (`industry.ts:707`),
   which today passes the pricing band?
