# Logistics Map Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independently-toggled "Logistics" map overlay that renders directed intra-faction hauls as tier-coloured curved arcs, distinct from the existing market-diffusion "Trade Flows" overlay.

**Architecture:** The engine already tags every `TradeFlow` row `"market"` or `"logistics"`. We (1) extract the service's edge-aggregation into a pure engine helper that partitions by flow type and applies a separate, lower inference floor to logistics; (2) carry two edge sets through the API → hook → map-data; (3) generalise the Pixi particle edge from a straight 2-point line to a polyline so one emitter draws both straight market dots and arced logistics convoys; (4) add a second overlay toggle. **No schema, economy, or simulator change.**

**Tech Stack:** Next.js 16, TypeScript 5 (strict), Prisma 7 (`groupBy`), TanStack Query v5, PixiJS v8, Vitest 4.

**Design spec:** `docs/plans/logistics-map-overlay.md` (read it first — it has the *why* behind every decision).

## Global Constraints

Copied verbatim from the project conventions; every task's requirements implicitly include these.

- **No `as` casts** except `as const` and inside `lib/types/guards.ts`. Fix types at the source.
- **No `unknown`** anywhere except `JSON.parse` at boundaries, narrowed immediately.
- **Engine = pure.** `lib/engine/**` imports zero DB. Unit-tested with Vitest.
- **Unit-test isolation:** never *statically* import `@/lib/prisma` (directly or transitively) into a unit-tested module graph — the `unit` project sets no `DATABASE_URL` and `lib/prisma.ts` throws at module load. Engine helpers here import only types + constants.
- **Avoid postfix `!`** — real null checks. Exception: `find(...)!` in tests is the project idiom (do not flag).
- **Discriminated unions** for result types, never `{ ok: boolean; data?; error? }`.
- **API responses** use `ApiResponse<T>` = `{ data?: T; error?: string }`.
- **Prisma singleton** from `@/lib/prisma`; never `new PrismaClient()`.
- **Foundry theme:** sharp corners; numeric values `font-mono`; reuse existing form/ui components (`CheckboxInput`, `Tooltip`).
- **Commits:** conventional-commit subjects (`feat(map): …`); end every commit message body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Branch:** all work on `feat/logistics-map-overlay` (already checked out).

---

## File structure

**Create**
- `lib/engine/trade-flow-edges.ts` — pure edge aggregation (`RawFlowRow`, `FlowEdgeSets`, `buildFlowEdges`).
- `lib/engine/__tests__/trade-flow-edges.test.ts` — unit tests for the above.
- `components/map/pixi/flow-arc.ts` — pure arc geometry (`Point`, `arcPolyline`, `cumulativeLengths`, `pointAtFraction`).
- `components/map/pixi/__tests__/flow-arc.test.ts` — unit tests for the above.

**Modify**
- `lib/constants/trade-simulation.ts` — add `LOGISTICS_ROUTE_FLOOR`.
- `lib/types/api.ts` — `TradeFlowEdges` interface; rewrap `TradeFlowResponse`.
- `lib/services/trade-flow.ts` — `getTradeFlowEdges` → `{ marketEdges, logisticsEdges }` via `buildFlowEdges`.
- `lib/hooks/use-trade-flow.ts` — `useTradeFlow(marketActive, logisticsActive)`.
- `lib/hooks/use-map-data.ts` — second edge map + `MapData.logisticsFlowEdges`.
- `components/map/star-map.tsx` — consume both edge sets.
- `components/map/pixi/objects/trade-flow-edge.ts` — polyline + style (generalised).
- `components/map/pixi/layers/trade-flow-layer.ts` — config-parameterised; `MARKET_FLOW_CONFIG` / `LOGISTICS_FLOW_CONFIG`.
- `components/map/pixi/theme.ts` — `LOGISTICS_FLOW` constants.
- `components/map/pixi/pixi-map-canvas.tsx` — instantiate + sync + destroy logistics layer.
- `lib/hooks/use-map-overlays.ts` — `logistics` overlay key.
- `components/map/map-session.ts` — persist `logistics`.
- `components/map/map-overlay-controls.tsx` — "Logistics" checkbox + legend.

