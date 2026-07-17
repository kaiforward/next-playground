# Processor Interval Awareness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every pulse-riding processor interval-correct so the three cadence knobs (`MONTH_LENGTH`, `CONSTRUCTION_INTERVAL`, `LOGISTICS_INTERVAL`) change granularity, never wall-clock rate.

**Architecture:** Per the spec (`docs/build-plans/processor-interval-awareness.md`): scale flows and per-pulse incomes by `catchUpFactor(interval)` inside processor bodies (the `economy.ts` precedent); make decay's counters tick-denominated (fractional accumulation + a new collapse-debt accumulator); thread an optional cadence override through `runWorldTick` for testability; gate with a CI interval-invariance sim test plus a full-scale harness run. Everything ships behaviour-identical at the reference interval 24.

**Tech Stack:** TypeScript 5 strict, Vitest 4, the in-memory tick pipeline (`lib/tick/`), the calibration harness (`lib/tick-harness/`).

## Global Constraints

- **No `as` assertions** (only `as const` / guards in `lib/types/guards.ts`); **no `unknown`**; no postfix `!` outside `find(...)!` in tests.
- **World stays JSON-serializable** — no `Infinity`/`NaN` may enter world state; guard scaled math accordingly.
- **Engine functions stay pure** — no I/O imports; cadence awareness enters via arguments only.
- **All defaults stay 24.** At `catchUpFactor = 1` every change is behaviour-identical; the existing suite passing unchanged is the regression proof. Never re-tune calibrated magnitudes.
- **Comments describe the code, not the plan** — no PR/phase references in code comments.
- `REFERENCE_INTERVAL` stays 24 and is not a knob.
- Run tests with `npx vitest run <path>`; full gate before PR: `npx vitest run` + `npx next build --webpack`.

---

### Task 1: Cadence constants — three real knobs, kill the aliases

**Files:**
- Modify: `lib/constants/tick-cadence.ts`
- Modify: `lib/constants/directed-build.ts` (drop `INTERVAL`)
- Modify: `lib/constants/directed-logistics.ts` (drop `INTERVAL`)
- Modify: `lib/world/tick.ts` (rebind all `ECONOMY_UPDATE_INTERVAL` / `DIRECTED_*.INTERVAL` uses)
- Modify: `lib/services/trade-flow.ts:95`, `lib/constants/population.ts` (comment), `lib/constants/infrastructure.ts` (comment)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MONTH_LENGTH`, `CONSTRUCTION_INTERVAL`, `LOGISTICS_INTERVAL` (all `= 24`) from `@/lib/constants/tick-cadence`; `ECONOMY_UPDATE_INTERVAL`, `DIRECTED_BUILD.INTERVAL`, `DIRECTED_LOGISTICS.INTERVAL` cease to exist. All later tasks bind these names.

- [ ] **Step 1: Rewrite `lib/constants/tick-cadence.ts`**

```ts
/**
 * Calibration anchor — NOT a knob. The divisor in `catchUpFactor`; frozen at the
 * cadence the economy was tuned at, so the reference config is behaviour-identical
 * and needs no re-tune. Turn the knobs below, never this.
 */
export const REFERENCE_INTERVAL = 24;

/**
 * One "month" = the societal resolution-pulse period, in ticks. Economy,
 * population, infrastructure-decay, and migration resolve for the whole galaxy on
 * ticks where `tick % MONTH_LENGTH === 0`. A real knob: every rider scales by
 * `catchUpFactor`, so tuning it changes granularity, not wall-clock rates.
 */
export const MONTH_LENGTH = 24;

/** Directed-build's resolution pulse, in ticks. Independent of MONTH_LENGTH — relative pacing knob. */
export const CONSTRUCTION_INTERVAL = 24;

