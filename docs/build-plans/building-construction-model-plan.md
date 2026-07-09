# Building & Construction Model — Implementation Decomposition

> **Status:** Build plan (transient — delete when the feature ships; the functional spec moves to
> `docs/active/` and the code becomes the source of truth). Decomposes the approved design spec
> `docs/planned/building-construction-model.md` into four sequenced PRs on a shared feature branch.
> Full task-by-task TDD detail is authored **one PR ahead** (PR1's detail lives in
> `building-construction-pr1-control-flag.md`); PR2–PR4 detail is written as each predecessor lands,
> so later tasks type against the shapes their predecessors actually shipped rather than guesses.

**Goal:** Replace the illegible/uncommitted/untimed fractional-accretion build layer with a
player-ready model — discrete-level capacity, committed throughput-paced construction projects, typed
building output, slow whole-level buffered decay, and ownership as a system `control` flag — while
keeping the genre-agnostic goods/pops economy untouched.

**Architecture:** The goods/pops economy (26-good input→output chains, prices-from-stock, labour and
skill-tiered pops, trade flow) reads building *capacity* and computes output; it is a **different
processor** from the build layer and is left alone. The redesign changes only how capacity is born
(committed projects funded by a per-faction throughput pool), staffed/measured (one uniform typed
output + continuous utilization), shed (whole-level buffered contraction), and owned (a three-state
`control` flag instead of outpost/station buildings).

**Tech Stack:** TypeScript 5 (strict), Vitest 4, Next.js 16. Pure engine (`lib/engine/*`), in-memory
tick adapters (`lib/tick/adapters/memory/*`), the shared tick body `runWorldTick` (`lib/world/tick.ts`),
seeded RNG (`tickRng`/`mulberry32`). No DB, no auth — the world is an in-memory JSON-serializable
singleton persisted to save files.

---

## Global Constraints (apply to every PR / every task)

- **No `as` casts** except `as const` and inside `lib/types/guards.ts`. Fix types at the source.
- **No `unknown`** anywhere except `JSON.parse` at true boundaries (save `deserialize`, API), narrowed
  immediately. No `Record<string, unknown>`.
- **No postfix `!`** except `find(...)!` in tests (accepted project idiom).
- **`World` stays JSON-serializable:** no `Map`/`Set`/`Date`/class instances, and no `Infinity`/`NaN`
  in world state — guard tick math that could produce them.
- **Determinism:** tick math uses seeded RNG (`tickRng(seed, tick)`); never read
  `Date.now`/`Math.random`/`new Date()` inside a processor or engine body.
- **Discriminated unions for result/variant types:** `{ ok: true; … } | { ok: false; … }`, and the
  typed building `output` union — never `{ kind: string; …optional }`.
- **Type at the boundary, trust downstream.** The in-memory adapters narrow string-typed row columns
  to unions on the way to a processor body; services return fully typed data.
- **Unit tests:** `npx vitest run <path>` for one file; `npx vitest run` for all.
- **Build gate:** `npx next build --webpack` (webpack is the stable PR gate; Turbopack build has other
  quirks). Also `npx tsc --noEmit` for the type graph.
- **Calibration bar: coarse only** across all four PRs — no `NaN`/`Infinity`/runaway/pinning, greedy ≫
  random, construction visibly takes months, the galaxy fills **partially**. Precision tuning is
  deferred (perishable; later phases move the target). Loosen any magnitude-pinning assertions to
  ranges.
- **Active docs are present-tense** — no change-history, no phase nicknames/numbers; deferred features
  stated as present-fact + a minimal `docs/planned/` pointer.
- **Branch:** shared `feat/substrate-reset`; each PR is a phase branch off it (or committed directly to
  shared with clean atomic commits), squash/ff-merged — never a regular merge commit. Commit after each
  task.

---

## The one hard coupling that fixes the order

The economy is **linear in `count`** (`production = Σ count × outputPerUnit × effectiveFulfilment ×
yieldMult × familyAnchorBuff`, `lib/engine/industry.ts:386`), so an **integer** `count` "just works" as
capacity — no economy-math rewrite. But the **integer-levels invariant** only holds if **construction
lands whole levels** *and* **decay removes whole levels** in the *same* step; otherwise the current
fractional erosion (`disuseRate · (count − used)` per pulse) drifts counts off-integer. Therefore
"discrete levels + construction projects + whole-level decay" is **one irreducible PR** (PR3). The
control flag (PR1) and the typed-output refactor (PR2) are cleanly separable and land first.