**Testing approach note (deliberate deviation from the spec's "integration test"):** the spec proposed a Postgres integration test for the service. Instead, **all aggregation/partition/floor logic is extracted into a pure engine helper and unit-tested** (Task 1) — stronger and faster than an integration test for that logic, and matching the project's "type at the boundary, pure engine tested with Vitest" philosophy. The service becomes a thin Prisma wrapper verified by typecheck + the closing manual smoke (Task 7). Arc geometry is likewise unit-tested (Task 4). Pixi rendering is covered by the manual visual smoke.

---

### Task 1: Pure edge aggregation + logistics floor

**Files:**
- Create: `lib/engine/trade-flow-edges.ts`
- Create: `lib/engine/__tests__/trade-flow-edges.test.ts`
- Modify: `lib/constants/trade-simulation.ts` (add one constant)

**Interfaces:**
- Consumes: `TradeFlowEdgeInfo` from `@/lib/types/api` (existing: `{ fromSystemId, toSystemId, totalVolume, dominantGoodId, perGood }`).
- Produces:
  - `interface RawFlowRow { fromSystemId: string; toSystemId: string; goodId: string; quantity: number; flowType: string }`
  - `interface FlowEdgeSets { marketEdges: TradeFlowEdgeInfo[]; logisticsEdges: TradeFlowEdgeInfo[] }`
  - `function buildFlowEdges(rows: ReadonlyArray<RawFlowRow>, visibleSet: Set<string>, marketFloor: number, logisticsFloor: number): FlowEdgeSets`
  - `TRADE_SIMULATION.LOGISTICS_ROUTE_FLOOR: number`

- [ ] **Step 1: Add the logistics floor constant**

In `lib/constants/trade-simulation.ts`, add inside the `TRADE_SIMULATION` object, immediately after the `ROUTE_INFERENCE_FLOOR: 5,` line:

```ts
  /**
   * Minimum cumulative LOGISTICS flow on an edge to render. Lower than the
   * market `ROUTE_INFERENCE_FLOOR` — directed logistics is sparse (one transfer
   * per faction-shard sweep) and small in the pre-scale economy, so the market
   * floor would hide most logistics arcs. Lifts naturally once ECONOMY_SCALE lands.
   */
  LOGISTICS_ROUTE_FLOOR: 1,
```

- [ ] **Step 2: Write the failing test**

Create `lib/engine/__tests__/trade-flow-edges.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFlowEdges, type RawFlowRow } from "@/lib/engine/trade-flow-edges";

const VISIBLE = new Set(["A", "B", "C"]);

function row(p: Partial<RawFlowRow> & Pick<RawFlowRow, "fromSystemId" | "toSystemId">): RawFlowRow {
  return { goodId: "food", quantity: 10, flowType: "market", ...p };
}

describe("buildFlowEdges", () => {
  it("partitions the same endpoint pair into separate market and logistics edges", () => {
    const { marketEdges, logisticsEdges } = buildFlowEdges(
      [
        row({ fromSystemId: "A", toSystemId: "B", flowType: "market", quantity: 12 }),
        row({ fromSystemId: "A", toSystemId: "B", flowType: "logistics", quantity: 20, goodId: "alloys" }),
      ],
      VISIBLE,
      5,
      1,
    );
    expect(marketEdges).toHaveLength(1);
    expect(logisticsEdges).toHaveLength(1);
    expect(marketEdges[0].dominantGoodId).toBe("food");
    expect(logisticsEdges[0].dominantGoodId).toBe("alloys");
  });

  it("applies the lower logistics floor — admits an edge the market floor would drop", () => {
    const rows = [row({ fromSystemId: "A", toSystemId: "B", flowType: "logistics", quantity: 2 })];
    const { logisticsEdges } = buildFlowEdges(rows, VISIBLE, 5, 1);
    expect(logisticsEdges).toHaveLength(1);
    // Same magnitude as a market flow would be dropped by the market floor of 5.
    const { marketEdges } = buildFlowEdges(
      [row({ fromSystemId: "A", toSystemId: "B", flowType: "market", quantity: 2 })],
      VISIBLE,
      5,
      1,
    );
    expect(marketEdges).toHaveLength(0);
  });

  it("orients the edge from→to by the dominant good's net direction", () => {
    // Net flow B→A dominates, so the edge points B→A even though A<B canonically.
    const { marketEdges } = buildFlowEdges(
      [
        row({ fromSystemId: "B", toSystemId: "A", quantity: 30 }),
        row({ fromSystemId: "A", toSystemId: "B", quantity: 5 }),
      ],
      VISIBLE,
      5,
      1,
    );
    expect(marketEdges[0].fromSystemId).toBe("B");
    expect(marketEdges[0].toSystemId).toBe("A");
    expect(marketEdges[0].totalVolume).toBe(35);
  });

  it("drops an edge with no visible endpoint", () => {
    const { marketEdges } = buildFlowEdges(
      [row({ fromSystemId: "X", toSystemId: "Y", quantity: 50 })],
      VISIBLE,
      5,
      1,
    );
    expect(marketEdges).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/trade-flow-edges.test.ts`
Expected: FAIL — cannot resolve `@/lib/engine/trade-flow-edges`.

- [ ] **Step 4: Write the implementation**

Create `lib/engine/trade-flow-edges.ts`:

```ts
/**
 * Pure aggregation for the trade-flow MAP OVERLAY. The service in
 * `lib/services/trade-flow.ts` window-sums raw `TradeFlow` rows and feeds them
 * here to produce the two undirected edge sets the Pixi layers render.
 *
 * Pure: no Prisma, no I/O. Unit-tested against in-memory rows.
 */

import type { TradeFlowEdgeInfo } from "@/lib/types/api";

/** One window-summed flow between two systems for one good, tagged by type. */
export interface RawFlowRow {
  fromSystemId: string;
  toSystemId: string;
  goodId: string;
  /** Window-summed magnitude (rows with quantity <= 0 are ignored). */
  quantity: number;
  /** "market" (diffusion) | "logistics" (directed). */
  flowType: string;
}

/** Both overlay edge sets, split by flow type. */
export interface FlowEdgeSets {
  marketEdges: TradeFlowEdgeInfo[];
  logisticsEdges: TradeFlowEdgeInfo[];
}

interface DirectionalGoodTally {
  /** Volume in canonical-from → canonical-to direction. */
  forward: number;
  /** Volume in canonical-to → canonical-from direction. */
  reverse: number;
}

/**
 * Collapse rows of a SINGLE flow type into undirected edges keyed by the sorted
 * endpoint pair, recovering net direction from the dominant good. Drops edges
 * below `floor` cumulative volume and edges with no visible endpoint.
 */
function aggregateOneType(
  rows: ReadonlyArray<RawFlowRow>,
  visibleSet: Set<string>,
  floor: number,
): TradeFlowEdgeInfo[] {
  interface EdgeAgg {
    canonicalFrom: string;
    canonicalTo: string;
    perGood: Map<string, DirectionalGoodTally>;
  }
  const byEdge = new Map<string, EdgeAgg>();

  for (const row of rows) {
    if (row.quantity <= 0) continue;

    const isForward = row.fromSystemId < row.toSystemId;
    const [a, b] = isForward
      ? [row.fromSystemId, row.toSystemId]
      : [row.toSystemId, row.fromSystemId];

    // Visibility gate: at least one endpoint must be visible.
    if (!visibleSet.has(a) && !visibleSet.has(b)) continue;

    const key = `${a}|${b}`;
    let entry = byEdge.get(key);
    if (!entry) {
      entry = { canonicalFrom: a, canonicalTo: b, perGood: new Map() };
      byEdge.set(key, entry);
    }
    let tally = entry.perGood.get(row.goodId);
    if (!tally) {
      tally = { forward: 0, reverse: 0 };
      entry.perGood.set(row.goodId, tally);
    }
    if (isForward) tally.forward += row.quantity;
    else tally.reverse += row.quantity;
  }

  const edges: TradeFlowEdgeInfo[] = [];
  for (const { canonicalFrom, canonicalTo, perGood } of byEdge.values()) {
    let totalVolume = 0;
    let dominantGoodId = "";
    let dominantNet = 0;
    let dominantMagnitude = 0;
    const perGoodObj: Record<string, number> = {};

    for (const [goodId, tally] of perGood) {
      const magnitude = tally.forward + tally.reverse;
      totalVolume += magnitude;
      perGoodObj[goodId] = magnitude;
      if (magnitude > dominantMagnitude) {
        dominantMagnitude = magnitude;
        dominantGoodId = goodId;
        dominantNet = tally.forward - tally.reverse;
      }
    }

    if (totalVolume < floor) continue;

    // Net direction from the dominant good; ties fall back to canonical order.
    const fromSystemId = dominantNet >= 0 ? canonicalFrom : canonicalTo;
    const toSystemId = dominantNet >= 0 ? canonicalTo : canonicalFrom;
    edges.push({ fromSystemId, toSystemId, totalVolume, dominantGoodId, perGood: perGoodObj });
  }
  return edges;
}

/**
 * Partition window-summed flow rows by type, then collapse each into undirected
 * edges. Market and logistics get independent inference floors.
 */
export function buildFlowEdges(
  rows: ReadonlyArray<RawFlowRow>,
  visibleSet: Set<string>,
  marketFloor: number,
  logisticsFloor: number,
): FlowEdgeSets {
  const marketRows: RawFlowRow[] = [];
  const logisticsRows: RawFlowRow[] = [];
  for (const row of rows) {
    if (row.flowType === "logistics") logisticsRows.push(row);
    else marketRows.push(row);
  }
  return {
    marketEdges: aggregateOneType(marketRows, visibleSet, marketFloor),
    logisticsEdges: aggregateOneType(logisticsRows, visibleSet, logisticsFloor),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/trade-flow-edges.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Verify unit isolation (no prisma taint)**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/__tests__/trade-flow-edges.test.ts`
Expected: PASS — confirms the engine module doesn't transitively import `@/lib/prisma`.

- [ ] **Step 7: Commit**

```bash
git add lib/engine/trade-flow-edges.ts lib/engine/__tests__/trade-flow-edges.test.ts lib/constants/trade-simulation.ts
git commit -m "feat(economy): pure trade-flow edge aggregation split by flowType

Extracts the map-overlay edge aggregation out of the service into a pure,
unit-tested engine helper that partitions market vs logistics and applies a
separate (lower) logistics inference floor. No behaviour change yet — wired next.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Service + API types

**Files:**
- Modify: `lib/types/api.ts:48-59`
- Modify: `lib/services/trade-flow.ts:26-118` (the `getTradeFlowEdges` function only)

**Interfaces:**
- Consumes: `buildFlowEdges`, `RawFlowRow` (Task 1); `TRADE_SIMULATION.ROUTE_INFERENCE_FLOOR` / `.LOGISTICS_ROUTE_FLOOR`.
- Produces:
  - `interface TradeFlowEdges { marketEdges: TradeFlowEdgeInfo[]; logisticsEdges: TradeFlowEdgeInfo[] }`
  - `getTradeFlowEdges(playerId: string): Promise<TradeFlowEdges>`
  - `TradeFlowResponse = ApiResponse<TradeFlowEdges>`

- [ ] **Step 1: Update the API types**

In `lib/types/api.ts`, replace the line:

```ts
export type TradeFlowResponse = ApiResponse<{ edges: TradeFlowEdgeInfo[] }>;
```

with:

```ts
/** The two overlay edge sets the map renders — market diffusion and directed logistics. */
export interface TradeFlowEdges {
  marketEdges: TradeFlowEdgeInfo[];
  logisticsEdges: TradeFlowEdgeInfo[];
}
export type TradeFlowResponse = ApiResponse<TradeFlowEdges>;
```

- [ ] **Step 2: Rewrite the service function**

In `lib/services/trade-flow.ts`:

First, update imports. Add:

```ts
import { buildFlowEdges, type RawFlowRow } from "@/lib/engine/trade-flow-edges";
```

and add `TradeFlowEdges` to the existing `@/lib/types/api` import list (keep `SystemTradeFlowData`, `TradeFlowEdgeInfo`). The local `DirectionalGoodTally` interface (lines 13-18) is no longer used by this function — leave it only if `getSystemTradeFlow` uses it (it does not); **delete** the `DirectionalGoodTally` interface.

Replace the entire `getTradeFlowEdges` function body (from `export async function getTradeFlowEdges` through its closing brace) with:

```ts
/**
 * Returns the two map-overlay edge sets (market diffusion + directed logistics)
 * aggregated over the last `FLOW_HISTORY_TICKS`, filtered to edges with at
 * least one endpoint in the player's visibility set. Filtering is server-side
 * so we never leak galaxy-wide commerce intel over the wire.
 */
export async function getTradeFlowEdges(playerId: string): Promise<TradeFlowEdges> {
  const { visibleSet, currentTick } = await getPlayerVisibility(playerId);

  if (visibleSet.size === 0) {
    return { marketEdges: [], logisticsEdges: [] };
  }

  const minTick = currentTick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;

  // One indexed groupBy, now split by flowType so the two overlays render apart.
  const grouped = await prisma.tradeFlow.groupBy({
    by: ["fromSystemId", "toSystemId", "goodId", "flowType"],
    where: { tick: { gt: minTick } },
    _sum: { quantity: true },
  });

  const rows: RawFlowRow[] = [];
  for (const row of grouped) {
    const qty = row._sum.quantity ?? 0;
    if (qty <= 0) continue;
    rows.push({
      fromSystemId: row.fromSystemId,
      toSystemId: row.toSystemId,
      goodId: row.goodId,
      quantity: qty,
      flowType: row.flowType,
    });
  }

  return buildFlowEdges(
    rows,
    visibleSet,
    TRADE_SIMULATION.ROUTE_INFERENCE_FLOOR,
    TRADE_SIMULATION.LOGISTICS_ROUTE_FLOOR,
  );
}
```

(`getSystemTradeFlow` below it is unchanged. The route `app/api/game/systems/trade-flow/route.ts` needs **no change** — it returns `{ data }` typed by the updated `TradeFlowResponse`.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `rankGoodFlows`/`bucketizeVolumeHistory` imports report unused, they are still used by `getSystemTradeFlow` — leave them.)

- [ ] **Step 4: Verify the unit suite still loads (no prisma-taint regression)**

Run: `npx vitest run lib/engine/__tests__/trade-flow-edges.test.ts`
Expected: PASS — unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/types/api.ts lib/services/trade-flow.ts
git commit -m "feat(economy): trade-flow service returns market + logistics edge sets

getTradeFlowEdges now groups by flowType and returns { marketEdges, logisticsEdges }
via the pure buildFlowEdges helper. API response shape updated accordingly.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Client state + data wiring (overlay key → hook → map-data → star-map)

**Files:**
- Modify: `lib/hooks/use-map-overlays.ts` (add `logistics` key)
- Modify: `components/map/map-session.ts` (persist `logistics`)
- Modify: `lib/hooks/use-trade-flow.ts` (whole file)
- Modify: `lib/hooks/use-map-data.ts` (options, MapData type, memo)
- Modify: `components/map/star-map.tsx:66,201`

**Interfaces:**
- Consumes: `TradeFlowEdges` from `@/lib/types/api`.
- Produces:
  - `MapOverlays.logistics: boolean`; `MapOverlaysState.logistics?: boolean`.
  - `useTradeFlow(marketActive: boolean, logisticsActive: boolean): { marketEdges: TradeFlowEdgeInfo[]; logisticsEdges: TradeFlowEdgeInfo[] }`
  - `UseMapDataOptions` gains `logisticsEdges: TradeFlowEdgeInfo[]`.
  - `MapData` gains `logisticsFlowEdges: Map<string, TradeFlowEdgeInfo>`.

The overlay key is defined here (not in Task 7) so `overlays.logistics` exists before `star-map` reads it — Task 7 only adds the visible checkbox + legend. With the key defaulting to `false`, nothing renders logistics until Task 6 + Task 7 land; market is unaffected throughout.

- [ ] **Step 1: Add the `logistics` overlay key**

In `lib/hooks/use-map-overlays.ts`:
(a) In `interface MapOverlays`, after `tradeFlow: boolean;`, add `logistics: boolean;`.
(b) In `DEFAULT_OVERLAYS`, after `tradeFlow: false,`, add `logistics: false,`.
(c) In `hydrateFromSession`'s returned object, after the `tradeFlow:` line, add:

```ts
    logistics: stored.logistics ?? DEFAULT_OVERLAYS.logistics,
```

(d) In the persist effect, after `if (overlays.tradeFlow) stored.tradeFlow = true;`, add:

```ts
    if (overlays.logistics) stored.logistics = true;
```

- [ ] **Step 2: Persist `logistics` through map-session**

In `components/map/map-session.ts`:
(a) In `interface MapOverlaysState`, after `tradeFlow?: boolean;`, add `logistics?: boolean;`.
(b) In `parseOverlays`, after the `tradeFlow` block, add:

```ts
  if ("logistics" in value && typeof value.logistics === "boolean") {
    out.logistics = value.logistics;
  }
```

- [ ] **Step 3: Rewrite the hook**

Replace the whole body of `lib/hooks/use-trade-flow.ts` with:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { TradeFlowEdgeInfo, TradeFlowEdges } from "@/lib/types/api";

/**
 * Fetches the two trade-flow edge sets (market diffusion + directed logistics)
 * across the player's visible systems. Tick-scoped: no viewport dependency,
 * refetched only when ships arrive or the cache stales.
 *
 * One request feeds both overlays; it fires when EITHER overlay is on so a
 * single fetch serves both toggles. Each array is zeroed when its own toggle is
 * off so the Pixi layer tears its particles down immediately (cached data would
 * otherwise keep them alive until gcTime).
 */
export function useTradeFlow(
  marketActive: boolean,
  logisticsActive: boolean,
): { marketEdges: TradeFlowEdgeInfo[]; logisticsEdges: TradeFlowEdgeInfo[] } {
  const { data } = useQuery({
    queryKey: queryKeys.tradeFlow,
    queryFn: () => apiFetch<TradeFlowEdges>("/api/game/systems/trade-flow"),
    staleTime: 10_000,
    gcTime: 30_000,
    enabled: marketActive || logisticsActive,
  });

  return {
    marketEdges: marketActive ? data?.marketEdges ?? [] : [],
    logisticsEdges: logisticsActive ? data?.logisticsEdges ?? [] : [],
  };
}
```

- [ ] **Step 4: Add the second edge map in use-map-data**

In `lib/hooks/use-map-data.ts`:

(a) In `MapData` (near line 92, the `flowEdges` field), add directly below it:

```ts
  logisticsFlowEdges: Map<string, TradeFlowEdgeInfo>;
```

(b) In `UseMapDataOptions` (near line 116, after `tradeFlowEdges`), add:

```ts
  logisticsEdges: TradeFlowEdgeInfo[];
```

(c) In the `useMapData({ ... })` destructure (near line 135, after `tradeFlowEdges,`), add:

```ts
  logisticsEdges,
```

(d) Replace the `flowEdges` memo block (lines 427-437) with a shared keyer + two memos:

```ts
  // ── Trade-flow edges keyed for O(1) lookup by the Pixi layers ─────
  // `fromSystemId`/`toSystemId` reflect net flow direction (not sort order),
  // so we key by canonical pair `${min}|${max}`. The renderer uses each value's
  // from/to as-is for direction.
  const flowEdges = useMemo(() => keyByCanonicalPair(tradeFlowEdges), [tradeFlowEdges]);
  const logisticsFlowEdges = useMemo(() => keyByCanonicalPair(logisticsEdges), [logisticsEdges]);
```

(e) In the returned object (line 442, after `flowEdges,`), add:

```ts
    logisticsFlowEdges,
```

(f) Add this module-level helper (place it just above `export function useMapData`, near line 126):

```ts
/** Key edges by canonical (sorted) endpoint pair for O(1) Pixi lookup. */
function keyByCanonicalPair(
  edges: TradeFlowEdgeInfo[],
): Map<string, TradeFlowEdgeInfo> {
  const map = new Map<string, TradeFlowEdgeInfo>();
  for (const edge of edges) {
    const [a, b] =
      edge.fromSystemId < edge.toSystemId
        ? [edge.fromSystemId, edge.toSystemId]
        : [edge.toSystemId, edge.fromSystemId];
    map.set(`${a}|${b}`, edge);
  }
  return map;
}
```

- [ ] **Step 5: Wire star-map**

In `components/map/star-map.tsx`:

Replace line 66:

```ts
  const { edges: tradeFlowEdges } = useTradeFlow(overlays.tradeFlow);
```

with:

```ts
  const { marketEdges, logisticsEdges } = useTradeFlow(
    overlays.tradeFlow,
    overlays.logistics,
  );
```

In the `useMapData({ … })` call (line 201), replace `tradeFlowEdges,` with:

```ts
    tradeFlowEdges: marketEdges,
    logisticsEdges,
```

(`overlays.logistics` exists from Step 1, so this type-checks cleanly within this task.)

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors. Market overlay behaviour is unchanged; logistics data now reaches `MapData` but no layer renders it yet (canvas wiring is Task 6).

- [ ] **Step 7: Commit**

```bash
git add lib/hooks/use-map-overlays.ts components/map/map-session.ts lib/hooks/use-trade-flow.ts lib/hooks/use-map-data.ts components/map/star-map.tsx
git commit -m "feat(map): carry logistics edge set + overlay key through client state

Adds the logistics overlay key (persisted), and threads both edge sets through
useTradeFlow and use-map-data. The visible toggle/legend follows in Task 7.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Arc geometry (pure)

**Files:**
- Create: `components/map/pixi/flow-arc.ts`
- Create: `components/map/pixi/__tests__/flow-arc.test.ts`

**Interfaces:**
- Produces:
  - `interface Point { x: number; y: number }`
  - `arcPolyline(from: Point, to: Point, bowFraction: number, maxBow: number, segments: number): Point[]`
  - `cumulativeLengths(points: ReadonlyArray<Point>): { cum: number[]; total: number }`
  - `pointAtFraction(points: ReadonlyArray<Point>, cum: ReadonlyArray<number>, total: number, u: number): Point`

- [ ] **Step 1: Write the failing test**

Create `components/map/pixi/__tests__/flow-arc.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  arcPolyline,
  cumulativeLengths,
  pointAtFraction,
} from "@/components/map/pixi/flow-arc";