/** Directed-logistics' resolution pulse, in ticks. Independent of MONTH_LENGTH — relative pacing knob. */
export const LOGISTICS_INTERVAL = 24;
```

- [ ] **Step 2: Delete the alias constants**

In `lib/constants/directed-build.ts` and `lib/constants/directed-logistics.ts`: remove the `INTERVAL` key from each object and the now-unused `import { ECONOMY_UPDATE_INTERVAL }` line. (Keep each file's other keys untouched.)

- [ ] **Step 3: Rebind consumers**

- `lib/world/tick.ts`: replace the `ECONOMY_UPDATE_INTERVAL` import with `MONTH_LENGTH, CONSTRUCTION_INTERVAL, LOGISTICS_INTERVAL`; rebind uses at the economy gate/params/off-pulse payload and `migrationResolves` (currently lines 568/571/583/629) to `MONTH_LENGTH`, `DIRECTED_LOGISTICS.INTERVAL` → `LOGISTICS_INTERVAL`, `DIRECTED_BUILD.INTERVAL` → `CONSTRUCTION_INTERVAL` (gates at ~630-631 AND the two stage-param `interval:` bindings below them). Update the gate-disjunction comment (~lines 634-640): the three intervals no longer "alias the month today but are declared separately" — they are three independent knobs; the disjunction rationale stands.
- `lib/services/trade-flow.ts:95` — **not** a mechanical rename: `cyclesInWindow = FLOW_HISTORY_TICKS / ECONOMY_UPDATE_INTERVAL` counts logistics pulses in the flow window (flow events are written only by directed-logistics), so bind it to `LOGISTICS_INTERVAL` with a comment saying so.
- `lib/constants/population.ts` and `lib/constants/infrastructure.ts` header comments: replace `ECONOMY_UPDATE_INTERVAL` wording with `MONTH_LENGTH`.

- [ ] **Step 4: Verify nothing refers to the dead names, suite green**

Run: `grep -rn "ECONOMY_UPDATE_INTERVAL" lib/ app/ components/` → no hits. `grep -rn "\.INTERVAL" lib/ | grep -v test` → no `DIRECTED_*` hits.
Run: `npx vitest run` → PASS (pure rename; any failure means a missed binding).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(tick): three real cadence constants, no aliases"
```

---

### Task 2: Cadence override through `runWorldTick` + harness

**Files:**
- Modify: `lib/constants/tick-cadence.ts` (add `TickCadence` type)
- Modify: `lib/world/tick.ts` (`runWorldTick` signature + internal `cadence`)
- Modify: `lib/tick-harness/types.ts` (`HarnessConfig.cadence?`), `lib/tick-harness/runner.ts`, `lib/tick-harness/experiment.ts`
- Test: `lib/world/__tests__/tick-monthly-pulse.test.ts` (add one case)

**Interfaces:**
- Consumes: Task 1's constants.
- Produces: `interface TickCadence { month: number; construction: number; logistics: number }` (exported from `@/lib/constants/tick-cadence`); `runWorldTick(world, opts?: { cadence?: TickCadence })`; `HarnessConfig.cadence?: TickCadence`; experiment YAML accepts an optional `cadence: { month, construction, logistics }` block. Tasks 8–9 rely on all of these.

- [ ] **Step 1: Add the type to `tick-cadence.ts`**

```ts
/** Per-run cadence override (dev/test surface — the live loop always uses the constants). */
export interface TickCadence {
  month: number;
  construction: number;
  logistics: number;
}
```

- [ ] **Step 2: Thread it through `runWorldTick`**

```ts
export async function runWorldTick(
  world: World,
  opts?: { cadence?: TickCadence },
): Promise<{ world: World; events: TickBroadcastRaw; markets: WorldMarket[] }> {
  const cadence: TickCadence = opts?.cadence ?? {
    month: MONTH_LENGTH,
    construction: CONSTRUCTION_INTERVAL,
    logistics: LOGISTICS_INTERVAL,
  };
```

Replace every constant use inside the body (the Task-1 bindings) with `cadence.month` / `cadence.construction` / `cadence.logistics` — gates, stage `interval:` params, and the off-pulse payload.

- [ ] **Step 3: Write the failing pulse-override test**

In `tick-monthly-pulse.test.ts`, following its existing world-fixture pattern, add:

```ts
it("cadence override moves the pulse boundary", async () => {
  // world fixture as in the surrounding tests, meta.currentTick = 0
  const r1 = await runWorldTick(world, { cadence: { month: 2, construction: 2, logistics: 2 } });
  // tick 1: off-pulse under month=2 — economy did not run
  expect(r1.world.meta.currentTick).toBe(1);
  const r2 = await runWorldTick(r1.world, { cadence: { month: 2, construction: 2, logistics: 2 } });
  // tick 2: pulse tick under month=2 — economy ran (assert via the same observable
  // the file's existing pulse tests use, e.g. the economy broadcast / processorsRun)
});
```

Run: `npx vitest run lib/world/__tests__/tick-monthly-pulse.test.ts` → new case FAILS (opts not accepted yet if Step 2 not done first — order Steps 2/3 as strict TDD if preferred; the deliverable is both).

