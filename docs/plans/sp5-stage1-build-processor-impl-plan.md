# SP5 Stage 1 — Build Processor + Sim Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the pure `directed-build` engine into the tick pipeline as a processor that applies its `PlannedBuild[]` as building-count increments, and run it in the simulator so a hand-seeded world visibly develops (industry + housing grow) over ticks.

**Architecture:** A faithful mirror of the shipped `directed-logistics` processor stack — a per-faction sharded processor body (`runDirectedBuildProcessor`) over a `DirectedBuildWorld` data interface, with an in-memory adapter for tests + the simulator. Two things differ from logistics: (1) the body **increments building counts** (production goods + `housing`) instead of moving market stock, and (2) it needs body-derived **capacity** inputs (`slotCap`/`generalSpace`/`habitableSpace`) that the simulator's `SimSystem` currently drops. The per-good market-state derivation that both processors share is extracted into one helper.

**Tech Stack:** TypeScript 5 (strict), Vitest 4. Pure processor body (zero DB). Reuses `lib/engine/directed-build.ts` (the shipped engine), `lib/engine/directed-logistics.ts` (`RouteCost`, `GoodMarketState`), `lib/tick/shard.ts`, `lib/engine/industry.ts`, `lib/engine/market-pricing.ts`, `lib/engine/pathfinding.ts`.

## Global Constraints

- **No `as` casts** except `as const` (project rule). No `unknown`, no `Record<string, unknown>`.
- **No postfix `!`** except `find(...)!` in tests (project idiom).
- **Processor body + helper + world interface + memory adapter are PURE** — zero DB imports. NEVER statically import `@/lib/prisma` (directly or transitively); the `unit` Vitest project sets no `DATABASE_URL` and module-load would throw. Keep prisma-tainted deps out of these files.
- **This plan does NOT add the live Prisma adapter or the registry registration.** Those are the *next* follow-on plan (they need a short body-capacity-read exploration of the live schema first). So the new processor file must contain only the pure `runDirectedBuildProcessor` body — **no `directedBuildProcessor: TickProcessor` const, no Prisma-adapter import.** The processor runs in the **simulator** this plan; live wiring lands next.
- **Discriminated unions** for result-ish types, not `{ ok: boolean; ... }`.
- Reuse existing helpers — do not duplicate the market-state derivation, the shard math, or the hop-distance route cost.
- **`\uXXXX` escapes:** do not write string keys containing backslash-u escape sequences — the edit pipeline normalizes them to glyphs. Use nested `Map`s instead of concatenated string keys (the code below already does).
- Run unit tests with `npx vitest run --project unit <path>` (verify with `DATABASE_URL` unset). The simulator smoke is `npm run simulate`.

## File Structure

- `lib/tick/processors/good-market-state.ts` (NEW) — shared `toGoodMarketStates(row)` helper, extracted from the logistics processor; consumed by both processors.
- `lib/engine/simulator/types.ts` (MODIFY) — add `slotCap`/`generalSpace`/`habitableSpace` to `SimSystem`.
- `lib/engine/simulator/world.ts` (MODIFY) — forward those three from the generated system in `createSimWorld`.
- `lib/tick/world/directed-build-world.ts` (NEW) — `DirectedBuildWorld` interface + `SystemBuildRow` + `BuildBuildingUpdate`.
- `lib/tick/adapters/memory/directed-build.ts` (NEW) — `MemoryDirectedBuildWorld`.
- `lib/tick/processors/directed-build.ts` (NEW) — `runDirectedBuildProcessor` (pure body only).
- `lib/engine/simulator/economy.ts` (MODIFY) — `processSimDirectedBuild` + wire into `simulateWorldTick`.

---

### Task 1: Extract the shared `toGoodMarketStates` helper

The logistics processor's `toLogisticsState` derives, per system, the engine's `GoodMarketState[]` (per good: stock + days-of-supply `targetStock` + total demand). The build processor needs the *identical* derivation for `BuildSystemState.goods`. Extract it into one shared, prisma-free helper and refactor `toLogisticsState` to use it. Behaviour of the logistics processor must not change.

**Files:**
- Create: `lib/tick/processors/good-market-state.ts`
- Create: `lib/tick/processors/__tests__/good-market-state.test.ts`
- Modify: `lib/tick/processors/directed-logistics.ts`

**Interfaces:**
- Consumes: `marketBandForRow` (`lib/engine/market-pricing`); `capacityGoodRates`, `inputDemandForGood`, `labourDemand`, `labourFulfillment` (`lib/engine/industry`); `GoodMarketState` (`lib/engine/directed-logistics`); `ResourceVector` (`lib/types/game`); `MarketRowForLogistics` (`lib/tick/world/directed-logistics-world`).
- Produces: `interface MarketStateSource { buildings: Record<string, number>; population: number; yields: ResourceVector; markets: MarketRowForLogistics[] }` and `toGoodMarketStates(row: MarketStateSource): GoodMarketState[]`.

- [ ] **Step 1: Write the failing test**

