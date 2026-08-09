# Adaptive expectation — working file

## Spec

[docs/planned/adaptive-expectation.md](../planned/adaptive-expectation.md) — spec-reviewed
(3-lens `/spec-review` 2026-08-09, all 24 amendments applied; record in
`.agent-reviews/spec-adaptive-expectation-2026-08-09-004302.md`). One amendment was made at build
planning, stated in the spec: `SupplyState` gains an additive `emptyBasket` bit (the empty-basket
update skip is otherwise unimplementable — the bit is the sole exception to "EconomySignals
unchanged").

Branch: `feat/adaptive-expectation`, PR into `shared/band-reconciliation`.

## Build plan

Stages are check-in pauses on one branch, not PRs. Stage A is engine-pure (suite red at the seam is
never acceptable here — A1/A3 land compile-green together or as one commit); Stage B wires the
world; Stage C instruments; the Gate closes the item. Spec formulas and constants carry verbatim
from the spec — no task re-derives them.

### Task A1 — the supply term: grievance + restored crisis, flat slope, rename, ramp deletion

Files: `lib/engine/population.ts`, `lib/constants/population.ts`, `lib/constants/economy.ts`,
`lib/engine/__tests__/population.test.ts`, `lib/tick/processors/__tests__/population.test.ts`
(rename fallout only), `lib/constants/__tests__/band-constants.test.ts` (compile-only here;
re-authoring is A3).

Interface:
- `UnrestParams { slopeBase: number; slopeShortage: number; decay: number }` — `slopeRationing`
  renamed `slopeBase`, value 1.6, docstring per the spec's constants table (window [1.3, 2.08),
  interim-0.95 note retired).
- `SupplyState` gains `emptyBasket: boolean` — set by `foldSupplyState` when `Σ weight ≤ 0`
  (the same `goodWeight` sum `provision()` folds over).
- `grievanceShortfall(expectation: number, provision: number): number` (new) — `clamp(E − P, 0, 1)`.
- `supplyUnrestTerm(grievance: number, d: number, supply: SupplyState, params: UnrestParams): number`
  (new) — the spec's `max(grievance term, crisis term)`: grievance = `slopeBase × G` (flat, no
  ramp); crisis = survival ? `slopeShortage × D` : `min(slopeShortage, slopeBase + criticalWeight ×
  (slopeShortage − slopeBase)) × D`. Replaces `unrestSlope` (deleted).
- `accumulateUnrest(unrest: number, supplyTerm: number, floor: number, params: UnrestParams): number`
  — re-signatured: takes the term, gain = `k × term`, fixed point `floor + term`; docstring's
  "extreme corner" saturation claim rewritten per the spec's regime note.
- `D_SHORTAGE_CUT` / `D_SHORTAGE_BLEND` deleted from `lib/constants/economy.ts`;
  `STRIKE_PARAMS` docstring corrected (0.7 → 0.65) in `lib/constants/population.ts`.

Proves:
- Famine dominance is exact: an E = 1 world with a survival shortfall reads exactly
  `slopeShortage × D` — a sum-instead-of-max implementation reads more and fails.
- The restored crisis floor: an accustomed world (G = 0) with critical weight w and shortfall D
  reads `min(slopeShortage, slopeBase + w × span) × D` — a coefficient-only implementation (no base
  slope) reads near-zero and fails.
- The grievance slope is flat: the term is linear in G across [0, 1] — any reintroduced
  G-dependent slope fails.
- G's clamp boundaries: E ≤ P reads 0; G never exceeds 1 whatever E and P.
- `emptyBasket` is true exactly when Σ weight ≤ 0 — a basket with rows but all-zero weight sets
  it; one weighted good clears it.
- Vacuity: term(0, 0, benign supply) = 0, and an empty-implementation term (always 0) fails the
  famine and crisis entries above.

Consumes: —.

### Task A2 — the memory: sub-stepped asymmetric update + validity-guarded read

Files: `lib/engine/expectation.ts` (new), `lib/constants/population.ts`,
`lib/engine/__tests__/expectation.test.ts` (new).

Interface:
- `ExpectationParams { floor: number; riseRate: number; resignRate: number }` and
  `EXPECTATION_PARAMS` (new, `lib/constants/population.ts`) = { 0.5, 0.25, 0.02 }, docstrings per
  the spec's constants table (floor's do-not-couple note; rates' sub-step rule and change-term arm
  note).