- [ ] **Step 4: Harness plumbing**

- `types.ts`: `cadence?: TickCadence` on `HarnessConfig` (import the type).
- `runner.ts` line ~100: `const result = await runWorldTick(world, config.cadence ? { cadence: config.cadence } : undefined);`
- `experiment.ts`: extend the schema —

```ts
const CadenceSchema = z.object({
  month: z.number().int().min(1),
  construction: z.number().int().min(1),
  logistics: z.number().int().min(1),
});
export const ExperimentConfigSchema = z.object({
  label: z.string().optional(),
  seed: z.number().int().default(42),
  ticks: z.number().int().min(1).default(500),
  systemCount: z.number().int().min(1).default(DEFAULT_SYSTEM_COUNT),
  cadence: CadenceSchema.optional(),
});
```

and pass `cadence: exp.cadence` through `experimentToHarnessConfig`. Update the file's header comment — "there is no per-run constants-override channel" is no longer true: cadence is exactly that channel (and the only one).

- [ ] **Step 5: Run tests, commit**

Run: `npx vitest run lib/world/__tests__/tick-monthly-pulse.test.ts lib/tick-harness` → PASS.

```bash
git add -A && git commit -m "feat(tick): optional cadence override through runWorldTick and the harness"
```

---

### Task 3: Population scaling

**Files:**
- Modify: `lib/tick/world/population-world.ts` (`PopulationProcessorParams` + `interval`)
- Modify: `lib/tick/processors/population.ts`
- Modify: `lib/world/tick.ts` (population stage params)
- Test: `lib/tick/processors/__tests__/population.test.ts`

**Interfaces:**
- Consumes: `catchUpFactor` from `@/lib/tick/shard`; `cadence.month` from Task 2.
- Produces: `PopulationProcessorParams` gains `interval: number`. No other shape changes.

- [ ] **Step 1: Write the failing invariance test**

In `population.test.ts`, reusing the file's existing world-stub/params fixtures:

```ts
it("halving the interval halves the per-run growth (wall-clock rate preserved)", async () => {
  // Two identical single-system worlds, same D signal, pop below cap, zero unrest.
  // Run A: one processor run at interval 24.  Run B: two runs at interval 12
  // (feeding B's second run the same fresh D, as the economy would).
  // Assert: popA and popB agree to first order — |popA - popB| / popA < 0.01
  // (logistic compounding differs at second order; exact equality is wrong to assert).
});
it("unrest integration scales with the interval", async () => {
  // Same shape: one run at 24 vs two runs at 12 with constant D.
  // Assert relative difference < 0.01.
});
```

Run: `npx vitest run lib/tick/processors/__tests__/population.test.ts` → FAIL (`interval` not a param / no scaling: the two-run world doubles the rate).

- [ ] **Step 2: Implement**

`population-world.ts`: add `interval: number;` to `PopulationProcessorParams` (doc: "pulse interval in ticks; rates are reference-denominated and scaled by catchUpFactor").

`population.ts` body:

```ts
import { catchUpFactor } from "@/lib/tick/shard";
// ...
const catchUp = catchUpFactor(params.interval);
const scaledUnrest: UnrestParams = {
  gain: params.unrest.gain * catchUp,
  decay: params.unrest.decay * catchUp,
};
for (const s of states) {
  const d = signals.dissatisfactionBySystem.get(s.systemId) ?? 0;
  const unrest = accumulateUnrest(s.unrest, d, scaledUnrest);
  const population = Math.max(
    0,
    s.population + populationDelta(s.population, s.popCap, d, unrest, params.population) * catchUp,
  );
  // ... unchanged
}
```

(Import `UnrestParams` type from `@/lib/engine/population`.)

`tick.ts` population stage: add `interval: cadence.month` to the params object.

- [ ] **Step 3: Run tests to verify pass**

