# Supply Response — Let the Score Drive

## Headline

A world's supply state is now one readable number — **Provision**, the necessity-and-demand-weighted
share of what a world needs — driving unrest and growth, with four descriptive bands and two explicit
severity overrides (shipped; see [economy.md](../active/gameplay/economy.md)). What remains of this
arc is making the *response* to that number behave like a population rather than a thermostat, and
giving stuck worlds an exit:

- **The adaptive expectation.** Unrest stops judging every world against one fixed global bar and
  judges it against **what that world has been getting**: a frontier colony that has always scraped
  by is content; a rich world that dips is not; a world whose supply is *falling* radicalises before
  its level looks bad, and one that is *recovering* visibly calms. One mechanism — a persisted,
  slow-moving per-world baseline — whose fastest-decay setting is the old "change term" (previously
  sequenced as its own item; merged here, see below).
- **Abandonment.** A world that cannot sustain itself declines to empty and returns to the map as a
  candidate for later resettlement, instead of parking half-dead forever.
- **Relief.** A player-funded intervention buys a viable world out of the strike loop — spending to
  *move goods* through the logistics simulation, never spending to delete unrest.

Each item is measured before the next starts. Abandonment and relief both consume the
worsening-vs-recovering signal the expectation baseline provides (deviation from expectation), which
is why they sequence after it.

## Where the galaxy stands

Every figure is from the step-1 gate (Gate 2) of the shipped Provision change: the headless run of
the real tick at 600 systems, seed 42, economy scale 100 — **startup** (1000 ticks / 41 cycles:
founding and provisioning behaviour), **equilibrium** (10,000 ticks / 416 cycles: the only valid
basis for tuning), and the **12k checkpoint** (the high-tier consumer transient clears ~t 9,700, so
goods-story reads get a post-transient confirmation).

| Reading (all settled) | Startup (n = 253) | Equilibrium (n = 582) | 12k (n = 582) |
| --- | --- | --- | --- |
| Supplied | 80.6% | 89.3% | 95.9% |
| Strained | 7.9% | 7.0% | 1.5% |
| Rationing | 9.9% | 0.7% | 0.0% |
| Shortage (famine) | 1.6% | 2.9% | 2.6% |
| Provision median / p10 | 0.992 / 0.695 | 1.000 / 0.890 | 1.000 / 0.978 |
| mean shortfall | 0.065 | 0.038 | — |
| mean unrest (sd) | 0.054 (0.042) | 0.153 (0.148) | 0.132 (0.138) |
| striking | 0 (0.0%) | 15 (2.6%) | 13 (2.2%) |

Cohorted at equilibrium:

| Cohort | n | mean Provision | unrest | strike% | Sup / Str / Rat / Sho % |
| --- | --- | --- | --- | --- | --- |
| homeworld | 20 | 1.000 | 0.101 | 0.0% | 100 / 0 / 0 / 0 |
| colony | 562 | 0.961 | 0.155 | 2.7% | 89 / 7 / 1 / 3 |
| pop ≥ 1K | 370 | 0.995 | 0.108 | 0.0% | 98.6 / 1.4 / 0 / 0 |
| pop 100–1K | 144 | 0.930 | 0.197 | 3.5% | 75 / 19 / 1 / 4 |
| pop 10–100 | 68 | 0.855 | 0.309 | 14.7% | 69 / 12 / 3 / 16 |
| survival-short (no arable slot) | 176 | 0.894 | 0.250 | 8.5% | 70 / 18 / 2 / 10 |

Facts that set the shape of the remaining items:

**The fixed-bar problem survived the re-scale, exactly as predicted.** Mean shortfall falls 0.065 →
0.038 between the horizons while mean unrest *rises* 0.054 → 0.153 — the rise is tax and crowding
(an additive floor of up to 0.23), not supply. Worlds keep improving against a bar that stays put,
so supply's share of unrest shrinks monotonically as the galaxy matures. No re-cut fixes this; the
reference being fixed at all is the problem, which is what the adaptive expectation removes.

