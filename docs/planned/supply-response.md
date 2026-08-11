# Supply Response — Let the Score Drive

## Headline

A world's supply state is now one readable number — **Provision**, the necessity-and-demand-weighted
share of what a world needs — driving unrest and growth, with four descriptive bands, two explicit
severity overrides, and a persisted per-world **expectation** unrest is judged against: a frontier
colony that has always scraped by is content, a rich world that dips is not, and recovery visibly
calms a world while its level is still poor (both shipped; mechanism and guarantee ladder in
[economy.md](../active/gameplay/economy.md)). **Abandonment is also shipped** — people no longer
move to famine worlds (either inflow path), and a famine world below one pop resets to unclaimed
frontier (mechanism: [colonisation.md](../active/gameplay/colonisation.md), "A colony is allowed
to die"). What remains of this arc is one item:

- **Relief.** A player-funded intervention buys a viable world out of the strike loop — spending to
  *move goods* through the logistics simulation, never spending to delete unrest.

Relief consumes the worsening-vs-recovering signal the expectation baseline provides (deviation
from expectation), which is why it sequences after it.

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
mean 0.88 / p10 0.69 at startup). The pre-change arm (Gate 2 BASE) measured mean 0.73 / p10 0.41 at
equilibrium — the provenance of the shipped guarantee suite's 0.59-shortfall p10, whose original
citation target was folded away at the Gate 2 doc consolidation. At the time of this measurement the
founding-strike guarantee held the pre-expectation `slopeRationing` at 0.95 as interim scaffolding for
exactly this cohort. That scaffolding has since dissolved structurally, as predicted: the expectation
baseline shipped (a newborn's settlers expect frontier hardship, so its expectation-relative shortfall
is ~0 at any tax), `slopeRationing` is retired, and the slopes were re-derived — the surviving one is
`UNREST_PARAMS.slopeBase` (1.6) — leaving only the durable constraints (broad shortage on an
established world still strikes; famine's absolute floor).

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

Shipped — the mechanism (memory bar with asymmetric rise/resign rates, the 0.5 destitution
floor, the absolute famine/critical channels, the six-promise guarantee ladder, constants) lives in
[economy.md](../active/gameplay/economy.md). This doc keeps only what the *later* items need from
it:

- Relief consumes the **worsening-vs-recovering signal** (deviation from baseline) as a derived,
  stated read — never raw field access.

## The strike loop — where it stands after abandonment

A striking world makes less, which supplies it worse, which keeps it striking. The prerequisite
measurement (2026-08-10; evidence preserved in git — `docs/build-plans/abandonment.md` at
`4631eeab`) found the fork it was asked to settle was a false dichotomy: the chronically striking
worlds were **starving but not shrinking** — held at exactly `popCap` by colonist delivery
restocking their dead every cycle — while the broader parked small-world cohort was fed and
crowd-held (healthy). That produced the shipped abandonment scope: a stateless famine gate on both
population-inflow paths plus a one-pop death line
([colonisation.md](../active/gameplay/colonisation.md), "A colony is allowed to die").

**What remains for relief, measured post-abandonment (same seed/conditions):** famine strikers now
genuinely decline (−30.7% per 50 cycles) and will die or rebalance on their own. The residual
strike-loop cohort relief exists for is different in kind: **large rationing-regime worlds that
are not in famine** — measured instance: a pop-2,280 world with arable land, Provision 0.63,
unrest 0.72, parked at its cap with a flat trend — plus any world that calms at a tiny size and
never recovers on its own (one observed below one pop). The famine gate deliberately does not
touch either: they are fed enough to live and stuck enough to need buying out — exactly relief's
premise.

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

1. **The adaptive expectation** — SHIPPED (mechanism + guarantees:
   [economy.md](../active/gameplay/economy.md)). The persisted per-world baseline; unrest responds
   to supply measured against it; the founding invariant and interim `slopeRationing` retired. All
   three gate decisions resolved no-change except the stability-label edge re-read.
2. **Abandonment** — SHIPPED, deliberately smaller than originally sketched (owner call: minimal,
   temporary until the logistics pass unifies people-movement). A stateless famine gate on both
   population-inflow paths plus the one-pop death line; the `canSustainItself` predicate and
   viability cohort were dropped from scope after the measurement showed the three-way test marks
   none of the actually-stuck worlds. Mechanism:
   [colonisation.md](../active/gameplay/colonisation.md), "A colony is allowed to die".
3. **Relief** — a player-funded intervention buys a viable world out of the strike loop.
   Gated on: the treasury accounting decision, the targeted-transfer export, and either a
   self-contained costing or a booked logistics-cost row.

## Design hazards worksheet

(Rows for the shipped items are retired with them; these are the rows relief still needs.)

### One quantity, several unrelated jobs

No quantity row is specific to relief yet — its spec fills this section when written.

### A system you did not think about

| System | Interaction with relief |
| --- | --- |
| Events | a relief order racing an event-driven famine — does relief target the event dip or the chronic state? |
| Migration + the famine gate | relief goods arriving lift a world out of survival shortfall, which re-opens population inflow the same cycle — relief's visible effect includes people returning, state that |
| Abandonment | a world relief is actively supplying can still cross the one-pop death line if the goods arrive too late — decide whether an active relief order suspends the trigger or the race is accepted |
| The harness's own metrics | relief spend must be attributable (the treasury spend-attribution tooling row is a prerequisite) |

### A symptom asserted without a measurement — or with the wrong one

| Claim | Evidence | Horizon | Cohort |
| --- | --- | --- | --- |
| the residual strike cohort is rationing-regime, not famine | post-abandonment diag: famine strikers decline at −30.7%/50cyc; remaining chronic strikers are non-famine rationing worlds (one at pop 2,280 with arable) | equilibrium, seed 42 | chronic strikers (trailing-window definition) |
| a calmed sub-floor ghost exists | 1 settled world below one pop, not in famine, persisting | equilibrium, seed 42 | all settled |

### Designing against a threshold, signal or primitive that does not exist

| Consumes | Produced at | Actual shape today | Design assumes |
| --- | --- | --- | --- |
| the worsening-vs-recovering signal | the shipped stored baseline (`provisionExpectation`; read via `lib/engine/expectation.ts`, never raw field access) | **live** | relief consumes it as a derived read |
| targeted logistics transfer | **nowhere** — autonomic matcher only; player orders exist for construction only | — | relief builds it |
| a fourth treasury category | **nowhere** — three bands + `foundingExpense` off the top | — | relief chooses (band vs off-the-top) and states precedence |
| per-category spend attribution | **nowhere** — one merged `foundingDebitsByFaction` figure | — | the ROADMAP tooling row lands first |

### Designing against an aggregate that moves for other reasons

| Metric | What else moves this number |
| --- | --- |
| band shares / mean Provision | **founding rate — the dominant confounder** (562 colonies at equilibrium vs 233 at startup, each opening at the galaxy's worst supply state); the maturity trajectory; event incidence; and now abandonment removing worst-cohort members from the settled denominator |
| mean unrest / strike share | tax stance + crowding: an additive floor up to 0.23 before supply contributes anything; under the expectation, the *baseline's own drift* becomes a further mover — record the decay setting beside every reading |
| galaxy-wide net growth | the crowd brake (mean occupancy > 1 at equilibrium), migration and colonist delivery redistributing rather than creating, overshoot-death above the strike threshold, and famine worlds now genuinely declining |
| `strikeExplains` suppression | the eligible-pair count grows with the galaxy — read as a rate per eligible pair, never a raw count |
