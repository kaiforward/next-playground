# Purse Plan 2 — Treasury Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Money starts gating behaviour — each faction's latched funded fractions scale its construction pool and logistics work-budget, maintenance funding modulates idle-decay aggression and applies a flow-only output malus, and the tax level feeds unrest pressure.

**Architecture:** All five effects consume the treasury's already-latched `funded` fractions / `taxLevel` (Plan 1, `world.treasuries`). The treasury processor settles LAST in the tick, so reading `world.treasuries` at tick start gives last settlement's latch — the accepted one-month funding lag falls out of stage order with zero new state. `runWorldTick` derives small per-faction / per-system lookup maps and threads them into existing processor params; the processors apply plain multipliers. Two new pure engine curves (output malus, buffer scale) live in `lib/engine/treasury.ts`.

**Tech Stack:** TypeScript 5 strict, Vitest 4 (unit project), the in-memory tick adapters. No new dependencies, no save-format change (no new persisted fields).

## Global Constraints

Copied from the spec (`docs/planned/player-seat-purse.md` §Remaining build wiring, §Maintenance) and CLAUDE.md — every task implicitly includes these:

- **The output malus must NOT feed `buildingUsed`** — it rides `productionSuppress` → `productionRate` in the market-tick builder, exactly like the strike multiplier. Decay's utilization (`buildingUsed`) reads labour state + `outputUptake` (stock-band position) and never reads `productionRate`, so the wiring below is structurally safe; do not "improve" it into anything that touches utilization.
- **Player choice charges flow only; only insolvency touches stock.** Effects read `funded` (the paid fraction), never `bands` (the slider) — insolvency reaching below the 0.5 slider floor is the only path to the destructive decay regime.
- **Money is ECONOMY_SCALE-invariant.** Funded fractions are ratios; nothing in this plan may introduce an S-dependent term into a money path or a money-dependent term into a goods path that breaks the S=1↔S=100 bridge.
- **Interval invariance.** Funded fractions multiply pools/budgets that are already catchUp-scaled; never rescale them a second time. Tax pressure enters through `d`, whose gain is already catchUp-scaled.
- **Missing funding data defaults to 1 (ungated), never 0** — independents (`factionId: null`), engine/adapter tests that omit the new optional params, and any faction missing from a map behave exactly as today.
- **JSON-safe:** guard non-finite inputs in the new engine curves (non-finite funding → 1).
- **Calibration stays deliberately coarse** — the band-reconciliation design pass lands after the slice and triggers a treasury recalibration. Magnitude constants here are first-cut; the acceptance bar is the harness health bar, not precision.
- No `as`, no `unknown`, no `!` (except `find(...)!` in tests). Comments describe code, not this plan.
- Verify: `npx vitest run` green; PR build gate `npx next build --webpack`.