Run: `npx vitest run lib/tick/processors/__tests__/population.test.ts` → PASS (new + existing; existing fixtures must now pass `interval: 24` — `catchUpFactor(24) = 1` keeps their expectations intact).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(tick): population growth and unrest scale with the pulse interval"
```

---

### Task 4: Decay engine — fractional idle + collapse debt

**Files:**
- Modify: `lib/engine/infrastructure-decay.ts`
- Test: `lib/engine/__tests__/infrastructure-decay.test.ts`

**Interfaces:**
- Consumes: nothing new (pure engine).
- Produces: `SystemDecayInput` gains `buildingCollapseDebt: Record<string, number>`; `SystemDecayResult` gains `newCollapseDebt: Record<string, number>` (entries whose debt changed); `computeSystemDecay(input, params, catchUp = 1)`. Task 5 plumbs these.

- [ ] **Step 1: Write the failing tests**

```ts
describe("interval awareness", () => {
  // fixture helper: one building type at count 2, population/uptake arranged so
  // exactly one whole level is idle (reuse the file's existing idle fixtures).

  it("idle countdown is tick-denominated: catchUp 0.5 needs twice the runs", () => {
    // params.idleBufferMonths = 2. With catchUp 0.5, run computeSystemDecay
    // repeatedly, feeding newIdleMonths back in. Runs 1-3: no teardown
    // (idle 0.5, 1.0, 1.5). Run 4 (idle 2.0): newCounts drops one level.
  });

  it("unrest teardown accrues fractional collapse debt", () => {
    // unrest above threshold, catchUp 0.5, building in use (not idle).
    // Run 1: no level removed, newCollapseDebt[type] === 0.5.
    // Run 2 (debt 0.5 fed back): one level removed, newCollapseDebt[type] === 0.
  });

  it("collapse debt resets when unrest drops below threshold", () => {
    // debt 0.5 fed in, unrest below threshold → newCollapseDebt[type] === 0, no removal.
  });

  it("catchUp above 1 removes multiple levels per run", () => {
    // catchUp 2, unrest above threshold, count 3 → removed 2 (floor(0+2)), debt 0.
  });

  it("default catchUp is behaviour-identical to the old per-run semantics", () => {
    // No third argument: unrest above threshold removes exactly 1 per run and
    // never leaves residual debt; idle counts by whole 1s.
  });
});
```

Run: `npx vitest run lib/engine/__tests__/infrastructure-decay.test.ts` → FAIL (no `catchUp` arg, no `buildingCollapseDebt` input).

- [ ] **Step 2: Implement**

```ts
export interface SystemDecayInput {
  // ...existing fields...
  /** buildingType → fractional unrest-collapse accumulator (the catastrophic channel's state). */
  buildingCollapseDebt: Record<string, number>;
}

export interface SystemDecayResult {
  // ...existing fields...
  /** buildingType → new collapse debt. Only entries whose debt changed. */
  newCollapseDebt: Record<string, number>;
}

export function computeSystemDecay(
  input: SystemDecayInput,
  params: DecayParams,
  /** Rate multiplier for this run (interval / REFERENCE_INTERVAL); 1 = reference cadence. */
  catchUp = 1,
): SystemDecayResult {
  // ...existing setup...
  const newCollapseDebt: Record<string, number> = {};

  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const used = buildingUsed(type, count, ctx);
    const prevIdle = buildingIdleMonths[type] ?? 0;

    // Hysteresis: the countdown accrues elapsed reference-months while ≥1 whole
    // level is idle, and resets the moment it refills.
    let idle = idleLevels(count, used) >= 1 ? prevIdle + catchUp : 0;
    let removed = 0;
    if (idle >= params.idleBufferMonths) {
      removed += 1; // shed the marginal idle level and restart its countdown
      idle = 0;
    }

    // Catastrophic channel: above the threshold, teardown accrues at one whole
    // level per reference-month; whole levels tear down as the debt crosses each
    // integer. Collapse is a regime, not a ledger — dropping below the threshold
    // clears any sub-level residue.
    const prevDebt = input.buildingCollapseDebt[type] ?? 0;
    let debt = unrest > params.unrestThreshold ? prevDebt + catchUp : 0;
    const collapsed = Math.floor(debt);
    removed += collapsed;
    debt -= collapsed;

    if (removed > 0) newCounts[type] = Math.max(0, count - removed);
    if (idle !== prevIdle) newIdleMonths[type] = idle;
    if (debt !== prevDebt) newCollapseDebt[type] = debt;
  }

  // ...popCap block unchanged...
  return { newCounts, newIdleMonths, newCollapseDebt, popCap };
}
```

Also update the file-top doc comment: the idle countdown and the unrest channel are tick-denominated via the catch-up factor; thresholds stay in reference-months.

- [ ] **Step 3: Run tests**

Run: `npx vitest run lib/engine/__tests__/infrastructure-decay.test.ts` → PASS. Existing tests need `buildingCollapseDebt: {}` added to their inputs — the only permitted edit to them; their expectations must not change.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(engine): tick-denominated decay counters — fractional idle and collapse debt"
```

