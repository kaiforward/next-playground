# Supply Response — Make the Score Readable, Then Let It Drive

## Headline

A world's supply state is folded into one number that drives unrest, population growth and the
per-good display ranking. That number is a weighted mean of **squared** shortfalls, and squaring is
what makes it unauthorable: an ordinary partial shortfall compresses about fivefold on its way into
the score, so nobody — designer or player — can think in the units the thresholds are written in. The
constants that consume it are not obviously wrong; they are simply cut in a scale no one can read.

The fix is one measure, one demotion, and — separately sequenced — one resolution:

- **The score becomes Provision.** A weighted mean of satisfaction instead of a weighted mean of
  squared gaps. It spans a usable range by construction and can be authored against in the units a
  designer actually thinks in. Every constant cut against the old scale is re-cut in the same change,
  because the same quantity feeds four different systems.
- **Bands stop gating anything.** Supplied / Strained / Rationing / Shortage become description. No
  gameplay effect keys off which band a world is in; effects scale off the continuous quantity. Where
  the boundaries sit becomes a legibility choice rather than a balance risk.
- **Permanently struck worlds resolve.** A world that can physically recover gets a route back; a
  world that cannot is allowed to fail. Neither exists today, and neither is buildable without a
  primitive the game does not have — so each is its own sequenced item with its prerequisites named,
  not part of the score change.

Severity guarantees do not come from the shape of the curve. They come from explicit overrides — the
survival-good floor already works this way, and famine stays a step change rather than an average.

## Where the galaxy stands

Every figure below is from the headless run of the real tick: 600 systems, seed 42, economy scale
100, read at both horizons — **startup** (1000 ticks / 41 cycles: founding and provisioning
behaviour) and **equilibrium** (10,000 ticks / 416 cycles: the only valid basis for tuning).

| Reading | Startup, all settled (n = 253) | Equilibrium, all settled (n = 582) |
| --- | --- | --- |
| Supplied | 36.0% (91) | 53.4% (311) |
| Rationing | 50.6% (128) | 43.5% (253) |
| Shortage | 13.4% (34) | 3.1% (18) |
| mean D | 0.064 | 0.033 |
| mean unrest | 0.073 | 0.166 |
| striking | 0 (0.0%) | 17 (2.9%) |

Cohorted at equilibrium, the galaxy-wide numbers dissolve into three different galaxies:

| Cohort | n | mean D | unrest | strike% | Sup / Rat / Sho % |
| --- | --- | --- | --- | --- | --- |
| homeworld | 20 | 0.000 | 0.101 | 0.0% | 100 / 0 / 0 |
| colony | 562 | 0.034 | 0.168 | 3.0% | 52 / 45 / 3 |
| pop ≥ 1K | 370 | 0.006 | 0.114 | 0.5% | 76 / 23 / 1 |
| pop 100–1K | 144 | 0.056 | 0.223 | 2.8% | 17 / 79 / 4 |
| pop 10–100 | 68 | 0.132 | 0.329 | 16.2% | 6 / 79 / 15 |
| survival-short (no arable slot) | 176 | 0.094 | 0.279 | 8.5% | 9 / 82 / 9 |

Three facts set the shape of everything below.

**Supply's contribution to unrest shrinks as the galaxy matures while unrest itself grows.** Mean D
falls 0.064 → 0.033 between the horizons; mean unrest *rises* 0.073 → 0.166 and striking worlds go
0 → 17. The rise is standing pressure, not supply: mean occupancy runs 0.831 → 1.110 with 489 of 582
worlds past the crowd brake at equilibrium, and the tax stance contributes a further additive floor
(`TAX_LEVEL_UNREST_PRESSURE`, `lib/constants/treasury.ts:49-55`). Unrest is increasingly tax and
crowding wearing a supply label. This is a maturity trajectory against a fixed bar, not a defect in
the fold — and no re-cut fixes it, which is why the adaptive expectation is on the sequence.

**The founding cohort is the modal world and it is the galaxy's worst-supplied one.** 562 colonies
founded by equilibrium (233 by the startup horizon), 80% of them by t = 1680. Their opening
demand-weighted satisfaction is 0.47 (opening D 0.257) at equilibrium and 0.71 (opening D 0.097) at
startup; 376 of 562 opened below 50% satisfaction. Founding rate is therefore the dominant confounder
for every galaxy-wide reading here: a run that founds faster reads worse with nothing having changed.

**A flawless basket is common, not rare.** The 311 Supplied systems at equilibrium are exactly those
at D = 0. The exact-zero cliff is still the wrong place to put a boundary — but the argument for
moving it is that 43.5% Rationing over worlds like the pop ≥ 1K cohort (mean D 0.006) is
mislabelling, not that perfection is unreachable.

## Why the current model cannot be authored against

**The squaring is doing two jobs and only one of them was wanted.** It was chosen so that severe
shortfalls dominate minor ones, which is correct. But squaring a quantity in [0,1] also compresses
the whole scale toward zero, and that compression is what makes the number unreadable:

| A uniform basket shortfall of | folds to | compression |
| --- | --- | --- |
| 10% | 0.010 | 10× |
| 17% | 0.029 | 5.9× |
| 30% | 0.090 | 3.3× |
| 50% | 0.250 | 2× |
| 100% | 1.000 | 1× |

The compression is worst exactly where the live galaxy sits. It also means the scenario values the
existing thresholds were drawn against cannot tell you which fold they were drawn for: those
scenarios put every named good at satisfaction 0, so gap = 1 and gap² = gap, and the scenario is
scale-invariant. `D_SHORTAGE_CUT`'s own docstring records the anchors — ambient tier-1-and-2 deficit
≈ 0.14, total water failure ≈ 0.37 (`lib/constants/economy.ts:90-98`) — and both are gap-1 numbers.
The authored evidence is silent on the question, so nothing about the current constants can be
inferred from it; they have to be re-derived on whatever scale the fold ends up on.

**Supplied requires perfection.** `foldSupplyState` (`lib/engine/population.ts:110-115`) has three
branches, in order:

1. a demanded survival good below `SHORTAGE_SATISFACTION` → Shortage (`:111-112`);
2. `d ≥ D_SHORTAGE_CUT` → Shortage (`:113`);
3. otherwise `d > 0 ? "rationing" : "supplied"` (`:114`).

Branch 3 is the cliff: Supplied is exactly zero, not approximately. A world must receive every good
it demands, in full, simultaneously.

**The label gates recovery speed only.** `accumulateUnrest` picks the relaxation rate from the label
— `recoveryDecay` when Supplied, `decay` otherwise (`lib/engine/population.ts:178`). The fixed point
is `min(1, floor + slope × d)` for any rate, so the label does not move where unrest settles, only
how fast it gets there. The *slope* is selected from the quantity, not the label: `unrestSlope` ramps
`slopeRationing` → `slopeShortage` across `[D_SHORTAGE_CUT, D_SHORTAGE_CUT + D_SHORTAGE_BLEND]`
(`:142-148`). And `survivalShortfall` rides on `SupplyState` beside the label (`:73-84`) precisely
because it cannot be inferred back from it — a D-driven Shortage and a survival-driven one carry the
same label and must not carry the same slope. So "the band gates nothing" is true of `regime` and
false of `SupplyState`.

## The score becomes Provision

