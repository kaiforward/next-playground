# SP5 Directed Logistics — Phase 1 Implementation Plan (engine + budget + silent bulk moves)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Each agency cycle (48 ticks), per faction, greedy-match surplus→deficit goods and move the
matched volume **silently** (market stock deltas + `TradeFlow` rows tagged `logistics`), bounded by a
population-scaled logistics work-budget — so the decay-only ratchet starts to bend for the suppliable
middle. **No Contracts, no UI** (those are Phases 2–4).

**Architecture:** A pure, DB-free matching **engine** (`lib/engine/directed-logistics.ts`) that takes
pre-computed per-system supply/demand/band numbers + a route-cost function and returns `PlannedTransfer[]`.
A **processor** (typed `World` interface · Prisma adapter · in-memory adapter · pure body, per
`docs/active/engineering/processor-architecture.md`) loads state, computes generation + total demand +
bands, **shards per-faction**, calls the engine, and applies the moves. Mirrors the existing `tradeFlow`
processor trio.

**Tech Stack:** TypeScript 5 (strict), Prisma 7 + `@prisma/adapter-pg` (PostgreSQL), Vitest 4. Source of
truth design: `docs/plans/sp5-autonomic-logistics.md`.

## Global Constraints

- **No `as` casts** except `as const` and inside `lib/types/guards.ts`. Fix types at the source.
- **No `unknown` / `Record<string, unknown>`** anywhere. Use typed maps/unions.
- **Engine is pure** — `lib/engine/**` has zero DB imports; never statically import `@/lib/prisma` into a
  unit-tested module graph (the `unit` Vitest project sets no `DATABASE_URL` and `lib/prisma.ts` throws at
  load). Prisma-tainted deps go in adapters only.
- **Prisma 7:** `$transaction` already wraps the tick; batch writes (`createMany` / `unnest` UPDATE), never
  per-iteration writes. Guard `NaN`/`Infinity` before any raw SQL. Tick counter + Int columns max ~2.1B.
- **Cadence:** `LOGISTICS_INTERVAL = 2 × ECONOMY_UPDATE_INTERVAL = 48`. Use `shardRange` /
  `catchUpFactor` from `lib/tick/shard.ts`. Reference interval is 24, so `catchUpFactor(48) = 2`.
- **Discriminated unions** for any result types; `{ ok: true; … } | { ok: false; … }`.
- Run unit tests with `unset DATABASE_URL; npx vitest run --project unit <path>` to catch prisma-taint.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/constants/directed-logistics.ts` | **Create.** Cadence, budget coefficient, band margins, hop budget, hop/fuel cost weights. |
| `lib/engine/directed-logistics.ts` | **Create.** Pure: `systemLogisticsGeneration`, deficit/surplus classification, `matchFactionTransfers`. Zero DB. |
| `lib/engine/__tests__/directed-logistics.test.ts` | **Create.** Unit tests for the engine. |
| `prisma/schema.prisma` | **Modify.** Add `TradeFlow.flowType String @default("market")`. |
| `lib/tick/world/directed-logistics-world.ts` | **Create.** `DirectedLogisticsWorld` interface + data types. |
| `lib/tick/adapters/memory/directed-logistics.ts` | **Create.** In-memory adapter (sim + processor tests). |
| `lib/tick/adapters/prisma/directed-logistics.ts` | **Create.** Prisma adapter. |
| `lib/tick/processors/directed-logistics.ts` | **Create.** Pure body `runDirectedLogisticsProcessor` + `directedLogisticsProcessor` wiring. |
| `lib/tick/processors/__tests__/directed-logistics.test.ts` | **Create.** Processor-body tests via memory adapter. |
| `lib/tick/registry.ts` | **Modify.** Register `directedLogisticsProcessor`. |

---

## Task 1: Constants + budget generation (pure)

**Files:**
- Create: `lib/constants/directed-logistics.ts`
- Create: `lib/engine/directed-logistics.ts`
- Test: `lib/engine/__tests__/directed-logistics.test.ts`

**Interfaces:**
- Produces: `systemLogisticsGeneration(population: number): number` — this system's per-cycle work-budget
  contribution. `DIRECTED_LOGISTICS` constants object.

- [ ] **Step 1: Write the constants file**

```ts
// lib/constants/directed-logistics.ts
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";

/**
 * Directed-logistics tuning. First-draft, simulator-calibrated; only relative shape matters.
 * See docs/plans/sp5-autonomic-logistics.md.
 */
export const DIRECTED_LOGISTICS = {
  /** Ticks for the per-faction shard to sweep every faction once (2× the economy clock). */
  INTERVAL: 2 * ECONOMY_UPDATE_INTERVAL,
  /** Work-budget a system contributes per cycle = population × this. Free in v1 (no treasury). */
  GENERATION_PER_POP: 0.5,
  /** A good is a surplus when stock ≥ maxStock × this (export-pinned). */
  SURPLUS_FRACTION: 0.9,
  /** A good is a deficit when stock < minStock × this (below the reserve floor). */
  DEFICIT_FRACTION: 1.0,
  /** Max hops a logistics transfer may span (beyond this, route cost is treated as unreachable). */
  MAX_HOPS: 4,
  /** Per-unit route cost = quantity × (hops × HOP_WEIGHT + totalFuelCost × FUEL_WEIGHT). */
  HOP_WEIGHT: 1.0,
  FUEL_WEIGHT: 0.1,
} as const;
```

- [ ] **Step 2: Write the failing test**

```ts
// lib/engine/__tests__/directed-logistics.test.ts
import { describe, it, expect } from "vitest";
import { systemLogisticsGeneration } from "@/lib/engine/directed-logistics";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