Create `lib/tick/processors/__tests__/good-market-state.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { unitResourceVector } from "@/lib/engine/resources";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";

function foodMarket(stock: number, demandRate: number): MarketRowForLogistics {
  return {
    id: "A|food", goodId: "food", stock, basePrice: 10, anchorMult: 1,
    demandRate, priceFloor: 0.5, priceCeiling: 3.0, storageCapacity: 0,
  };
}

describe("toGoodMarketStates", () => {
  it("passes stock + goodId through and uses the band's targetStock", () => {
    const m = foodMarket(7, 40);
    const out = toGoodMarketStates({
      buildings: {}, population: 100, yields: unitResourceVector(), markets: [m],
    });
    expect(out).toHaveLength(1);
    expect(out[0].goodId).toBe("food");
    expect(out[0].stock).toBe(7);
    expect(out[0].targetStock).toBe(marketBandForRow(m, m).targetStock);
    expect(Number.isFinite(out[0].demand)).toBe(true);
    expect(out[0].demand).toBeGreaterThanOrEqual(0);
  });

  it("returns one entry per market row", () => {
    const out = toGoodMarketStates({
      buildings: {}, population: 100, yields: unitResourceVector(),
      markets: [foodMarket(5, 20), { ...foodMarket(5, 20), id: "A|water", goodId: "water" }],
    });
    expect(out.map((g) => g.goodId)).toEqual(["food", "water"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit lib/tick/processors/__tests__/good-market-state.test.ts`
Expected: FAIL — module `@/lib/tick/processors/good-market-state` not found.

- [ ] **Step 3: Create the helper**

Create `lib/tick/processors/good-market-state.ts`:

```typescript
/**
 * Shared per-system market-state derivation for the directed-logistics matcher and
 * the directed-build planner. Given one system's buildings/population/yields and its
 * market rows, produce the engine's GoodMarketState[]: per good, current stock, the
 * days-of-supply price anchor (targetStock), and total demand (civilian consumption +
 * industrial input draw). One definition so both processors read markets identically.
 */
import type { ResourceVector } from "@/lib/types/game";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import {
  capacityGoodRates,
  inputDemandForGood,
  labourDemand,
  labourFulfillment,
} from "@/lib/engine/industry";
import type { GoodMarketState } from "@/lib/engine/directed-logistics";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";

/** Minimal per-system shape both processors derive market state from. */
export interface MarketStateSource {
  buildings: Record<string, number>;
  population: number;
  yields: ResourceVector;
  markets: MarketRowForLogistics[];
}

export function toGoodMarketStates(row: MarketStateSource): GoodMarketState[] {
  const demand = labourDemand(row.buildings);
  const fulfillment = labourFulfillment(row.population, demand);
  const rates = capacityGoodRates(row.buildings, row.population, row.yields);
  const consByKey = new Map(rates.map((r) => [r.goodId, r.consumption]));

  const goods: GoodMarketState[] = [];
  for (const m of row.markets) {
    const band = marketBandForRow(m, m);
    const civ = consByKey.get(m.goodId) ?? 0;
    const industrial = inputDemandForGood(row.buildings, m.goodId, fulfillment, row.yields);
    goods.push({ goodId: m.goodId, stock: m.stock, targetStock: band.targetStock, demand: civ + industrial });
  }
  return goods;
}
```

- [ ] **Step 4: Refactor `toLogisticsState` to use the helper**

In `lib/tick/processors/directed-logistics.ts`, replace the body of `toLogisticsState` with a call to the helper, and remove the now-unused imports it pulled in.

Replace the function:

```typescript
function toLogisticsState(row: SystemLogisticsRow): SystemLogisticsState {
  return {
    systemId: row.systemId,
    factionId: row.factionId,
    generation: systemLogisticsGeneration(row.population),
    goods: toGoodMarketStates(row),
  };
}
```

Add the import:

```typescript
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
```

