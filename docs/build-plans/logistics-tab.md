# Logistics Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a system-panel **Logistics** tab that pairs an internal production-vs-consumption diverging-bar chart with an external imports-vs-exports chart (split by market/logistics flow type) over a volume-over-time series, and retire the now-superseded Overview Trade-Activity panel and Industry Trade-balance card.

**Architecture:** A new pure engine module (`lib/engine/logistics.ts`) aggregates raw `TradeFlow` rows into a per-good flow split and assembles the tier-grouped, net-sorted, aligned row model — all unit-tested. A thin service (`getSystemLogistics`) composes that with the existing `capacityGoodRates` production/consumption source, visibility-gated. A new reusable `DivergingBars` UI primitive (generalised from the existing `SubstrateTradeBars`) renders both charts; the `LogisticsPanel` composes the two-column tier-grouped layout and the reused `VolumeSparkline`.

**Tech Stack:** Next.js 16 (App Router), TypeScript 5 strict, Prisma 7 + `@prisma/adapter-pg`, TanStack Query v5 (Suspense), Recharts, Tailwind v4, Vitest 4.

**Branch:** Continue on `feat/logistics-tab` (the spec is already committed there as `b788ab8`).

**Spec:** `docs/planned/logistics-imports-exports-tab.md`

## Global Constraints

Copied verbatim from project conventions — every task's requirements implicitly include these:

- **No `as` type assertions** except `as const` and inside `lib/types/guards.ts`.
- **No `unknown`** anywhere (only narrowed `JSON.parse` at boundaries).
- **Discriminated unions for result/state types:** `{ visibility: "visible"; … } | { visibility: "unknown" }`, never optional-field bags.
- **No postfix `!`** non-null assertion (except `find(...)!` in tests, the project idiom).
- Engine functions are **pure** — zero DB imports. Never statically import `@/lib/prisma` (directly or transitively) into a unit-tested module graph.
- API responses use `ApiResponse<T>` (`{ data?, error? }`); auth-gated routes set `Cache-Control: private, no-cache` (never `public`/`immutable`).
- Services own DB/business logic; route handlers are thin wrappers; components use TanStack `useSuspenseQuery` hooks wrapped in `QueryBoundary`.
- Tick-changing data uses a tick-scoped query key invalidated by `useTickInvalidation`.
- Tailwind v4 theme tokens only (`bg-surface-active`, `text-status-green-light`, `border-strong`, etc.); Foundry theme = sharp corners, `font-display` headings, `font-mono` numerics.
- Tests: `npx vitest run`. Verify engine purity with `unset DATABASE_URL; npx vitest run --project unit <test>` (the unit project sets no `DATABASE_URL`; a prisma-tainted import makes the file load-fail with "no tests run").

---

## File Structure

**Create:**
- `lib/engine/logistics.ts` — pure aggregation + row-model builder (`aggregateLogisticsFlows`, `buildLogisticsRows`, `GoodFlowAggregate`, `LogisticsFlowRow`, `LogisticsRowModel`).
- `lib/engine/__tests__/logistics.test.ts` — unit tests for the above.
- `lib/hooks/use-system-logistics.ts` — suspense hook.
- `app/api/game/systems/[systemId]/logistics/route.ts` — thin GET wrapper.
- `components/ui/diverging-bars.tsx` — reusable diverging-bar primitive.
- `components/system/volume-sparkline.tsx` — extracted, prop-driven sparkline (red/green).
- `components/system/logistics-panel.tsx` — the tab content.
- `app/(game)/@panel/system/[systemId]/logistics/page.tsx` — the route segment.

**Modify:**
- `lib/types/api.ts` — add `LogisticsGoodRow`, `SystemLogisticsData`, `SystemLogisticsResponse`.
- `lib/services/trade-flow.ts` — add `getSystemLogistics`.
- `lib/query/keys.ts` — add `systemLogistics*` keys.
- `lib/hooks/use-tick-invalidation.ts` — invalidate logistics on ship/economy ticks.
- `app/(game)/@panel/system/[systemId]/layout.tsx` — insert the Logistics tab between Industry and Market.
- `components/system/industry-panel.tsx` — remove the Trade-balance card.
- `app/(game)/@panel/system/[systemId]/page.tsx` — remove the Trade-Activity section.

**Delete (final cleanup task):**
- `components/system/trade-activity-panel.tsx`, `components/system/substrate-trade-bars.tsx`.
- `getSystemTradeFlow` + `rankGoodFlows` + `useSystemTradeFlow` + the `trade-flow` route + `SystemTradeFlowData`/`TradeFlowGoodSummary` types + `systemTradeFlow*` keys + their tick-invalidation lines + `prepareTradeBars` (+ its tests).

---

## Task 1: Logistics API types

**Files:**
- Modify: `lib/types/api.ts` (import block ~line 1-26; add a new section near the trade-flow types ~line 90)

**Interfaces:**
- Produces: `LogisticsGoodRow`, `SystemLogisticsData` (discriminated on `visibility`), `SystemLogisticsResponse` — consumed by Tasks 2, 4, 5, 8.

- [ ] **Step 1: Add `GoodTier` to the game-types import**

In the `import type { … } from "@/lib/types/game"` block at the top of `lib/types/api.ts`, add `GoodTier,` to the list (e.g. after `SunClass,`).

- [ ] **Step 2: Add the logistics types**

Append after the `SystemTradeFlowResponse` line (~line 90):

```ts
// ── System logistics (production/consumption + imports/exports dashboard) ─────
/** One good's full logistics row: internal prod/con + external flow split + partners. */
export interface LogisticsGoodRow {
  goodId: string;
  goodName: string;
  tier: GoodTier;
  production: number;
  consumption: number;
  /** production − consumption. */
  internalNet: number;
  importMarket: number;
  importLogistics: number;
  exportMarket: number;
  exportLogistics: number;
  /** (exports total) − (imports total). */
  externalNet: number;
  /** Any of the four flow totals > 0. */
  traded: boolean;
  /** Top source systems feeding imports of this good. */
  importPartners: TradeFlowPartner[];
  /** Top destination systems receiving exports of this good. */
  exportPartners: TradeFlowPartner[];
}
export type SystemLogisticsData =
  | {
      visibility: "visible";
      /** Tier-ascending, net-descending-within-tier; one entry per good with activity. */
      rows: LogisticsGoodRow[];
      /** Largest single production/consumption rate across rows (internal bar scale). */
      internalMax: number;
      /** Largest single import/export total across rows (external bar scale). */
      externalMax: number;
      /** Goods with production or consumption activity. */
      activeGoodCount: number;
      /** Goods with any cross-border flow. */
      tradedGoodCount: number;
      volumeHistory: TradeFlowVolumeBucket[];
    }
  | { visibility: "unknown" };
export type SystemLogisticsResponse = ApiResponse<SystemLogisticsData>;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 4: Commit**

```bash
git add lib/types/api.ts
git commit -m "feat(logistics): add SystemLogistics API types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Engine — `buildLogisticsRows`