describe("systemLogisticsGeneration", () => {
  it("scales linearly with population", () => {
    expect(systemLogisticsGeneration(100)).toBeCloseTo(100 * DIRECTED_LOGISTICS.GENERATION_PER_POP);
  });
  it("never negative (clamps negative population to 0)", () => {
    expect(systemLogisticsGeneration(-5)).toBe(0);
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/__tests__/directed-logistics.test.ts`
Expected: FAIL — `systemLogisticsGeneration` is not exported / module not found.

- [ ] **Step 4: Write the minimal implementation**

```ts
// lib/engine/directed-logistics.ts
/**
 * Pure directed-logistics matching — zero DB dependency. The processor computes
 * per-system supply/demand/band numbers (reusing capacityGoodRates / inputDemandForGood /
 * marketBandForRow) and a route-cost function; this engine just classifies and matches.
 * See docs/plans/sp5-autonomic-logistics.md.
 */
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

/** This system's per-cycle logistics work-budget contribution (free, population-scaled in v1). */
export function systemLogisticsGeneration(population: number): number {
  return Math.max(0, population) * DIRECTED_LOGISTICS.GENERATION_PER_POP;
}
```

- [ ] **Step 5: Run it, verify it passes**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/__tests__/directed-logistics.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/constants/directed-logistics.ts lib/engine/directed-logistics.ts lib/engine/__tests__/directed-logistics.test.ts
git commit -m "feat(logistics): logistics-budget generation primitive + constants"
```

---

## Task 2: Deficit/surplus classification + greedy matching engine (pure)

**Files:**
- Modify: `lib/engine/directed-logistics.ts`
- Test: `lib/engine/__tests__/directed-logistics.test.ts`

**Interfaces:**
- Consumes: `systemLogisticsGeneration` (Task 1).
- Produces:
  - `GoodMarketState = { goodId: string; stock: number; minStock: number; maxStock: number; demand: number }`
  - `SystemLogisticsState = { systemId: string; factionId: string | null; generation: number; goods: GoodMarketState[] }`
  - `PlannedTransfer = { goodId: string; fromSystemId: string; toSystemId: string; quantity: number; cost: number }`
  - `RouteCost = (fromSystemId: string, toSystemId: string) => number | null` (per-unit cost; `null` = unreachable / beyond hop budget)
  - `matchFactionTransfers(systems: SystemLogisticsState[], routeCost: RouteCost): PlannedTransfer[]`
    — `systems` are all members of ONE faction (or all independents). Budget = Σ generation.

- [ ] **Step 1: Write the failing tests**

```ts
// append to lib/engine/__tests__/directed-logistics.test.ts
import {
  matchFactionTransfers,
  type SystemLogisticsState,
  type RouteCost,
} from "@/lib/engine/directed-logistics";

// Helper: a system with one good's market state.
function sys(
  systemId: string,
  generation: number,
  good: { goodId: string; stock: number; minStock: number; maxStock: number; demand: number },
): SystemLogisticsState {
  return { systemId, factionId: "f1", generation, goods: [good] };
}

// Unit cost = hops; 1 hop between any two systems, unreachable for "far".
const oneHop: RouteCost = (_from, to) => (to === "far" ? null : 1);

describe("matchFactionTransfers", () => {
  it("moves drawable surplus to a below-floor deficit", () => {
    const surplus = sys("A", 100, { goodId: "food", stock: 100, minStock: 10, maxStock: 100, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 2, minStock: 10, maxStock: 100, demand: 5 });
    const transfers = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ goodId: "food", fromSystemId: "A", toSystemId: "B" });
    // shortfall = minStock - stock = 8; drawable = stock - minStock = 90; budget = 100/1 → 8 wins
    expect(transfers[0].quantity).toBe(8);
    expect(transfers[0].cost).toBe(8); // quantity × 1 hop
  });

  it("never draws a source below its own floor", () => {
    const surplus = sys("A", 100, { goodId: "food", stock: 12, minStock: 10, maxStock: 100, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, minStock: 10, maxStock: 100, demand: 5 });
    const transfers = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers[0].quantity).toBe(2); // drawable = 12 - 10
  });

  it("is bounded by the faction budget (under-serves, leaving residual)", () => {
    const surplus = sys("A", 3, { goodId: "food", stock: 100, minStock: 10, maxStock: 100, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, minStock: 10, maxStock: 100, demand: 5 });
    // budget = 3 (only A generates), cost 1/unit → at most 3 moved despite a shortfall of 10
    const transfers = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers[0].quantity).toBe(3);
  });

  it("ranks the most severe deficit first when budget is scarce", () => {
    const surplus = sys("A", 5, { goodId: "food", stock: 100, minStock: 10, maxStock: 100, demand: 1 });
    // B mild (demand 1), C severe (demand 10) — C should be served first.
    const mild = sys("B", 0, { goodId: "food", stock: 5, minStock: 10, maxStock: 100, demand: 1 });
    const severe = sys("C", 0, { goodId: "food", stock: 5, minStock: 10, maxStock: 100, demand: 10 });
    const transfers = matchFactionTransfers([surplus, mild, severe], oneHop);
    expect(transfers[0].toSystemId).toBe("C");
  });

  it("skips unreachable deficits (route cost null)", () => {
    const surplus = sys("A", 100, { goodId: "food", stock: 100, minStock: 10, maxStock: 100, demand: 5 });
    const deficit = sys("far", 0, { goodId: "food", stock: 0, minStock: 10, maxStock: 100, demand: 5 });
    expect(matchFactionTransfers([surplus, deficit], oneHop)).toHaveLength(0);
  });

  it("ignores goods that are neither surplus nor deficit", () => {
    const a = sys("A", 100, { goodId: "food", stock: 50, minStock: 10, maxStock: 100, demand: 5 });
    const b = sys("B", 0, { goodId: "food", stock: 50, minStock: 10, maxStock: 100, demand: 5 });
    expect(matchFactionTransfers([a, b], oneHop)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/__tests__/directed-logistics.test.ts`
Expected: FAIL — `matchFactionTransfers` not exported.

- [ ] **Step 3: Implement the engine**

```ts
// append to lib/engine/directed-logistics.ts
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics"; // already imported at top

export interface GoodMarketState {
  goodId: string;
  stock: number;
  minStock: number;
  maxStock: number;
  /** Total local demand rate (civilian + industrial). Severity weight only. */
  demand: number;
}

export interface SystemLogisticsState {
  systemId: string;
  factionId: string | null;
  generation: number;
  goods: GoodMarketState[];
}

export interface PlannedTransfer {
  goodId: string;
  fromSystemId: string;
  toSystemId: string;
  quantity: number;
  cost: number;
}

/** Per-unit route cost between two systems; null = unreachable / beyond hop budget. */
export type RouteCost = (fromSystemId: string, toSystemId: string) => number | null;

interface Deficit { systemId: string; goodId: string; shortfall: number; severity: number; }
interface Surplus { systemId: string; goodId: string; drawable: number; }

/**
 * Greedy surplus→deficit matching for ONE faction's systems (or all independents).
 * Budget = Σ system.generation, spent as quantity × routeCost. Worst-deficit-first;
 * nearest reachable surplus first. Stops when budget is exhausted → deliberate under-serve.
 */
export function matchFactionTransfers(
  systems: SystemLogisticsState[],
  routeCost: RouteCost,
): PlannedTransfer[] {
  let budget = 0;
  for (const s of systems) budget += s.generation;
  if (budget <= 0) return [];

  // Classify each (system, good) as deficit or surplus. Mutable drawable/stock-shortfall as we allocate.
  const deficits: Deficit[] = [];
  const surplusesByGood = new Map<string, Surplus[]>();

  for (const s of systems) {
    for (const g of s.goods) {
      if (g.stock < g.minStock * DIRECTED_LOGISTICS.DEFICIT_FRACTION) {
        const shortfall = g.minStock - g.stock;
        if (shortfall > 0) {
          deficits.push({ systemId: s.systemId, goodId: g.goodId, shortfall, severity: shortfall * g.demand });
        }
      } else if (g.stock >= g.maxStock * DIRECTED_LOGISTICS.SURPLUS_FRACTION) {
        const drawable = g.stock - g.minStock;
        if (drawable > 0) {
          const list = surplusesByGood.get(g.goodId) ?? [];
          list.push({ systemId: s.systemId, goodId: g.goodId, drawable });
          surplusesByGood.set(g.goodId, list);
        }
      }
    }
  }

  deficits.sort((a, b) => b.severity - a.severity);

  const transfers: PlannedTransfer[] = [];
  for (const d of deficits) {
    if (budget <= 0) break;
    const sources = surplusesByGood.get(d.goodId);
    if (!sources) continue;

    // Nearest reachable source first.
    let best: { source: Surplus; perUnit: number } | null = null;
    for (const source of sources) {
      if (source.drawable <= 0) continue;
      const perUnit = routeCost(source.systemId, d.systemId);
      if (perUnit === null || perUnit <= 0) continue;
      if (!best || perUnit < best.perUnit) best = { source, perUnit };
    }
    if (!best) continue;

    const affordable = Math.floor(budget / best.perUnit);
    const quantity = Math.min(d.shortfall, best.source.drawable, affordable);
    if (quantity <= 0) continue;

    const cost = quantity * best.perUnit;
    transfers.push({
      goodId: d.goodId,
      fromSystemId: best.source.systemId,
      toSystemId: d.systemId,
      quantity,
      cost,
    });
    best.source.drawable -= quantity;
    budget -= cost;
  }

  return transfers;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/__tests__/directed-logistics.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/directed-logistics.ts lib/engine/__tests__/directed-logistics.test.ts
git commit -m "feat(logistics): greedy surplus→deficit matching engine"
```

---

## Task 3: Schema — `TradeFlow.flowType`

**Files:**
- Modify: `prisma/schema.prisma` (the `TradeFlow` model, ~line 404)

**Interfaces:**
- Produces: `TradeFlow.flowType` column (`"market"` | `"logistics"`), default `"market"`.

- [ ] **Step 1: Add the field**

In `model TradeFlow`, add after `quantity Int`:

```prisma
  flowType     String @default("market") // "market" (diffusion) | "logistics" (directed)
```

- [ ] **Step 2: Push the schema**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema." and the client regenerates.

- [ ] **Step 3: Verify the client typed the field**

Run: `npx tsc --noEmit`
Expected: no errors (existing `TradeFlow` inserts still compile — the field has a default).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma app/generated/prisma
git commit -m "feat(logistics): add TradeFlow.flowType discriminator (market|logistics)"
```

---

## Task 4: `DirectedLogisticsWorld` interface + in-memory adapter

**Files:**
- Create: `lib/tick/world/directed-logistics-world.ts`
- Create: `lib/tick/adapters/memory/directed-logistics.ts`

**Interfaces:**
- Consumes: engine types (Task 2).
- Produces:
  - `SystemLogisticsRow` (raw per-system state the adapter returns) +
    `MarketRowForLogistics` (per-good band inputs).
  - `LogisticsMarketUpdate = { id: string; stock: number }`, `LogisticsFlowInsert` (= `TradeFlow` insert with `flowType`).
  - `DirectedLogisticsWorld` interface.
  - `MemoryDirectedLogisticsWorld` class (constructed from plain arrays for tests/sim).

- [ ] **Step 1: Write the world interface**

```ts
// lib/tick/world/directed-logistics-world.ts
/**
 * DirectedLogisticsWorld — data interface for the directed-logistics processor.
 * Adapters in lib/tick/adapters/{prisma,memory}/directed-logistics.ts implement it.
 * Sharding is PER-FACTION (matching needs all of a faction's systems at once), so the
 * adapter returns whole-faction system groups for the faction shard due this tick.
 */
import type { ResourceVector } from "@/lib/types/game";

/** One market's raw band inputs (mirrors the fields marketBandForRow consumes). */
export interface MarketRowForLogistics {
  id: string;
  goodId: string;
  stock: number;
  basePrice: number;
  anchorMult: number;
  demandRate: number;
  priceFloor: number;
  priceCeiling: number;
  storageCapacity: number;
}

/** One system's logistics-relevant state. */
export interface SystemLogisticsRow {
  systemId: string;
  factionId: string | null;
  population: number;
  buildings: Record<string, number>;
  /** Per-resource effective yields, for inputDemandForGood / capacityGoodRates. */
  yields: ResourceVector;
  markets: MarketRowForLogistics[];
}

export interface LogisticsMarketUpdate { id: string; stock: number; }

export interface LogisticsFlowInsert {
  tick: number;
  fromSystemId: string;
  toSystemId: string;
  goodId: string;
  quantity: number;
}

export interface DirectedLogisticsWorld {
  /** Total distinct faction groups (incl. one null/independents group) — drives the shard split. */
  getFactionShardKeys(): Promise<Array<string | null>>;
  /** All systems (with markets) belonging to the given faction keys. */
  getSystemsForFactions(factionKeys: Array<string | null>): Promise<SystemLogisticsRow[]>;
  /** Map good KEY → DB good id (TradeFlow/market rows key differ from good KEY). */
  resolveGoodIds(): Promise<Map<string, string>>;
  /** Bulk absolute stock writes (already clamped). */
  applyMarketUpdates(updates: LogisticsMarketUpdate[]): Promise<void>;
  /** Append directed-logistics flow rows (flowType = "logistics"). */
  appendLogisticsFlows(flows: LogisticsFlowInsert[]): Promise<void>;
}
```

- [ ] **Step 2: Write a failing test for the memory adapter**

```ts
// lib/tick/processors/__tests__/directed-logistics.test.ts
import { describe, it, expect } from "vitest";
import { MemoryDirectedLogisticsWorld } from "@/lib/tick/adapters/memory/directed-logistics";
import { emptyResourceVector } from "@/lib/engine/resources";

describe("MemoryDirectedLogisticsWorld", () => {
  it("groups systems by faction key (null = independents)", async () => {
    const world = new MemoryDirectedLogisticsWorld([
      { systemId: "A", factionId: "f1", population: 10, buildings: {}, yields: emptyResourceVector(), markets: [] },
      { systemId: "B", factionId: null, population: 5, buildings: {}, yields: emptyResourceVector(), markets: [] },
    ]);
    const keys = await world.getFactionShardKeys();
    expect(new Set(keys)).toEqual(new Set(["f1", null]));
    const f1 = await world.getSystemsForFactions(["f1"]);
    expect(f1.map((s) => s.systemId)).toEqual(["A"]);
  });

  it("applies stock updates and records flows", async () => {
    const world = new MemoryDirectedLogisticsWorld([]);
    await world.applyMarketUpdates([{ id: "m1", stock: 42 }]);
    await world.appendLogisticsFlows([{ tick: 1, fromSystemId: "A", toSystemId: "B", goodId: "g", quantity: 8 }]);
    expect(world.stockUpdates.get("m1")).toBe(42);
    expect(world.flows).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/tick/processors/__tests__/directed-logistics.test.ts`
Expected: FAIL — `MemoryDirectedLogisticsWorld` not found.

- [ ] **Step 4: Implement the memory adapter**

```ts
// lib/tick/adapters/memory/directed-logistics.ts
import type {
  DirectedLogisticsWorld,
  SystemLogisticsRow,
  LogisticsMarketUpdate,
  LogisticsFlowInsert,
} from "@/lib/tick/world/directed-logistics-world";

/** In-memory DirectedLogisticsWorld for unit tests + the simulator. Captures writes for assertions. */
export class MemoryDirectedLogisticsWorld implements DirectedLogisticsWorld {
  readonly stockUpdates = new Map<string, number>();
  readonly flows: LogisticsFlowInsert[] = [];

  constructor(
    private readonly systems: SystemLogisticsRow[],
    private readonly goodIdByKey: Map<string, string> = new Map(),
  ) {}

  async getFactionShardKeys(): Promise<Array<string | null>> {
    const seen = new Set<string | null>();
    for (const s of this.systems) seen.add(s.factionId);
    return [...seen];
  }

  async getSystemsForFactions(factionKeys: Array<string | null>): Promise<SystemLogisticsRow[]> {
    const set = new Set(factionKeys);
    return this.systems.filter((s) => set.has(s.factionId));
  }

  async resolveGoodIds(): Promise<Map<string, string>> {
    return this.goodIdByKey;
  }

  async applyMarketUpdates(updates: LogisticsMarketUpdate[]): Promise<void> {
    for (const u of updates) this.stockUpdates.set(u.id, u.stock);
  }

  async appendLogisticsFlows(flows: LogisticsFlowInsert[]): Promise<void> {
    this.flows.push(...flows);
  }
}
```

- [ ] **Step 5: Run, verify pass**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/tick/processors/__tests__/directed-logistics.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/tick/world/directed-logistics-world.ts lib/tick/adapters/memory/directed-logistics.ts lib/tick/processors/__tests__/directed-logistics.test.ts
git commit -m "feat(logistics): DirectedLogisticsWorld interface + in-memory adapter"
```

---

## Task 5: Processor body (pure) — state → match → silent moves

**Files:**
- Create: `lib/tick/processors/directed-logistics.ts` (body only this task; wiring in Task 7)
- Test: `lib/tick/processors/__tests__/directed-logistics.test.ts` (append)

**Interfaces:**
- Consumes: `matchFactionTransfers`, `systemLogisticsGeneration` (engine); `DirectedLogisticsWorld` + types;
  `shardRange`, `catchUpFactor`; `marketBandForRow` (`@/lib/engine/market-pricing`); `capacityGoodRates`,
  `inputDemandForGood`, `labourDemand`, `labourFulfillment` (`@/lib/engine/industry`);
  `loadHopDistances` is **not** used here (route cost is injected — see below); `GOOD_NAME_TO_KEY` /
  `GOOD_CONSUMPTION` as needed.
- Produces: `runDirectedLogisticsProcessor(world, ctx, params)` where
  `params = { interval: number; routeCost: (fromId, toId) => number | null }`.

> **Why route cost is injected:** hop/fuel distances come from the cached `hop-distances` service (a
> prisma-tainted singleton). Keeping it a param means the body stays unit-testable with a fake, and the
> live wiring (Task 7) supplies the real cached lookup. The body multiplies per-unit cost by quantity
> inside the engine; here we just build the per-unit `routeCost` closure from a distance map in wiring.

- [ ] **Step 1: Write the failing body test**

```ts
// append to lib/tick/processors/__tests__/directed-logistics.test.ts
import { runDirectedLogisticsProcessor } from "@/lib/tick/processors/directed-logistics";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

function market(id: string, goodId: string, stock: number, storageCapacity: number) {
  // basePrice/floor/ceiling/demandRate chosen so marketBandForRow yields min≈10%, max≈storageCapacity.
  return { id, goodId, stock, basePrice: 100, anchorMult: 1, demandRate: 5, priceFloor: 50, priceCeiling: 200, storageCapacity };
}

describe("runDirectedLogisticsProcessor (body)", () => {
  it("moves staple surplus to a deficit system and records a logistics flow", async () => {
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: { food: 5 }, yields: emptyResourceVector(),
        markets: [market("mA", "food", 95, 100)] },        // export-pinned surplus
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(),
        markets: [market("mB", "food", 1, 100)] },          // below floor
    ];
    const world = new MemoryDirectedLogisticsWorld(systems, new Map([["food", "good-food"]]));
    // single faction f1 → its shard runs on tick 0 when interval covers 1 group
    await runDirectedLogisticsProcessor(world, { tick: 0 }, {
      interval: DIRECTED_LOGISTICS.INTERVAL,
      routeCost: () => 1,
    });
    expect(world.flows).toHaveLength(1);
    expect(world.flows[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B", goodId: "good-food" });
    expect(world.flows[0].quantity).toBeGreaterThan(0);
    // both market stocks were written (source down, dest up)
    expect(world.stockUpdates.has("mA")).toBe(true);
    expect(world.stockUpdates.has("mB")).toBe(true);
  });

  it("does nothing when no faction shard is due this tick", async () => {
    const world = new MemoryDirectedLogisticsWorld([], new Map());
    await runDirectedLogisticsProcessor(world, { tick: 7 }, { interval: DIRECTED_LOGISTICS.INTERVAL, routeCost: () => 1 });
    expect(world.flows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/tick/processors/__tests__/directed-logistics.test.ts`
Expected: FAIL — `runDirectedLogisticsProcessor` not found.

- [ ] **Step 3: Implement the body**

```ts
// lib/tick/processors/directed-logistics.ts
import type { TickContext, TickProcessor, TickProcessorResult } from "../types";
import { shardRange, catchUpFactor } from "@/lib/tick/shard";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import {
  capacityGoodRates, inputDemandForGood, labourDemand, labourFulfillment,
} from "@/lib/engine/industry";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import {
  matchFactionTransfers, systemLogisticsGeneration,
  type SystemLogisticsState, type GoodMarketState, type PlannedTransfer, type RouteCost,
} from "@/lib/engine/directed-logistics";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import type {
  DirectedLogisticsWorld, SystemLogisticsRow, MarketRowForLogistics,
  LogisticsMarketUpdate, LogisticsFlowInsert,
} from "@/lib/tick/world/directed-logistics-world";

export interface DirectedLogisticsProcessorParams {
  interval: number;
  /** Per-unit route cost between two systems; null = unreachable / beyond hop budget. */
  routeCost: RouteCost;
}

/** Build the engine's per-system state from raw rows: generation + per-good band + total demand. */
function toLogisticsState(row: SystemLogisticsRow): SystemLogisticsState {
  const fulfillment = labourFulfillment(row.population, labourDemand(row.buildings));
  const rates = capacityGoodRates(row.buildings, row.population, row.yields); // civ consumption + production
  const consByKey = new Map(rates.map((r) => [r.goodId, r.consumption]));

  const goods: GoodMarketState[] = [];
  for (const m of row.markets) {
    const goodKey = GOOD_NAME_TO_KEY[m.goodId] ?? m.goodId;
    const band = marketBandForRow(m, m); // { minStock, maxStock } — same call shape as trade-flow.ts
    const civ = consByKey.get(goodKey) ?? 0;
    const industrial = inputDemandForGood(row.buildings, goodKey, fulfillment, row.yields);
    goods.push({
      goodId: m.goodId,
      stock: m.stock,
      minStock: band.minStock,
      maxStock: band.maxStock,
      demand: civ + industrial,
    });
  }
  return {
    systemId: row.systemId,
    factionId: row.factionId,
    generation: systemLogisticsGeneration(row.population),
    goods,
  };
}

/**
 * Pure body. PER-FACTION shard: a contiguous window of the stable faction-key order runs each tick,
 * so every faction is matched once per `interval` ticks. Matched volume is moved silently (stock
 * deltas + logistics flow rows). The catch-up factor scales moved volume to wall-clock at any interval.
 */
export async function runDirectedLogisticsProcessor(
  world: DirectedLogisticsWorld,
  ctx: TickContext,
  params: DirectedLogisticsProcessorParams,
): Promise<TickProcessorResult> {
  const factionKeys = await world.getFactionShardKeys();
  if (factionKeys.length === 0) return {};

  const { start, end } = shardRange(factionKeys.length, ctx.tick, params.interval);
  const dueKeys = factionKeys.slice(start, end);
  if (dueKeys.length === 0) return {};

  const rows = await world.getSystemsForFactions(dueKeys);
  if (rows.length === 0) return {};
  const goodKeyToId = await world.resolveGoodIds();
  const catchUp = catchUpFactor(params.interval);

  // Group rows by faction key, build engine state, match each group.
  const byFaction = new Map<string | null, SystemLogisticsRow[]>();
  for (const r of rows) {
    const list = byFaction.get(r.factionId) ?? [];
    list.push(r);
    byFaction.set(r.factionId, list);
  }
  // Market id by (systemId|goodId) so we can write absolute clamped stock per transfer.
  const marketByKey = new Map<string, MarketRowForLogistics & { systemId: string; min: number; max: number }>();
  for (const r of rows) {
    for (const m of r.markets) {
      const band = marketBandForRow(m, m);
      marketByKey.set(`${r.systemId}|${m.goodId}`, { ...m, systemId: r.systemId, min: band.minStock, max: band.maxStock });
    }
  }

  const allTransfers: PlannedTransfer[] = [];
  for (const [, group] of byFaction) {
    const states = group.map(toLogisticsState);
    allTransfers.push(...matchFactionTransfers(states, params.routeCost));
  }

  // Apply: clamp both endpoints, accumulate absolute writes, record flow rows.
  const updates = new Map<string, number>();
  const flows: LogisticsFlowInsert[] = [];
  for (const t of allTransfers) {
    const qty = Math.floor(t.quantity * catchUp);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const from = marketByKey.get(`${t.fromSystemId}|${t.goodId}`);
    const to = marketByKey.get(`${t.toSystemId}|${t.goodId}`);
    if (!from || !to) continue;

    const fromCur = updates.get(from.id) ?? from.stock;
    const toCur = updates.get(to.id) ?? to.stock;
    const moved = Math.min(qty, Math.max(0, fromCur - from.min), Math.max(0, to.max - toCur));
    if (moved <= 0) continue;

    updates.set(from.id, fromCur - moved);
    updates.set(to.id, toCur + moved);
    const dbGoodId = goodKeyToId.get(GOOD_NAME_TO_KEY[t.goodId] ?? t.goodId) ?? t.goodId;
    flows.push({ tick: ctx.tick, fromSystemId: t.fromSystemId, toSystemId: t.toSystemId, goodId: dbGoodId, quantity: moved });
  }

  if (updates.size > 0) {
    const marketUpdates: LogisticsMarketUpdate[] = [...updates.entries()].map(([id, stock]) => ({ id, stock }));
    await world.applyMarketUpdates(marketUpdates);
  }
  if (flows.length > 0) await world.appendLogisticsFlows(flows);

  return {};
}
```

> **Note for the implementer:** the test's `market()` helper assumes `marketBandForRow(m, m)` returns a
> floor ~10% and a ceiling near `storageCapacity`. If the real `marketBandForRow` signature differs from
> the `marketBandForRow(row, row)` call in `lib/tick/processors/trade-flow.ts:124`, copy that exact call
> shape and adjust the helper's fixture numbers so `mA` lands ≥ `maxStock × SURPLUS_FRACTION` and `mB` <
> `minStock`. Read `lib/engine/market-pricing.ts` for the exact return shape before writing the fixture.

- [ ] **Step 4: Run, verify pass**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/tick/processors/__tests__/directed-logistics.test.ts`
Expected: PASS. (If the band fixture is off, adjust `market()` numbers per the note — do not change the body.)

- [ ] **Step 5: Commit**

```bash
git add lib/tick/processors/directed-logistics.ts lib/tick/processors/__tests__/directed-logistics.test.ts
git commit -m "feat(logistics): directed-logistics processor body (match → silent moves)"
```

---

## Task 6: Prisma adapter

**Files:**
- Create: `lib/tick/adapters/prisma/directed-logistics.ts`

**Interfaces:**
- Consumes: `DirectedLogisticsWorld` + types; the Prisma tx client; `marketBandForRow` is **not** needed
  here (the body computes bands).
- Produces: `PrismaDirectedLogisticsWorld` implementing `DirectedLogisticsWorld`.

> Mirror the query patterns in `lib/tick/adapters/prisma/trade-flow.ts`. Use
> `relationLoadStrategy: "join"` on any findMany that pulls multiple sibling relations (system →
> buildings + station.markets), per the CLAUDE.md pg-concurrency gotcha. Batch the writes.

- [ ] **Step 1: Implement the adapter**

```ts
// lib/tick/adapters/prisma/directed-logistics.ts
import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";
import type {
  DirectedLogisticsWorld, SystemLogisticsRow, LogisticsMarketUpdate, LogisticsFlowInsert,
} from "@/lib/tick/world/directed-logistics-world";
import { yieldsForSystem } from "@/lib/engine/substrate-space"; // effective yields from worked deposits
import { emptyResourceVector } from "@/lib/engine/resources";

type Tx = Prisma.TransactionClient | PrismaClient;

export class PrismaDirectedLogisticsWorld implements DirectedLogisticsWorld {
  constructor(private readonly tx: Tx) {}

  async getFactionShardKeys(): Promise<Array<string | null>> {
    const rows = await this.tx.starSystem.findMany({ distinct: ["factionId"], select: { factionId: true } });
    // Stable order so the shard split is deterministic across ticks; null sorts last.
    return rows
      .map((r) => r.factionId)
      .sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
  }

  async getSystemsForFactions(factionKeys: Array<string | null>): Promise<SystemLogisticsRow[]> {
    const ids = factionKeys.filter((k): k is string => k !== null);
    const includeNull = factionKeys.some((k) => k === null);
    const where: Prisma.StarSystemWhereInput =
      includeNull && ids.length > 0 ? { OR: [{ factionId: { in: ids } }, { factionId: null }] }
      : includeNull ? { factionId: null }
      : { factionId: { in: ids } };

    const systems = await this.tx.starSystem.findMany({
      where,
      relationLoadStrategy: "join",
      select: {
        id: true, factionId: true, population: true,
        buildings: { select: { buildingType: true, count: true } },
        station: { select: { markets: {
          select: {
            id: true, goodId: true, stock: true, anchorMult: true,
            demandRate: true, storageCapacity: true,
          },
        } } },
        // substrate columns yieldsForSystem needs (worked deposits / yields) — adjust to its real input:
        // see lib/engine/substrate-space.ts for the exact selection.
      },
    });

    return systems.map((s): SystemLogisticsRow => {
      const buildings: Record<string, number> = {};
      for (const b of s.buildings) buildings[b.buildingType] = b.count;
      const markets = (s.station?.markets ?? []).map((m) => ({
        id: m.id, goodId: m.goodId, stock: m.stock, basePrice: 0, anchorMult: m.anchorMult,
        demandRate: m.demandRate, priceFloor: 0, priceCeiling: 0, storageCapacity: m.storageCapacity,
      }));
      return {
        systemId: s.id, factionId: s.factionId, population: s.population, buildings,
        yields: emptyResourceVector(), // TODO-IMPLEMENTER: replace with yieldsForSystem(s) once its input shape is wired
        markets,
      };
    });
  }

  async resolveGoodIds(): Promise<Map<string, string>> {
    const goods = await this.tx.good.findMany({ select: { id: true, name: true } });
    // Map good KEY → id. Mirror PrismaTradeMissionsWorld.resolveGoodIds()'s name→key normalisation.
    const map = new Map<string, string>();
    for (const g of goods) map.set(g.name, g.id);
    return map;
  }

  async applyMarketUpdates(updates: LogisticsMarketUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    // Batch via unnest UPDATE (mirror economy.ts). Guard non-finite before raw SQL.
    const ids: string[] = [];
    const stocks: number[] = [];
    for (const u of updates) {
      if (!Number.isFinite(u.stock)) continue;
      ids.push(u.id); stocks.push(u.stock);
    }
    if (ids.length === 0) return;
    await this.tx.$executeRaw`
      UPDATE "StationMarket" AS sm
      SET "stock" = batch.stock
      FROM unnest(${ids}::text[], ${stocks}::double precision[]) AS batch(id, stock)
      WHERE sm."id" = batch.id`;
  }

  async appendLogisticsFlows(flows: LogisticsFlowInsert[]): Promise<void> {
    if (flows.length === 0) return;
    await this.tx.tradeFlow.createMany({
      data: flows.map((f) => ({
        tick: f.tick, fromSystemId: f.fromSystemId, toSystemId: f.toSystemId,
        goodId: f.goodId, quantity: f.quantity, flowType: "logistics",
      })),
    });
  }
}
```

> **Two implementer call-outs (resolve before wiring):**
> 1. **`basePrice`/`priceFloor`/`priceCeiling`** — `StationMarket` does not store these (they're derived).
>    Read how `lib/tick/adapters/prisma/trade-flow.ts` builds its `MarketSnapshot.basePrice/priceFloor/priceCeiling`
>    and replicate that derivation here so `marketBandForRow` gets real inputs. The `0` placeholders above
>    WILL break the band — do not ship them.
> 2. **`yields`** — wire `yieldsForSystem` (or the substrate-space equivalent) using the same substrate
>    columns `lib/engine/industry.ts` callers use. `emptyResourceVector()` is a stand-in only.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Adapter is not yet wired into the registry, so no runtime path exercises it.)

- [ ] **Step 3: Commit**

```bash
git add lib/tick/adapters/prisma/directed-logistics.ts
git commit -m "feat(logistics): prisma adapter for directed-logistics world"
```

---

## Task 7: Register the processor + live wiring + integration check

**Files:**
- Modify: `lib/tick/processors/directed-logistics.ts` (append the `TickProcessor` wiring)
- Modify: `lib/tick/registry.ts`
- Test: `lib/tick/processors/__tests__/integration/directed-logistics.integration.test.ts` (create)

**Interfaces:**
- Consumes: everything above; `loadHopDistances` (`@/lib/services/hop-distances`) for the real route cost.
- Produces: `directedLogisticsProcessor: TickProcessor` (name `"directed-logistics"`).

- [ ] **Step 1: Append the live wiring (builds the real route-cost closure)**

```ts
// append to lib/tick/processors/directed-logistics.ts
import { PrismaDirectedLogisticsWorld } from "@/lib/tick/adapters/prisma/directed-logistics";
import { loadHopDistances } from "@/lib/services/hop-distances";

export const directedLogisticsProcessor: TickProcessor = {
  name: "directed-logistics",
  frequency: 1, // per-faction shard inside the body
  dependsOn: ["economy"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaDirectedLogisticsWorld(ctx.tx);
    const hops = await loadHopDistances(); // Map<fromId, Map<toId, hopCount>>, cached
    const routeCost: RouteCost = (fromId, toId) => {
      const h = hops.get(fromId)?.get(toId);
      if (h === undefined || h > DIRECTED_LOGISTICS.MAX_HOPS) return null;
      // Per-unit cost: hop term + (fuel term folded via hop count proxy until per-route fuel is wired).
      return h * DIRECTED_LOGISTICS.HOP_WEIGHT;
    };
    return runDirectedLogisticsProcessor(world, ctx, {
      interval: DIRECTED_LOGISTICS.INTERVAL,
      routeCost,
    });
  },
};
```

> **Implementer note on fuel:** `loadHopDistances` returns hop counts (bounded). The work-unit design is
> hop + fuel; for Phase 1 the route cost is hop-only (FUEL_WEIGHT unused in wiring). Folding total
> `fuelCost` per route requires a fuel-distance map — defer to a follow-up; the engine already accepts any
> per-unit cost, so this is a wiring change only, no engine/body change.

- [ ] **Step 2: Register it (after `economy`, near the other flow processors)**

```ts
// lib/tick/registry.ts — add the import and the array entry
import { directedLogisticsProcessor } from "./processors/directed-logistics";
// ...in the processors array, after tradeFlowProcessor:
  tradeFlowProcessor,
  directedLogisticsProcessor,
  tradeMissionsProcessor,
```

- [ ] **Step 3: Write the integration test (real Postgres project)**

```ts
// lib/tick/processors/__tests__/integration/directed-logistics.integration.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { PrismaDirectedLogisticsWorld } from "@/lib/tick/adapters/prisma/directed-logistics";
import { runDirectedLogisticsProcessor } from "@/lib/tick/processors/directed-logistics";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

// Assumes the integration harness seeds a small universe (see lib/test-utils/integration.ts).
describe("directed-logistics integration", () => {
  it("creates logistics TradeFlow rows for a faction with a surplus and a deficit", async () => {
    // Arrange: pick a faction, force one of its markets to surplus and another to deficit.
    // (Use the harness helpers; mirror economy.integration.test.ts setup.)
    // ... harness setup elided — follow the existing integration test pattern ...

    await prisma.$transaction(async (tx) => {
      const world = new PrismaDirectedLogisticsWorld(tx);
      const hops = new Map<string, Map<string, number>>(); // build from the seeded connections
      await runDirectedLogisticsProcessor(world, { tick: 0 }, {
        interval: DIRECTED_LOGISTICS.INTERVAL,
        routeCost: (_f, _t) => 1,
      });
    }, { timeout: 30_000 });

    const flows = await prisma.tradeFlow.findMany({ where: { flowType: "logistics" } });
    expect(flows.length).toBeGreaterThan(0);
  });
});
```

> **Implementer:** flesh out the arrange block using `lib/test-utils/integration.ts` + the pattern in
> `lib/tick/processors/__tests__/integration/economy.integration.test.ts`. The assertion that matters:
> `TradeFlow` rows with `flowType: "logistics"` appear after a run on a faction holding both a surplus
> and a below-floor deficit of the same good within `MAX_HOPS`.

- [ ] **Step 4: Run the integration test**

Run: `npx vitest run --project integration directed-logistics`
Expected: PASS — logistics flow rows created.

- [ ] **Step 5: Full typecheck + unit sweep**

Run: `npx tsc --noEmit && unset DATABASE_URL; npx vitest run --project unit directed-logistics`
Expected: no type errors; all unit tests green.

- [ ] **Step 6: Simulator sanity — does the curve bend?**

Run: `npm run simulate -- --config experiments/<copy an existing config>.yml` (or `npm run simulate` for the
default 500-tick run). Compare striking-system count / population trend vs a pre-change baseline.
Expected: directed logistics reduces the suppliable-middle decline (coarse — not a precise target). Record
the before/after in the PR description. If the simulator's in-memory tick loop doesn't yet invoke the new
processor, wire the memory adapter into `lib/engine/simulator/runner.ts` mirroring how `tradeFlow` is run
there (separate follow-up step if the runner doesn't auto-pick-up registry processors).

- [ ] **Step 7: Commit**

```bash
git add lib/tick/processors/directed-logistics.ts lib/tick/registry.ts lib/tick/processors/__tests__/integration/directed-logistics.integration.test.ts
git commit -m "feat(logistics): register directed-logistics processor + integration coverage"
```

---

## Self-Review (done at write time)

- **Spec coverage (Phase 1 scope):** logistics budget primitive (Task 1) ✓ · per-system-generation →
  faction pool (Task 2 sums generation; Task 5 groups per faction) ✓ · greedy need-ranked surplus→deficit
  matching, all goods, civ+industrial demand (Tasks 2, 5) ✓ · work = qty × distance, under-serve / residual
  (Task 2 budget bound) ✓ · silent bulk moves + `TradeFlow.flowType=logistics` (Tasks 3, 5, 6) ✓ ·
  per-faction 48-tick shard + catch-up (Task 5) ✓ · processor trio convention (Tasks 4–6) ✓. **Out of
  Phase-1 scope (correctly absent):** Contracts, timeout-resolve, `FactionLogistics` row, map overlay,
  Logistics tab — Phases 2–4.
- **Placeholder scan:** the only deferred specifics are the two flagged adapter call-outs (`basePrice`
  band inputs + `yields`) and the fuel term — each names the exact source file to copy from and is a
  wiring detail, not a logic gap. No "TBD/handle edge cases" in logic steps.
- **Type consistency:** `SystemLogisticsState`/`GoodMarketState`/`PlannedTransfer`/`RouteCost` are defined
  in Task 2 and consumed unchanged in Task 5; `DirectedLogisticsWorld` method names match across Tasks
  4/6/7; `flowType` literal `"logistics"` consistent (Tasks 3/5/6).

---

## Open implementer decisions (surfaced, not blocking)

- **Band inputs in the prisma adapter** — replicate trade-flow's `basePrice/priceFloor/priceCeiling`
  derivation (the `0` placeholders are explicitly not shippable).
- **`yields` wiring** — use the real substrate-space yields, not `emptyResourceVector()`.
- **Fuel term** — Phase 1 ships hop-only route cost; fold `fuelCost` later (wiring-only change).
- **Simulator integration** — confirm `runner.ts` exercises the new processor; wire if not.
- **`GENERATION_PER_POP` / margins / `MAX_HOPS`** — first-draft; calibrate against the simulator.