---

## PR sequence

| PR | Deliverable | New `World` state | Save bump |
|---|---|---|---|
| **PR1** | Ownership as a `control` flag: claim (→controlled) + develop (→developed) + gate replacement; retire outpost/station building types | `WorldSystem.control` | 2 → **3** |
| **PR2** | Typed-output building model: `output` discriminant; unify decay `used` + the economy read into one utilization; un-priced abstract-capacity track. Counts stay fractional | none | none |
| **PR3** | Discrete integer levels + committed construction projects (throughput pool + queue + per-build cap → emergent duration) + whole-level hysteresis-buffered decay | `World.constructionProjects[]`, `WorldBuilding.idleMonths` | 3 → **4** (after PR1) |
| **PR4** | Coarse calibration + profiling (600/5k/20k) + doc promotion & roadmap reconciliation | none | none |

Each PR ends with: full `npx vitest run` green, `npx tsc --noEmit` clean, `npx next build --webpack`
succeeds, and `npm run simulate` completes with no `NaN`/`Infinity`/runaway.

---

## PR1 — Ownership as a `control` flag

**Full task detail:** `docs/build-plans/building-construction-pr1-control-flag.md`.

**Goal:** Add `WorldSystem.control ∈ {unclaimed, controlled, developed}`; world-gen seeds homeworlds
`developed` and everything else `unclaimed`; the monthly pulse gains a **claim** step (unclaimed →
controlled, scored + deterministically resolved) and a **develop** step (controlled → developed +
conserved colony-population bootstrap); the develop-gate becomes `system.control === 'developed'`; the
`outpost`/`space_station` building types leave the catalog. This reconciles the parked PR2b (claim) +
PR2c (develop) onto the flag — *simpler*, because a claim sets a field instead of adding a building row.

**Why now / why this shape:** expansion is currently **absent** — every faction is confined to its
seeded homeworld (the claim step was parked pending this redesign). PR1 restores the full
claim→develop growth loop on the flag the whole build model reads, and kills the marker-riding-the-decay
bug the building-based ownership had. It is independent of the build-layer internals (levels, projects,
decay), so it lands first and unblocks the develop-gate PR3 needs.

**Files (create / modify):**
- `lib/world/types.ts` — add `SystemControl` union + `WorldSystem.control`.
- `lib/engine/simulator/types.ts` — add `SimSystem.control`.
- `lib/constants/expansion.ts` **(new)** — reach/claim/develop tuning (`REACH_JUMPS`,
  `MAX_CLAIMS_PER_PULSE`, `MAX_DEVELOPS_PER_PULSE`, `SCORE_FLOOR`, `SCORE_WEIGHTS`, `DEVELOP_HABITABLE_FLOOR`,
  `COLONY_SEED_POP`).
- `lib/engine/expansion.ts` **(new)** — pure claim scoring + proposal + two-phase resolution
  (adapted from the parked plan) + `planFactionDevelopments`.
- `lib/tick/world/directed-build-world.ts` — `SystemClaim`, `SystemDevelopment`, `applyClaims`,
  `applyDevelopments`; add `control` to `SystemBuildRow`.
- `lib/tick/adapters/memory/directed-build.ts` — capture `claims` + `developments`; expose `control`.
- `lib/tick/processors/directed-build.ts` — optional `claim`/`develop` params; run propose→resolve→apply
  before the build phase.
- `lib/engine/directed-build.ts` — `BuildSystemState.control`; gate `if (s.control !== 'developed')
  continue;` (replaces `hasStationFacility`).
- `lib/world/tick.ts` — build the reach provider; pass claim/develop params + `rng`; apply claims &
  developments to Sim systems; **propagate `factionId` + `control` in `mergeSystemsIntoWorld`**;
  populate `control` in `toSimSystems`/`buildBuildRows`; widen the hop-BFS bound by `REACH_JUMPS`.
- `lib/engine/universe-gen.ts` — `applyEmergentStartingCondition` stops seeding outpost/station.
- `lib/world/gen.ts` — set `control` on each `WorldSystem` (`developed` for owned homeworlds, else
  `unclaimed`).
