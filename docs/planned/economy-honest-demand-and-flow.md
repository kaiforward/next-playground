# Honest demand and flow

**Status: planned; `/spec-review` passed 2026-08-04** (report:
`.agent-reviews/spec-economy-honest-demand-and-flow-2026-08-04-164917.md` — 21 findings, all
triaged by Kai, amendments applied). Three staged changes agreed 2026-08-03/04 from the
pricing-vs-logistics measurement program (direction, all five measurements and Kai's dated inputs:
[pricing-vs-logistics.md](../build-plans/pricing-vs-logistics.md)). Implemented **in order, with a
simulate A/B isolating each stage** — all three touch the same matcher surface, which is why they
share one spec and one review. Stage 3 additionally ripples into logistics urgency through the
draw figure (see its third A/B arm) — the stages are isolated by instrumentation, not by nature.

## Headline

Three fixes to how goods move, in plain terms:

1. **Demand honesty — as two figures, not one.** Today a factory's input appetite is counted at
   what its buildings *could* consume at full tilt, even when the factory is stopped by a strike
   or its own full yard. The logistics network believes that fiction — measured: 1 in 7
   industrial-demand readings overstates real draw by 2× or more. After this change there are two
   honest figures with two jobs. The **use figure** — what this world's industry draws when it is
   running (staffing- and strike-gated) — sets every *warehousing* quantity: targets, give-away
   floors, consumer/producer classification. It moves only when buildings, population or strike
   state move, so a world's comfort levels never twitch with its yard. The **draw figure** — the
   use figure further gated by each factory's own output brake and live event modifiers — answers
   *how urgently does this world need a delivery right now*, and ranks the import queue. Civilian
   want always counts at full rate in both — a starving town must never read as a low-demand town.

2. **Every willing donor serves a deficit, not just the nearest.** The matcher today gives each
   deficit exactly one donor per logistics cycle; measured, that single-donor cap owns 42% of all
   unmet deficit tonnage at equilibrium while stock sits reachable and drawable. After this change
   a deficit draws from its reachable donors in cost order until it is filled, the donors are
   drained to their reserves, or the work budget runs out. Whether the budget then binds is a
   measured stage gate, not a prediction — and if it binds, the budget is raised (it is free and
   placeholder-sized by explicit direction; logistics *pricing* is where the real cost lands
   later).

3. **The production brake stops reading the price chart.** A producer today idles when its stock
   passes a multiple of the *price anchor* — a figure floored by a pricing divide-by-zero guard,
   unrelated to warehousing. Measured: a third of all throttling lands on live exporters facing
   real unmet demand. After this change a producer idles against its **warehouse**: full rate
   until the larger of "40 cycles of what this system uses" (the use figure) and "8 cycles of what
   it makes", tapering to a stop at or before its *physical built storage* — no price-curve
   quantity anywhere in the brake. Price re-enters only in the later goods-pricing pass.

## Stage 1 — demand honesty (the two figures)

**The use figure** (warehousing; per good `g` at a system):

```
useRate(g)    = civilian(g) + Σ over consumer goods c with g in recipe(c):
                  steadyDraw(c) × perOutput(c,g) × INPUT_DEMAND_MULTIPLIER
steadyDraw(c) = buildingProduction(c)      // capacity × staffing gates × yield × family buff
                × strikeSuppress(c)        // strike + maintenance malus, as the tick applies it
```

No input gates (a scarce input must not deflate its own demand signal — the rationing
death-spiral), no brake term, no event rate multipliers: the figure describes what this industry
draws *when it runs*, and changes only as slowly as staffing and strike state do.

