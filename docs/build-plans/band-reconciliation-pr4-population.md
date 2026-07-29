# Band Reconciliation PR4 — Population, Housing, Colony Headroom — Implementation Plan

> **Slice:** PR4 of `band-reconciliation-umbrella.md`, implementing §3 of the approved
> `docs/planned/economy-band-reconciliation.md`. PR1/PR2/PR3 are merged into
> `feat/band-reconciliation` at `a0da9b5` / `f6a7f6c` / `d797c1b`. The feature-level `/spec-review`
> ran on 2026-07-20 and all findings were folded into the spec; do not rerun it for this PR plan.
> The unrest-integrator shape (floor relaxation) and the minimal 3-state regime helper were
> design-approved in session on 2026-07-26.

## Goal

- Replace the logistic growth asymptote with a crowd brake: full-rate growth to `r = pop ÷ popCap
  = 1.0`, smoothstep to zero at `CROWD_BRAKE_END = 1.15`; population may exceed popCap freely.
- Gate the overshoot-death term above the strike threshold (0.65) so crowded-but-stable worlds
  stop leaking settlers.
- Rebuild the unrest integrator as relaxation toward a standing-pressure floor (tax + bounded
  crowding), with goods dissatisfaction forcing the excess at regime-sensitive rates: Supplied
  recovers faster, Rationing accumulates at the current gain, Shortage faster.
- Add the minimal supplied/rationing/shortage engine helper on the shared band constants and emit
  it per system from the economy cycle.
- Flip autonomic housing to pressure relief: trigger `r > 0.95`, sized to `r ≈ 0.92`, fed gate
  stays, calm gate dropped, `SETTLE_MARGIN` retired.
- Bundle +1 housing level beyond seed need at colony establish where habitable land permits.
- Invert the harness saturation watch (pop ≈ popCap is healthy; pathology is brake-pinned) and add
  the migration-throughput metric.

PR4 does **not** change regime UI/chips, `needSeverity` bands, `computeCoverLevels`,
`RATION_EXIT_EPS` hysteresis, the migration weights mix (`contentment`/`headroom`/`jobs`) or
`employedLeakFraction` values, final calibration, or the docs lifecycle. Those remain PR5 (or a
later finding-driven pass, for the migration mix). Sim acceptance is **directional**: at least a
minor improvement on pop growth (−3.2% after PR3), mean unrest (0.703), striking count (385) —
results are discussed when read, not gated in-plan.

## Branch and review contract

- Branch `feat/band-reconciliation-pr4-population` from clean `feat/band-reconciliation` at
  `d797c1b`.
- Base the PR on the shared branch, open it before `/uber-review`, and review the checked-out PR
  head.
- Use the task/commit boundaries below. PR5 owns active-doc promotion and build-plan deletion.

## Execution protocol

- The coordinating agent reads the full plan once and carries the Locked Interface Decisions and
  Global Constraints through every task.
- Execute Tasks 1–6 sequentially. Do not parallelize implementation tasks: later tasks consume
  interfaces introduced by earlier tasks.
- Use one fresh implementation agent per task, sized to the task's integration and reasoning
  needs. Give it that task, the relevant locked decisions and global constraints, and only the
  interfaces produced by completed tasks that it needs.
- After each task commit, use an independent review agent to assess both acceptance/spec
  compliance and code quality/repository conventions. Fix Important/Critical findings and
  re-review before starting the next task.
- The coordinating agent owns the pre-flight conflict scan, progress tracking, Tasks 7–8,
  cross-task integration, simulator interpretation, PR creation, and the final `/uber-review`.
- Continue between tasks without requesting confirmation. Stop only for a genuine plan
  contradiction, an unresolved blocker, or an action requiring new user authority.
- Keep task briefs and reviews scoped to their task. The final `/uber-review` remains the broad
  whole-PR review and does not replace the per-task gates.

## Locked interface decisions

### 1. Crowd brake and gated overshoot death (`lib/engine/population.ts`)