- `readExpectation(stored: number | undefined, provision: number, params: ExpectationParams):
  { stored: number; effective: number }` (new) — validity guard: absent OR non-finite OR outside
  [0, 1] is treated as absent and seeds from `provision`; `effective = max(stored, floor)`; the
  floor is never written into `stored`.
- `updateExpectation(stored: number, provision: number, params: ExpectationParams,
  subSteps: number): number` (new) — the spec's asymmetric EMA applied as `subSteps` iterations of
  the unscaled rates, branch re-evaluated per iteration; result finite in [0, 1].

Proves:
- Asymmetry: P above stored converges at the rise rate, below at the resign rate — swapping the
  branch selection fails both directions.
- Sub-stepping is not rate-scaling: at subSteps = 4 with P crossing stored inside the window, the
  iterated result diverges from one step at 4× rates — a scaled-rate implementation fails.
- The validity guard: stored NaN, −1 and 2 each read as absent (effective = max(P, floor)) — an
  implementation passing the raw value through fails on all three.
- Floor-at-read: a stored value below the floor stays stored verbatim while `effective` reads the
  floor — a floor-on-write implementation fails.
- Seed identity: absent stored seeds to P and the same-cycle update is a no-op — so a newborn's
  G is exactly `max(0, floor − P)`.
- Totality: any finite inputs produce a finite result in [0, 1] (rates > 1 clamped per step).

Consumes: —.

### Task A3 — the guarantee suite re-authored per the spec's disposition table

Files: `lib/constants/__tests__/band-constants.test.ts`, `lib/engine/__tests__/population.test.ts`.

Interface: none new — the spec's six promises as pins, and the per-test disposition table executed
exactly: retire :208/:218 (ramp grading), :285 (0.84 lower bound — superseded), :298/:311 (founding
invariant + both-ends), :319/:328 (ramp shape); re-author :275 (single non-survival good, on the
new term), :364 (containment → dip-depth promise 4 composed with the worst crisis case), :387
(transient event shock, pre-event world authored fully accustomed, re-derived — the 0.0028 margin
is not ported); carry the rest unchanged. New pins: promise 3 (`slopeBase × 0.5 ≥ threshold`),
promise 4/5 ladder (onset formulas computed from the live constants, never hardcoded), promise 6
(crisis floor expectation-independent), the flat-slope pin, and the validity/famine-dominance pair
from A1/A2's entries at the composed level.

Proves:
- Promise 3 pin fails at slopeBase 1.2 (below the 1.3 line); promise 4 pin fails at 2.1 (above
  would break containment margin arithmetic — the pins bound the window from both sides).
- The ladder pins are computed: moving `INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold` or the max
  floor moves the asserted onsets — a hardcoded-onset test survives that move and fails review;
  the pin must not.
- Promise 6 fails on a coefficient-only crisis-term revert (the A1 mutation, re-detected at the
  suite level so a future engine edit cannot pass the unit test and slip the promise).
- The retired tests are gone: no assertion on a 0.84 or 1.07 bound, no `D_SHORTAGE_CUT` import
  remains in the suite.
- The re-authored event-shock test detects a slope revert (2.4-family arithmetic) — it is not a
  tautology on the new constants.

Consumes: A1, A2.

### Task B1 — the persisted field: plumbing end-to-end + develop-transition clear