**The draw figure** (urgency; derived live at the matcher's read point):

```
drawRate(g)  = civilian(g) + Σ over consumer goods c with g in recipe(c):
                 wouldDraw(c) × perOutput(c,g) × INPUT_DEMAND_MULTIPLIER
wouldDraw(c) = steadyDraw(c)
               × brakeCeiling(c)           // c's own output brake, at c's current stock
               × productionMult(c)         // live event rate modifiers (clamped 0.1–3.0)
```

`brakeCeiling(c)` is computable directly (c's knee needs only c's own use figure, capacity and
storage — no recursion, see Stage 3), so **no topological evaluation pass exists anywhere**: both
figures are single sums over `GOOD_RECIPE_CONSUMERS`. The measured bounds bracket the draw figure:
nominal (capacity) overstates it; realized-based understates it where the input itself binds.

**Who reads which figure:**

| Reader | Figure | Why |
|---|---|---|
| `logisticsTarget`, `donorReserve` (× `anchorMult`, as today) | use | a warehouse target must not follow the momentary state of the yard it stocks |
| exporter reserve (`EXPORT_RESERVE_COVER × demand`) | use | same — a reserve is warehousing policy |
| self-supply gate + exporter test (`production` vs `demand`) — matcher, harness, planner, founding cap | use | consumer/producer classification must not flip with a one-cycle brake flicker |
| matcher severity weight (`shortfall × demand`) | draw | a factory that cannot run right now should not head the import queue |
| build planner rate-deficit test + capacity sizing (incl. the queued-output term) | use | capacity is sized against persistent need, not this cycle's yard state |
| stage-3 brake knee (use term) | use | see Stage 3 |
| trade-flow read service (`lib/services/trade-flow.ts:77-87`) | use | **a change, not an inheritance** — the service computes its own capacity figure today and is re-pointed at the shared use-figure function (it has buildings/population/yields in scope) |

The queued-output term stays a deliberate mixture: queued capacity has no stock, no strike and no
brake state, so it counts at full draw by design (`directed-build.ts:263`; the planner's other
demand reads — `:307, :316, :387, :468-471, :1022`, `processors/directed-build.ts:110` — all take
the use figure through `GoodMarketState.demand`).

**What deliberately does NOT change in stage 1:**

- The persisted pricing `demandRate` (`totalDemandRateForGood`,
  `lib/constants/market-economy.ts:70-74`: capacity-based + `MIN_DEMAND` floor). It anchors price
  (`targetStock`) and the ration knee (`RATION_COVER × demandRate`); both belong to the deferred
  goods-pricing pass.
- The founding manifest's **want** line (raw civilian rate — #213). Its **cap** does move: the
  manifest draws through `surplusDrawable` (`processors/directed-build.ts:110`), whose reserves
  are use-figure-denominated — smaller where today's figure was fictional, so founders part with
  more per colony. Watched at the founding horizon (A/B below).
- `anchorMult` remains the one event channel riding the warehousing thresholds; event
  **production** multipliers enter the draw figure only (above). The Events row of the worksheet
  names both. Inside `wouldDraw`, `brakeCeiling(c)` uses c's real (anchor-shifted) knee — an
  anchor-shift event therefore re-weights urgency down the chain; bounded by the clamps, and
  confined to queue ordering since the warehousing figure carries no ceilings.

**Data shape.** Three new persisted per-market fields, one signal, one seeder:

- `honestUseRate` — written by the population processor beside its `demandRate` rewrite (same
  cadence). **Seeded at market creation** in `createSystemMarkets` (`lib/world/markets.ts:38-48`,
  the single constructor world-gen and colony-establish share) — civilian-only at founding (a new
  colony has no industry). **Absent-field fallback is a live recompute (never 0)**: a 0 makes the
  row an un-sinkable, fully-drawable donor (`classifyMarketState` target≤0;
  `surplusDrawable` reserve 0). Unit test: a market row constructed outside the population
  processor is neither donor-classified nor sink-excluded.
- `productionSuppressRate` — the strike × maintenance scalar the economy applied this cycle,
  persisted beside the existing `productionSuppressed` bool (same writer, `economy.ts` market
  update). Needed because the draw figure is derived live at read points.
- `productionMult` — the aggregated event production multiplier, persisted beside `anchorMult`
  (same writer).
- `EconomySignals.productionSuppressBySystem` — the economy processor already builds this map
  (`economy.ts:116-122`); it emits it on signals and the population processor reads it from
  `ctx.results` exactly as it reads `dissatisfactionBySystem`. One value, computed once, identical
  to what the tick applied. (Recomputing at population time is rejected: `PopulationProcessorParams`
  carries neither `strikeParams` nor the treasury-fed maintenance malus, and a recompute would use
  the just-written unrest — the wrong half of both.)

One pure engine function produces both figures so the logistics read, the planner, the seeder and
the brake cannot diverge. **No save-format bump** (Kai 2026-08-04): all three new fields are
additive-optional with defined absent-behaviour (suppress/mult read 1, `honestUseRate`
live-recomputes), which is exactly the case `save.ts`'s own docstring exempts from a bump. All
writes finite-guarded as `realizedProductionRate` is (`economy.ts:181-183`).

## Stage 2 — multi-donor matching

In `matchFactionTransfers` (`lib/engine/directed-logistics.ts:197`), the per-deficit body changes
from "pick the single nearest reachable donor" to:

> Collect the reachable donors of the good with drawable stock and a valid route; sort by per-unit
> route cost ascending (tie: stable system order, as today); draw
> `min(remaining shortfall, donor's drawable, budget/perUnit)` from each in turn until the
> shortfall is met, donors are exhausted, or the budget is spent. One transfer row per
> donor→deficit draw.

Unchanged: severity-first triage across deficits, donor reserves as hard floors, fill-to-target
semantics, budget accounting (`work = quantity × route cost`), the dead-band.

**`logisticsFundingBound` is a live gameplay gate, not telemetry** — it suppresses the planner's
capacity proposals (`directed-build.ts:317`) and exempts producers from idle decay
(`industry.ts:435-438`, `infrastructure-decay.ts:63`). Recording rule under multi-donor: the flag
is set on a deficit only when the budget stopped a draw **and** the remaining shortfall after all
affordable donors exceeds 10% of the original shortfall (first-cut fraction) — it must keep
meaning "this market's shortfall persists because of money", not "the last donor attempted was
unaffordable".

**The budget question is a gate, not a prediction.** The attribution run's "never binds / 6–8%
spent" was measured under the single-donor matcher, whose infinite-budget counterfactual produced
an identical transfer set — it bounds nothing about multi-donor volume. Order-of-magnitude from
the same run: the single-source bucket is 4.44e9 units at equilibrium against 0.29e9 served today
at 1.64 work/unit — serving it in full would take ~91% of the budget at *nearest-donor* prices,
and later donors are dearer. Stage 2's A/B therefore reports, at both horizons: budget spend %,
funding-bound event count and flag set-rate, `funded.logistics` (must stay 1) and
`funded.construction` distribution, build levels landed and colonies founded per cycle (the
treasury ladder pays logistics **above** construction — `treasury.ts:101` — so an inflated haul
bill starves construction first, and an insolvent faction's `funded.logistics` latch is a second
binding channel independent of generation headroom). **If any deliveries are budget-capped, the
budget is raised (`GENERATION_PER_POP`) and the A/B re-run** — per Kai 2026-08-04: prove the
mechanics against an ample budget; pricing the budget is row 10's later work.

Flow-log note: rows fan out per donor-draw; the world log is a 200-tick window with no row cap
(`world/tick.ts:1142-1143`) and the harness accumulates all rows for a whole run
(`runner.ts:94,133-135`). The A/B states the observed row multiplier, and a 16,000-tick harness
run is smoke-checked before the long reads; a per-deficit donor cap is the stated fallback if
volume is a problem — a design limit, never a silent one.

## Stage 3 — the brake leaves the price anchor

> **Amendment (Kai, 2026-08-05, at the stage gate):** the physical-storage taper cap below —
> the review's finding-2 resolution — was **falsified by the first three-arm gate run**. The
> storage constants are a `maxStock` depth model authored per producing building; measured
> against the knee's use term they sit 16×–843× below it per good (median producing market
> ~143× below the ramp end), so the cap degenerated to a hard production stop at the yard on
> 97.4% of producing checks and the galaxy collapsed (supplied 71.3% → 0.2%; arm C proved the
> effect entirely the brake's). Decision: **the cap is removed** — `rampEnd = BRAKE_RAMP × knee`,
> no storage term — and a brake-relevant physical warehouse becomes its own design pass (ROADMAP),
> with this knee as the capacity the autonomic build would build storage toward. Storage-cap
> language below is retained as written history; the shipped formula is:
>
> ```
> knee    = max( BRAKE_USE_COVER × honestUseRate × anchorMult,
>                BRAKE_OUTPUT_COVER × capacityProduction )
> rampEnd = BRAKE_RAMP × knee
> ceiling = 1 while stock ≤ knee; linear taper to 0 over [knee, rampEnd]
> ```

Per producing market, one shared knee function used by every call site:

```
knee    = max( BRAKE_USE_COVER × honestUseRate × anchorMult,   // cycles of what this system uses
               BRAKE_OUTPUT_COVER × capacityProduction )       // cycles of what it makes
rampEnd = min( BRAKE_RAMP × knee, storageCapacity )            // physical built storage ONLY
ceiling = 1 while stock ≤ min(knee, rampEnd);
          linear taper to 0 over [knee, rampEnd] when rampEnd > knee;
          hard stop at rampEnd otherwise
```

- **`BRAKE_USE_COVER = 40`**, **`BRAKE_RAMP = 1.3`** preserve today's geometry on markets where
  the use figure equals the old floored `demandRate`; **`BRAKE_OUTPUT_COVER = 8`** is the
  working-inventory term (first-cut, tuned only by the stage A/B) and the answer to the
  pure-exporter trap. `capacityProduction`, not realized — realized contains the ceiling and a
  self-referential denominator can latch shut.
- **The taper cap is `storageCapacity` — physical built storage (`facilityStorageForGood`), never
  `maxStock`.** `maxStock` is anchor-derived (`market-pricing.ts:63-65`), and capping the *knee*
  with it both re-imported the price anchor and silently overrode `BRAKE_OUTPUT_COVER` on 16 of
  26 goods (effective cover `STORAGE_PER_UNIT/(BRAKE_RAMP × OUTPUT_PER_UNIT)` = 2.31 cycles on
  metals/fuel … 7.69 on ore/minerals — the top residual goods). Capping the taper's *end* keeps
  the full-rate band wherever the yard allows. Where the yard is genuinely smaller than the knee
  (metals, fuel, gas), storage binds with a hard stop — an honest physical limit, made visible:
  **the A/B reports per good which term bound (`use` / `output` / `storage`)**, and re-sizing the
  storage constants (`EXTRACTOR_STORAGE_PER_UNIT` 40 / `PRODUCTION_STORAGE_PER_UNIT` 15 /
  `POP_CENTRE_STORAGE` 2-12 — all first-draft) is a deliberate later decision taken on that
  evidence. The storage constants are thereby new brake readers — recorded in worksheet row 1.
- **`anchorMult` rides the use term only**; the output term and the storage cap carry no
  price-anchor quantity of any kind.
- The knee reads the **use figure**, which contains no ceilings — so knee computation has no
  recursion and no ordering constraints.
- **Call sites and shapes:** the tick (`supply-chain.ts:122`), the decay/selling signal
  (`economy.ts:205`), the Industry-panel readout (`industry.ts:707`) and the draw figure's
  per-market brake pass (`lib/tick/processors/good-market-state.ts` — a fourth live site stage 1
  added; the knee's new signature forces an edit there too, and the third A/B arm's
  `drawBrakeCeiling` switch selects exactly that site's ceiling) all call the one knee function. `MarketTickEntry` (+ `TickEntryInput`/`resolveMarketTickEntry`/`MarketView`) gains
  `honestUseRate`, `capacityProduction` and `anchorMult`; `EconomySimParams.holdCover` is replaced
  by the three brake constants. `capacityProduction` is the **reference-cycle** rate —
  un-catch-up-scaled, un-strike-suppressed, un-event-multiplied (i.e. `GoodMarketState.
  capacityProduction`'s value, `good-market-state.ts:49`) — `entry.productionRate` is none of
  those things (`economy.ts:145`, `tick.ts:153-156`) and using it would make the knee
  cadence-dependent. The **cadence-invariance gate runs at stage 3** as well as stage 2.
  `buildIndustryReadout` gains `honestUseRateOf` and `anchorMultOf` accessors threaded from
  `getSystemIndustry` (`universe.ts:187-192`, both in hand); its `maxStock` coherence was verified
  (same `marketBandForRow` as the tick) but `maxStock` is no longer a brake input anywhere.
- **The flat tick dies:** `simulateEconomyTick` (`tick.ts:92-117`) is production-dead (only the
  coupled tick is wired) and is deleted with its ceiling test suites rather than kept on the old
  knee.

**Known consequences, owned by this stage's A/B:**

- *Exporters run.* An exporter's knee moves from `1.3 × 40 × (tiny floored local demand)` to
  cycles of its own output (storage-capped). Expected: exporter throttle share (31.9% of throttled
  checks at equilibrium) falls hard; thin-reachable-stock residual (56.8% of U_inf) falls;
  consumer cover rises at 12k+.
- *Prices move.* Today's brake is doing price work (`HOLD_COVER`'s docstring calibrates it as the
  lever resting stock "just above the anchor"). Accepted by direction; the A/B gates on the coarse
  health bar only (no pinning epidemics, no runaway).
- *Decay re-reads "selling".* The selling factor feeding decay (`infrastructure-decay.ts:42`)
  becomes warehouse-based; which producers idle changes. Watched via building counts and
  idle-reason mix — read against the stage-2 head (stage 2 already shifts decay through the
  funding-bound exemption).
- *Logistics urgency shifts second-order.* The draw figure contains `brakeCeiling`, so the new
  knee re-ranks import queues galaxy-wide without a line of logistics code changing. **The stage-3
  A/B runs a third arm** — new knee in the tick, `brakeCeiling` inside the draw figure pinned to
  the old anchor-based ceiling — so the brake's direct effect and the urgency ripple are
  attributable separately. The pin is a **committed harness switch** riding the same override
  channel as the cadence (`runWorldTick` opts), not a local measuring patch (Kai 2026-08-04);
  the live game never sets it.

**The dead-band, restated in one unit family** (the chosen conservatism stays): brake ceiling
`BRAKE_RAMP × BRAKE_USE_COVER` = 52 vs donation line `SURPLUS_MARGIN × DONOR_RESERVE_COVER` = 56 —
both cycles of the same use figure. `band-constants.test.ts` is rewritten at **both** its
`HOLD_COVER` sites: the `:63-72` invariant becomes `BRAKE_RAMP × BRAKE_USE_COVER ≤ SURPLUS_MARGIN
× DONOR_RESERVE_COVER`, and the `:83` sanity assertion becomes `BRAKE_RAMP > 1`. A new invariant
pins `INPUT_DEMAND_MULTIPLIER === 1` with the reason recorded: both honest figures multiply by it
while the physical draw (`supply-chain.ts:66,134`) does not, so the "what it would actually pull"
identity holds only at 1.0.

`TARGET_COVER` loses its rider and becomes purely a pricing constant. The docstring sweep covers:
`TARGET_COVER`, the deleted `HOLD_COVER`, `DONOR_RESERVE_COVER` (`directed-logistics.ts:66-68`
asserts the anchor coupling), the `lib/engine/tick.ts` module + field docstrings and
`lib/engine/supply-chain.ts:9-15`, and the two active gameplay docs describing the anchor knee
(`economy-autonomic-agency.md`, `economy-equilibrium-rework.md`) — on the branch, before the
final review, per the doc lifecycle.

## Staging and the A/B gates

Ship order **1 → 2 → 3**, each stage merged only after its own A/B against the previous stage's
head, both horizons, seed 42, 600 systems, scale 100; brake reads at **12,000+ ticks or as a
trajectory** (the 10k label sits inside the high-tier startup transient). The matcher ships before
the brake so released stock lands on a matcher that can distribute it.

**Cohort discipline for every A/B:** the harness role classifier reads `state.demand` in its
exporter branch (`cohort-analysis.ts:44`) and `realizedProductionRate` — so cohort membership
moves in stages 1 and 3 by construction. Every cohorted metric is published beside a per-arm
role-membership count table, and the primary cover/price reads are taken against the **baseline
arm's role partition, held fixed** — a cover shift caused by re-cohorting must never read as a
flow change (the fuel-cover precedent).

| Stage | Primary metrics | Expected direction |
|---|---|---|
| 1 demand honesty | camping cohort (dwell anchors), threshold sizes, planner build mix; **hunting detector**: cycle-over-cycle deficit↔surplus flips on industrial-input goods + haul-churn ratio; founding-horizon (1000 t) new-colony deficit counts, mean manifest tonnage, founder post-manifest stock ÷ donorReserve | campers unlock; aggregate flows near-unchanged (fiction is concentrated, ×1.18); no threshold hunting; colonies validly provisioned |
| 2 multi-donor | single-source residual share, service by severity + pop quartile, U_real; budget spend %, funding-bound count + flag set-rate, `funded.logistics`/`funded.construction`, build + colonies per cycle; flow-row multiplier | single-source → ~0; service up broadly; **budget-cap count 0 — else raise the budget and re-run** |
| 3 brake (3 arms) | exporter throttle share, thin-stock residual, consumer cover (12k+), price health bar, building/idle mix, per-good knee-binding-term (`use`/`output`/`storage`), cadence-invariance pair | exporter throttling falls; cover rises; prices move without pinning/runaway; binding-term table feeds the storage-constant decision |

Cross-stage regression on every A/B: the coarse health bar (no NaN/runaway/pinning, dispersion,
liquidity), unrest/population aggregates cohorted, interval invariance.

## What this spec deliberately leaves alone

- Pricing: `demandRate`, `targetStock`, `MIN_DEMAND`, the price curve — the goods-pricing revisit.
- The haul budget's *nature*: free, generation-based; raised if stage 2 caps it; priced in row
  10's territory.
- The dead-band between brake and donation line: chosen conservatism, restated not resized.
- Sink ordering (severity-first): Kai's flow-priority design space, untouched.
- Hub/chain logistics depth: later pass. This spec's stance, per Kai 2026-08-04: the negative
  space emerges from real constraints (budget, infrastructure, scarcity), never from designed
  algorithmic inefficiency — `docs/planned/negative-space-economy.md`'s conflicting "make the base
  efficient — NOT OK" bullet was removed the same day; its tuning guardrail now states this stance.
- Relations' dead trade-volume driver (`relations.ts:191` counts only cross-faction flows; none
  exist) — pre-existing, booked on the roadmap 2026-08-04, wired when inter-faction trade ships.

---

## Design-hazards worksheet

### 1. One quantity, several unrelated jobs

`npm run impact` outputs, 2026-08-04 (boilerplate trimmed, reader lists verbatim; the `demandRate`
header below is the tool's own SHARED footer, which counts tick + outside-tick modules — the
harness block is pasted separately):

```
IMPACT: demandRate — SHARED, 35 references across 15 modules + 2 tick processors (economy 3/9,
directed logistics 6/9; population 4/9 writes it undeclared)
  market-pricing 8× (:43,:63,:76,:80,:100,:105,:118,:125 — targetStock = TARGET_COVER × demandRate × anchorMult)
  tick 5× (:31,:109 ration knee,:137,:165,:274)   market-economy 3× (:98,:102,:107)
  market-tick-builder 3×   supply-chain 2× (:97,:142 ration knee)   adapters/economy 2× (:91,:143)
  adapters/population 1× (:69 the rewrite: totalDemandRateForGood)   directed-logistics-world :19
  economy-world :37   markets :43   world/types :230
  outside tick: market-entry 4×, dev-tools :201, market :26, universe :190
  harness: cohort-analysis 5× (:44 exporter branch reads state.demand — NOT only the floored rate;
  :48 consumer/inert tie-break reads demandRate vs MIN_DEMAND)
```

```
IMPACT: productionCeiling — SHARED, 8 references across 4 modules (4 live call sites)
  tick :77 (def), :104 (flat tick — production-dead, deleted in stage 3)
  supply-chain :122 (the live coupled tick)
  economy :205 (selling-factor signal → decay)   industry :707 (readout selling factor → UI)
IMPACT: HOLD_COVER — SHARED, 3 modules: economy (:36 def), industry (:707), tick (world/tick.ts:777
  simParams) + band-constants.test.ts (2 assertions: :63-72 invariant, :83 sanity)
```

```
IMPACT: inputDemandFromProduction — SHARED, 7 references across 4 modules
  industry :532 (def)   good-market-state :35 (the matcher/planner demand figure)
  directed-build :263 (queued-output term; other planner demand reads via GoodMarketState.demand:
  :307,:316,:387,:468-471,:1022; processors/directed-build.ts:110 founding cap)
  services/trade-flow :85 (outside tick — an INDEPENDENT capacity computation, re-pointed, not inherited)
IMPACT: inputDemandForGood — CONTAINED, 2 modules: industry :513 (def), market-economy :72
  (inside totalDemandRateForGood — the PRICING figure)
IMPACT: sellingFactorBySystem — SHARED, 3 modules: economy (:194-:234 producer),
  infrastructure-decay :42 (consumer), tick/types :63
IMPACT: matchFactionTransfers — CONTAINED, 1 module: directed-logistics (+30 test references)
```

| Quantity | Readers today | Which this design moves | Intended? |
|---|---|---|---|
| `demandRate` (persisted) | 15 modules above: pricing anchor, ration knee, tick entries, harness tie-break | **none** — deliberately untouched | Yes — pricing/ration stay coupled to each other, separated from logistics |
| `GoodMarketState.demand` (+`logisticsTarget`, `donorReserve`, exporter reserve, classification) | matcher, planner (all call sites above), harness role split (`cohort-analysis.ts:44`), founding cap (`processors/directed-build.ts:110`), trade-flow (re-pointed) | all, together — becomes the **use figure** at the single shared producer; severity additionally weighted by the **draw figure** | Yes — one producer, two figures, each reader assigned deliberately (table in Stage 1) |
| `productionCeiling` knee | supply-chain :122, economy :205 (→ decay), industry :707 (→ UI); flat tick :104 deleted | all three live sites re-pointed at the shared knee function | Yes — tick, decay and UI must agree about idleness |
| `HOLD_COVER` | economy/industry/tick + 2 test assertions | deleted; replaced by `BRAKE_USE_COVER`/`BRAKE_RAMP`/`BRAKE_OUTPUT_COVER`; both tests rewritten | Yes |
| `TARGET_COVER` | pricing curve + band | loses the brake rider; **no** retained physical reader (the taper cap is physical storage, not `maxStock`) | Yes |
| `EXTRACTOR_STORAGE_PER_UNIT` / `PRODUCTION_STORAGE_PER_UNIT` / `POP_CENTRE_STORAGE` | `facilityStorageForGood` → band maxStock, UI | become **brake readers** (the taper cap) — new coupling, deliberate and reported (knee-binding-term table) | Yes — physical limits made visible; re-sizing is a later evidence-based decision |
| `logisticsFundingBound` | planner `directed-build.ts:317` (proposal suppression), decay `industry.ts:435-438` + `infrastructure-decay.ts:63` (idle exemption), UI idle reason | recording rule changes under multi-donor (10% remaining-shortfall condition) | Yes — the flag keeps meaning "short because of money" |

### 2. A constant read for a meaning it was not authored to have

| Constant | Docstring says | This design uses it as | Same thing? |
|---|---|---|---|
| `TARGET_COVER` | "A PRICING constant, plus one deliberate physical rider: productionCeiling's throttle knee runs off the anchor this defines" (`lib/constants/economy.ts:14-19`) | pricing only; the rider removed, nothing reintroduced (taper cap is physical storage) | Yes — restores authored intent |
| `HOLD_COVER` | "Calibrated against the simulator's coarse health bar: 1.3 lifts the galaxy-wide price median to ~1.08x base" (`economy.ts:26-35`) | deleted — its calibration is price work this design decouples | The docstring is the evidence the brake does price work; consequence owned in stage 3's A/B |
| `MIN_DEMAND` | "Floor on the cycles-of-supply denominator … divide-by-zero" (`market-economy.ts:26-28`) | left in pricing; **no** reader in either honest figure, the knee, or the taper cap | Yes |
| `WAREHOUSE_COVER`/`DONOR_RESERVE_COVER` | cycles of REAL demand, ride `anchorMult` (`directed-logistics.ts:24-70`) | same roles, denominator = use figure | Yes |
| `EXPORT_RESERVE_COVER` | "cycles of its own demand a structural exporter keeps… immune to anchor_shift" (`directed-logistics.ts:12-23`) | unchanged rule; `demand` = use figure | Yes; reserve shrinks where demand was fictional — intended |
| `INPUT_DEMAND_MULTIPLIER` | "Magnitude knob on recipe input-demand draws; neutral (1.0) until calibrated" (`lib/constants/industry.ts:98-99`) | present in both figures; absent from the physical draw (`supply-chain.ts:66,134`) — identity holds only at 1.0 | Pinned by a new invariant `=== 1` with the reason recorded |
| storage constants | "First-draft; subject to calibration" (`industry.ts:288-295`) | the brake's physical taper cap | New use, named; sized later on the binding-term evidence |

### 3. A system you did not think about

| System | Interaction | Reason if none |
|---|---|---|
| Events | Three channels, all named: `anchorMult` rides warehousing thresholds + the knee's use term (as today); `productionMult` enters the **draw figure** (persisted for the purpose — a collapsed factory claims collapsed appetite, a boomed one boomed appetite; clamp 0.1–3.0 bounds it); anchor shifts re-weight urgency down the chain via `brakeCeiling` inside `wouldDraw` (queue ordering only). `consumptionMult` exists as a channel but no shipped event uses it. | — |
| Population + migration | Civilian want full-rate in both figures; satisfaction is measured off the tick's own delivery (`economy.ts:160-165`), never `GoodMarketState.demand` — verified. Better flow shifts growth/migration; watched cohorted. | — |
| Unrest / regime | Ration knee unchanged (pricing `demandRate`). Strike feeds both figures one-directionally via the suppress scalar; no same-cycle loop. | — |
| Industry + staffing | Staffing gates inside both figures via `buildingProduction`; unstaffable capacity claims no input demand. | — |
| Infrastructure decay | Touched by **both** stages 2 and 3: stage 2 via the funding-bound idle exemption (recording rule + set-rate metric), stage 3 via the warehouse-based selling factor. Stage-3 building/idle reads taken against the stage-2 head. | — |
| Directed logistics | The subject. | — |
| Directed build / planner | Use figure everywhere (call sites enumerated in row 1); queued-output mixture deliberate; funding-bound suppression rule named. | — |
| Colonisation + founding manifest | Want line unchanged; **cap moves** (use-figure reserves via `surplusDrawable` at `processors/directed-build.ts:110`) — founders part with more; founding-horizon A/B metrics watch it. | — |
| Treasury / purse | Ladder order is load-bearing: logistics paid **above** construction (`treasury.ts:101`) — stage 2's bill starves construction first; `funded.logistics < 1` latch is a second budget-binding channel. Both instrumented in stage 2's A/B with the raise-the-budget resolution. | — |
| Factions + relations | **None, verified structurally**: `getTradeVolumeBetween` skips same-faction rows (`relations.ts:191`); all flow rows are same-faction by construction; independents collide as `""`. (Side discovery — the trade driver is dead code today — booked on the roadmap, out of scope.) | — |
| Save format (`World` shape) | Three new persisted market fields (`honestUseRate`, `productionSuppressRate`, `productionMult`) + `MarketTickEntry`/`MarketView` additions; seeded at creation; finite-guarded; additive-optional with defined fallbacks — no format bump, per `save.ts`'s authored rule (Kai 2026-08-04). | — |
| Harness metrics | Role classifier moves with both stages (`cohort-analysis.ts:44` reads `state.demand`; `production` is realized) — **cohort discipline protocol** in §Staging (membership tables + pinned baseline partition). Cover is anchor-denominated and unmoved (verified); the surplus metric moves with the use figure — annotated. | — |

### 4. Claims about current behaviour

All from the pricing-vs-logistics measurement program — falsifiers pre-committed (`f63aed6e`,
`df4640ae`, `05ed9768`, `c71c2589`; provenance verified clean at review), raw output in the build
plan.

| Claim | Evidence | Horizon | Cohort |
|---|---|---|---|
| Industrial demand overstates real draw: ratio ≤ 0.5 in 14.8% of industrial checks; galaxy ×1.18 | fiction measurement, CONFIRMED via share bar | both; stationary late | industrial-demand checks = 42.5% of developed-market checks; 600 sys, seed 42, scale 100 |
| Realized exceeds nominal in 22.5% of checks (both directions must be handled) | same run | equilibrium | same |
| The brake throttles live exporters: 31.9% of throttled checks exporter-path; the ramp is the operative regime (95%) | brake-cohort measurement, FALSIFIED | both | all developed markets |
| 71.8% of throttled exporters face reachable same-faction deficits | sated-exporter measurement, FALSIFIED | both; stationary | exporter-path checks above anchor |
| The haul budget owns 0% of persisting deficits **under the single-donor matcher**; single-donor structure owns 42.0%, thin reachable stock 56.8% | deficit-attribution measurement, FALSIFIED (budget claim) — licenses nothing about multi-donor volume | both | all matcher deficits, 2,820,188 checks |
| Serving the single-source bucket ≈ 91% of the budget at nearest-donor work rates (1.64/unit) | derived from the same raw output at review | equilibrium | same run — an order-of-magnitude bound, not a prediction; hence the stage-2 gate |
| Dead-zone camping is the fiction's tail: campers drain at 0.27× nominal | dwell measurement, confirmed narrowly | both | industrial-input goods |
| The brake's knee today = `HOLD_COVER × targetStock` at 3 live sites + 1 dead | `supply-chain.ts:122`, `economy.ts:205`, `industry.ts:707`, `tick.ts:104` | — | code fact |
| Hypotheses, labelled: `BRAKE_OUTPUT_COVER = 8`; the funding-bound 10% fraction | first-cut constants, tuned/validated only by the stage A/Bs | — | — |

### 5. Signals, thresholds, primitives consumed

| Consumes | Produced at | Shape today | Design assumes |
|---|---|---|---|
| `GoodMarketState.demand` etc. | `good-market-state.ts:27-58` | civ + industrial at capacity | redefined to the use figure at this single producer; draw figure derived live beside it |
| `capacityProduction` | `good-market-state.ts:49` | staffing-gated reference-cycle rate | output-term denominator; **added to `MarketTickEntry`** (absent today — `entry.productionRate` is catchUp-scaled + suppressed, `economy.ts:145`/`tick.ts:153-156`, and must not be used) |
| `realizedProductionRate` | `economy.ts:170-183`, persisted | realized/catchUp, finite, ≥ 0 | matcher's `production` figure only; never a brake denominator |
| suppress scalar | `economy.ts:116-122` | strike × maintenance, (0,1] | emitted on `EconomySignals` (write path) + persisted `productionSuppressRate` (read path) |
| `productionMult` | event resolve, per tick (`market-tick-builder`) | clamp 0.1–3.0, not persisted today | persisted beside `anchorMult`, same writer |
| `anchorMult` | persisted, events (run 2nd) | ≥ 0, default 1 | rides use-side thresholds + knee use term; read inside the tick |
| `storageCapacity` | `facilityStorageForGood` (`industry.ts:838-853`), on market rows | physical built storage, > 0 for any producer of the good | the taper cap; **not** `maxStock` |
| `PRODUCTION_GOOD_ORDER` / `GOOD_RECIPE_CONSUMERS` | `constants/recipes.ts` (Kahn sort, acyclic by test) | complete over goods | plain sums; no topological pass needed anywhere |
| budget/funding | treasury settlement → params | latched 0-1/faction | stage 2 instruments both binding channels |
| `honestUseRate` (new) | population processor + `createSystemMarkets` seed | — | absent-field fallback = live recompute, never 0 |

### 6. Aggregates that move for other reasons

| Metric | Read at | What else moves this number |
|---|---|---|
| consumer cover | per-good, per-role (harness split) | **role membership moves in stages 1 and 3** (`cohort-analysis.ts:44`) — pinned-baseline-partition protocol + membership tables, every A/B |
| price median / dispersion | cohorted; health-bar only | stage 3 moves it by design; never tuned against here |
| service rate (severity + pop quartiles) | attribution-instrument definitions | pop-quartile boundaries drift with galaxy growth — compare within-arm profiles |
| single-source residual share | attribution instrument, equilibrium | still rising at t=12k — compare arms at identical windows; **relabels to budget-owned if the budget binds** (the stage-2 gate exists so this is visible, not silent) |
| harness surplus metric | donor-line denominated | moves with the use figure in stage 1 even if flows barely change — annotated |
| unrest / population aggregates | population-weighted, cohorted | migration re-sorts cohorts when flow improves — per-cohort reads |
| `logisticsTarget`/`donorReserve`/severity | matcher read point | move under stage 3 with no logistics code change (draw-figure ripple) — the third arm attributes it |

---

## Review triage record (2026-08-04)

All 21 findings accepted by Kai; forks resolved: storage guard → ramp-end variant on physical
storage; event multipliers → included (persisted); budget gate → raise-and-re-run resolution;
stage-3 → third arm; relations discovery → booked. One lens claim dropped at verification, one
corrected in merge (report audit trail). The three former open questions are resolved in the body
(relations: none, structural; strike scalar: signals + persisted rate; readout: coherent, two
accessors).