---

### Task 5: Decay state plumbing — world row, tick row, adapter, processor

**Files:**
- Modify: `lib/world/types.ts` (`WorldBuilding`), `lib/world/gen.ts` (~line 169), `lib/tick/rows.ts` (~line 42), `lib/world/tick.ts` (fold-in ~156-182, fold-out ~229-233, decay stage params)
- Modify: `lib/tick/world/infrastructure-world.ts`, `lib/tick/adapters/memory/infrastructure.ts`, `lib/tick/processors/infrastructure-decay.ts`
- Test: `lib/tick/adapters/memory/__tests__/infrastructure.test.ts`, `lib/tick/processors/__tests__/infrastructure-decay.test.ts`

**Interfaces:**
- Consumes: Task 4's engine shapes (`buildingCollapseDebt` input, `newCollapseDebt` result, `catchUp` arg); `catchUpFactor`; `cadence.month`.
- Produces: `WorldBuilding.collapseDebt?: number` (optional — old saves lack it and stay valid; every fold-out writes it); `TickSystem.buildingCollapseDebt: Record<string, number>`; `InfrastructureStateView.buildingCollapseDebt`; `CollapseDebtUpdate { systemId; buildingType; collapseDebt }`; `InfrastructureWorld.applyCollapseDebts(updates)`; `InfrastructureProcessorParams` gains `interval: number`.

- [ ] **Step 1: World + tick row types**

`lib/world/types.ts`, on `WorldBuilding`:

```ts
  /** Fractional unrest-collapse accumulator for this (system, type); whole levels tear down as it crosses integers. Absent in pre-cadence saves ⇒ 0. */
  collapseDebt?: number;
```

`lib/world/gen.ts` (~169): add `collapseDebt: 0,` beside `idleMonths: 0,`.
`lib/tick/rows.ts` (~42): add `buildingCollapseDebt: Record<string, number>;` beside `buildingIdleMonths`.

- [ ] **Step 2: Fold-in / fold-out in `lib/world/tick.ts`**

Fold-in (`toTickSystems`, ~156-182): build a `collapseDebtBySystem` map exactly parallel to `idleMonthsBySystem`, reading `b.collapseDebt ?? 0`; set `buildingCollapseDebt: collapseDebtBySystem.get(s.id) ?? {}`.
Fold-out (~229-233): the building row push gains `collapseDebt: s.buildingCollapseDebt[buildingType] ?? 0`.

- [ ] **Step 3: Interface + adapter + processor (write the failing tests first)**

Adapter test (`adapters/memory/__tests__/infrastructure.test.ts`), mirroring the existing `applyIdleMonths` cases: `applyCollapseDebts` writes through to the system rows; `getInfrastructureState` returns copies (mutation of the returned record must not leak). Processor test (`processors/__tests__/infrastructure-decay.test.ts`): with `interval: 12` and an above-threshold system, first run removes nothing and persists debt 0.5; second run removes one level.

Run both → FAIL. Then implement:

`infrastructure-world.ts`: add to `InfrastructureStateView` — `buildingCollapseDebt: Record<string, number>;`; new type + method:

```ts
/** One building's new unrest-collapse debt (the catastrophic channel's persisted state). */
export interface CollapseDebtUpdate {
  systemId: string;
  buildingType: string;
  collapseDebt: number;
}
// on InfrastructureWorld:
  applyCollapseDebts(updates: CollapseDebtUpdate[]): Promise<void>;
// on InfrastructureProcessorParams:
  /** Pulse interval in ticks; decay counters accrue catchUpFactor(interval) per run. */
  interval: number;
```

`adapters/memory/infrastructure.ts`: copy `buildingCollapseDebt: { ...s.buildingCollapseDebt }` wherever `buildingIdleMonths` is copied (view + snapshot); implement `applyCollapseDebts` as an exact mirror of `applyIdleMonths` (lines ~73-75 pattern).

`processors/infrastructure-decay.ts`:

```ts
import { catchUpFactor } from "@/lib/tick/shard";
// ...
const catchUp = catchUpFactor(params.interval);
const debtUpdates: CollapseDebtUpdate[] = [];
// in the loop: pass buildingCollapseDebt: s.buildingCollapseDebt into the input,
// and catchUp as the third computeSystemDecay argument; then
for (const [buildingType, collapseDebt] of Object.entries(result.newCollapseDebt)) {
  debtUpdates.push({ systemId: s.systemId, buildingType, collapseDebt });
}
// after the loop:
await world.applyCollapseDebts(debtUpdates);
```

