# SP2 Part 0 — De-region the Diffusion Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NPC goods diffusion flow over the full **intra-faction** jump-lane graph (region lines ignored, faction borders closed), distance-attenuated, scheduled by a **work-budget edge slice** instead of a per-region round-robin — separating the performance-sharding concern from the gameplay flow boundary.

**Architecture:** Refactor the `tradeFlow` processor stack (pure body + `TradeFlowWorld` interface + Prisma/memory adapters) from region-centric to faction-topology + slice-scheduled. The topology source swaps `systemId→regionId` for `systemId→factionId` (an edge is "open" iff both endpoints share a faction, with `null===null` letting adjacent independents trade). Distance attenuation multiplies each edge's flow by `1/(1 + DISTANCE_DECAY·fuelCost)`. Phase A is the structural refactor with `DISTANCE_DECAY=0` (distance a no-op, so the only behaviour change is faction borders closing); Phase B turns on distance and recalibrates the whole thing.

**Tech Stack:** TypeScript 5 (strict), Vitest 4, Prisma 7 (`@prisma/adapter-pg`), the existing tick-processor World/adapter pattern.

## Global Constraints

- **No `as` casts** except `as const` and in `lib/types/guards.ts`. No `unknown`, no `Record<string, unknown>`. (CLAUDE.md)
- **No schema change, no reseed** — `StarSystem.factionId` (`String?`) and `SystemConnection.fuelCost` (`Float`) already exist. Part 0 only reads existing data differently.
- **Do not touch prosperity** — `tradeVolumeAccum` / `prosperityTargetVolume` wiring stays exactly as-is; prosperity is retired in SP2 Part 1, not here.
- **Pure body, two adapters** — the same `runTradeFlowProcessor` body runs against the Prisma adapter (live) and the in-memory adapter (sim + unit tests). Unit tests exercise the body through the memory adapter; the Prisma adapter is verified by `tsc` + the integration/sim run.
- **Engine functions stay DB-free.** Bulk DB writes use `unnest()` / `createMany` (no per-row writes in a transaction).
- Test command: `npx vitest run <path>`; full suite: `npx vitest run`; types: `npx tsc --noEmit`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/engine/simulator/types.ts` | sim world model | **Modify** — add `factionId` to `SimSystem` |
| `lib/engine/simulator/world.ts` | builds the sim world from generation | **Modify** — populate `SimSystem.factionId` |
| `lib/tick/world/trade-flow-world.ts` | the data interface + param shape | **Modify** — faction-topology + slice methods; `EdgeView.fuelCost`; new params |
| `lib/tick/processors/trade-flow.ts` | pure processor body + live wiring | **Modify** — slice scheduling, faction edges, per-edge displacement, distance factor |
| `lib/tick/adapters/memory/trade-flow.ts` | in-memory adapter | **Modify** — `getOpenEdges`/`getMarketSnapshotsForSystems`/`getRecentPlayerVolumeBySystem`; faction filter; drop `regions` ctor arg |
| `lib/tick/adapters/prisma/trade-flow.ts` | live adapter | **Modify** — faction edge cache, per-system snapshots + player volume |
| `lib/services/adjacency.ts` | cached topology maps | **Modify** — add `getSystemFactionMap()` |
| `lib/constants/trade-simulation.ts` | tunables | **Modify** — replace `PROCESS_EVERY_N_TICKS` with `EDGES_PER_TICK`; add `DISTANCE_DECAY` |
| `lib/engine/simulator/economy.ts` | sim tick orchestration | **Modify** — new `InMemoryTradeFlowWorld` ctor call |
| `lib/tick/processors/__tests__/trade-flow.test.ts` | unit tests | **Rewrite** — assert faction-topology + slice behaviour |
| `lib/engine/__tests__/trade-flow-integration.test.ts` | memory-adapter integration test | **Modify** — new ctor signature |
| `docs/active/gameplay/trade-simulation.md`, `economy.md` | docs | **Modify** (Phase B) — topology section |

**Interface after Part 0** (the contract every task below shares):

```typescript
// EdgeView gains fuelCost (distance source)
export interface EdgeView {
  aSystemId: string;
  bSystemId: string;
  fuelCost: number;
}

export interface TradeFlowWorld {
  /** All open (same-faction; null===null for adjacent independents) deduped edges, stably ordered. */
  getOpenEdges(): Promise<EdgeView[]>;
  /** Markets at the given systems. */
  getMarketSnapshotsForSystems(systemIds: string[]): Promise<MarketSnapshot[]>;
  /** Recent player trade volume per system (0 when unavailable / sim baseline). */
  getRecentPlayerVolumeBySystem(systemIds: string[]): Promise<Map<string, number>>;
  applyMarketUpdates(updates: MarketUpdate[]): Promise<void>;
  applyVolumeIncrements(increments: VolumeIncrement[]): Promise<void>;
  appendFlowEvents(events: FlowEventInsert[]): Promise<void>;
  pruneFlowEvents(beforeTick: number): Promise<void>;
}

export interface TradeFlowProcessorParams {
  edgesPerTick: number;       // work-budget slice size (replaces processEveryNTicks + region round-robin)
  flowBudget: number;
  gradientThreshold: number;
  gradientSensitivity: number;
  flowHistoryTicks: number;
  playerDisplacementFactor: number;
  prosperityTargetVolume: number;
  minLevel: number;
  maxLevel: number;
  distanceDecay: number;      // distance attenuation: factor = 1/(1 + distanceDecay·fuelCost). 0 = no-op.
}
```

`MarketSnapshot`, `MarketUpdate`, `VolumeIncrement`, `FlowEventInsert` are **unchanged**. `RegionView` and the `getRegions`/`getEdgesForRegion`/`getMarketSnapshotsForRegion`/`getRecentPlayerVolume` methods are **removed**.

---

# Phase A — Structural refactor (PR 1)

## Task 1: Thread `factionId` into the simulator world

A standalone, additive precursor: the memory adapter's faction edge filter needs each sim system to carry its faction. Today `SimSystem` has `governmentType` but no faction identity.

**Files:**
- Modify: `lib/engine/simulator/types.ts` (`SimSystem`)
- Modify: `lib/engine/simulator/world.ts` (system construction, ~line 68-80)
- Test: `lib/engine/simulator/__tests__/world.test.ts` (create if absent)

**Interfaces:**
- Produces: `SimSystem.factionId: string | null` — consumed by Task 2's memory adapter.

- [ ] **Step 1: Write the failing test**

Create/append `lib/engine/simulator/__tests__/world.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createSimWorld } from "@/lib/engine/simulator/world";