Each good a world demands has a satisfaction in [0,1]. Weight each by its demand share times its
authored necessity — the existing `GOOD_NECESSITY` weighting, unchanged — and take the mean. That is
the world's **Provision**.

`GOOD_NECESSITY` is authored as a suffering weight: *"how much NOT having a good counts as suffering,
in (0,1]"* (`lib/constants/physical-economy.ts:92-93`). Provision is therefore the **necessity-weighted
share of what a world needs**, not a share of tonnage, and the two differ sharply. A world receiving
zero war matériel and zero luxuries reads Provision ≈ 0.97, because those goods carry almost no
suffering weight. The honest reading is *"83% of what it needs, weighted by how badly it needs it"* —
never *"83% of its goods arrived"*.

Read directly:

- 100% — everything demanded arrived in full, or the world demands nothing at all
- 50% — half of what this world needs, weighted by how badly it needs it, is not arriving

**The empty basket reads Provision ≡ 1 and band Supplied.** Σ weight ≤ 0 returns 0 dissatisfaction
today (`lib/engine/population.ts:60`) and there is no worst good to band on. That value is
load-bearing: it also feeds the growth factor, and it is what an emptying world reads on its way out
(see the abandonment item, where it changes the sign of an outlier).

Stored in [0,1] — per-good satisfaction already is (`lib/world/types.ts:261-268`), so the aggregate
needs no conversion anywhere and the displayed percentage is the honest number rather than a
rescaling.

**Deliberately not called "standard of living".** Victoria 3's term measures whether a population can
*afford* its needs; Provision measures whether the goods physically *arrived*. Those are different
quantities, and this codebase's recurring failure is a name or number that looks like it means the
right thing. If pop wealth is modelled later the two become genuinely distinct and both worth having —
a world may hold the wealth and still not have the goods — so the names must not be interchangeable
now.

The quantity the unrest integral and the growth factor consume is its complement, the **shortfall**
(`1 − Provision`), which occupies the role `d` does today.

**What the squaring was protecting, and what replaces it.** Averaging dilutes a severe shortfall in
one good against plenty elsewhere. That protection moves to explicit overrides rather than living in
the curve's shape:

- **The survival floor stays as-is.** Water or food below `SHORTAGE_SATISFACTION` selects Shortage
  outright and promotes the unrest slope, whatever the average says. Famine is never averaged away.
- **A critical-good override extends the same shape** to any good below a *separate* criticality
  line, scaled by that good's necessity and demand share, so a severe medicine gap still bites
  without the whole scale being bent to achieve it.

This is the structure Victoria 3 uses: one continuous scalar, plus targeted overrides where something
must always matter. The scalar stays readable because it is not carrying the severity logic.

### How it reads in the UI

The Provision tooltip states the weighting explicitly ("weighted by how badly it needs it"); the bare
percentage without that qualification is the misreading this design is most likely to create.

The per-good display twin moves with the fold. `computePopNeeds` computes `pressure = share × gap²`
with a docstring pinning it as mirroring the `dissatisfaction()` sum "so display and sim cannot
diverge" (`lib/engine/pop-needs.ts:9-11,25,71`). Un-squaring the sim while pressure stays squared
reorders the ranking — squared favours deep gaps, linear favours high-weight × high-volume — so
pressure moves to the un-squared shape in the same change, with both docstrings updated. Two readers
see the reordering: the industry panel's top-2 unmet needs
(`components/system/industry-panel.tsx:872-874`, which relies on the sort order) and the population
panel's needs ledger (`components/system/population-panel.tsx:63-65`).

The per-good chip already ships a "how short before a player should care" line at 0.95, with the
50% critical line hardcoded rather than imported (`components/system/needs-view.ts:4-8`). The system
band's Supplied boundary and the per-good chip's "met" line must be one imported constant, or the
spec must say why a world-level band tolerates a shortfall the per-good chip flags. They currently
differ by accident, which is the version that is definitely wrong.

## Bands become description

**Four bands, binned from Provision, with one override that punches through the average:**

| Band | Rule |
| --- | --- |
| **Supplied** | Provision at or above the Supplied bin edge |
| **Strained** | Provision between the Rationing and Supplied bin edges |
| **Rationing** | Provision below the Rationing bin edge |
| **Shortage** | a *survival* good below 50%, whatever Provision says |

The band is a coarse rendering of the quantity that actually drives outcomes. Provision feeds the
unrest integral and the growth factor, so a label binned from it can never disagree with what is
happening to the world — and the two cases where a single good genuinely matters despite a healthy
average are exactly the two overrides, which also feed unrest. A label and its consequences move
together by construction.

The alternative — banding on the worst affected good — was measured and rejected. The per-world
worst-good distribution is a cliff: goods arrive in full or not at all (at equilibrium, 311 of 582
settled worlds hold their worst good at exactly 1.0 and 228 at exactly 0.0, with only 43 between).
A worst-good label therefore marks most of the young galaxy distressed — median worst good at
startup is 0.000 — while mean unrest sits at its floor, which is the healthy-galaxy-reads-as-
struggling defect this change exists to remove, rebuilt in a new shape. Specific-good detail is the
per-good table's job (the needs ledger and the industry panel's input gates already show unfulfilled
demand per good); the world label's job is consequence.

`SHORTAGE_SATISFACTION` (50%) and `SURVIVAL_GOODS` keep the famine line exactly as shipped. The two
Provision bin edges are new constants, sized from the measured Provision distribution at Gate 1 —
a legibility choice, not a balance one, since no gameplay effect reads the band.

**There is no necessity floor and no band-level demand floor.** Provision's own weighting
(`goodWeight = demanded × necessity`) already makes negligible demand and negligible necessity
harmless in the bin, and the critical-good override carries its `necessity × demand share` weighting
plus a demand-share floor on eligibility — so the filtering the worst-good rule would have needed
lives naturally inside the two quantities the band is built from.

**No gameplay effect reads the band.** The relaxation-rate switch is removed and the rate becomes a
single value; effects that should vary with supply read Provision or the shortfall. This is the
load-bearing part of the demotion: once nothing is gated, the bin edges can be moved on taste
without a recalibration, and they can never again be the reason a healthy galaxy reads as struggling.

### The critical-good override

The override gets **its own constant**, not `SHORTAGE_SATISFACTION`. That constant's docstring says:
*"Civilian satisfaction (delivered/demanded) below which a demanded good counts as a Shortage rather
than mere Rationing. Its live consumer is the survival-good floor (`foldSupplyState`)"*
(`lib/constants/economy.ts:82-88`). It already has two live consumers — `hasSurvivalShortfall`
(`lib/engine/population.ts:91-97`) and the build planner's `fed()` gate
(`lib/engine/directed-build.ts:146-154`) — and extending it to a third meaning would fuse the famine
line to the criticality line permanently. They must move independently.