`lib/world/tick.ts` decay stage: params become `{ decay: INFRASTRUCTURE_DECAY_PARAMS, interval: cadence.month }`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/tick` → PASS (existing fixtures gain `buildingCollapseDebt: {}` / `interval: 24` where the compiler demands; expectations unchanged). Then `npx vitest run` → PASS (world fold round-trip is covered by existing tick tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(tick): plumb collapse debt and the decay interval through world, adapter, processor"
```

---

### Task 6: Directed-build scaling

**Files:**
- Modify: `lib/tick/processors/directed-build.ts`
- Modify: `lib/world/tick.ts` (stage already passes `interval` — verify it binds `cadence.construction`)
- Test: `lib/tick/processors/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes: `catchUpFactor`; `params.interval` (already on `DirectedBuildProcessorParams`).
- Produces: no shape changes — magnitude scaling only. Constants stay reference-denominated.

- [ ] **Step 1: Write the failing invariance test**

In `processors/__tests__/directed-build.test.ts`, reusing its fixture builders — a single faction, one queued project with `workTotal` = 2 × `cap`'s reference value, pool ample:

```ts
it("interval scaling preserves wall-clock minimum build time", async () => {
  // Run A: interval 24 — project lands after 2 pulses (2 × 24 = 48 ticks).
  // Run B: interval 12 — cap halves, so the same project needs 4 pulses (4 × 12 = 48 ticks).
  // Drive the processor across pulse ticks (0, interval, 2×interval, …) feeding
  // world state forward; assert the landing pulse index is 2 for A and 4 for B.
});
it("interval scaling preserves the parallel-front count", async () => {
  // Pool = 2 × cap at reference: exactly 2 projects absorb work per pulse at
  // interval 24 AND at interval 12 (pool and cap scale together).
});
```

Run → FAIL (no scaling: at interval 12 the project lands in 2 pulses = 24 ticks, twice the wall-clock rate).

- [ ] **Step 2: Implement**

In `runDirectedBuildProcessor`, after the `dueKeys` bail:

```ts
import { pulseShard, catchUpFactor } from "@/lib/tick/shard";
// ...
// Per-pulse incomes are reference-denominated; scale all three together so
// wall-clock build time, parallel-front count (pool ÷ cap), and the floor's
// relative strength are interval-invariant. Work costs and ceilings are stocks —
// never scaled.
const catchUp = catchUpFactor(params.interval);
const cap = params.construction.cap * catchUp;
```

Then per faction: `const pool = factionThroughputPool(group, params.construction.throughputPerPop * catchUp);` — floor shares: `developmentFloorShare(systemDevelopment(s, developmentRefs), params.construction.floorBase * catchUp, params.construction.floorKnee)` — and `fundQueueWithFloor([...existing, ...newProjects], pool, cap, reserved, ...)`.

In `lib/world/tick.ts`: confirm the build stage's `interval:` is `cadence.construction` (Task 2 should have done this; fix if not).

- [ ] **Step 3: Run tests**

Run: `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts lib/tick/adapters/memory/__tests__/directed-build.test.ts` → PASS (existing tests run at interval 24 where `catchUp = 1`).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(tick): construction pool, cap, and floor scale with the build interval"
```

---

### Task 7: Directed-logistics scaling

**Files:**
- Modify: `lib/tick/processors/directed-logistics.ts`
- Test: `lib/tick/processors/__tests__/directed-logistics.test.ts`

**Interfaces:**
- Consumes: `catchUpFactor`; `params.interval` (already on the params type).
- Produces: no shape changes. `toLogisticsState` (module-local) gains a `catchUp` parameter.

- [ ] **Step 1: Write the failing test**

Fixture: one faction, one donor + one deficit system, deficits large enough that the haul **budget** binds (transfer total = budget ÷ route cost, not gap size) — reuse the file's budget-constrained fixture if present, else construct one.

```ts
it("haul budget scales with the interval; deliveries stay gap-fills", async () => {
  // interval 12 → generation × 0.5 → moved quantity is half the interval-24 run's
  // (same wall-clock haul capacity when run twice as often).
  // A gap-bound (small-deficit) case still fills exactly the gap at any interval.
});
```