```ts
/** 1 while r = population/popCap ≤ 1; smoothstep down to 0 at r = crowdBrakeEnd.
 *  popCap ≤ 0 reads fully crowded (0) — never Infinity/NaN. Total and finite. */
export function crowdFactor(population: number, popCap: number, crowdBrakeEnd: number): number
// t = clamp((pop/popCap − 1) / (crowdBrakeEnd − 1), 0, 1); return 1 − t²(3 − 2t)

export interface PopulationParams {
  growthRate: number;          // 0.015 (unchanged)
  declineRate: number;         // 0.015 (unchanged)
  overshootDeathRate: number;  // 0.05 (unchanged)
  crowdBrakeEnd: number;       // CROWDING.BRAKE_END = 1.15
  /** Unrest above which the overshoot-death term fires (collapse regime only). */
  overshootDeathUnrestGate: number; // = STRIKE_PARAMS.threshold (0.65)
}

// populationDelta keeps its signature; the body becomes:
//   growth = growthRate × pop × crowdFactor(pop, popCap, crowdBrakeEnd) × (1 − D)
//   decline = declineRate × pop × clamp(unrest, 0, 1)                    (unchanged)
//   death   = unrest > overshootDeathUnrestGate
//               ? overshootDeathRate × max(0, pop − popCap) × clamp(unrest, 0, 1) : 0
```

The logistic `(1 − pop/popCap)` headroom term is deleted, not renamed. An invariant test asserts
`POPULATION_PARAMS.overshootDeathUnrestGate === STRIKE_PARAMS.threshold`.

### 2. Supply regime helper (`lib/engine/population.ts`) and shared boundary constant

```ts
export type SupplyRegime = "supplied" | "rationing" | "shortage";

/** Worst-demanded-good fold: "shortage" if any demanded good's satisfaction < SHORTAGE_SATISFACTION;
 *  else "rationing" if any < 1; else "supplied". No demanded goods ⇒ "supplied". */
export function supplyRegime(goods: GoodSatisfaction[]): SupplyRegime
```

`SHORTAGE_SATISFACTION = 0.5` lives beside `RATION_COVER` in `lib/constants/economy.ts` — PR5's
needs-severity re-base ("critical = Shortage (< 0.5)", spec §6) consumes the same constant.
Worst-good fold rationale (record in the docstring): the regime picks the *rate*, D picks the
*magnitude* — D is already demand-weighted, so a luxury-only shortage yields a high gain times a
small D. Bounded and monotonic; no second demand-weighting.

### 3. Floor-relaxation unrest integrator (`lib/engine/population.ts`)

```ts
export interface UnrestParams {
  /** Excess-integration gain per reference cycle while Rationing. */
  gainRationing: number;   // 0.06 (the current gain)
  /** Excess-integration gain while Shortage. */
  gainShortage: number;    // 0.12
  /** Relaxation rate toward the standing-pressure floor while Rationing/Shortage. */
  decay: number;           // 0.06 (the current decay)
  /** Faster relaxation while Supplied — the recovery rate. */
  recoveryDecay: number;   // 0.12
}

/** unrest ← clamp(floor + (1 − k)·(unrest − floor) + gain(regime)·clamp(d,0,1), 0, 1)
 *  where k = clamp(regime === "supplied" ? recoveryDecay : decay, 0, 1) and
 *  gain = shortage → gainShortage, otherwise gainRationing. `floor` is the standing
 *  pressure (tax + crowding), clamped to [0,1] by the caller. */
export function accumulateUnrest(
  unrest: number, d: number, floor: number, regime: SupplyRegime, params: UnrestParams,
): number
```

Properties the unit tests assert (spec §3/§8):

- **Tax equilibrium by construction**: at D = 0 unrest settles exactly at `floor`, whatever the
  decay rate — recovery speed and tax meaning are decoupled. Tax-level equilibria remain ordered.
- **Supplied recovers faster than Rationing** (`recoveryDecay > decay` on the same excess).
- **Shortage accumulates faster than shallow Rationing** at equal D.
- **Monotonic**: worse delivery (lower satisfaction ⇒ higher D and/or worse regime) never yields
  lower next-cycle unrest.
- **One bad cycle recoverable**: from unrest = floor, a single full-shortage cycle
  (`gainShortage × 1 × catchUp ≤ 0.24`) plus a floor ≤ 0.23 stays below the 0.65 strike threshold.
- Linear filter: `catchUpFactor` pre-scales both gains and both decays exactly as today (the
  processor scales; `k` is clamped to [0,1] after scaling so a large catch-up can never overshoot
  the floor).