describe("createSimWorld faction identity", () => {
  it("assigns every system a non-null factionId", () => {
    const world = createSimWorld(42, { tickCount: 1, bots: [], seed: 42 });
    expect(world.systems.length).toBeGreaterThan(0);
    for (const s of world.systems) {
      expect(typeof s.factionId).toBe("string");
      expect(s.factionId).not.toBeNull();
    }
  });

  it("co-assigns systems of the same faction the same factionId", () => {
    const world = createSimWorld(42, { tickCount: 1, bots: [], seed: 42 });
    const byGov = new Map<string, Set<string>>();
    for (const s of world.systems) {
      // factionId is finer-grained than government; this just asserts it is stable + grouped
      const set = byGov.get(s.factionId ?? "") ?? new Set();
      set.add(s.id);
      byGov.set(s.factionId ?? "", set);
    }
    expect(byGov.size).toBeGreaterThan(1); // multiple factions exist
  });
});
```

> If `createSimWorld`'s signature differs, match the existing call in `lib/engine/simulator/runner.ts`; the assertions on `factionId` are the point.

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run lib/engine/simulator/__tests__/world.test.ts`
Expected: FAIL — `factionId` is `undefined` / not a property of `SimSystem`.

- [ ] **Step 3: Add the field to `SimSystem`**

In `lib/engine/simulator/types.ts`, inside `interface SimSystem`, after `regionId`:

```typescript
  /** Owning faction's stable id, or null for independent systems. Drives the faction-bounded flow topology. */
  factionId: string | null;
```

- [ ] **Step 4: Populate it in `world.ts`**

In `lib/engine/simulator/world.ts`, in the `universe.systems.map(...)` body, add to the returned object (alongside `governmentType`):

```typescript
      factionId: `faction-${universe.systemFactionAssignments[s.index]}`,
```

- [ ] **Step 5: Fix any other `SimSystem` literals flagged by the compiler**

Run: `npx tsc --noEmit`
For each error "Property 'factionId' is missing in type ... SimSystem", add `factionId: "faction-0"` (or a test-meaningful value) to that object literal. These are test fixtures only; Task 2 rewrites the trade-flow fixtures, so a placeholder there is fine.

- [ ] **Step 6: Run tests + types**

Run: `npx vitest run lib/engine/simulator/__tests__/world.test.ts` → PASS
Run: `npx tsc --noEmit` → clean

- [ ] **Step 7: Commit**

```bash
git add lib/engine/simulator/types.ts lib/engine/simulator/world.ts lib/engine/simulator/__tests__/world.test.ts
git commit -m "feat(sim): carry factionId on SimSystem for the faction-bounded flow topology"
```

---

## Task 2: Refactor the trade-flow engine to faction-topology + work-budget slicing

One atomic task: the `TradeFlowWorld` interface change forces the body, both adapters, the registry wiring, the constants, the sim call site, and the tests to move together (anything left on the old interface breaks `tsc`). Steps sequence the files; the rewritten unit test goes first (red), then implementation, then green, then one commit.

**Files:**
- Modify: `lib/tick/world/trade-flow-world.ts`
- Modify: `lib/tick/processors/trade-flow.ts`
- Modify: `lib/tick/adapters/memory/trade-flow.ts`
- Modify: `lib/tick/adapters/prisma/trade-flow.ts`
- Modify: `lib/services/adjacency.ts`
- Modify: `lib/constants/trade-simulation.ts`
- Modify: `lib/engine/simulator/economy.ts` (the `new InMemoryTradeFlowWorld(...)` call, ~line 275)
- Rewrite: `lib/tick/processors/__tests__/trade-flow.test.ts`
- Modify: `lib/engine/__tests__/trade-flow-integration.test.ts` (the `new InMemoryTradeFlowWorld(...)` call, ~line 162)

**Interfaces:**
- Consumes: `SimSystem.factionId` (Task 1).
- Produces: the Part 0 `TradeFlowWorld` / `EdgeView` / `TradeFlowProcessorParams` (see File Structure block).

- [ ] **Step 1: Rewrite the unit test to assert the new behaviour**

