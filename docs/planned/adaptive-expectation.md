# Adaptive Expectation — Unrest Judges Against Memory

## Headline

Each world carries a persisted memory of the supply it is used to — a slow-moving baseline of its own
Provision. Unrest's supply term reads the gap between **memory and delivery**, not the distance from
perfection: doing worse than your memory hurts, matching it is peace, whatever the absolute level. A
frontier colony that has always scraped by is content; a rich world that dips is not; a world whose
supply is falling radicalises while its level still looks fine, and a recovering one visibly calms.

Memory adjusts asymmetrically — **standards rise quickly when life improves, resignation comes slowly
when it worsens** — so improvement breeds expectation (the treadmill that keeps developed worlds
demanding) and decline keeps stinging long after it starts.

Three absolute backstops ignore memory entirely:

- **Famine.** Survival goods keep reading the objective situation — a world cannot get "used to"
  failing water or food. The survival override composes exactly as shipped.
- **Critical goods.** The critical-good override keeps reading absolute per-good satisfaction — a
  collapsed vital good escalates severity wherever it happens, however accustomed the world.
- **The floor.** No population normalises living on half of what it needs: below an expectation of
  0.5, absolute pressure resumes no matter the history.

Everything else that reads supply stays absolute on purpose: the **band label** (a world at 0.6 is
Rationing however accustomed it is — the label tells the truth about supply, only the *response* is
relative), **population growth** (bodies need goods, not satisfied expectations), and the harness's
Provision distributions (the comparability anchor across this change).

This is the mechanism that retires the founding-strike scaffolding: a newborn colony's memory seeds
from its opening state, so it opens calm at any tax level structurally, and the interim
`slopeRationing` (0.95, deliberately whispered so week-one colonies would not strike) is re-cut to
what established worlds actually need. It also subsumes the old "change term" roadmap item: the
memory's fastest-decay setting *is* a one-cycle change response, and the calibration sweep covers the
spectrum from there to full normalisation.

## Why — the evidence

All figures from the step-1 gate of the shipped Provision change (600 systems, seed 42, scale 100;
startup = 1,000 ticks, equilibrium = 10,000, plus the 12k checkpoint) — the full tables live in
[supply-response.md](./supply-response.md).

**The fixed bar makes the supply channel go inert as the galaxy succeeds.** Between the horizons,
mean shortfall nearly halves (0.065 → 0.038) while mean unrest triples (0.054 → 0.153) — the rise is
entirely tax and crowding (an additive standing floor of up to 0.23). At equilibrium ~96% of worlds
sit within a few percent of fully supplied, and any slope times a near-zero shortfall is a rounding
error against that floor: the stability map becomes a tax-and-crowding map, nothing escalates on
deterioration, nothing visibly calms on recovery. No re-cut of the constants fixes this — the
reference being fixed is itself the problem.

**The founding cohort is the modal world, and the scaffolding that protects it flattens everyone.**
562 of 582 settled worlds at equilibrium are colonies; their opening Provision is mean 0.74 /
p10 0.62. The interim `slopeRationing` 0.95 was cut inside the window [0.84, 1.07] that the
founding-strike invariant allowed — a constraint about week-one colonies dictating the unrest
response of the whole galaxy. Under the memory bar the newborn's grievance is ~0 by construction and
the window dissolves.

**Design shape decisions, made against that evidence** (alternatives considered and rejected, so
they are not re-proposed):

- **Full replacement of the reference, not a blend.** A blended absolute/relative term re-imports
  the fixed-bar problem scaled by the blend weight, and adds a dial nothing in the game explains.
  The absolute backstops are instead scoped to where absoluteness is credible — survival, critical
  goods, the destitution floor — rather than smeared across every good as a weight.
- **Not an additive change term on top of the absolute level.** That was the old roadmap item 2; it
  reacts to movement but leaves the mis-placed bar untouched underneath. It survives here as the
  fastest-decay calibration arm, not as code.