**The founding cohort is still the modal world and the worst-supplied one.** 562 of 582 settled at
equilibrium are colonies; their opening Provision is mean 0.74 / p10 0.62 (equilibrium cohort;
mean 0.88 / p10 0.69 at startup). The founding-strike guarantee holding today's `slopeRationing`
at 0.95 is interim scaffolding for exactly this cohort — the expectation baseline dissolves it
structurally (a newborn's settlers expect frontier hardship, so its expectation-relative shortfall
is ~0 at any tax), after which the slopes are re-derived and only the durable constraints remain
(broad shortage on an established world still strikes; famine's absolute floor).

**Strikes are a small-world story, not a landless-world story.** pop 10–100 strikes at 14.7%
(n = 68) against 0.0% for pop ≥ 1K (n = 370); 91.5% of the survival-short cohort is *not* striking.
What actually parks the parked cohort is still unmeasured (see the prerequisite measurement below).

**Nothing is emptying.** Emptied 0, Stranded 0 at both horizons — abandonment has no live instances
to design against yet, and struck worlds neither die nor recover: strike share is flat across arms
and horizons (pop 10–100: 16.2% pre-change → 14.7% post-change at equilibrium).

**The planner's strike-loop exit widened.** Proposals suppressed by `strikeExplains` per eligible
pair *fell* ~3× at the step-1 gate: 2.38% → 0.86% at equilibrium, 1.97% → 0.71% at 12k. Relief and
abandonment design against the narrower residual, not the pre-change number.

## The adaptive expectation

### What it is

Each world carries a persisted, slow-moving **expectation baseline** — what Provision this world has
been getting — and the unrest response is driven by supply measured **against that baseline** rather
than against a fixed global scale. Three behaviours fall out of one mechanism:

- **Change response.** A world whose supply drops below what it is used to radicalises *while the
  level is still healthy*; a recovering world's unrest visibly eases while its level is still poor.
  This is the old "change term" — unrest responds to supply moving, not only to its level.
- **Normalisation.** A world that has always been at 0.7 is calm there; a world that lived at 1.0
  and slid to 0.9 is not. Development raises the bar rather than clearing it (Victoria 3's standard
  of living vs *expected* standard of living — the precedent attaches to this shape, not to a raw
  one-cycle derivative).
- **Threshold dissolution.** The absolute-threshold placement problem (where exactly does "content"
  sit for a two-pop frontier colony vs a developed homeworld?) stops existing: there is no absolute
  threshold left to place. The founding-strike invariant and the interim `slopeRationing` retire
  with it, and the slopes are re-derived against expectation-relative shortfall.

### Why this absorbed the change term

The change term was previously its own item, sequenced first, with the expectation recorded as its
generalisation. Merged, with the step-1 gate's data in hand, because:

- **They share their only infrastructure.** Both need one persisted per-system field, updated each
  cycle. "Compare against last cycle" is the fastest-decay special case of "compare against a
  slow-moving baseline" — one update rule, one constant apart. Shipping them as two items means
  shipping the same field twice.
- **The attribution argument aged out.** The original sequencing existed so the re-scale and a
  derivative term would not land together unattributably. The re-scale shipped alone and gated
  cleanly; whatever ships next is singly attributable regardless of its shape.
- **The gate showed the level response alone is not enough** for the arc's remaining goals: labels
  are truthful and suppression fell, but small-world strike dynamics did not move, famine worlds
  still pin unrest at 1.000, and nothing escalates on deterioration or eases on recovery.

The exploratory half of the old item survives as **calibration, not code**: the decay rate of the
baseline is the knob, and the harness sweeps it — the one-cycle end of the spectrum *is* the old
change term, the slow end is full normalisation. The behavioural read at each setting (strike
churn, oscillation, founding-cohort trajectories, recovering-world visibility) is the experiment
the old item existed to run.

### Design constraints the spec must carry

- **Famine is never normalised.** The survival floor is absolute — `slopeShortage` survives
  expectation-relativity precisely because famine is famine whatever a population is used to. The
  expectation baseline must not be able to average a survival-good failure into contentment; the
  survival override composes exactly as shipped.
- **The ratchet wants asymmetry, stated or rejected.** Symmetric decay means expectations fall as
  fast as they rise, so chronic decline self-forgives at the decay rate. Whether hardship is
  normalised slower than plenty (Victoria 3 does this) is a design decision to make explicitly.
- **Abandonment interplay.** A world that has normalised its own misery stops emitting the unrest
  signal — but abandonment (next item) needs decliners to *finish*. Its trigger must therefore key
  on sustained physical decline (population trend), not on unrest, or the expectation quietly
  disables it. This was already true (an unrest-keyed trigger parks at the interior fixed point);
  the expectation makes it non-negotiable.
- **Expectation floor and seed.** A newborn colony's baseline seeds from its opening state (first
  delta exactly zero — founding must not open with a shock), and the baseline needs a stated floor
  so "used to nothing" cannot read as content at Provision 0 outside the famine floor's reach.