Replace the body of `lib/tick/processors/__tests__/trade-flow.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { runTradeFlowProcessor } from "../trade-flow";
import { InMemoryTradeFlowWorld } from "@/lib/tick/adapters/memory/trade-flow";
import type { TradeFlowProcessorParams } from "@/lib/tick/world/trade-flow-world";
import type { TickContext } from "@/lib/tick/types";
import type {
  SimConnection,
  SimMarketEntry,
  SimSystem,
} from "@/lib/engine/simulator/types";

const PARAMS: TradeFlowProcessorParams = {
  edgesPerTick: 100,
  flowBudget: 8,
  gradientThreshold: 0.05,
  gradientSensitivity: 1.0,
  flowHistoryTicks: 200,
  playerDisplacementFactor: 2.0,
  prosperityTargetVolume: 50,
  minLevel: 5,
  maxLevel: 200,
  distanceDecay: 0,
};

function sys(id: string, factionId: string | null, regionId = "r1"): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId, factionId,
    governmentType: "federation",
    aggregate: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 0, radioactive: 0 },
    population: 1000, traits: [], bodyDanger: 0, prosperity: 0, tradeVolumeAccum: 0,
  };
}

function market(systemId: string, goodId: string, stock: number): SimMarketEntry {
  return {
    systemId, goodId, basePrice: 100, stock,
    anchorMult: 1, demandRate: 40, priceFloor: 10, priceCeiling: 500,
  };
}

function conn(a: string, b: string, fuelCost = 10): SimConnection {
  return { fromSystemId: a, toSystemId: b, fuelCost };
}

const ctx = (tick: number): TickContext => ({ tick }) as TickContext;

function makeWorld(opts: {
  systems: SimSystem[];
  markets: SimMarketEntry[];
  connections: SimConnection[];
  playerVolumeBySystem?: Map<string, number>;
}) {
  return new InMemoryTradeFlowWorld(
    { systems: opts.systems, markets: opts.markets, flowEvents: [] },
    opts.connections,
    opts.playerVolumeBySystem,
  );
}

describe("trade-flow: faction-bounded topology", () => {
  it("flows between same-faction systems across region lines", async () => {
    // a (region r1) and b (region r2) share faction f1 — must flow despite different regions.
    const systems = [sys("a", "f1", "r1"), sys("b", "f1", "r2")];
    const markets = [market("a", "food", 150), market("b", "food", 20)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(0), PARAMS);

    const a = world.markets.find((m) => m.systemId === "a")!;
    const b = world.markets.find((m) => m.systemId === "b")!;
    expect(a.stock).toBeLessThan(150); // surplus drained
    expect(b.stock).toBeGreaterThan(20); // shortage fed
  });

  it("does NOT flow across a faction border", async () => {
    const systems = [sys("a", "f1"), sys("b", "f2")]; // different factions
    const markets = [market("a", "food", 150), market("b", "food", 20)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(0), PARAMS);

    expect(world.markets.find((m) => m.systemId === "a")!.stock).toBe(150);
    expect(world.markets.find((m) => m.systemId === "b")!.stock).toBe(20);
    expect(world.flowEvents.length).toBe(0);
  });

  it("flows between two adjacent independent systems (null === null)", async () => {
    const systems = [sys("a", null), sys("b", null)];
    const markets = [market("a", "food", 150), market("b", "food", 20)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(0), PARAMS);

    expect(world.flowEvents.length).toBe(1);
  });

  it("does NOT flow between an independent and a faction system", async () => {
    const systems = [sys("a", null), sys("b", "f1")];
    const markets = [market("a", "food", 150), market("b", "food", 20)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(0), PARAMS);

    expect(world.flowEvents.length).toBe(0);
  });
});

describe("trade-flow: work-budget slicing", () => {
  it("processes only edgesPerTick edges per tick, cycling over ticks", async () => {
    // 3 same-faction edges (a-b, c-d, e-f), edgesPerTick = 1 → one edge per tick.
    const systems = ["a", "b", "c", "d", "e", "f"].map((id) => sys(id, "f1"));
    const markets = [
      market("a", "food", 150), market("b", "food", 20),
      market("c", "food", 150), market("d", "food", 20),
      market("e", "food", 150), market("f", "food", 20),
    ];
    const connections = [conn("a", "b"), conn("c", "d"), conn("e", "f")];
    const world = makeWorld({ systems, markets, connections });
    const p = { ...PARAMS, edgesPerTick: 1 };

    // Edges are sorted by "a|b" key: a|b, c|d, e|f.
    await runTradeFlowProcessor(world, ctx(0), p); // start = 0 → edge a|b
    expect(world.flowEvents.map((e) => e.fromSystemId).sort()).toEqual(["a"]);

    await runTradeFlowProcessor(world, ctx(1), p); // start = 1 → edge c|d
    expect(world.flowEvents.some((e) => e.fromSystemId === "c")).toBe(true);
  });
});

describe("trade-flow: distance attenuation", () => {
  it("moves less over a costlier jump when distanceDecay > 0", async () => {
    const near = makeWorld({
      systems: [sys("a", "f1"), sys("b", "f1")],
      markets: [market("a", "food", 200), market("b", "food", 5)],
      connections: [conn("a", "b", 1)],
    });
    const far = makeWorld({
      systems: [sys("a", "f1"), sys("b", "f1")],
      markets: [market("a", "food", 200), market("b", "food", 5)],
      connections: [conn("a", "b", 100)],
    });
    const p = { ...PARAMS, distanceDecay: 0.1 };

    await runTradeFlowProcessor(near, ctx(0), p);
    await runTradeFlowProcessor(far, ctx(0), p);

    const nearQty = near.flowEvents[0]?.quantity ?? 0;
    const farQty = far.flowEvents[0]?.quantity ?? 0;
    expect(nearQty).toBeGreaterThan(farQty);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run lib/tick/processors/__tests__/trade-flow.test.ts`
Expected: FAIL — `getOpenEdges`/new ctor not implemented; compile errors on the old interface.

- [ ] **Step 3: Rewrite the interface** (`lib/tick/world/trade-flow-world.ts`)

Replace `EdgeView`, the `TradeFlowWorld` interface, and `TradeFlowProcessorParams` with the Part 0 versions from the **File Structure** block above. Delete `RegionView`. Keep `MarketSnapshot`, `MarketUpdate`, `VolumeIncrement`, `FlowEventInsert` as-is. Update the file's top doc comment to describe faction-topology + slice scheduling.

- [ ] **Step 4: Rewrite the pure processor body** (`lib/tick/processors/trade-flow.ts`)

Replace `runTradeFlowProcessor` and the live wiring with:

```typescript
import type { TickContext, TickProcessor, TickProcessorResult } from "../types";
import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { ECONOMY_CONSTANTS, PROSPERITY_TARGET_VOLUME } from "@/lib/constants/economy";
import { PrismaTradeFlowWorld } from "@/lib/tick/adapters/prisma/trade-flow";
import type {
  EdgeView, FlowEventInsert, MarketSnapshot, MarketUpdate,
  TradeFlowProcessorParams, TradeFlowWorld, VolumeIncrement,
} from "@/lib/tick/world/trade-flow-world";

let invariantWarned = false;

/**
 * Pure processor body. Same logic runs against the Prisma adapter (live game)
 * or the in-memory adapter (simulator + unit tests).
 *
 * Topology: flow only crosses OPEN edges (both endpoints share a faction; two
 * independents trade via null===null). Cross-faction edges are excluded by the
 * adapter's getOpenEdges(). Scheduling: a work-budget slice of `edgesPerTick`
 * edges per tick, advancing a cursor over the stable edge order, so per-tick
 * DB work is bounded independently of faction-territory size.
 */
export async function runTradeFlowProcessor(
  world: TradeFlowWorld,
  ctx: TickContext,
  params: TradeFlowProcessorParams,
): Promise<TickProcessorResult> {
  const edges = await world.getOpenEdges();
  if (edges.length === 0) return {};

  const total = edges.length;
  const sweepTicks = Math.ceil(total / params.edgesPerTick);
  if (!invariantWarned && sweepTicks >= params.flowHistoryTicks) {
    invariantWarned = true;
    console.warn(
      `[tradeFlow] INVARIANT: sweep (${sweepTicks} ticks = ceil(${total} edges / ${params.edgesPerTick} per tick)) ≥ FLOW_HISTORY_TICKS (${params.flowHistoryTicks}). ` +
        `Flow events prune before the sweep returns — overlay will show gaps. Raise EDGES_PER_TICK or FLOW_HISTORY_TICKS.`,
    );
  }

  // Work-budget slice: consecutive window advancing edgesPerTick per tick, wrapping.
  const count = Math.min(params.edgesPerTick, total);
  const start = (ctx.tick * params.edgesPerTick) % total;
  const slice: EdgeView[] = [];
  for (let i = 0; i < count; i++) slice.push(edges[(start + i) % total]);

  const systemIds = new Set<string>();
  for (const e of slice) {
    systemIds.add(e.aSystemId);
    systemIds.add(e.bSystemId);
  }
  const sliceSystems = [...systemIds];

  const snapshots = await world.getMarketSnapshotsForSystems(sliceSystems);
  const marketByKey = new Map<string, MarketSnapshot>();
  const goodsBySystem = new Map<string, Set<string>>();
  for (const s of snapshots) {
    marketByKey.set(`${s.systemId}|${s.goodId}`, s);
    let goods = goodsBySystem.get(s.systemId);
    if (!goods) {
      goods = new Set();
      goodsBySystem.set(s.systemId, goods);
    }
    goods.add(s.goodId);
  }

  const playerVol = await world.getRecentPlayerVolumeBySystem(sliceSystems);

  const flowEvents: FlowEventInsert[] = [];
  const updatesByMarketId = new Map<string, MarketUpdate>();
  const volumeBySystem = new Map<string, number>();

  for (const edge of slice) {
    const goodsA = goodsBySystem.get(edge.aSystemId);
    const goodsB = goodsBySystem.get(edge.bSystemId);
    if (!goodsA || !goodsB) continue;

    let bestGoodId: string | null = null;
    let bestGradient = 0;
    for (const goodId of goodsA) {
      if (!goodsB.has(goodId)) continue;
      const mA = marketByKey.get(`${edge.aSystemId}|${goodId}`);
      const mB = marketByKey.get(`${edge.bSystemId}|${goodId}`);
      if (!mA || !mB || mA.basePrice <= 0) continue;
      const priceA = spotPrice(
        curveForGood(mA.basePrice, mA.priceFloor, mA.priceCeiling, mA.demandRate, mA.anchorMult),
        mA.stock,
      );
      const priceB = spotPrice(
        curveForGood(mB.basePrice, mB.priceFloor, mB.priceCeiling, mB.demandRate, mB.anchorMult),
        mB.stock,
      );
      const gradient = (priceB - priceA) / mA.basePrice;
      if (!isFinite(gradient)) continue;
      if (Math.abs(gradient) > Math.abs(bestGradient)) {
        bestGradient = gradient;
        bestGoodId = goodId;
      }
    }
    if (!bestGoodId) continue;
    if (Math.abs(bestGradient) < params.gradientThreshold) continue;

    const fromSystemId = bestGradient > 0 ? edge.aSystemId : edge.bSystemId;
    const toSystemId = bestGradient > 0 ? edge.bSystemId : edge.aSystemId;
    const mFrom = marketByKey.get(`${fromSystemId}|${bestGoodId}`);
    const mTo = marketByKey.get(`${toSystemId}|${bestGoodId}`);
    if (!mFrom || !mTo) continue;

    // Per-edge player displacement from endpoint volumes (replaces per-region throttle).
    const edgeVolume =
      (playerVol.get(edge.aSystemId) ?? 0) + (playerVol.get(edge.bSystemId) ?? 0);
    const pressure =
      params.prosperityTargetVolume > 0 ? edgeVolume / params.prosperityTargetVolume : 0;
    const displacement = Math.max(0, Math.min(1, pressure * params.playerDisplacementFactor));
    const edgeBudget = params.flowBudget * (1 - displacement);
    if (edgeBudget < 1) continue;

    // Distance attenuation (1 when distanceDecay = 0).
    const distanceFactor = 1 / (1 + params.distanceDecay * edge.fuelCost);

    const stockHeadroom = Math.max(0, mFrom.stock - params.minLevel);
    const stockCapacity = Math.max(0, params.maxLevel - mTo.stock);
    const gradientFraction = Math.min(1, Math.abs(bestGradient) * params.gradientSensitivity);
    const rawQty =
      Math.min(edgeBudget, stockHeadroom, stockCapacity) * gradientFraction * distanceFactor;
    const quantity = Math.floor(rawQty);
    if (quantity <= 0) continue;

    const newFromStock = clamp(mFrom.stock - quantity, params.minLevel, params.maxLevel);
    const newToStock = clamp(mTo.stock + quantity, params.minLevel, params.maxLevel);
    mFrom.stock = newFromStock;
    mTo.stock = newToStock;
    updatesByMarketId.set(mFrom.id, { id: mFrom.id, stock: newFromStock });
    updatesByMarketId.set(mTo.id, { id: mTo.id, stock: newToStock });
    volumeBySystem.set(fromSystemId, (volumeBySystem.get(fromSystemId) ?? 0) + quantity);
    volumeBySystem.set(toSystemId, (volumeBySystem.get(toSystemId) ?? 0) + quantity);
    flowEvents.push({ tick: ctx.tick, fromSystemId, toSystemId, goodId: bestGoodId, quantity });
  }

  if (updatesByMarketId.size > 0) {
    await world.applyMarketUpdates([...updatesByMarketId.values()]);
  }
  if (volumeBySystem.size > 0) {
    const increments: VolumeIncrement[] = [];
    for (const [systemId, amount] of volumeBySystem) increments.push({ systemId, amount });
    await world.applyVolumeIncrements(increments);
  }
  if (flowEvents.length > 0) {
    await world.appendFlowEvents(flowEvents);
  }
  await world.pruneFlowEvents(ctx.tick - params.flowHistoryTicks);

  return {};
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Live-game wiring ──────────────────────────────────────────────

export const tradeFlowProcessor: TickProcessor = {
  name: "tradeFlow",
  frequency: 1,
  dependsOn: ["economy"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaTradeFlowWorld(ctx.tx);
    return runTradeFlowProcessor(world, ctx, {
      edgesPerTick: TRADE_SIMULATION.EDGES_PER_TICK,
      flowBudget: TRADE_SIMULATION.FLOW_BUDGET,
      gradientThreshold: TRADE_SIMULATION.GRADIENT_THRESHOLD,
      gradientSensitivity: TRADE_SIMULATION.GRADIENT_SENSITIVITY,
      flowHistoryTicks: TRADE_SIMULATION.FLOW_HISTORY_TICKS,
      playerDisplacementFactor: TRADE_SIMULATION.PLAYER_DISPLACEMENT_FACTOR,
      prosperityTargetVolume: PROSPERITY_TARGET_VOLUME,
      minLevel: ECONOMY_CONSTANTS.MIN_LEVEL,
      maxLevel: ECONOMY_CONSTANTS.MAX_LEVEL,
      distanceDecay: TRADE_SIMULATION.DISTANCE_DECAY,
    });
  },
};
```