### 4. Crowding pressure (`lib/engine/population.ts` + `lib/constants/population.ts`)

```ts
/** Bounded standing unrest pressure from overcrowding: 0 at r ≤ 1, linear to maxPressure at
 *  r ≥ brakeEnd. popCap ≤ 0 with population > 0 ⇒ maxPressure; both ≤ 0 ⇒ 0. */
export function crowdingPressure(
  population: number, popCap: number, brakeEnd: number, maxPressure: number,
): number

// lib/constants/population.ts
export const CROWDING = { BRAKE_END: 1.15, PRESSURE_MAX: 0.05 } as const;
```

`CROWDING.BRAKE_END` is the single source for both the growth brake (`PopulationParams
.crowdBrakeEnd`) and the pressure ramp. The clamp guarantees a full world can never strike-spiral
off crowding alone: max floor = very-high tax 0.18 + 0.05 = 0.23 < 0.65.

### 5. Economy signal and population processor threading

`EconomySignals` (`lib/tick/types.ts`) gains:

```ts
/** Per-system supplied/rationing/shortage fold of this cycle's consumption satisfaction. */
supplyRegimeBySystem: Map<string, SupplyRegime>;
```

The economy processor computes it beside `dissatisfactionBySystem` from the same `goodsBySystem`
arrays (`supplyRegime(goodsBySystem.get(sysId) ?? [])` — a system with no consuming markets reads
"supplied"). The population processor becomes:

```ts
const regime = signals.supplyRegimeBySystem.get(s.systemId) ?? "supplied";
const crowd = crowdingPressure(s.population, s.popCap, CROWDING.BRAKE_END, CROWDING.PRESSURE_MAX);
const floor = clamp(taxPressure + crowd, 0, 1);
const unrest = accumulateUnrest(s.unrest, d, floor, regime, scaledUnrest);
```

`taxPressureBySystem` keeps its shape and wiring (`lib/world/tick.ts:621/747`); its docstring and
the processor comment change from "enters the d term" to "enters the standing-pressure floor".
`scaledUnrest` pre-scales all four rate fields by `catchUpFactor(params.interval)`.

### 6. Housing relief valve (`lib/engine/directed-build.ts` + constants)

`DIRECTED_BUILD` deletes `SETTLE_MARGIN` and `UNREST_SETTLE`; adds:

```ts
/** Relief trigger: autonomic housing builds once occupancy r = pop/popCap rises past this. */
RELIEF_TRIGGER: 0.95,
/** Relief sizing: build enough whole levels to return r to ≈ this. Must sit strictly inside the
 *  vacancy slack: 1 − RELIEF_TARGET < VACANCY_SLACK, so relief housing never feeds decay. */
RELIEF_TARGET: 0.92,
```

`fedAndCalm(sys)` becomes `fed(sys)` (supply-dissatisfaction gate only — `D_SETTLE` unchanged).
The calm gate is dropped for relief housing: gating the pressure valve on the pressure being low
is circular, and with shipped constants (tax 0.18 + crowding 0.05 > retired `UNREST_SETTLE` 0.2) a
high-tax crowded world would deadlock. `plannedHousingUnits` rewrite:

```ts
export function plannedHousingUnits(sys: BuildSystemState): number {
  if (!fed(sys)) return 0;
  const headroom = habitableHousingHeadroom(sys);
  if (headroom < 1) return 0;
  const popProvided = BUILDING_TYPES[HOUSING_TYPE]?.popProvided ?? POP_CENTRE_DENSITY;
  if (popProvided <= 0) return 0;
  const currentPopCap = housingPopCap(sys.buildings);
  const pop = Math.max(0, sys.population);
  if (pop <= DIRECTED_BUILD.RELIEF_TRIGGER * currentPopCap) return 0; // r ≤ 0.95: no pressure yet
  const targetPopCap = pop / DIRECTED_BUILD.RELIEF_TARGET;            // size back to r ≈ 0.92
  const wantUnits = (targetPopCap - currentPopCap) / popProvided;
  if (wantUnits <= 0) return 0;
  return Math.min(Math.floor(headroom), Math.max(1, Math.ceil(wantUnits)));
}
```

