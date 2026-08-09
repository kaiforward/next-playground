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
- **Critical goods.** The critical-good override keeps the shipped severity arithmetic on the
  absolute scale — a collapsed vital good escalates severity wherever it happens, however accustomed
  the world, at today's strength (promise 6 pins this so no slope re-cut can silently weaken it).
- **The floor.** No population normalises living on half of what it needs: below an expectation of
  0.5, absolute pressure resumes no matter the history.

Everything else that reads supply stays absolute on purpose: the **band label** (a world at 0.6 is
Rationing however accustomed it is — the label tells the truth about supply, only the *response* is
relative), **population growth** (bodies need goods, not satisfied expectations), and the harness's
Provision distributions.

This is the mechanism that retires the founding-strike scaffolding: a newborn colony's memory seeds
from its opening state, so it opens calm at any tax level structurally, and the interim
`slopeRationing` (0.95, deliberately whispered so week-one colonies would not strike) is re-cut to
what established worlds actually need. It also subsumes the old "change term" roadmap item: the
memory's fastest-decay setting *is* a one-cycle change response, and the calibration sweep covers the
spectrum from there to full normalisation.

## Why — the evidence

All figures from the step-1 gate of the shipped Provision change (600 systems, seed 42, scale 100;
startup = 1,000 ticks, equilibrium = 10,000, plus the 12k checkpoint) — the full tables live in
[supply-response.md](./supply-response.md). Every number below carries its horizon inline.

**The fixed bar's defect, stated cohorted** (the galaxy-wide mean hides it — its own hazard-6 rule):
supply's contribution to unrest is already near-zero for the pop ≥ 1K cohort (mean Provision 0.995
at equilibrium) — for them the stability map is a tax-and-crowding map — while supply remains the
*dominant* unrest term for pop 10–100 (Provision 0.855, unrest 0.309, strike 14.7% at equilibrium)
and survival-short (0.894 / 0.250 / 8.5%). The fixed bar's failure is not that supply is inert
everywhere; it is that the response reads the **level** rather than deterioration and recovery: at
equilibrium 89.3% of settled worlds band Supplied (Provision ≥ 0.9), rising to 95.9% at the 12k
checkpoint, mean shortfall 0.038 against a standing floor of up to 0.23 — so for the healthy
majority nothing escalates when things deteriorate and nothing visibly calms on recovery, while
Provision p10 is 0.890 at equilibrium and 2.9% of worlds sit in famine — the inertness is a property
of the mean, not of the distribution. Between the horizons, galaxy mean shortfall nearly halves
(0.065 → 0.038, partly cohort mix: settled count grows 253 → 582 toward the well-supplied) while
mean unrest triples (0.054 → 0.153, entirely tax + crowding). No re-cut of the constants fixes a
fixed reference; the reference is the problem.