**Files:**
- Create: `lib/engine/logistics.ts`
- Test: `lib/engine/__tests__/logistics.test.ts`

**Interfaces:**
- Consumes: `LogisticsGoodRow`, `TradeFlowPartner` (Task 1); `SubstrateGoodRate` (`@/lib/engine/physical-economy`).
- Produces: `GoodFlowAggregate`, `LogisticsRowModel`, `buildLogisticsRows(prodCon, flowsByGood)` — consumed by Tasks 3, 4.

- [ ] **Step 1: Write the failing test**

Create `lib/engine/__tests__/logistics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildLogisticsRows, type GoodFlowAggregate } from "@/lib/engine/logistics";
import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";

const agg = (p: Partial<GoodFlowAggregate>): GoodFlowAggregate => ({
  importMarket: 0, importLogistics: 0, exportMarket: 0, exportLogistics: 0,
  importPartners: [], exportPartners: [], ...p,
});

describe("buildLogisticsRows", () => {
  // water t0 (+8), ore t0 (0), food t0 (-3), alloys t1 (-3)
  const prodCon: SubstrateGoodRate[] = [
    { goodId: "ore", production: 5, consumption: 5 },
    { goodId: "water", production: 10, consumption: 2 },
    { goodId: "food", production: 1, consumption: 4 },
    { goodId: "alloys", production: 0, consumption: 3 },
  ];

  it("groups by tier ascending, then net descending within tier", () => {
    const model = buildLogisticsRows(prodCon, new Map());
    expect(model.rows.map((r) => r.goodId)).toEqual(["water", "ore", "food", "alloys"]);
  });

  it("computes internal/external net and the traded flag", () => {
    const flows = new Map<string, GoodFlowAggregate>([
      ["water", agg({ exportMarket: 4, exportLogistics: 2 })],
      ["food", agg({ importMarket: 3, importLogistics: 1 })],
    ]);
    const model = buildLogisticsRows(prodCon, flows);
    const water = model.rows.find((r) => r.goodId === "water")!;
    expect(water.internalNet).toBe(8);
    expect(water.externalNet).toBe(6);
    expect(water.traded).toBe(true);
    const ore = model.rows.find((r) => r.goodId === "ore")!;
    expect(ore.traded).toBe(false);
    const food = model.rows.find((r) => r.goodId === "food")!;
    expect(food.externalNet).toBe(-4);
  });

  it("normalizes each column to its own max, and counts active/traded goods", () => {
    const flows = new Map<string, GoodFlowAggregate>([
      ["water", agg({ exportMarket: 4, exportLogistics: 2 })], // export total 6
      ["food", agg({ importMarket: 3, importLogistics: 1 })], // import total 4
    ]);
    const model = buildLogisticsRows(prodCon, flows);
    expect(model.internalMax).toBe(10); // water production
    expect(model.externalMax).toBe(6); // water export total
    expect(model.activeGoodCount).toBe(4);
    expect(model.tradedGoodCount).toBe(2);
  });

  it("includes a trade-only good with no prod/con, and drops fully-inactive goods", () => {
    const prod: SubstrateGoodRate[] = [{ goodId: "ore", production: 0, consumption: 0 }];
    const flows = new Map<string, GoodFlowAggregate>([
      ["chemicals", agg({ importMarket: 5 })],
    ]);
    const model = buildLogisticsRows(prod, flows);
    expect(model.rows.map((r) => r.goodId)).toEqual(["chemicals"]); // ore dropped (no activity)
  });

  it("resolves display name and tier", () => {
    const model = buildLogisticsRows([{ goodId: "water", production: 1, consumption: 0 }], new Map());
    expect(model.rows[0].goodName).toBe("Water");
    expect(model.rows[0].tier).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/__tests__/logistics.test.ts`
Expected: FAIL — "Failed to resolve import … lib/engine/logistics".

- [ ] **Step 3: Write the implementation**

Create `lib/engine/logistics.ts`:

```ts
/**
 * Pure builders for the per-system Logistics tab. The service in
 * `lib/services/trade-flow.ts` loads raw rows from Prisma and feeds them
 * through these helpers to produce the panel-facing shape.
 *
 * Pure: no Prisma, no I/O. Safe to unit-test against in-memory data.
 */

import { GOODS, GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";
import type { LogisticsGoodRow, TradeFlowPartner } from "@/lib/types/api";

/** Per-good cross-border flow totals (split by flow type) plus top partners. */
export interface GoodFlowAggregate {
  importMarket: number;
  importLogistics: number;
  exportMarket: number;
  exportLogistics: number;
  importPartners: TradeFlowPartner[];
  exportPartners: TradeFlowPartner[];
}

export interface LogisticsRowModel {
  rows: LogisticsGoodRow[];
  internalMax: number;
  externalMax: number;
  activeGoodCount: number;
  tradedGoodCount: number;
}

const EMPTY_AGG: GoodFlowAggregate = {
  importMarket: 0, importLogistics: 0, exportMarket: 0, exportLogistics: 0,
  importPartners: [], exportPartners: [],
};

/**
 * Assemble the aligned, tier-grouped row model from prod/con rates and the
 * per-good flow aggregate. Goods active in either source appear; goods with
 * neither prod/con nor flow are dropped. Rows are ordered tier-ascending then
 * internal-net-descending (stable by goodId), so both columns share one order.
 */
export function buildLogisticsRows(
  prodCon: ReadonlyArray<SubstrateGoodRate>,
  flowsByGood: ReadonlyMap<string, GoodFlowAggregate>,
): LogisticsRowModel {
  const prodConByGood = new Map(prodCon.map((g) => [g.goodId, g]));
  const goodIds = new Set<string>([...prodConByGood.keys(), ...flowsByGood.keys()]);

  const rows: LogisticsGoodRow[] = [];
  let internalMax = 0;
  let externalMax = 0;
  let activeGoodCount = 0;
  let tradedGoodCount = 0;

  for (const goodId of goodIds) {
    const pc = prodConByGood.get(goodId);
    const production = pc?.production ?? 0;
    const consumption = pc?.consumption ?? 0;
    const a = flowsByGood.get(goodId) ?? EMPTY_AGG;

    const importTotal = a.importMarket + a.importLogistics;
    const exportTotal = a.exportMarket + a.exportLogistics;
    const traded = importTotal > 0 || exportTotal > 0;
    const active = production > 0 || consumption > 0;
    if (!active && !traded) continue;

    if (active) activeGoodCount++;
    if (traded) tradedGoodCount++;
    internalMax = Math.max(internalMax, production, consumption);
    externalMax = Math.max(externalMax, importTotal, exportTotal);

    rows.push({
      goodId,
      goodName: GOODS[goodId]?.name ?? goodId,
      tier: GOOD_TIER_BY_KEY[goodId] ?? 0,
      production,
      consumption,
      internalNet: production - consumption,
      importMarket: a.importMarket,
      importLogistics: a.importLogistics,
      exportMarket: a.exportMarket,
      exportLogistics: a.exportLogistics,
      externalNet: exportTotal - importTotal,
      traded,
      importPartners: a.importPartners,
      exportPartners: a.exportPartners,
    });
  }

  rows.sort(
    (x, y) =>
      x.tier - y.tier ||
      y.internalNet - x.internalNet ||
      x.goodId.localeCompare(y.goodId),
  );

  return { rows, internalMax, externalMax, activeGoodCount, tradedGoodCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/__tests__/logistics.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/logistics.ts lib/engine/__tests__/logistics.test.ts
git commit -m "feat(logistics): pure tier-grouped row-model builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Engine — `aggregateLogisticsFlows`

**Files:**
- Modify: `lib/engine/logistics.ts`
- Test: `lib/engine/__tests__/logistics.test.ts`

**Interfaces:**
- Consumes: `SystemFlowRow` (`@/lib/engine/system-trade-flow`).
- Produces: `LogisticsFlowRow`, `aggregateLogisticsFlows(flows, systemId, resolveName)` → `Map<string, GoodFlowAggregate>` — consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Append to `lib/engine/__tests__/logistics.test.ts`:

```ts
import { aggregateLogisticsFlows, type LogisticsFlowRow } from "@/lib/engine/logistics";