Notes: `popCap = 0` with stranded population passes the trigger (`pop > 0`) — collapse recovery
builds again once fed. Whole-level round-up means post-build `r ≤ RELIEF_TARGET` exactly when land
permits. The round-up docstring is **rewritten**: its "population exceeding its own cap is
impossible" premise is deleted by decision 1; the new rationale is that a fractional relief want
still commits one whole level so a small system's valve is not floored to nothing. A constants
test asserts `1 − DIRECTED_BUILD.RELIEF_TARGET < VACANCY_SLACK` (imports from
`lib/constants/infrastructure.ts`).

### 7. Colony establish bundles headroom (`sizeColonyEstablish`)

```ts
const housingLevels = Math.min(maxHousingLevels, Math.ceil(seedPop / POP_CENTRE_DENSITY) + 1);
```

One line: +1 level beyond seed need, still clamped to the whole-level habitable capacity — a
land-tight seed opens at r ≈ 1.0 and relies on the crowd brake + migration push (spec §3). `work`
already scales with `housingLevels`; the player's direct-colony verb shares this helper, so both
order identical projects with no second change site.

### 8. Harness metrics

`PopulationSummary` (`lib/tick-harness/population-analysis.ts`):

- `saturatedCount` keeps its definition but its docstring and the simulate report line re-base to
  **healthy resting state** (pop ≈ popCap is the design target now, not a pathology).
- New `brakedCount`: systems with `popCap > 0 && crowdFactor(population, popCap,
  CROWDING.BRAKE_END) ≤ 0.25` — growth mostly braked; the new pathology signal when it grows while
  relief exists (r pinned at the brake means the valve is blocked or land-exhausted).
- New `meanOccupancy`: mean of `population/popCap` over systems with `popCap > 0`.

Migration throughput (mirrors the `buildCommitmentsByGood` pattern end to end):

```ts
// lib/tick/types.ts — TickProcessorResult gains:
/** People moved this cycle start (colonist delivery + edge diffusion), conserved flows only.
 *  Calibration instrumentation — surfaced via runWorldTick().instrumentation, never broadcast. */
migrationMoved?: { colonists: number; diffusion: number };

export type TickInstrumentation =
  Pick<TickProcessorResult, "buildCommitmentsByGood" | "migrationMoved">;
```

The migration processor sums `allocateColonists` deliveries and per-edge `moved` into the result;
`runWorldTick` captures it beside `buildCommitmentsByGood` and returns it in `instrumentation`;
the runner accumulates totals + a per-cycle mean; experiment JSON and the simulate console report
gain a migration-throughput line (people/cycle, colonists vs diffusion split).

### 9. Stale plan-referencing comments fixed in passing

Per the comments-describe-code convention, rewrite (not delete the constants) the stale old-
roadmap references: `lib/constants/population.ts:42` ("PR4 rebalance"), `:54` ("PR4-calibrated"),
and `lib/constants/directed-build.ts` `SPECULATIVE_FLOOR` ("Calibrated in PR4") — describe what
the values do today; calibration provenance goes unstated.

## Global constraints

- Pure engine, deterministic tick, finite JSON world state. Every new function is total: no
  `Infinity`/`NaN` for any input (popCap ≤ 0, negative pop, catchUp > 1 included).
- No forbidden `as`, postfix `!` outside test idiom, or `unknown`.
- `catchUpFactor` scaling stays in the processor, not the engine; scaled decay is clamped to [0,1].
- Developed systems only; controlled/unclaimed markets remain inert.
- PR1 persisted `satisfaction`, PR2 selling-factor/funding-marker, PR3 counters keep their
  semantics untouched. `VACANCY_SLACK` is consumed, not changed.
- Constants remain scale-invariant (all new terms are ratios of pop/popCap or satisfactions).
- Migration engine math (`migrationFlow`, weights, leak) is untouched — instrumentation only.
- No UI changes: regime chips, occupancy bar overshoot treatment, stability surface are PR5.

---

### Task 1: Engine core — crowd brake, gated death, regime helper, floor-relaxation integrator

**Modify:** `lib/engine/population.ts`, `lib/constants/population.ts`,
`lib/constants/economy.ts`.