- [ ] **Step 5: Update the constants** (`lib/constants/trade-simulation.ts`)

Remove `PROCESS_EVERY_N_TICKS`. Add:

```typescript
  /**
   * Work-budget slice: edges processed per tick. The processor advances a cursor
   * over the stable open-edge order, so a full sweep takes ceil(totalOpenEdges /
   * EDGES_PER_TICK) ticks. Bounds per-tick DB work independently of faction size.
   *
   * MUST satisfy ceil(totalOpenEdges / EDGES_PER_TICK) < FLOW_HISTORY_TICKS,
   * else flow events prune before the sweep returns (overlay gaps). Calibrated
   * in Phase B against 10K scale.
   */
  EDGES_PER_TICK: 256,
  /**
   * Distance attenuation coefficient. Per-edge flow is scaled by
   * 1/(1 + DISTANCE_DECAY · fuelCost), so costlier jumps move less and
   * gateways (low fuelCost) move more. 0 = no attenuation. Set in Phase B.
   */
  DISTANCE_DECAY: 0,
```

- [ ] **Step 6: Add `getSystemFactionMap()`** (`lib/services/adjacency.ts`)

After `getSystemRegionMap`, add:

```typescript
/**
 * Cached systemId → factionId map (null for independents). Faction ownership is
 * static after seed (rebellion/territory change is SP5), so memoize for the
 * process lifetime. Drives the faction-bounded flow topology.
 */
let cachedSystemFaction: Map<string, string | null> | null = null;

export async function getSystemFactionMap(): Promise<Map<string, string | null>> {
  if (cachedSystemFaction) return cachedSystemFaction;

  const systems = await prisma.starSystem.findMany({
    select: { id: true, factionId: true },
  });

  cachedSystemFaction = new Map(systems.map((s) => [s.id, s.factionId]));
  return cachedSystemFaction;
}
```

Also extend `invalidateAdjacencyCache()` to clear it:

```typescript
export function invalidateAdjacencyCache(): void {
  cachedAdjacency = null;
  cachedSystemRegion = null;
  cachedSystemFaction = null;
}
```

> If `invalidateAdjacencyCache` did not previously clear `cachedSystemRegion`, adding it here is the correct fix — all three caches share the same staleness lifetime.

- [ ] **Step 7: Rewrite the Prisma adapter** (`lib/tick/adapters/prisma/trade-flow.ts`)