describe("aggregateLogisticsFlows", () => {
  const SYS = "sys1";
  const resolveName = (id: string) => `${id}-name`;
  const flows: LogisticsFlowRow[] = [
    { tick: 1, fromSystemId: SYS, toSystemId: "A", goodId: "water", quantity: 4, flowType: "market" },
    { tick: 2, fromSystemId: SYS, toSystemId: "B", goodId: "water", quantity: 2, flowType: "logistics" },
    { tick: 3, fromSystemId: "C", toSystemId: SYS, goodId: "food", quantity: 3, flowType: "market" },
    { tick: 4, fromSystemId: "C", toSystemId: SYS, goodId: "food", quantity: 1, flowType: "logistics" },
  ];

  it("splits exports/imports by flow type", () => {
    const out = aggregateLogisticsFlows(flows, SYS, resolveName);
    expect(out.get("water")).toMatchObject({ exportMarket: 4, exportLogistics: 2, importMarket: 0 });
    expect(out.get("food")).toMatchObject({ importMarket: 3, importLogistics: 1, exportMarket: 0 });
  });

  it("ranks partners by quantity with resolved names", () => {
    const out = aggregateLogisticsFlows(flows, SYS, resolveName);
    expect(out.get("water")!.exportPartners).toEqual([
      { systemId: "A", systemName: "A-name", quantity: 4 },
      { systemId: "B", systemName: "B-name", quantity: 2 },
    ]);
    expect(out.get("food")!.importPartners).toEqual([
      { systemId: "C", systemName: "C-name", quantity: 4 },
    ]);
  });

  it("ignores non-positive quantities", () => {
    const out = aggregateLogisticsFlows(
      [{ tick: 1, fromSystemId: SYS, toSystemId: "A", goodId: "ore", quantity: 0, flowType: "market" }],
      SYS, resolveName,
    );
    expect(out.has("ore")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/__tests__/logistics.test.ts`
Expected: FAIL — `aggregateLogisticsFlows` is not exported.

- [ ] **Step 3: Write the implementation**

Add to the top imports of `lib/engine/logistics.ts`:

```ts
import type { SystemFlowRow } from "@/lib/engine/system-trade-flow";
```

Append to `lib/engine/logistics.ts`:

```ts
/** A flow row carrying its flow type, for the import/export split. */
export interface LogisticsFlowRow extends SystemFlowRow {
  flowType: string;
}

/** Partner systems shown per good in the import/export tooltips. */
const TOP_PARTNERS = 3;

/**
 * Aggregate one system's flow rows into per-good import/export totals split by
 * flow type ("logistics" = directed, anything else = market diffusion), plus
 * the top contributing partner systems for each direction.
 */
export function aggregateLogisticsFlows(
  flows: ReadonlyArray<LogisticsFlowRow>,
  systemId: string,
  resolveName: (id: string) => string,
): Map<string, GoodFlowAggregate> {
  interface Acc {
    importMarket: number;
    importLogistics: number;
    exportMarket: number;
    exportLogistics: number;
    importByPartner: Map<string, number>;
    exportByPartner: Map<string, number>;
  }
  const byGood = new Map<string, Acc>();

  for (const f of flows) {
    if (f.quantity <= 0) continue;
    let acc = byGood.get(f.goodId);
    if (!acc) {
      acc = {
        importMarket: 0, importLogistics: 0, exportMarket: 0, exportLogistics: 0,
        importByPartner: new Map(), exportByPartner: new Map(),
      };
      byGood.set(f.goodId, acc);
    }
    const directed = f.flowType === "logistics";
    if (f.toSystemId === systemId) {
      if (directed) acc.importLogistics += f.quantity;
      else acc.importMarket += f.quantity;
      acc.importByPartner.set(f.fromSystemId, (acc.importByPartner.get(f.fromSystemId) ?? 0) + f.quantity);
    } else if (f.fromSystemId === systemId) {
      if (directed) acc.exportLogistics += f.quantity;
      else acc.exportMarket += f.quantity;
      acc.exportByPartner.set(f.toSystemId, (acc.exportByPartner.get(f.toSystemId) ?? 0) + f.quantity);
    }
  }

  const topPartners = (m: Map<string, number>): TradeFlowPartner[] =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_PARTNERS)
      .map(([id, quantity]) => ({ systemId: id, systemName: resolveName(id), quantity }));

  const out = new Map<string, GoodFlowAggregate>();
  for (const [goodId, acc] of byGood) {
    out.set(goodId, {
      importMarket: acc.importMarket,
      importLogistics: acc.importLogistics,
      exportMarket: acc.exportMarket,
      exportLogistics: acc.exportLogistics,
      importPartners: topPartners(acc.importByPartner),
      exportPartners: topPartners(acc.exportByPartner),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/__tests__/logistics.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/logistics.ts lib/engine/__tests__/logistics.test.ts
git commit -m "feat(logistics): per-good flow-type aggregation with partners

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Service — `getSystemLogistics`

**Files:**
- Modify: `lib/services/trade-flow.ts`

**Interfaces:**
- Consumes: `aggregateLogisticsFlows`, `buildLogisticsRows`, `LogisticsFlowRow` (Tasks 2-3); `capacityGoodRates` (`@/lib/engine/industry`); `resourceVectorFromColumns` (`@/lib/engine/resources`); `bucketizeVolumeHistory` (already imported); `getPlayerVisibility`.
- Produces: `getSystemLogistics(playerId, systemId): Promise<SystemLogisticsData>` — consumed by Task 5.

- [ ] **Step 1: Add imports**

At the top of `lib/services/trade-flow.ts`, add:

```ts
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { capacityGoodRates } from "@/lib/engine/industry";
import {
  aggregateLogisticsFlows,
  buildLogisticsRows,
  type LogisticsFlowRow,
} from "@/lib/engine/logistics";
```

And extend the existing `lib/types/api` import to include `SystemLogisticsData`:

```ts
import type {
  SystemTradeFlowData,
  TradeFlowEdges,
  SystemLogisticsData,
} from "@/lib/types/api";
```

- [ ] **Step 2: Add the service function**

Append to `lib/services/trade-flow.ts`:

```ts
/**
 * Per-system Logistics tab data: internal production/consumption rates +
 * external imports/exports (split by flow type) + the volume-over-time series.
 * Visibility-gated: an unsurveyed system returns `{ visibility: "unknown" }`.
 */
export async function getSystemLogistics(
  playerId: string,
  systemId: string,
): Promise<SystemLogisticsData> {
  const { visibleSet, currentTick } = await getPlayerVisibility(playerId);
  if (!visibleSet.has(systemId)) return { visibility: "unknown" };

  const minTick = currentTick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;

  const [system, flows] = await Promise.all([
    prisma.starSystem.findUnique({
      where: { id: systemId },
      relationLoadStrategy: "join",
      select: {
        population: true,
        yieldGas: true, yieldMinerals: true, yieldOre: true, yieldBiomass: true,
        yieldArable: true, yieldWater: true, yieldRadioactive: true,
        buildings: { select: { buildingType: true, count: true } },
      },
    }),
    prisma.tradeFlow.findMany({
      where: {
        tick: { gt: minTick },
        OR: [{ fromSystemId: systemId }, { toSystemId: systemId }],
      },
      select: {
        tick: true, fromSystemId: true, toSystemId: true,
        goodId: true, quantity: true, flowType: true,
      },
    }),
  ]);

  if (!system) return { visibility: "unknown" };

  const buildings: Record<string, number> = {};
  for (const b of system.buildings) buildings[b.buildingType] = b.count;
  const yields = resourceVectorFromColumns(
    {
      yieldGas: system.yieldGas, yieldMinerals: system.yieldMinerals, yieldOre: system.yieldOre,
      yieldBiomass: system.yieldBiomass, yieldArable: system.yieldArable,
      yieldWater: system.yieldWater, yieldRadioactive: system.yieldRadioactive,
    },
    "yield",
  );
  const prodCon = capacityGoodRates(buildings, system.population, yields);

  // Resolve partner system names once (no N+1) for the source/destination tooltips.
  const partnerIds = new Set<string>();
  for (const f of flows) {
    partnerIds.add(f.fromSystemId === systemId ? f.toSystemId : f.fromSystemId);
  }
  const partnerRows = await prisma.starSystem.findMany({
    where: { id: { in: [...partnerIds] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(partnerRows.map((r) => [r.id, r.name]));
  const resolveName = (id: string): string => nameById.get(id) ?? "Unknown System";

  const flowRows: LogisticsFlowRow[] = flows;
  const flowsByGood = aggregateLogisticsFlows(flowRows, systemId, resolveName);
  const model = buildLogisticsRows(prodCon, flowsByGood);

  return {
    visibility: "visible",
    rows: model.rows,
    internalMax: model.internalMax,
    externalMax: model.externalMax,
    activeGoodCount: model.activeGoodCount,
    tradedGoodCount: model.tradedGoodCount,
    volumeHistory: bucketizeVolumeHistory(flows, systemId, currentTick),
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (If `LogisticsFlowRow` assignment complains, the `flows` select shape carries `flowType: string` and the four `SystemFlowRow` fields — it satisfies `LogisticsFlowRow`.)

- [ ] **Step 4: Commit**

```bash
git add lib/services/trade-flow.ts
git commit -m "feat(logistics): getSystemLogistics service (prod/con + flow split)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Endpoint wiring — query key, route, hook, invalidation

**Files:**
- Modify: `lib/query/keys.ts`
- Create: `app/api/game/systems/[systemId]/logistics/route.ts`
- Create: `lib/hooks/use-system-logistics.ts`
- Modify: `lib/hooks/use-tick-invalidation.ts`

**Interfaces:**
- Consumes: `getSystemLogistics` (Task 4); `SystemLogisticsData`/`SystemLogisticsResponse` (Task 1).
- Produces: `queryKeys.systemLogistics(id)`, `useSystemLogistics(id)` — consumed by Task 8.

- [ ] **Step 1: Add the query keys**

In `lib/query/keys.ts`, after the `systemIndustry` lines (~line 46), add:

```ts
  // Per-system logistics (imports/exports + prod/con dashboard) — tick-invalidated.
  systemLogisticsAll: ["systemLogistics"] as const,
  systemLogistics: (systemId: string) => ["systemLogistics", systemId] as const,
```

- [ ] **Step 2: Create the API route**

Create `app/api/game/systems/[systemId]/logistics/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getSystemLogistics } from "@/lib/services/trade-flow";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemLogisticsResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/systems/[systemId]/logistics",
    async () => {
      const auth = await requirePlayer();
      if (isErrorResponse(auth)) return auth;

      const { systemId } = await params;
      const data = await getSystemLogistics(auth.playerId, systemId);
      return NextResponse.json<SystemLogisticsResponse>(
        { data },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}
```

- [ ] **Step 3: Create the hook**

Create `lib/hooks/use-system-logistics.ts`:

```ts
"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemLogisticsData } from "@/lib/types/api";

/**
 * Per-system logistics (prod/con + imports/exports) for the Logistics tab.
 * Tick-scoped — invalidated by useTickInvalidation on shipArrived/economyTick.
 * Visibility-gated server-side; unsurveyed systems return `visibility: "unknown"`.
 */
export function useSystemLogistics(systemId: string): SystemLogisticsData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemLogistics(systemId),
    queryFn: () =>
      apiFetch<SystemLogisticsData>(`/api/game/systems/${systemId}/logistics`),
  });
  return data;
}
```

- [ ] **Step 4: Register tick invalidation**

In `lib/hooks/use-tick-invalidation.ts`, add a line inside **both** the `shipArrived` and `economyTick` subscribers (next to the existing `systemTradeFlowAll`/`systemIndustryAll` invalidations):

```ts
        queryClient.invalidateQueries({ queryKey: queryKeys.systemLogisticsAll });
```

- [ ] **Step 5: Typecheck + dev smoke**

Run: `npx tsc --noEmit`
Expected: PASS.

Then start the dev server (`npm run dev`), log in, and request the endpoint for a visible system in the browser devtools/network or via the app once Task 8 lands. Quick check now: navigate to `/api/game/systems/<aVisibleSystemId>/logistics` while authenticated — expect `{ "data": { "visibility": "visible", "rows": [...], "internalMax": …, "externalMax": …, "volumeHistory": [...] } }` (or `"unknown"` for an unsurveyed system).

- [ ] **Step 6: Commit**

```bash
git add lib/query/keys.ts app/api/game/systems/[systemId]/logistics/route.ts lib/hooks/use-system-logistics.ts lib/hooks/use-tick-invalidation.ts
git commit -m "feat(logistics): logistics endpoint, hook, query key + tick invalidation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Extract `VolumeSparkline` (prop-driven, red/green)

**Files:**
- Create: `components/system/volume-sparkline.tsx`
- Modify: `components/system/trade-activity-panel.tsx` (re-point import; keeps it working until removed in Task 11)

**Interfaces:**
- Produces: `VolumeSparkline({ buckets })` — consumed by Tasks 8 and (temporarily) the trade-activity panel.

- [ ] **Step 1: Create the standalone component**

Create `components/system/volume-sparkline.tsx`:

```tsx
"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import { CHART_THEME } from "@/lib/constants/ui";
import type { TradeFlowVolumeBucket } from "@/lib/types/api";

// Direction colours match the diverging bars: imports red (in), exports green (out).
const IMPORT_COLOR = "#ef4444";
const EXPORT_COLOR = "#22c55e";

/** Bucketed import vs export volume over the flow-history window. */
export function VolumeSparkline({ buckets }: { buckets: TradeFlowVolumeBucket[] }) {
  const data = buckets.map((b) => ({
    tick: b.tick,
    imports: b.importVolume,
    exports: b.exportVolume,
  }));

  return (
    <div className="w-full h-32">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.gridStroke} />
          <XAxis
            dataKey="tick"
            stroke={CHART_THEME.axisStroke}
            tick={{ fill: CHART_THEME.tickFill, fontSize: CHART_THEME.tickFontSize }}
            tickFormatter={(v: number) => `t${v}`}
            minTickGap={32}
          />
          <YAxis
            stroke={CHART_THEME.axisStroke}
            tick={{ fill: CHART_THEME.tickFill, fontSize: CHART_THEME.tickFontSize }}
            width={28}
          />
          <ChartTooltip
            labelFormatter={(label) => `Tick ${label}`}
            formatter={(value, name) => [
              `${value ?? 0} units`,
              name === "imports" ? "Imports" : "Exports",
            ]}
          />
          <Line type="monotone" dataKey="imports" stroke={IMPORT_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: IMPORT_COLOR }} />
          <Line type="monotone" dataKey="exports" stroke={EXPORT_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: EXPORT_COLOR }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Re-point the old panel at the extracted component**

In `components/system/trade-activity-panel.tsx`: delete the local `VolumeSparkline` function (the `interface VolumeSparklineProps` + `function VolumeSparkline(...)` block, ~lines 168-240) and the now-unused Recharts / `ChartTooltip` / `CHART_THEME` / `TIER_COLOR` / `pixiHexToCss` / `SPARKLINE_*` imports and `TradeFlowVolumeBucket` type import. Add:

```tsx
import { VolumeSparkline } from "@/components/system/volume-sparkline";
```

(The JSX `<VolumeSparkline buckets={volumeHistory} />` call already matches the new signature.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS, no unused-import errors.

- [ ] **Step 4: Commit**

```bash
git add components/system/volume-sparkline.tsx components/system/trade-activity-panel.tsx
git commit -m "refactor(logistics): extract prop-driven VolumeSparkline (imports red / exports green)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `DivergingBars` UI primitive

**Files:**
- Create: `components/ui/diverging-bars.tsx`

**Interfaces:**
- Produces: `DivergingBars({ rows, maxValue })`, `BarSegment`, `DivergingBarRow` — consumed by Task 8.

- [ ] **Step 1: Create the component**

Create `components/ui/diverging-bars.tsx`:

```tsx
/**
 * Reusable diverging-bar list: each row grows a left stack from a centre
 * divider and a right stack from it, normalised to a shared `maxValue` so
 * multiple instances (e.g. per tier) share one scale. Segments carry a
 * direction colour (in = red, out = green) and a solid/hatch pattern.
 * Generalised from the former SubstrateTradeBars.
 */

export interface BarSegment {
  value: number;
  side: "left" | "right";
  /** in = consumption/imports (red); out = production/exports (green). */
  color: "in" | "out";
  pattern: "solid" | "hatch";
}

export interface DivergingBarRow {
  key: string;
  label: string;
  net: number;
  netLabel: string;
  segments: BarSegment[];
  /** Render the label muted and skip the bar track (e.g. an un-traded good). */
  blank?: boolean;
  muted?: boolean;
  /** Native hover tooltip text (e.g. partner sources/destinations). */
  title?: string;
}

const FILL: Record<"in" | "out", string> = {
  in: "rgba(239,68,68,0.8)",
  out: "rgba(34,197,94,0.8)",
};
const HATCH = "repeating-linear-gradient(135deg, rgba(0,0,0,0.5) 0 2px, transparent 2px 5px)";

function netClass(net: number): string {
  if (net > 0) return "text-status-green-light";
  if (net < 0) return "text-status-red-light";
  return "text-text-tertiary";
}

function Segments({ segments, max }: { segments: BarSegment[]; max: number }) {
  return (
    <>
      {segments.map((s, i) => (
        <div
          key={i}
          className="h-full"
          style={{
            width: max > 0 ? `${(s.value / max) * 100}%` : "0%",
            backgroundColor: FILL[s.color],
            backgroundImage: s.pattern === "hatch" ? HATCH : undefined,
          }}
        />
      ))}
    </>
  );
}

export function DivergingBars({ rows, maxValue }: { rows: DivergingBarRow[]; maxValue: number }) {
  return (
    <div className="space-y-1.5">
      {rows.map((row) => {
        const left = row.segments.filter((s) => s.side === "left");
        const right = row.segments.filter((s) => s.side === "right");
        return (
          <div key={row.key} className="flex items-center gap-2" title={row.title}>
            <span className={`w-24 shrink-0 truncate text-xs ${row.muted ? "text-text-tertiary" : "text-text-secondary"}`}>
              {row.label}
            </span>
            {row.blank ? (
              <div className="flex-1" />
            ) : (
              <div className="flex flex-1 items-center">
                {/* left stack fills toward the divider */}
                <div className="flex h-2.5 flex-1 justify-end overflow-hidden bg-surface-active">
                  <Segments segments={left} max={maxValue} />
                </div>
                <div className="h-3.5 w-px shrink-0 bg-border-strong" />
                {/* right stack fills away from the divider */}
                <div className="flex h-2.5 flex-1 overflow-hidden bg-surface-active">
                  <Segments segments={right} max={maxValue} />
                </div>
              </div>
            )}
            <span className={`w-12 shrink-0 text-right font-mono text-xs ${row.blank ? "text-text-tertiary opacity-50" : netClass(row.net)}`}>
              {row.blank ? "·" : row.netLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/ui/diverging-bars.tsx
git commit -m "feat(logistics): reusable DivergingBars primitive (solid/hatch segments)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `LogisticsPanel` + route segment + tab registration

**Files:**
- Create: `components/system/logistics-panel.tsx`
- Create: `app/(game)/@panel/system/[systemId]/logistics/page.tsx`
- Modify: `app/(game)/@panel/system/[systemId]/layout.tsx` (insert tab between Industry and Market)

**Interfaces:**
- Consumes: `useSystemLogistics` (Task 5), `DivergingBars`/`DivergingBarRow` (Task 7), `VolumeSparkline` (Task 6), `LogisticsGoodRow`/`TradeFlowPartner` (Task 1), `TIER_COLOR`/`TIER_LABEL`/`pixiHexToCss` (`@/lib/constants/good-colors`), `GoodTier` (`@/lib/types/game`).

- [ ] **Step 1: Create the panel**

Create `components/system/logistics-panel.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { useSystemLogistics } from "@/lib/hooks/use-system-logistics";
import { DivergingBars, type DivergingBarRow } from "@/components/ui/diverging-bars";
import { VolumeSparkline } from "@/components/system/volume-sparkline";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TIER_COLOR, TIER_LABEL, pixiHexToCss } from "@/lib/constants/good-colors";
import type { GoodTier } from "@/lib/types/game";
import type { LogisticsGoodRow, TradeFlowPartner } from "@/lib/types/api";

const TIERS: GoodTier[] = [0, 1, 2];

function fmtNet(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? "+" : ""}${r}`;
}

function partnerTitle(label: string, partners: TradeFlowPartner[]): string | null {
  if (partners.length === 0) return null;
  return `${label}:\n` + partners.map((p) => `${p.systemName} — ${Math.round(p.quantity)}`).join("\n");
}

function internalRow(g: LogisticsGoodRow): DivergingBarRow {
  return {
    key: g.goodId,
    label: g.goodName,
    net: g.internalNet,
    netLabel: fmtNet(g.internalNet),
    title: `Produces ${g.production.toFixed(1)}/cyc · Consumes ${g.consumption.toFixed(1)}/cyc`,
    segments: [
      { value: g.consumption, side: "left", color: "in", pattern: "solid" },
      { value: g.production, side: "right", color: "out", pattern: "solid" },
    ],
  };
}

function externalRow(g: LogisticsGoodRow): DivergingBarRow {
  if (!g.traded) {
    return { key: g.goodId, label: g.goodName, net: 0, netLabel: "·", blank: true, muted: true, segments: [] };
  }
  const title = [partnerTitle("Sources", g.importPartners), partnerTitle("Destinations", g.exportPartners)]
    .filter((s): s is string => s !== null)
    .join("\n");
  return {
    key: g.goodId,
    label: g.goodName,
    net: g.externalNet,
    netLabel: fmtNet(g.externalNet),
    title: title || undefined,
    segments: [
      // imports (left): hatch market then solid logistics → solid sits at the divider
      { value: g.importMarket, side: "left", color: "in", pattern: "hatch" },
      { value: g.importLogistics, side: "left", color: "in", pattern: "solid" },
      // exports (right): solid logistics then hatch market → solid sits at the divider
      { value: g.exportLogistics, side: "right", color: "out", pattern: "solid" },
      { value: g.exportMarket, side: "right", color: "out", pattern: "hatch" },
    ],
  };
}

export function LogisticsPanel({ systemId }: { systemId: string }) {
  const data = useSystemLogistics(systemId);

  const byTier = useMemo(() => {
    if (data.visibility !== "visible") return null;
    const map = new Map<GoodTier, LogisticsGoodRow[]>();
    for (const g of data.rows) {
      const arr = map.get(g.tier) ?? [];
      arr.push(g);
      map.set(g.tier, arr);
    }
    return map;
  }, [data]);

  if (data.visibility === "unknown") {
    return <EmptyState message="Scan this system with a ship in range to survey its logistics." />;
  }
  if (data.rows.length === 0) {
    return <EmptyState message="No logistics activity — this system neither produces, consumes, nor trades." />;
  }

  return (
    <div className="space-y-4">
      <Card variant="bordered" padding="md">
        {/* column headers + legends */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-baseline justify-between">
              <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-text-primary">Internal · production vs consumption</h4>
              <span className="font-mono text-[10px] text-text-tertiary">{data.activeGoodCount} goods</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-text-tertiary">
              <span className="w-24 shrink-0" />
              <div className="flex flex-1 justify-between"><span>&#9664; Consumes</span><span>Produces &#9654;</span></div>
              <span className="w-12 shrink-0 text-right">Net/cyc</span>
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-text-primary">External · imports vs exports</h4>
              <span className="font-mono text-[10px] text-text-tertiary">trades {data.tradedGoodCount}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-text-tertiary">
              <span className="w-24 shrink-0" />
              <div className="flex flex-1 justify-between"><span>&#9664; Imports</span><span>Exports &#9654;</span></div>
              <span className="w-12 shrink-0 text-right">Net</span>
            </div>
          </div>
        </div>

        {/* flow-split legend */}
        <div className="mt-2 flex items-center gap-4 border-t border-border pt-2 text-[10px] text-text-tertiary">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-5" style={{ backgroundColor: "rgba(34,197,94,0.8)" }} /> directed logistics
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-5" style={{ backgroundColor: "rgba(34,197,94,0.8)", backgroundImage: "repeating-linear-gradient(135deg, rgba(0,0,0,0.5) 0 2px, transparent 2px 5px)" }} /> market diffusion
          </span>
        </div>

        {/* tier groups */}
        {TIERS.map((tier) => {
          const rows = byTier?.get(tier) ?? [];
          if (rows.length === 0) return null;
          return (
            <div key={tier} className="mt-3">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="h-2 w-2 shrink-0" style={{ backgroundColor: pixiHexToCss(TIER_COLOR[tier]) }} />
                <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">{TIER_LABEL[tier]}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <DivergingBars rows={rows.map(internalRow)} maxValue={data.internalMax} />
                <DivergingBars rows={rows.map(externalRow)} maxValue={data.externalMax} />
              </div>
            </div>
          );
        })}
      </Card>

      <Card variant="bordered" padding="md">
        <h4 className="mb-1 font-display text-xs font-semibold uppercase tracking-wider text-text-primary">Trade volume over time</h4>
        <VolumeSparkline buckets={data.volumeHistory} />
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Create the route segment**

Create `app/(game)/@panel/system/[systemId]/logistics/page.tsx`:

```tsx
"use client";

import { use } from "react";
import { LogisticsPanel } from "@/components/system/logistics-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";

export default function LogisticsPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  return (
    <QueryBoundary>
      <LogisticsPanel systemId={systemId} />
    </QueryBoundary>
  );
}
```

- [ ] **Step 3: Register the tab between Industry and Market**

In `app/(game)/@panel/system/[systemId]/layout.tsx`, in the `tabs` array, insert the Logistics entry between the `Industry` and `Market` lines:

```ts
    { label: "Industry", href: `${basePath}/industry`, active: pathname.startsWith(`${basePath}/industry`), badge: 0 },
    { label: "Logistics", href: `${basePath}/logistics`, active: pathname.startsWith(`${basePath}/logistics`), badge: 0 },
    { label: "Market", href: `${basePath}/market`, active: pathname.startsWith(`${basePath}/market`), badge: 0 },
```

- [ ] **Step 4: Typecheck + visual smoke**

Run: `npx tsc --noEmit`
Expected: PASS.

Then `npm run dev`, open a developed, surveyed system, click the **Logistics** tab. Verify: two-column charts grouped Raw/Processed/Advanced with tier bands; internal bars solid red/green; external bars show solid-vs-hatch split; un-traded goods render blank with a `·`; hover an external good to see source/destination partners; the volume series renders with imports red / exports green. (This is the user's visual smoke checkpoint.)

- [ ] **Step 5: Commit**

```bash
git add components/system/logistics-panel.tsx "app/(game)/@panel/system/[systemId]/logistics/page.tsx" "app/(game)/@panel/system/[systemId]/layout.tsx"
git commit -m "feat(logistics): Logistics tab panel, route segment, and tab registration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Remove the Industry Trade-balance card

**Files:**
- Modify: `components/system/industry-panel.tsx`

- [ ] **Step 1: Remove the card JSX**

Delete the entire `{/* Trade balance … */}` block (the `{hasFlow && ( … )}` `<Card>` containing `SectionHeader`, the explainer `<p>`, `<EconomyCycleCaption …>`, and `<SubstrateTradeBars goods={goods} />`, ~lines 319-330).

- [ ] **Step 2: Remove now-unused imports and locals**

In `components/system/industry-panel.tsx`:
- Remove `import { SubstrateTradeBars } from "@/components/system/substrate-trade-bars";`
- Remove `import { EconomyCycleCaption } from "@/components/system/economy-cycle-caption";`
- Remove `goods` and `economyShardGroup` from the `const { … } = data;` destructure (~line 210) **if** no longer referenced elsewhere in the file, and delete the `const hasFlow = …` line (~line 243). (Grep the file for `goods`, `economyShardGroup`, `hasFlow`, `SectionHeader` after editing; remove the `SectionHeader` import only if it has no other use.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — no unused-variable/import errors.

- [ ] **Step 4: Visual smoke**

`npm run dev` → open a system's **Industry** tab → confirm buildings/land/health still render and the Trade-balance card is gone.

- [ ] **Step 5: Commit**

```bash
git add components/system/industry-panel.tsx
git commit -m "refactor(logistics): drop Industry Trade-balance card (moved to Logistics)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Remove the Overview Trade-Activity section

**Files:**
- Modify: `app/(game)/@panel/system/[systemId]/page.tsx`

- [ ] **Step 1: Remove the section + import**

In `app/(game)/@panel/system/[systemId]/page.tsx`:
- Delete the Trade-Activity block (the comment + `<QueryBoundary><TradeActivityPanel systemId={systemId} /></QueryBoundary>`, ~lines 351-355).
- Delete `import { TradeActivityPanel } from "@/components/system/trade-activity-panel";` (~line 19).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Visual smoke**

`npm run dev` → open a system's **Overview** → confirm it renders and no longer shows Trade Activity.

- [ ] **Step 4: Commit**

```bash
git add "app/(game)/@panel/system/[systemId]/page.tsx"
git commit -m "refactor(logistics): remove Trade-Activity section from system Overview

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Delete the superseded code

**Files:**
- Delete: `components/system/trade-activity-panel.tsx`, `components/system/substrate-trade-bars.tsx`
- Modify: `lib/services/trade-flow.ts`, `lib/engine/system-trade-flow.ts`, `lib/hooks/use-system-trade-flow.ts` (delete), `app/api/game/systems/[systemId]/trade-flow/route.ts` (delete), `lib/types/api.ts`, `lib/query/keys.ts`, `lib/hooks/use-tick-invalidation.ts`, `lib/utils/substrate.ts`, `lib/utils/__tests__/substrate.test.ts`

- [ ] **Step 1: Delete the dead component + hook + route files**

```bash
git rm components/system/trade-activity-panel.tsx components/system/substrate-trade-bars.tsx lib/hooks/use-system-trade-flow.ts "app/api/game/systems/[systemId]/trade-flow/route.ts"
```

- [ ] **Step 2: Remove `getSystemTradeFlow` from the service**

In `lib/services/trade-flow.ts`: delete the `getSystemTradeFlow` function (the block from its doc comment through its closing brace) and drop `rankGoodFlows` and `SystemTradeFlowData` from the imports (keep `bucketizeVolumeHistory`).

- [ ] **Step 3: Remove `rankGoodFlows` from the engine**

In `lib/engine/system-trade-flow.ts`: delete the `rankGoodFlows` function and the `TOP_GOODS_PER_DIRECTION` / `TOP_PARTNERS_PER_GOOD` constants and the now-unused `TradeFlowGoodSummary` import. Keep `SystemFlowRow`, `bucketizeVolumeHistory`, `VOLUME_HISTORY_BUCKETS`, and the `GOODS`/`TRADE_SIMULATION`/`TradeFlowVolumeBucket` imports they use.

- [ ] **Step 4: Remove dead types**

In `lib/types/api.ts`: delete `TradeFlowGoodSummary`, `SystemTradeFlowData`, and `SystemTradeFlowResponse`. Keep `TradeFlowPartner` and `TradeFlowVolumeBucket` (used by logistics).

- [ ] **Step 5: Remove dead query keys + invalidation**

- In `lib/query/keys.ts`: delete `systemTradeFlowAll` and `systemTradeFlow`.
- In `lib/hooks/use-tick-invalidation.ts`: delete the two `queryKeys.systemTradeFlowAll` invalidation lines (in `shipArrived` and `economyTick`).

- [ ] **Step 6: Remove `prepareTradeBars` + its tests**

- In `lib/utils/substrate.ts`: delete the `TradeBar` interface and the `prepareTradeBars` function and the now-unused `GOODS`/`SubstrateGoodRate` imports if they have no other use in the file (keep `bodyDepositFeatures` and its imports).
- In `lib/utils/__tests__/substrate.test.ts`: delete the entire `describe("prepareTradeBars", …)` block and the `prepareTradeBars` name from the top import (keep the `bodyDepositFeatures` describe and import).

- [ ] **Step 7: Verify nothing references the deleted symbols**

Run: `git grep -nE "getSystemTradeFlow|rankGoodFlows|SystemTradeFlowData|TradeFlowGoodSummary|useSystemTradeFlow|prepareTradeBars|SubstrateTradeBars|TradeActivityPanel|systemTradeFlow" -- ':!docs'`
Expected: **no matches**.

- [ ] **Step 8: Full test + build**

Run: `npx vitest run`
Expected: PASS (logistics + substrate `bodyDepositFeatures` tests green; no orphaned references).

Run: `npm run build`
Expected: PASS (clean production build).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore(logistics): delete superseded trade-activity panel, service, and helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Docs — promote spec to active, update SPEC, delete the build plan

**Files:**
- Modify: `docs/SPEC.md`, `docs/planned/economy-scaling-and-trade-rework.md`
- Move: `docs/planned/logistics-imports-exports-tab.md` → fold into `docs/active/gameplay/trade-simulation.md`
- Delete: `docs/build-plans/logistics-tab.md` (this file), `docs/planned/logistics-imports-exports-tab.md`

- [ ] **Step 1: Fold the functional description into the active trade-simulation doc**

In `docs/active/gameplay/trade-simulation.md`, add a short subsection describing the per-system **Logistics tab** (internal prod/con + external imports/exports with the market/logistics flow split + volume series) and noting that it replaced the Overview Trade-Activity panel and the Industry Trade-balance card. Pull the relevant detail from `docs/planned/logistics-imports-exports-tab.md`.

- [ ] **Step 2: Update SPEC.md**

In `docs/SPEC.md`, in the **Trade Simulation (Edge Flow)** section, change the "per-system 'Trade Activity' panel" sentence to reference the new **Logistics tab** (imports/exports + production/consumption, with a market-vs-directed-logistics split).

- [ ] **Step 3: Retire the planned docs**

- In `docs/planned/economy-scaling-and-trade-rework.md`, mark the **P4** decomposition line as shipped (or delete it, per the lifecycle).
- Delete `docs/planned/logistics-imports-exports-tab.md` and `docs/build-plans/logistics-tab.md`.

```bash
git rm docs/planned/logistics-imports-exports-tab.md docs/build-plans/logistics-tab.md
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(logistics): promote Logistics tab to active spec; retire plan + planned doc

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- Tab placement (between Industry & Market) → Task 8 Step 3.
- Two-column layout + volume series → Task 8.
- Internal chart (prod/con, solid) → `internalRow` (Task 8), data from `capacityGoodRates` (Task 4).
- External chart (imports/exports, flow-type hatch split, solid-at-divider) → `externalRow` (Task 8), aggregation (Task 3).
- Partner drill-down (source/destination hover) → `partnerTitle` (Task 8), partners (Task 3).
- Shared ordering (tier asc, net desc, aligned, blank un-traded) → `buildLogisticsRows` (Task 2) + `externalRow` blank (Task 8).
- Two scales, one order (independent normalization) → `internalMax`/`externalMax` (Task 2) consumed per-column (Task 8).
- Uniform red/green, no per-good colour → `FILL` in DivergingBars (Task 7).
- No gap label → not implemented anywhere (by design).
- Header meta ("N goods" / "trades N") → Task 8 column headers, counts from Task 2.
- Reusable `DivergingBars`; Recharts only for the series → Tasks 7, 6.
- Data layer (engine builder, `getSystemLogistics`, route, tick-invalidated hook, types) → Tasks 1-5.
- Migrations/removals (Overview panel, Industry card, delete `SubstrateTradeBars`/`prepareTradeBars`, salvage `VolumeSparkline`) → Tasks 6, 9, 10, 11.
- Edge cases (unsurveyed → EmptyState, no activity → EmptyState, all-zero normalization guard) → Task 8 + the `max > 0` guard in DivergingBars (Task 7) and `buildLogisticsRows`.
- Testing (engine units) → Tasks 2-3; service/UI verified by typecheck + smoke (no jsdom in the unit project).
- Docs lifecycle → Task 12.

**Placeholder scan:** No "TBD"/"handle errors"/"similar to" — every code step carries complete code; every command has expected output.

**Type consistency:** `GoodFlowAggregate`, `LogisticsFlowRow`, `LogisticsRowModel`, `LogisticsGoodRow`, `SystemLogisticsData`, `BarSegment`, `DivergingBarRow`, `getSystemLogistics`, `useSystemLogistics`, `queryKeys.systemLogistics(id)` are used identically across producing and consuming tasks. `internalMax`/`externalMax`/`activeGoodCount`/`tradedGoodCount` names match between Task 2 (produce), Task 4 (pass through), and Task 8 (consume).