- `lib/constants/industry.ts` — remove `OUTPOST_TYPE`/`SPACE_STATION_TYPE` catalog entries +
  `hasStationFacility`.
- `lib/services/atlas.ts` (+ `lib/types/game.ts` view types if needed) — derive `developed` from
  `control === 'developed'` instead of `popCap > 0`.
- `lib/world/save.ts` — `SAVE_FORMAT_VERSION` 2 → 3.
- Docs: `docs/active/gameplay/faction-system.md`, `docs/active/gameplay/economy-autonomic-agency.md`,
  `docs/SPEC.md`.
- Tests: new `lib/constants/__tests__/expansion.test.ts`, `lib/engine/__tests__/expansion.test.ts`,
  `lib/world/__tests__/tick-expansion.test.ts`; update `industry.test.ts`, `universe-gen.test.ts`,
  `directed-build.test.ts` (engine + processor + adapter), `atlas.test.ts`.

**Task list (detail in the PR1 doc):**
1. Add `SystemControl` + `WorldSystem.control`; bump `SAVE_FORMAT_VERSION`.
2. Seed `control` in world-gen; stop seeding outpost/station buildings; update gen tests.
3. Retire `OUTPOST_TYPE`/`SPACE_STATION_TYPE` + `hasStationFacility`; thread `control` through
   `SimSystem`/`SystemBuildRow`/`BuildSystemState`; replace the develop-gate.
4. Expansion constants.
5. Claim scoring + per-faction proposal (engine).
6. Two-phase deterministic claim resolution (engine).
7. `planFactionDevelopments` + conserved colony-seed selection (engine).
8. `applyClaims` / `applyDevelopments` writeback channel (world interface + memory adapter).
9. Processor claim + develop phase (optional params; inert when omitted).
10. Wire claim + develop into `runWorldTick`; reach provider; `factionId`+`control` merge-back.
11. Derive the `developed` view flag from `control`.
12. Docs + full verification gate (coarse sanity).

**Interfaces PR1 produces (consumed by later PRs / the wider app):**
- `type SystemControl = "unclaimed" | "controlled" | "developed"` (`lib/world/types.ts`).
- `WorldSystem.control: SystemControl`; `SimSystem.control: SystemControl`;
  `SystemBuildRow.control` / `BuildSystemState.control`.
- The develop-gate is now `system.control === "developed"` everywhere (PR3's project engine reads the
  same gate).

---

## PR2 — Typed-output building model