**Branch:** `feat/purse-effects`, single PR to `main` (matches Plan 1's one-PR shape). Open the PR before running `/uber-review`.

---

### Task 1: Engine curves — output malus and buffer scale

**Files:**
- Modify: `lib/engine/treasury.ts` (append after `settleLadder`)
- Modify: `lib/constants/treasury.ts` (two new keys in `TREASURY`)
- Test: `lib/engine/__tests__/treasury.test.ts` (append)

**Interfaces:**
- Produces: `maintenanceOutputMalus(funding: number, slope: number): number` and `maintenanceBufferScale(funding: number, base: number): number` — consumed by `runWorldTick` in Tasks 4–5. `TREASURY.MAINTENANCE_OUTPUT_MALUS_SLOPE` (0.25), `TREASURY.MAINTENANCE_BUFFER_SCALE_BASE` (0.25).

Design (from spec §Maintenance): both are linear in effective funding `f = funded.maintenance ∈ [0,1]`.
- Malus `= 1 − slope × (1 − f)` → at f=0.9 with slope 0.25: 0.975 (−2.5% output, spec's "order of −2–3% at 90%"); at f=0: 0.75 — output never collapses from money alone.
- Buffer scale `= base + f` → f=0.75 → 1.0 (**today's constants sit at the mid-point of the 50–100% slider range**), f=1 → 1.25 (6 → 7.5 idle-buffer months: the deliberate gentler-than-today rebase), f=0 → 0.25 (6 → 1.5 months: idle capacity dies fast under real insolvency).

- [ ] **Step 1: Write the failing tests**

Append to `lib/engine/__tests__/treasury.test.ts`:

```typescript
import { maintenanceOutputMalus, maintenanceBufferScale } from "@/lib/engine/treasury";

describe("maintenanceOutputMalus", () => {
  it("is 1 at full funding and ramps linearly with the shortfall", () => {
    expect(maintenanceOutputMalus(1, 0.25)).toBe(1);
    expect(maintenanceOutputMalus(0.9, 0.25)).toBeCloseTo(0.975, 9);
    expect(maintenanceOutputMalus(0.5, 0.25)).toBeCloseTo(0.875, 9);
    expect(maintenanceOutputMalus(0, 0.25)).toBeCloseTo(0.75, 9);
  });
  it("clamps funding into [0,1] and treats non-finite funding as fully funded", () => {
    expect(maintenanceOutputMalus(1.7, 0.25)).toBe(1);
    expect(maintenanceOutputMalus(-2, 0.25)).toBeCloseTo(0.75, 9);
    expect(maintenanceOutputMalus(Number.NaN, 0.25)).toBe(1);
    expect(maintenanceOutputMalus(Number.POSITIVE_INFINITY, 0.25)).toBe(1);
  });
});

describe("maintenanceBufferScale", () => {
  it("hits 1.0 at the slider-range midpoint (0.75) so today's constants are the mid-scale point", () => {
    expect(maintenanceBufferScale(0.75, 0.25)).toBeCloseTo(1, 9);
  });
  it("is gentler than today at full funding and aggressive under insolvency", () => {
    expect(maintenanceBufferScale(1, 0.25)).toBeCloseTo(1.25, 9);
    expect(maintenanceBufferScale(0.5, 0.25)).toBeCloseTo(0.75, 9);
    expect(maintenanceBufferScale(0, 0.25)).toBeCloseTo(0.25, 9);
  });
  it("treats non-finite funding as fully funded", () => {
    expect(maintenanceBufferScale(Number.NaN, 0.25)).toBeCloseTo(1.25, 9);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/treasury.test.ts`
Expected: FAIL — `maintenanceOutputMalus` is not exported.

- [ ] **Step 3: Implement the curves**

Append to `lib/engine/treasury.ts`:

```typescript
/** Effective funding for the curves below: non-finite → 1 (fully funded — the
 *  no-effect default), else clamped to [0,1]. */
const safeFunding = (f: number): number => (Number.isFinite(f) ? clamp(f, 0, 1) : 1);

/**
 * Flow-only maintenance output malus: a production multiplier scaling linearly
 * with the funding shortfall (1 at full funding, 1 − slope at zero). Rides
 * productionSuppress in the market-tick builder — it must never feed the
 * buildingUsed utilization signal, or the flow-only promise silently breaks.
 */
export function maintenanceOutputMalus(funding: number, slope: number): number {
  return 1 - clamp(slope, 0, 1) * (1 - safeFunding(funding));
}

/**
 * Idle-buffer length multiplier from maintenance funding. Linear `base + f`:
 * 1.0 at f = 1 − base (the slider range's midpoint for base 0.25 — today's
 * buffer), gentler above, and a short fast-death buffer under deep insolvency.
 */
export function maintenanceBufferScale(funding: number, base: number): number {
  return Math.max(0, base) + safeFunding(funding);
}
```

Add to the `TREASURY` const in `lib/constants/treasury.ts` (after `MAINTENANCE_SLIDER_FLOOR`):

```typescript
  /** Output-malus slope: production multiplier = 1 − slope × (1 − maintenance funding). Flow-only. */
  MAINTENANCE_OUTPUT_MALUS_SLOPE: 0.25,
  /** Idle-buffer scale = base + funding: 1.0 at 75% funding (today's buffer), 1.25 at full, 0.25 at zero. */
  MAINTENANCE_BUFFER_SCALE_BASE: 0.25,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/engine/__tests__/treasury.test.ts lib/constants/__tests__/treasury.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/treasury.ts lib/constants/treasury.ts lib/engine/__tests__/treasury.test.ts
git commit -m "feat(purse): maintenance funding curves — output malus + idle-buffer scale"
```

---

### Task 2: Funded logistics gates the work-budget

**Files:**
- Modify: `lib/tick/processors/directed-logistics.ts`
- Modify: `lib/world/tick.ts` (funding maps + one param)
- Test: `lib/tick/processors/__tests__/directed-logistics.test.ts` (append)

**Interfaces:**
- Consumes: `WorldFactionTreasury.funded.logistics` via `world.treasuries` (Plan 1).
- Produces: `DirectedLogisticsProcessorParams.fundingByFaction?: ReadonlyMap<string, number>` — latched funded.logistics per faction; missing faction / omitted map / null-faction group → 1. Also (in `tick.ts`) the shared tick-start lookup `fundedByFaction: Map<string, TreasuryBands>` that Tasks 3–5 reuse.

- [ ] **Step 1: Write the failing test**

Append to `lib/tick/processors/__tests__/directed-logistics.test.ts` (inside the `runDirectedLogisticsProcessor (body)` describe; reuses its `market` helper and `DUE_TICK`):

```typescript
  it("scales the haul budget by the faction's funded fraction (0 → no transfers)", async () => {
    const mk = () => [
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)],
      },
    ];
    // funded 0 → generation × 0 = no work budget → nothing moves.
    const gated = new MemoryDirectedLogisticsWorld(mk());
    await runDirectedLogisticsProcessor(gated, { tick: DUE_TICK }, {
      interval: LOGISTICS_INTERVAL, routeCost: () => 1,
      fundingByFaction: new Map([["f1", 0]]),
    });
    expect(gated.flows).toHaveLength(0);

    // A faction missing from the map is ungated — identical to no map at all.
    const ungated = new MemoryDirectedLogisticsWorld(mk());
    await runDirectedLogisticsProcessor(ungated, { tick: DUE_TICK }, {
      interval: LOGISTICS_INTERVAL, routeCost: () => 1,
      fundingByFaction: new Map([["other", 0]]),
    });
    expect(ungated.flows).toHaveLength(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tick/processors/__tests__/directed-logistics.test.ts`
Expected: FAIL — `fundingByFaction` is not a known param (type error) or the gated run still moves goods.

- [ ] **Step 3: Implement the gate**

In `lib/tick/processors/directed-logistics.ts`:

Params (add to `DirectedLogisticsProcessorParams`):

```typescript
  /** Latched funded.logistics per faction (0–1) — scales the haul budget. Missing
   *  faction or omitted map → 1 (ungated: engine tests, independents). */
  fundingByFaction?: ReadonlyMap<string, number>;
```

`toLogisticsState` gains a `funded` factor (update its doc comment's first line to mention funding):

```typescript
function toLogisticsState(row: SystemLogisticsRow, catchUp: number, funded: number): SystemLogisticsState {
  return {
    systemId: row.systemId,
    factionId: row.factionId,
    generation: systemLogisticsGeneration(row.population) * catchUp * funded,
    goods: toGoodMarketStates(row),
  };
}
```

In the per-faction match loop, resolve the fraction once per group (money is fuel: it scales what fraction of the physical work-budget runs, deliveries themselves are untouched):

```typescript
  for (const [factionId, group] of byFaction) {
    const funded = factionId === null ? 1 : params.fundingByFaction?.get(factionId) ?? 1;
    const transfers = matchFactionTransfers(group.map((r) => toLogisticsState(r, catchUp, funded)), params.routeCost);
```

In `lib/world/tick.ts`, directly after the `const newTickCtx = ...` line, build the shared tick-start funding lookup (Tasks 3–5 extend this block — the doc comment is load-bearing):

```typescript
  // ── latched treasury funding (read at tick START = last settlement's latch;
  // the treasury stage settles LAST, so every consumer below runs one month
  // behind — the accepted funding lag, same shape as construction's) ──
  const fundedByFaction = new Map(treasuries.map((t) => [t.factionId, t.funded]));
```

and pass the scalar map to the directed-logistics call:

```typescript
      const dlResult = await runDirectedLogisticsProcessor(dlWorld, { tick }, {
        interval: cadence.logistics,
        routeCost,
        fundingByFaction: new Map([...fundedByFaction].map(([id, f]) => [id, f.logistics])),
      });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tick/processors/__tests__/directed-logistics.test.ts lib/world/__tests__/tick-treasury.test.ts`
Expected: PASS (world treasuries all start `funded: 1`, so existing world tests are unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/tick/processors/directed-logistics.ts lib/world/tick.ts lib/tick/processors/__tests__/directed-logistics.test.ts
git commit -m "feat(purse): funded.logistics scales the directed-logistics work-budget"
```

---

### Task 3: Funded construction gates the pool

**Files:**
- Modify: `lib/tick/processors/directed-build.ts`
- Modify: `lib/world/tick.ts` (one param)
- Test: `lib/tick/processors/__tests__/directed-build.test.ts` (append)

**Interfaces:**
- Consumes: `fundedByFaction` from Task 2's tick.ts block.
- Produces: `DirectedBuildProcessorParams.fundingByFaction?: ReadonlyMap<string, number>` — latched funded.construction; same default-1 semantics as Task 2.

Design notes locked here: the funded fraction scales **the pool only** (`poolRef.total × catchUp × funded`). Centre valuation (`planCentreProposal`) keeps reading the unscaled physical `poolRef.total` — money is fuel, not capacity; the centre's worth is priced off the physical backlog frontier. The colony pool-floor `reserved` is left unscaled: `fundQueueWithFloor` clamps it to the (now smaller) pool, so insolvency shrinks the floor automatically.

- [ ] **Step 1: Write the failing test**

Append to `lib/tick/processors/__tests__/directed-build.test.ts`, adapting to that file's existing fixture helpers if it has them; otherwise self-contained (imports to add if absent: `MemoryDirectedBuildWorld` from `@/lib/tick/adapters/memory/directed-build`, `emptyResourceVector` from `@/lib/engine/resources`, and the processor + params types already imported by the file):

```typescript
describe("construction funding gate", () => {
  // One developed system, one standing player order with a huge remaining work total, a cap
  // larger than the pool → absorbed work per pulse equals the pool exactly, making the
  // funded-fraction scaling directly observable via workPerformedByFaction.
  const row = () => ({
    systemId: "s1", factionId: "f1", control: "developed" as const,
    population: 100, unrest: 0, buildings: {},
    yields: emptyResourceVector(), slotCap: emptyResourceVector(),
    generalSpace: 0, habitableSpace: 0, markets: [],
  });
  const order = () => ({
    kind: "build" as const, id: "p1", origin: "player" as const,
    factionId: "f1", systemId: "s1", buildingType: "ore", levels: 5,
    workTotal: 100_000, workDone: 0,
  });
  const params = (fundingByFaction?: ReadonlyMap<string, number>) => ({
    interval: 24,
    routeCost: () => null,
    construction: {
      cap: 1_000_000, throughputPerPop: 1, floorBase: 0, floorKnee: 0,
      pointsPerLevel: 0, paybackHorizon: 1, backlogWindow: 1,
      mintId: () => "new-id",
    },
    fundingByFaction,
  });

  it("scales the funded pool by the faction's funded.construction", async () => {
    // catchUpFactor(24) = 1 → full pool = 100 pop × 1/pop = 100 points.
    const full = new MemoryDirectedBuildWorld([row()], [order()]);
    const fullResult = await runDirectedBuildProcessor(full, { tick: 0 }, params());
    expect(fullResult.workPerformedByFaction?.get("f1")).toBeCloseTo(100, 6);

    const half = new MemoryDirectedBuildWorld([row()], [order()]);
    const halfResult = await runDirectedBuildProcessor(half, { tick: 0 }, params(new Map([["f1", 0.5]])));
    expect(halfResult.workPerformedByFaction?.get("f1")).toBeCloseTo(50, 6);

    // funded 0 → the queue waits: no work, and the standing player order persists untouched.
    const starved = new MemoryDirectedBuildWorld([row()], [order()]);
    const starvedResult = await runDirectedBuildProcessor(starved, { tick: 0 }, params(new Map([["f1", 0]])));
    expect(starvedResult.workPerformedByFaction?.get("f1")).toBeUndefined();
    expect(starved.constructionProjects).toHaveLength(1);
    expect(starved.constructionProjects[0].workDone).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts`
Expected: FAIL — `fundingByFaction` unknown param / half-pool assertion gets 100.

- [ ] **Step 3: Implement the gate**

In `lib/tick/processors/directed-build.ts`, add to `DirectedBuildProcessorParams` (top level, after `player?`):

```typescript
  /** Latched funded.construction per faction (0–1) — scales the funded pool. Missing
   *  faction or omitted map → 1 (ungated: engine tests, independents). */
  fundingByFaction?: ReadonlyMap<string, number>;
```

Change the pool line (`directed-build.ts:179`) — valuation keeps the physical pool, funding scales only what runs:

```typescript
    // Money is fuel, not capacity: the funded fraction scales what share of the
    // physical pool's throughput runs this pulse. Valuation (centre pricing, ROI)
    // keeps reading the unscaled reference pool.
    const funded = factionId === null ? 1 : params.fundingByFaction?.get(factionId) ?? 1;
    const pool = poolRef.total * catchUp * funded;
```

In `lib/world/tick.ts`, add the param to the `runDirectedBuildProcessor` call (after `player:`):

```typescript
        fundingByFaction: new Map([...fundedByFaction].map(([id, f]) => [id, f.construction])),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts lib/world/__tests__/tick-expansion.test.ts`
Expected: PASS (gen seeds `funded: 1` everywhere, so expansion behaviour is unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/tick/processors/directed-build.ts lib/world/tick.ts lib/tick/processors/__tests__/directed-build.test.ts
git commit -m "feat(purse): funded.construction scales the directed-build pool"
```

---

### Task 4: Maintenance output malus rides productionSuppress

**Files:**
- Modify: `lib/tick/world/economy-world.ts` (`EconomyProcessorParams`)
- Modify: `lib/tick/processors/economy.ts` (one line)
- Modify: `lib/world/tick.ts` (per-system maps + param)
- Test: `lib/tick/processors/__tests__/economy.test.ts` (append)

**Interfaces:**
- Consumes: `maintenanceOutputMalus` + `TREASURY.MAINTENANCE_OUTPUT_MALUS_SLOPE` (Task 1), `fundedByFaction` (Task 2).
- Produces: `EconomyProcessorParams.maintenanceMalusBySystem?: ReadonlyMap<string, number>` — per-system production multiplier (missing system / omitted map → 1). Also (in tick.ts) the pulse-gated per-system map block that Tasks 5–6 extend: `maintenanceMalusBySystem`, `maintenanceBufferScaleBySystem`, `taxPressureBySystem`.

- [ ] **Step 1: Write the failing test**

Append to `lib/tick/processors/__tests__/economy.test.ts` (reuses that file's `makeProducerSystem`, `makeMarket`, `FIXTURE_BAND`, `ECON_PARAMS`, `makeCtx`):

```typescript
describe("maintenance output malus", () => {
  it("suppresses production like a sibling of the strike multiplier, per system", async () => {
    // Two identical calm producers; only p2 carries a malus. Same start stock →
    // p2 must end the tick with strictly less stock and less realized output.
    const startStock = FIXTURE_BAND.minStock + 5;
    const world = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("p1", 0), makeProducerSystem("p2", 0)],
      markets: [makeMarket("p1", "food", startStock), makeMarket("p2", "food", startStock)],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), {
      ...ECON_PARAMS,
      maintenanceMalusBySystem: new Map([["p2", 0.5]]),
    });
    const stock = (systemId: string) =>
      world.markets.find((m) => m.systemId === systemId && m.goodId === "food")!.stock;
    expect(stock("p2")).toBeLessThan(stock("p1"));
    const realized = result.economySignals?.realizedProductionBySystem;
    expect(realized?.get("p2")?.get("food") ?? 0).toBeLessThan(realized?.get("p1")?.get("food") ?? 0);
  });
});
```

(If `world.markets` on `InMemoryEconomyWorld` is not the adapter's public post-write surface, mirror how the file's existing strike-suppression test reads post-tick stock and use that instead — the assertion stays the same.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tick/processors/__tests__/economy.test.ts`
Expected: FAIL — `maintenanceMalusBySystem` unknown param.

- [ ] **Step 3: Implement**

`lib/tick/world/economy-world.ts`, add to `EconomyProcessorParams`:

```typescript
  /** Per-system maintenance output malus (production multiplier, 1 = none) from the
   *  owning faction's latched maintenance funding. Missing system or omitted map → 1.
   *  Rides productionSuppress — flow-only, must never feed buildingUsed utilization. */
  maintenanceMalusBySystem?: ReadonlyMap<string, number>;
```

`lib/tick/processors/economy.ts` line 128 becomes:

```typescript
      productionSuppress:
        strikeMultiplier(unrestBySystem.get(m.systemId) ?? 0, strikeParams) *
        (params.maintenanceMalusBySystem?.get(m.systemId) ?? 1),
```

`lib/world/tick.ts`: extend the Task 2 funding block (still right after `newTickCtx`) with the pulse-gated per-system maps and the tax-pressure lookup (Tasks 5–6 consume the other two maps; building all three in one pass keeps it a single O(systems) sweep):

```typescript
  const taxPressureByFaction = new Map(
    treasuries.map((t) => [t.factionId, TAX_LEVEL_UNREST_PRESSURE[t.taxLevel]]),
  );
  // Per-system effect maps for the monthly-pulse stages (economy malus, decay
  // buffer, unrest tax pressure). Only built when those stages resolve.
  let maintenanceMalusBySystem: Map<string, number> | undefined;
  let maintenanceBufferScaleBySystem: Map<string, number> | undefined;
  let taxPressureBySystem: Map<string, number> | undefined;
  if (isPulseTick(tick, cadence.month) && treasuries.length > 0) {
    maintenanceMalusBySystem = new Map();
    maintenanceBufferScaleBySystem = new Map();
    taxPressureBySystem = new Map();
    for (const s of systems) {
      if (s.factionId === null) continue;
      const funded = fundedByFaction.get(s.factionId);
      if (funded !== undefined) {
        maintenanceMalusBySystem.set(
          s.id, maintenanceOutputMalus(funded.maintenance, TREASURY.MAINTENANCE_OUTPUT_MALUS_SLOPE),
        );
        maintenanceBufferScaleBySystem.set(
          s.id, maintenanceBufferScale(funded.maintenance, TREASURY.MAINTENANCE_BUFFER_SCALE_BASE),
        );
      }
      const pressure = taxPressureByFaction.get(s.factionId);
      if (pressure !== undefined && pressure > 0) taxPressureBySystem.set(s.id, pressure);
    }
  }
```

New imports in tick.ts: `TAX_LEVEL_UNREST_PRESSURE` (extend the existing `@/lib/constants/treasury` import) and `maintenanceOutputMalus, maintenanceBufferScale` from `@/lib/engine/treasury`.

Pass the malus map to the economy call:

```typescript
    const economyResult = await runEconomyProcessor(economyWorld, newTickCtx(), {
      interval: cadence.month,
      simParams: { holdCover: ECONOMY_CONSTANTS.HOLD_COVER },
      modifierCaps: MODIFIER_CAPS,
      strikeParams: STRIKE_PARAMS,
      maintenanceMalusBySystem,
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tick/processors/__tests__/economy.test.ts lib/world/__tests__/tick-monthly-pulse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tick/world/economy-world.ts lib/tick/processors/economy.ts lib/world/tick.ts lib/tick/processors/__tests__/economy.test.ts
git commit -m "feat(purse): maintenance output malus rides productionSuppress"
```

---

### Task 5: Maintenance funding modulates idle-decay aggression

**Files:**
- Modify: `lib/tick/world/infrastructure-world.ts` (`InfrastructureProcessorParams`)
- Modify: `lib/tick/processors/infrastructure-decay.ts`
- Modify: `lib/world/tick.ts` (param)
- Test: `lib/tick/processors/__tests__/infrastructure-decay.test.ts` (append)

**Interfaces:**
- Consumes: `maintenanceBufferScaleBySystem` from Task 4's tick.ts block.
- Produces: `InfrastructureProcessorParams.bufferScaleBySystem?: ReadonlyMap<string, number>` — multiplier on `idleBufferMonths` per system (missing → 1).

The base idle machinery never switches off and the unrest-collapse channel is untouched — funding only stretches/shrinks the idle buffer. v1 adds no new decay channel (a 0%-funded fully-utilised building keeps its levels).

- [ ] **Step 1: Write the failing test**

Append to `lib/tick/processors/__tests__/infrastructure-decay.test.ts` (reuses `sys`, `ctxWith`, `ORE_LABOUR`):

```typescript
  it("scales the idle buffer by per-system maintenance funding", async () => {
    // Buffer 2 with one idle ore level. s-starved carries bufferScale 0.5 → effective
    // buffer 1 → sheds on the first run; s-funded has no map entry → buffer 2 → survives it.
    const population = 4 * ORE_LABOUR;
    const world = new InMemoryInfrastructureWorld({
      systems: [
        sys("s-starved", { population, buildings: { ore: 10 } }),
        sys("s-funded", { population, buildings: { ore: 10 } }),
      ],
    });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["s-starved", 0], ["s-funded", 0]]),
      outputUptakeBySystem: new Map(),
      realizedProductionBySystem: new Map(),
    };
    await runInfrastructureDecayProcessor(world, ctxWith(signals), {
      decay: { idleBufferMonths: 2, unrestThreshold: 0.75 },
      interval: 24,
      bufferScaleBySystem: new Map([["s-starved", 0.5]]),
    });
    expect(world.systems.find((x) => x.id === "s-starved")!.buildings.ore).toBe(9);
    expect(world.systems.find((x) => x.id === "s-funded")!.buildings.ore).toBe(10);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tick/processors/__tests__/infrastructure-decay.test.ts`
Expected: FAIL — `bufferScaleBySystem` unknown param.

- [ ] **Step 3: Implement**

`lib/tick/world/infrastructure-world.ts`, add to `InfrastructureProcessorParams`:

```typescript
  /** Per-system idle-buffer multiplier from the owning faction's latched maintenance
   *  funding (maintenanceBufferScale). Missing system or omitted map → 1 (today's buffer). */
  bufferScaleBySystem?: ReadonlyMap<string, number>;
```

`lib/tick/processors/infrastructure-decay.ts`, in the per-system loop replace the `computeSystemDecay` call's params argument:

```typescript
    // Maintenance funding stretches/shrinks the idle buffer only — the unrest
    // channel and the buffer machinery itself are untouched (no new decay channel).
    const bufferScale = params.bufferScaleBySystem?.get(s.systemId) ?? 1;
    const decayParams =
      bufferScale === 1
        ? params.decay
        : { ...params.decay, idleBufferMonths: params.decay.idleBufferMonths * bufferScale };
    const result = computeSystemDecay(
      {
        buildings: s.buildings,
        buildingIdleMonths: s.buildingIdleMonths,
        buildingCollapseDebt: s.buildingCollapseDebt,
        population: s.population,
        unrest: s.unrest,
        outputUptake: (goodId) => uptake?.get(goodId) ?? 1,
      },
      decayParams,
      catchUp,
    );
```

`lib/world/tick.ts`, pass it in the infrastructure-decay call:

```typescript
      { decay: INFRASTRUCTURE_DECAY_PARAMS, interval: cadence.month, bufferScaleBySystem: maintenanceBufferScaleBySystem },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tick/processors/__tests__/infrastructure-decay.test.ts`
Expected: PASS. Note the world-level effect is a deliberate rebase: every solvent faction runs at `funded.maintenance = 1` → buffer 7.5 months instead of 6 (gentler than today, per spec). If any existing world test times a specific decay event, adjust its expectation to the 1.25× buffer — do not weaken the buffer-scale curve to preserve old timings.

- [ ] **Step 5: Commit**

```bash
git add lib/tick/world/infrastructure-world.ts lib/tick/processors/infrastructure-decay.ts lib/world/tick.ts lib/tick/processors/__tests__/infrastructure-decay.test.ts
git commit -m "feat(purse): maintenance funding modulates idle-decay buffer length"
```

---

### Task 6: Tax level feeds unrest pressure

**Files:**
- Modify: `lib/tick/world/population-world.ts` (`PopulationProcessorParams`)
- Modify: `lib/tick/processors/population.ts`
- Modify: `lib/world/tick.ts` (param)
- Test: `lib/tick/processors/__tests__/population.test.ts` (append)

**Interfaces:**
- Consumes: `taxPressureBySystem` from Task 4's tick.ts block (`TAX_LEVEL_UNREST_PRESSURE[taxLevel]` per owning faction).
- Produces: `PopulationProcessorParams.taxPressureBySystem?: ReadonlyMap<string, number>` — additive pressure on the unrest integrator's `d` term (missing → 0).

The pressure enters **only** the unrest integrator (`accumulateUnrest`, which clamps `d` internally); `populationDelta` keeps the raw dissatisfaction `d` — taxation suppresses growth only through the unrest it builds, not by faking hunger. Interval invariance is inherited: pressure rides `d`, whose gain is already catchUp-scaled.

- [ ] **Step 1: Write the failing test**

Append to `lib/tick/processors/__tests__/population.test.ts`, reusing that file's system/ctx fixture helpers (adapting names to what exists there — the assertions are what matter):

```typescript
  it("adds per-system tax pressure to the unrest integrator only", async () => {
    // d = 0, unrest starts 0, interval 24 (catchUp 1), UNREST_PARAMS-style gain 0.06:
    // taxed system integrates gain × pressure; untaxed stays at 0.
    const world = new InMemoryPopulationWorld({
      systems: [
        sys("taxed", { population: 100, popCap: 1000, unrest: 0 }),
        sys("free", { population: 100, popCap: 1000, unrest: 0 }),
      ],
      markets: [],
    });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["taxed", 0], ["free", 0]]),
      outputUptakeBySystem: new Map(),
      realizedProductionBySystem: new Map(),
    };
    await runPopulationProcessor(world, ctxWith(signals), {
      unrest: { gain: 0.06, decay: 0.06 },
      population: { growthRate: 0, declineRate: 0, overshootDeathRate: 0 },
      interval: 24,
      taxPressureBySystem: new Map([["taxed", 0.18]]),
    });
    expect(world.systems.find((s) => s.id === "taxed")!.unrest).toBeCloseTo(0.06 * 0.18, 9);
    expect(world.systems.find((s) => s.id === "free")!.unrest).toBe(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tick/processors/__tests__/population.test.ts`
Expected: FAIL — `taxPressureBySystem` unknown param.

- [ ] **Step 3: Implement**

`lib/tick/world/population-world.ts`, add to `PopulationProcessorParams`:

```typescript
  /** Per-system additive unrest pressure from the owning faction's tax level
   *  (TAX_LEVEL_UNREST_PRESSURE). Enters the unrest integrator's d term only;
   *  missing system or omitted map → 0. */
  taxPressureBySystem?: ReadonlyMap<string, number>;
```

`lib/tick/processors/population.ts`, in the loop:

```typescript
  for (const s of states) {
    const d = signals.dissatisfactionBySystem.get(s.systemId) ?? 0;
    // Tax pressure raises unrest, not hunger: it feeds the integrator's d term
    // (clamped inside accumulateUnrest) while the growth/decline delta keeps raw d.
    const taxPressure = params.taxPressureBySystem?.get(s.systemId) ?? 0;
    const unrest = accumulateUnrest(s.unrest, d + taxPressure, scaledUnrest);
    const population = Math.max(0, s.population + populationDelta(s.population, s.popCap, d, unrest, params.population) * catchUp);
```

`lib/world/tick.ts`, population call:

```typescript
      { unrest: UNREST_PARAMS, population: POPULATION_PARAMS, interval: cadence.month, taxPressureBySystem },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tick/processors/__tests__/population.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tick/world/population-world.ts lib/tick/processors/population.ts lib/world/tick.ts lib/tick/processors/__tests__/population.test.ts
git commit -m "feat(purse): tax level feeds per-system unrest pressure"
```

---

### Task 7: World-level guards — effects end-to-end + invariance bridges cover money

**Files:**
- Test: `lib/world/__tests__/tick-treasury.test.ts` (append)
- Test: `lib/world/__tests__/economy-scale-dynamic-invariance.test.ts` (extend)
- Test: `lib/world/__tests__/cadence-invariance.test.ts` (extend)

Now that money has behavioural consequences, the two load-bearing invariance bridges must cover treasury trajectories (spec §Remaining build wiring says exactly this).

- [ ] **Step 1: End-to-end funding-gate test (failing first only if Task 3 regressed — this is a live-tick guard)**

Append to `lib/world/__tests__/tick-treasury.test.ts`:

```typescript
  it("a zero-funded construction band performs no construction work (the queue waits)", async () => {
    // Divergent cadences so construction pulses mid-month and its work lands in
    // pendingWork (observable before settlement clears it).
    const cadence = { month: 48, construction: 24, logistics: 24 };
    let world = generateWorld({ systemCount: 40, seed: 11 });
    const starvedId = world.factions[0].id;
    world = {
      ...world,
      treasuries: world.treasuries.map((t) =>
        t.factionId === starvedId ? { ...t, funded: { ...t.funded, construction: 0 } } : t,
      ),
    };
    for (let tick = 1; tick <= 24; tick++) {
      const result = await runWorldTick(world, { cadence });
      world = result.world;
    }
    const starved = world.treasuries.find((t) => t.factionId === starvedId)!;
    expect(starved.pendingWork.construction).toBe(0);
    // The gate is per-faction: fully-funded factions still worked this pulse.
    const others = world.treasuries.filter((t) => t.factionId !== starvedId);
    expect(others.reduce((acc, t) => acc + t.pendingWork.construction, 0)).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Extend the S-invariance bridge to treasuries**

In `lib/world/__tests__/economy-scale-dynamic-invariance.test.ts`, have `runAtScale` also capture per-tick treasury balances, and assert they are **equal** across scales (money is S-invariant — NOT scale-normalised):

```typescript
// runAtScale return becomes:
//   { stocks: Array<Record<string, number>>, treasuries: Array<Record<string, number>> }
// capture inside the tick loop:
    const tSnap: Record<string, number> = {};
    for (const t of world.treasuries) tSnap[t.factionId] = t.balance;
    perTickTreasury.push(tSnap);
```

and after the existing stock assertions:

```typescript
    // Money never rides S: balances must be EQUAL (not scale-normalised) at every tick.
    for (let t = 0; t < TICKS; t++) {
      for (const key of Object.keys(s1.treasuries[t])) {
        const a = s1.treasuries[t][key];
        const b = s100.treasuries[t][key];
        const rel = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
        expect(rel, `tick ${t}: treasury ${key} diverges — S=1 ${a} vs S=100 ${b}`).toBeLessThan(TOL);
      }
    }
```

Update the two call sites for the new return shape (`s1.stocks[t]` where it read `s1[t]`).

- [ ] **Step 3: Extend the cadence-invariance totals to treasury balance**

In `lib/world/__tests__/cadence-invariance.test.ts`, add to `RunTotals` and `runAtCadence`:

```typescript
interface RunTotals {
  population: number;
  buildings: number;
  treasuryBalance: number;
}
// in runAtCadence, alongside the other sums:
  let treasuryBalance = 0;
  for (const t of world.treasuries) treasuryBalance += t.balance;
```

and in the test loop add the same rel-diff bar:

```typescript
        const dTre = relDiff(base.treasuryBalance, v.treasuryBalance);
        expect(
          dTre,
          `${name}: treasury balance rate diverges — base ${base.treasuryBalance.toFixed(1)} vs ${v.treasuryBalance.toFixed(1)} (rel ${dTre.toExponential(2)})`,
        ).toBeLessThan(TOL);
```

If the honest fundQueue-redistribution noise on balances measurably exceeds the shared `TOL` (run it and look at the reported rel), give the treasury assertion its own documented tolerance derived from the measured honest baseline — with the same "a dropped catchUp diverges an order of magnitude past it" justification style the file header uses. Do not silently widen the shared TOL.

- [ ] **Step 4: Run the world suites**

Run: `npx vitest run lib/world/__tests__/`
Expected: PASS (the cadence test is slow — it has a 120 s timeout; run it in isolation if the parallel batch times out).

- [ ] **Step 5: Commit**

```bash
git add lib/world/__tests__/tick-treasury.test.ts lib/world/__tests__/economy-scale-dynamic-invariance.test.ts lib/world/__tests__/cadence-invariance.test.ts
git commit -m "test(purse): funding-gate world test; invariance bridges cover treasury trajectories"
```

---

### Task 8: Harness validation, long-horizon hoard check, docs + backlog bookkeeping

**Files:**
- Create: `experiments/` YAML config for the long run (via `npm run simulate -- --config`)
- Modify: `docs/planned/player-seat-purse.md` (Plan 2 shipped note; shrink "Remaining build wiring" to Plan 3)
- Modify: `docs/SPEC.md` (two lines), `docs/active/gameplay/economy-autonomic-agency.md` (billing line)
- Modify: `docs/BACKLOG.md` (resolve the `[S]` hoard item)
- Delete: `docs/build-plans/purse-plan-2-effects.md` (this file — on the feature branch, before the squash-merge)

- [ ] **Step 1: Quick-run sanity**

Run: `npm run simulate`
Expected: intrinsic health metrics comparable to main (no NaN, no runaway, no pinned metrics); treasury summary shows early-game solvency intact and funded means near 1 with some scarcity windows. The 500-tick default is pre-logistics — don't read logistics numbers as health. If early-game construction now stalls by bookkeeping accident (funded.construction pinned low in the opening eras), tune `TREASURY` rates coarsely (income up or sink rates down) — solvency at start is a calibration outcome, keep it coarse.

- [ ] **Step 2: Long-horizon hoard re-validation (the booked BACKLOG item)**

Write a YAML config (mirror an existing `experiments/examples/*.yaml`, 3000 ticks, default scale) and run:

`npm run simulate -- --config <file>`

Read `treasurySummary`/`treasurySnapshots` from the saved `experiments/*.json`: the balance-to-income ratio over time must settle rather than climb (the Plan 1 run ended in its fastest-growing window, mean +12.65/tick over t=1250–1500, bills ~34% of income — "not monotone" was proven, "no runaway hoard" was not). Effects give hoards their first real sink pressure; if the ratio still climbs, retune sink rates (`MAINTENANCE_RATE_PER_WORK` first — it is the standing sink) until the trajectory flattens. Coarse bar only.

- [ ] **Step 3: Doc lifecycle (on the feature branch, before merge)**

- `docs/planned/player-seat-purse.md`: header note becomes "Plans 1–2 SHIPPED"; delete the Plan 2 bullet from "Remaining build wiring" (keep Plan 3's); the spec stays in `planned/` until Plan 3 promotes the slice.
- `docs/SPEC.md`: Directed Logistics & Autonomic Agency — replace "(observation only for now — funding does not yet gate the pools; that is the purse slice's next plan)" with the funded-fraction gating being live; Single-Player Runtime — replace "harness-observable, gating nothing yet; effects and UI are the purse slice's remaining plans" with "effects live (funding gates construction/logistics, maintenance modulates decay + output, tax feeds unrest); UI is the purse slice's remaining plan".
- `docs/active/gameplay/economy-autonomic-agency.md`: update the matching "billed … observation only" sentence (grep `does not yet gate` / `observation only` across `docs/`).
- `docs/BACKLOG.md`: delete the `[S]` hoard item, replacing it with nothing if Step 2 settled (the experiment JSON is the record) — or update it with the measured outcome if a retune was deferred.
- Delete this build plan file.

- [ ] **Step 4: Full gates**

Run: `npx vitest run` → all green.
Run: `npx next build --webpack` → builds clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(purse): Plan 2 shipped — spec/backlog lifecycle + hoard re-validation"
```

Then: push, open the PR, `/uber-review` (PR mode: check out the PR head first), fix-wave, squash-merge per house workflow.

---

## Self-Review Notes (already applied)

- **Spec coverage:** funded→construction (T3), funded→logistics (T2), maintenance→decay buffer (T5), output malus not feeding buildingUsed (T4 — structurally: malus rides `productionSuppress` into `productionRate`; `buildingUsed` reads labour parts + `outputUptake` only), tax→unrest `d` term (T6), invariance-test extension (T7), coarse calibration + hoard re-validation (T8). Not in scope (Plan 3): sliders/mutations/UI, the 0.5 slider-floor write boundary (already enforced nowhere yet because nothing writes bands), treasury card.
- **The one-month lag** is by stage order (treasury settles last), not new state — no save-format bump anywhere in this plan.
- **Type consistency:** all four new param fields are optional `ReadonlyMap`s defaulting to the identity (1 / 0-pressure); tick.ts builds them from the single `fundedByFaction` sweep introduced in Task 2 and extended in Task 4.
- **Known judgment calls** (flag in PR description): centre valuation and the colony pool-floor deliberately read the physical pool (funding scales only what runs); tax pressure enters `accumulateUnrest` only, never `populationDelta`'s satisfaction factor; full-funding decay is a deliberate rebase to a 1.25× buffer (gentler than today).