```typescript
import type { TxClient } from "@/lib/tick/types";
import type {
  EdgeView, FlowEventInsert, MarketSnapshot, MarketUpdate,
  TradeFlowWorld, VolumeIncrement,
} from "@/lib/tick/world/trade-flow-world";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";

/**
 * Cached open-edge list: unique unordered edges whose endpoints share a faction
 * (null===null lets adjacent independents trade). Cross-faction edges excluded.
 * The connection graph + faction assignments are static after seed, so build
 * once per process. Each edge carries fuelCost for distance attenuation.
 * Sorted by "${a}|${b}" so the work-budget cursor is deterministic.
 *
 * The adjacency service is imported dynamically so the unit tests (memory
 * adapter only) don't transitively load lib/prisma.ts and trip its guard.
 */
let cachedOpenEdges: EdgeView[] | null = null;

async function getOpenEdgesCached(tx: TxClient): Promise<EdgeView[]> {
  if (cachedOpenEdges) return cachedOpenEdges;

  const { getSystemFactionMap } = await import("@/lib/services/adjacency");
  const sysFaction = await getSystemFactionMap();

  const conns = await tx.systemConnection.findMany({
    select: { fromSystemId: true, toSystemId: true, fuelCost: true },
  });

  const seen = new Set<string>();
  const edges: EdgeView[] = [];
  for (const c of conns) {
    if (c.fromSystemId === c.toSystemId) continue;
    // null===null (both independent) is open; same non-null faction is open; else closed.
    if (sysFaction.get(c.fromSystemId) !== sysFaction.get(c.toSystemId)) continue;
    const [a, b] =
      c.fromSystemId < c.toSystemId
        ? [c.fromSystemId, c.toSystemId]
        : [c.toSystemId, c.fromSystemId];
    const key = `${a}|${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ aSystemId: a, bSystemId: b, fuelCost: c.fuelCost });
  }
  edges.sort((x, y) =>
    `${x.aSystemId}|${x.bSystemId}`.localeCompare(`${y.aSystemId}|${y.bSystemId}`),
  );

  cachedOpenEdges = edges;
  return edges;
}

export class PrismaTradeFlowWorld implements TradeFlowWorld {
  constructor(private tx: TxClient) {}

  getOpenEdges(): Promise<EdgeView[]> {
    return getOpenEdgesCached(this.tx);
  }

  async getMarketSnapshotsForSystems(systemIds: string[]): Promise<MarketSnapshot[]> {
    if (systemIds.length === 0) return [];
    const rows = await this.tx.stationMarket.findMany({
      where: { station: { systemId: { in: systemIds } } },
      include: { good: true, station: { select: { systemId: true } } },
    });
    return rows.map((m) => ({
      id: m.id,
      systemId: m.station.systemId,
      goodId: GOOD_NAME_TO_KEY.get(m.good.name) ?? m.good.name,
      basePrice: m.good.basePrice,
      stock: m.stock,
      anchorMult: m.anchorMult,
      demandRate: m.demandRate,
      priceFloor: m.good.priceFloor,
      priceCeiling: m.good.priceCeiling,
    }));
  }

  async getRecentPlayerVolumeBySystem(systemIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (systemIds.length === 0) return result;
    const cutoff = new Date(Date.now() - TRADE_SIMULATION.PLAYER_VOLUME_WINDOW_MS);
    const rows = await this.tx.tradeHistory.findMany({
      where: { createdAt: { gt: cutoff }, station: { systemId: { in: systemIds } } },
      select: { quantity: true, station: { select: { systemId: true } } },
    });
    for (const r of rows) {
      const sid = r.station.systemId;
      result.set(sid, (result.get(sid) ?? 0) + r.quantity);
    }
    return result;
  }

  async applyMarketUpdates(updates: MarketUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const ids = updates.map((u) => u.id);
    const stocks = updates.map((u) => (isFinite(u.stock) ? u.stock : 0));
    await this.tx.$executeRaw`
      UPDATE "StationMarket" AS sm
      SET "stock" = batch."stock"
      FROM unnest(${ids}::text[], ${stocks}::double precision[])
        AS batch("id", "stock")
      WHERE sm."id" = batch."id"`;
  }

  async applyVolumeIncrements(increments: VolumeIncrement[]): Promise<void> {
    if (increments.length === 0) return;
    const ids = increments.map((i) => i.systemId);
    const amounts = increments.map((i) => (isFinite(i.amount) ? Math.round(i.amount) : 0));
    await this.tx.$executeRaw`
      UPDATE "StarSystem" AS ss
      SET "tradeVolumeAccum" = ss."tradeVolumeAccum" + batch."amount"
      FROM unnest(${ids}::text[], ${amounts}::integer[])
        AS batch("id", "amount")
      WHERE ss."id" = batch."id"`;
  }

  async appendFlowEvents(events: FlowEventInsert[]): Promise<void> {
    if (events.length === 0) return;
    await this.tx.tradeFlow.createMany({ data: events });
  }

  async pruneFlowEvents(beforeTick: number): Promise<void> {
    await this.tx.tradeFlow.deleteMany({ where: { tick: { lt: beforeTick } } });
  }
}
```

- [ ] **Step 8: Rewrite the memory adapter** (`lib/tick/adapters/memory/trade-flow.ts`)

```typescript
import type {
  EdgeView, FlowEventInsert, MarketSnapshot, MarketUpdate,
  TradeFlowWorld, VolumeIncrement,
} from "@/lib/tick/world/trade-flow-world";
import type {
  SimConnection, SimFlowEvent, SimMarketEntry, SimSystem,
} from "@/lib/engine/simulator/types";

/**
 * In-memory adapter for the trade-flow processor.
 *
 * Owns mutable slices of the simulator's world for one runTradeFlowProcessor
 * call. Open edges are the unique same-faction (null===null for independents)
 * connections, sorted by key, each carrying fuelCost. The synthetic
 * MarketSnapshot.id ("${systemId}|${goodId}") round-trips into MarketUpdate.id.
 */
export class InMemoryTradeFlowWorld implements TradeFlowWorld {
  systems: SimSystem[];
  markets: SimMarketEntry[];
  flowEvents: SimFlowEvent[];
  private sysFactionCache: Map<string, string | null> | null = null;
  private openEdgesCache: EdgeView[] | null = null;