**The founding cohort is the modal world, and the scaffolding that protects it flattens everyone.**
562 of 582 settled worlds at equilibrium are colonies; their opening Provision is mean 0.74 /
p10 0.62 (post-change arm; the pre-change arm measured mean 0.73 / p10 0.41 — the provenance of the
shipped suite's 0.59-shortfall figure). The interim `slopeRationing` 0.95 was cut inside the window
[0.84, 1.07] that the founding-strike invariant allowed — a constraint about week-one colonies
dictating the unrest response of the whole galaxy. Under the memory bar the newborn's grievance is
~0 by construction and the window dissolves.

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
  grows slower than a fully-fed core.
- **Decline stays on unrest — the demographic flip is intended and stated.** Decline is
  unrest-scaled (`populationDelta`), so the political channel going relative carries decline with
  it: a poor-but-accustomed world in the "poor but fed" band (Provision roughly 0.55–0.8 — deeper
  poverty means a survival good is failing, famine fires absolutely, and decline continues at full
  force) flips from slowly dying to slowly growing toward its housing cap. Two amplifiers ride
  along, both intended: a calm world is a mild migration *attractor* (contentment is a positive
  pull term), and the overshoot-death sink (gated at strike-level unrest) switches off with the
  anger. Material misery still shrinks populations through the famine channel, which is absolute —
  and that channel is exactly the feeder the abandonment item needs, so its sustained-decline
  trigger keys on famine-driven or physical decline, never on the viable-poor middle. Gate metrics
  watch all three consequences (below).
- **The migration side-effect is wanted.** Stable poor worlds hold their population; only declining
  or crisis-struck worlds drive emigration. The material pull side is untouched.

## The mechanism

### The persisted baseline

One new optional field on the system: the stored expectation, a number in [0, 1] representing the
Provision this world is accustomed to.

- **Seeding — one rule, three clauses:** (1) an absent baseline seeds from the current cycle's
  Provision at first use — covering world-gen (first economy cycle), colony founding (first cycle
  after the staged manifest lands), and old saves loading. (2) A stored value that is non-finite or
  outside [0, 1] is **treated as absent and re-seeded** — "could not read" and "remembers
  perfection" are opposite readings, and the read-side guard is also what keeps E ≤ 1, on which
  famine dominance rests (below). (3) A system transitioning **into** `developed` clears any stored
  baseline, so a resettled world seeds from its own opening state exactly as a first-time colony
  does — re-development preserves market rows ("keeps its warehouses", `lib/world/tick.ts:504-505`)
  and would otherwise carry a drifted-to-1 baseline from the world's previous life into its new one.
- **Update — once per cycle, by the population processor** (the fold's owner), *after* the unrest
  read, so the response this cycle is judged against the memory as the cycle started:

  `stored ← stored + λ × (P − stored)` where `P` is this cycle's Provision and `λ` is
  `EXPECTATION_RISE_RATE` when `P > stored` (standards rise) or `EXPECTATION_RESIGN_RATE` when
  `P < stored` (resignation). A cycle where the world has no weighted basket (`Σ weight ≤ 0` — an
  emptying world) **skips the update**: an empty basket's Provision-1 reading is a denominator
  artifact, not an experience to normalise toward.
- **Catch-up: sub-stepped, not scaled.** The asymmetric update is nonlinear (branch-switching), so
  it is NOT catch-up invariant the way the relaxation rate is — one step at `λ × catchUp` diverges
  from `catchUp` steps at `λ` whenever P crosses the stored value inside the interval, and a scaled
  rate clamps at catchUp ≥ 4, silently breaking the rise:resign ratio. The update therefore applies
  as `catchUpFactor(interval)` sub-steps of the **unscaled** rates, branch re-evaluated per
  sub-step, which is invariant by construction. The cadence-invariance harness pair extends its
  comparison to expectation and grievance distributions.
- **Serialization:** written clamped finite into [0, 1] (a non-finite value would serialize to
  `null` and corrupt the save); read defensively per seeding clause 2. A unit test pins that a
  stored NaN, −1 and 2 each produce a finite unrest in [0, 1] and preserve famine dominance.
- **Plumbing — absence is load-bearing at every hop.** The field is optional through the whole row
  layer: `WorldSystem` → tick row → the population processor's state view → the update row →
  merge-back. The tick-row join deliberately **departs from the `collapseDebt` precedent**
  (`lib/world/tick.ts:203` coerces `?? 0`), because coercing absence to 0 here would destroy the
  lazy-seed marker and make every old save seed at stored 0 (E = floor) instead of its own
  Provision. A save-compat test pins it: a save with the field absent loads and seeds from the
  first cycle's Provision, not from 0.
- The **effective expectation** the unrest fold reads is `E = max(stored, EXPECTATION_FLOOR)` — the
  floor is applied at read, not written into the store, so the stored value remains an honest memory
  and the floor stays a policy that can move.

### What unrest reads

The unrest integral (`accumulateUnrest`) keeps its exact shape — relaxation toward the standing
tax + crowding floor, gain = slope × rate, fixed point `floor + slope × shortfall` — and changes
only what the supply term reads. The term becomes **whichever is larger of two readings** (max, not
sum — a world in famine that also dropped below its memory must not count the same missing goods
twice; famine dominates rather than composes, as shipped):

- **The grievance term (relative).** `slopeBase × G`, where `G = clamp(E − P, 0, 1)` is the
  expectation-relative shortfall and the slope is **flat** — one exchange rate, no escalation ramp.
  (The shipped `D_SHORTAGE_CUT`/`D_SHORTAGE_BLEND` ramp retires with its absolute-scale rationale;
  a relative-scale successor was drafted and **dropped at spec review**: the flat slope carries
  promises 3 and 4 on its own — the feasible window is [1.3, 2.08) and 1.6 sits inside it — and
  deep concentrated shortfalls already escalate through the famine and critical channels. If the
  calibration sweep shows deep dips genuinely need extra escalation, a ramp returns with measured
  justification.)
- **The crisis term (absolute).** Fires only in the severe absolute states and reads the absolute
  shortfall `D = 1 − P`: a survival shortfall reads `slopeShortage × D` outright (identical to the
  shipped famine response); otherwise a non-zero critical-good weight reads the **shipped override
  arithmetic on the absolute scale** — `min(slopeShortage, slopeBase + criticalWeight ×
  (slopeShortage − slopeBase)) × D` — the base slope always applies, with the critical weight
  escalating toward famine weight, capped there. This is deliberately the shipped shape: the base
  term is what makes it a real floor under the relative reading (a coefficient-only form is
  mathematically unreachable under `max()` for an accustomed world — criticalWeight ≤ 1 by
  construction, and it would need to exceed 2). Promise 6 pins the strength.

Famine dominance under the `max()` holds by construction **given E ≤ 1** (the read guard):
`G = E − P ≤ 1 − P = D` always, so the grievance term can never outrank `slopeShortage × D`.

**What the memory does to a jittering input — known hazard, measured at the gate.** An asymmetric
filter fed an oscillating input is a rectifier: for a per-cycle H/L alternation at the authored
rates the fixed point is `E = 0.9245·H + 0.0755·L` — the memory settles at ~92% of the *peak*, so a
world whose supply merely cycles would carry permanent grievance ≈ 0.92 × amplitude at a healthy
mean, punishing lumpy logistics rather than poverty, hardest on small-basket worlds. Whether
healthy-world Provision actually jitters cycle-to-cycle is **unmeasured** (the per-good 0-or-1
cliff is cross-sectional; stock buffers may hold satisfaction through delivery gaps), so this item
measures before mechanising: the gate instruments temporal per-world Provision variance and mean G
against that variance per cohort — a positive relationship is the rectifier firing and is a defect
by definition, not a tuning question. **Pre-named mitigation if it fires:** the rise arm reads a
short multi-cycle mean of P instead of the raw cycle (memory chases sustained improvement, not one
good week), keeping the asymmetry's meaning; the sweep carries this arm so the comparison exists.

Unchanged, explicitly: the standing floor (tax + crowding) and its constants; the strike threshold
and collapse line; `provision()`/`dissatisfaction()` and the whole economy-side fold;
`EconomySignals` (the expectation is population-side state, not an economy signal); the band fold
and every band constant; growth's `1 − D` factor and migration's inputs (both keep absolute
readings); the meaning of the `unrest` field itself — still the [0, 1] integral every existing
reader consumes. Two regime notes on that "unchanged": `accumulateUnrest`'s `min(1, …)` stops being
the "extreme corner" its docstring describes — under the re-cut slope the ceiling is reachable from
deep grievance alone (promise 5 bounds where; the docstring is rewritten) — and the decline term's
unrest input becomes relative with the stated demographic flip (see the decision above).

**The display twin is re-scoped in this item.** `lib/engine/pop-needs.ts`'s per-good `pressure` is
contractually "in lockstep" with the fold the unrest spine integrates (its docstring, and
`lib/engine/population.ts:99-100` from the other side). After this change the unrest spine
integrates G, not `dissatisfaction()`. `pressure` **stays the absolute per-good decomposition**
(correct for growth and for reading the world); its docstring's lockstep claim is narrowed to the
Provision fold, and the two population-panel copy strings ("unmet needs drive unrest",
`components/system/population-panel.tsx:45,129`) are re-worded to the memory-relative truth. The
`stabilityLabel` band edges (`lib/utils/stability.ts:14-20`) get their top edge **bound to
`STRIKE_PARAMS.threshold`** in this item (the label may never contradict the mechanic — today it
says "Strike" only from 0.8 while striking starts at 0.65); the remaining edges are re-read against
the post-change unrest distribution at the gate.

## The guarantees

The shipped guarantee suite re-authors to six promises. Values are authored starting points that
satisfy all six on paper; exact constants are derived at implementation against the suite and
verified in the calibration sweep. Arithmetic uses the flat `slopeBase` 1.6, `slopeShortage` 2.4,
strike 0.65, collapse/teardown 0.75, max standing floor 0.23.

| # | Promise | How it holds |
| --- | --- | --- |
| 1 | **A newborn colony stays calm through its whole opening window — including manifest exhaustion — at any tax level.** | Two parts. *Opening:* structural — memory seeds at opening state, so `G = max(0, 0.5 − opening P)`; p10 opening Provision is 0.62 post-change (a p10 bounds 90% of the cohort — the tail below it is bounded by measurement, not construction: the gate reads `openingDeprivedCount` and the run's minimum opening Provision, with a tail check pinned against the measured minimum at the founding-realistic floor). *Window:* the founding manifest is a one-off ~30-cycle stock credit (`FOUNDING_STOCK_COVER`), so the seed lands at the colony's endowment-fed maximum and the cohort's grievance risk peaks at exhaustion, not at open. The promise covers the first ~60 cycles (dowry + resignation period); the gate reads founding **trajectories over colony age**, not opening snapshots. Whether the exhaustion transition actually dips is unmeasured — measured at the gate; pre-named fallback if it strikes: shift the seed timing to the colony's post-dowry reality. Replaces the founding-strike invariant test; the interim `slopeRationing` 0.95 and its [0.84, 1.07] window retire. |
| 2 | **Total failure of either survival good collapses an untaxed world.** | Verbatim from the shipped suite: the crisis term reads the absolute scale, so `slopeShortage` 2.4 × food's ~0.32 basket share ≥ the 0.75 collapse line carries over unchanged. |
| 3 | **Broad shortage on an established world strikes while its memory holds.** | A fully-accustomed world (E ≈ 1) that loses **half** of what it is used to reaches strike at any tax: flat term(0.5) = 0.80 ≥ 0.65 at zero tax (saturating to the ceiling at max floor). The anger is guaranteed for the episode and fades only as resignation sets in. Single-constant guarantee: `slopeBase × 0.5 ≥ STRIKE_PARAMS.threshold` ⇒ slopeBase ≥ 1.3. |
| 4 | **A quarter-dip never collapses or tears down, at any tax.** | Dip-depth containment: G ≤ 0.25 stays below the 0.75 collapse/teardown line even at the max standing floor: 1.6 × 0.25 + 0.23 = 0.63. Upper bound: slopeBase < (0.75 − 0.23)/0.25 = 2.08. |
| 5 | **The escalation ladder is pinned, computed not hardcoded.** | Where the irreversible regimes start, as formulas so a re-cut moves the numbers and fails the pins rather than drifting silently: teardown onset at max floor `G = (0.75 − maxFloor)/slopeBase` ≈ 0.325 (≈ a third-dip; 0.469 at zero tax); the response stays graduated (settled < 1.0) up to `G = 0.45` at max floor (0.95), with the ceiling reachable from `G ≈ 0.48` (max floor) / 0.625 (zero tax). Deep-dip episodes are deliberately harsher than anything shipped (today no broad non-famine shortfall tears down below D ≈ 0.55 at max tax) — established worlds feeling deep dips is the point — and an episode's cost is real and irreversible (teardown, overshoot death), so the gate reports **cumulative levels torn down and overshoot deaths per grievance episode**, not just peak unrest. |
| 6 | **The critical-good backstop is expectation-independent at shipped strength.** | A world with critical weight w and absolute shortfall D reads at least `min(slopeShortage, slopeBase + w × (slopeShortage − slopeBase)) × D`, whatever its stored expectation — pinned so no future slopeBase re-cut can silently weaken the channel (this review caught exactly that: a draft coefficient-only form delivered ~1/14th of shipped response on accustomed worlds). |

Carried over and re-verified on the new term: no single non-survival good, alone, reaches strike at
any tax (largest non-survival weighted share is gas 0.085 → settles 0.366 at max floor); overshoot
death gated on the strike threshold; crowding pressure bounded below strike. Band containment
("Supplied and Strained never collapse") is **consciously retired** — collapse now keys on dip
depth (promise 4), famine (promise 2), or chronic critical failure (promise 6).

### Per-test disposition of the shipped suite

Every `it()` in `band-constants.test.ts`, dispositioned — nothing carried by silence:

| Test (line) | Disposition |
| --- | --- |
| band constant dependencies (:50–:103 — logistics/brake/founding-endowment/shortage-line/input-knob) | carried unchanged — no slope content |
| overshoot death gates on strike threshold (:114) · one brake-end (:119) · no strike-spiral off crowding (:122) | carried unchanged |
| the linear fold reads its own size (:189) · complement on a partial basket (:200) | carried unchanged — fold untouched |
| grades a total water/food failure above ambient deficit (:208) · escalation-only cut (:218) | **retired** with `D_SHORTAGE_CUT`/`BLEND` — famine grading is carried by the survival step alone (:336) |
| slopeShortage strictly above the base slope (:237) | carried, renamed slopeBase |
| survival-good collapse at zero tax (:247) · survival net decline at every tax (:263) | carried unchanged — promise 2 |
| no single non-survival good strikes (:275) | re-authored on the new term (grievance for an E = 1 world + restored crisis term); holds with margin |
| broad shortage strikes below collapse — the 0.84 lower bound (:285) | **retired as superseded**: the strike half becomes promise 3 (flat, ≥ 1.3); the below-collapse half is deliberately withdrawn — promise 5's ladder places teardown onset at ≈ a third-dip at max floor, so a half-dip at max tax now saturates. They assert opposite things about the same shortfall; promise 3/5 win. |
| founding p10 below strike — the 1.07 upper bound (:298) · both-ends bound (:311) | **retired** with the invariant — replaced by promise 1's structural opening test + window trajectory + tail check vs the measured minimum |
| blends the slope across the cut (:319) · holds the slope across the Rationing range (:328) | **retired** — the ramp is gone; replaced by a flat-slope pin (the grievance slope is one constant across all G) |
| survival promotes to the Shortage slope at any D (:336) · refuses housing on starving systems (:340) | carried unchanged |
| collapse containment — Supplied/Strained never collapse (:364–:385) | **re-authored as dip-depth** (promise 4), composed with the worst crisis-term case (the restored override reads absolute D, which can exceed G on a never-well-supplied world) — derivation at implementation |
| transient event shocks (:387–:430) | **re-authored**: the pre-event world's expectation level is now the test's author choice and decides the result — authored at the worst case (fully accustomed), re-derived against the flat slope; the old 0.0028 margin is not ported |
| housing containment (:432–:476) | carried unchanged |

## Constants

| Constant | Authored start | Rule its docstring must carry |
| --- | --- | --- |
| `EXPECTATION_FLOOR` | 0.5 | "No population normalises living on half of what it needs." Applied at read as `max(stored, floor)`. Independent of `SHORTAGE_SATISFACTION` despite the equal value — that is the famine line on one good's satisfaction, this is a floor on remembered whole-basket Provision; do not couple them. |
| `EXPECTATION_RISE_RATE` | 0.25 / cycle | Standards rise fast (half-life ~2–3 cycles). Sweep-decided; stated per reference cycle, applied as catch-up **sub-steps** (never rate-scaled — the asymmetric update is nonlinear and a scaled rate clamps at catchUp ≥ 4). |
| `EXPECTATION_RESIGN_RATE` | 0.02 / cycle | Resignation comes slowly (half-life ~34 cycles). Same denomination and sub-step rule. Setting both rates to 1 reproduces the old change term (memory = last cycle) — that arm exists for comparison, not shipping. |
| `slopeBase` (renamed from `slopeRationing`) | 1.6 | Settled unrest above the floor per unit of *grievance* — one flat exchange rate, no ramp. Window from the promises: ≥ 1.3 (promise 3), < 2.08 (promise 4); no longer bounded by founding (promise 1 is structural). Interim-0.95 docstring and its no-heavy-calibration note retire. Rename blast radius includes `lib/engine/population.ts` (UnrestParams + unrestSlope), both population test files, the guarantee suite, and `docs/active/gameplay/economy.md:227-230`, which describes the shipped slope composition and is rewritten in the same PR. |
| `slopeShortage` | 2.4 (unchanged) | Derivation unchanged — either survival good's total failure collapses an untaxed world through the crisis term. Also the cap and span of the critical override (promise 6). |
| `UNREST_PARAMS.decay` | 0.06 (unchanged) | Now one of three time constants in the loop (with rise/resign) — the gate's ringing check exists for exactly this pairing. |
| `STRIKE_PARAMS.threshold` | 0.65 (unchanged) | Docstring is stale — says "raised to 0.7" against a value of 0.65 (`lib/constants/population.ts:72-75`, verified); corrected in this item, since every promise derives against 0.65. |

Retired outright: `D_SHORTAGE_CUT` / `D_SHORTAGE_BLEND` (the ramp and its absolute-scale rationale)
— **including the two harness-test sites** that borrowed the cut as a generic large-shortfall
magnitude (`lib/tick-harness/__tests__/population-analysis.test.ts:261,284`, contrary to its
authored escalation-only meaning); their replacement is an absolute-scale reference
(`1 − RATIONING_PROVISION` or a local test constant), never a relative-scale expectation constant.

## Calibration and the gate

The decay-rate pair is the item's calibration — this is where the old change-term item's experiment
lives. The harness sweeps rise × resign as config experiments (`npm run simulate -- --config`),
covering the spectrum from the one-cycle arm (both 1 — the old change term) to deep normalisation,
plus the smoothed-rise mitigation arm (see the jitter hazard). Every reading records the decay
setting beside it.

**Cross-arm comparability — determinism plus upstream anchors, never "distributions must not
move".** Absolute Provision and band distributions are **expected** to move across live arms:
unrest → `strikeMultiplier` → production → satisfaction → Provision is a closed shipped loop, and
changing how many worlds strike is the item's purpose. The anchors are: (a) a determinism check —
the same arm re-run at the same seed reproduces its own distributions bit-for-bit; (b) quantities
upstream of unrest — the founding cohort's opening Provision sampled at the first post-founding
economy cycle, before any feedback has run; and (c) a suppression-disabled arm
(`STRIKE_PARAMS.threshold` > 1) where the economy side is genuinely decoupled and the fold's
unchangedness is directly checkable.

*Gate metrics, cohorted, both horizons plus 12k, against the step-1 gate baselines:*

- **Strike share and unrest distribution per cohort** — trailing-window where churn matters.
- **Founding-cohort trajectory over colony age (≥ 60 cycles), at every tax level** — the window
  promise observed live, including the manifest-exhaustion transition; plus the tail instruments
  (`openingDeprivedCount`, minimum opening Provision per run).
- **Episode costs** — cumulative levels torn down and overshoot deaths per grievance episode;
  teardown incidence and never-recovered systems per cohort (the teardown loop is self-sustaining
  under a memory reference: lost capacity → permanent gap vs memory → `strikeExplains` suppresses
  the rebuild proposal → housing loss raises the crowding floor — the gate must show it bounded).
- **The ratchet check** — temporal per-world Provision variance, and mean G against that variance
  per cohort: a positive slope is the rectifier firing (defect, not reading).
- **The logistics loop** — deficit-classification counts and delivered volume for systems above the
  strike threshold (a striking world's strike-gated use figure shrinks its own import target — the
  supply→unrest→less-supply loop must be bounded, not monotone).
- **The treasury loop** — per-faction income, funded fractions and insolvency incidence across arms
  (unrest → realized production → production tax → funded logistics/construction/maintenance is
  faction-wide).
- **Demographics** — galaxy population total across arms (a population-level shift re-baselines
  every per-capita calibration), net population + Provision for pop 10–100 and survival-short
  (watching the intended decline flip), and net migration direction between the poorest- and
  highest-Provision cohorts.
- **Supply's share of unrest variance per cohort** — the motivating claim, measured as moved rather
  than relocated.
- **A recovering-world trace** — unrest visibly easing during recovery while the level is still
  poor: the behaviour the fixed bar cannot produce, observed as a trajectory.
- **Oscillation / ringing check** — the memory's time constants against the relaxation rate; an
  event-driven dip-and-recovery must not ring; plus the **post-boon trace** (a production boon
  raises the baseline and manufactures a grievance episode when it ends — mining_boom's terminal
  ×0.5 phase guarantees the undershoot) and grievance incidence at systems with **no** active event
  but a same-faction donor under an active `anchor_shift` (event blast radius is the logistics
  neighbourhood, not the targeted system).
- **Harness additions:** expectation and grievance distributions, cohorted (an emptying world's
  skipped updates make its stored value visibly stale rather than drifted); the cadence-invariance
  pair extends to expectation/grievance distributions (sub-step rule verified).

## What this item does not do

- **No new UI surface.** The booked Provision-display roadmap row is where player-facing supply
  surfaces land. This item's only UI touches are corrective: the two population-panel copy strings
  re-worded (the display twin re-scope) and `stabilityLabel`'s top edge bound to the strike
  threshold.
- **No abandonment, no relief** — next on the arc ([supply-response.md](./supply-response.md)).
  Three interactions are binding on them now: abandonment's trigger keys on famine-driven or
  physical decline, never unrest (an unrest-keyed trigger would be disabled by this item, and the
  decline flip narrows physical decline to the famine channel — re-verify the trigger against
  post-change decline rates); abandoned worlds leave the settled denominator before any expectation
  baseline is measured over them; and the un-develop transition **clears the stored baseline** (the
  develop-side clear this item ships is the other half of the same rule).
- **No consumption-side event assumptions.** Every shipped event `rate_multiplier` targets
  production only (verified — the consumption channel exists in the type but no event uses it); a
  future consumption-side event is a *new* interaction with the memory and gets named when authored.
- **No precision tuning of unrelated constants** — the roadmap's standing *Don't* resolves at this
  item; downstream tuning waits for its gate.

Same-PR doc corrections this item owns: `docs/active/gameplay/economy.md:227-230` (shipped slope
composition), `docs/SPEC.md`'s "fed and calm" phrasing for directed build (the shipped gate reads
no unrest — the prose keeps sourcing that error), and the two stale docstrings named in the
constants table.

## Design hazards worksheet

### 1. One quantity, several unrelated jobs

`npm run impact` outputs, summarised and grep-corrected (the tool under-reports two symbols here —
noted per row):

| Quantity | Every reader today | Which this design moves | Intended? |
| --- | --- | --- | --- |
| `unrest` (the field) | SHARED — 83 refs / 26 modules. Three processors read it via declared interfaces — population (integral, **decline term**, overshoot death), migration (attractiveness), infrastructure-decay (teardown severity) — plus economy touches it undeclared (strike suppression via `strikeMultiplier`); industry (health labels), UI/service modules (stability surfaces incl. `stabilityLabel`, `lib/utils/stability.ts:14-20` — top edge bound to the strike threshold in this item), and the harness read it downstream | **None in meaning** — still the [0, 1] integral. Incidence moves for every reader; the decline term's input becoming relative is the stated demographic flip; `accumulateUnrest`'s ceiling becomes reachable from deep grievance (promise 5). | Yes — change what feeds it, not what it means; the two regime notes are stated in the mechanism section. |
| the shortfall `1 − P` | unrest integral (`lib/tick/processors/population.ts:60`), growth factor (`:63`), **decline via unrest** (third consumer, same function), the display twin `lib/engine/pop-needs.ts` (`pressure`, contractually lockstep — impact misses it: mirrors the shape without importing), harness `meanShortfall` | Unrest reads G; growth, `pressure` and the harness keep absolute; decline follows unrest (relative, intended); the lockstep contract is narrowed to the Provision fold and the panel copy re-worded. | Yes — political/biological split, each consumer dispositioned. |
| `UNREST_PARAMS` | `lib/constants/population.ts:55` (author), `lib/world/tick.ts:879` (threads), `lib/engine/population.ts` (UnrestParams interface + unrestSlope + accumulateUnrest — impact under-reports: 6 refs in the engine file), both population test files, the guarantee suite, `docs/active/gameplay/economy.md:227-230` | Gains the expectation rates; `slopeRationing` → `slopeBase` rename touches every listed site; the active doc is rewritten same PR. | Yes. |
| `D_SHORTAGE_CUT`/`BLEND` | NOT contained: `lib/constants/economy.ts:104` (author), `lib/engine/population.ts:36,258-259`, `band-constants.test.ts` (:223-224, :320-333), **`population-analysis.test.ts:261,284`** (harness — borrowed as a generic magnitude, contrary to its docstring) | Retired; per-site replacement stated (constants section) — the harness sites get an absolute-scale reference, never an expectation constant. | Yes. |
| the stored expectation (new) | population processor (read + sole writer), harness instruments | New — one writer; optional at every hop (the `?? 0` join precedent deliberately not followed — see plumbing). Abandonment/relief consume its *derived* worsening-vs-recovering signal later. | Yes. |

### 2. A constant read for a meaning it was not authored to have

| Constant | Docstring says | This design uses it as | Same thing? |
| --- | --- | --- | --- |
| `SHORTAGE_SATISFACTION` (0.5) | the famine line on one good's satisfaction (`fed()`, survival override) | unchanged — the crisis term's trigger | Yes. The numeric coincidence with `EXPECTATION_FLOOR` is called out in both docstrings so nobody couples them. |
| `STRIKE_PARAMS.threshold` | docstring **stale**: "Threshold raised to 0.7 so only genuinely high-unrest systems strike" against a value of 0.65 (verified, `lib/constants/population.ts:72-75`) | 0.65, in every promise derivation | Intent yes, number no — docstring corrected in this item; quoted here rather than paraphrased, which is how the staleness survived the first audit. |
| `INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold` (0.75) | the collapse/teardown line | promises 4 and 5's containment/onset target | Yes — authored against this reader by name. |
| `UNREST_PARAMS.decay` (0.06) | the single relaxation rate (interim, no heavy calibration) | unchanged value; one of three time constants — the ringing check pairs them | Re-examined together at the gate, as its docstring note anticipated. |
| `GOOD_NECESSITY` | authored per-good unrest-fold weight | unchanged, via the untouched `provision()` and the restored crisis override | Yes. |
| `TAX_LEVEL_UNREST_PRESSURE` + `CROWDING.PRESSURE_MAX` | the standing floor (max 0.23) | unchanged — the floor stays absolute | Yes. |
| `FOUNDING_STOCK_COVER` (30) | the founding manifest's cycles-of-basket endowment | the width of promise 1's window (the seed lands at the endowment-fed maximum) | Yes — but the *dependency* is new: the promise window is sized from it and says so. |

### 3. A system you did not think about

| System | Interaction | Reason if none |
| --- | --- | --- |
| Events | Both signs, two channels: (a) harms drive grievance episodes (the drama this item exists to create) and the recovery must not ring; (b) **boons** raise the baseline within 3–4 cycles at the rise rate and manufacture a post-event grievance when they end — mining_boom's terminal ×0.5 phase guarantees the undershoot; (c) `anchor_shift` modifiers scale `logisticsTarget`/`donorReserve`, so an event's grievance blast radius is its faction's logistics neighbourhood, not the targeted system. Gate: post-boon trace + untargeted-donor grievance incidence. No event moves the consumption denominator (verified — production-side only). | — |
| Population + migration | The core surface, three named consequences: the decline flip on "poor but fed" worlds (intended, gated); the overshoot-death sink gating off with unrest; contentment as a *positive* migration term making adapted-poor worlds net attractors (colonist delivery is unrest-blind and reinforces it). Gate: demographics metrics. | — |
| Unrest / regime | The change itself. Strike/collapse thresholds untouched; ceiling reachability and decline input are the two stated regime notes. | — |
| Industry + staffing | none directly | Unrest reaches industry only via health labels and the strike multiplier, meanings unchanged; staffing reads population + academy ceilings, never unrest. Incidence shifts are gate metrics. |
| Infrastructure decay | Teardown (≥ 0.75) is promise 5's onset target, and the loop is self-sustaining under a memory reference (lost capacity → permanent gap vs memory for ~1/resign cycles → `strikeExplains` blocks the rebuild → crowding raises the floor). Gate: episode costs, never-recovered systems. | — |
| Directed logistics | **Indirect, through the strike gate** (the drafted "none" was false): the matcher's use figure is strike-gated on its industrial half (`productionSuppressRate` → `useRatesByGood`), and that figure denominates `logisticsTarget` and `donorReserve` — a striking world's import target shrinks, a supply→unrest→less-supply loop. Previously inert at equilibrium because the absolute term was inert. Gate: deficit classification + delivered volume for above-threshold systems. | — |
| Directed build / planner | `strikeExplains` suppression is the **only** unrest path into the planner (`directed-build.ts:332,338`); the housing gate `fed()` is a survival-satisfaction test that deliberately reads no unrest (its own docstring; SPEC.md's "fed and calm" prose is corrected same PR — it keeps sourcing this error). Baseline: suppression 0.86% (10k) / 0.71% (12k) per eligible pair. | — |
| Colonisation + founding manifest | Founding pacing is money-gated and untouched. The seed reads the endowed state (ordering verified: establish applications land after the economy stage, colony invisible to the fold until the next cycle) — which is exactly why promise 1 is a *window* promise: the manifest is a one-off ~30-cycle credit, so the seed is the colony's best-ever reading and the risk peaks at exhaustion. A system transitioning into `developed` clears any stored baseline (resettlement seeds fresh). | — |
| Treasury / purse | **Indirect and faction-wide** (the drafted "none" was false): unrest → strike → realized production → `productionTaxIncome` → `funded.{maintenance,logistics,construction}` → production malus / haul budget / build pool — so raising equilibrium unrest lowers delivered supply for every world the faction owns, and the memory does not forgive it quickly (the reference is the faction's own pre-squeeze level). Gate: per-faction income, funded fractions, insolvency incidence. | — |
| Factions + relations | none | Relations drift reads borders/doctrine/trade/alliances — no unrest input (verified, `lib/tick/adapters/memory/relations.ts` + processor). |
| Save format (`World` shape) | The one new optional field, guarded on both sides (write-clamped, read-defensive) and optional at every plumbing hop — the `collapseDebt` `?? 0` join precedent is deliberately not followed (absence is the lazy-seed marker). Save-compat test pinned. No version bump (additive optional field, per `save.ts`'s own policy — verified). | — |
| The harness's own metrics | Every unrest baseline re-keys (recorded beside the decay setting); cross-arm comparability is determinism + upstream anchors, never distribution-invariance (the fold's inputs sit downstream of unrest); expectation/grievance distributions, the ratchet check, and the founding trajectory are new instruments. | — |

### 4. A symptom asserted without a measurement — or with the wrong one

| Claim | Evidence | Horizon | Cohort |
| --- | --- | --- | --- |
| supply's unrest share is near-zero for large worlds and dominant for small ones | Provision/unrest/strike: pop ≥ 1K 0.995 / 0.108 / 0.0% vs pop 10–100 0.855 / 0.309 / 14.7%, survival-short 0.894 / 0.250 / 8.5% | equilibrium (step-1 gate) | per cohort |
| the galaxy-wide means move partly with cohort mix | mean shortfall 0.065 → 0.038 while mean unrest 0.054 → 0.153; settled 253 → 582 with mix shifting toward large worlds | startup → equilibrium, same run | all settled (stated as mix-confounded) |
| the healthy majority's supply channel is inert against the floor | Supplied 89.3% (equilibrium) / 95.9% (12k); Provision p10 0.890 (equilibrium); famine 2.9% | each figure carries its horizon inline | all settled |
| the founding cohort is modal and worst-supplied | 562 of 582 settled; opening Provision mean 0.74 / p10 0.62 (post-change), mean 0.73 / p10 0.41 (pre-change arm — provenance of the retired suite's 0.59-shortfall figure) | equilibrium | founding cohort |
| newborn grievance under the seed rule is ~0 for ≥ 90% of the cohort | seed = opening P ⇒ G = max(0, 0.5 − opening P); p10 0.62 > 0.5. The sub-p10 tail is bounded by measurement (openingDeprivedCount + run minimum), not construction | equilibrium | founding cohort |
| strikes are small-world, not landless-world | pop 10–100 14.7% vs pop ≥ 1K 0.0%; survival-short 91.5% not striking | equilibrium (step-1 gate) | pop bands; survival-short |
| the planner's strike-loop exit baseline | `strikeExplains` suppression 0.86% (10k) / 0.71% (12k) per eligible pair | both + 12k | eligible (system, good) pairs |
| slow chronic decline self-forgives at the resign rate | **hypothesis by construction** — the sweep's slow-resign arms measure it; the asymmetry's job | — (gate) | — |
| healthy-world Provision jitters cycle-to-cycle (the rectifier's trigger) | **unmeasured** — the per-good 0-or-1 cliff is cross-sectional; stock buffers may smooth consumption through delivery gaps. The ratchet check measures it before the mitigation is built | — (gate) | per cohort |
| the manifest-exhaustion transition dips a colony's Provision | **unmeasured** — colonist delivery/migration/logistics may carry colonies over it smoothly. The founding trajectory read measures it; the seed-timing fallback is pre-named | — (gate) | founding cohort |

### 5. Designing against a threshold, signal or primitive that does not exist

| Consumes | Produced at | Actual shape today | Design assumes |
| --- | --- | --- | --- |
| a persisted prior-supply reading | **nowhere** — `EconomySignals` is transient, one tick (`lib/tick/types.ts:52-75`) | in-memory only | this item adds the stored expectation |
| per-system Provision each cycle | economy fold → `dissatisfactionBySystem` (= 1 − P), `ctx.results` | [0, 1], present for every system the shard processed; the population processor already consumes it (`lib/tick/processors/population.ts:44`) and can never encounter an omitted system (the key set scopes its loop) | read unchanged; P recovered as `1 − d` |
| survival + critical absolute readings | `supplyStateBySystem` (`lib/tick/types.ts:58`) — `survivalShortfall` bit + finite non-negative `criticalWeight` | produced by the untouched `foldSupplyState` | crisis term reads them as-is |
| tax standing pressure | `taxPressureBySystem` param (`lib/tick/processors/population.ts:51`) | [0, 1] after clamp with crowding | unchanged |
| catch-up scaling | `catchUpFactor` (`lib/tick/shard.ts:52`) | linear factor; the relaxation rate is rate-scaled and stays so (its fixed point is rate-free) | the expectation update **sub-steps** instead — the asymmetric filter's equilibrium is rate-dependent, so rate-scaling is not invariance here |
| an optional numeric field surviving the row layer | the only precedent is `collapseDebt` — coerced `?? 0` at the join (`lib/world/tick.ts:203`), required on the tick row, written back unconditionally | absence does NOT survive the precedent's plumbing | the expectation field stays optional at every hop; the join passes `undefined` through; the population state view/update rows gain the field; save-compat test pins absent → lazy seed, not 0 |

### 6. Designing against an aggregate that moves for other reasons

| Metric | Read at which cohort | What else moves this number |
| --- | --- | --- |
| strike share | pop bands + survival-short, trailing-window | churn (crossing worlds), founding rate, event incidence, the decay setting — record it beside every reading |
| mean unrest | per cohort, never galaxy-first | tax stance + crowding floor (up to 0.23 before supply says anything); baseline drift under the expectation |
| absolute Provision / band distributions | per cohort | **downstream of unrest across arms**: unrest → strike multiplier → production → satisfaction → Provision (plus decline shrinking demand raises satisfaction on dying worlds) — movement across arms is a gate reading, not instrument breakage; invariance is only checkable in the suppression-disabled arm |
| founding-cohort trajectory | founding cohort, per tax level | founding *rate* (dominant confounder — each newborn opens at the galaxy's worst state); manifest generosity; colonist-delivery pacing |
| grievance distribution | per cohort | founding rate (every newborn seeds G ≈ 0, deflating the mean exactly as it deflates band shares); the strike feedback (grievance partly measures its own consequence); population decline raising P on dying worlds; event incidence; the decay setting |
| expectation distribution | per cohort, never galaxy-first | founding rate (newborns seed at the frontier's level, pulling the distribution down); the rise/resign setting itself; near-empty worlds' stale (update-skipped) values; the maturity trajectory |
| galaxy population total | across arms, absolute | the decline flip (intended), migration redistribution, overshoot-death gating — a level shift re-baselines every per-capita calibration downstream |
