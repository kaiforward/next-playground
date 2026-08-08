# Supply Response — sequence item 1: Provision, the four descriptive bands, the instrument, and the constant re-cuts, shipped as one change.

## Spec

[docs/planned/supply-response.md](../planned/supply-response.md) — reviewed (spec-review complete, all
findings folded in), with its design-hazards worksheet filled. The spec carries this feature's evidence,
its `npm run impact` licence for the shared symbols, and the sequence that books items 2-5. Earlier
pipeline stages predate this working file, so it opens at the plan.

---

## Build plan

**The ordering problem is the spine.** The spec requires the Provision distribution, the per-world
worst-demanded-good distribution and the founding cohort's Provision to be MEASURED before any constant
is sized — and the instrument that measures them is part of this same change. So the plan is staged:
Stage A adds the instrument alongside the untouched fold (purely additive; no shipped behaviour moves),
Gate 1 measures at both horizons and turns every open number into a written decision, Stage B swaps the
fold, the bands, the relaxation branch and the constants together, Gate 2 is the spec's step-1 gate.

Every figure the spec quotes on the Provision scale today is a Jensen upper bound, not a point estimate.
Sizing a constant from a bound is the failure Gate 1 exists to prevent.

---

### Stage A — instrument first, fold untouched

Nothing in Stage A changes a value the game reads. `dissatisfaction()`, `foldSupplyState()` and every
constant keep their current behaviour, so the Stage A run is a clean pre-swap baseline of the live
galaxy measured on the new units.

#### Task A1 — the un-squared mean and the worst-good reading, as additive engine exports

Files:
- `lib/engine/population.ts` (existing)
- `lib/engine/__tests__/population.test.ts` (existing)

Interface:
- `provision(goods: GoodSatisfaction[]): number` — the necessity-and-demand-weighted mean of per-good
  satisfaction, in [0,1]. Weights are today's `goodWeight` (`demanded × necessity`,
  `lib/engine/population.ts:43-46`), unchanged. A basket with `Σ weight ≤ 0` returns **1** — the spec's
  "the empty basket reads Provision ≡ 1", the complement of the fold's current `return 0` at `:60`.
- `interface DemandedGoodReading { goodId: string; satisfaction: number; demandShare: number;
  necessity: number }` — `demandShare` is the good's share of the world's total civilian demand (the
  spec: the floor "filters tiny *demand*, not low *importance*"), deliberately **not** the fold's
  necessity-weighted share; `necessity` is carried alongside so the necessity-floor variant can be
  decided from the same reading.
- `worstDemandedGoods(goods: GoodSatisfaction[], count: number): DemandedGoodReading[]` — the demanded
  goods with the lowest satisfaction, ascending, at most `count`, ties broken by descending
  `demandShare`. Goods with `demanded <= 0` are not readings at all.
- No existing export changes signature or behaviour in this task. `dissatisfaction()` is untouched.

Proves:
- An empty basket and a fully-delivered basket both read Provision 1, while a weighted basket at zero
  satisfaction reads 0 — the empty-basket arm is the one that silently reads "perfect" for an emptying
  world, and it must be pinned before anything is measured over it.
- A good with zero demand enters neither the mean nor the tail. A good with zero necessity changes the
  mean not at all, but stays tail-eligible with its demand-only `demandShare` intact — the tail's only
  exclusion is `demanded <= 0`, so Gate 1's necessity-floor decision can see low-necessity goods with
  their necessity attached.
- On a partial-satisfaction basket the mean and the shipped squared fold are not complements of each
  other: a uniform partial shortfall reads its own size, several times the squared fold's value. This is
  the vacuity check — a scenario built the way `dFor()` builds them (`band-constants.test.ts:139-144`,
  every named good at satisfaction 0) cannot distinguish the two functions at all.
- The tail returns the same good a naive minimum scan would, including when two goods tie on
  satisfaction, and returns fewer than `count` entries rather than padding when the world demands fewer
  goods.
- `demandShare` sums to 1 over a world's demanded goods and moves only with demand — a high-necessity
  epsilon-demand good reads a tiny share.
- Out-of-range or non-finite satisfaction inputs clamp instead of propagating; a NaN reaching the world
  is a corrupted save, not a bad number.

Consumes: nothing.

#### Task A2 — per-system Provision and worst-good distributions in the harness, cohorted

Files:
- `lib/tick-harness/population-analysis.ts` (existing — `SystemSupplyState` `:246-250`,
  `perSystemSupplyState` `:257-277`, `SupplyRegimeSummary` `:234-244`)
- `lib/tick-harness/cohort-analysis.ts` (existing — `computeWorldCohorts` `:251-302`)
- `lib/tick-harness/types.ts` (existing — `WorldCohortEntry` `:133-143`)
- `scripts/simulate.ts` (existing — supply-regime block `:393-407`, cohort table `:412-433`)
- `lib/tick-harness/__tests__/population-analysis.test.ts`, `lib/tick-harness/__tests__/cohort-analysis.test.ts`,
  `lib/tick-harness/__tests__/experiment.test.ts` (existing — the last holds a full results fixture)

Interface:
- `SystemSupplyState` gains `provision: number` and `worstGoods: DemandedGoodReading[]` (the ascending
  tail). The tail depth is an instrument-local constant with **no gameplay reader** — it exists so the
  demand-share floor and the necessity floor can be re-sliced offline from one run instead of re-running
  the sim per candidate value.
- `SupplyRegimeSummary` gains `provisionLevels` and `worstGoodLevels`, each `{ median: number; p10:
  number; p90: number }`, built with `quantile` (`lib/utils/math.ts:43`) as `market-analysis.ts:208-209`
  and `treasury-analysis.ts:335` already do.
- `WorldCohortEntry` gains `meanProvision: number` and `worstGoodMedian: number`.
- `scripts/simulate.ts` prints both distributions under the existing supply-regime table and adds a
  Provision column to the cohort table.