Files: `lib/world/types.ts`, `lib/tick/rows.ts`, `lib/world/tick.ts`,
`lib/tick/world/population-world.ts`, `lib/tick/adapters/memory/population.ts`,
`lib/world/__tests__/tick.test.ts`, `lib/world/__tests__/save.test.ts`,
`lib/world/__tests__/apply-developments.test.ts` (the develop-transition clear's home).

Interface:
- `WorldSystem.provisionExpectation?: number` — optional, [0, 1], docstring: the stored memory;
  absent ⇒ never seeded (load-bearing absence — NOT the `collapseDebt` "absent ⇒ 0" convention).
- `TickSystem.provisionExpectation?: number` — optional on the row; the `toTickSystems` join
  passes `undefined` through (explicitly not `?? 0`, with a comment stating the departure from the
  `collapseDebt` precedent and why).
- `PopulationStateView.provisionExpectation?: number`;
  `PopulationUpdate.provisionExpectation: number` (required on write — the processor always has a
  post-seed value); the adapter's `applyPopulationUpdates` merge writes it clamped finite into
  [0, 1].
- `applyDevelopments` (`lib/world/tick.ts:462`) clears `provisionExpectation` on any system it
  flips to `developed` — the resettlement rule.

Proves:
- Absence survives the row layer: a `WorldSystem` without the field reaches the processor's state
  view as `undefined` — a `?? 0` coercion anywhere in the chain fails.
- Round-trip: a written value lands on `WorldSystem` and survives serialize → deserialize.
- Save-compat: a serialized world predating the field loads, and its first cycle seeds from that
  cycle's Provision — under a coercion bug the world reads stored 0 / effective = floor instead,
  and the pinned expectation value differs.
- Develop-transition clear: a system carrying a stale stored value that flips to `developed` reads
  absent afterward.
- Non-finite never serialized: a NaN handed to the update write path lands clamped, and
  `JSON.stringify` of the world contains no `null` in the field.

Consumes: A2 (the seed semantics absence must preserve).

### Task B2 — the processor: read → term → update, wired

Files: `lib/tick/processors/population.ts`, `lib/tick/processors/__tests__/population.test.ts`,
`lib/world/tick.ts` (params threading only).

Interface:
- The processor, per system: `P = 1 − d`; `readExpectation(view.provisionExpectation, P, params)`;
  `G = grievanceShortfall(effective, P)`; `unrest = accumulateUnrest(view.unrest,
  supplyUnrestTerm(G, d, supply, unrestParams), floor, scaled)`; then
  `updateExpectation(stored, P, params, subSteps)` — skipped (stored carried unchanged) when
  `supply.emptyBasket`; `populationDelta` keeps absolute `d` and the new unrest.
- `PopulationProcessorParams` gains `expectation: ExpectationParams`; `lib/world/tick.ts` threads
  `EXPECTATION_PARAMS` and derives `subSteps` from `catchUpFactor(interval)` per the spec's
  sub-step rule. The relaxation rate stays rate-scaled exactly as shipped.

Proves:
- Ordering: this cycle's unrest is judged against the cycle-start memory — an implementation that
  updates the store before the unrest read produces a different unrest on a moving-P fixture and
  fails.
- The political/biological split: on an accustomed poor fixture (G = 0, d large) unrest settles at
  the floor while growth still runs at `1 − d` — feeding G into `populationDelta` fails one side,
  feeding d into the term fails the other.
- Empty-basket skip: an `emptyBasket` system's stored value is byte-identical across the cycle
  while its unrest still relaxes toward the floor.
- Sub-stepping at cadence: at an interval ≠ 24 the expectation trajectory matches iterated
  unscaled steps, not one scaled step (fixture where P crosses stored mid-window).
- Newborn: an absent-field system at any tax level ends its first cycle with stored = its own P
  and unrest at the floor-only fixed point.
- The signal contract: a system omitted from `supplyStateBySystem` (defensive default path) still
  carries `emptyBasket: false` semantics — the default object gains the field and the update runs.

Consumes: A1, A2, B1.

### Task B3 — reader corrections: display twin, stability label, active-doc prose

Files: `lib/engine/pop-needs.ts` (docstring), `components/system/population-panel.tsx` (two copy
strings), `lib/utils/stability.ts`, `components/__tests__/` sibling test of stability label if one
exists (else the unit suite's existing home for it), `docs/active/gameplay/economy.md` (§ unrest —
slope composition rewritten to the new term), `docs/SPEC.md` (directed-build "fed and calm"
phrasing corrected to the survival-satisfaction gate).

Interface:
- `stabilityLabel`'s top band edge reads `STRIKE_PARAMS.threshold` (imported), not a literal;
  the other edges stay literal pending the gate's re-read.
- `pressure` (pop-needs) unchanged in value — docstring lockstep claim narrowed to the Provision
  fold; `lib/engine/population.ts:99-100`'s twin sentence narrowed to match.
- Panel copy states the memory-relative truth (wording free at implementation; the constraint is
  that neither string claims absolute unmet needs drive unrest).

Proves:
- Label/mechanic lockstep: a world at exactly the strike threshold labels "Strike" — moving
  `STRIKE_PARAMS.threshold` moves the label boundary with it; the shipped hardcoded 0.8 fails.
- `pressure` stays absolute: on a fixture where G = 0 and the per-good gap > 0, pressure is
  non-zero — a G-based pressure fails.
- Text pins: the two panel strings and the two docstrings no longer contain the
  absolute-needs-drive-unrest claim (grep-style assertion at the test level or review-checked;
  no component test infra is added for copy).

Consumes: A1 (rename fallout in the doc rewrite), B2 (the behaviour the prose must describe).

### Task C1 — harness: expectation/grievance instruments, founding trajectory, episode costs

Files: `lib/tick-harness/population-analysis.ts`, `lib/tick-harness/cohort-analysis.ts`,
`lib/tick-harness/build-analysis.ts`, `lib/tick-harness/runner.ts`, `lib/tick-harness/types.ts`,
`scripts/simulate.ts`, `lib/tick/types.ts` + `lib/tick/processors/population.ts` +
`lib/tick/processors/infrastructure-decay.ts` (instrumentation emission only),
`lib/tick-harness/__tests__/population-analysis.test.ts` (incl. the `D_SHORTAGE_CUT` replacement),
`lib/tick-harness/__tests__/build-analysis.test.ts`, `lib/tick-harness/__tests__/runner.test.ts`,
`lib/world/__tests__/cadence-invariance.test.ts` (extended to compare expectation and grievance
distributions across intervals — the sub-step rule's guard, per the spec).

Interface:
- Per-cohort and galaxy expectation + grievance distributions (median/p10/p90), printed at both
  horizons; grievance computed from the same read the processor makes (effective E vs P), not
  re-derived differently.
- Founding trajectory: builds on the existing tracker (`foundedTick`,
  `build-analysis.ts`) — per colony-age bucket (cycles since founding, buckets spanning ≥ 60
  cycles) mean/p10 Provision and unrest; `openingDeprivedCount` and minimum opening Provision
  surfaced in the summary (already computed at :285-313, now printed).
- The ratchet check: trailing-window per-world Provision variance, and a mean-G-by-variance-bucket
  table per cohort (the spec's "positive slope = rectifier" read).
- Episode costs: `TickInstrumentation` gains per-cycle teardown-levels and overshoot-death
  counters (emitted where each is computed — infrastructure-decay and population processors);
  harness accumulates cumulative totals and per-cohort incidence.
- `population-analysis.test.ts:261,284` re-anchored on an absolute-scale reference
  (`1 − RATIONING_PROVISION` or a local constant), never an expectation constant.

Proves:
- Grievance reads G, not D: a fixture where stored E < 1 makes them diverge — a harness that
  re-derives grievance as `1 − P` fails.
- Trajectory buckets key on age since founding, not absolute tick: a mid-run founding lands in
  bucket 0 — an absolute-tick bucketing fails.
- The variance instrument separates jitter from level: two fixtures with equal mean Provision and
  different variance land in different buckets.
- Episode counters conserve: summed per-cycle teardown equals total levels lost across the run
  (cross-checked against building-count deltas).
- The stale-not-drifted display: an `emptyBasket` world's expectation row is flagged stale rather
  than folded into the drifting mean (skip rule made visible, per the spec's harness note).
- No harness test reads a relative-scale constant for an absolute magnitude (the replacement
  entry's revert — restoring the `D_SHORTAGE_CUT` import — fails compilation or the pin).

Consumes: A1 (emptyBasket), A2 (read semantics), B1, B2 (live field + instrumentation emission).

### Gate — the item's decision gate (session-run)

Arms (seed 42, 600 systems, scale 100; checkpoints 1000 / 10000 / 12000; every reading records the
rate pair):
- BASE — the pre-change shared head (detached checkout, restored after), reproducing the step-1
  gate baselines.
- AUTHORED — rise 0.25 / resign 0.02.
- CHANGE-TERM — both rates 1 (the old item-2 arm, comparison only).
- SLOW — at least one deeper-normalisation pair (grid chosen at gate time).
- SMOOTHED-RISE — the pre-named ratchet mitigation arm.
- SUPPRESSION-DISABLED — strike threshold > 1: the decoupled arm anchoring the fold's
  unchangedness.

Reads: the spec's gate-metric list in full (strike/unrest cohorted trailing-window; founding
trajectory + tail; episode costs + never-recovered; ratchet check; logistics loop; treasury loop;
demographics incl. galaxy totals and migration direction; supply's share of unrest variance;
recovering-world trace; ringing + post-boon trace + anchor-shift neighbourhood grievance).
One-off correlation/direction reads run as gate-time scratch over `--json` output (never committed
— `scripts/` holds wired instruments only).

Merge condition: no non-finite/conservation breaks at any checkpoint in any arm; the determinism
check passes (same arm, same seed, bit-identical); the suppression-disabled arm's Provision
distributions match BASE (fold unchanged); newborn window holds (no strike inside the first 60
cycles at measured openings, any tax arm) — **else the seed-timing fallback decision is made here,
booked in this condition**; the ratchet check shows G uncorrelated with Provision variance —
**else the smoothed-rise mitigation decision is made here, booked in this condition**; episode
costs bounded (teardown loop not monotone across the resignation window); logistics and treasury
loop reads bounded (striking worlds do not monotonically lose delivered share; no faction spirals
to insolvency from the unrest change alone); demographics within intent (decline flip visible in
the poor cohorts, galaxy totals reported beside every per-capita read); the recovering-world trace
exists; the rate pair is chosen with rationale recorded in the spec's constants table; and the
`stabilityLabel` remaining edges are re-read against the post-change unrest distribution —
**re-cut or explicitly kept, booked in this condition**. Kai calls the gate; decisions arrive one
at a time per the standing convention.

## Verification

The gate above is the feature's proof: `npm run simulate` at both horizons plus 12k, cohorted,
across the named arms — never fixtures alone. The specific symptom-hiding risk this feature adds is
grievance and expectation hiding inside unrest aggregates, which is exactly what C1's new
distributions exist to surface; the founding story hides inside opening snapshots, surfaced by the
trajectory instrument. Build gate: `npx next build --webpack` clean at every stage seam; full
`npx vitest run` green at every task commit (A1+A3 land together if the seam is red). Red-proof per
task at implementation, executing each Proves list item by item.

## Doc fold

At ship (on the branch, before the final review): the mechanism folds into
`docs/active/gameplay/economy.md`'s unrest section (B3 already rewrites the slope composition; the
fold adds the memory bar, the six promises, and the constants); `docs/SPEC.md`'s economy paragraph
gains the expectation sentence; `docs/planned/adaptive-expectation.md` is deleted (its evidence
tables move to the arc doc where still needed); `docs/planned/supply-response.md` re-cuts item 1 to
shipped and re-points the arc at abandonment; `docs/ROADMAP.md` row 6 advances. This working file
is deleted at ship. The B3 prose corrections (economy.md slope composition, SPEC.md fed-and-calm)
land mid-branch and are not deferred to the fold.

## Not covered

- **Abandonment and relief** — the arc's items 2 and 3: **booked** (ROADMAP row 6; binding
  interactions stated in both specs).
- **The expectation/grievance UI surface** — **booked** (the ROADMAP Provision-display row is the
  landing zone; noted there at fold time). This item's only UI touches are B3's corrections.
- **The ratchet mitigation (smoothed rise)** — **booked at the gate** (merge condition names the
  decision; the sweep arm exists so the decision has evidence).
- **The seed-timing fallback (post-dowry seeding)** — **booked at the gate** (same condition
  structure).
- **`stabilityLabel`'s non-strike band edges** — **booked at the gate**.
- **A reintroduced escalation ramp** — **dropped** (spec-review F5: justification was false; flat
  slope carries the promises; returns only with measured justification from the sweep).
- **Consumption-side event interactions** — **dropped** (no shipped event uses the channel —
  verified at review; the spec names it as a future new interaction).
- **The `LOGISTICS_INTERVAL` ≠ `CYCLE_LENGTH` delivery-free-cycle configuration** — **dropped**
  (both are 24 today — verified; the sub-step rule handles cadence changes, and the
  cadence-invariance extension in C1's scope guards it).
