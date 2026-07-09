# Building & Construction Model — PR3: Discrete Levels + Committed Construction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement
> each task (failing test → code → green). Steps use checkbox (`- [ ]`) syntax for tracking. Overview
> & PR sequence: `docs/build-plans/building-construction-model-plan.md`. Design spec:
> `docs/planned/building-construction-model.md`. Predecessor shapes: PR1 (`…-pr1-control-flag.md`)
> shipped the `control` flag + claim/develop; PR2 (`…-pr2-typed-output.md`) shipped the typed `output`
> discriminant + `computeUtilization(type, count, ctx) → [0,1]` this PR's decay consumes.

**Goal:** Make built capacity a **discrete integer level count** grown only through **committed,
throughput-paced construction projects** and shed only by **whole-level, hysteresis-buffered decay**.
`WorldBuilding.count` flips to an integer (world-gen rounds seeds to whole levels); the
fractional-accretion planner is replaced by a per-faction **throughput pool → queue → per-build
absorption cap** funding model (duration emerges as `work ÷ absorbed`, wealth buys parallel fronts not
instant builds); a level is **under construction** (contributes nothing) until its work lands whole;
the continuous disuse erosion is replaced by a per-`(system, type)` **idle-months countdown** that
removes one whole level after a sustained-idle buffer and resets on refill. Automation stays the only
driver (the auto queue policy = today's ceiling logic deciding what to enqueue). `World` gains
`constructionProjects[]` + `WorldBuilding.idleMonths`; **`SAVE_FORMAT_VERSION` 3 → 4**.

**Why this is one irreducible PR:** the integer-`count` invariant only holds if construction adds whole
levels *and* decay removes whole levels together — a fractional erosion left in place would drift
`count` off-integer the first tick a level sat partly idle. See "the one hard coupling" in the plan-of-
plans. It ships as three internal phase-commits (A integer seed + invariant, B project engine, C
whole-level decay), each green, but they land in one PR because A's invariant is only *maintained* once
B and C are both in.

**Architecture:** Three collaborators change; the goods/pops economy does **not**.
- **`lib/engine/construction.ts` (new)** — pure queue math. `planFactionQueue(...)` reuses the existing
  ceiling logic (habitable → housing → labour-gated industry, incl. the academy/complex co-builds) to
  decide *which whole levels to enqueue*, subtracting both built **and in-flight** levels so it never
  double-commits. `fundQueue(projects, pool, cap)` funds front-first (each build absorbs
  `min(cap, remaining, poolLeft)`), lands a project's levels whole at `workDone ≥ workTotal`.
- **`lib/engine/directed-build.ts`** — the fractional greedy spend pass becomes the auto *queue policy*
  (emit desired projects), not immediate `count` writes.
- **`lib/engine/infrastructure-decay.ts`** — `computeSystemDecay` drops continuous disuse erosion; the
  per-`(system, type)` idle-months buffer counts up when a whole level is idle, resets on refill, and
  removes one level at the buffer; the unrest channel becomes a discrete whole-level teardown.
- Round-trip: `World.constructionProjects[]` threads through `runWorldTick` like `relations`/`nextId`;
  `WorldBuilding.idleMonths` rides on a new parallel `SimSystem.buildingIdleMonths` Record (because
  `flattenBuildings` rebuilds `WorldBuilding[]` wholesale each tick from `SimSystem.buildings`).

**Tech Stack:** TypeScript 5 (strict), Vitest 4, Next.js 16. Pure engine (`lib/engine/*`) + two constant
catalogs (`lib/constants/construction.ts` new, `lib/constants/infrastructure.ts`) + the directed-build
processor/world/adapter trio + `runWorldTick` wiring + world-gen seeding + `save.ts` bump.

## Global Constraints

Inherit **all** constraints from `building-construction-model-plan.md → Global Constraints` (no `as` /
no `unknown` / no postfix `!` except `find(...)!` in tests / JSON-serializable `World`, **no
`Infinity`/`NaN`** in project work totals or idle counters / seeded determinism, no wall-clock in the
queue or decay bodies / discriminated unions / coarse-calibration-only / present-tense docs / branch &
commit rules). PR3-specific:

- **Integer invariant is asserted, not assumed.** A tick-witness test drives `runWorldTick` for many
  ticks and asserts every `WorldBuilding.count` is a non-negative integer at every step (the whole
  point of the PR). No production code path may write a fractional `count`.
- **Levels land whole or not at all.** A project contributes **zero** capacity until `workDone ≥
  workTotal`, then adds its full integer `levels` in one step. No partial-level capacity.
- **Decay is whole-level and downward-only.** `count` only ever decrements by whole integers; a
  refill resets the idle countdown (hysteresis). `idleMonths` stays a finite non-negative integer.
- **The throughput pool is derived, not stored.** Computed each pulse from the faction's developed
  systems (`Σ pop × THROUGHPUT_PER_POP`); no new persisted pool field. Only `constructionProjects[]` +
  `idleMonths` persist.
- **One code path.** The auto queue policy is the *only* driver this PR — no player surface, no
  sim-only bots. The player seat (SP1) hand-queues the *same* `constructionProjects[]`.

---

## New / changed shapes (Interfaces PR3 produces)

```ts
// lib/world/types.ts
export interface WorldConstructionProject {
  id: string;               // drawn from World.nextId
  factionId: string;        // funding faction (developed-system owner)
  systemId: string;         // build site (must be control === "developed")
  buildingType: string;     // good id | "housing" | academy | complex type
  levels: number;           // whole levels this project lands (integer ≥ 1)
  workTotal: number;        // levels × WORK_COST_PER_LEVEL[type]
  workDone: number;         // accumulated construction points [0, workTotal]
}
// World gains:  constructionProjects: WorldConstructionProject[];
// WorldBuilding gains:  idleMonths: number;   // sustained-idle countdown, integer ≥ 0
```

```ts
// lib/engine/construction.ts
export interface DesiredProject {          // planFactionQueue output (pre-id)
  factionId: string; systemId: string; buildingType: string; levels: number;
}
export interface LandedLevel { systemId: string; buildingType: string; levels: number; }
export function planFactionQueue(
  systems: BuildSystemState[], routeCost: RouteCost, openProjects: WorldConstructionProject[],
): DesiredProject[];
export function fundQueue(
  projects: WorldConstructionProject[], pool: number, cap: number,
): { projects: WorldConstructionProject[]; landed: LandedLevel[] };
```

`SimSystem.buildingIdleMonths: Record<string, number>` (parallel to `buildings`); `DecayParams` drops
`disuseRate`, gains `idleBufferMonths`; `computeSystemDecay` gains `buildingIdleMonths` in/out.

---

## File-by-file map

| File | Change |
|---|---|
| `lib/world/types.ts` | **+** `WorldConstructionProject`; **+** `World.constructionProjects`; **+** required `WorldBuilding.idleMonths`. |
| `lib/world/save.ts` | `SAVE_FORMAT_VERSION` 3 → **4**. |
| `lib/constants/construction.ts` **(new)** | `THROUGHPUT_PER_POP`, `PER_BUILD_ABSORPTION_CAP`, `WORK_COST_PER_LEVEL: Record<string, number>` (coarse first-cut: housing < extractor < factory < shipyard/complex). A level adds **+1** to `count` (no separate capacity chunk — today's `count` unit already *is* the level). |
| `lib/constants/infrastructure.ts` | `DecayParams`: drop `disuseRate`; **+** `idleBufferMonths` (hysteresis length, in decay runs ≈ months). Keep `unrestRate`/`unrestThreshold` (now discrete teardown). |
| `lib/engine/construction.ts` **(new)** | `planFactionQueue` (auto policy: reuse `directed-build` ceiling logic, subtract built + in-flight levels, emit whole-level `DesiredProject[]`) + `fundQueue` (front-first funding, per-build cap, whole-level landing). |
| `lib/engine/directed-build.ts` | The greedy spend pass returns *desired whole-level projects* (rounded) rather than fractional `PlannedBuild` count writes; feeds `planFactionQueue`. Housing/academy/complex co-builds become their own desired projects. |
| `lib/engine/infrastructure-decay.ts` | `computeSystemDecay` whole-level: per `(system, type)` idle-months buffer (up when ≥1 whole level idle, reset on refill, drop 1 level at buffer) + discrete unrest teardown; returns `newIdleMonths`. Drop `disuseDecay`; keep `unrestDecay` as the discrete channel. |
| `lib/engine/simulator/types.ts` | **+** `SimSystem.buildingIdleMonths: Record<string, number>`. |
| `lib/tick/world/directed-build-world.ts` | **+** `WorldConstructionProject` read (`getConstructionProjects`) + `applyConstructionUpdates` (upsert/remove projects); landed levels still flow through `applyBuildingIncreases` (now integer). |
| `lib/tick/adapters/memory/directed-build.ts` | Capture the project set + expose the updated `constructionProjects` + `landed` for write-back. |
| `lib/tick/processors/directed-build.ts` | Drive the queue: derive pool, `planFactionQueue` → assign ids from a passed `nextId`, `fundQueue`, apply landed integer levels + persist project deltas. |
| `lib/tick/world/infrastructure-world.ts` + `…/adapters/memory/infrastructure.ts` | Thread `buildingIdleMonths` in the state view + `applyIdleMonths` write-back. |
| `lib/tick/processors/infrastructure-decay.ts` | Pass `buildingIdleMonths` into `computeSystemDecay`; write back `newIdleMonths`. |
| `lib/world/tick.ts` | `toSimSystems`: seed `buildingIdleMonths` from `WorldBuilding.idleMonths`. `flattenBuildings`: emit `idleMonths` per row. Thread `let constructionProjects` through the directed-build call (read → processor → write-back) using `nextId`; assemble into `nextWorld`. |
| `lib/world/gen.ts` / `lib/engine/industry-seed.ts` | Round `allocateIndustry`'s final `buildings` Record to whole levels; seed every `WorldBuilding.idleMonths: 0`; `World.constructionProjects: []`. |
| Tests | **new** `lib/engine/__tests__/construction.test.ts`; extend `directed-build`, `infrastructure-decay` (engine + processor + adapter), `tick`, `industry-seed`/`gen`, `save` tests. |

---

## Internal phase-commit sequence

Ships as three green commits in one PR (each `npx vitest run` + `npx tsc --noEmit` clean):

- **Phase A — integer seed + invariant witness.** Types + save bump; round world-gen seeds to whole
  levels; `SimSystem.buildingIdleMonths` + round-trip plumbing (seeded 0, no behaviour yet); the
  integer-invariant tick-witness test (RED until C lands — commit it `.skip`/xfail-annotated, or land
  it at the end of C — see Task 8). Small, mechanical, isolates the shape change.
- **Phase B — construction projects.** Constants; `construction.ts` engine; directed-build engine →
  desired projects; world/adapter/processor drive the pool+queue; tick wiring of
  `constructionProjects[]`. After B, capacity grows only via landed integer levels.
- **Phase C — whole-level buffered decay.** Rework `computeSystemDecay`; drop fractional erosion;
  idle-months round-trip; discrete unrest teardown. After C, the integer invariant is *maintained* and
  the witness (Task 8) goes green.

---

## Tasks

### Task 1 — `World` shapes + save bump (Phase A)

- [ ] **Test** (`lib/world/__tests__/save.test.ts`): a round-tripped world with a
  `constructionProjects` entry + a `WorldBuilding.idleMonths` survives `serialize`→`deserialize`;
  `SAVE_FORMAT_VERSION` is 4; a v3 save is rejected.
- [ ] Add `WorldConstructionProject`; `World.constructionProjects`; required `WorldBuilding.idleMonths`;
  bump `SAVE_FORMAT_VERSION` 3 → 4. `tsc --noEmit` lists every unset `idleMonths`/`constructionProjects`
  construction site (gen, flatten, tests) — fix each.
- [ ] Commit: `feat(world): construction-project + idleMonths state (save v4)`.

### Task 2 — Integer world-gen seeds (Phase A)

- [ ] **Test** (`lib/engine/__tests__/industry-seed.test.ts`): `allocateIndustry` returns whole-integer
  counts for a mixed base (extractors, factories, academies, complex, housing); extractors never exceed
  `slotCap` after rounding (floor at the slot cap); a habitable-less system still seeds 0.
- [ ] Round the final `buildings` Record in `allocateIndustry` to whole levels (round; **floor** where a
  hard cap applies — extractors vs `slotCap`, housing vs habitable/general headroom — so rounding never
  breaches a physical bound). Seed `constructionProjects: []` in `gen.ts`; every `WorldBuilding.idleMonths
  = 0`.
- [ ] **Verify:** `npx vitest run lib/engine/__tests__/industry-seed.test.ts lib/world/__tests__/gen.test.ts`.
- [ ] Commit: `feat(worldgen): seed whole-integer building levels`.

### Task 3 — `buildingIdleMonths` round-trip plumbing (Phase A, inert)

- [ ] **Test** (`lib/world/__tests__/tick.test.ts`): `toSimSystems` seeds `buildingIdleMonths` from
  `WorldBuilding.idleMonths`; `flattenBuildings` writes it back; a tick with no decay preserves it.
- [ ] Add `SimSystem.buildingIdleMonths`; seed it in `toSimSystems` (parallel to `buildingsBySystem`);
  emit `idleMonths` in `flattenBuildings` (0 when absent); thread `buildingIdleMonths` through the
  infrastructure-world state view + `applyIdleMonths` (no-op write for now). No decay behaviour change.
- [ ] **Verify:** `npx vitest run lib/world/__tests__/tick.test.ts`; `npx tsc --noEmit`.
- [ ] Commit: `feat(tick): thread building idleMonths through the sim round-trip`.

### Task 4 — Construction constants + `fundQueue` engine (Phase B)

- [ ] **Test** (`lib/engine/__tests__/construction.test.ts`): `fundQueue` — (a) a single build absorbs
  `min(cap, remaining, pool)` per call, so a `workTotal = 8×cap` build takes 8 pulses (emergent
  duration); (b) `pool = 4×cap` funds up to 4 fronts in parallel while the big build still finishes at
  `workTotal ÷ cap`; (c) a build lands its whole `levels` only at `workDone ≥ workTotal` and is removed
  from the returned open set; (d) leftover pool cascades front-first to the next build; (e) zero pool →
  no landings, projects unchanged.
- [ ] Add `lib/constants/construction.ts` (`THROUGHPUT_PER_POP`, `PER_BUILD_ABSORPTION_CAP`,
  `WORK_COST_PER_LEVEL`). Implement `fundQueue` (pure, deterministic, front-first). Guard against
  `NaN`/`Infinity` work totals.
- [ ] **Verify:** `npx vitest run lib/engine/__tests__/construction.test.ts`.
- [ ] Commit: `feat(construction): throughput-paced fundQueue engine`.

### Task 5 — Auto queue policy `planFactionQueue` (Phase B)

- [ ] **Test** (`lib/engine/__tests__/construction.test.ts`): `planFactionQueue` — (a) emits whole-level
  `DesiredProject[]` toward the same ceilings today's `planFactionBuilds` targets (housing at
  fed-and-calm sites, labour-gated industry at structural deficits); (b) **subtracts in-flight levels**:
  an open project for `(sys, type)` covering the wanted levels yields no new desired project (no
  double-commit); (c) a co-built academy/complex is emitted as its own `DesiredProject` ordered **before**
  the production level it gates (see Open decision 2).
- [ ] Refactor `directed-build.ts`'s greedy pass to compute the same desired levels but round to whole
  integers and emit `DesiredProject[]`; `planFactionQueue` wraps it, reading `openProjects` to compute
  "effective current" = built + queued levels per `(system, type)` for the headroom/labour/space gates.
- [ ] **Verify:** `npx vitest run lib/engine/__tests__/construction.test.ts lib/engine/__tests__/directed-build.test.ts`.
- [ ] Commit: `feat(construction): whole-level auto queue policy`.

### Task 6 — Drive the queue in the processor (Phase B)

- [ ] **Test** (`lib/tick/processors/__tests__/directed-build.test.ts` + adapter test): given a faction
  with population and an open queue, the processor derives the pool (`Σ pop × THROUGHPUT_PER_POP`),
  funds it, applies landed integer levels via `applyBuildingIncreases`, and persists project deltas +
  new projects (ids from the passed `nextId`) via `applyConstructionUpdates`; nothing lands with zero
  pool.
- [ ] Extend `DirectedBuildWorld` (`getConstructionProjects` / `applyConstructionUpdates`) + the memory
  adapter; rewrite the processor body: read open projects for due factions, `planFactionQueue`, assign
  ids, `fundQueue`, write landed levels + project set. Remove the fractional `cur + added` write path.
- [ ] **Verify:** `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts`; `npx tsc --noEmit`.
- [ ] Commit: `feat(directed-build): commit + fund construction projects`.

### Task 7 — Wire `constructionProjects` into `runWorldTick` (Phase B)

- [ ] **Test** (`lib/world/__tests__/tick.test.ts`): over several pulses a developed faction accumulates
  `constructionProjects`, then lands whole integer levels; project ids are unique (`nextId` advances);
  `constructionProjects` survives in `nextWorld`.
- [ ] Thread `let constructionProjects = world.constructionProjects` through the directed-build block
  (pass into the adapter, read back the updated set + `nextId`); assemble into `nextWorld`. Pass `nextId`
  to the processor for id minting.
- [ ] **Verify:** `npx vitest run lib/world/__tests__/tick.test.ts`; `npm run simulate` completes (no
  `NaN`/`Infinity`; construction visibly spans pulses).
- [ ] Commit: `feat(tick): persist + advance construction projects`.

### Task 8 — Whole-level buffered decay + integer invariant (Phase C)

- [ ] **Test** (`lib/engine/__tests__/infrastructure-decay.test.ts`): (a) a level idle < `idleBufferMonths`
  is **not** removed and `idleMonths` counts up; (b) a refill (utilization back to full) **resets**
  `idleMonths` to 0 with no removal; (c) at `idleMonths ≥ idleBufferMonths` exactly **one** whole level
  is removed and the counter resets; (d) `unrest > threshold` removes a whole level immediately (discrete
  teardown), independent of the idle buffer; (e) `count` stays a non-negative integer through all of it.
- [ ] **Integer-invariant witness** (`lib/world/__tests__/tick.test.ts`): drive `runWorldTick` for many
  ticks on a small seeded world; assert every `WorldBuilding.count` is a non-negative integer every tick.
- [ ] Rework `computeSystemDecay`: drop `disuseDecay`; per `(system, type)` compute idle whole levels
  `floor(count − buildingUsed(type, count, ctx))`; buffer up/reset/remove-one; discrete unrest teardown;
  return `{ newCounts, newIdleMonths, popCap }`. Update `DecayParams`/`INFRASTRUCTURE_DECAY_PARAMS`
  (`disuseRate` → `idleBufferMonths`). Wire `buildingIdleMonths` in the processor + adapter.
- [ ] **Verify:** `npx vitest run lib/engine/__tests__/infrastructure-decay.test.ts
  lib/tick/processors/__tests__/infrastructure-decay.test.ts lib/world/__tests__/tick.test.ts`.
- [ ] Commit: `feat(decay): whole-level hysteresis-buffered contraction`.

### Task 9 — Full verification gate + doc touch

- [ ] `npx vitest run` (all green), `npx tsc --noEmit` (clean), `npx next build --webpack` (succeeds),
  `npm run simulate` (completes; coarse sanity — no `NaN`/`Infinity`/runaway/pinning; greedy ≫ random;
  construction visibly takes months; galaxy fills partially; integer counts throughout).
- [ ] Doc touch only where a doc now misdescribes the code (present-tense; no change-history). Candidates:
  `economy-autonomic-agency.md` (build is now committed/timed/discrete),
  `economy-infrastructure-decay.md` (whole-level buffered). Full promotion + SPEC map is PR4.
- [ ] Commit (if docs touched): `docs(economy): committed construction + whole-level decay`.

---

## Open decisions (raise with the human before Task 5 / Task 8)

1. **Auto-policy double-enqueue model (Task 5, recommended: subtract in-flight levels).** The planner
   runs every pulse; without awareness of open projects it would re-enqueue the same level every pulse.
   Recommendation: `planFactionQueue` treats "effective current" as **built + queued** levels per
   `(system, type)` for all headroom/labour/space gates, so an in-flight level counts as committed and is
   not re-added. Alternative (simpler, worse): skip any `(system, type)` that has *any* open project —
   coarser, blocks stacking a 2nd level while the 1st builds. Recommend the former.

2. **Academy/complex ordering vs the production level they gate (Task 5, recommended: gate-first).** A
   production level that lands before its academy licence exists is unstaffable and immediately starts
   its idle countdown. Recommendation: emit co-built academy/complex projects **ahead** of the
   production project in the queue so throughput funds the gate first. Alternative: let it land and
   self-heal (the academy lands a pulse or two later; coarse decay buffer absorbs the gap). Recommend
   gate-first — it's a queue-order tweak, not new machinery.

3. **Decay granularity (Task 8, recommended: per-`(system, type)`, one level per run).** `idleMonths`
   lives per `WorldBuilding` = per `(system, type)`, so the natural unit is: a type accrues idle months
   when `floor(count − used) ≥ 1`, and at the buffer sheds **one** level (the marginal least-utilised is
   implicitly that type's top level). Alternative: a per-system single "marginal level" clock across all
   types — more faithful to "the least-utilised level in the whole system" but needs a system-level
   counter the round-trip doesn't have. Recommend per-`(system, type)`; it's integer-clean and rides the
   `idleMonths` field already added.

4. **First-cut coarse numbers (Task 4, PR4 tunes).** `PER_BUILD_ABSORPTION_CAP` sets the per-build
   minimum months = `WORK_COST_PER_LEVEL ÷ cap`; pick work costs so a housing level spans ~2–3 months
   and a shipyard/complex level ~6–8 at a single-system pool, and `THROUGHPUT_PER_POP` near today's
   `GENERATION_PER_POP` (0.05) scale so early empires build serially. Illustrative only — PR4 calibrates
   against the harness; do not tune here.