  constructor(
    initial: { systems: SimSystem[]; markets: SimMarketEntry[]; flowEvents: SimFlowEvent[] },
    private readonly connections: SimConnection[],
    /** Optional per-system player-volume injection for tests; sim baseline is empty. */
    private readonly playerVolumeBySystem: ReadonlyMap<string, number> = new Map(),
  ) {
    this.systems = initial.systems.map((s) => ({ ...s }));
    this.markets = initial.markets.map((m) => ({ ...m }));
    this.flowEvents = [...initial.flowEvents];
  }

  private getSysFaction(): Map<string, string | null> {
    if (!this.sysFactionCache) {
      this.sysFactionCache = new Map(this.systems.map((s) => [s.id, s.factionId]));
    }
    return this.sysFactionCache;
  }

  getOpenEdges(): Promise<EdgeView[]> {
    if (this.openEdgesCache) return Promise.resolve(this.openEdgesCache);
    const sysFaction = this.getSysFaction();
    const seen = new Set<string>();
    const edges: EdgeView[] = [];
    for (const c of this.connections) {
      if (c.fromSystemId === c.toSystemId) continue;
      if (sysFaction.get(c.fromSystemId) !== sysFaction.get(c.toSystemId)) continue;
      const [a, b] =
        c.fromSystemId < c.toSystemId
          ? [c.fromSystemId, c.toSystemId]
          : [c.toSystemId, c.fromSystemId];
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ aSystemId: a, bSystemId: b, fuelCost: c.fuelCost });
    }
    edges.sort((x, y) =>
      `${x.aSystemId}|${x.bSystemId}`.localeCompare(`${y.aSystemId}|${y.bSystemId}`),
    );
    this.openEdgesCache = edges;
    return Promise.resolve(edges);
  }

  getMarketSnapshotsForSystems(systemIds: string[]): Promise<MarketSnapshot[]> {
    const ids = new Set(systemIds);
    const snapshots: MarketSnapshot[] = [];
    for (const m of this.markets) {
      if (!ids.has(m.systemId)) continue;
      snapshots.push({
        id: `${m.systemId}|${m.goodId}`,
        systemId: m.systemId,
        goodId: m.goodId,
        basePrice: m.basePrice,
        stock: m.stock,
        anchorMult: m.anchorMult,
        demandRate: m.demandRate,
        priceFloor: m.priceFloor,
        priceCeiling: m.priceCeiling,
      });
    }
    return Promise.resolve(snapshots);
  }

  getRecentPlayerVolumeBySystem(systemIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (const id of systemIds) {
      const v = this.playerVolumeBySystem.get(id);
      if (v) result.set(id, v);
    }
    return Promise.resolve(result);
  }

  applyMarketUpdates(updates: MarketUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const byKey = new Map<string, MarketUpdate>();
    for (const u of updates) byKey.set(u.id, u);
    this.markets = this.markets.map((m) => {
      const u = byKey.get(`${m.systemId}|${m.goodId}`);
      if (!u) return m;
      return { ...m, stock: isFinite(u.stock) ? u.stock : 0 };
    });
    return Promise.resolve();
  }

  applyVolumeIncrements(increments: VolumeIncrement[]): Promise<void> {
    if (increments.length === 0) return Promise.resolve();
    const bySystem = new Map<string, number>();
    for (const inc of increments) {
      const amount = isFinite(inc.amount) ? Math.round(inc.amount) : 0;
      bySystem.set(inc.systemId, (bySystem.get(inc.systemId) ?? 0) + amount);
    }
    this.systems = this.systems.map((s) => {
      const delta = bySystem.get(s.id);
      if (!delta) return s;
      return { ...s, tradeVolumeAccum: s.tradeVolumeAccum + delta };
    });
    return Promise.resolve();
  }

  appendFlowEvents(events: FlowEventInsert[]): Promise<void> {
    if (events.length === 0) return Promise.resolve();
    this.flowEvents.push(...events);
    return Promise.resolve();
  }

  pruneFlowEvents(beforeTick: number): Promise<void> {
    this.flowEvents = this.flowEvents.filter((e) => e.tick >= beforeTick);
    return Promise.resolve();
  }
}
```

- [ ] **Step 9: Update the two remaining `InMemoryTradeFlowWorld` call sites**

In `lib/engine/simulator/economy.ts` (~line 275) and `lib/engine/__tests__/trade-flow-integration.test.ts` (~line 162), change the constructor call from the old 4-arg `(initial, regions, connections, playerVolumeByRegion)` form to the new:

```typescript
new InMemoryTradeFlowWorld(
  { systems: world.systems, markets: world.markets, flowEvents: world.flowEvents },
  world.connections,
)
```

Drop the `regions` and `playerVolumeByRegion` arguments. (Use the local variable names already in scope at each call site — e.g. the integration test uses `curSystems`/`curMarkets`.) Also remove any now-unused `regions` locals the compiler flags.

- [ ] **Step 10: Run the unit test + full suite + types**

Run: `npx vitest run lib/tick/processors/__tests__/trade-flow.test.ts` → PASS
Run: `npx vitest run` → all green (watch the integration test + sim economy test)
Run: `npx tsc --noEmit` → clean

- [ ] **Step 11: Commit**

```bash
git add lib/tick/world/trade-flow-world.ts lib/tick/processors/trade-flow.ts \
  lib/tick/adapters/memory/trade-flow.ts lib/tick/adapters/prisma/trade-flow.ts \
  lib/services/adjacency.ts lib/constants/trade-simulation.ts \
  lib/engine/simulator/economy.ts \
  lib/tick/processors/__tests__/trade-flow.test.ts \
  lib/engine/__tests__/trade-flow-integration.test.ts
git commit -m "feat(economy): de-region diffusion — faction-bounded topology + work-budget slicing