**Goal:** Give every building type a single `output` discriminated union
(`MarketGood | Capacity | Modifier | None`) and collapse the four per-type decay `used` branches +
the economy's production read into **one uniform utilization** `u ∈ [0,1] = min(staffing, inputs,
demand-for-output) / capacity`. Abstract outputs (housing pop-cap, academy skill-licences, complex
%-buff) get an **un-priced** balance track — they never touch the good/price/stock market. **Counts
stay fractional** in this PR; it is a green refactor that dissolves special-cases and sets up PR3.

**Why now / why this shape:** the decay engine already erodes every building with one rule and only the
`used` definition branches per type (`computeSystemDecay`, `lib/engine/infrastructure-decay.ts`); the
economy already reads a per-type production via `buildingProduction`. Unifying these behind the typed
output removes the housing/academy/complex/production branches (fewer special-cases for PR3 to carry
into the whole-level teardown) and gives Capacity/Modifier a first-class, non-market home.

**Files (map-level):**
- `lib/constants/industry.ts` — add `BuildingTypeDef.output: BuildingOutput` (discriminated union);
  populate it in `buildProductionTypes` (MarketGood), `buildComplexTypes` (Modifier), housing
  (Capacity: pop_cap), academies (Capacity: skill1/skill2 licence). `PRODUCTION_BUILDING_TYPES` etc.
  unchanged.
- `lib/engine/industry.ts` — a single `computeUtilization(buildingType, count, ctx)` keyed off
  `output.kind`, reused by both the economy read and decay; the existing helpers (`effectiveFulfilment`,
  `complexUsed`, `housingUsed`, academy demand/cap ratios) become the per-`kind` bodies of that one
  function.
- `lib/engine/infrastructure-decay.ts` — `computeSystemDecay`'s per-type `if/else` collapses to a
  single call to the unified utilization; behaviour preserved (fractional erosion), branches removed.
- Abstract-capacity balance track: an un-priced per-tick income-vs-use accounting for Capacity outputs
  (housing occupancy, licence draw) that the population/labour paths already compute — reorganized, not
  re-derived.
- Tests: unify/extend `infrastructure-decay.test.ts` + `industry.test.ts` to assert the one utilization
  formula matches the old per-type values (coherence, not a behaviour change).

**Interfaces PR2 produces:**
- `type BuildingOutput = { kind: "market_good"; goodId: string } | { kind: "capacity"; capacity:
  CapacityKind } | { kind: "modifier"; family: string } | { kind: "none" }` and
  `type CapacityKind = "pop_cap" | "skill1_licence" | "skill2_licence"`.
- `computeUtilization(...)` — the single `[0,1]` utilization PR3's decay + economy both read.

---

## PR3 — Discrete integer levels + committed construction projects

**Full task detail:** `docs/build-plans/building-construction-pr3-discrete-levels.md`.

**Goal:** Flip `count` to an integer **level count** (world-gen rounds seeds to whole levels); replace
the fractional-accretion planner with **committed construction projects** funded by a **per-faction
throughput pool** through a queue with a **per-build absorption cap** (duration emerges as `work ÷
absorbed`, wealth buys parallel fronts not instant builds); a level is **under construction**
(contributes nothing) until its accumulated work reaches its cost, then **lands** as a full staffable
level; automation is the **default queue policy** (one code path — the current autonomic planner becomes
"auto mode"). Decay becomes **whole-level, hysteresis-buffered** contraction to keep the integer
invariant stable (the marginal least-utilised level is torn down only after `X` sustained-idle months,
countdown resets on refill).

**Why this is one PR:** the integer-levels invariant requires both the project engine (adds whole
levels) and whole-level decay (removes whole levels) at once — see "the one hard coupling" above.
Ships internally as sequenced phase-commits: (a) integer world-gen + `count` invariant, (b) the
project queue + throughput engine + landing, (c) whole-level buffered decay.

**Files (map-level):**
- `lib/world/types.ts` — `WorldConstructionProject` (queue row: `id`, `factionId`, `systemId`,
  `buildingType`, `levels`, `workTotal`, `workDone`); `World.constructionProjects[]`;
  `WorldBuilding.idleMonths` (decay buffer). Bump `SAVE_FORMAT_VERSION` 3 → 4.
- `lib/constants/construction.ts` **(new)** — `THROUGHPUT_PER_POP`, `PER_BUILD_ABSORPTION_CAP`,
  per-building-type `workCostPerLevel` (coarse first-cut; a Shipyard level costs more than a Housing
  level), `LEVEL_CAPACITY` (capacity a level adds — simplest case 1).
- `lib/engine/construction.ts` **(new)** — `planFactionQueue(systems, routeCost)` (auto policy: reuse
  the existing ceiling logic — habitable→housing→labour-gated-industry — to decide which levels to
  enqueue) and `fundQueue(projects, pool, cap) → { projects, landed }` (front-first funding; a build
  absorbs `min(cap, remaining, poolLeft)`; a project lands whole levels at `workDone ≥ workTotal`).
- `lib/tick/processors/directed-build.ts` + `lib/tick/world/directed-build-world.ts` +
  `lib/tick/adapters/memory/directed-build.ts` — drive the queue: read the pool + open projects, fund,
  apply landed levels (integer `count += levels`), persist project deltas.
- `lib/engine/directed-build.ts` — the fractional greedy spend pass is refactored into the auto queue
  policy (what to enqueue), not immediate count writes.
- `lib/engine/infrastructure-decay.ts` + `lib/constants/infrastructure.ts` — whole-level teardown +
  hysteresis buffer length; `idleMonths` increment/reset; drop continuous fractional erosion. The
  unrest collapse becomes a discrete teardown event.
- `lib/world/gen.ts` / `lib/engine/industry-seed.ts` / `lib/engine/universe-gen.ts` — round seeded
  counts to integer levels (the `allocateIndustry` sites + the `staffScale` rescale).
- Tests: `construction.test.ts` (queue funding: emergent duration, per-build cap, parallel fronts,
  landing), integer-invariant tick witness, whole-level buffered-decay tests, reseed coherence.

**Interfaces PR3 produces:**
- `WorldConstructionProject`, `World.constructionProjects`, `WorldBuilding.idleMonths`.
- `planFactionQueue(...)`, `fundQueue(...)`. The player seat (SP1) hand-queues/reorders this same queue.

**Open questions to pin in the PR3 detailed plan (defaults from the spec):**
- Per-build vs per-system absorption cap → default **per-build**; add per-system only if
  single-system over-parallelism looks silly in testing.
- Level-lands-on-completion vs gradual accrual → default **lands on completion**.
- Throughput pool sourcing → default **derived** (`Σ pop × THROUGHPUT_PER_POP`, pooled per faction),
  not stored; buildable/goods-costed later.
- Utilization stored vs derived → default **derived each tick** (no new persisted field beyond
  `idleMonths`).

---

## PR4 — Coarse calibration + profiling + doc promotion

**Goal:** Validate and coarsely tune the whole model against the calibration harness at 600 / 5k / 20k
systems; fold in the substrate-reset 0c profiling (monthly-pulse cost, max-speed throughput); then do
the doc lifecycle.

**Work:**
- Run `npm run simulate` (and the YAML-config experiments) at the three scales; confirm intrinsic
  health only — no `NaN`/`Infinity`/runaway, no pinning, greedy ≫ random, construction visibly spans
  months (`work ÷ cap`), parallel fronts ≈ `pool ÷ cap`, the galaxy fills **partially** (physical
  ceilings leave negative space intact). Tune the coarse knobs (`THROUGHPUT_PER_POP`,
  `PER_BUILD_ABSORPTION_CAP`, `workCostPerLevel`, the decay buffer length) only to reach coherence —
  not precision.
- Profiling: measure the monthly-pulse cost and max-speed throughput; markets are the prime perf
  suspect under a synchronized pulse — note (do not act on unless it hurts) the cheaper-price-formula
  lever from substrate-reset 0c.
- **Doc promotion / reconciliation** (do this **on the branch before the final squash-merge**):
  - Promote `docs/planned/building-construction-model.md` → `docs/active/gameplay/` as present-tense
    reality; merge into the economy/specialisation + autonomic-agency active docs where it overlaps.
  - Reconcile `docs/planned/substrate-reset.md`: its build-layer parts (outpost/station buildings,
    the develop = station-facility model, the shared-pool build cost) are **superseded** — rewrite
    those sections to point at the shipped control-flag + throughput model; the monthly pulse + world-gen
    inversion sections stand. The penalised-cross-unowned-logistics + profiling (its PR3) folds in here
    or is re-noted as still-pending.
  - Reconcile `docs/planned/grand-strategy-vision.md §8`: note the substrate reset + building-construction
    model landed before the player seat (Phase 3), per the reorder.
  - Update `docs/SPEC.md`'s system-interaction map (construction is now committed/timed/discrete;
    ownership is a control flag).
  - Delete the build-plan docs (`building-construction-model-plan.md`, the four PR detail docs) — git
    is the history; the active spec + code are the source of truth.

---

## Reconciliation summary (what this feature supersedes)

- **`docs/planned/building-construction-model.md`** — the approved spec these PRs implement; promoted to
  `docs/active/` in PR4.
- **`docs/planned/substrate-reset.md`** — its **build-layer** parts are superseded: outpost/station as
  building types → the `control` flag (PR1); develop = station facility → develop = `control` flip +
  conserved colony bootstrap (PR1); the fractional autonomic build + shared build-point pool → the
  throughput pool + committed projects (PR3). Its **monthly pulse** (shipped) and **emergent-civ
  world-gen** (shipped) stand; its **penalised cross-unowned logistics + profiling** (PR3 there) is not
  part of this feature and remains pending (re-noted in PR4).
- **The parked `substrate-reset-pr2b-claim-step.md`** (commit `7127712`, branch
  `feat/substrate-reset-pr2b-claim`) — its claim engine (reach, scoring, two-phase resolution) returns
  in PR1 Tasks 4–6/8–10, re-pointed from "outpost building" writeback to "`control` flag" writeback; the
  branch can be deleted once PR1 lands.
- **`docs/planned/grand-strategy-vision.md §8`** — reconciled in PR4 to reflect the substrate reset +
  building-construction model landing before the player seat.