describe("arcPolyline", () => {
  it("returns segments + 1 points", () => {
    const pts = arcPolyline({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.2, 1000, 24);
    expect(pts).toHaveLength(25);
  });

  it("starts at from and ends at to", () => {
    const pts = arcPolyline({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.2, 1000, 24);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it("bows to the left of the from→to vector", () => {
    // Travelling +x; left is -y. Midpoint should sit at negative y.
    const pts = arcPolyline({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.2, 1000, 24);
    const mid = pts[12];
    expect(mid.y).toBeLessThan(0);
  });

  it("clamps bow to maxBow", () => {
    const big = arcPolyline({ x: 0, y: 0 }, { x: 10000, y: 0 }, 0.2, 50, 24);
    const mid = big[12];
    // bow ~ maxBow (50) at the apex of a quadratic = control*0.5 offset.
    expect(Math.abs(mid.y)).toBeLessThanOrEqual(50);
  });

  it("degenerates to a straight 2-point path when endpoints coincide", () => {
    const pts = arcPolyline({ x: 5, y: 5 }, { x: 5, y: 5 }, 0.2, 1000, 24);
    expect(pts).toEqual([{ x: 5, y: 5 }, { x: 5, y: 5 }]);
  });
});

describe("cumulativeLengths / pointAtFraction", () => {
  it("produces a monotonic cumulative array", () => {
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
    const { cum, total } = cumulativeLengths(pts);
    expect(cum).toEqual([0, 3, 7]);
    expect(total).toBe(7);
  });

  it("samples endpoints and the arc-length midpoint", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const { cum, total } = cumulativeLengths(pts);
    expect(pointAtFraction(pts, cum, total, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAtFraction(pts, cum, total, 1)).toEqual({ x: 10, y: 0 });
    expect(pointAtFraction(pts, cum, total, 0.5)).toEqual({ x: 5, y: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/map/pixi/__tests__/flow-arc.test.ts`
Expected: FAIL — cannot resolve `@/components/map/pixi/flow-arc`.

- [ ] **Step 3: Write the implementation**

Create `components/map/pixi/flow-arc.ts`:

```ts
/**
 * Pure 2-D geometry for flow-overlay particle paths. No Pixi imports — testable
 * in isolation. A "path" is a polyline (≥ 2 points); particles advance along it
 * by arc-length so on-screen speed is constant regardless of curvature.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Sample a quadratic bezier between two points into a polyline. The arc bows
 * perpendicular to the chord, always to the LEFT of the from→to vector, by
 * `min(maxBow, bowFraction × chordLength)` — so parallel hauls fan apart and the
 * curve direction reads consistently. Returns `segments + 1` points; degenerates
 * to `[from, to]` when the endpoints coincide.
 */
export function arcPolyline(
  from: Point,
  to: Point,
  bowFraction: number,
  maxBow: number,
  segments: number,
): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [from, to];

  const bow = Math.min(maxBow, bowFraction * length);
  // Unit normal to the LEFT of travel (consistent side for fan-out).
  const nx = -dy / length;
  const ny = dx / length;
  const cx = (from.x + to.x) / 2 + nx * bow;
  const cy = (from.y + to.y) / 2 + ny * bow;

  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const mt = 1 - u;
    pts.push({
      x: mt * mt * from.x + 2 * mt * u * cx + u * u * to.x,
      y: mt * mt * from.y + 2 * mt * u * cy + u * u * to.y,
    });
  }
  return pts;
}

/** Cumulative arc-length at each vertex of a polyline (array length = points). */
export function cumulativeLengths(
  points: ReadonlyArray<Point>,
): { cum: number[]; total: number } {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    cum.push(total);
  }
  return { cum, total };
}

/** Point at fractional arc-length `u` (0..1) along the polyline. */
export function pointAtFraction(
  points: ReadonlyArray<Point>,
  cum: ReadonlyArray<number>,
  total: number,
  u: number,
): Point {
  if (points.length < 2 || total === 0) return points[0];
  const d = u * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const f = (d - cum[i - 1]) / seg;
  return {
    x: points[i - 1].x + (points[i].x - points[i - 1].x) * f,
    y: points[i - 1].y + (points[i].y - points[i - 1].y) * f,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/map/pixi/__tests__/flow-arc.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add components/map/pixi/flow-arc.ts components/map/pixi/__tests__/flow-arc.test.ts
git commit -m "feat(map): pure arc geometry for flow-overlay particle paths

arcPolyline (left-bowed quadratic bezier, length-proportional clamped bow) plus
arc-length sampling. Unit-tested; no Pixi dependency.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Generalise the Pixi edge + parameterise the layer (market behaviour preserved)

**Files:**
- Modify: `components/map/pixi/objects/trade-flow-edge.ts` (whole file)
- Modify: `components/map/pixi/layers/trade-flow-layer.ts` (whole file)

**Interfaces:**
- Consumes: `cumulativeLengths`, `pointAtFraction`, `Point` (Task 4); `TRADE_FLOW` (theme).
- Produces:
  - `interface FlowEdgeStyle { particleRadius; particleAlpha; particleSpeed; glowBlur; drawPath; pathAlpha; arrowhead; arrowSize }` (all numbers except `drawPath`/`arrowhead` booleans).
  - `TradeFlowEdge` constructor: `(path: Point[], particleCount: number, color: number, style: FlowEdgeStyle, identity: { fromSystemId; toSystemId; dominantGoodId })`.
  - `interface FlowLayerConfig { buildPath: (from: Point, to: Point) => Point[]; style: FlowEdgeStyle; minParticlesPerEdge; volumePerExtraParticle; maxParticlesPerEdge; maxTotalParticles }`.
  - `TradeFlowLayer` constructor: `(config?: FlowLayerConfig)` — defaults to `MARKET_FLOW_CONFIG`.
  - `MARKET_FLOW_CONFIG: FlowLayerConfig` (exported).

This task is a **behaviour-preserving refactor**: after it, the market overlay renders exactly as before (straight 2-point paths, no glow/arrow/path-line), now via the generalised edge.

- [ ] **Step 1: Rewrite the edge object**

Replace the whole file `components/map/pixi/objects/trade-flow-edge.ts` with:

```ts
import { Container, Graphics } from "pixi.js";
import { cumulativeLengths, pointAtFraction, type Point } from "../flow-arc";

/** Visual treatment for a flow edge's particles + optional decorations. */
export interface FlowEdgeStyle {
  /** Particle radius in world space. */
  particleRadius: number;
  /** Particle alpha (multiplied with LOD/layer alpha at the layer). */
  particleAlpha: number;
  /** Pixels per second a particle travels along the edge. */
  particleSpeed: number;
  /** Radius of a faint halo behind each particle; 0 = no glow. */
  glowBlur: number;
  /** Draw a faint static line under the particles (for off-lane arcs). */
  drawPath: boolean;
  /** Alpha of the static path line when `drawPath` is set. */
  pathAlpha: number;
  /** Draw a static arrowhead at the destination end. */
  arrowhead: boolean;
  /** Arrowhead size in world space when `arrowhead` is set. */
  arrowSize: number;
}

interface Particle {
  gfx: Graphics;
  /** Offset along the edge, 0..1 (arc-length parameter). */
  offset: number;
  /** Fraction of the edge advanced per millisecond. */
  speed: number;
}

/**
 * Per-edge particle emitter for a flow overlay. Owns one Pixi `Container` with N
 * child particles flowing along a baked **polyline** path (straight 2-point for
 * market diffusion, sampled arc for directed logistics). Pure presentation — no
 * awareness of the good beyond the colour it was handed.
 *
 * Lifecycle: create once per active edge, `update(dtMs)` each frame, `destroy()`
 * when it leaves the flow set. Path is baked at construction; if an endpoint
 * moves we destroy + recreate.
 */
export class TradeFlowEdge {
  readonly container = new Container();
  /** Particle count baked into this edge — used by the layer's diff. */
  readonly particleCount: number;
  readonly fromSystemId: string;
  readonly toSystemId: string;
  readonly dominantGoodId: string;
  private particles: Particle[] = [];
  private path: Point[];
  private cum: number[];
  private total: number;

  constructor(
    path: Point[],
    particleCount: number,
    color: number,
    style: FlowEdgeStyle,
    identity: { fromSystemId: string; toSystemId: string; dominantGoodId: string },
  ) {
    this.particleCount = particleCount;
    this.fromSystemId = identity.fromSystemId;
    this.toSystemId = identity.toSystemId;
    this.dominantGoodId = identity.dominantGoodId;
    this.path = path;
    const { cum, total } = cumulativeLengths(path);
    this.cum = cum;
    this.total = total;

    // Faint static route line under the particles (off-lane arcs read better).
    if (style.drawPath && path.length >= 2 && total > 0) {
      const line = new Graphics();
      line.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) line.lineTo(path[i].x, path[i].y);
      line.stroke({ color, alpha: style.pathAlpha, width: style.particleRadius * 0.6 });
      this.container.addChild(line);
    }

    // Static arrowhead at the destination, oriented along the last segment.
    if (style.arrowhead && path.length >= 2) {
      const a = path[path.length - 2];
      const b = path[path.length - 1];
      const tri = new Graphics();
      const s = style.arrowSize;
      tri.moveTo(s, 0);
      tri.lineTo(-s * 0.8, s * 0.7);
      tri.lineTo(-s * 0.8, -s * 0.7);
      tri.fill({ color, alpha: style.particleAlpha });
      tri.position.set(b.x, b.y);
      tri.rotation = Math.atan2(b.y - a.y, b.x - a.x);
      this.container.addChild(tri);
    }

    const speedPerMs = total > 0 ? style.particleSpeed / total / 1000 : 0;
    for (let i = 0; i < particleCount; i++) {
      const gfx = new Graphics();
      gfx.circle(0, 0, style.particleRadius);
      gfx.fill({ color, alpha: style.particleAlpha });
      // Cheap glow: a larger, fainter halo behind the core dot (no Pixi filters).
      if (style.glowBlur > 0) {
        const halo = new Graphics();
        halo.circle(0, 0, style.particleRadius + style.glowBlur);
        halo.fill({ color, alpha: style.particleAlpha * 0.25 });
        gfx.addChildAt(halo, 0);
      }
      this.container.addChild(gfx);
      this.particles.push({
        gfx,
        offset: particleCount > 0 ? i / particleCount : 0,
        speed: speedPerMs,
      });
    }
  }

  /** Returns true if a frustum AABB overlaps this edge's polyline bounding box. */
  intersects(minX: number, minY: number, maxX: number, maxY: number): boolean {
    let segMinX = Infinity;
    let segMinY = Infinity;
    let segMaxX = -Infinity;
    let segMaxY = -Infinity;
    for (const p of this.path) {
      if (p.x < segMinX) segMinX = p.x;
      if (p.x > segMaxX) segMaxX = p.x;
      if (p.y < segMinY) segMinY = p.y;
      if (p.y > segMaxY) segMaxY = p.y;
    }
    return segMaxX >= minX && segMinX <= maxX && segMaxY >= minY && segMinY <= maxY;
  }

  /** Advance particle offsets. Caller guarantees the edge is visible. */
  update(dtMs: number) {
    if (this.total === 0) return;
    for (const p of this.particles) {
      p.offset = (p.offset + p.speed * dtMs) % 1;
      const pt = pointAtFraction(this.path, this.cum, this.total, p.offset);
      p.gfx.position.set(pt.x, pt.y);
    }
  }

  destroy() {
    this.particles = [];
    this.container.destroy({ children: true });
  }
}
```

- [ ] **Step 2: Rewrite the layer with a config**

Replace the whole file `components/map/pixi/layers/trade-flow-layer.ts` with:

```ts
import { Container } from "pixi.js";
import { TradeFlowEdge, type FlowEdgeStyle } from "../objects/trade-flow-edge";
import { getGoodColor } from "@/lib/constants/good-colors";
import { TRADE_FLOW } from "../theme";
import type { Point } from "../flow-arc";
import type { Frustum } from "../frustum";
import type { LODState } from "../lod";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { TradeFlowEdgeInfo } from "@/lib/types/api";

/** Per-overlay rendering config — market (straight) vs logistics (arced). */
export interface FlowLayerConfig {
  /** Build the particle path between net-from and net-to endpoints. */
  buildPath: (from: Point, to: Point) => Point[];
  style: FlowEdgeStyle;
  minParticlesPerEdge: number;
  volumePerExtraParticle: number;
  maxParticlesPerEdge: number;
  /** Global particle budget for this layer. */
  maxTotalParticles: number;
}

/** Market diffusion: straight 2-point path, small ambient dots, no glow/arrow. */
export const MARKET_FLOW_CONFIG: FlowLayerConfig = {
  buildPath: (from, to) => [from, to],
  style: {
    particleRadius: TRADE_FLOW.particleRadius,
    particleAlpha: TRADE_FLOW.particleAlpha,
    particleSpeed: TRADE_FLOW.particleSpeed,
    glowBlur: 0,
    drawPath: false,
    pathAlpha: 0,
    arrowhead: false,
    arrowSize: 0,
  },
  minParticlesPerEdge: TRADE_FLOW.minParticlesPerEdge,
  volumePerExtraParticle: TRADE_FLOW.volumePerExtraParticle,
  maxParticlesPerEdge: TRADE_FLOW.maxParticlesPerEdge,
  maxTotalParticles: TRADE_FLOW.maxTotalParticles,
};

/**
 * Pixi layer that renders a flow overlay. Config-parameterised so one class
 * serves both market diffusion and directed logistics (different path geometry
 * + particle style). See `MARKET_FLOW_CONFIG` and `LOGISTICS_FLOW_CONFIG`.
 *
 * Lifecycle mirrors the prior single-overlay layer: `sync` diffs the live edge
 * set, `updateVisibility` culls + sets LOD alpha, `update` advances particles.
 * Total particles are capped by `config.maxTotalParticles`; highest-volume edges
 * are kept first.
 */
export class TradeFlowLayer {
  readonly container = new Container();
  private edges = new Map<string, TradeFlowEdge>();

  constructor(private config: FlowLayerConfig = MARKET_FLOW_CONFIG) {}

  sync(systems: SystemNodeData[], flowEdges: Map<string, TradeFlowEdgeInfo>) {
    if (flowEdges.size === 0) {
      this.clearAll();
      return;
    }

    const posById = new Map<string, { x: number; y: number }>();
    for (const s of systems) posById.set(s.id, { x: s.x, y: s.y });

    const wanted: Array<{ key: string; edge: TradeFlowEdgeInfo }> = [];
    for (const [key, edge] of flowEdges) {
      const from = posById.get(edge.fromSystemId);
      const to = posById.get(edge.toSystemId);
      if (!from || !to) continue;
      wanted.push({ key, edge });
    }

    wanted.sort((a, b) => b.edge.totalVolume - a.edge.totalVolume);

    let particleBudget = this.config.maxTotalParticles;
    const keepKeys = new Set<string>();

    for (const { key, edge } of wanted) {
      const desired = this.particleCountFor(edge.totalVolume);
      if (desired === 0 || particleBudget <= 0) continue;
      const allotted = Math.min(desired, particleBudget);
      particleBudget -= allotted;
      keepKeys.add(key);

      let obj = this.edges.get(key);
      // Recreate if particle count, net direction, or dominant good changed —
      // all are baked at construction (endpoints determine the path).
      if (
        obj &&
        (obj.particleCount !== allotted ||
          obj.fromSystemId !== edge.fromSystemId ||
          obj.toSystemId !== edge.toSystemId ||
          obj.dominantGoodId !== edge.dominantGoodId)
      ) {
        this.disposeEdge(key);
        obj = undefined;
      }
      if (!obj) {
        const from = posById.get(edge.fromSystemId);
        const to = posById.get(edge.toSystemId);
        if (!from || !to) continue;
        const path = this.config.buildPath(from, to);
        obj = new TradeFlowEdge(path, allotted, getGoodColor(edge.dominantGoodId), this.config.style, {
          fromSystemId: edge.fromSystemId,
          toSystemId: edge.toSystemId,
          dominantGoodId: edge.dominantGoodId,
        });
        this.edges.set(key, obj);
        this.container.addChild(obj.container);
      }
    }

    for (const key of [...this.edges.keys()]) {
      if (!keepKeys.has(key)) this.disposeEdge(key);
    }
  }

  /** Per-frame visibility update: frustum culling + layer alpha from LOD. */
  updateVisibility(frustum: Frustum, lod: LODState, layerAlpha = 1) {
    this.container.alpha = lod.tradeFlowAlpha * layerAlpha;
    if (this.container.alpha === 0) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;

    for (const edge of this.edges.values()) {
      edge.container.visible = edge.intersects(
        frustum.minX,
        frustum.minY,
        frustum.maxX,
        frustum.maxY,
      );
    }
  }

  update(dtMs: number) {
    for (const edge of this.edges.values()) {
      if (edge.container.visible) edge.update(dtMs);
    }
  }

  private particleCountFor(volume: number): number {
    if (volume <= 0) return 0;
    const extra = Math.floor(volume / this.config.volumePerExtraParticle);
    return Math.min(
      this.config.maxParticlesPerEdge,
      this.config.minParticlesPerEdge + extra,
    );
  }

  private disposeEdge(key: string) {
    const obj = this.edges.get(key);
    if (!obj) return;
    this.container.removeChild(obj.container);
    obj.destroy();
    this.edges.delete(key);
  }

  private clearAll() {
    for (const key of [...this.edges.keys()]) this.disposeEdge(key);
  }

  destroy() {
    this.clearAll();
    this.container.destroy({ children: true });
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. `pixi-map-canvas.tsx` still calls `new TradeFlowLayer()` (defaults to `MARKET_FLOW_CONFIG`), so the market overlay is unchanged.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add components/map/pixi/objects/trade-flow-edge.ts components/map/pixi/layers/trade-flow-layer.ts
git commit -m "refactor(map): generalise flow edge to a polyline + config-driven layer

TradeFlowEdge now bakes a polyline path (straight 2-point for market) and a
style (radius/alpha/speed/glow/path-line/arrowhead). TradeFlowLayer takes a
FlowLayerConfig (defaults to MARKET_FLOW_CONFIG). Market overlay renders
identically — logistics config added next.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Logistics theme + layer instantiation

**Files:**
- Modify: `components/map/pixi/theme.ts` (add `LOGISTICS_FLOW`)
- Modify: `components/map/pixi/layers/trade-flow-layer.ts` (add `LOGISTICS_FLOW_CONFIG`)
- Modify: `components/map/pixi/pixi-map-canvas.tsx` (refs, instantiate, frame loop, sync, destroy)

**Interfaces:**
- Consumes: `arcPolyline` (Task 4); `FlowLayerConfig`, `TradeFlowLayer` (Task 5); `MapData.logisticsFlowEdges` (Task 3).
- Produces: `LOGISTICS_FLOW_CONFIG: FlowLayerConfig`; `PixiRefs.logisticsFlowLayer: TradeFlowLayer`.

- [ ] **Step 1: Add the theme constants**

In `components/map/pixi/theme.ts`, directly after the `TRADE_FLOW = { … } as const;` block (after line 236), add:

```ts
/**
 * Directed-logistics overlay. Arced, glowing "convoy" particles distinct from
 * market's small ambient dots. Visual values are placeholders — tune in the
 * manual smoke (bow/glow/speed) the way TRADE_FLOW's are.
 */
export const LOGISTICS_FLOW = {
  /** Perpendicular bow as a fraction of chord length. */
  arcBowFraction: 0.18,
  /** Max bow in world units (clamps long hauls so they don't balloon). */
  arcMaxBow: 600,
  /** Polyline segments per arc. */
  arcSegments: 24,
  particleRadius: 3.4,
  particleSpeed: 95,
  particleAlpha: 0.95,
  /** Halo radius behind each particle (cheap glow). */
  glowBlur: 3,
  /** Faint static arc line under the particles. */
  pathAlpha: 0.18,
  /** Arrowhead size at the importing (destination) system. */
  arrowSize: 6,
  minParticlesPerEdge: 2,
  volumePerExtraParticle: 6,
  maxParticlesPerEdge: 10,
  /** Smaller global budget than market — logistics is sparse. */
  maxTotalParticles: 800,
} as const;
```

- [ ] **Step 2: Add the logistics layer config**

In `components/map/pixi/layers/trade-flow-layer.ts`:

Update the theme import to include `LOGISTICS_FLOW` and add the `arcPolyline` import:

```ts
import { TRADE_FLOW, LOGISTICS_FLOW } from "../theme";
import { arcPolyline, type Point } from "../flow-arc";
```

(Remove the now-duplicate `import type { Point } from "../flow-arc";` line if present — merge into the one above.)

Then add, directly below `MARKET_FLOW_CONFIG`:

```ts
/** Directed logistics: arced path, larger glowing convoys, route line + arrow. */
export const LOGISTICS_FLOW_CONFIG: FlowLayerConfig = {
  buildPath: (from, to) =>
    arcPolyline(from, to, LOGISTICS_FLOW.arcBowFraction, LOGISTICS_FLOW.arcMaxBow, LOGISTICS_FLOW.arcSegments),
  style: {
    particleRadius: LOGISTICS_FLOW.particleRadius,
    particleAlpha: LOGISTICS_FLOW.particleAlpha,
    particleSpeed: LOGISTICS_FLOW.particleSpeed,
    glowBlur: LOGISTICS_FLOW.glowBlur,
    drawPath: true,
    pathAlpha: LOGISTICS_FLOW.pathAlpha,
    arrowhead: true,
    arrowSize: LOGISTICS_FLOW.arrowSize,
  },
  minParticlesPerEdge: LOGISTICS_FLOW.minParticlesPerEdge,
  volumePerExtraParticle: LOGISTICS_FLOW.volumePerExtraParticle,
  maxParticlesPerEdge: LOGISTICS_FLOW.maxParticlesPerEdge,
  maxTotalParticles: LOGISTICS_FLOW.maxTotalParticles,
};
```

- [ ] **Step 3: Wire the layer into the canvas**

In `components/map/pixi/pixi-map-canvas.tsx`:

(a) Update the layer import (line 16) to also pull the logistics config:

```ts
import { TradeFlowLayer, LOGISTICS_FLOW_CONFIG } from "./layers/trade-flow-layer";
```

(b) In the `PixiRefs` interface (after line 71, `tradeFlowLayer: TradeFlowLayer;`), add:

```ts
  logisticsFlowLayer: TradeFlowLayer;
```

(c) After the market layer is created + added (lines 187-188), add:

```ts
      // Logistics convoys render just above market diffusion, below territories.
      const logisticsFlowLayer = new TradeFlowLayer(LOGISTICS_FLOW_CONFIG);
      world.addChild(logisticsFlowLayer.container);
```

(d) In the frame loop, after the market block (lines 285-286), add:

```ts
        logisticsFlowLayer.updateVisibility(frustum, lod, lod.systemLayerAlpha);
        if (logisticsFlowLayer.container.visible) logisticsFlowLayer.update(dtMs);
```

(e) In the `pixiRef.current = { … }` assignment (line 307, the line containing `tradeFlowLayer,`), add `logisticsFlowLayer,` to that object.

(f) In the cleanup block (after line 328, `refs.tradeFlowLayer.destroy();`), add:

```ts
          refs.logisticsFlowLayer.destroy();
```

(g) In the sync function (line 415, after `p.tradeFlowLayer.sync(mapData.systems, mapData.flowEdges);`), add:

```ts
    p.logisticsFlowLayer.sync(mapData.systems, mapData.logisticsFlowEdges);
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: success. (Logistics arcs now render whenever `mapData.logisticsFlowEdges` is non-empty — driven by the toggle wired in Task 7.)

- [ ] **Step 5: Commit**

```bash
git add components/map/pixi/theme.ts components/map/pixi/layers/trade-flow-layer.ts components/map/pixi/pixi-map-canvas.tsx
git commit -m "feat(map): render directed logistics as arced convoy overlay

Adds LOGISTICS_FLOW theme + LOGISTICS_FLOW_CONFIG (arced path, glow, route line,
arrowhead) and a second TradeFlowLayer instance fed by mapData.logisticsFlowEdges.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Overlay checkbox + legend

**Files:**
- Modify: `components/map/map-overlay-controls.tsx`

**Interfaces:**
- Consumes: `MapOverlays.logistics` (Task 3); `TIER_COLOR`, `TIER_LABEL`, `pixiHexToCss` (existing).
- Produces: a "Logistics" entry in `OVERLAY_DEFS` with a `"logistics"` legend.

(The overlay key + session persistence already landed in Task 3 — this task only adds the visible control and its legend.)

- [ ] **Step 1: Add the checkbox + legend**

In `components/map/map-overlay-controls.tsx`:

(a) Widen `LegendKind` (line 25):

```ts
type LegendKind = "price" | "tradeFlow" | "logistics" | "routes";
```

(b) In `OVERLAY_DEFS` (after the `tradeFlow` entry, line 44), add:

```ts
  { key: "logistics", label: "Logistics", swatch: pixiHexToCss(TIER_COLOR[1]), legend: "logistics" },
```

(c) In `OverlayLegend` (line 138), add a branch before the routes fallback:

```ts
  if (kind === "logistics") return <LogisticsLegend />;
```

(d) Replace `TradeFlowLegend` (lines 204-228) with a shared tier list plus a logistics-specific legend:

```ts
function TierSwatchList() {
  const tiers = [0, 1, 2] as const;
  return (
    <ul className="space-y-0.5">
      {tiers.map((tier) => (
        <li
          key={tier}
          className="flex items-center gap-1.5 text-[10px] text-text-secondary"
        >
          <span
            className="h-2 w-2 shrink-0"
            style={{ backgroundColor: pixiHexToCss(TIER_COLOR[tier]) }}
            aria-hidden
          />
          <span>{TIER_LABEL[tier]}</span>
        </li>
      ))}
    </ul>
  );
}

function TradeFlowLegend() {
  return (
    <div>
      <h5 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Good Tier
      </h5>
      <TierSwatchList />
    </div>
  );
}

function LogisticsLegend() {
  return (
    <div>
      <h5 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Directed Logistics
      </h5>
      <TierSwatchList />
      <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">
        Curved arc = a faction haul across systems; the arrow points to the
        importing system. Straight dots are market diffusion.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: success. The "Logistics" checkbox now renders and toggles the overlay.

- [ ] **Step 3: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS — including `trade-flow-edges` (Task 1) and `flow-arc` (Task 4). The existing `map-session.test.ts` still passes (logistics persistence is additive).

- [ ] **Step 4: Manual visual smoke**

Run: `npm run dev`, open the map, and verify:
- The control panel shows a new **Logistics** checkbox under Overlays; hovering it shows the tier ramp + the "curved arc / arrow → importer" legend.
- Toggling **Logistics** on shows **curved arcs** that lift off the straight lane network, tier-coloured, with a glow + an arrowhead at the importing end and a faint route line. (If no arcs appear, confirm logistics rows exist in the window and reconsider `LOGISTICS_ROUTE_FLOOR` — this is the floor the spec flagged.)
- Toggling **Trade Flows** on/off independently still shows the original straight market dots, unchanged.
- With **both** on, arcs and straight dots read apart even when they share a tier colour.
- Toggling Logistics off tears the arcs down immediately (no lingering particles).
- Pan/zoom: arcs fade with the system layer at universe zoom and cull off-screen without errors in the console.

- [ ] **Step 5: Commit**

```bash
git add components/map/map-overlay-controls.tsx
git commit -m "feat(map): add Logistics overlay checkbox + legend

Independent 'Logistics' control with a tier + arc legend. Completes the
directed-logistics map overlay (P3).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage:** service partition by flowType (T1+T2) · logistics floor (T1 constant/test, T2 wiring) · spatial visibility gate (T1 `visibleSet`, preserved) · arcs/bow/convoy/tier-colour/arrowhead (T4–T6) · shared polyline emitter / DRY (T5) · separate independent toggle + legend (T7) · out-of-scope items (tooltip, friendly-gate, blockade, transit-time, lane-routing) — none built. ✓ All spec sections map to a task.

**Deliberate deviation:** spec said "service integration test"; this plan unit-tests the extracted pure aggregation instead (stronger, faster, convention-aligned) and verifies the thin service wrapper by typecheck + smoke. Documented above.

**Placeholder scan:** none — every code step carries full code; floor value (`1`), theme values, and tier swatches are concrete (theme values explicitly marked smoke-tunable, which is the existing TRADE_FLOW convention, not a placeholder).

**Type consistency:** `RawFlowRow`/`FlowEdgeSets`/`buildFlowEdges` (T1) match the service call (T2). `TradeFlowEdges` (T2) matches the hook generic (T3) and `apiFetch`. `FlowEdgeStyle`/`FlowLayerConfig`/`TradeFlowEdge(path, count, color, style, identity)` (T5) match `LOGISTICS_FLOW_CONFIG` + `new TradeFlowLayer(LOGISTICS_FLOW_CONFIG)` (T6). `MapData.logisticsFlowEdges` (T3) matches the canvas sync (T6). `overlays.logistics` is defined in T3 (Step 1) and consumed in the same task's star-map edit — no forward reference. ✓

**Ordering:** every task type-checks within itself. T3 defines the `logistics` overlay key before star-map reads it; the logistics *renderer* arrives in T6 and the visible *toggle* in T7, but the key defaulting to `false` keeps the build green and market unaffected at every step.