Then prune the imports that are now only used by the helper. In the existing
`import { capacityGoodRates, inputDemandForGood, labourDemand, labourFulfillment } from "@/lib/engine/industry";`
line, remove all four names **if** none remain used elsewhere in the file. (`marketBandForRow` IS still used by the body's `marketByKey` clamp — keep it.) After editing, confirm there are no unused imports.

- [ ] **Step 5: Run tests to verify all pass (helper + unchanged logistics processor)**

Run: `npx vitest run --project unit lib/tick/processors/__tests__/good-market-state.test.ts lib/tick/processors/__tests__/directed-logistics.test.ts`
Expected: PASS — new helper tests and all existing directed-logistics processor tests (behaviour unchanged).

- [ ] **Step 6: Commit**

```bash
git add lib/tick/processors/good-market-state.ts lib/tick/processors/__tests__/good-market-state.test.ts lib/tick/processors/directed-logistics.ts
git commit -m "refactor(tick): extract shared toGoodMarketStates market-state helper"
```

---

### Task 2: Carry body-derived capacity onto `SimSystem`

The build engine needs each system's `slotCap` (deposit-slot capacity per resource), `generalSpace`, and `habitableSpace`. These exist on the generated system (`GeneratedSystem` in `lib/engine/body-gen.ts`) but are dropped when `createSimWorld` builds `SimSystem`. Forward them.

**Files:**
- Modify: `lib/engine/simulator/types.ts`
- Modify: `lib/engine/simulator/world.ts`
- Modify: `lib/engine/simulator/__tests__/world.test.ts`

**Interfaces:**
- Produces: `SimSystem` gains `slotCap: ResourceVector`, `generalSpace: number`, `habitableSpace: number`.

- [ ] **Step 1: Write the failing test**

Add to `lib/engine/simulator/__tests__/world.test.ts` (inside the existing describe that constructs a world via `createSimWorld`; reuse this file's existing `config`/`constants` setup — do not invent new ones):

```typescript
import { RESOURCE_TYPES } from "@/lib/engine/resources";

it("carries body-derived capacity (slotCap/generalSpace/habitableSpace) onto each system", () => {
  // Reuse this file's existing createSimWorld(...) construction.
  const world = createSimWorld(config, constants);
  const s = world.systems[0];
  expect(Number.isFinite(s.generalSpace)).toBe(true);
  expect(Number.isFinite(s.habitableSpace)).toBe(true);
  expect(s.generalSpace).toBeGreaterThanOrEqual(0);
  expect(s.habitableSpace).toBeGreaterThanOrEqual(0);
  for (const k of RESOURCE_TYPES) expect(Number.isFinite(s.slotCap[k])).toBe(true);
});
```

If `config`/`constants` are named differently in this file, use whatever the existing tests pass to `createSimWorld`. If `RESOURCE_TYPES` is already imported, don't double-import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit lib/engine/simulator/__tests__/world.test.ts`
Expected: FAIL — `s.slotCap`/`s.generalSpace`/`s.habitableSpace` are `undefined` (property does not exist on `SimSystem`), so `Number.isFinite(undefined)` is `false` / the `slotCap[k]` access fails typecheck.

- [ ] **Step 3: Add the fields to `SimSystem`**

In `lib/engine/simulator/types.ts`, in `interface SimSystem`, after the `yields: ResourceVector;` field add:

```typescript
  /** Body-derived deposit-slot capacity per resource — caps tier-0 extractor builds. */
  slotCap: ResourceVector;
  /** Body-derived fungible build space — tier-1+ factories + housing draw here. */
  generalSpace: number;
  /** Habitable subset of build space — additionally caps housing. */
  habitableSpace: number;
```

(`ResourceVector` is already imported in this file for `yields`.)

- [ ] **Step 4: Forward them in `createSimWorld`**

In `lib/engine/simulator/world.ts`, in the `universe.systems.map((s, i) => { ... return { ... } })` that builds each `SimSystem`, after `yields: s.yieldMult,` add:

```typescript
      slotCap: s.slotCap,
      generalSpace: s.generalSpace,
      habitableSpace: s.habitableSpace,
```

(`s` is the generated system; it already carries `slotCap`/`generalSpace`/`habitableSpace` — see `lib/engine/body-gen.ts`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project unit lib/engine/simulator/__tests__/world.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/simulator/types.ts lib/engine/simulator/world.ts lib/engine/simulator/__tests__/world.test.ts
git commit -m "feat(sim): carry slotCap/generalSpace/habitableSpace onto SimSystem"
```

---

### Task 3: `DirectedBuildWorld` interface + in-memory adapter

The data interface the processor reads/writes, plus the in-memory adapter used by unit tests and the simulator. Mirrors `DirectedLogisticsWorld` / `MemoryDirectedLogisticsWorld`, but the write path **increments building counts** (absolute new counts) instead of writing market stock + flow rows.

**Files:**
- Create: `lib/tick/world/directed-build-world.ts`
- Create: `lib/tick/adapters/memory/directed-build.ts`
- Create: `lib/tick/adapters/memory/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes: `ResourceVector` (`lib/types/game`); `MarketRowForLogistics` (`lib/tick/world/directed-logistics-world`).
- Produces: `SystemBuildRow`, `BuildBuildingUpdate`, `DirectedBuildWorld`, `MemoryDirectedBuildWorld`.

- [ ] **Step 1: Write the failing test**

Create `lib/tick/adapters/memory/__tests__/directed-build.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { MemoryDirectedBuildWorld } from "@/lib/tick/adapters/memory/directed-build";
import type { SystemBuildRow } from "@/lib/tick/world/directed-build-world";
import { emptyResourceVector } from "@/lib/engine/resources";

function row(systemId: string, factionId: string | null): SystemBuildRow {
  return {
    systemId, factionId, population: 100, buildings: {},
    yields: emptyResourceVector(), slotCap: emptyResourceVector(),
    generalSpace: 0, habitableSpace: 0, markets: [],
  };
}

describe("MemoryDirectedBuildWorld", () => {
  it("returns the distinct faction shard keys", async () => {
    const w = new MemoryDirectedBuildWorld([row("A", "f1"), row("B", "f1"), row("C", null)]);
    const keys = await w.getFactionShardKeys();
    expect(new Set(keys)).toEqual(new Set(["f1", null]));
  });

  it("filters systems by the requested faction keys", async () => {
    const w = new MemoryDirectedBuildWorld([row("A", "f1"), row("C", null)]);
    const got = await w.getSystemsForFactions(["f1"]);
    expect(got.map((s) => s.systemId)).toEqual(["A"]);
  });

  it("captures building-count writes", async () => {
    const w = new MemoryDirectedBuildWorld([row("A", "f1")]);
    await w.applyBuildingIncreases([{ systemId: "A", buildingType: "food", count: 3.5 }]);
    expect(w.buildingUpdates).toEqual([{ systemId: "A", buildingType: "food", count: 3.5 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit lib/tick/adapters/memory/__tests__/directed-build.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create the world interface**

Create `lib/tick/world/directed-build-world.ts`:

```typescript
/**
 * DirectedBuildWorld — data interface for the directed-build processor.
 * Adapters in lib/tick/adapters/{prisma,memory}/directed-build.ts implement it (the
 * Prisma adapter lands in the follow-on live-wiring plan). Sharding is PER-FACTION
 * (the build planner needs all of a faction's systems at once), matching logistics.
 */
import type { ResourceVector } from "@/lib/types/game";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";

/** One system's build-relevant state: markets + buildings + body-derived capacity. */
export interface SystemBuildRow {
  systemId: string;
  factionId: string | null;
  population: number;
  buildings: Record<string, number>;
  /** Per-resource effective yields, for the shared market-state derivation. */
  yields: ResourceVector;
  /** Per-resource deposit-slot cap — caps tier-0 extractor builds. */
  slotCap: ResourceVector;
  /** Fungible general build space — tier-1+ factories + housing. */
  generalSpace: number;
  /** Habitable subset of build space — additionally caps housing. */
  habitableSpace: number;
  /** Raw market band inputs (shared shape with logistics). */
  markets: MarketRowForLogistics[];
}

/** One building-count write: the new ABSOLUTE count for (system, buildingType). */
export interface BuildBuildingUpdate {
  systemId: string;
  buildingType: string;
  count: number;
}

export interface DirectedBuildWorld {
  /** Distinct faction groups (incl. one null/independents group) — drives the per-faction shard. */
  getFactionShardKeys(): Promise<Array<string | null>>;
  /** All systems (with markets + capacity) belonging to the given faction keys. */
  getSystemsForFactions(factionKeys: Array<string | null>): Promise<SystemBuildRow[]>;
  /** Bulk absolute building-count writes (production goods + "housing"). */
  applyBuildingIncreases(updates: BuildBuildingUpdate[]): Promise<void>;
}
```

- [ ] **Step 4: Create the in-memory adapter**

Create `lib/tick/adapters/memory/directed-build.ts`:

```typescript
import type {
  DirectedBuildWorld,
  SystemBuildRow,
  BuildBuildingUpdate,
} from "@/lib/tick/world/directed-build-world";

/** In-memory DirectedBuildWorld for unit tests + the simulator. Captures writes for assertions + write-back. */
export class MemoryDirectedBuildWorld implements DirectedBuildWorld {
  /** New absolute building counts written this run. */
  readonly buildingUpdates: BuildBuildingUpdate[] = [];

  constructor(private readonly systems: SystemBuildRow[]) {}

  async getFactionShardKeys(): Promise<Array<string | null>> {
    const seen = new Set<string | null>();
    for (const s of this.systems) seen.add(s.factionId);
    return [...seen];
  }

  async getSystemsForFactions(factionKeys: Array<string | null>): Promise<SystemBuildRow[]> {
    const set = new Set(factionKeys);
    return this.systems.filter((s) => set.has(s.factionId));
  }

  async applyBuildingIncreases(updates: BuildBuildingUpdate[]): Promise<void> {
    this.buildingUpdates.push(...updates);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project unit lib/tick/adapters/memory/__tests__/directed-build.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/tick/world/directed-build-world.ts lib/tick/adapters/memory/directed-build.ts lib/tick/adapters/memory/__tests__/directed-build.test.ts
git commit -m "feat(build): DirectedBuildWorld interface + in-memory adapter"
```

---

### Task 4: `runDirectedBuildProcessor` body (pure)

The per-faction sharded processor body. For each due faction, build engine state from rows (reusing the shared market-state helper + the capacity fields), call `planFactionBuilds`, accumulate the planned additions per (system, buildingType), scale by the catch-up factor, and write **absolute new counts** (`current + added × catchUp`). Mirrors `runDirectedLogisticsProcessor`'s shard/loop structure. **No live `TickProcessor` const** (next plan) — pure body only.

**Files:**
- Create: `lib/tick/processors/directed-build.ts`
- Create: `lib/tick/processors/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes: `shardRange`, `catchUpFactor` (`lib/tick/shard`); `planFactionBuilds`, `BuildSystemState` (`lib/engine/directed-build`); `RouteCost` (`lib/engine/directed-logistics`); `toGoodMarketStates` (Task 1); `DirectedBuildWorld`, `SystemBuildRow`, `BuildBuildingUpdate` (Task 3); `TickContext`, `TickProcessorResult` (`lib/tick/types`).
- Produces: `interface DirectedBuildProcessorParams { interval: number; routeCost: RouteCost }` and `runDirectedBuildProcessor(world, ctx, params): Promise<TickProcessorResult>`.

- [ ] **Step 1: Write the failing test**

Create `lib/tick/processors/__tests__/directed-build.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runDirectedBuildProcessor } from "@/lib/tick/processors/directed-build";
import { MemoryDirectedBuildWorld } from "@/lib/tick/adapters/memory/directed-build";
import type { SystemBuildRow } from "@/lib/tick/world/directed-build-world";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";
import { emptyResourceVector, unitResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import type { RouteCost } from "@/lib/engine/directed-logistics";

const reachable: RouteCost = () => 1;

// food market with a high demandRate so the band's targetStock is large — stock 1 is a deep deficit.
function foodMarket(systemId: string, stock: number): MarketRowForLogistics {
  return {
    id: `${systemId}|food`, goodId: "food", stock, basePrice: 10, anchorMult: 1,
    demandRate: 1000, priceFloor: 0.5, priceCeiling: 3.0, storageCapacity: 0,
  };
}

const INTERVAL = 4;
const DUE_TICK = INTERVAL - 1; // a single faction shard is due when tick % interval === interval-1
const NOT_DUE_TICK = 0;        // window [floor(0), floor(1/4)) = [0,0) — empty

function builderSlots(n: number) {
  const slotCap = emptyResourceVector();
  for (const k of RESOURCE_TYPES) slotCap[k] = n;
  return slotCap;
}

// A: deep structural food deficit, no capacity. B: builder with arable slots + budget, reachable from A.
function scenario(bFood: number, bHousing: number): SystemBuildRow[] {
  return [
    {
      systemId: "A", factionId: "f1", population: 100, buildings: {},
      yields: unitResourceVector(), slotCap: emptyResourceVector(),
      generalSpace: 0, habitableSpace: 0, markets: [foodMarket("A", 1)],
    },
    {
      systemId: "B", factionId: "f1", population: 5000, buildings: { food: bFood, housing: bHousing },
      yields: unitResourceVector(), slotCap: builderSlots(20),
      generalSpace: 100, habitableSpace: 100, markets: [],
    },
  ];
}

function countOf(w: MemoryDirectedBuildWorld, systemId: string, type: string): number {
  const u = w.buildingUpdates.find((x) => x.systemId === systemId && x.buildingType === type);
  return u?.count ?? 0;
}

describe("runDirectedBuildProcessor", () => {
  it("builds production + housing at a reachable builder on a due tick", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    expect(countOf(w, "B", "food")).toBeGreaterThan(0);
    expect(countOf(w, "B", "housing")).toBeGreaterThan(0);
    // Writes are absolute new counts (current 0 + added), never the deficit system A.
    expect(w.buildingUpdates.every((u) => u.systemId === "B")).toBe(true);
  });

  it("does nothing on a not-due tick (empty shard window)", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    expect(w.buildingUpdates).toHaveLength(0);
  });

  it("develops a hand-seeded world: keeps building toward the unmet deficit across cycles", async () => {
    // Cycle 1 from a blank builder; feed its output counts back as cycle-2 input so increments persist.
    const w1 = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w1, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    const food1 = countOf(w1, "B", "food");
    expect(food1).toBeGreaterThan(0);

    const w2 = new MemoryDirectedBuildWorld(scenario(food1, countOf(w1, "B", "housing")));
    await runDirectedBuildProcessor(w2, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    expect(countOf(w2, "B", "food")).toBeGreaterThan(food1);
  });

  it("returns no writes when there are no structural deficits", async () => {
    const balanced: SystemBuildRow[] = [{
      systemId: "A", factionId: "f1", population: 100, buildings: {},
      yields: unitResourceVector(), slotCap: builderSlots(10), generalSpace: 50, habitableSpace: 50,
      markets: [{ ...foodMarket("A", 1), demandRate: 0 }], // demandRate 0 → targetStock 0 → balanced
    }];
    const w = new MemoryDirectedBuildWorld(balanced);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    expect(w.buildingUpdates).toHaveLength(0);
  });
});
```

> Note for the implementer: the deficit cases rely on `marketBandForRow`'s `targetStock` being large for `demandRate: 1000` (stock 1 ≪ target → deficit) and `~0` for `demandRate: 0` (→ balanced). If the RED→GREEN run shows a case not behaving as a deficit/balanced, adjust the `demandRate` magnitudes until `classifyMarketState` sees them as intended — the test asserts the build *mechanism*, not specific band numbers. Do not weaken the build assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit lib/tick/processors/__tests__/directed-build.test.ts`
Expected: FAIL — `runDirectedBuildProcessor` not found.

- [ ] **Step 3: Implement the processor body**

Create `lib/tick/processors/directed-build.ts`:

```typescript
import type { TickContext, TickProcessorResult } from "../types";
import { shardRange, catchUpFactor } from "@/lib/tick/shard";
import { planFactionBuilds, type BuildSystemState } from "@/lib/engine/directed-build";
import type { RouteCost } from "@/lib/engine/directed-logistics";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import type {
  DirectedBuildWorld,
  SystemBuildRow,
  BuildBuildingUpdate,
} from "@/lib/tick/world/directed-build-world";

export interface DirectedBuildProcessorParams {
  interval: number;
  /** Per-unit route cost between two systems; null = unreachable / beyond hop budget. */
  routeCost: RouteCost;
}

/** Build the engine's per-system build state: capacity + per-good market state (shared derivation). */
function toBuildState(row: SystemBuildRow): BuildSystemState {
  return {
    systemId: row.systemId,
    factionId: row.factionId,
    population: row.population,
    buildings: row.buildings,
    slotCap: row.slotCap,
    generalSpace: row.generalSpace,
    habitableSpace: row.habitableSpace,
    goods: toGoodMarketStates(row),
  };
}

/**
 * Pure processor body. PER-FACTION shard (mirrors directed-logistics): a contiguous
 * window of the stable faction-key order runs each tick, so every faction is planned
 * once per `interval` ticks. The build engine returns production + housing builds; we
 * apply them as building-count increments (continuous Float), scaled to wall-clock by
 * the catch-up factor. Removal stays disuse-decay's job — this only adds.
 */
export async function runDirectedBuildProcessor(
  world: DirectedBuildWorld,
  ctx: Pick<TickContext, "tick">,
  params: DirectedBuildProcessorParams,
): Promise<TickProcessorResult> {
  const factionKeys = await world.getFactionShardKeys();
  if (factionKeys.length === 0) return {};

  const { start, end } = shardRange(factionKeys.length, ctx.tick, params.interval);
  const dueKeys = factionKeys.slice(start, end);
  if (dueKeys.length === 0) return {};

  const rows = await world.getSystemsForFactions(dueKeys);
  if (rows.length === 0) return {};

  const catchUp = catchUpFactor(params.interval);

  // Group rows by faction; plan each faction independently.
  const byFaction = new Map<string | null, SystemBuildRow[]>();
  for (const r of rows) {
    const list = byFaction.get(r.factionId) ?? [];
    list.push(r);
    byFaction.set(r.factionId, list);
  }

  // Current counts per system, to turn engine "add count" into an absolute write.
  const currentBySystem = new Map<string, Record<string, number>>();
  for (const r of rows) currentBySystem.set(r.systemId, r.buildings);

  // Accumulate added units per system → buildingType across the faction's plans.
  const addedBySystem = new Map<string, Map<string, number>>();
  for (const group of byFaction.values()) {
    const plans = planFactionBuilds(group.map(toBuildState), params.routeCost);
    for (const b of plans) {
      const byType = addedBySystem.get(b.systemId) ?? new Map<string, number>();
      byType.set(b.buildingType, (byType.get(b.buildingType) ?? 0) + b.count);
      addedBySystem.set(b.systemId, byType);
    }
  }
  if (addedBySystem.size === 0) return {};

  // Emit absolute new counts = current + added × catch-up (continuous; counts are Float).
  const updates: BuildBuildingUpdate[] = [];
  for (const [systemId, byType] of addedBySystem) {
    const current = currentBySystem.get(systemId);
    for (const [buildingType, added] of byType) {
      const scaled = added * catchUp;
      if (!Number.isFinite(scaled) || scaled <= 0) continue;
      const cur = current?.[buildingType] ?? 0;
      updates.push({ systemId, buildingType, count: cur + scaled });
    }
  }
  if (updates.length > 0) await world.applyBuildingIncreases(updates);

  return {};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit lib/tick/processors/__tests__/directed-build.test.ts`
Expected: PASS — all four cases.

- [ ] **Step 5: Commit**

```bash
git add lib/tick/processors/directed-build.ts lib/tick/processors/__tests__/directed-build.test.ts
git commit -m "feat(build): directed-build processor body (plan → building-count increments)"
```

---

### Task 5: Simulator wiring + validation

Wire the processor into the simulator's in-memory tick (`simulateWorldTick`), mirroring `processSimDirectedLogistics`, with the build-specific write-back (increment building counts on `world.systems`). Build runs **after** logistics in the tick so it only targets structural gaps logistics could not serve. Validate the wired pipeline runs cleanly (no NaN / no crash) and the `npm run simulate` smoke is unchanged in shape.

**Files:**
- Modify: `lib/engine/simulator/economy.ts`
- Create: `lib/engine/simulator/__tests__/directed-build-sim.test.ts`

**Interfaces:**
- Consumes: `MemoryDirectedBuildWorld` (Task 3); `runDirectedBuildProcessor` (Task 4); `DIRECTED_BUILD` (`lib/constants/directed-build`); `computeBoundedHopDistances` (already imported in `economy.ts`); `RouteCost` (already imported); `resolveConstants`, `createSimWorld`, `simulateWorldTick` (sim).

- [ ] **Step 1: Write the failing test**

Create `lib/engine/simulator/__tests__/directed-build-sim.test.ts`. Construct the world, RNG, and `SimRunContext` exactly as `lib/engine/simulator/runner.ts` does for a single run — concretely, mirror `runner.ts` ~lines 36–80: `const rng = mulberry32(config.seed)`, `const constants = resolveConstants()`, `const world = createSimWorld(config, constants)`, and copy the `SimRunContext` literal (the `const ctx: SimRunContext = { ... }` at runner.ts:80) verbatim. Run several ticks and assert building counts stay finite + non-negative through the build step:

```typescript
import { describe, it, expect } from "vitest";
import { resolveConstants } from "@/lib/engine/simulator/constants";
import { createSimWorld } from "@/lib/engine/simulator/world";
import { simulateWorldTick } from "@/lib/engine/simulator/economy";
// + the RNG + SimRunContext construction mirrored from lib/engine/simulator/runner.ts

describe("directed-build in the simulator tick", () => {
  it("runs the full tick (incl. directed-build) with finite, non-negative building counts", async () => {
    const constants = resolveConstants();
    const config = { seed: 42 }; // mirror the runner's small-run config shape
    const world = createSimWorld(config, constants);
    // const rng = ...; const ctx = ...;  // mirror runner.ts
    let w = world;
    for (let i = 0; i < 12; i++) {
      w = await simulateWorldTick(w, rng, ctx);
    }
    for (const s of w.systems) {
      for (const c of Object.values(s.buildings)) {
        expect(Number.isFinite(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
```

> The exact `config`, `rng`, and `ctx` construction must match `runner.ts` (do not invent a `SimRunContext` shape — copy the runner's). If `createSimWorld` needs a specific `SimConfig` (scale, etc.), use the same one the simulator's own tests / runner use.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit lib/engine/simulator/__tests__/directed-build-sim.test.ts`
Expected: FAIL — `simulateWorldTick` does not yet call `processSimDirectedBuild` (the test imports compile, but the build step is unwired; the test fails to drive any build, and if you assert build activity it fails. At minimum the file fails until the wiring import resolves). Capture the failure.

- [ ] **Step 3: Add `processSimDirectedBuild` and wire it in**

In `lib/engine/simulator/economy.ts`:

Add imports (next to the existing directed-logistics imports):

```typescript
import { MemoryDirectedBuildWorld } from "@/lib/tick/adapters/memory/directed-build";
import { runDirectedBuildProcessor } from "@/lib/tick/processors/directed-build";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
```

(`computeBoundedHopDistances`, `RouteCost`, `SimWorld`, `SimConstants` are already imported for directed-logistics — reuse them.)

Add the processor function (place it right after `processSimDirectedLogistics`):

```typescript
async function processSimDirectedBuild(
  world: SimWorld,
  constants: SimConstants,
): Promise<SimWorld> {
  // Group markets by systemId for row construction (same as directed-logistics).
  const marketsBySystem = new Map<string, typeof world.markets>();
  for (const m of world.markets) {
    const list = marketsBySystem.get(m.systemId) ?? [];
    list.push(m);
    marketsBySystem.set(m.systemId, list);
  }

  const rows = world.systems.map((s) => ({
    systemId: s.id,
    factionId: s.factionId,
    population: s.population,
    buildings: s.buildings,
    yields: s.yields,
    slotCap: s.slotCap,
    generalSpace: s.generalSpace,
    habitableSpace: s.habitableSpace,
    markets: (marketsBySystem.get(s.id) ?? []).map((m) => ({
      id: `${m.systemId}|${m.goodId}`,
      goodId: m.goodId,
      stock: m.stock,
      basePrice: m.basePrice,
      anchorMult: m.anchorMult,
      demandRate: m.demandRate,
      priceFloor: m.priceFloor,
      priceCeiling: m.priceCeiling,
      storageCapacity: m.storageCapacity,
    })),
  }));

  const hops = computeBoundedHopDistances(world.connections, DIRECTED_BUILD.MAX_HOPS);
  const routeCost: RouteCost = (f, t) => {
    const h = hops.get(f)?.get(t);
    return h === undefined || h > DIRECTED_BUILD.MAX_HOPS ? null : h * DIRECTED_BUILD.HOP_WEIGHT;
  };

  const dbWorld = new MemoryDirectedBuildWorld(rows);

  // Live INTERVAL = 2 × economy clock; preserve that relationship under sim overrides.
  await runDirectedBuildProcessor(dbWorld, { tick: world.tick }, {
    interval: 2 * constants.economy.interval,
    routeCost,
  });

  if (dbWorld.buildingUpdates.length === 0) return world;

  // Write captured absolute building counts back into the sim systems.
  const countsBySystem = new Map<string, Map<string, number>>();
  for (const u of dbWorld.buildingUpdates) {
    const byType = countsBySystem.get(u.systemId) ?? new Map<string, number>();
    byType.set(u.buildingType, u.count);
    countsBySystem.set(u.systemId, byType);
  }
  const updatedSystems = world.systems.map((s) => {
    const byType = countsBySystem.get(s.id);
    if (!byType) return s;
    const buildings = { ...s.buildings };
    for (const [type, count] of byType) buildings[type] = count;
    return { ...s, buildings };
  });

  return { ...world, systems: updatedSystems };
}
```

Then wire it into `simulateWorldTick`, immediately after the directed-logistics line:

```typescript
  w = await processSimDirectedLogistics(w, ctx.constants);
  w = await processSimDirectedBuild(w, ctx.constants);
  return w;
```

Update the `simulateWorldTick` doc-comment pipeline list to append `→ directed build`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit lib/engine/simulator/__tests__/directed-build-sim.test.ts`
Expected: PASS — the wired tick runs and all building counts are finite + non-negative.

- [ ] **Step 5: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Simulator smoke (validation)**

Run: `npm run simulate` (seed 42, 500 ticks, default scale).
Expected: completes without error; no `NaN`/`Infinity` in the reported metrics; population/decay/collapsed stay in a sane range (no runaway). Record the headline numbers in the task report.

> Expectation to record, not a failure: against the **current mature seed**, the build processor may be near-inert — most systems are already built out, so few structural deficits with buildable capacity exist (the same way directed-logistics was modest on the mature seed). The macro demonstration ("age a *minimal* seed forward into a coherent mature galaxy") needs the **minimal-core seeder + age-forward harness**, which are the next plans. This task's bar is: the mechanism is wired, runs cleanly in the pipeline, and the deterministic develops-a-hand-seeded-world behaviour is proven by the Task 4 unit tests. If `npm run simulate` shows any NaN/runaway, that IS a failure — stop and report.

- [ ] **Step 7: Commit**

```bash
git add lib/engine/simulator/economy.ts lib/engine/simulator/__tests__/directed-build-sim.test.ts
git commit -m "feat(sim): wire directed-build into the simulator tick"
```

---

## What this plan deliberately defers (follow-on plans)

- **Live Prisma adapter** (`PrismaDirectedBuildWorld`: reads of body-derived `slotCap`/`generalSpace`/`habitableSpace` from the live schema, `GREATEST()`/`unnest` building-count increment writes) **+ the `directedBuildProcessor: TickProcessor` const + registry registration** — needs a short body-capacity-read exploration of the live schema first; the *next* plan. (That plan also decides whether building-count writes need a clamp/precision policy on the live `Float` columns.)
- **Minimal-core seeder** (shrink the seeder to a few self-sufficient subsistence cores per faction + inert frontier) — the plan that makes the sim macro-validation meaningful.
- **Age-forward snapshot harness** (run the full agency stack N-thousand ticks, snapshot the matured state back as the canonical seed) + the **validation pass** — design-doc Phases after the seeder.
- **Display-only Industry-tab direction cue** (developing/stable/declining from building-count trend) — UI, deferred; no construction queue (count is a continuous Float).

## Self-Review

- **Spec coverage:** Implements the build-engine plan's deferred "processor body + World interface + in-memory adapter + simulator wiring" item, plus the "Phase-1 sim validation (build alone develops a hand-seeded world)" — the deterministic develops-a-world demonstration lives in Task 4's multi-cycle test (cheap, fixture-controlled), and Task 5 proves the wired pipeline runs cleanly + adds the `npm run simulate` smoke. The capacity gap (SimSystem dropping `slotCap`/`generalSpace`/`habitableSpace`) is closed in Task 2. The shared market-state derivation is extracted once (Task 1), mirroring the engine plan's `classifyMarketState` extraction, so logistics and build read markets identically (DRY).
- **Placeholder scan:** Tasks 1–4 carry complete code + exact commands. Task 2's test and Task 5's test reuse the file's/​runner's existing world construction (the construction exists in-repo); the implementer copies it rather than inventing fixtures — the only two "mirror the existing setup" instructions, both pointing at concrete existing code.
- **Type consistency:** `SystemBuildRow`/`BuildBuildingUpdate`/`DirectedBuildWorld` defined in Task 3 and consumed unchanged in Tasks 4–5; `toGoodMarketStates`/`MarketStateSource` defined in Task 1 and consumed in Task 4; `runDirectedBuildProcessor`/`DirectedBuildProcessorParams` defined in Task 4 and consumed in Task 5. `BuildSystemState`/`PlannedBuild`/`RouteCost` come from the shipped engine unchanged. The processor body imports no Prisma adapter (stays prisma-free / unit-loadable), and the live `TickProcessor` const is explicitly deferred.
- **Purity:** Task 1 helper, Task 3 world+adapter, and Task 4 body import only prisma-free modules (engine/constants/shard/types) — they load under the `unit` project with `DATABASE_URL` unset. Task 5 touches the simulator (already prisma-free).