- `dissatisfaction()`/`foldSupplyState()` calls in `perSystemSupplyState` are unchanged — the existing
  `d` and `regime` fields keep reporting the live behaviour beside the new readings.

Proves:
- A cohort's Provision mean and the galaxy-wide one are folded from the same per-system map and cannot
  disagree — the existing `perSystemSupplyState` contract, now carrying a second quantity.
- The distributions are quantiles, not means wearing a percentile's name: a bimodal population (the
  spec measures 53.4% of settled systems at exactly D 0 against a short tail) must show its p10 and p90
  apart, and a run where every world is identical must show them equal.
- A settled world with no market rows is counted with Provision 1 rather than dropped — the denominator
  must match `perSystemSupplyState`'s settled set exactly, or every share silently shifts.
- An unclaimed system contributes to neither distribution nor any cohort denominator.
- A cohort with no members is still omitted rather than emitting a zero-denominator row.
- The worst-good tail on a world whose worst good is an epsilon-demand skilled-basket good reports that
  good WITH its tiny demand share — the reading the demand-share floor is chosen from is useless if the
  share is dropped.

Consumes: A1.

#### Task A3 — the founding cohort's opening Provision

Files:
- `lib/tick-harness/build-analysis.ts` (existing — `FoundedColonyRecord` `:75-77`,
  `sampleFoundedColonies` `:201-230`, summary fold `:282-292`)
- `lib/tick-harness/types.ts` (existing — founding summary, `meanOpeningDissatisfaction` at `:322`)
- `scripts/simulate.ts` (existing — founding summary line `:507-511`)
- `lib/tick-harness/__tests__/build-analysis.test.ts` (existing)

Interface:
- `FoundedColonyRecord` gains `openingProvision: number | null`, sampled on the same first post-founding
  economy cycle as `openingSatisfaction`/`openingDissatisfaction`, over the same `goodSatisfactionsBySystem`
  input, so the three readings describe one basket.
- The founding summary gains `meanOpeningProvision` and `p10OpeningProvision`. Both are reported: the
  spec's new invariant is written against "the measured founding Provision" and does not say whether
  that is the cohort's mean or its worst decile — Gate 1 decides which, and the number it decides from
  has to exist first.
- `scripts/simulate.ts`'s founding line reports Provision alongside the existing demand-weighted
  satisfaction, labelled so the two weightings cannot be read as the same quantity.

Proves:
- The opening reading is taken on the colony's first post-founding economy cycle and once only — a
  colony sampled twice, or sampled before its first cycle, moves the cohort mean without the galaxy
  changing.
- A colony whose basket is empty at sampling is left `null` rather than recorded as 1 — "could not
  measure" and "opened perfectly supplied" are opposite readings and must never share a value (the
  `founderCover` precedent, `lib/tick/types.ts:133-137`).
- `meanOpeningProvision` and the existing `meanOpeningSatisfaction` differ on a basket where necessity
  and demand disagree — if they agree everywhere, the necessity term was dropped and the instrument is
  the old one under a new name.
- p10 and the mean separate on a skewed cohort; the spec measures 376 of 562 colonies opening below 50%
  satisfaction, so a single number cannot carry the invariant.
- A run that founds nothing reports no founding Provision rather than 0.

Consumes: A1.

#### Task A4 — proposals suppressed by `strikeExplains`, per eligible pair

Files:
- `lib/engine/directed-build.ts` (existing — `strikeExplains` `:319-324`, inside
  `assessStructuralDeficits` `:296-…`)
- `lib/tick/processors/directed-build.ts` (existing — result assembly `:755`)
- `lib/tick/types.ts` (existing — instrumentation fields `:86-110`, `TickInstrumentation` `:189-196`)
- `lib/world/tick.ts` (existing — instrumentation locals `:913-922`, return `:1339-1341`)
- `lib/tick-harness/runner.ts` (existing — per-tick accumulation `:218-236`)
- `lib/tick-harness/types.ts`, `scripts/simulate.ts`
- `lib/engine/__tests__/directed-build.test.ts`, `lib/tick/processors/__tests__/directed-build.test.ts`,
  `lib/tick-harness/__tests__/runner.test.ts` (the zero-denominator guard lives in `runner.ts`)

Interface:
- `StructuralAssessment` gains a per-resolution count `{ suppressed: number; eligible: number }` over
  (system, good) pairs: `eligible` is every pair with `capacity > 0` (the pairs where `strikeExplains`
  can fire at all), `suppressed` is the subset where it did.
- `TickProcessorResult` gains `strikeSuppressedProposals?: { suppressed: number; eligible: number }`,
  documented like its neighbours as calibration instrumentation — never broadcast, never persisted — and
  `TickInstrumentation`'s `Pick` gains the same key.
- `runner.ts` accumulates both totals across the run; the harness results expose the **rate per eligible
  pair**, per the spec's hazard-6 row (the raw count grows with the galaxy: 582 settled systems at
  equilibrium against 253 at startup).
- `scripts/simulate.ts` prints the rate with its denominator.

Proves:
- A striking world with capacity in a good increments both counters; a striking world with no capacity
  in that good increments neither — a capacity-0 pair can never fire `strikeExplains`, so it is not an
  eligible pair, and counting it as suppressed would invert the reading (the capacity-gap term is
  unconditional by authored design, `:314-318`).
- A calm world increments the denominator and not the numerator, so the rate is 0 rather than undefined
  on a healthy galaxy.
- The counter counts pairs the planner actually assessed, not systems — a world short in five goods is
  five pairs.
- The totals reach the harness through `runWorldTick().instrumentation` and appear in no broadcast, save
  or world field.
- A run with no construction cycle due reports a zero denominator rather than dividing by it.

Consumes: nothing.

#### Task A5 — net population growth per world cohort