**The composition rule.** The override is a per-world weight,
`criticalWeight = Σ necessity × demand share` over demanded goods with satisfaction below
`CRITICAL_SATISFACTION` and demand share at or above `BAND_MIN_DEMAND_SHARE` (the floor's only
remaining home — it exists so a two-pop stub's epsilon-demand medicine cannot fire the override).
It carries on `SupplyState` and composes in `unrestSlope`, the one place severity composes:

- **Slope:** effective slope = the D-ramp's value plus `criticalWeight × (slopeShortage −
  slopeRationing)`, capped at `slopeShortage`. The survival step is unchanged and still promotes to
  `slopeShortage` outright; the cap means the override can approach famine weight but never exceed
  it, and a world with both fires the survival step alone.
- **The override never touches the band.** A binary promotion was measured and rejected at the
  step-1 gate: it would have stamped ~170 healthy-Provision worlds Rationing over median gaps worth
  ~1% of their weighted needs — and a weight `w` below the criticality line forces
  `Provision ≤ 1 − 0.75w`, so every genuinely severe case already bins as Strained or Rationing on
  Provision alone. The label stays a rendering of the health bar; famine (the survival floor) is the
  single punch-through.
- It gates nothing else.

**The authored counter-argument, and the answer.** `fed()`'s docstring argues against exactly this
shape:

> Deliberately the survival test and NOT the whole basket's necessity-weighted fold. Medicine and
> consumer goods are delivered almost nowhere, so every inhabited world carries an ambient basket
> deficit that has nothing to do with feeding anyone; a fold-wide cut therefore refuses shelter over
> a medicine shortage, and refuses it hardest on the small colony whose only route out is the
> workforce that housing would let it hold.
> — `lib/engine/directed-build.ts:133-139`

That argument is about *gating*, and it holds: `fed()` keeps the survival test unchanged, so no
housing is ever refused over a medicine gap, and the two readings stay allowed to disagree exactly as
its docstring says (`:141-144`). The override changes only what unrest responds to and what the band
displays. The ambient-deficit half of the objection is answered by the necessity-and-demand-share
scaling: a good the galaxy delivers almost nowhere but wants in tiny volume contributes in proportion
to its weight, not at survival weight — and the demand-share floor keeps it off the band entirely.
Medicine at necessity 0.8 on a world that genuinely wants it in volume *is* meant to bite; medicine
in a two-pop stub's epsilon basket is not.

## What step 1 changes

Step 1 is the fold, the four descriptive bands, the instrumentation, and the constant re-cuts —
shipped as one change, because the same quantity feeds four systems and re-scaling it without them is
a silent galaxy-wide balance change.

| Primitive | Today (`file:line`) | Under this change |
| --- | --- | --- |
| `dissatisfaction()` | `lib/engine/population.ts:57-68` — Σ share × gap² | Σ share × gap; returns `1 − Provision` |
| `pressure` | `lib/engine/pop-needs.ts:71` (docstring `:9-11,25`) | un-squared in lockstep, docstrings updated |
| `D_SHORTAGE_CUT` = 0.25 | `lib/constants/economy.ts:99` | re-derived in Provision units |
| `D_SHORTAGE_BLEND` = 0.05 | `lib/constants/economy.ts:109` | re-derived in Provision units |
| `slopeRationing` = 1.8, `slopeShortage` = 2.5 | `lib/constants/population.ts:28-29` | re-cut against the new input scale |
| `decay` = 0.06, `recoveryDecay` = 0.12 | `lib/constants/population.ts:30-31` | collapse to one rate, freshly calibrated |
| `growthRate` = 0.015, `declineRate` = 0.015 | `lib/constants/population.ts:62-63` | re-cut to hold galaxy-wide net growth |
| `SupplyRegime` | `lib/engine/population.ts:71` — closed 3-member union | four members; harness folds widened |
| criticality line | does not exist | new constant, distinct from `SHORTAGE_SATISFACTION` |

**Both D constants are re-derived here, never deferred.** `D_SHORTAGE_CUT` has two consumers —
`foldSupplyState` (`lib/engine/population.ts:113`) and `unrestSlope` (`:144-146`) — and `D_SHORTAGE_BLEND`
one (`:144-146`). Its docstring instructs re-derivation rather than nudging when the underlying
scenario arithmetic moves (`lib/constants/economy.ts:94-96`), and swapping the fold moves it. Left
alone, the cut and the ramp start would sit at a fifth of their intended position on the new scale.

**Growth is the fold's second consumer.** `populationDelta` reads the same quantity as the unrest
integral: `growth = growthRate × pop × crowdFactor × clamp(1 − d, 0, 1)`, against
`decline = declineRate × pop × unrest` at equal rates of 0.015 (`lib/engine/population.ts:271-287`).
The processor passes one `d` to both (`lib/tick/processors/population.ts:61,64`) and its comment
records the coupling as authored (`:48-51`). The change is therefore not confined to the unrest
integral: growth reads the new shortfall, and `POPULATION_PARAMS.growthRate`/`declineRate` are re-cut
in the same change to hold galaxy-wide net growth roughly constant.

The arithmetic that forces this: at equilibrium the galaxy-wide growth factor is `1 − 0.033 = 0.967`;
on the un-squared scale it falls to at most `1 − 0.18 = 0.82` (see the bound below) while the same
re-scale raises unrest-driven decline. Without the rate re-cut, ordinary worlds flip to net decline —
the exact cancellation this design wants broken *only* for physically unviable worlds, applied
galaxy-wide, including to the viable-but-stuck cohort a later item is supposed to rescue.
**Galaxy-wide net growth, cohorted, at both horizons, is a step-1 gate metric.**

**The relaxation branch collapses to one rate.** `UnrestParams.recoveryDecay` is deleted, along with
its pre-scaling in the population processor (`lib/tick/processors/population.ts:36-40`) and the
docstring sentence "Supplied recovers twice as fast as either regime accumulates"
(`lib/constants/population.ts:10-11`). `decay` survives as the single rate, and its value is a fresh
calibration — neither 0.06 nor 0.12 carried over. The choice does not move where unrest settles (the
fixed point is rate-independent) but it halves or doubles every recovery: rates are per
population-processor run, one per 24-tick cycle, so closing half the gap to the fixed point takes
11.2 cycles at 0.06 and 5.4 at 0.12 — roughly 270 ticks against 130 for a relieved world to shed half
its unrest. That is the difference between a strike episode a player can watch end and one they
cannot, which matters most for the relieved struck worlds a later item creates.

### The guarantees, restated on Provision

The containment guarantees are proved from the constants in
`lib/constants/__tests__/band-constants.test.ts`, with `settled(d, floor) = floor + slope(d) × d`
against `COLLAPSE = INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold` (0.75,
`lib/constants/infrastructure.ts:22`), `MAX_FLOOR = 0.23` (max tax pressure 0.18 + `CROWDING.PRESSURE_MAX`
0.05) and `STRIKE_PARAMS.threshold` 0.65. Each gets its Provision-scale equivalent:

| Guarantee today | On Provision |
| --- | --- |
| Shortage slope strictly above Rationing (`:171-173`) | unchanged in form |
| Sustained Rationing never reaches collapse, at any tax (`:175-178`) | same bound, with the cut re-expressed as a Provision shortfall |
| A total water or food failure collapses even at zero tax (`:180-183`) | unchanged in form — a gap-1 scenario, identical under both folds |
| A total water or food failure drives net decline at every tax level (`:185-193`) | must be re-derived: it compares `settled(d, floor)` against `1 − d`, and both sides move |
| No non-survival good alone reaches the strike threshold at any tax (`:195-202`) | same form, tighter: one good's contribution rises from `share × gap²` to `share × gap` |
| **New — a colony at its measured founding Provision settles below the strike threshold** | fixes the maximum admissible slope |

The new invariant is the binding one. The founding cohort is the modal world (562 of 582 settled at
equilibrium) and opens at the galaxy's worst supply state; if it settles above 0.65 it opens inside
production suppression, at up to a 75% output cut, in the regime where `collapseDebt` accrues and
built levels tear down permanently. The bound is
`maxSlope = (strikeThreshold − maxFloor) / foundingShortfall`. With founding shortfall ≈ 0.5 (from
opening D 0.257 ⇒ shortfall ≤ 0.507, and opening demand-weighted satisfaction 0.47 ⇒ 0.53 — the two
reads agree), that is **0.84** at the worst tax-and-crowding floor and **1.26** at the frontier
default tax stance of 0.02. Both sit below today's `slopeRationing` of 1.8. The re-cut is not
optional and it is not small.

**The existing tests cannot catch this.** Every scenario in `band-constants.test.ts` is built by
`dFor()` (`:139-144`), which puts the named goods at satisfaction 0 — gap = 1, gap² = gap — so every
scenario value is *identical under both folds*. The suite stays green while the runtime property
moves fivefold. The new and re-derived tests must use **partial-satisfaction baskets**, which are the
only scenarios that can distinguish the two folds and are also the live galaxy's actual state.

### The instrument ships with the change

The harness cannot measure this change as it stands, and three of its readings become non-comparable
the moment the fold moves. Step 1 includes:

- **Widening `SupplyRegime` to four bands through the harness.** The union is closed at three
  (`lib/engine/population.ts:71`) and both harness folds end in a catch-all `else`
  (`lib/tick-harness/population-analysis.ts:289-291`, `lib/tick-harness/cohort-analysis.ts:279-281`),
  so a fourth Strained band would silently be counted as **Shortage** in the very instrument each
  step is measured with. The simulate table repeats the three-row shape (`scripts/simulate.ts:396-399`).
- **Instrumenting Provision itself** — the un-squared, necessity-and-demand-weighted mean — in the
  harness's per-system supply read (`lib/tick-harness/population-analysis.ts:258-266`), cohorted, and
  measuring its distribution at both horizons **before any constant is sized**. Nothing computes this
  quantity today. The nearest, `openingSatisfaction` (`lib/tick-harness/build-analysis.ts:222-229`),
  is demand-weighted with no necessity term.
- **Re-baselining rather than A/B-ing.** `meanDissatisfaction` changes meaning at the same galaxy
  state, so every stored baseline and gate bar in D units is non-comparable across the change. The
  step-1 gate takes fresh baselines on both sides and compares the *properties* (net growth, strike
  share, band distribution, dispersion), not the stored numbers.

**Every Provision figure quoted before that instrument exists is an upper bound, not a point
estimate.** Because `D = Σ share·gap²`, Jensen gives `(Σ share·gap)² ≤ D`, so mean shortfall ≤ √D
with equality only under uniform gaps. Equilibrium mean D 0.033 therefore bounds mean shortfall at
≤ 0.18 (Provision ≥ 0.82); startup mean D 0.064 bounds it at ≤ 0.25 (Provision ≥ 0.75). The shortfall
is measured as *concentrated* rather than uniform, which pushes the true mean shortfall well below
its bound — true Provision sits well above both floors. The true re-scale factor is somewhere
between 1× and 5× and is unknown until measured.

## Unrest responds to change as well as level

Unrest currently reads only the level of shortfall. A world that has been poor and stable for a
century and a world that lost half its supply last cycle settle at the same place, which is not how
populations behave and not what a player wants surfaced.

The addition is a **change term**: unrest rises when supply is falling and eases when it is
recovering, on top of the level response. This is the mechanism Victoria 3 leans on hardest — its
headline radicalisation is on standard of living *moving*, not on its absolute value — and it is what
lets a recovering world visibly recover rather than merely stop getting worse.

**This is separable and ships after the score.** Restoring the score's range may be sufficient on its
own, and adding a derivative term at the same time would make it impossible to attribute which change
did what.

It is also the first half of a larger idea. Comparing supply against *last cycle* is the crude form of
comparing it against a **slow-moving baseline of what this world has been getting** — the adaptive
expectation described under Open Questions. The two are the same mechanism at different levels of
generality, so the change term is a stepping stone rather than a detour.

**This is the step that changes the save format.** Nothing persists a prior-cycle supply reading: the
fold lives in `EconomySignals`, threaded in-memory through `ctx.results` for one tick and explicitly
not persisted (`lib/tick/types.ts:47-57`). The change term needs a new per-system field —
`priorProvision?` — which is a `World`-shape change: optional with a default so old saves load, and
finite-guarded, since a non-finite value would be serialized to `null` and corrupt the save. It is
seeded from the current cycle at both founding and world-gen, so a world's first delta is exactly
zero; a newly founded colony has no prior cycle and is the common case (562 of 582 settled at
equilibrium).

**Step 1 needs no save bump.** Provision derives entirely from the already-persisted per-good
`WorldMarket.satisfaction` (`lib/world/types.ts:261-268`, optional, missing reads 1), and the band
lives in the transient signal. A cold-start colony is well defined in step 1: market rows exist before
its first cycle and satisfaction is recomputed each cycle.

## Struck worlds resolve

Worlds above the strike threshold suppress their own production, which reduces supply, which raises
unrest. The loop is self-reinforcing and has no exit: growth carries `(1 − d)` and decline carries
unrest, so at high shortfall the two terms cancel and the world parks. Measured at equilibrium, 17
worlds (2.9% of 582 settled) sit in the strike regime and none of the galaxy is emptying (`Emptied 0`,
`Stranded 0`).

They need resolution for two reasons. As gameplay, a stuck world with no route out and no way to fail
is dead content. As instrumentation, they are permanent outliers inside every galaxy-wide average.

**Both resolutions are sequenced items in their own right, after the change term.** Each consumes a
primitive the game does not have, and each is listed below with its prerequisites rather than as a
design that could be built from this document as it stands.

### Which worlds are which — the prerequisite measurement

The split the design wants is between worlds that can feed themselves and worlds that cannot. **No
instrument measures that.** The nearest cohort, `survival-short`, is keyed solely on
`slotCap.arable ≤ 0` (`lib/tick-harness/cohort-analysis.ts:242`) — not "no deposits, no arable land,
nothing to build on".

The measured evidence cuts against the identification. At equilibrium, 91.5% of the landless cohort
(n = 176) is *not* striking, and striking is dominated by small worlds rather than landless ones: the
pop 10–100 cohort strikes at 16.2% (n = 68) against 0.5% for pop ≥ 1K (n = 370). Meanwhile
`band-constants.test.ts:185-193` asserts that a total water or food failure drives net decline at every
tax level — so a genuinely can't-feed-itself world should already be declining. Either the parked
cohort is not survival-short, or that invariant does not hold in the live sim; both cannot be true.

The untested alternative explanation for the parked cohort is the **crowd-brake equilibrium**: mean
occupancy is 1.110 at equilibrium with 489 of 582 worlds past the brake, so growth is being held near
zero by housing, not by shortfall. Which mechanism is parking them is unmeasured and is the first
thing to establish.

**Prerequisite:** a harness cohort keyed on this design's own test — no deposits **and** no arable
**and** nothing to build on — measured at both horizons, and a measurement of what actually holds the
parked cohort at constant population. Any figure for "how many struck worlds are unviable" before that
is a guess.

The predicate itself does not exist either. The raw fields are on `StarSystem` — `slotArable`,
`slotWater`, `slotBiomass` and the rest of the slot counts (`lib/world/types.ts:98-105`) with their
yield multipliers (`:106-112`) — but nothing folds them into a judgement. It must be named
`canSustainItself`, not `viable`: `viable` already means `popCap ≥ seedPop` at colony founding
(`lib/engine/directed-build.ts:1054,1101,1154`).

### Item — abandonment: a world is allowed to die

A world that cannot sustain itself should decline until it empties and returns to the map as a
candidate for later resettlement. **Four things stand between the current code and that outcome.**

**There is no un-develop primitive.** `control` is written toward `developed` in exactly one place
(`lib/world/tick.ts:491`) and never reversed; the ladder is documented one-way ("unclaimed frontier →
controlled (outpost tier) → developed", `lib/world/types.ts:74`); and a shipped invariant test asserts
that non-developed systems hold population exactly 0
(`lib/world/__tests__/developed-gate-invariant.test.ts:34`) and relies on monotonicity in a comment
(`:45`). The reversion was anticipated — `addMarketsForSettledSystems` leaves existing rows alone so a
redeveloped system "keeps its warehouses" (`lib/world/tick.ts:498-505`) — and never built.

**A husk cannot be resettled.** Colony candidates require `control === "controlled"`
(`lib/world/tick.ts:1065`) and claims require an unclaimed system (`:1037`), so a world left
`developed` with a `factionId` is a candidate for neither. Every repopulation path is headroom-gated
to zero once housing is gone: the relief-housing valve (`lib/engine/directed-build.ts:185-198`),
migration's `destHeadroom` (`lib/engine/migration.ts:113,124`) and colonist delivery's water-fill
(`lib/engine/colonist-delivery.ts:118-128`).

**Decline never completes on its own.** All three `populationDelta` terms are proportional to
population (`lib/engine/population.ts:278-286`), so decay is exponential and never reaches zero. Worse,
the loop has a stabilising feedback: a shrinking population shrinks demand, which raises satisfaction
against the same delivery, which raises Provision and lowers unrest — while `popCap` tracks population
down (`housingFloor`, `lib/engine/infrastructure-decay.ts:157`) so `crowdFactor` stays 1 and never
brakes growth. The world settles half-dead at an interior fixed point. **The trigger must therefore be
a sustained-decline counter or a population floor that bypasses the Provision term entirely** — an
instantaneous state test parks the world at that fixed point instead of finishing it.

**An emptied world reads as a clean Supplied datapoint.** Zero demand means every row is skipped
(`lib/tick-harness/good-satisfaction.ts:42`), the fold returns 0 on empty weight
(`lib/engine/population.ts:60`), and `foldSupplyState` returns Supplied. The harness counts it in every
settled denominator (`lib/tick-harness/population-analysis.ts:24-26`). So the outlier this item exists
to remove does not disappear — it changes sign, from a permanent worst reading to a permanent perfect
one.

**What the item must specify:** the sustained-decline trigger and its threshold; the target `control`
state and the `factionId` disposition (both must land somewhere the claim and colony providers will
pick the world up again); what happens to buildings, market rows and `popCap`; which processor owns the
write; how the developed-gate invariant is re-authored now that `control` is no longer monotonic; and
that abandoned systems leave the harness's settled denominator **before** any Provision baseline is
measured over them.

### Item — relief: a viable world is bought out of the loop

A world that can sustain itself but cannot break the strike loop unaided gets a **player-funded
intervention**: spend from the treasury to deliver goods, at a cost that is felt. Relief is
deliberately specified as **spending to move goods**, not as spending to remove unrest — a relief
convoy arriving is a thing the player can watch and understand as the cause of the recovery, and it
uses the logistics simulation rather than bypassing it.

**Three prerequisites, none of which exist.**

*A treasury home.* `TreasuryBands` is exactly three bands (`lib/engine/treasury.ts:15-20`), and there
is an authored precedent explicitly refusing a fourth: colony founding is "its own field, never a
fourth band: `TreasuryBands` is shared by the sliders, the bills and the latched funding fractions,
and founding is none of those — it is taken off the top, ahead of the ladder"
(`lib/world/types.ts:363-368`). Relief is either off-the-top on the same footing or a named band, and
the item must state which — plus its precedence against `pendingFounding`, which already drains the
balance before the ladder divides anything (`lib/tick/processors/treasury.ts:146-151`).

*A targeted-transfer primitive.* Directed logistics is a pure autonomic surplus↔deficit matcher; there
is no targeted-transfer or order concept anywhere, and player orders exist for construction only. The
item must specify the new export, its reserve rules and its reachability rules.

*A costing.* There is no logistics-cost mechanic in the repo — no spec, no roadmap row, no constant —
so the item either specs its cost self-containedly or is gated on that row being booked first.

One consequence worth stating before the item is designed: the logistics work budget is
population-funded (`lib/tick/processors/directed-logistics.ts:51`), so a world already emptying
contributes less budget to its own rescue. And "spend to move goods" cannot buy haul capacity without
a stated, deliberate exception to the shipped invariant that money is fuel, not capacity.

### The planner is a second exit, and this change narrows it

The build planner's satisfaction-feedback channel is zeroed on struck worlds: `feedbackGap` is
suppressed when `strikeExplains` — `productionSuppressed && capacity > 0`
(`lib/engine/directed-build.ts:319-324`) — and `productionSuppressed` fires above the 0.65 strike
threshold. Re-scaling the fold widens the >0.65 cohort, which zeroes that channel on more (system,
good) pairs, precisely where a Provision collapse would otherwise be answered by building.

This is a narrowing, not a stall: the capacity-gap term is unconditional by authored design, so that a
striking world can still build its way out (`:314-318`). `strikeExplains` itself is **not** re-cut —
it reads unrest against a threshold, and unrest remains a [0,1] state; what changes is how many worlds
reach it, which is the slope re-cut's job. **Proposals suppressed by `strikeExplains` per cycle,
cohorted, at both horizons, is a step-1 gate metric.**

## What this does not change

Demand, pricing geometry, the ration threshold, logistics matching, planner capacity sizing and
infrastructure decay are all untouched. `GOOD_NECESSITY` and its weighting keep their current meaning
and values — the weights still decide how much each good's absence counts. The survival-good floor
keeps its current behaviour exactly, including the build planner's `fed()` gate, which keeps reading
the survival test alone. `TARGET_COVER` and the cover constants are out of scope. `STRIKE_PARAMS` and
`INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold` keep their values; they are unrest thresholds and unrest
stays a [0,1] state.

The unrest integral keeps its shape: relaxation toward a standing floor with the shortfall integrated
on top, and a fixed point of `min(1, floor + slope × shortfall)`. What changes is the scale of the
quantity fed to it, every constant cut against the old scale, and the removal of the label branch on
the relaxation rate.

## Sequence

Each item is measured before the next starts.

1. **Provision** — the score, the four descriptive bands, the harness instrument, and the constant
   re-cuts (`D_SHORTAGE_CUT`, `D_SHORTAGE_BLEND`, both slopes, the single relaxation rate, the
   growth/decline rates, the new criticality constant). Ships as one change; no save bump.
   *Gate metrics, cohorted at both horizons:* band distribution, Provision distribution, mean and
   dispersion of unrest, strike share, galaxy-wide net growth, proposals suppressed by `strikeExplains`.
2. **The change term** — unrest responds to supply moving, not only to its level. Evaluated against
   (1) so its contribution is attributable. Adds the persisted `priorProvision?` field.
3. **The adaptive expectation** — the reference each world is judged against becomes its own history
   rather than a global constant. Only worth attempting once (2) has shown what a change response
   does, since it generalises exactly that.
4. **Abandonment** — a world that cannot sustain itself declines to empty and returns to the map.
   Not before (2). Gated on: the `canSustainItself` predicate, the viability cohort in the harness,
   the un-develop primitive, and the re-authored developed-gate invariant.
5. **Relief** — a player-funded intervention buys a viable world out of the strike loop. Not before
   (2), and independent of (4). Gated on: the treasury accounting decision, the targeted-transfer
   export, and either a self-contained costing or a booked logistics-cost row.

## Open questions

- **Where exactly do the Provision bin edges sit?** Settled from the measured Provision distribution
  at step 1's gate, and reconciled with the per-good chip's 0.95 "met" line so the two surfaces do
  not disagree by accident (the chip reads a per-good satisfaction, the bin reads the world mean —
  they may deliberately differ with a stated reason).
- **Should worlds be judged against a local expectation rather than an absolute line?** Every
  threshold here is global and fixed: a two-pop frontier colony and a developed homeworld are held to
  one identical standard, and that standard never moves as the galaxy develops. The consequence is
  visible in the measurements — mean D falls 0.064 → 0.033 between the horizons while mean unrest
  rises 0.073 → 0.166 on crowding and tax, so supply's share of unrest shrinks monotonically as
  worlds keep improving against a bar that stays put. No re-cut fixes that; the problem is that the
  reference is fixed at all.
  Victoria 3 avoids it by giving each population an expectation derived from its own circumstances,
  which rises with literacy and technology — so development raises the bar rather than clearing it.
  The equivalent here is a slow-moving baseline of what a world has been getting: a colony that has
  always scraped by is content, a rich world that dips is not. This also dissolves the
  threshold-placement problem entirely, since there is no longer an absolute threshold to place.
  Recorded rather than designed — it is item 3 in the sequence and should not be attempted before the
  change term has shown what a change response does.

---

## Design hazards worksheet

### 1. One quantity, several unrelated jobs

| Quantity | Every reader today (`file:line`) | Which of them this design moves | Intended? |
| --- | --- | --- | --- |
| the fold's output `d` | unrest integral `accumulateUnrest` `lib/engine/population.ts:171-182` (called `lib/tick/processors/population.ts:61`); slope selector `unrestSlope` `:142-148`; band label `foldSupplyState` `:110-115`; growth factor `populationDelta` `:278-280` (called `processors/population.ts:64`); harness `lib/tick-harness/population-analysis.ts:2,258-266`, `cohort-analysis.ts:272-281`, `build-analysis.ts:229` | all of them — the scale changes for every reader | Yes. The four families are re-cut in the same change; leaving any one on the old scale is a silent balance change, which is why the constant re-cuts are not deferred. |
| `pressure` (display twin of the fold) | `lib/engine/pop-needs.ts:71` → `lib/services/pop-needs.ts:15` → `lib/services/universe.ts:245` → `components/system/industry-panel.tsx:872-874`, `components/system/population-panel.tsx:63-65` | moved to the same un-squared shape | Yes — deliberately kept coupled. The docstring at `lib/engine/pop-needs.ts:9-11` exists to hold display and sim together; un-squaring one alone reorders the panel's top-2. |
| `D_SHORTAGE_CUT` | `foldSupplyState` `lib/engine/population.ts:113`; `unrestSlope` `:144-146` | both | Yes — two consumers in two roles (label boundary, ramp start), re-derived together on the new scale. |
| `D_SHORTAGE_BLEND` | `unrestSlope` `lib/engine/population.ts:144-146` | one | Yes — single reader, re-derived with the cut it rides. |
| `SHORTAGE_SATISFACTION` | `hasSurvivalShortfall` `lib/engine/population.ts:94` (→ `foldSupplyState`); `fed()` `lib/engine/directed-build.ts:146-154`; band table's 50% line | neither reader moves | Yes — deliberately separated. The criticality line gets its own constant so the famine line and the criticality line can move independently. |
| `slopeRationing` / `slopeShortage` | `unrestSlope` `lib/engine/population.ts:147`; `lib/constants/__tests__/band-constants.test.ts:170-202` | both re-cut | Yes — their docstring's premise ("it exceeds 1 because D itself is small") is the thing that changes. |
| `decay` / `recoveryDecay` | `accumulateUnrest` `lib/engine/population.ts:178`; pre-scaled `lib/tick/processors/population.ts:36-40` | `recoveryDecay` deleted; `decay` re-calibrated | Yes — the label branch is what the demotion removes. |
| `growthRate` / `declineRate` | `populationDelta` `lib/engine/population.ts:279-281` | both re-cut | Yes — they are cut against the squared fold's magnitudes (`lib/constants/population.ts:50-60`). |
| `SupplyRegime` | `lib/engine/population.ts:71`; `accumulateUnrest` `:178`; `population-analysis.ts:289-291`; `cohort-analysis.ts:279-281`; `scripts/simulate.ts:396-399` | widened to four; stops selecting the relaxation rate | Yes — and the harness folds must widen in the same change or a Strained world is silently counted as Shortage. |

### 2. A constant read for a meaning it was not authored to have

| Constant | Docstring says it means | This design uses it as | Same thing? |
| --- | --- | --- | --- |
| `GOOD_NECESSITY` (`lib/constants/physical-economy.ts:92-93`) | "how much NOT having a good counts as suffering, in (0,1]" — a peer table to `GOOD_CONSUMPTION`, deliberately not derived from it | the weight in the Provision mean | Yes, with the qualification carried into the text and the tooltip: Provision is a *suffering-weighted* share, so a world with no war matériel and no luxuries reads ≈ 0.97. Never "83% of its goods arrived". |
| `SHORTAGE_SATISFACTION` (`lib/constants/economy.ts:82-88`) | "Civilian satisfaction below which a demanded good counts as a Shortage rather than mere Rationing. Its live consumer is the survival-good floor" | kept for the survival floor and the 50% band line only | Yes — the criticality override takes a separate constant rather than a third meaning on this one. |
| `D_SHORTAGE_CUT` (`lib/constants/economy.ts:90-98`) | cut against scenario arithmetic; "Both endpoints are scenario values, not constants — moving any necessity weight moves them, so re-derive rather than nudge" | re-derived in Provision units in step 1 | Yes — following the docstring's own instruction. The cited anchors (≈0.14, ≈0.37) are gap-1 values and are scale-invariant, so they carry no information about which fold was intended. |
| `D_SHORTAGE_BLEND` (`lib/constants/economy.ts:101-108`) | ramp width above the cut, "so the Rationing containment guarantee holds across the whole Rationing range" | re-derived, with the containment guarantee restated on the new scale | Yes. |
| `UNREST_PARAMS` slopes (`lib/constants/population.ts:12-25`) | "Each slope is an EXCHANGE RATE, not a cap… It exceeds 1 because D itself is small — measured mean D is ~0.15" | re-cut, because the input stops being small | Yes — the premise is exactly what this change invalidates. |
| `UNREST_PARAMS.recoveryDecay` (`lib/constants/population.ts:10-11,31`) | "Supplied recovers twice as fast as either regime accumulates" | deleted with its docstring sentence and its pre-scaling | Yes — the demotion removes the label branch it exists for. |
| `POPULATION_PARAMS` (`lib/constants/population.ts:50-60`) | "Symmetric growth/decline rates: growth carries a (1 − D) factor… With the fold weighted by necessity the ambient deficit folds to ≈0.14 rather than ≈0.4, so a chronically import-short mining world grows" | re-cut | Yes — the symmetry argument is stated in the squared fold's magnitudes and does not survive the re-scale. |
| `STRIKE_PARAMS.threshold` = 0.65 (`lib/constants/population.ts:42-48`) | "only genuinely high-unrest systems strike" | unchanged | Yes — unrest stays [0,1]; only how many worlds reach 0.65 changes, and that is the slopes' job. |
| `INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold` = 0.75 (`lib/constants/infrastructure.ts:20-23`) | collapse threshold for infrastructure teardown | the bound the containment guarantee is proved against | Yes, unchanged. |
| `TAX_LEVEL_UNREST_PRESSURE` (`lib/constants/treasury.ts:46-55`) | "Additive standing unrest floor carried by every system the faction owns — the level a calm, well-supplied population settles at" | the `floor` in the containment arithmetic (max 0.18, + `CROWDING.PRESSURE_MAX` 0.05 ⇒ `MAX_FLOOR` 0.23) | Yes, unchanged. |

### 3. A system you did not think about

| System | Interaction with this change | Reason if none |
| --- | --- | --- |
| Events | `solar_storm` and `asteroid_strike` apply a system-wide `production_rate` × 0.05 for whole cycles (`lib/constants/events.ts:468,646`). On the re-scaled fold a transient event must not push a world through the 0.75 collapse threshold, where `collapseDebt` accrues and levels in use tear down permanently while the event expires. The event multiplier is a required scenario in the re-derived containment tests. No shipped event carries a `consumption_rate` modifier, so the demand weighting is untouched; `anchor_shift` moves prices only and never reaches demanded/delivered. | — |
| Population + migration | Growth is the fold's second consumer (`lib/engine/population.ts:278-280`) and its rates are re-cut here. Migration reads unrest via contentment, plus headroom and jobs (`lib/engine/migration.ts:108-124`) — no read of the fold or the band — so its coupling is entirely through unrest, and a wider unrest spread makes the migration gradient more contentment-dominated. | — |
| Unrest / regime | The subject: fold scale, both D constants, both slopes, the relaxation branch, the band's four members. | — |
| Industry + staffing | Strike suppression reads unrest, not the band (`strikeMultiplier`, `lib/engine/population.ts:197-202`), so a wider strike cohort suppresses more production. Labour allocation, staffing and the skilled baskets are untouched — except that the baskets are the source of the epsilon-demand goods the band's demand-share floor exists to exclude. | — |
| Infrastructure decay | Reads only the *key set* of `dissatisfactionBySystem` as its shard list (`lib/tick/processors/infrastructure-decay.ts:28-30`); its inputs are unrest and `sellingFactor`. Coupling is through unrest alone, and through the 0.75 collapse threshold. The idle-decay channel deliberately excludes strikes (`lib/tick/processors/economy.ts:204-206`), so a struck world's falling stock reads *less* idle, not more — that channel does not amplify. | — |
| Directed logistics | No read of the fold, the band or unrest. Item 5 would need a targeted-transfer export that does not exist, and its work budget is population-funded (`lib/tick/processors/directed-logistics.ts:51`), so an emptying world funds less of its own rescue. | None in items 1–4. |
| Directed build / planner | `fed()` reads the survival test only (`lib/engine/directed-build.ts:146-154`) and is unchanged. `strikeExplains` (`:319-324`) zeroes the satisfaction-feedback channel above the strike threshold, so a wider strike cohort narrows the planner's exit from the loop; the capacity-gap term stays unconditional by authored design (`:314-318`). Gate metric added. | — |
| Colonisation + founding manifest | The founding cohort is the modal world (562 of 582 settled at equilibrium) and opens at the galaxy's worst supply state (opening D 0.257). It sets the maximum admissible slope via the new founding invariant. The manifest and the endowment themselves are untouched. | — |
| Treasury / purse | Tax feeds the unrest floor one way only (`lib/constants/treasury.ts:46-55`); no processor reads unrest or the band back into tax or income. Item 5 needs an accounting decision — `TreasuryBands` is three bands (`lib/engine/treasury.ts:15-20`) with a fourth explicitly refused (`lib/world/types.ts:363-368`), and founding already drains before the ladder (`lib/tick/processors/treasury.ts:146-151`). | None in items 1–4. |
| Factions + relations | None. No relations or AI-taxation processor references unrest or `taxLevel`; tax is written at world-gen and by the player service only, so there is no feedback path from a wider unrest spread into faction behaviour. | Stated. |
| Save format (`World` shape) | None in item 1: Provision derives from the already-persisted `WorldMarket.satisfaction` (`lib/world/types.ts:261-268`) and the band lives in the transient `EconomySignals` (`lib/tick/types.ts:47-57`). Item 2 adds `priorProvision?` — optional, defaulted, finite-guarded. Item 4 changes what `control` may hold and therefore what the developed-gate invariant asserts. | — |
| The harness's own metrics | The instrument re-keys under the change: `SupplyRegime` is a closed 3-member union folded with a catch-all `else` in two places (`population-analysis.ts:289-291`, `cohort-analysis.ts:279-281`) and a 3-row table in a third (`scripts/simulate.ts:396-399`), and every stored D-unit baseline becomes non-comparable. Widening the union and instrumenting Provision are part of step 1, before any constant is sized. | — |

### 4. A symptom asserted without a measurement — or with the wrong one

| Claim | Evidence (`file:line` or number) | Horizon | Cohort |
| --- | --- | --- | --- |
| Supplied is exactly D = 0, not approximately | `lib/engine/population.ts:114` | — | — |
| `foldSupplyState` has three branches, and a D-driven Shortage exists | `lib/engine/population.ts:110-115` | — | — |
| The band gates only the relaxation rate; the quantity gates the slope | `lib/engine/population.ts:178` and `:142-148` | — | — |
| 43.5% Rationing on a galaxy that is largely fine | 253 of 582 Rationing; pop ≥ 1K cohort at mean D 0.006 reads 23% Rationing | equilibrium (10,000 t) | all settled; pop ≥ 1K (n = 370) |
| A flawless basket is common, not rare | 311 of 582 settled at D exactly 0 | equilibrium | all settled |
| Homeworlds are not mislabelled | mean D 0.000, 100% Supplied | equilibrium (and startup: same) | homeworld (n = 20) |
| Supply's contribution to unrest shrinks with maturity | mean D 0.064 → 0.033 | startup → equilibrium, same run | all settled (n = 253 → 582) |
| …while unrest itself rises on standing pressure | mean unrest 0.073 → 0.166; occupancy 0.831 → 1.110; 489 of 582 past the crowd brake; striking 0 → 17 | startup → equilibrium | all settled |
| The founding cohort is the modal world and the worst-supplied one | 562 of 582 settled; opening demand-weighted satisfaction 0.47, opening D 0.257; 376 of 562 opened below 50% | equilibrium | founding cohort (n = 562) |
| …and the same is true, less severely, at startup | 233 founded, opening satisfaction 0.71, opening D 0.097, 56 opened below 50% | startup | founding cohort (n = 233) |
| Small worlds strike, landless worlds mostly do not | pop 10–100 strike 16.2% (n = 68) vs pop ≥ 1K 0.5% (n = 370); survival-short strike 8.5% (n = 176) ⇒ 91.5% not striking | equilibrium | pop bands; survival-short |
| Nothing is currently emptying | `Emptied 0`, `Stranded 0` | both horizons | all settled |
| Every Provision figure quoted before instrumentation is an upper bound | mean shortfall ≤ √D by Jensen; D 0.033 ⇒ shortfall ≤ 0.18; D 0.064 ⇒ ≤ 0.25 | equilibrium; startup | all settled |
| The existing containment tests cannot detect the fold swap | `dFor()` sets named goods to satisfaction 0, so gap² = gap (`lib/constants/__tests__/band-constants.test.ts:139-144`) | — | — |
| The maximum admissible slope is below the current `slopeRationing` | `(0.65 − 0.23) / 0.5 = 0.84` at max floor; `(0.65 − 0.02) / 0.5 = 1.26` at the frontier default tax; current value 1.8 | equilibrium (founding shortfall) | founding cohort |
| The relaxation rate choice halves or doubles recovery | `ln 0.5 / ln(1 − k)` = 11.2 cycles at 0.06, 5.4 at 0.12; one run per 24-tick cycle | — | — |
| What parks the struck cohort is unmeasured | no cohort keys on the three-way viability test (`lib/tick-harness/cohort-analysis.ts:242` keys on `slotCap.arable ≤ 0` alone) | — | — (hypothesis: crowd-brake equilibrium, untested) |

### 5. Designing against a threshold, signal or primitive that does not exist

| Consumes | Produced at (`file:line`) | Actual shape / range today | Design assumes |
| --- | --- | --- | --- |
| per-good satisfaction | `lib/world/types.ts:261-268`, written by the economy processor | `[0,1]`, optional, missing reads 1 | same — Provision derives from it with no new persistence |
| civilian demand per good | `consumptionRate` via `lib/tick-harness/good-satisfaction.ts:41`; rows with `demanded ≤ 0` skipped at `:42` | positive for all 26 goods on any populated world; epsilon on skilled-basket goods at small technician counts | a demand-share floor is required for band and override eligibility |
| `SupplyState` | `lib/engine/population.ts:110-115` | 3-member regime + `survivalShortfall` bit | four bands; the bit stays, because it is not inferrable from the label (`:73-79`) |
| the fold's convexity guarantee | `lib/engine/population.ts:65` | `share × gap²` | replaced by explicit overrides |
| un-develop / abandonment transition | **nowhere** — `control` is written toward `developed` at `lib/world/tick.ts:491` only; ladder documented one-way at `lib/world/types.ts:74`; invariant at `lib/world/__tests__/developed-gate-invariant.test.ts:34,45` | one-way | item 4 must build it and re-author the invariant |
| resettlement of an emptied world | `lib/world/tick.ts:1037` (claims need unclaimed) and `:1065` (colony candidates need `controlled`); repopulation headroom-gated at `lib/engine/directed-build.ts:185-198`, `lib/engine/migration.ts:113,124`, `lib/engine/colonist-delivery.ts:118-128` | a `developed` husk with a `factionId` is a candidate for neither path | item 4 must state the target `control` and `factionId` |
| targeted logistics transfer | **nowhere** — directed logistics is an autonomic surplus↔deficit matcher; player orders exist for construction only | — | item 5 must build it |
| a fourth treasury category | **nowhere** — `TreasuryBands` is three (`lib/engine/treasury.ts:15-20`); the authored alternative is off-the-top (`lib/world/types.ts:363-368`) | three bands + `foundingExpense` off the top, drained before the ladder (`lib/tick/processors/treasury.ts:146-151`) | item 5 must choose and state precedence |
| a viability predicate | **nowhere** — raw fields at `lib/world/types.ts:98-105` (slots) and `:106-112` (yields); `viable` is taken (`lib/engine/directed-build.ts:1054,1101,1154`) | slot counts + yield multipliers, no predicate | `canSustainItself` must be written before item 4 is designed |
| a viability cohort in the harness | nearest is `survival-short`, keyed on `slotCap.arable ≤ 0` (`lib/tick-harness/cohort-analysis.ts:242`) | one slot test | the three-way test (no deposits, no arable, nothing to build on) must be added first |
| an un-squared necessity-weighted mean satisfaction | **nowhere** — nearest is `openingSatisfaction` (`lib/tick-harness/build-analysis.ts:222-229`), demand-weighted with no necessity term | — | step 1 instruments it before sizing any constant |
| per-world worst-demanded-good satisfaction | **nowhere** | — | measured by step 1's instrument; the reading rejected the worst-good band rule (cliff distribution) and sizes the critical-good override instead |
| a prior-cycle supply reading | **nowhere** — `EconomySignals` is transient, one tick, not persisted (`lib/tick/types.ts:47-57`) | in-memory only | item 2 adds `priorProvision?` |

### 6. Designing against an aggregate that moves for other reasons

| Metric | Read at which cohort | What else moves this number |
| --- | --- | --- |
| Supplied / Strained / Rationing / Shortage shares | homeworld, colony, pop 10–100 / 100–1K / ≥1K, survival-short; both horizons | **Founding rate — the dominant confounder.** 562 colonies at equilibrium against 233 at startup, each opening at the galaxy's worst supply state; a faster-founding run reads worse with nothing having changed. Also the band boundary itself, once Strained exists. |
| mean Provision / mean shortfall | same | Same founding-rate mix, plus the maturity trajectory (worlds improve against a fixed bar) and event incidence (777 events at startup, 7725 at equilibrium). |
| mean unrest | same | Tax stance (additive floor to 0.18) and crowding (`PRESSURE_MAX` 0.05) — together up to 0.23 of the settled value before supply contributes anything. Occupancy runs 0.831 → 1.110 across the horizons, so the crowding half grows on its own. |
| strike share | same, and by pop band specifically | The same standing floor: a world at max tax and full crowding needs only 0.42 of slope-weighted shortfall to strike. Also the strike threshold's distance from the floor, which no part of this design moves. |
| galaxy-wide net growth (step-1 gate) | pop bands + homeworld/colony | The crowd brake (mean occupancy > 1 at equilibrium, 489 of 582 braked), migration and colonist delivery redistributing rather than creating, and the overshoot-death sink which fires only above the strike threshold. Net growth can fall with no change in the growth *factor* at all. |
| proposals suppressed by `strikeExplains` (step-1 gate) | per good × world cohort | The count of (system, good) pairs with `capacity > 0`, which grows with the galaxy: 582 settled systems at equilibrium against 253 at startup. Read as a rate per eligible pair, not a raw count. |
| abandoned-world count (item 4) | its own cohort, excluded from the settled denominator | An emptied world reads Provision 1.0 / Supplied on an empty basket, so it inflates every galaxy-wide supply reading unless removed from the denominator first. |