- **What stays absolute.** The band (the player-facing label) stays binned from absolute Provision —
  a world at 0.6 is Rationing however accustomed it is; the *label* tells the truth about supply,
  the *response* is relative. Growth's `1 − shortfall` factor: decide explicitly whether growth
  reads absolute or expectation-relative shortfall, and state why (the default lean is absolute —
  bodies need goods, not satisfied expectations).

### Mechanics

**This is the step that changes the save format.** Nothing persists a prior-cycle supply reading:
the fold lives in `EconomySignals`, threaded in-memory through `ctx.results` for one tick and
explicitly not persisted (`lib/tick/types.ts:47-57`). The baseline is a new per-system field —
optional with a default so old saves load, finite-guarded (a non-finite value serializes to `null`
and corrupts the save), seeded from the current cycle at both founding and world-gen. Updated once
per cycle by the population processor (the fold's owner), read in the same tick.

*Gate metrics, cohorted at both horizons plus the 12k checkpoint:* strike share and unrest
distribution per cohort against the step-1 gate's baselines above; founding-cohort opening
trajectory (does a newborn still open calm at every tax level once the invariant retires); a
recovering-world trace (unrest visibly easing during recovery, the behaviour the level response
cannot produce); no oscillation (the derivative response must not ring against the relaxation
rate); decay-rate sweep results recorded with the chosen value's rationale.

## Struck worlds resolve

Worlds above the strike threshold suppress their own production, which reduces supply, which raises
unrest. The loop is self-reinforcing and has no exit: growth carries `1 − shortfall` and decline
carries unrest, so at high shortfall the two terms cancel and the world parks. Measured at the
step-1 gate: 15 worlds (2.6% of 582 settled) sit in the strike regime and none of the galaxy is
emptying (Emptied 0, Stranded 0, both horizons).

They need resolution for two reasons. As gameplay, a stuck world with no route out and no way to
fail is dead content. As instrumentation, they are permanent outliers inside every galaxy-wide
average.

Both resolutions are sequenced after the adaptive expectation: each consumes the
worsening-vs-recovering signal (deviation from baseline), and each consumes a primitive the game
does not have, listed with its prerequisites below.

### Which worlds are which — the prerequisite measurement

The split the design wants is between worlds that can feed themselves and worlds that cannot. **No
instrument measures that.** The nearest cohort, `survival-short`, is keyed solely on
`slotCap.arable ≤ 0` (`lib/tick-harness/cohort-analysis.ts`) — not "no deposits, no arable land,
nothing to build on".

The measured evidence cuts against the identification: 91.5% of the landless cohort is *not*
striking, and striking is dominated by small worlds (pop 10–100 at 14.7% vs pop ≥ 1K at 0.0%).
The untested alternative explanation for the parked cohort is the **crowd-brake equilibrium** —
growth held near zero by housing, not by shortfall. Which mechanism is parking them is unmeasured
and is the first thing to establish.

**Prerequisite:** a harness cohort keyed on this design's own test — no deposits **and** no arable
**and** nothing to build on — measured at both horizons, and a measurement of what actually holds
the parked cohort at constant population. Any figure for "how many struck worlds are unviable"
before that is a guess.

The predicate itself does not exist either. The raw fields are on `StarSystem` — `slotArable`,
`slotWater`, `slotBiomass` and the rest of the slot counts (`lib/world/types.ts:98-105`) with their
yield multipliers (`:106-112`) — but nothing folds them into a judgement. It must be named
`canSustainItself`, not `viable`: `viable` already means `popCap ≥ seedPop` at colony founding
(`lib/engine/directed-build.ts`).

### Abandonment: a world is allowed to die

A world that cannot sustain itself should decline until it empties and returns to the map as a
candidate for later resettlement. **Four things stand between the current code and that outcome.**

**There is no un-develop primitive.** `control` is written toward `developed` in exactly one place
(`lib/world/tick.ts:491`) and never reversed; the ladder is documented one-way ("unclaimed frontier
→ controlled (outpost tier) → developed", `lib/world/types.ts:74`); and a shipped invariant test
asserts that non-developed systems hold population exactly 0
(`lib/world/__tests__/developed-gate-invariant.test.ts:34`) and relies on monotonicity in a comment
(`:45`). The reversion was anticipated — `addMarketsForSettledSystems` leaves existing rows alone so
a redeveloped system "keeps its warehouses" (`lib/world/tick.ts:498-505`) — and never built.

**A husk cannot be resettled.** Colony candidates require `control === "controlled"`
(`lib/world/tick.ts:1065`) and claims require an unclaimed system (`:1037`), so a world left
`developed` with a `factionId` is a candidate for neither. Every repopulation path is headroom-gated
to zero once housing is gone: the relief-housing valve (`lib/engine/directed-build.ts:185-198`),
migration's `destHeadroom` (`lib/engine/migration.ts:113,124`) and colonist delivery's water-fill
(`lib/engine/colonist-delivery.ts:118-128`).

**Decline never completes on its own.** All three `populationDelta` terms are proportional to
population, so decay is exponential and never reaches zero. Worse, the loop has a stabilising
feedback: a shrinking population shrinks demand, which raises satisfaction against the same
delivery, which raises Provision and lowers unrest — while `popCap` tracks population down
(`housingFloor`, `lib/engine/infrastructure-decay.ts:157`) so `crowdFactor` stays 1 and never
brakes growth. The world settles half-dead at an interior fixed point. **The trigger must therefore
be a sustained-decline counter or a population floor that bypasses the Provision term entirely** —
an instantaneous state test parks the world at that fixed point instead of finishing it, and an
unrest-keyed trigger is additionally disabled by the adaptive expectation (a world used to misery
is calm).

**An emptied world reads as a clean Supplied datapoint.** Zero demand means every row is skipped
(`lib/tick-harness/good-satisfaction.ts:42`), the fold returns Provision 1 on empty weight, and the
band reads Supplied. The harness counts it in every settled denominator. So the outlier this item
exists to remove does not disappear — it changes sign, from a permanent worst reading to a
permanent perfect one.

**What the item must specify:** the sustained-decline trigger and its threshold; the target
`control` state and the `factionId` disposition (both must land somewhere the claim and colony
providers will pick the world up again); what happens to buildings, market rows and `popCap`; which
processor owns the write; how the developed-gate invariant is re-authored now that `control` is no
longer monotonic; and that abandoned systems leave the harness's settled denominator **before** any
baseline is measured over them.

### Relief: a viable world is bought out of the loop

A world that can sustain itself but cannot break the strike loop unaided gets a **player-funded
intervention**: spend from the treasury to deliver goods, at a cost that is felt. Relief is
deliberately specified as **spending to move goods**, not as spending to remove unrest — a relief
convoy arriving is a thing the player can watch and understand as the cause of the recovery, and it
uses the logistics simulation rather than bypassing it. Under the adaptive expectation, relief is
also *visible* in the response: a recovering world's unrest eases while it recovers, which is the
feedback that makes the spend legible.

**Three prerequisites, none of which exist.**

*A treasury home.* `TreasuryBands` is exactly three bands (`lib/engine/treasury.ts:15-20`), and
there is an authored precedent explicitly refusing a fourth: colony founding is "its own field,
never a fourth band: `TreasuryBands` is shared by the sliders, the bills and the latched funding
fractions, and founding is none of those — it is taken off the top, ahead of the ladder"
(`lib/world/types.ts:363-368`). Relief is either off-the-top on the same footing or a named band,
and the item must state which — plus its precedence against `pendingFounding`, which already drains
the balance before the ladder divides anything (`lib/tick/processors/treasury.ts:146-151`).

*A targeted-transfer primitive.* Directed logistics is a pure autonomic surplus↔deficit matcher;
there is no targeted-transfer or order concept anywhere, and player orders exist for construction
only. The item must specify the new export, its reserve rules and its reachability rules.

*A costing.* There is no logistics-cost mechanic in the repo — no spec, no roadmap row, no
constant — so the item either specs its cost self-containedly or is gated on that row being booked
first.

One consequence worth stating before the item is designed: the logistics work budget is
population-funded (`lib/tick/processors/directed-logistics.ts:51`), so a world already emptying
contributes less budget to its own rescue. And "spend to move goods" cannot buy haul capacity
without a stated, deliberate exception to the shipped invariant that money is fuel, not capacity.

## Sequence

Each item is measured before the next starts. (Renumbered from the original five-item sequence:
item 1 shipped; the old item 2, the change term, is absorbed into the adaptive expectation as its
fastest-decay calibration arm.)

1. **The adaptive expectation** — the persisted per-world baseline; unrest responds to supply
   measured against it. Adds the one persisted field; slopes re-derived; founding invariant and
   interim `slopeRationing` retire. The decay-rate sweep is the item's calibration, with the
   one-cycle arm reproducing the old change term for comparison.
2. **Abandonment** — a world that cannot sustain itself declines to empty and returns to the map.
   Gated on: the `canSustainItself` predicate, the viability cohort in the harness (the
   prerequisite measurement above), the un-develop primitive, and the re-authored developed-gate
   invariant. Trigger keys on sustained physical decline, never unrest.
3. **Relief** — a player-funded intervention buys a viable world out of the strike loop.
   Independent of abandonment. Gated on: the treasury accounting decision, the targeted-transfer
   export, and either a self-contained costing or a booked logistics-cost row.

## Design hazards worksheet

(Rows for the shipped item 1 are retired with it; these are the rows the remaining items still
need, updated to the post-gate state.)

### One quantity, several unrelated jobs

| Quantity | Readers | What the expectation item moves | Decision required |
| --- | --- | --- | --- |
| the shortfall `1 − Provision` | unrest integral; growth factor (`populationDelta`); harness | unrest's reading becomes expectation-relative | whether growth stays absolute (default lean: yes — bodies need goods, not satisfied expectations), stated in the item's spec |
| `slopeRationing` / `slopeShortage` | `unrestSlope`; `band-constants.test.ts` guarantees | re-derived against expectation-relative shortfall; interim `slopeRationing` (0.95) retires with the founding invariant | the durable constraints that survive: broad shortage on an established world still strikes; either survival good's total failure can collapse an untaxed world (`slopeShortage` × food's ~0.32 basket share ≥ 0.75) |
| `unrest` | strike suppression, migration, infrastructure teardown, overshoot split | unchanged in meaning — still the [0,1] integral; only what feeds it changes | — |

### A constant read for a meaning it was not authored to have

| Constant | Authored meaning | Remaining-item use | Same thing? |
| --- | --- | --- | --- |
| `SHORTAGE_SATISFACTION` | the famine line (survival floor; `fed()`) | unchanged; the expectation must not reach it | Yes — famine stays absolute by design |
| `STRIKE_PARAMS.threshold` = 0.65 | "only genuinely high-unrest systems strike" | unchanged; the expectation changes how many worlds reach it | Yes |
| `UNREST_PARAMS.decay` = 0.06 | the single relaxation rate (interim, no heavy calibration) | interacts with the baseline's decay rate — two time constants in one loop; the oscillation check at the item's gate exists for this pair | re-examine together at the item |
| `viable` (directed-build) | `popCap ≥ seedPop` at founding | must NOT be reused for the sustainability predicate | name the new one `canSustainItself` |

### A system you did not think about

| System | Interaction with the remaining items |
| --- | --- |
| Events | a transient production event now also produces an expectation *shock on recovery* (supply returns above baseline) — the ringing check at the expectation gate covers it; abandonment must not trigger off an event-length decline |
| Migration | reads unrest via contentment — an expectation-calmed poor world stops shedding population; state whether that is wanted (it is the "content frontier" behaviour, but it also slows abandonment's feeder) |
| Save format | the expectation item adds the one persisted field (optional, defaulted, finite-guarded, seeded at founding/world-gen); abandonment changes what `control` may hold and the developed-gate invariant |
| The harness's own metrics | expectation-relative unrest re-keys every unrest baseline; the abandoned cohort must leave the settled denominator before any baseline is measured; Gate 2's absolute-Provision distributions stay comparable (the fold itself does not change) |

### A symptom asserted without a measurement — or with the wrong one

| Claim | Evidence | Horizon | Cohort |
| --- | --- | --- | --- |
| the fixed bar makes supply's unrest share shrink as the galaxy matures | mean shortfall 0.065 → 0.038 while mean unrest 0.054 → 0.153 (tax + crowding floor up to 0.23) | startup → equilibrium, same run (Gate 2, post-swap arm) | all settled |
| the founding cohort is modal and worst-supplied | 562 of 582 settled; opening Provision mean 0.74 / p10 0.62 | equilibrium | founding cohort |
| strikes are small-world, not landless-world | pop 10–100 14.7% vs pop ≥ 1K 0.0%; survival-short 91.5% not striking | equilibrium (Gate 2) | pop bands; survival-short |
| nothing is emptying | Emptied 0, Stranded 0 | both horizons (Gate 2) | all settled |
| the strike loop's planner exit narrowed less than feared | `strikeExplains` suppression fell 2.38% → 0.86% (10k), 1.97% → 0.71% (12k) across the step-1 swap | both + 12k | per eligible (system, good) pair |
| what parks the struck cohort is unmeasured | no cohort keys on the three-way viability test; crowd-brake hypothesis untested | — | — |

### Designing against a threshold, signal or primitive that does not exist

| Consumes | Produced at | Actual shape today | Design assumes |
| --- | --- | --- | --- |
| a persisted prior-supply reading | **nowhere** — `EconomySignals` is transient, one tick (`lib/tick/types.ts:47-57`) | in-memory only | the expectation item adds the baseline field |
| un-develop / abandonment transition | **nowhere** — `control` written toward `developed` only (`lib/world/tick.ts:491`); invariant asserts monotonicity | one-way ladder | abandonment builds it and re-authors the invariant |
| resettlement of an emptied world | claims need unclaimed (`lib/world/tick.ts:1037`); colony candidates need `controlled` (`:1065`); repopulation headroom-gated to zero | a `developed` husk is a candidate for nothing | abandonment states the target `control` + `factionId` |
| targeted logistics transfer | **nowhere** — autonomic matcher only; player orders exist for construction only | — | relief builds it |
| a fourth treasury category | **nowhere** — three bands + `foundingExpense` off the top | — | relief chooses (band vs off-the-top) and states precedence |
| a viability predicate | **nowhere** — raw slot fields only (`lib/world/types.ts:98-112`); `viable` is taken | — | `canSustainItself`, written before abandonment is designed |
| a viability cohort in the harness | nearest is `survival-short` (`slotCap.arable ≤ 0` alone) | one slot test | the three-way test, added before any unviability figure is quoted |

### Designing against an aggregate that moves for other reasons

| Metric | What else moves this number |
| --- | --- |
| band shares / mean Provision | **founding rate — the dominant confounder** (562 colonies at equilibrium vs 233 at startup, each opening at the galaxy's worst supply state); the maturity trajectory; event incidence |
| mean unrest / strike share | tax stance + crowding: an additive floor up to 0.23 before supply contributes anything; under the expectation, the *baseline's own drift* becomes a further mover — record the decay setting beside every reading |
| galaxy-wide net growth | the crowd brake (mean occupancy > 1 at equilibrium), migration and colonist delivery redistributing rather than creating, overshoot-death above the strike threshold |
| `strikeExplains` suppression | the eligible-pair count grows with the galaxy — read as a rate per eligible pair, never a raw count |
| abandoned-world count | an emptied world reads Provision 1.0 / Supplied on an empty basket — it must leave the settled denominator first or it inflates every supply reading |