Files:
- `lib/tick-harness/cohort-analysis.ts`, `lib/tick-harness/types.ts` (existing)
- `lib/tick-harness/runner.ts` (existing — `populationSnapshots` accumulation `:287-293`)
- `scripts/simulate.ts` (existing — cohort table)
- `lib/tick-harness/__tests__/cohort-analysis.test.ts`, `lib/tick-harness/__tests__/runner.test.ts`
  (existing — the tick-0 capture is runner wiring and is pinned there)

Interface:
- `computeWorldCohorts(...)` takes an additional `startPopulationBySystem: ReadonlyMap<string, number>` —
  the run's population at **true tick 0, captured before the loop** (as `initialPopulationTotal` already
  is), never the first periodic snapshot: the periodic cadence starts at `SNAPSHOT_INTERVAL`, and a
  tick-50 start map counts every colony founded in ticks 1–49 as "present at start".
- `WorldCohortEntry` gains `netGrowthPct: number | null` — null only for the defensive empty-start-map
  path ("could not measure" and "measured flat" never share a value; the `meanOpeningProvision`
  precedent). Membership is end-of-run (a system is in the cohort
  it finished in); a system absent from the start map counts as starting at 0, so a cohort's growth
  includes colonies founded during the run. Both choices are stated in the field's docstring because
  they are what the number means — founding rate is already the spec's named confounder for this
  metric, and cohort membership drifts as worlds grow through the pop bands.

Proves:
- A cohort whose systems all held population at the start and the end reports the arithmetic the
  galaxy-wide `growthPct` (`population-analysis.ts:171`) reports for the whole galaxy — the two must
  agree when the cohort is everything.
- A colony founded mid-run counts its whole population as growth in the cohort it ends in, not as a
  divide-by-zero.
- A cohort that lost population reports a negative percentage rather than clamping at 0 — net decline is
  the reading this metric exists to catch.
- Overlapping cohorts each carry their own denominator: a system counted in a pop band and in `colony`
  contributes to both without double-counting inside either.
- The start map is the true tick-0 population: a run shorter than one snapshot interval still measures
  growth (the tick-0 capture does not depend on the periodic snapshot cadence), and an empty start map
  reports null rather than an unmeasured 0.

Consumes: nothing.

---

### Gate 1 — measurement

**Arms:** one. This is a baseline, not an A/B — the fold is untouched, so there is nothing to compare
against yet. `npm run simulate` at both horizons (1000 ticks / 41 cycles and 10,000 ticks / 416 cycles),
seed 42, 600 systems, economy scale 100 — the run the spec's evidence table was taken from.

**Reads,** every one cohorted (homeworld / colony, pop bands, survival-short) and at both horizons:
- Provision distribution — mean, p10, p50, p90 (A2).
- Per-world worst-demanded-good satisfaction distribution, with each reading's demand share and
  necessity (A2).
- The founding cohort's opening Provision, mean and p10 (A3).
- Today's three-band distribution, mean unrest and its dispersion, and strike share **by pop cohort**,
  never galaxy-wide (`docs/active/gameplay/colonisation.md:673-675` states why).
- Galaxy-wide and cohorted net growth (A5).
- Proposals suppressed by `strikeExplains` per eligible pair (A4).

**Merge condition** — Stage B does not start until each of these is a number or a written decision, in
`docs/planned/supply-response.md`, next to the measurement it came from:

1. **DECIDED: `SUPPLIED_PROVISION` = 0.90, `RATIONING_PROVISION` = 0.70.** *(Amended at Gate 1: the
   band was re-specced from worst-good to Provision-binned — the measured worst-good distribution is
   a cliff and a worst-good label marks the young galaxy distressed while unrest sits at its floor.)*