Run → FAIL (budget unscaled: both intervals move the same quantity per pulse).

- [ ] **Step 2: Implement**

```ts
import { pulseShard, catchUpFactor } from "@/lib/tick/shard";

/** Build the engine's per-system state from raw rows: generation + per-good band + total demand.
 * Generation is per-pulse income and scales by the catch-up factor; the per-good
 * gap-fills deliberately do NOT (see the processor doc below). */
function toLogisticsState(row: SystemLogisticsRow, catchUp: number): SystemLogisticsState {
  return {
    systemId: row.systemId,
    factionId: row.factionId,
    generation: systemLogisticsGeneration(row.population) * catchUp,
    goods: toGoodMarketStates(row),
  };
}
```

Body: `const catchUp = catchUpFactor(params.interval);` and `group.map((r) => toLogisticsState(r, catchUp))`. Extend the processor's existing "No catch-up scaling" doc comment to state both halves: *deliveries* are level-fills toward the anchor and must not scale (multiplying a gap-fill overshoots); the *work budget* is per-pulse income and must (paid more often unscaled, it silently inflates wall-clock haul capacity exactly in the budget-bound under-serve regime).

- [ ] **Step 3: Run tests**

Run: `npx vitest run lib/tick/processors/__tests__/directed-logistics.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(tick): logistics haul budget scales with the interval; gap-fills stay unscaled"
```

---

### Task 8: CI interval-invariance sim test

**Files:**
- Create: `lib/world/__tests__/cadence-invariance.test.ts`

**Interfaces:**
- Consumes: `generateWorld({ systemCount, seed })`, `runWorldTick(world, { cadence })`, `TickCadence`.
- Produces: the permanent CI guard. Nothing downstream.

- [ ] **Step 1: Write the test** (modelled on `economy-scale-dynamic-invariance.test.ts`, but no env stubbing/module reset — the override is a plain argument)

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import type { TickCadence } from "@/lib/constants/tick-cadence";

const SEED = 745878428;
const SYSTEM_COUNT = 60;
const TICKS = 480; // 20 reference-months — enough for growth/decay/construction rates to show

interface RunTotals { population: number; buildings: number; }

async function runAtCadence(cadence?: TickCadence): Promise<RunTotals> {
  let world = generateWorld({ systemCount: SYSTEM_COUNT, seed: SEED });
  for (let t = 0; t < TICKS; t++) {
    const result = await runWorldTick(world, cadence ? { cadence } : undefined);
    world = result.world;
  }
  let population = 0;
  let buildings = 0;
  for (const s of world.systems) population += s.population;
  for (const b of world.buildings) buildings += Math.max(0, b.count);
  return { population, buildings };
}
// NOTE: adjust the buildings total to the World shape's actual building storage if
// it differs (see toTickSystems' source of building rows) — total landed levels is the metric.