Flow now crosses the full intra-faction jump-lane graph (region lines ignored,
faction borders closed; adjacent independents trade via null===null), scheduled
by an EDGES_PER_TICK work-budget slice instead of a per-region round-robin.
Distance attenuation plumbed (1/(1+DISTANCE_DECAY*fuelCost)), DISTANCE_DECAY=0
for now. Separates performance-sharding from the gameplay flow boundary."
```

---

# Phase B — Distance attenuation + recalibration + docs (PR 2)

## Task 3: Calibrate `DISTANCE_DECAY` and `EDGES_PER_TICK`, recheck the economy

Calibration is a run-observe-adjust loop, not TDD. The targets are unchanged from SP1: stocks in `[5, 200]`, real cross-system price dispersion, bots profit, greedy ≫ random — now under faction-bloc topology with distance attenuation on.

**Files:**
- Modify: `lib/constants/trade-simulation.ts` (`DISTANCE_DECAY`, `EDGES_PER_TICK`)
- (Possibly) Modify: `lib/constants/trade-simulation.ts` (`FLOW_BUDGET` / `GRADIENT_*`) only if targets miss.

- [ ] **Step 1: Baseline run with distance off**

Run: `npm run simulate`
Record: per-good stock band, price dispersion, and the greedy-vs-random credit gap from the summary. Confirm the faction-bloc topology (Phase A) still produces a non-degenerate, tradeable economy. If stocks pin to a bound or dispersion collapses, note which goods.

- [ ] **Step 2: Turn on distance attenuation**

Set `DISTANCE_DECAY` in `lib/constants/trade-simulation.ts` to a starting value of `0.05`. Run `npm run simulate`. Compare against the Step 1 baseline: distant intra-faction systems should equalize *less* (more dispersion across hops), gateways/low-fuelCost links more. Sweep `DISTANCE_DECAY` over `{0.02, 0.05, 0.1, 0.2}` and keep the value that preserves the `[5, 200]` band while adding visible distance-graded dispersion without starving far systems.

- [ ] **Step 3: Confirm `EDGES_PER_TICK` sweeps the universe in time**

Default scale (~600 systems): confirm no `[tradeFlow] INVARIANT` warning in the sim/dev logs (sweep < `FLOW_HISTORY_TICKS`). If the warning fires, raise `EDGES_PER_TICK` until `ceil(totalOpenEdges / EDGES_PER_TICK) < 200`. Document the chosen value's implied 10K-scale sweep length in the constant's comment.

- [ ] **Step 4: Re-tune flow constants only if a target misses**

If after Steps 2-3 a target still misses (stock out of band, dispersion gone, greedy not ≫ random), nudge `FLOW_BUDGET` / `GRADIENT_SENSITIVITY` and re-run. Coarse only — do not chase richer geography (that's SP3's build-space lever, per the spec §10).

- [ ] **Step 5: Commit the calibrated constants**

```bash
git add lib/constants/trade-simulation.ts
git commit -m "perf(economy): calibrate de-regioned diffusion (DISTANCE_DECAY, EDGES_PER_TICK)"
```

## Task 4: Update the docs

**Files:**
- Modify: `docs/active/gameplay/trade-simulation.md`
- Modify: `docs/active/gameplay/economy.md` (only the diffusion-topology mention, if any)

- [ ] **Step 1: Rewrite the topology section of `trade-simulation.md`**

Replace any description of "intra-region round-robin / region-bound flow" with the Part 0 model: flow crosses the full intra-faction graph (region lines ignored), faction borders closed, adjacent independents trade; scheduling is an `EDGES_PER_TICK` work-budget slice; distance attenuation `1/(1+DISTANCE_DECAY·fuelCost)`. State explicitly that **regions are now purely a load-shard/aggregate/gateway unit, not a flow boundary** — flow boundaries are sovereign (faction) borders. Record the calibrated `DISTANCE_DECAY` / `EDGES_PER_TICK` values.

- [ ] **Step 2: Note the SP2-Part-0 milestone in the spec**

In `docs/planned/economy-simulation-living-world.md` §5, mark Part 0 shipped (date + the calibrated constants), mirroring how the substrate spec records shipped parts.

- [ ] **Step 3: Commit**

```bash
git add docs/active/gameplay/trade-simulation.md docs/active/gameplay/economy.md docs/planned/economy-simulation-living-world.md
git commit -m "docs(economy): document de-regioned diffusion topology (SP2 Part 0)"
```

---

## Self-Review

**Spec coverage** (against `economy-simulation-living-world.md` §5):
- Topology = intra-faction sub-graph, region lines ignored → Task 2 (`getOpenEdges` faction filter). ✓
- Faction borders hard-closed; independents permeable pool (null===null) → Task 2 tests + filter. ✓
- Distance attenuation; gateways low-friction → Task 2 (`distanceFactor`) + Task 3 (calibrate). ✓
- Sharding = work-budget slices, not per-faction → Task 2 (`edgesPerTick` cursor). ✓
- Recalibration → Task 3. ✓
- "No reseed, no schema change" → confirmed (factionId/fuelCost pre-exist). ✓
- Accepted limitation (resource-awkward factions) → no code; observed in Task 3, not fixed. ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to". The one `tsc`-driven step (Task 1 Step 5) is a concrete mechanical propagation, not a vague instruction. Calibration steps are procedural by nature (run-observe-adjust), with exact commands. ✓

**Type consistency:** `getOpenEdges` / `getMarketSnapshotsForSystems` / `getRecentPlayerVolumeBySystem` and `EdgeView.fuelCost` / `TradeFlowProcessorParams` (`edgesPerTick`, `distanceDecay`) are used identically across the interface, both adapters, the body, and the live wiring. `InMemoryTradeFlowWorld` ctor `(initial, connections, playerVolumeBySystem?)` matches all three call sites (Task 2 Step 9). ✓

**Note:** Part 0 deliberately leaves prosperity untouched (`tradeVolumeAccum`, `prosperityTargetVolume`); its retirement is SP2 Part 1, a separate plan.