2. **DECIDED: `BAND_MIN_DEMAND_SHARE` = 0.01**, for **override** eligibility only (the band has no
   floor — it inherits Provision's weighting). Authored as a rule — below 1% of a basket is a trace
   entry — with the measurement as confirmation; docstring carries the rule and the re-check note
   (spec, override section).
3. ~~The necessity floor on band eligibility~~ **Dissolved at Gate 1** with the worst-good band rule:
   the override's `necessity × demand share` weighting performs the filtering the floor existed for.
4. **DECIDED: `CRITICAL_SATISFACTION` = 0.25** — a rule ("under a quarter met"), not a fit: the cliff
   distribution makes every value in (0, 0.5) equivalent today, so the value binds only on future
   partial states. *(The composition rule is no longer open — written into the spec at Gate 1: ramp +
   `criticalWeight × (slopeShortage − slopeRationing)` capped at `slopeShortage`; the override never
   touches the band; survival step fires alone when both apply.)*
5. **DECIDED: `D_SHORTAGE_CUT` = 0.65, `D_SHORTAGE_BLEND` = 0.25, `slopeRationing` = 0.95,
   `slopeShortage` = 2.4** *(amended at B3 from 2.1: the restated guarantee suite exposed that food —
   the weaker survival share, ~0.32 — didn't clear the collapse line at 2.1; owner kept the
   both-goods guarantee and moved the value: slope × 0.32 ≥ 0.75, 2.4 the smallest 0.1-step value
   with real margin)**.** The founding invariant is read at the **founding-realistic floor** (0.02,
   frontier default tax, no crowding — the worst tax-and-crowding pairing collides with the strike
   guarantee: p10 shortfall 0.59 at floor 0.23 caps the slope at 0.71 < 0.84) giving ceiling 1.07;
   the shipped strike guarantee (`band-constants.test.ts:205-210`) bounds from below at 0.84. The
   invariant is **interim scaffolding** — it dissolves at item 3 (adaptive expectation) and the
   slope's docstring says so. Collapse containment is re-authored: **Supplied and Strained worlds
   never collapse; collapse is possible only in the Rationing and Shortage bands** (spec, guarantees
   table — an earlier draft misnamed the protected zone "the Shortage band's exterior / Rationing or
   better"; the 0.70–0.90 band is Strained) — the "shortfall ≤ 0.5 never collapses" variant is false
   under the override and must not be used.
6. **DECIDED: single relaxation rate `decay` = 0.06.** Decided on tick tempo, not the spec's
   recovery-time argument (270 ticks ≈ under a minute of fast-mode wall clock — both candidates are
   "watchable"); 0.06 is today's non-Supplied rate, so the only behavioural delta is Supplied worlds
   losing the 2× recovery branch.
7. **DECIDED: `growthRate` / `declineRate` stay 0.015 / 0.015.** The feared re-scale was
   disconfirmed on cliff data (growth factor 0.967 → 0.966); the slope re-cut eases decline pressure.
   Gate 2 verifies via end-population per cohort across arms, 12k checkpoint included.
8. **DECIDED: the two lines stay apart, with the reason stated in code.** The chip's 0.95 answers
   "is this good fully served" (per-good attention); the band's 0.90 answers "is anything wrong here"
   (world-mean label); they disagree on ~6 of 582 worlds on cliff data. The chip's line becomes a
   named UI constant with a question-stating docstring; B6 imports nothing from the band; and
   `buildProblems`' **industry input gate** (`components/system/needs-view.ts:37-41`) keeps today's
   thresholds untouched — a different quantity from a pop need (Self-review 2).

A constant sized from the Jensen bound instead of the measurement is exactly what this gate exists to
prevent.

---

### Stage B — the swap

All Stage B tasks are **one atomic unit for measurement purposes**: between B2 and B3 the branch is
knowingly mis-scaled, and no sim reading is meaningful until B5 lands. They are sequential check-in
pauses on one branch, not separate PRs.

#### Task B1 — collapse the relaxation branch to one rate

Files:
- `lib/engine/population.ts` (existing — `UnrestParams` `:117-128`, `accumulateUnrest` `:171-182`,
  module docstring `:9-15`)
- `lib/constants/population.ts` (existing — `UNREST_PARAMS` `:27-32`, docstring sentence `:10-11`)
- `lib/tick/processors/population.ts` (existing — pre-scaling `:36-40`)
- `lib/engine/__tests__/population.test.ts`, `lib/tick/processors/__tests__/population.test.ts`
  (fixtures at `:25`, `:37`, `:43`), `lib/world/__tests__/tick.test.ts` (the geometric-drain integration
  test `:859-914`)

Interface:
- `UnrestParams` loses `recoveryDecay`. `decay` survives as the single rate and takes Gate 1's value
  (0.06 — decided; see the merge-condition list).
- `accumulateUnrest(unrest, d, floor, supply, params)` keeps its signature but stops reading
  `supply.regime` — after this task the label selects nothing, which is the spec's load-bearing
  demotion. `supply` still carries the survival bit (and, after B4, the critical weight).
- The processor's `scaledUnrest` scales `decay` alone.
- The docstring sentence "Supplied recovers twice as fast as either regime accumulates" is deleted from
  both places that assert it.

Proves:
- Unrest relaxes at the same rate whatever the label — a fixture that changes only `regime` must produce
  an identical trajectory. This is the only test that catches a leftover regime read.
- The settled level is unchanged by the rate: the fixed point stays `floor + slope × shortfall`, which
  is what makes the rate choice a recovery-speed decision and not a balance one.
- Catch-up invariance still holds with one scaled rate — one full step and two half steps agree to the
  residue the existing invariance fixture allows.
- A system at the floor with no shortfall stays exactly at the floor; a large catch-up factor cannot
  flip the relaxation term and overshoot below it.
- The re-authored drain test fails if relaxation snaps to the floor, or runs at a second rate for any
  label — it asserts the geometric law, not the old constant.

Consumes: nothing. Ordered first in Stage B so the union widening in B4 never has to handle a
four-member label inside a rate branch.

#### Task B2 — un-square the fold and its display twin

Files:
- `lib/engine/population.ts` (existing — `dissatisfaction` `:57-68`, module docstring `:5-8`)
- `lib/engine/pop-needs.ts` (existing — `pressure` `:71`, docstrings `:9-11` and `:25`)
- `lib/tick/types.ts` (existing — the `dissatisfactionBySystem` docstring `:53` still says "convex")
- `lib/engine/__tests__/population.test.ts`, `lib/engine/__tests__/pop-needs.test.ts`,
  `lib/tick/processors/__tests__/economy.test.ts` (D-magnitude assertions around `:243-330`, `:819-830`)

Interface:
- `dissatisfaction(goods)` returns the complement of `provision(goods)` — one implementation, two names,
  so the two cannot drift. Signature, callers and return range unchanged; only the scale moves.
- `PopNeed.pressure` moves to the un-squared shape in lockstep, with both docstrings restated. The field
  name, type and sort contract are unchanged.
- No processor, service or component signature changes in this task.

Proves:
- The fold and `provision()` are exact complements on every basket including the empty one — a
  re-implemented sum is how the display and the sim drift, which is the thing `pop-needs.ts:9-11` exists
  to prevent.
- An ordinary partial shortfall now reads its own size rather than its square: the spec's compression
  table (a 17% uniform shortfall folded to 0.029) must read ~0.17. A test built on gap-1 goods cannot
  see this change at all, so the detection has to be on a partial basket.
- `pressure`'s ranking inverts for the case that motivated the coupling — a high-weight, high-volume
  shallow gap now outranks a deep gap in a negligible good, where the squared shape ranked them the
  other way.
- `pressure` still sums to the fold over the same basket.
- An economy-processor assertion that pinned a squared D magnitude fails until it is restated — a test
  suite that stays green through this change is the spec's stated hazard, not reassurance.
- The empty basket still returns a finite number on both sides; nothing here can put NaN into a signal
  the world serializes.

Consumes: A1.

#### Task B3 — re-cut the constants and restate the guarantees on partial baskets

Files:
- `lib/constants/economy.ts` (existing — `D_SHORTAGE_CUT` `:90-99`, `D_SHORTAGE_BLEND` `:101-109`)
- `lib/constants/population.ts` (existing — `UNREST_PARAMS` `:5-32`, `POPULATION_PARAMS` `:50-67`)
- `lib/constants/__tests__/band-constants.test.ts` (existing — `dFor` `:139-144`, `settled` `:146-149`,
  containment suite `:170-255`)

Interface:
- Values only, all of them Gate 1's decided numbers: `D_SHORTAGE_CUT` 0.65, `D_SHORTAGE_BLEND` 0.25,
  `UNREST_PARAMS.slopeRationing` 0.95, `UNREST_PARAMS.slopeShortage` 2.4 (amended at B3 — see the
  merge-condition list), `UNREST_PARAMS.decay` 0.06, `POPULATION_PARAMS.growthRate` / `declineRate`
  unchanged at 0.015. No name, type or reader changes.
- Docstrings re-authored, not nudged: `D_SHORTAGE_CUT`'s cited anchors (≈0.14 ambient, ≈0.37 water) are
  gap-1 values and carry no information about the new scale; `UNREST_PARAMS`' "it exceeds 1 because D
  itself is small" premise is exactly what this change invalidates; `POPULATION_PARAMS`' symmetry
  argument is stated in the squared fold's magnitudes.
- The test module gains a **partial-satisfaction basket** builder alongside `dFor()`, which stays only
  where a gap-1 scenario is the scenario actually meant (a total water failure). The founding invariant
  is expressed with the spec's own `maxSlope = (strikeThreshold − maxFloor) / foundingShortfall` against
  Gate 1's measured founding shortfall. The event scenario enters the containment set: a system-wide
  `production_rate × 0.05` for whole cycles (`lib/constants/events.ts`), per the spec's hazard-3 events
  row.

Proves:
- A partial-satisfaction basket distinguishes the two folds — the suite must fail if the fold is
  reverted to squared. The shipped suite's blind spot is that every `dFor()` scenario is identical under
  both folds.
- The founding cohort at its measured p10 shortfall (0.59) settles strictly below the strike threshold
  at the **founding-realistic floor** (frontier default tax 0.02, no crowding — the floor a newborn can
  actually occupy; the worst-floor pairing is measured as unsatisfiable and is not the assertion), and
  the assertion fails when `slopeRationing` is raised past the 1.07 ceiling.
- The two sides bound `slopeRationing` from opposite ends and both must hold simultaneously: a broad
  Shortage-band shortfall (d = 0.5) at the worst tax-and-crowding floor still strikes below collapse on
  the base ramp (bounds from below at 0.84), while the founding invariant bounds from above at 1.07. A
  value that satisfies one and breaks the other must fail.
- **Collapse never touches a Supplied or Strained world** (the Gate 1 re-authoring, band names since
  corrected): a world without famine at Provision ≥ `RATIONING_PROVISION` — banded Strained or
  better — stays below the 0.75 collapse line at any tax, any crowding, and
  the maximum override composition the structure permits — the worst case sits at the band edge
  (`0.23 + (0.95 + (0.30/0.75) × 1.45) × 0.30 = 0.689`). The assertion computes the override worst case
  from the constants rather than hardcoding the result, so it recomputes if a bin edge or slope moves. Do
  not assert the gate report's "shortfall ≤ 0.5 never collapses" variant — it is false under the
  override.
- A total water or food failure still collapses at zero tax and still drives net decline at every tax
  level, with both sides of the decline comparison re-derived — that comparison holds `settled(d, floor)`
  against `1 − d` and both sides move on the new scale.
- No non-survival good alone reaches the strike threshold at any tax — a tighter bound now, since one
  good's contribution rose from `share × gap²` to `share × gap`.
- A transient event multiplier applied to a Rationing world does not carry settled unrest through the
  0.75 collapse threshold, where `collapseDebt` accrues and levels in use tear down permanently while
  the event expires.

Consumes: B2 (the new scale), Gate 1 (every value).

#### Task B4 — four descriptive bands and the critical-good override

Files:
- `lib/engine/population.ts` (existing — `SupplyRegime` `:71`, `SupplyState` `:73-84`,
  `hasSurvivalShortfall` `:86-97`, `foldSupplyState` `:99-115`, `unrestSlope` `:130-148`)
- `lib/constants/economy.ts` (existing — new constants beside `SHORTAGE_SATISFACTION` `:82-88`)
- `lib/tick/processors/economy.ts` (existing — the fold call `:244-249`)
- `lib/tick/types.ts` (existing — `supplyStateBySystem` docstring `:55-57`)
- `lib/engine/directed-build.ts` (existing — `fed()`'s docstring `:141-144` asserts `foldSupplyState`
  labels a system Shortage on D alone, which stops being true here)
- `lib/engine/__tests__/population.test.ts` (existing — `foldSupplyState` suite `:72-119`),
  `lib/tick/processors/__tests__/economy.test.ts` (existing — regime helpers `:342-347`)

Interface:
- `SupplyRegime = "supplied" | "strained" | "rationing" | "shortage"`.
- `SupplyState` keeps `survivalShortfall` (still not inferrable from the label) and gains
  `criticalWeight: number` — the summed `necessity × demand share` of demanded goods below the
  criticality line and above the demand-share floor. This is the quantity the override contributes to
  the slope side; carrying it on the state is what keeps `unrestSlope` the one place severity composes.
- `foldSupplyState(goods: GoodSatisfaction[]): SupplyState` — **the `d` parameter is dropped**. The
  band is **binned from `provision(goods)`** (one implementation — the fold calls `provision()`, so
  the bin and the number cannot drift); the survival floor promotes to Shortage; `criticalWeight` is
  carried on the state but **never changes the band** (measured and rejected at Gate 1 — the spec's
  override section records why). Callers drop the second argument:
  `lib/tick/processors/economy.ts:248`, `lib/tick-harness/population-analysis.ts:274`, and the test
  suites.
- `unrestSlope(d: number, supply: SupplyState, params: UnrestParams): number` — takes the state rather
  than the bare survival bit, so the D-ramp, the survival step and the override compose in one function
  per the spec's composition rule (ramp + `criticalWeight × (slopeShortage − slopeRationing)`, capped
  at `slopeShortage`; survival step unchanged and firing alone when both apply).
- New constants in `lib/constants/economy.ts`, each with its own docstring stating what it is and what
  it is not: `SUPPLIED_PROVISION` = 0.90 and `RATIONING_PROVISION` = 0.70 (the two Provision bin
  edges — legibility constants; no gameplay reader), `CRITICAL_SATISFACTION` = 0.25 (the criticality
  line — deliberately its own constant, so the famine line and the criticality line move
  independently; docstring carries the "under a quarter met" rule), and `BAND_MIN_DEMAND_SHARE` = 0.01
  (**override eligibility only** — there is no band-level floor; the bin inherits Provision's own
  weighting, and the necessity-floor variant is dissolved with the worst-good band rule; docstring
  carries the "below 1% is a trace entry" rule and the high-necessity-trace-share re-check note).
- `SHORTAGE_SATISFACTION` keeps both existing consumers unchanged — `hasSurvivalShortfall` and `fed()`.

Proves:
- The bin and `provision()` cannot disagree: a fixture whose Provision sits in each bin lands in that
  band, and a re-implemented mean inside the fold (rather than a `provision()` call) is the drift this
  entry exists to catch.
- Both bin edges are inclusive on the side their docstrings state — a world exactly at an edge lands
  where the constant says, not one band either way.
- A survival good below the survival line bands Shortage whatever Provision says; a non-survival good
  at the identical satisfaction does not.
- A world whose only shortfall is an epsilon-demand good below the criticality line bands by its
  Provision alone and contributes no override weight — the demand-share floor's whole reason to exist.
- An eligible good below the criticality line on a high-Provision world leaves the band exactly where
  Provision bins it — the override never changes the label — while `criticalWeight` is proportional
  to `necessity × demand share` and exactly zero for every good above the criticality line.
- `unrestSlope` composes per the rule: the override raises the effective slope by
  `criticalWeight × (slopeShortage − slopeRationing)` capped at `slopeShortage`, and a world with both
  the survival step and override weight gets the survival step alone.
- An empty basket bands Supplied with zero critical weight and no division by zero: this is what an
  emptying world reads, and the spec records that it changes sign from a permanent worst reading to a
  permanent perfect one.

Consumes: B1 (the label selects no rate), B3 (constants), Gate 1 (bin edges, floor, criticality line;
the composition rule is in the spec — amended at Gate 1).

#### Task B5 — widen the harness to four bands and re-label the D-unit readouts

Files:
- `lib/tick-harness/population-analysis.ts` (existing — `SupplyRegimeSummary` `:234-244`, the three-way
  fold `:286-292`)
- `lib/tick-harness/cohort-analysis.ts` (existing — the three-way fold `:279-281`, entry build `:290-299`)
- `lib/tick-harness/types.ts` (existing — `WorldCohortEntry` `:133-143`)
- `lib/tick-harness/build-analysis.ts` (existing — `openingDissatisfaction` `:228`, summary `:292`)
- `scripts/simulate.ts` (existing — three-row regime table `:396-405`, the `mean D` line `:406-407`, the
  cohort table's `Sup/Rat/Sho %` column `:417` and `:425-427`, the founding line `:509`)
- `lib/tick-harness/__tests__/population-analysis.test.ts` (share-sum assertion `:221`, D-cut assertions
  `:235-249`), `lib/tick-harness/__tests__/cohort-analysis.test.ts`,
  `lib/tick-harness/__tests__/experiment.test.ts` (results fixture `:250-255`)

Interface:
- `SupplyRegimeSummary` and `WorldCohortEntry` gain `strained` / `strainedShare`; **both catch-all `else`
  arms become exhaustive over the four members**, so an unhandled member is a type error rather than a
  silent Shortage.
- `meanDissatisfaction` is renamed to the shortfall it now holds on both types and in both tables.
  Leaving a D-named field carrying a Provision-scale number is precisely the re-baselining misread the
  spec warns about.
- The three-row regime table and the cohort table's three-way share column both become four-way.
- `openingDissatisfaction` and its summary mean are re-labelled on the new scale, beside A3's Provision
  reading.

Proves:
- A Strained world is counted as Strained — the spec's named defect is that a fourth member silently
  counts as Shortage in the very instrument each step is measured with, and this must fail if the fold
  is widened without the harness.
- The four shares sum to 1 on every row, and each row's denominator is its own n.
- The galaxy-wide summary and the cohorted split still fold the same per-system map — a Strained count
  that differs between the two tables means one of the folds was missed.
- A cohort with no members is still omitted rather than emitting a zero-denominator row.
- Every readout that changed scale changed label with it: a Provision-scale number under a D label is
  the trap, and the test that catches it asserts on the reported field's name, not just its value.

Consumes: A2, A3, B4.

#### Task B6 — UI: the reordering's readers and the severity reconciliation

Files:
- `components/system/needs-view.ts` (existing — `needSeverity` `:4-8`, `splitNeedsLedger` `:21-26`,
  `buildProblems` `:31-48`)
- `components/system/__tests__/needs-view.test.ts` (existing)
- `components/system/industry-panel.tsx` (existing — `:449`, the top-2 comment and filter `:873-874`,
  the glyph `:911`)
- `components/system/needs-table.tsx` (existing — `:33`)
- `components/system/population-panel.tsx` (existing — tooltip severity `:25`, ledger `:63-65`)

Interface:
- **Decided at Gate 1: the lines stay apart, with the reason stated in code.** `needSeverity`'s 0.95
  "met" line becomes a named UI constant whose docstring states the question it answers ("is this
  particular good fully served" — a per-good attention line, not the band's world-mean "is anything
  wrong here" at 0.90; the two disagree on ~6 of 582 worlds on cliff data, and that disagreement is
  correct). The "critical" line imports `SHORTAGE_SATISFACTION`. Nothing imports the band edges. The
  signature is unchanged, so all four reader modules inherit the decision through one function.
- The industry panel's comment at `:873` asserting what the pressure sort means is restated for the
  un-squared shape; no sort logic moves (the ordering is `computePopNeeds`').
- **No new Provision surface.** No world-level supply reading reaches the client today (see Not covered).

Proves:
- The "met" line moves when the imported constant moves — a constant change that leaves the ledger split
  where it was is exactly the accidental divergence this task closes.
- The industry input-gate reading in `buildProblems` moves with the same change: it applies the same
  function to a *different quantity*, and Gate 1's decision is what says whether that is intended.
- The ledger's collapsed "met" tail and the industry panel's top-2 agree on the same satisfaction — two
  surfaces disagreeing about whether a need is met is the visible symptom.
- The top-2 are the two highest-*pressure* unmet needs under the new ordering, not the two deepest gaps.
- A need exactly at the "met" boundary lands on the documented side in every one of the four readers.

Consumes: B2, B4, Gate 1.

---

### Gate 2 — the step-1 gate

**Arms:** the post-swap run against the Stage A baseline, both horizons, seed 42, 600 systems. Compare
**properties**, not stored numbers: `meanDissatisfaction` changed meaning at the same galaxy state, so
no `experiments/*.json` from before the swap is a valid comparison, and neither is any figure in the
spec's evidence table.

**Reads,** cohorted, at both horizons:
- Four-band distribution.
- Provision distribution (mean, p10, p90).
- Mean unrest and its dispersion.
- Strike share **by pop cohort**, never galaxy-wide.
- Galaxy-wide and cohorted net growth.
- Proposals suppressed by `strikeExplains` per eligible pair.

**Merge condition:**
- No NaN or Infinity anywhere in the world or the report. The fold divides by a different denominator
  now, and a non-finite value serializes to `null` and corrupts the save.
- Net growth stays positive galaxy-wide at both horizons, and no pop cohort that was growing flips to
  net decline. The spec's whole reason for re-cutting the growth rates is that the un-squared factor
  otherwise applies the intended break in the growth/decline cancellation galaxy-wide, including to the
  viable-but-stuck cohort a later item is meant to rescue.
- Strike share does not rise materially in any pop cohort against the baseline; the pop ≥ 1K cohort
  stays at or below its baseline.
- The mislabelling the roadmap row names is gone: the pop ≥ 1K cohort's Rationing share falls sharply
  and homeworlds stay 100% Supplied.
- `strikeExplains`-suppressed proposals per eligible pair does not rise materially — the spec accepts a
  narrowing of the planner's exit from the strike loop, and this is the number that says how much.
- Every accepted deviation is written down with the horizon and the cohort it was measured at. A
  "ruled out" carries the same evidence bar as a finding.
- **Booked at this gate:** whether item 2 (the change term) is still wanted after the re-scale — the
  spec's own "restoring the score's range may be sufficient on its own" is a claim this gate's data can
  settle, and item 2 should not start before it does.

---

## Verification

Proven in the galaxy, not in fixtures:

- `npm run simulate` at **both horizons**, cohorted, before Stage B (Gate 1) and after it (Gate 2).
  Startup answers founding and provisioning questions; equilibrium is the only valid basis for tuning a
  constant. Neither is quoted at the other's question.
- **Metrics that move:** the four-band distribution, mean and dispersion of unrest, strike share by pop
  cohort, galaxy-wide and cohorted net growth, and `strikeExplains` suppression per eligible pair.
- **New harness metrics, because the symptom hides inside the existing aggregates:** the Provision
  distribution (A2), the per-world worst-demanded-good distribution with demand share and necessity (A2),
  the founding cohort's opening Provision (A3), the `strikeExplains` suppression rate (A4) and cohorted
  net growth (A5). Every one exists before the fold moves — an instrument built after the swap has
  nothing to compare against.
- **Build gate:** `npx next build --webpack` (not `npm run build`).
- **Unit tests:** `npx vitest run`. Every new or changed test is seen red once — break the listed
  behaviour, watch the named test fail, restore — which is what the `Proves` lists above are for.
- **Mutation:** scoped `npm run mutation` on the changed `lib/` files rides the next periodic overnight
  batch, not an in-session gate.
- Sim readings between B1 and B5 are meaningless; do not gate on them.

## Doc fold

On the branch, before the final review.

- `docs/planned/supply-response.md` — **not deleted.** Items 2-5 are unbuilt, so the planned doc stays,
  reduced to those items plus the worksheet rows they still need. Item 1's shipped mechanics move into
  active docs (below), and the "Where the galaxy stands" numbers are replaced by Gate 2's, in the new
  units, with their horizons and cohorts named.
- `docs/active/gameplay/economy.md:220` — the unrest paragraph still describes a convex, demand-weighted
  D. It becomes the Provision description, the four-band table and the survival/criticality overrides.
  This is the receiving doc; a separate active doc is not warranted for a mechanic already documented
  here. **Coordinate with the PR6 fold**, which already owns promoting
  `docs/planned/necessity-weighted-unrest.md` into active — the two must not both write this section.
- `docs/active/gameplay/economy-equilibrium-rework.md:20` — "equilibrium unrest ≈ dissatisfaction" and
  its quoted floors are on the old scale.
- `docs/active/gameplay/economy-infrastructure-decay.md:55` — the consequence-spine diagram's D arrow.
- `docs/active/gameplay/economy-autonomic-agency.md:231` — "fed and calm (`dissatisfaction ≤ D_settle`)".
- `docs/active/gameplay/colonisation.md:673-675` — names the **colony rationing share** as an
  endowment-responsive gate read; four bands split that share, so the named read changes meaning.
- `docs/active/engineering/tick-engine.md:34` and `docs/SPEC.md` (§Tick Engine's economy→population
  handoff, and the economy/population summary lines) — the D handoff wording.
- `docs/ROADMAP.md` row 6 — item 1's line retires from the five-item list; the row stays for items 2-5.
- **This working file is deleted when item 1 ships**, after the fold above runs.

## Not covered

- **Items 2-5** — the change term, the adaptive expectation, abandonment, relief. **Booked:** the spec's
  own Sequence section and `docs/ROADMAP.md` row 6, which names all five and their gating primitives.
- **The Provision bin edges, the override's demand-share floor, the criticality line, the single
  relaxation rate, and each re-cut constant's value.** **Booked at Gate 1**, merge conditions 1-7. The
  spec deliberately leaves these to the measurement; a plan that chose them would be tuning constants
  the evidence does not license.
- **The necessity-floor variant on band eligibility.** **Dissolved at Gate 1** (condition 3): the band
  was re-specced to bin from Provision, and the override's weighting performs the floor's filtering.
- **The critical-good override's composition rule.** **Resolved at Gate 1** (condition 4): written
  into the spec's override section; B4's interface carries it.
- **The `needSeverity` reconciliation's effect on the industry input gate.** **Booked at Gate 1**,
  condition 8.
- **A world-level Provision display** — population-tab row, vital tile and map value mode. **Booked:**
  its own roadmap row under UI, gated on this item shipping and on the design pass (three surfaces, one
  a map mode). No world-level supply reading reaches the client today — nothing under `components/`,
  `lib/services/` or `lib/types/api.ts` reads `SupplyState`, `SupplyRegime` or the fold — so item 1
  ships no player-visible score; the spec's tooltip wording rides in the roadmap row.
- **`strikeExplains` itself, and `STRIKE_PARAMS.threshold` / `INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold`.**
  **Dropped:** the spec states they are not re-cut — unrest stays a [0,1] state and only how many worlds
  reach the thresholds moves, which is the slopes' job.
- **`fed()`, `TARGET_COVER` and the cover constants, the ration threshold, demand, pricing geometry,
  logistics matching, planner capacity sizing, infrastructure decay.** **Dropped:** the spec's "What this
  does not change".
- **Stored `experiments/*.json` baselines.** **Dropped, not migrated:** every D-unit field in them is
  non-comparable across the swap. Both gates take fresh runs.
- **A save-format bump.** **Dropped:** item 1 derives Provision from the already-persisted per-good
  `WorldMarket.satisfaction` and keeps the band in the transient signal. Item 2 is where
  `priorProvision?` lands.
- **The in-session mutation sweep.** **Booked** to the periodic overnight batch per AGENTS.md; the
  red-proof of each `Proves` list is the synchronous gate.

## Self-review

Performed by the author against the checklist. What it found:

1. **Citations.** Every `file:line` in this plan was verified by reading the range, not by grepping the
   name. The spec's own citations check out, including the two that look like near-misses:
   `population-analysis.ts:258-266` names the setup lines inside `perSystemSupplyState` (`:257-277`), and
   `:286-292` is the three-way fold loop.
2. **`needSeverity` has four reader modules, not two.** `npm run impact -- needSeverity` returns 13
   references across `needs-view`, `industry-panel`, `needs-table` and `population-panel` — and one of
   them, `buildProblems` (`needs-view.ts:37-41`), applies it to an **industry input gate**, not a pop
   need. The spec's UI paragraph names only the definition site, so moving the 0.95 line silently moves
   an unrelated quantity. Added to Gate 1's merge condition (8) rather than decided here.
3. **The critical-good override is under-specified.** The spec gives its ingredients ("contributes in
   proportion to `necessity × demand share`", "promotes the unrest slope and the descriptive band") but
   not the composition rule with the D-ramp and the survival step — and its band claim has nowhere to
   land, since the four-band table reserves Shortage for survival goods. Routed to Gate 1 condition 4 as
   spec scope; B4's interface names the carrier field and stops there.
4. **A shipped guarantee is missing from the spec's restatement table.**
   `band-constants.test.ts:205-210` asserts that worst-case sustained Rationing still *strikes* while
   staying below collapse. It bounds `slopeRationing × D_SHORTAGE_CUT` from below, while the spec's new
   founding invariant bounds `slopeRationing × foundingShortfall` from above — the two are jointly
   satisfiable only if the re-cut cut sits above the measured founding shortfall, which is not
   guaranteed and is not stated anywhere. Added to Gate 1's condition 5 and to B3's detection list; the
   missing row belongs in the spec's table.
5. **Two D-unit readouts the spec's step-1 table does not list.** `openingDissatisfaction`
   (`build-analysis.ts:228`) and its report line (`simulate.ts:509`) change meaning at the swap. Folded
   into A3 and B5.
6. **A third three-way band rendering.** Beyond the two harness folds and the regime table the spec
   names, the cohort table carries its own `Sup/Rat/Sho %` column (`simulate.ts:417`, `:425-427`). Added
   to B5.
7. **New identifiers do not collide.** `provision`, `SUPPLIED_SATISFACTION`, `CRITICAL_SATISFACTION`,
   `BAND_MIN_DEMAND_SHARE`, `BAND_MIN_NECESSITY`, `worstDemandedGoods`, `netGrowthPct`,
   `strikeSuppressedProposals` — none exist under `lib/`, `components/` or `scripts/`.
8. **Detection lists read back against their own interfaces.** That pass added A1's empty-basket arm
   (the value is load-bearing in three places and reads "perfect" for an emptying world), B4's
   boundary-strictness entry across all three lines, and B5's "changed scale changed label" entry.
9. **No code.** Signatures, types and field names only. The two formulas quoted — the founding
   invariant's `maxSlope` and the unrest fixed point — are the spec's own, carried verbatim.