**Test:** `lib/engine/__tests__/population.test.ts`, `lib/constants/__tests__/band-constants.test.ts`.

- [ ] Create the branch and verify PR3 ancestry:

```bash
git status --short
git switch -c feat/band-reconciliation-pr4-population
git merge-base --is-ancestor d797c1b HEAD
git add docs/build-plans/band-reconciliation-pr4-population.md
git commit -m "docs(plan): PR4 population/housing task plan"
```

- [ ] Write failing tests — crowd brake: `crowdFactor` = 1 at r ≤ 1, 0 at r ≥ 1.15, smooth and
  strictly decreasing between, 0 (not NaN) at popCap ≤ 0; `populationDelta` grows at full rate at
  r = 0.99 (vs the old logistic's near-zero), zero growth at r ≥ 1.15, decline unchanged.
- [ ] Failing tests — death gate: overshoot death is 0 at unrest = 0.65 exactly and below, fires
  above; invariant `overshootDeathUnrestGate === STRIKE_PARAMS.threshold`.
- [ ] Failing tests — `supplyRegime`: all satisfaction 1 ⇒ supplied; any < 1 ⇒ rationing; any
  < 0.5 ⇒ shortage; zero-demand goods ignored; empty ⇒ supplied; boundary at exactly 0.5 is
  rationing (strict `<`).
- [ ] Failing tests — `accumulateUnrest`: settles exactly at `floor` from above and below at
  D = 0 regardless of decay rate; supplied excess decays at `recoveryDecay`, rationing at `decay`
  (assert the geometric factor over two steps); shortage rises faster than rationing at equal D;
  monotonic across the regime boundary (worse regime + equal-or-worse D ⇒ ≥ unrest); one
  full-shortage cycle from floor 0.23 stays < 0.65; output clamped [0,1]; k clamped so decay
  scaled by catchUp 2 never overshoots the floor.
- [ ] Failing tests — `crowdingPressure`: 0 at r ≤ 1, 0.05 at r ≥ 1.15, linear between, 0.05 at
  popCap ≤ 0 with pop > 0, 0 with pop ≤ 0.
- [ ] Implement per Locked Decisions 1–4: `crowdFactor`, `crowdingPressure`, `supplyRegime`,
  `SHORTAGE_SATISFACTION` beside `RATION_COVER`, new `UnrestParams`/`accumulateUnrest`, reshaped
  `PopulationParams`/`populationDelta`, `CROWDING` constant, `UNREST_PARAMS = { gainRationing:
  0.06, gainShortage: 0.12, decay: 0.06, recoveryDecay: 0.12 }`, `POPULATION_PARAMS` gains
  `crowdBrakeEnd: CROWDING.BRAKE_END, overshootDeathUnrestGate: STRIKE_PARAMS.threshold`. Update
  the file-head "consequence spine" doc for the floor/regime shape.
- [ ] Update existing population engine tests to the new signatures; keep every behavioural
  assertion that still applies (convexity, demand weighting, strike ramp).
- [ ] Verify:

```bash
npx vitest run lib/engine/__tests__/population.test.ts lib/constants/__tests__/band-constants.test.ts
npx tsc --noEmit
```

- [ ] Commit: `feat(population): crowd-braked growth and floor-relaxation unrest engine`.

---

### Task 2: Thread regime and floor through economy signal and population processor

**Modify:** `lib/tick/types.ts`, `lib/tick/processors/economy.ts`,
`lib/tick/processors/population.ts`, `lib/tick/world/population-world.ts`.

**Test:** `lib/tick/processors/__tests__/economy.test.ts`,
`lib/tick/processors/__tests__/population.test.ts`, `lib/world/__tests__/tick-treasury.test.ts`.

- [ ] Failing tests — economy processor emits `supplyRegimeBySystem`: a system with all
  satisfactions 1 reads supplied, one rationed good reads rationing, one deep-shortage good
  (satisfaction < 0.5) reads shortage, a produce-only system with no consumption reads supplied.
- [ ] Failing tests — population processor: tax pressure enters as floor, not gain (a taxed calm
  supplied system settles AT `TAX_LEVEL_UNREST_PRESSURE[level]`, not gain × it — update the
  `0.06 × 0.18` first-cycle assertion deliberately); crowding pressure raises the floor at
  r > 1 and is absent at r ≤ 1; missing regime map entry defaults supplied; missing tax map ⇒
  floor is crowding only; all four unrest rates scale by catchUp at interval 48.
- [ ] Implement Locked Decision 5. Update the `PopulationProcessorParams.taxPressureBySystem` and
  processor comments (floor, not d term).
- [ ] Re-run the treasury tick test — higher tax must still mean strictly higher unrest through
  the real tick (it holds: higher floor ⇒ higher equilibrium); update magnitude expectations only
  if asserted exactly.
- [ ] Verify:

```bash
npx vitest run lib/tick/processors/__tests__/economy.test.ts lib/tick/processors/__tests__/population.test.ts lib/world/__tests__/tick-treasury.test.ts
npx tsc --noEmit
git add lib
git commit -m "feat(population): regime-sensitive unrest through the economy signal"
```

---

### Task 3: Housing relief valve

**Modify:** `lib/constants/directed-build.ts`, `lib/engine/directed-build.ts`.

**Test:** `lib/engine/__tests__/directed-build.test.ts`, constants test for the slack invariant.

- [ ] Failing tests — trigger/sizing: r = 0.94 builds nothing; r = 0.96 builds; sizing returns
  post-build r ≤ 0.92 (whole-level round-up, land permitting); land clamps to
  `habitableHousingHeadroom`; fractional want still commits one whole level; popCap = 0 with
  stranded fed population builds (collapse recovery); pop = 0 builds nothing.
- [ ] Failing tests — gates: starved system (D > `D_SETTLE`) builds nothing at any r; **unrest no
  longer blocks relief** — rewrite the `fedAndCalm` suite (lines ~685–699) as `fed` and flip the
  1331-line sanity test: a high-tax crowded world (unrest 0.23 > retired `UNREST_SETTLE`) with
  r > 0.95 DOES build relief housing.
- [ ] Failing test — invariant: `1 − DIRECTED_BUILD.RELIEF_TARGET < VACANCY_SLACK` (relief
  vacancy 8% sits strictly inside the 10% decay slack, so relief housing never reads as unused).
- [ ] Implement Locked Decision 6: constants swap (`SETTLE_MARGIN`/`UNREST_SETTLE` deleted,
  `RELIEF_TRIGGER`/`RELIEF_TARGET` added), `fedAndCalm` → `fed`, `plannedHousingUnits` rewrite
  with the rewritten round-up docstring, pass-1 comment updated (relief valve, not lead-ahead).
- [ ] Verify:

```bash
npx vitest run lib/engine/__tests__/directed-build.test.ts lib/constants/__tests__/band-constants.test.ts
npx tsc --noEmit
git add lib
git commit -m "feat(housing): autonomic relief valve replaces settle margin"
```

---

### Task 4: Colony establish bundles a headroom level

**Modify:** `lib/engine/directed-build.ts` (`sizeColonyEstablish`).

**Test:** `lib/engine/__tests__/directed-build.test.ts`, plus the construction-order service test
if it fixes sizing expectations (`lib/services/__tests__/construction-orders.test.ts`).

- [ ] Failing tests: land-rich site sizes `housingLevels = ceil(seedPop/POP_CENTRE_DENSITY) + 1`
  (opens with `popCap ≥ seedPop + one level`, r < 1); land-tight site (habitable space for exactly
  the seed's levels) keeps its clamp and opens at r ≈ 1.0; `work` includes the extra level; a site
  that can't hold one whole level still returns null.
- [ ] Implement Locked Decision 7 (one line + docstring line on the headroom bundle).
- [ ] Check the player direct-colony verb path compiles/tests unchanged (shared helper — no second
  change site; fix any exact-sizing fixtures).
- [ ] Verify:

```bash
npx vitest run lib/engine/__tests__/directed-build.test.ts lib/services/__tests__/construction-orders.test.ts
npx tsc --noEmit
git add lib
git commit -m "feat(colonisation): bundle headroom housing at establish"
```

---

### Task 5: End-to-end recovery and growth ordering through the real tick

**Modify/Test:** `lib/world/__tests__/tick.test.ts` (fixtures per PR3 Task 6's pattern).

- [ ] Recovery fixture: a developed system driven into shortage for one economy cycle (stock
  drained below `SHORTAGE_SATISFACTION` delivery), then restocked. Assert: unrest rose by ≈
  `gainShortage × D` that cycle; next assessment the regime is supplied immediately (satisfaction
  back to 1) while stored unrest **declines geometrically at `recoveryDecay`** toward the
  tax-crowding floor over the following cycles — memory drains at the designed rate, never
  snaps.
- [ ] Growth fixture: a fed, calm, taxed system at r = 0.97 grows at full rate through the real
  tick (the old logistic would have crawled), and its unrest holds at the tax floor; the same
  system pushed to r = 1.16 stops growing but does NOT lose population to overshoot death while
  unrest < 0.65.
- [ ] Relief fixture: the r = 0.97 system's next construction cycle commits relief housing sized
  back to r ≤ 0.92 despite unrest above the retired `UNREST_SETTLE`.
- [ ] Verify and commit `test(population): lock recovery and growth ordering end to end`.

---

### Task 6: Harness — occupancy watch, migration throughput, comment fixes

**Modify:** `lib/tick/types.ts`, `lib/tick/processors/migration.ts`, `lib/world/tick.ts`,
`lib/tick-harness/population-analysis.ts`, harness types/runner/experiment,
`scripts/simulate.ts`, the three stale comments (Locked Decision 9).

**Test:** `lib/tick-harness/__tests__/population-analysis.test.ts`,
`lib/tick/processors/__tests__/migration.test.ts`, `lib/tick-harness/__tests__/experiment.test.ts`.

- [ ] Failing tests — summary: `brakedCount` counts crowdFactor ≤ 0.25 systems only;
  `meanOccupancy` over popCap > 0 systems; `saturatedCount` unchanged numerically.
- [ ] Failing tests — throughput: migration processor result sums colonist deliveries and edge
  moves separately; mid-cycle ticks report nothing; conserved flows only (no death/growth terms);
  experiment JSON includes the throughput summary.
- [ ] Implement Locked Decision 8: processor result field, `TickInstrumentation` pick,
  `runWorldTick` capture + return, runner accumulation (totals + per-cycle mean), simulate report
  lines (population section gains occupancy/braked; new migration-throughput line with the
  land-tight-seed caveat noted in the section header comment).
- [ ] Rewrite the three stale plan-referencing comments (Locked Decision 9) — values unchanged.
- [ ] Verify:

```bash
npx vitest run lib/tick-harness/__tests__/population-analysis.test.ts lib/tick/processors/__tests__/migration.test.ts lib/tick-harness/__tests__/experiment.test.ts
npx tsc --noEmit
git add lib scripts/simulate.ts
git commit -m "feat(sim): occupancy watch and migration throughput metrics"
```

---

### Task 7: Cross-layer regression sweep

- [ ] Search retired/reshaped symbols — every hit must be a deliberate survivor:

```bash
rg -n "SETTLE_MARGIN|UNREST_SETTLE|fedAndCalm|accumulateUnrest|UNREST_PARAMS|overshootDeath|crowdFactor|crowdingPressure|supplyRegime|SHORTAGE_SATISFACTION|saturatedCount" lib components
```

No orphaned imports; the old logistic headroom appears nowhere; tax enters unrest at exactly one
site (the floor); `SupplyRegime` has one definition.

- [ ] Confirm scale/cadence invariance and the full suite:

```bash
npx vitest run lib/engine/__tests__/economy-scale-invariance.test.ts lib/world/__tests__/cadence-invariance.test.ts
npx vitest run
npx tsc --noEmit
```

Keep interval/scale assertions ratio-based. Commit only genuine corrections with a narrow subject.

---

### Task 8: Simulator validation, build gate, PR, and review

- [ ] Confirm clean branch/log:

```bash
git status --short
git log --oneline --decorate feat/band-reconciliation..HEAD
```

- [ ] Run:

```bash
npm run simulate -- --config experiments/examples/equilibrium-calibration.yaml
npm run simulate
```

Judge PR4 scope only, directionally (no hard gate — results are discussed when read):

- no NaN/Infinity/runaway, no broken saves, no new stock pins;
- population growth improves on −3.2%; mean unrest improves on 0.703; striking count improves on
  385 (at least minor movement on each — flag any that regress);
- crowded systems idle at their tax + crowding floor, never strike off the floor alone;
- relief housing commits at crowded fed systems (no r pinned at the brake with land available and
  `brakedCount` growing);
- colonies open with headroom (land permitting) and the migration-throughput line is non-trivial
  after the logistics warm-up (respect the 600-tick warm-up caveat);
- housing stacks stay stable (no relief-decay churn — the 8%-inside-10% invariant holding live);
- do not chase PR5 scope (regime chips, needs severity, cover levels, recalibration).

Record population/unrest/striking/braked/occupancy, migration throughput, burst-build, logistics,
price/cover, and treasury readouts in the PR body against the PR3 baselines. Tune only within
coarse first-cut ranges if an initial value is nonfunctional (gainShortage 0.10–0.15,
recoveryDecay 0.10–0.15, trigger/target 0.94–0.96 / 0.90–0.93, PRESSURE_MAX 0.03–0.07) and
document it.

- [ ] Final gates:

```bash
npx vitest run
npx next build --webpack
```

- [ ] Push/open before review:

```bash
git push -u origin feat/band-reconciliation-pr4-population
gh pr create --base feat/band-reconciliation --title "feat(population): PR4 — crowd-braked growth, floor-relaxation unrest, relief housing" --body "<crowd brake + gated death + regime unrest + relief valve + colony headroom + harness metrics + sim readout vs PR3 baselines + PR5 interim notes>"
```

PR body explicitly records: the floor-relaxation integrator shape and why (tax equilibrium by
construction, decoupled recovery tuning); the worst-good regime fold rationale; the calm-gate
deadlock arithmetic; the land-tight colony behaviour; sim deltas vs PR3 baselines; remaining PR5
scope (regime presentation, `RATION_EXIT_EPS`, needs severity, `computeCoverLevels`,
recalibration, docs fold).

- [ ] Run `/uber-review` on the checked-out PR head, fix in-scope findings, rerun gates, and
  squash/fast-forward into `feat/band-reconciliation`. Do not merge shared to main before PR5.

## Self-review checklist

- [ ] Every umbrella PR4 sentence and spec §3 bullet maps to a task/test.
- [ ] The logistic headroom term is deleted, not disguised; growth at r < 1 is crowd-free.
- [ ] Overshoot death fires only above the strike threshold; the gate constant is asserted equal
  to `STRIKE_PARAMS.threshold`.
- [ ] Tax enters unrest exactly once, as floor; equilibria are preserved by construction and the
  old gain-path assertion is deliberately rewritten, not accidentally kept.
- [ ] Supplied/rationing/shortage boundaries ride shared constants (`RATION_COVER` geometry via
  satisfaction < 1; `SHORTAGE_SATISFACTION = 0.5` shared forward to PR5).
- [ ] Relief housing: fed gate kept, calm gate dropped, 8% vacancy strictly inside 10% slack
  asserted, round-up docstring rewritten.
- [ ] Colony +1 level clamps to habitable capacity; player verb shares the helper.
- [ ] `crowd`/`crowdingPressure`/`accumulateUnrest` are total — popCap ≤ 0 and catchUp 2 covered.
- [ ] Migration instrumentation is transient, conserved-flows-only, never broadcast/persisted;
  migration *math* untouched.
- [ ] Stale "PR4" comments rewritten; no new plan-referencing comments introduced.
- [ ] PR5 scope (presentation, severity re-base, cover levels, recalibration, docs fold) excluded.

## Spec-to-task traceability

- §3 growth crowd brake + popCap identity + guard → Task 1.
- §3 overshoot-death rescope → Task 1.
- §3 regime-sensitive unrest + tax siblings + monotonic/equilibrium/recoverable → Tasks 1–2, 5.
- §3 crowding pressure (bounded) → Tasks 1–2.
- §3 relief housing + retired `SETTLE_MARGIN` + calm-gate drop + docstring → Task 3.
- §3 colony establish headroom bundle → Task 4.
- §3 end-to-end recovery test → Task 5.
- §8 saturation-watch inversion + migration throughput → Task 6.
- PR2 `VACANCY_SLACK` containment invariant → Task 3.
- Umbrella "consumes from PR2" note → Task 3 invariant test.