- **Growth stays absolute.** Unrest is a political response and reads against expectations; growth
  is a biological one and reads the goods themselves. A contented frontier world is calm but still
  grows slower than a fully-fed core — contentment does not erase the material incentive to supply
  colonies, it stops punishing the player with riots while they get there.
- **The migration side-effect is wanted.** Migration reads unrest, so a poor-but-accustomed world
  stops shedding people: stable poor worlds hold their population, only declining or crisis-struck
  worlds drive emigration. The material pull side (headroom, attractiveness) is untouched.

## The mechanism

### The persisted baseline

One new optional field on the system: the stored expectation, a number in [0, 1] representing the
Provision this world is accustomed to.

- **Seeding — one rule for every case:** an absent baseline seeds from the current cycle's Provision
  at first use. This covers world-gen (first economy cycle), colony founding (first cycle after the
  staged manifest lands on the new market rows), and old saves loading, with no special cases.
- **Update — once per cycle, by the population processor** (the fold's owner), *after* the unrest
  read, so the response this cycle is judged against the memory as the cycle started:

  `stored ← stored + λ × (P − stored)` where `P` is this cycle's Provision and `λ` is
  `EXPECTATION_RISE_RATE` when `P > stored` (standards rise) or `EXPECTATION_RESIGN_RATE` when
  `P < stored` (resignation). Both rates are reference-cycle-denominated, scaled by
  `catchUpFactor(interval)` and clamped to [0, 1] after scaling, like the existing relaxation rate.
- **Serialization:** written clamped finite into [0, 1] (a non-finite value would serialize to
  `null` and corrupt the save); tolerated absent on load.
- The **effective expectation** the unrest fold reads is `E = max(stored, EXPECTATION_FLOOR)` — the
  floor is applied at read, not written into the store, so the stored value remains an honest memory
  and the floor stays a policy that can move.

An emptied world reads Provision 1 on an empty basket (shipped, load-bearing), so its expectation
drifts to 1 — harmless in itself; the abandonment item removes such worlds from the settled
denominator before measuring over them.

### What unrest reads

The unrest integral (`accumulateUnrest`) keeps its exact shape — relaxation toward the standing
tax + crowding floor, gain = slope × rate, fixed point `floor + slope × shortfall` — and changes
only what the supply term reads. The term becomes **whichever is larger of two readings** (max, not
sum — a world in famine that also dropped below its memory must not count the same missing goods
twice; famine dominates rather than composes, as shipped):

- **The grievance term (relative).** `slope(G) × G`, where `G = clamp(E − P, 0, 1)` is the
  expectation-relative shortfall and the slope ramps from `slopeBase` toward `slopeShortage` across
  an escalation ramp authored on the relative scale (`G_ESCALATION_CUT` / `G_ESCALATION_BLEND` —
  the shipped `D_SHORTAGE_CUT`/`D_SHORTAGE_BLEND` retire with their absolute-scale rationale, which
  existed to clear founding shortfalls, a job that no longer exists).
- **The crisis term (absolute).** Fires only in the severe absolute states and reads the absolute
  shortfall `D = 1 − P`: a survival shortfall reads `slopeShortage × D` outright (identical to the
  shipped famine response); otherwise a non-zero critical-good weight reads
  `criticalWeight × (slopeShortage − slopeBase) × D`, capped at `slopeShortage × D` — the shipped
  override's severity arithmetic, kept on the objective scale so it never weakens on an accustomed
  world.

Unchanged, explicitly: the standing floor (tax + crowding) and its constants; the strike threshold
and collapse line; `provision()`/`dissatisfaction()` and the whole economy-side fold;
`EconomySignals` (the expectation is population-side state, not an economy signal); the band fold
and every band constant; growth's `1 − D` factor and migration's inputs (both keep absolute
readings); the meaning of `unrest` itself — still the [0, 1] integral every existing reader
consumes, which is what keeps all 26 reader modules and 3 downstream processors deliberately
untouched.

`slopeRationing` is renamed `slopeBase` at the re-cut: the band has gated no rate since the
Provision change shipped, and the value no longer has anything to do with the Rationing band.
`slopeShortage` keeps its name — it is still the famine slope.

## The guarantees

The shipped guarantee suite (`band-constants.test.ts`) re-authors to four promises. Values below are
authored starting points that satisfy all four on paper; exact constants are derived at
implementation against the suite and verified in the calibration sweep.

| # | Promise | How it holds |
| --- | --- | --- |
| 1 | **A newborn colony opens calm at any tax level.** | Structural: memory seeds at opening state, so `G = max(0, 0.5 − opening P)` — zero unless founded below the destitution floor. Worst measured opening (p10 0.41, pre-change arm) gives G ≤ 0.09 → term ≤ ~0.15, plus the max standing floor 0.23, far below strike 0.65. Replaces the founding-strike invariant test; the interim `slopeRationing` 0.95 and its [0.84, 1.07] window retire. |
| 2 | **Total failure of either survival good collapses an untaxed world.** | Verbatim from the shipped suite: the crisis term reads the absolute scale, so `slopeShortage` 2.4 × food's ~0.32 basket share ≥ the 0.75 collapse line carries over unchanged. |
| 3 | **Broad shortage on an established world strikes while its memory holds.** | A fully-accustomed world (E ≈ 1) that loses **half** of what it is used to (G ≥ 0.5) reaches strike-level settled unrest at zero tax: with the ramp engaged, term(0.5) ≈ 1.0 ≥ 0.65. The anger is guaranteed for the episode and fades only as resignation sets in — deliberately: chronic decline stings for a long time (the slow resign rate), but not forever. |
| 4 | **A modest dip never collapses, at any tax.** | Dip-depth containment, replacing band containment: losing less than a **quarter** of what you are used to (G ≤ 0.25) stays below the 0.75 collapse line even at the max standing floor: 1.6 × 0.25 + 0.23 = 0.63. Collapse requires a deep dip, famine, or the crisis term. |

Promises 3 and 4 are compatible because the escalation ramp sits between their lines (flat
`slopeBase` through the containment region, escalating toward `slopeShortage` before the
strike-guarantee depth) — a flat slope alone cannot carry both, which is the ramp's re-authored job.
The remaining shipped guarantees (no single non-survival good alone reaches strike at any tax;
overshoot death gated on the strike threshold; crowding pressure bounded below strike) are carried
over and re-verified on the new term at implementation.

Band containment ("Supplied and Strained never collapse") is **consciously retired**, not lost: a
max-taxed world that lived at 1.0 and fell to the Strained band is carrying a real grievance the
shipped guarantee never contemplated. Its successor is promise 4's dip-depth form.

## Constants

| Constant | Authored start | Rule its docstring must carry |
| --- | --- | --- |
| `EXPECTATION_FLOOR` | 0.5 | "No population normalises living on half of what it needs." Applied at read as `max(stored, floor)`. Independent of `SHORTAGE_SATISFACTION` despite the equal value — that is the famine line on one good's satisfaction, this is a floor on remembered whole-basket Provision; do not couple them. |
| `EXPECTATION_RISE_RATE` | 0.25 / cycle | Standards rise fast (half-life ~2–3 cycles). Sweep-decided; stated per reference cycle and catch-up-scaled, so a tick-tempo retune does not invalidate it. |
| `EXPECTATION_RESIGN_RATE` | 0.02 / cycle | Resignation comes slowly (half-life ~34 cycles). Sweep-decided, same denomination. Setting both rates to 1 reproduces the old change term (memory = last cycle) — that arm exists for comparison, not shipping. |
| `slopeBase` (renamed from `slopeRationing`) | 1.6 | Settled unrest above the floor per unit of *grievance* while un-escalated. Bounded above by promise 4 (< (0.75 − 0.23)/0.25 ≈ 2.08); no longer bounded below by founding (promise 1 is structural). Interim-0.95 docstring and its no-heavy-calibration note retire. |
| `slopeShortage` | 2.4 (unchanged) | Derivation unchanged — either survival good's total failure collapses an untaxed world through the crisis term. |
| `G_ESCALATION_CUT` / `G_ESCALATION_BLEND` | 0.35 / 0.30 | The ramp on the relative scale: flat through the containment region (≤ 0.25), full escalation before the strike-guarantee depth (0.5 → slope 2.0). Replaces `D_SHORTAGE_CUT`/`D_SHORTAGE_BLEND`, whose absolute-scale placement rationale (clearing founding shortfalls) no longer exists. |
| `UNREST_PARAMS.decay` | 0.06 (unchanged) | Now one of three time constants in the loop (with rise/resign) — the oscillation check at the gate exists for exactly this pairing. |

## Calibration and the gate

The decay-rate pair is the item's calibration — this is where the old change-term item's experiment
lives. The harness sweeps rise × resign as config experiments (`npm run simulate -- --config`),
covering the spectrum from the one-cycle arm (both 1 — the old change term) to deep normalisation,
with the authored pair as the centre. Every reading records the decay setting beside it — under the
expectation, the baseline's own drift is a mover of every unrest metric.

*Gate metrics, cohorted, both horizons plus 12k, against the step-1 gate baselines:*

- **Strike share and unrest distribution per cohort** — read trailing-window where churn matters
  (striking is a churn metric).
- **Founding-cohort opening trajectory at every tax level** — the newborn-calm promise observed live
  once the invariant is gone, not just unit-tested.
- **A recovering-world trace** — unrest visibly easing during recovery while the level is still
  poor: the behaviour the fixed bar cannot produce, observed as a trajectory, not an average.
- **Oscillation / ringing check** — the memory's time constants against the relaxation rate; an
  event-driven dip-and-recovery must not ring (the transient event now also produces a
  recovery-side expectation shock).
- **Comparability anchor** — absolute Provision and band distributions must be unchanged across
  arms at fixed seed (the economy-side fold is untouched); if they move, the instrument is broken,
  not the galaxy.
- **Harness additions:** expectation and grievance distributions, cohorted, plus the trace
  instrument for the recovery read.

## What this item does not do

- **No UI surface.** The booked Provision-display roadmap row is where player-facing supply surfaces
  land; an expectation/grievance readout can join it later. This item is engine + harness only.
- **No abandonment, no relief** — next on the arc ([supply-response.md](./supply-response.md)). Two
  interactions are binding on them now: abandonment's trigger keys on sustained physical decline,
  never unrest (a world that normalises its own misery goes quiet — an unrest-keyed trigger would be
  disabled by this item); and abandoned worlds leave the settled denominator before any expectation
  baseline is measured over them.
- **No precision tuning of unrelated constants** — the roadmap's standing *Don't* (the expectation
  re-derives the slopes) resolves at this item; downstream tuning waits for its gate.

## Design hazards worksheet

### 1. One quantity, several unrelated jobs

`npm run impact` outputs, summarised (run 2026-08 against the current tree):

| Quantity | Every reader today | Which this design moves | Intended? |
| --- | --- | --- | --- |
| `unrest` (the field) | SHARED — 83 refs / 26 modules. Three processors read it via their declared interfaces — population (integral, decline, overshoot death), migration (attractiveness), infrastructure-decay (teardown severity) — plus economy touches it undeclared (strike suppression via `strikeMultiplier`); industry (health labels), 10 UI/service modules (stability surfaces) and the harness (means, strike counts) read it downstream | **None in meaning** — still the [0, 1] integral; only the term feeding it changes. Every reader is deliberately kept coupled. | Yes — the whole design is "change what feeds it, not what it means". |
| the shortfall `1 − P` | unrest integral (`lib/tick/processors/population.ts:60`), growth factor (`:63` → `populationDelta`), harness `meanShortfall` | Unrest's reading becomes the grievance `G`; growth and the harness keep the absolute reading — the processor threads **two** shortfalls where it now threads one. | Yes — the political/biological split, decided explicitly. |
| `UNREST_PARAMS` | CONTAINED — `lib/constants/population.ts:55` (author), `lib/world/tick.ts:879` (threads to processor) | Gains the expectation rates; `slopeRationing` → `slopeBase` rename touches both plus the guarantee suite. | Yes. |
| `D_SHORTAGE_CUT`/`BLEND` | CONTAINED — `lib/engine/population.ts:258-259` only | Retired, replaced by `G_ESCALATION_*` on the relative scale. | Yes. |
| the stored expectation (new) | population processor (read + sole writer), harness instruments | New — one writer, authored before a second reader exists. Abandonment/relief consume its *derived* worsening-vs-recovering signal later, via a stated read, not raw field access. | Yes. |

### 2. A constant read for a meaning it was not authored to have

| Constant | Docstring says | This design uses it as | Same thing? |
| --- | --- | --- | --- |
| `SHORTAGE_SATISFACTION` (0.5) | the famine line on one good's satisfaction (`fed()`, survival override) | unchanged — the crisis term's trigger | Yes. The **numeric coincidence** with `EXPECTATION_FLOOR` is called out in both docstrings so nobody couples them. |
| `STRIKE_PARAMS.threshold` (0.65) | "only genuinely high-unrest systems strike" | unchanged; the expectation changes how many worlds reach it | Yes. |
| `INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold` (0.75) | the collapse/teardown line | promise 4's containment target | Yes — the promise is authored against this reader by name. |
| `UNREST_PARAMS.decay` (0.06) | the single relaxation rate (interim, no heavy calibration) | unchanged value; now one of three time constants — the gate's ringing check pairs them | Re-examined together at the gate, as its docstring note anticipated. |
| `GOOD_NECESSITY` | authored per-good unrest-fold weight | unchanged, via the untouched `provision()` | Yes. |
| `TAX_LEVEL_UNREST_PRESSURE` + `CROWDING.PRESSURE_MAX` | the standing floor (max 0.23) | unchanged — the floor stays absolute | Yes. |

### 3. A system you did not think about

| System | Interaction | Reason if none |
| --- | --- | --- |
| Events | A production event now drives a *grievance* episode (P dips below E while E resigns slowly — the drama this item exists to create) and a recovery-side shock when P returns; the gate's ringing check covers the pair. No new event hooks. | — |
| Population + migration | The core surface. Migration's content-frontier behaviour decided wanted (above). | — |
| Unrest / regime | The change itself. Strike/collapse thresholds untouched. | — |
| Industry + staffing | none directly | Reads unrest only through health labels and the strike multiplier, whose meanings are unchanged; incidence shifts are gate metrics. |
| Infrastructure decay | Teardown reads unrest ≥ 0.75 — promise 4 is authored against exactly this line. | — |
| Directed logistics | none | The matcher keys on stock/demand/bands, none of which change; the work budget reads population, not unrest. |
| Directed build / planner | `strikeExplains` suppression and fed-and-calm gating read unrest — incidence shifts, meaning does not. Baseline for the gate: suppression 0.86% (10k) / 0.71% (12k) per eligible pair. | — |
| Colonisation + founding manifest | Founding pacing is money-gated and untouched; the newborn seeds its memory lazily on its first economy cycle (after the manifest credits, so the seed reads the endowed state, not an empty market). | — |
| Treasury / purse | none | Tax pressure enters through the standing floor, which stays absolute and unchanged; no new spend exists in this item. |
| Factions + relations | none | Relations drift reads borders/doctrine/trade/alliances — no unrest input (`lib/tick/adapters/memory/relations.ts`). |
| Save format (`World` shape) | The one new optional field: clamped finite on write, tolerated absent on load (lazy seed), JSON-serializable number. Pre-1.0 saves that lack it load and seed on first cycle. | — |
| The harness's own metrics | Every unrest baseline re-keys (recorded beside the decay setting); absolute Provision/band distributions are the cross-arm comparability anchor; expectation/grievance distributions and the recovery trace are new instruments. | — |

### 4. A symptom asserted without a measurement — or with the wrong one

| Claim | Evidence | Horizon | Cohort |
| --- | --- | --- | --- |
| the fixed bar makes supply's unrest share shrink as the galaxy matures | mean shortfall 0.065 → 0.038 while mean unrest 0.054 → 0.153 (standing floor up to 0.23) | startup → equilibrium, same run (step-1 gate, post-swap arm) | all settled |
| the founding cohort is modal and worst-supplied | 562 of 582 settled; opening Provision mean 0.74 / p10 0.62 | equilibrium | founding cohort |
| newborn grievance under the seed rule is ~0 | seed = opening P ⇒ G = max(0, 0.5 − opening P); p10 opening 0.62 > 0.5; worst measured arm p10 0.41 ⇒ G ≤ 0.09 | equilibrium | founding cohort |
| strikes are small-world, not landless-world | pop 10–100 14.7% vs pop ≥ 1K 0.0%; survival-short 91.5% not striking | equilibrium (step-1 gate) | pop bands; survival-short |
| the planner's strike-loop exit baseline | `strikeExplains` suppression 0.86% (10k) / 0.71% (12k) per eligible pair | both + 12k | eligible (system, good) pairs |
| slow chronic decline self-forgives at the resign rate | **hypothesis by construction** — the sweep's slow-resign arms measure it; this is the asymmetry's job, not a defect to fix elsewhere | — (gate) | — |

### 5. Designing against a threshold, signal or primitive that does not exist

| Consumes | Produced at | Actual shape today | Design assumes |
| --- | --- | --- | --- |
| a persisted prior-supply reading | **nowhere** — `EconomySignals` is transient, one tick (`lib/tick/types.ts:52-75`) | in-memory only | this item adds the stored expectation |
| per-system Provision each cycle | economy fold → `dissatisfactionBySystem` (= 1 − P), `ctx.results` | [0, 1], present for every system the shard processed; the population processor already consumes it (`lib/tick/processors/population.ts:44`) | read unchanged; P recovered as `1 − d` |
| survival + critical absolute readings | `supplyStateBySystem` (`lib/tick/types.ts:58`) — `survivalShortfall` bit + finite non-negative `criticalWeight` | produced by the untouched `foldSupplyState` | crisis term reads them as-is |
| tax standing pressure | `taxPressureBySystem` param (`lib/tick/processors/population.ts:51`) | [0, 1] after clamp with crowding | unchanged |
| catch-up scaling | `catchUpFactor` (`lib/tick/shard.ts`) | already scales the relaxation rate at `:38` | the two new rates scale identically |

### 6. Designing against an aggregate that moves for other reasons

| Metric | Read at which cohort | What else moves this number |
| --- | --- | --- |
| strike share | pop bands + survival-short, trailing-window | churn (crossing worlds), founding rate, event incidence — and now the decay setting; record it beside every reading |
| mean unrest | per cohort, never galaxy-first | tax stance + crowding floor (up to 0.23 before supply says anything); baseline drift under the expectation |
| founding-cohort trajectory | founding cohort, per tax level | founding *rate* (dominant confounder — each newborn opens at the galaxy's worst state); manifest generosity |
| grievance distribution | per cohort | event incidence, decay setting, the maturity trajectory |
| absolute Provision / bands | all settled (the anchor) | must NOT move across arms at fixed seed — the fold is untouched; movement means instrument breakage |