function relDiff(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

describe("cadence interval invariance", () => {
  it("wall-clock rates match across intervals (each knob turned in isolation)", async () => {
    const TOL = 0.15; // statistical gate: different pulse ticks draw different RNG
    const base = await runAtCadence(undefined); // all 24
    const month12 = await runAtCadence({ month: 12, construction: 24, logistics: 24 });
    const build12 = await runAtCadence({ month: 24, construction: 12, logistics: 24 });
    const logi12 = await runAtCadence({ month: 24, construction: 24, logistics: 12 });

    for (const v of [month12, build12, logi12]) {
      expect(Number.isFinite(v.population)).toBe(true);
      expect(relDiff(base.population, v.population)).toBeLessThan(TOL);
      expect(relDiff(base.buildings, v.buildings)).toBeLessThan(TOL);
    }
  }, 120_000);
});
```

- [ ] **Step 2: Run and calibrate**

Run: `npx vitest run lib/world/__tests__/cadence-invariance.test.ts`.
Calibrate empirically: record the observed diffs; set `TOL` to ~3× the observed worst (keep it a *real* bar — if diffs exceed ~20%, that is a scaling bug to fix, not a tolerance to raise). Record actual runtime; if the 4 runs exceed ~60 s locally, cut `TICKS` to 360 or drop to 2 runs (base + all-knobs-12) and note the collapse in a comment. **This step is investigative — do not force the numbers.**

- [ ] **Step 3: Sanity — break it on purpose**

Temporarily remove `* catchUp` from the population delta; run the test; it must FAIL on `month12` population. Revert. (Proves the gate detects the exact silent failure this work kills.)

- [ ] **Step 4: Full suite + commit**

Run: `npx vitest run` → PASS.

```bash
git add lib/world/__tests__/cadence-invariance.test.ts && git commit -m "test(tick): interval-invariance sim gate across the three cadence knobs"
```

---

### Task 9: Full-scale harness gate (manual, pre-ship)

**Files:**
- Create: `experiments/examples/cadence-invariance-24.yaml`, `experiments/examples/cadence-invariance-12.yaml`

**Interfaces:**
- Consumes: Task 2's experiment `cadence` block.
- Produces: the pre-ship evidence, recorded in the PR description.

- [ ] **Step 1: Write the configs**

```yaml
# cadence-invariance-24.yaml — baseline for the interval-invariance ship gate
label: cadence-invariance-24
seed: 42
ticks: 1500
```

```yaml
# cadence-invariance-12.yaml — all three knobs at half interval; rates must match the 24 baseline
label: cadence-invariance-12
seed: 42
ticks: 1500
cadence:
  month: 12
  construction: 12
  logistics: 12
```

(1500 ticks per the 500-tick-is-pre-logistics finding — the budget-bound logistics regime needs the long run.)

- [ ] **Step 2: Run both and compare**

Run: `npm run simulate -- --config experiments/examples/cadence-invariance-24.yaml` then the `-12` one.
Compare the reports' rate metrics: final/trajectory population, total buildings, logistics transfer count + total hauled, event counts, and the coarse health bar (no NaN / runaway / pinning). Expect agreement of the same order as Task 8's calibrated tolerance; hauled-per-wall-clock is the metric Task 8 cannot see and the one to scrutinise.

- [ ] **Step 3: Record**

Paste the comparison table into the PR description. If any rate diverges beyond tolerance, that is a bug — return to the offending task; do not ship on "close enough" without understanding the gap. Commit the two YAMLs:

```bash
git add experiments/examples/cadence-invariance-*.yaml && git commit -m "chore(harness): cadence-invariance experiment configs for the ship gate"
```

---

### Task 10: Docs — durable taxonomy, SPEC, lifecycle

**Files:**
- Modify: `docs/active/engineering/processor-architecture.md` (taxonomy section)
- Modify: `docs/SPEC.md` (tick/cadence section)
- Modify: `docs/BACKLOG.md` (delete the shipped `[L]` interval item)
- Delete: `docs/build-plans/processor-interval-awareness.md`, `docs/build-plans/processor-interval-awareness-plan.md`

**Interfaces:** none — prose.

- [ ] **Step 1: Add the taxonomy to `processor-architecture.md`**

A "Cadence and interval awareness" section carrying the durable rule for future processors, in present tense (no phase history): the four shapes table from the spec §2 (rate / counter / budget income / target-stock-cost) with the one-line rule — *scale flows and incomes by `catchUpFactor`, count time in ticks, never scale targets* — the three knobs + `REFERENCE_INTERVAL`-is-not-a-knob, the cluster structure (population/decay/migration ride the economy's signal and therefore its interval; build and logistics are self-gated and independent), the cadence override as the test surface, and one line noting relations' per-run drift magnitudes are denominated in its own `RELATIONS_FREQUENCY` and would need the same treatment if that frequency is ever tuned.

- [ ] **Step 2: SPEC + BACKLOG**

`docs/SPEC.md` tick section: name the three cadence knobs and the invariance property (tuning an interval changes granularity, not wall-clock rates; verified by the cadence-invariance test + harness configs). Delete the `[L]` interval item from `docs/BACKLOG.md`.

- [ ] **Step 3: Doc-deletion booking check, then delete**

Per the deletion convention, grep both build-plan docs for routed work and verify each item exists at its destination (`git log -S` if needed): the relations note (→ processor-architecture, Step 1), the popCap-test / ordering-artifact / demandRate / stale-48-tick items (→ already in BACKLOG from PR #181 — verify still present). Then delete both files.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: cadence taxonomy in processor-architecture; SPEC knobs; retire the build plan"
```

---

### Final gate (before PR)

- [ ] `npx vitest run` → all green.
- [ ] `npx next build --webpack` → clean (the PR build gate).
- [ ] Push, open the PR (before review, per convention), including Task 9's comparison table.
- [ ] `/uber-review` the branch; fix cheap+self-contained Minor findings in-task.
