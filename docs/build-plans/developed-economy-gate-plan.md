# Developed-Economy-Gate + Trade-Flow Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make only `developed` systems economically active (population, migration, market, logistics), freeze `unclaimed`/`controlled` systems, and delete the price-diffusion trade-flow processor.

**Architecture:** One shared predicate `isEconomicallyActive(control)` gates the three economy selection paths (economy adapter selection, migration open-edges, directed-logistics participants); infrastructure-decay + population cascade automatically because they key off the economy's processed-system signal set. The trade-flow *processor* is deleted (its shared open-edge helper, its service, and the logistics overlay all stay). A multi-tick tripwire integration test locks the invariant in CI. The panel UI hides the four economy tabs for non-developed systems and their backing services return the inert empty shape.

**Tech Stack:** TypeScript 5 (strict), Next.js 16 App Router, Vitest 4, TanStack Query v5, Pixi (map). In-memory world; pure processor bodies behind typed `World` interfaces + memory adapters; `runWorldTick` is the single tick body.

## Global Constraints

Copied verbatim from the design spec (`docs/build-plans/developed-economy-gate-design.md`), applied to every task:

- No `as` type assertions except `as const` / guards in `lib/types/guards.ts`.
- No `unknown` except narrowed `JSON.parse` boundaries.
- No postfix `!` non-null assertion except `find(...)!` in tests.
- `World` stays JSON-serializable: no `Map`/`Set`/`Date`/`Infinity`/`NaN` in world state.
- Tick bodies are deterministic: seeded RNG only, never `Date.now`/`Math.random`/`new Date()`.
- Discriminated-union result types (`{ ok: true; ... } | { ok: false; ... }`), never boolean-flag bags.
- Active docs are present-tense, no change-history / phase nicknames.
- Use existing UI components (`Button`, `Badge`, form controls); never raw `<input>`/`<select>`.
- **Per-task gate:** `npx tsc --noEmit` green AND `npx vitest run` green.
- **PR-boundary gate (Tasks 4 and 6 additionally):** `npx next build --webpack` green AND `npm run simulate` coarse-green (no `NaN`/`Infinity`/runaway; controlled/unclaimed systems stay at population 0).
- **Shell:** working directory is the repo root; never prefix commands with `cd`.

---

## File Structure

**Task 1 — remove the processor (tick core):**
- Delete: `lib/tick/processors/trade-flow.ts`, `lib/tick/adapters/memory/trade-flow.ts`, `lib/tick/world/trade-flow-world.ts`, `lib/tick/processors/__tests__/trade-flow.test.ts`, `lib/engine/__tests__/trade-flow-integration.test.ts`
- Modify: `lib/tick/world/trade-flow-topology.ts` (owns `EdgeView` now), `lib/world/tick.ts`, `lib/tick/processors/migration.ts`, `lib/tick/world/migration-world.ts`, `lib/tick/adapters/memory/migration.ts`, `lib/world/__tests__/tick.test.ts`

**Task 2 — remove the market overlay (UI/service/api):**
- Modify: `lib/hooks/use-map-overlays.ts`, `components/map/map-session.ts`, `components/map/__tests__/map-session.test.ts`, `components/map/map-overlay-controls.tsx`, `lib/hooks/use-trade-flow.ts`, `lib/hooks/use-map-data.ts`, `components/map/star-map.tsx`, `components/map/pixi/pixi-map-canvas.tsx`, `components/map/pixi/layers/trade-flow-layer.ts`, `lib/types/api.ts`, `lib/services/trade-flow.ts`, `lib/services/__tests__/trade-flow.test.ts`

**Task 3 — the predicate:**
- Create: `lib/engine/control.ts`, `lib/engine/__tests__/control.test.ts`

**Task 4 — the gate + tripwire:**
- Create: `lib/world/__tests__/developed-gate-invariant.test.ts`
- Modify: `lib/tick/adapters/memory/economy.ts`, `lib/world/tick.ts`, `lib/engine/directed-build.ts`

**Task 5 — UI tabs + service defense-in-depth:**
- Modify: `app/(game)/@panel/system/[systemId]/layout.tsx`, `components/map/system-detail-panel.tsx`, `lib/services/system-population.ts`, `lib/services/universe.ts` (`getSystemIndustry`), `lib/services/trade-flow.ts` (`getSystemLogistics`), `lib/services/market.ts`
- Create: `lib/services/__tests__/developed-gate-services.test.ts`

**Task 6 — docs:**
- Modify: `docs/active/gameplay/faction-system.md`, `docs/active/gameplay/economy-autonomic-agency.md`, `docs/SPEC.md`
- Delete: `docs/build-plans/developed-economy-gate-design.md`, `docs/build-plans/developed-economy-gate-plan.md`

---

## Task 1: Remove the trade-flow processor from the tick pipeline

Deletes the every-tick price-diffusion processor. `EdgeView` (imported by the migration KEEP-set and `tick.ts`) is relocated out of the deleted world file first. **Critical correction to the design spec:** the trade-flow processor is the *only* code that pruned `flowEvents` (via `pruneFlowEvents`); directed-logistics only appends. So the `TRADE_SIMULATION` import in `tick.ts` is NOT removed — it is still needed for `FLOW_HISTORY_TICKS`, and pruning moves into the tick body after directed-logistics appends. Without this, `flowEvents` grows unbounded (memory + save bloat).

**Files:**
- Modify: `lib/tick/world/trade-flow-topology.ts`
- Modify: `lib/tick/processors/migration.ts:4`
- Modify: `lib/tick/world/migration-world.ts:1`
- Modify: `lib/tick/adapters/memory/migration.ts:1`
- Modify: `lib/world/tick.ts`
- Delete: `lib/tick/processors/trade-flow.ts`, `lib/tick/adapters/memory/trade-flow.ts`, `lib/tick/world/trade-flow-world.ts`, `lib/tick/processors/__tests__/trade-flow.test.ts`, `lib/engine/__tests__/trade-flow-integration.test.ts`
- Test: `lib/world/__tests__/tick.test.ts` (update)

**Interfaces:**
- Produces: `EdgeView` now exported from `lib/tick/world/trade-flow-topology.ts` (same shape: `{ aSystemId: string; bSystemId: string; fuelCost: number }`).
- Consumes: nothing new.

- [ ] **Step 1: Relocate `EdgeView` into the topology module**

In `lib/tick/world/trade-flow-topology.ts`, replace the type-only import at line 1 with a local declaration. Change:

```ts
import type { EdgeView } from "./trade-flow-world";
```

to:

```ts
/**
 * One unique unordered open edge (both endpoints share a faction).
 *
 * `buildOpenEdges` dedupes the bidirectional connection rows by ordering the
 * endpoints (aSystemId < bSystemId) so each pair appears once. `fuelCost` is the
 * distance source for downstream attenuation.
 */
export interface EdgeView {
  aSystemId: string;
  bSystemId: string;
  fuelCost: number;
}
```

Leave the rest of the file (the `buildOpenEdges` function) unchanged.

- [ ] **Step 2: Repoint the three remaining `EdgeView` importers**

`lib/tick/processors/migration.ts:4` — change:

```ts
import type { EdgeView } from "@/lib/tick/world/trade-flow-world";
```
to:
```ts
import type { EdgeView } from "@/lib/tick/world/trade-flow-topology";
```

`lib/tick/world/migration-world.ts:1` — change:
```ts
import type { EdgeView } from "@/lib/tick/world/trade-flow-world";
```
to:
```ts
import type { EdgeView } from "@/lib/tick/world/trade-flow-topology";
```

`lib/tick/adapters/memory/migration.ts:1` — change:
```ts
import type { EdgeView } from "@/lib/tick/world/trade-flow-world";
```
to:
```ts
import type { EdgeView } from "@/lib/tick/world/trade-flow-topology";
```

- [ ] **Step 3: Delete the five processor-exclusive files**

Run:
```bash
git rm lib/tick/processors/trade-flow.ts lib/tick/adapters/memory/trade-flow.ts lib/tick/world/trade-flow-world.ts lib/tick/processors/__tests__/trade-flow.test.ts lib/engine/__tests__/trade-flow-integration.test.ts
```

- [ ] **Step 4: Remove the trade-flow imports from `tick.ts`, keep the `TRADE_SIMULATION` import**

In `lib/world/tick.ts`, delete these two import lines (processor + adapter):
```ts
import { runTradeFlowProcessor } from "@/lib/tick/processors/trade-flow";
```
```ts
import { InMemoryTradeFlowWorld } from "@/lib/tick/adapters/memory/trade-flow";
```

Repoint the `EdgeView` type import (was `@/lib/tick/world/trade-flow-world`):
```ts
import type { EdgeView } from "@/lib/tick/world/trade-flow-topology";
```

**Keep** `import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";` — it is still used for `FLOW_HISTORY_TICKS` in Step 6.

- [ ] **Step 5: Delete the trade-flow stage block and rework the shared open-edges comment**

In `lib/world/tick.ts`, replace the migration/trade-flow region. Change this block:

```ts
  // ── migration & trade-flow share one open-edges computation — faction
  // ownership doesn't change between these two stages within a tick, so the
  // same-faction edge set migration computes is still valid for trade-flow ──
  const sysFactionForEdges = new Map(systems.map((s) => [s.id, s.factionId]));
  const openEdges: EdgeView[] = buildOpenEdges(connections, sysFactionForEdges);

  // ── migration ──
  {
    const migWorld = new InMemoryMigrationWorld({ systems }, connections, openEdges);
    await runMigrationProcessor(migWorld, newTickCtx(), {
      interval: ECONOMY_UPDATE_INTERVAL,
      flow: MIGRATION_PARAMS,
    });
    systems = migWorld.systems;
    processorsRun.push("migration");
  }

  // ── trade-flow ──
  {
    const flowWorld = new InMemoryTradeFlowWorld({ systems, markets, flowEvents }, connections, openEdges);
    await runTradeFlowProcessor(flowWorld, newTickCtx(), {
      interval: ECONOMY_UPDATE_INTERVAL,
      flowBudget: TRADE_SIMULATION.FLOW_BUDGET,
      gradientThreshold: TRADE_SIMULATION.GRADIENT_THRESHOLD,
      gradientSensitivity: TRADE_SIMULATION.GRADIENT_SENSITIVITY,
      flowHistoryTicks: TRADE_SIMULATION.FLOW_HISTORY_TICKS,
      distanceDecay: TRADE_SIMULATION.DISTANCE_DECAY,
    });
    markets = flowWorld.markets;
    // flowType now round-trips structurally through SimFlowEvent (no more
    // object-identity side channel — see FlowEventInsert/SimFlowEvent).
    flowEvents = flowWorld.flowEvents.map((f) => ({
      tick: f.tick,
      fromSystemId: f.fromSystemId,
      toSystemId: f.toSystemId,
      goodId: f.goodId,
      quantity: f.quantity,
      flowType: f.flowType,
    }));
    processorsRun.push("trade-flow");
  }
```

with (note: migration edge-gating is added in Task 4 — for now this task only removes trade-flow and keeps migration exactly as it was):

```ts
  // ── open edges (faction-bounded) — consumed by migration ──
  const sysFactionForEdges = new Map(systems.map((s) => [s.id, s.factionId]));
  const openEdges: EdgeView[] = buildOpenEdges(connections, sysFactionForEdges);

  // ── migration ──
  {
    const migWorld = new InMemoryMigrationWorld({ systems }, connections, openEdges);
    await runMigrationProcessor(migWorld, newTickCtx(), {
      interval: ECONOMY_UPDATE_INTERVAL,
      flow: MIGRATION_PARAMS,
    });
    systems = migWorld.systems;
    processorsRun.push("migration");
  }
```

- [ ] **Step 6: Move flow-event pruning into the tick body (after directed-logistics appends)**

In `lib/world/tick.ts`, in the directed-logistics stage block, the append currently ends the block:

```ts
    const newLogisticsFlows: WorldFlowEvent[] = dlWorld.flows.map((f) => ({ ...f, flowType: "logistics" }));
    flowEvents = [...flowEvents, ...newLogisticsFlows];
    processorsRun.push("directed-logistics");
  }
```

Change it to prune to the retention window right after appending (replicating the deleted processor's `pruneFlowEvents(ctx.tick - flowHistoryTicks)`, which kept `tick >= floor`):

```ts
    const newLogisticsFlows: WorldFlowEvent[] = dlWorld.flows.map((f) => ({ ...f, flowType: "logistics" }));
    flowEvents = [...flowEvents, ...newLogisticsFlows];
    // Prune the flow-event log to the overlay/logistics retention window. The
    // deleted trade-flow processor used to be the sole pruner; directed-logistics
    // is now the only writer, so pruning happens here after the append.
    const flowRetentionFloor = tick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;
    flowEvents = flowEvents.filter((f) => f.tick >= flowRetentionFloor);
    processorsRun.push("directed-logistics");
  }
```

- [ ] **Step 7: Update the stage-order doc comments**

In `lib/world/tick.ts`, the module doc comment (near line 9-11) and the `runWorldTick` doc comment (near line 464-468) both list the stage order with `trade-flow`. Remove `trade-flow` from both. Change each occurrence of:

```
population → migration → trade-flow → directed-logistics → directed-build
```
to:
```
population → migration → directed-logistics → directed-build
```
(the module-doc version wraps across lines as `population →\n * migration → trade-flow → directed-logistics → directed-build`; drop the `trade-flow → ` token wherever it appears).

- [ ] **Step 8: Update the surviving tick test**

In `lib/world/__tests__/tick.test.ts`, the test at ~line 162 is titled `"trade-flow/directed-logistics: produces flow events once territory is connected"`. With the processor gone, directed-logistics is the sole flow source (both linked homeworlds are `developed`, so logistics runs). Rename the test and reword its comment; keep the assertion. Change:

```ts
  it("trade-flow/directed-logistics: produces flow events once territory is connected", async () => {
    // A homeworld-only galaxy has no same-faction adjacencies, so no cross-system flows arise
    // until a faction connects developed territory. Put two developed homeworlds in one faction
    // and link them directly, so their differing production drives directed-logistics + trade-flow.
```
to:
```ts
  it("directed-logistics: produces flow events once developed territory is connected", async () => {
    // A homeworld-only galaxy has no same-faction adjacencies, so no cross-system flows arise
    // until a faction connects developed territory. Put two developed homeworlds in one faction
    // and link them directly, so their differing production drives directed-logistics.
```

- [ ] **Step 9: Verify gates**

Run:
```bash
npx tsc --noEmit
npx vitest run
```
Expected: both green. If `tsc` reports a dangling `EdgeView` or `InMemoryTradeFlowWorld`/`runTradeFlowProcessor` reference, an importer was missed — grep `rg "trade-flow-world|runTradeFlowProcessor|InMemoryTradeFlowWorld"` and repoint/remove.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(tick): remove the trade-flow price-diffusion processor

Relocate EdgeView into trade-flow-topology; delete the processor, its
adapter, world interface, and tests. Move flow-event pruning into the tick
body (directed-logistics is now the sole flowEvents writer).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Remove the dead "Trade Flows" market overlay

The market overlay was fed by the now-deleted processor's `flowType:"market"` rows, so it is permanently empty. Strip it end-to-end: the overlay toggle, its session persistence, its legend, the hook branch, the map-data field, the Pixi market layer, and the API `marketEdges` field. **Keep** the logistics overlay, `queryKeys.tradeFlow` + its `economyTick` invalidation (still backs logistics), `lib/engine/trade-flow-edges.ts` (`buildFlowEdges` still computes both edge sets — its `marketEdges` output is simply not surfaced), and the `TradeFlowLayer` class + `LOGISTICS_FLOW_CONFIG`. The `tradeFlowAlpha` LOD field is a generic particle-fade shared by the logistics layer — leave it.

**Files:** as listed in the File Structure section for Task 2.

**Interfaces:**
- Consumes: nothing new.
- Produces: `TradeFlowEdges` narrows to `{ logisticsEdges: TradeFlowEdgeInfo[] }`; `useTradeFlow(logisticsActive: boolean)` returns `{ logisticsEdges: TradeFlowEdgeInfo[] }`; `MapData` drops `flowEdges` (keeps `logisticsFlowEdges`).

- [ ] **Step 1: Drop `marketEdges` from the API type**

In `lib/types/api.ts`, change:
```ts
/** The two overlay edge sets the map renders — market diffusion and directed logistics. */
export interface TradeFlowEdges {
  marketEdges: TradeFlowEdgeInfo[];
  logisticsEdges: TradeFlowEdgeInfo[];
}
```
to:
```ts
/** The directed-logistics overlay edge set the map renders. */
export interface TradeFlowEdges {
  logisticsEdges: TradeFlowEdgeInfo[];
}
```

- [ ] **Step 2: Make `getTradeFlowEdges` return logistics-only**

In `lib/services/trade-flow.ts`, `buildFlowEdges` still returns `{ marketEdges, logisticsEdges }`; surface only logistics. Change:
```ts
  const allSystemIds = new Set(world.systems.map((s) => s.id));
  return buildFlowEdges(
    [...grouped.values()],
    allSystemIds,
    TRADE_SIMULATION.ROUTE_INFERENCE_FLOOR,
    TRADE_SIMULATION.LOGISTICS_ROUTE_FLOOR,
  );
```
to:
```ts
  const allSystemIds = new Set(world.systems.map((s) => s.id));
  const { logisticsEdges } = buildFlowEdges(
    [...grouped.values()],
    allSystemIds,
    TRADE_SIMULATION.ROUTE_INFERENCE_FLOOR,
    TRADE_SIMULATION.LOGISTICS_ROUTE_FLOOR,
  );
  return { logisticsEdges };
```
Also update the function's doc comment (drop "market diffusion +"):
```ts
/**
 * Returns the directed-logistics map-overlay edge set, aggregated over the last
 * `FLOW_HISTORY_TICKS`.
 */
```

- [ ] **Step 3: Update the service test**

In `lib/services/__tests__/trade-flow.test.ts`, remove any assertion referencing `marketEdges` (e.g. `expect(result.marketEdges)...`). Keep the `logisticsEdges` assertions and the `getSystemLogistics` tests. Run `rg "marketEdges" lib/services/__tests__/trade-flow.test.ts` and delete/rewrite each hit so it asserts only `logisticsEdges`.

- [ ] **Step 4: Simplify the `useTradeFlow` hook to logistics-only**

Replace `lib/hooks/use-trade-flow.ts` body:
```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { TradeFlowEdgeInfo, TradeFlowEdges } from "@/lib/types/api";

/**
 * Fetches the directed-logistics overlay edge set across the player's visible
 * systems. Tick-scoped: no viewport dependency, refetched only when ships arrive
 * or the cache stales. The array is zeroed when the overlay toggle is off so the
 * Pixi layer tears its particles down immediately.
 */
export function useTradeFlow(
  logisticsActive: boolean,
): { logisticsEdges: TradeFlowEdgeInfo[] } {
  const { data } = useQuery({
    queryKey: queryKeys.tradeFlow,
    queryFn: () => apiFetch<TradeFlowEdges>("/api/game/systems/trade-flow"),
    staleTime: 10_000,
    gcTime: 30_000,
    enabled: logisticsActive,
  });

  return {
    logisticsEdges: logisticsActive ? data?.logisticsEdges ?? [] : [],
  };
}
```

- [ ] **Step 5: Drop `tradeFlow` from the overlays hook**

In `lib/hooks/use-map-overlays.ts`: remove `tradeFlow: boolean;` from the `MapOverlays` interface; remove `tradeFlow: false,` from `DEFAULT_OVERLAYS`; remove the `tradeFlow: stored.tradeFlow ?? DEFAULT_OVERLAYS.tradeFlow,` line in `hydrateFromSession`; and remove `if (overlays.tradeFlow) stored.tradeFlow = true;` in the persist effect. Result interface:
```ts
export interface MapOverlays {
  events: boolean;
  logistics: boolean;
  priceHeatmap: boolean;
}
```

- [ ] **Step 6: Drop `tradeFlow` from session persistence**

In `components/map/map-session.ts`: remove `tradeFlow?: boolean;` from `MapOverlaysState` (line ~9) and remove the parse branch (lines ~26-28):
```ts
  if ("tradeFlow" in value && typeof value.tradeFlow === "boolean") {
    out.tradeFlow = value.tradeFlow;
  }
```
(An old session that stored `tradeFlow` is now silently ignored, matching the existing legacy-key behavior.)

- [ ] **Step 7: Update the session test**

In `components/map/__tests__/map-session.test.ts`, remove/adjust any case that round-trips `tradeFlow`. Run `rg "tradeFlow" components/map/__tests__/map-session.test.ts`; delete the assertion or drop the key from the fixture object so it no longer references `tradeFlow`.

- [ ] **Step 8: Remove the Trade Flows overlay control + legend**

In `components/map/map-overlay-controls.tsx`:

Change the `LegendKind` type:
```ts
type LegendKind = "price" | "tradeFlow" | "logistics";
```
to:
```ts
type LegendKind = "price" | "logistics";
```

Remove the `tradeFlow` entry from `OVERLAY_DEFS`:
```ts
  { key: "tradeFlow", label: "Trade Flows", swatch: pixiHexToCss(TIER_COLOR[2]), legend: "tradeFlow" },
```

In `OverlayLegend`, remove the `tradeFlow` branch:
```ts
  if (kind === "price") return <PriceRampLegend />;
  if (kind === "tradeFlow") return <TradeFlowLegend />;
  return <LogisticsLegend />;
```
becomes:
```ts
  if (kind === "price") return <PriceRampLegend />;
  return <LogisticsLegend />;
```

Delete the now-unused `TradeFlowLegend` function:
```ts
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
```

Reword the trailing sentence in `LogisticsLegend` (market diffusion no longer exists):
```ts
      <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">
        Curved arc = a faction haul across systems; the arrow points to the
        importing system. Straight dots are market diffusion.
      </p>
```
to:
```ts
      <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">
        Curved arc = a faction haul across systems; the arrow points to the
        importing system.
      </p>
```
(`TierSwatchList` stays — `LogisticsLegend` still uses it. `TIER_COLOR`/`TIER_LABEL`/`pixiHexToCss` imports stay — still used by the logistics swatch and `TierSwatchList`.)

- [ ] **Step 9: Drop `flowEdges` from `useMapData`**

In `lib/hooks/use-map-data.ts`:
- Remove `flowEdges` from the `MapData` interface (the block with its doc comment); keep `logisticsFlowEdges`.
- Remove `tradeFlowEdges: TradeFlowEdgeInfo[];` from `UseMapDataOptions`; keep `logisticsEdges`.
- Remove `tradeFlowEdges,` from the destructured params.
- Remove the `flowEdges` memo: `const flowEdges = useMemo(() => keyByCanonicalPair(tradeFlowEdges), [tradeFlowEdges]);` (keep the `logisticsFlowEdges` memo).
- Remove `flowEdges,` from the returned object.

- [ ] **Step 10: Update `star-map.tsx` wiring**

In `components/map/star-map.tsx`:

Change the `useTradeFlow` call:
```ts
  const { marketEdges, logisticsEdges } = useTradeFlow(
    overlays.tradeFlow,
    overlays.logistics,
  );
```
to:
```ts
  const { logisticsEdges } = useTradeFlow(overlays.logistics);
```

In the `useMapData({ ... })` call, remove the `tradeFlowEdges: marketEdges,` line (keep `logisticsEdges,`).

- [ ] **Step 11: Drop the market Pixi layer**

In `components/map/pixi/pixi-map-canvas.tsx`, remove every `tradeFlowLayer` (the market layer) reference, keeping `logisticsFlowLayer`:
- Remove `tradeFlowLayer: TradeFlowLayer;` from the Pixi-objects interface (line ~61).
- Remove its creation + stage add (lines ~162-165):
  ```ts
      // Trade-flow particles render between connections and territories so
      // they sit on top of the static graph but below region fills/labels.
      const tradeFlowLayer = new TradeFlowLayer();
      world.addChild(tradeFlowLayer.container);
  ```
- Reword the logistics comment (line ~167) from `Logistics convoys render just above market diffusion, below territories.` to `Logistics convoys render above the connection graph, below territories.`
- Remove the market layer's per-frame update (lines ~255-258):
  ```ts
        \ Trade-flow overlay: layer alpha multiplies the system fade so the
        // overlay disappears alongside its host systems at universe zoom.
        tradeFlowLayer.updateVisibility(frustum, lod, lod.systemLayerAlpha);
        if (tradeFlowLayer.container.visible) tradeFlowLayer.update(dtMs);
  ```
  (keep the immediately-following `logisticsFlowLayer` update).
- Remove `tradeFlowLayer,` from the refs object literal (line ~274).
- Remove `refs.tradeFlowLayer.destroy();` (line ~295).
- Remove the market sync (line ~366): `p.tradeFlowLayer.sync(mapData.systems, mapData.flowEdges);` (keep the logistics sync on the next line).

The `import { TradeFlowLayer, LOGISTICS_FLOW_CONFIG }` line stays (both still used).

- [ ] **Step 12: Retire `MARKET_FLOW_CONFIG`**

In `components/map/pixi/layers/trade-flow-layer.ts`, `MARKET_FLOW_CONFIG` is now the class's default constructor arg but has no caller (logistics always passes `LOGISTICS_FLOW_CONFIG`). Delete the `export const MARKET_FLOW_CONFIG: FlowLayerConfig = { ... };` block and make the constructor default to logistics:
```ts
  constructor(private config: FlowLayerConfig = MARKET_FLOW_CONFIG) {}
```
to:
```ts
  constructor(private config: FlowLayerConfig = LOGISTICS_FLOW_CONFIG) {}
```
Update the config-doc comment (line ~11 `Per-overlay rendering config — market (straight) vs logistics (arced).`) to `Per-overlay rendering config for the directed-logistics flow particles.` and the class doc reference (lines ~64-65) that names `MARKET_FLOW_CONFIG` — drop that name, keep the `LOGISTICS_FLOW_CONFIG` reference. (`LOGISTICS_FLOW_CONFIG` must be declared before the class; it already is, at line ~43.)

- [ ] **Step 13: Verify gates**

Run:
```bash
npx tsc --noEmit
npx vitest run
npx next build --webpack
```
Expected: all green. `tsc` catches any missed `marketEdges`/`flowEdges`/`tradeFlow` reference. If the build flags an unused import (`TIER_COLOR` in `map-overlay-controls.tsx`, say), remove it.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(map): remove the empty Trade Flows market overlay

The market overlay was fed by the deleted price-diffusion processor and is
now always empty. Strip the toggle, legend, hook branch, map-data field,
Pixi market layer, and the API marketEdges field. Logistics overlay stays.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add the `isEconomicallyActive` predicate

The single economy-participation predicate, consumed by the tick body, the economy adapter, directed-build, and the system-detail services. Pure engine (no I/O), so both Sim-row processor paths and `WorldSystem`-based services can call it.

**Files:**
- Create: `lib/engine/control.ts`
- Test: `lib/engine/__tests__/control.test.ts`

**Interfaces:**
- Produces: `isEconomicallyActive(control: SystemControl): boolean` (`lib/engine/control.ts`).

- [ ] **Step 1: Write the failing test**

Create `lib/engine/__tests__/control.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isEconomicallyActive } from "@/lib/engine/control";

describe("isEconomicallyActive", () => {
  it("is true only for developed systems", () => {
    expect(isEconomicallyActive("developed")).toBe(true);
  });

  it("is false for controlled and unclaimed systems", () => {
    expect(isEconomicallyActive("controlled")).toBe(false);
    expect(isEconomicallyActive("unclaimed")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/control.test.ts`
Expected: FAIL — cannot resolve `@/lib/engine/control`.

- [ ] **Step 3: Create the predicate**

Create `lib/engine/control.ts`:
```ts
import type { SystemControl } from "@/lib/world/types";

/**
 * A system participates in the economy (population, migration, market, logistics)
 * only once developed. Unclaimed and controlled systems are inert: their seeded
 * markets freeze and no population settles. This is the single predicate every
 * economy selection path gates through — the tick body, the economy adapter's
 * system selection, directed-build's build gate, and the system-detail services.
 */
export function isEconomicallyActive(control: SystemControl): boolean {
  return control === "developed";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/control.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/control.ts lib/engine/__tests__/control.test.ts
git commit -m "$(cat <<'EOF'
feat(engine): add isEconomicallyActive control predicate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Gate the economy on developed control (+ tripwire invariant test)

TDD: the tripwire integration test is the RED driver. Pre-gate, migration seeds population into `controlled` systems (population 0, `popCap > 0`, adjacent to a populated developed same-faction neighbour → maximally attractive), so the invariant fails. The three gates make it pass. Infrastructure-decay and population need no gate — they key off the economy's `dissatisfactionBySystem` signal set, so gating the economy's selection cascades to both.

**Files:**
- Create: `lib/world/__tests__/developed-gate-invariant.test.ts`
- Modify: `lib/tick/adapters/memory/economy.ts` (economy selection gate)
- Modify: `lib/world/tick.ts` (migration edge gate + directed-logistics participant gate)
- Modify: `lib/engine/directed-build.ts` (adopt the shared predicate for consistency)

**Interfaces:**
- Consumes: `isEconomicallyActive` from `@/lib/engine/control` (Task 3).

- [ ] **Step 1: Write the failing tripwire test**

Create `lib/world/__tests__/developed-gate-invariant.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import { MONTH_LENGTH } from "@/lib/constants/tick-cadence";
import type { World } from "@/lib/world/types";

async function advance(world: World, ticks: number): Promise<World> {
  for (let t = 0; t < ticks; t++) world = (await runWorldTick(world)).world;
  return world;
}

const marketKey = (systemId: string, goodId: string) => `${systemId}|${goodId}`;

describe("developed-gate invariant: only developed systems are economically active", () => {
  it("keeps non-developed systems at population 0, with frozen markets and no flow activity, across claim + develop pulses", async () => {
    const seed = generateWorld({ systemCount: 90, seed: 11 });
    // Snapshot the seeded market stock so we can assert non-developed markets never moved.
    const seedStock = new Map<string, number>();
    for (const m of seed.markets) seedStock.set(marketKey(m.systemId, m.goodId), m.stock);

    // Advance far enough that both claims (controlled) and developments (developed) fire.
    const world = await advance(seed, MONTH_LENGTH * 4);

    // Sanity: the run actually produced controlled (non-developed, owned) systems — otherwise
    // the migration-leak path this test guards would be exercised vacuously.
    expect(world.systems.some((s) => s.control === "controlled")).toBe(true);

    const nonDeveloped = new Set(
      world.systems.filter((s) => s.control !== "developed").map((s) => s.id),
    );

    // (1) No population settles in a non-developed system.
    for (const s of world.systems) {
      if (s.control !== "developed") expect(s.population).toBe(0);
    }

    // (2) A non-developed system's market stock is unchanged from the seed (no production/
    //     consumption/logistics ran there).
    for (const m of world.markets) {
      if (nonDeveloped.has(m.systemId)) {
        expect(m.stock).toBe(seedStock.get(marketKey(m.systemId, m.goodId)));
      }
    }

    // (3) No flow event references a non-developed system (control is monotonic, so a developed
    //     endpoint was developed when the flow was emitted).
    for (const f of world.flowEvents) {
      expect(nonDeveloped.has(f.fromSystemId)).toBe(false);
      expect(nonDeveloped.has(f.toSystemId)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (documents the leak)**

Run: `npx vitest run lib/world/__tests__/developed-gate-invariant.test.ts`
Expected: FAIL on assertion (1) — at least one `controlled` system has `population > 0` (migration leak). If it passes unexpectedly (no controlled-adjacent-to-developed system accumulated pop for this seed), raise the advance window to `MONTH_LENGTH * 6` and/or `systemCount: 120` until the RED reproduces, then keep that value.

- [ ] **Step 3: Gate the economy selection in the adapter**

In `lib/tick/adapters/memory/economy.ts`, add the import:
```ts
import { isEconomicallyActive } from "@/lib/engine/control";
```
and gate `getSystemIds` so only developed systems are ever resolved (non-developed systems' markets are never in a processed slice, so they freeze; their `dissatisfactionBySystem` entries are never produced, so infrastructure-decay + population skip them):
```ts
  getSystemIds(): Promise<string[]> {
    return Promise.resolve(economyShardOrder(this.systems));
  }
```
to:
```ts
  getSystemIds(): Promise<string[]> {
    // Only developed systems participate in the economy. Non-developed systems stay
    // in `this.systems`/`this.markets` untouched (frozen) — they are simply never
    // selected here, and the population/infrastructure-decay processors key off this
    // set's dissatisfaction signals, so gating here cascades to both.
    return Promise.resolve(
      economyShardOrder(this.systems.filter((s) => isEconomicallyActive(s.control))),
    );
  }
```

- [ ] **Step 4: Gate migration edges + directed-logistics participants in the tick body**

In `lib/world/tick.ts`, add the import near the other engine imports:
```ts
import { isEconomicallyActive } from "@/lib/engine/control";
```

At the open-edges region (from Task 1 Step 5), derive the developed set once and gate migration's edges so an edge is open only when **both** endpoints are developed. Change:
```ts
  // ── open edges (faction-bounded) — consumed by migration ──
  const sysFactionForEdges = new Map(systems.map((s) => [s.id, s.factionId]));
  const openEdges: EdgeView[] = buildOpenEdges(connections, sysFactionForEdges);

  // ── migration ──
  {
    const migWorld = new InMemoryMigrationWorld({ systems }, connections, openEdges);
    await runMigrationProcessor(migWorld, newTickCtx(), {
      interval: ECONOMY_UPDATE_INTERVAL,
      flow: MIGRATION_PARAMS,
    });
    systems = migWorld.systems;
    processorsRun.push("migration");
  }
```
to:
```ts
  // ── economy-participation gate (developed only) ──
  // The three economy selection paths gate through isEconomicallyActive: the economy
  // adapter's getSystemIds (which cascades to infrastructure-decay + population),
  // migration's open edges (below), and directed-logistics' participants (below).
  // directed-build keeps the full `systems` — it needs unclaimed/controlled to claim
  // and develop.
  const developedSystemIds = new Set(
    systems.filter((s) => isEconomicallyActive(s.control)).map((s) => s.id),
  );

  // ── open edges (faction-bounded, then gated to developed-both for migration) ──
  const sysFactionForEdges = new Map(systems.map((s) => [s.id, s.factionId]));
  const openEdges: EdgeView[] = buildOpenEdges(connections, sysFactionForEdges);
  const migrationEdges = openEdges.filter(
    (e) => developedSystemIds.has(e.aSystemId) && developedSystemIds.has(e.bSystemId),
  );

  // ── migration ──
  {
    const migWorld = new InMemoryMigrationWorld({ systems }, connections, migrationEdges);
    await runMigrationProcessor(migWorld, newTickCtx(), {
      interval: ECONOMY_UPDATE_INTERVAL,
      flow: MIGRATION_PARAMS,
    });
    systems = migWorld.systems;
    processorsRun.push("migration");
  }
```

In the directed-logistics stage block, gate the participant rows to developed systems. Change:
```ts
    const rows = buildLogisticsRows(systems, logisticsMarketRows);
```
to:
```ts
    // Directed-logistics moves goods only between developed systems.
    const rows = buildLogisticsRows(
      systems.filter((s) => isEconomicallyActive(s.control)),
      logisticsMarketRows,
    );
```
(Filtering by the predicate on the current `systems` is correct: control is monotonic and only directed-build — which runs *after* directed-logistics — changes it, so the developed set is stable through this point in the tick.)

- [ ] **Step 5: Adopt the predicate in directed-build (DRY, no behaviour change)**

In `lib/engine/directed-build.ts`, add the import:
```ts
import { isEconomicallyActive } from "@/lib/engine/control";
```
and change the develop gate (line ~360) from the hard-coded literal:
```ts
    if (s.control !== "developed") continue;
```
to:
```ts
    if (!isEconomicallyActive(s.control)) continue;
```
(If `tsc` reports a type mismatch, `BuildSystemState.control` is not `SystemControl` — fix the type at its declaration rather than casting.)

- [ ] **Step 6: Run the tripwire + full suite to verify GREEN**

Run:
```bash
npx vitest run lib/world/__tests__/developed-gate-invariant.test.ts
npx tsc --noEmit
npx vitest run
```
Expected: the tripwire passes; full suite green. If `tick-expansion.test.ts` or `tick.test.ts` regress, read the failure — expansion/claim/develop and directed-build are untouched by the gate, so a regression means the economy gate dropped a developed system (check `economyShardOrder` receives the filtered list, not an empty one when homeworlds exist).

- [ ] **Step 7: Run the calibration harness (coarse health)**

Run: `npm run simulate`
Expected: no `NaN`/`Infinity`, no runaway; controlled/unclaimed systems report population 0. This is the coarse gate — do not chase precise magnitudes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(tick): gate the economy on developed control

Only developed systems participate in the economy: economy selection
(cascading to infrastructure-decay + population), migration open-edges
(developed-both), and directed-logistics participants all gate through
isEconomicallyActive. A tripwire invariant test locks it: non-developed
systems stay at population 0 with frozen markets and no flow activity.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Hide the four economy tabs for non-developed systems + service defense-in-depth

The panel tab bar shows only Overview + Astrography for a non-developed system, reading the **live** developed tier from the tick-invalidated `useOwnership`. The map system-detail panel hides the same four shortcut buttons (it already carries a live `developed` flag via the ownership-overlaid atlas). Defense-in-depth: the four backing services return the inert empty shape so a hand-typed URL renders gracefully.

**Files:**
- Modify: `app/(game)/@panel/system/[systemId]/layout.tsx`
- Modify: `components/map/system-detail-panel.tsx`
- Modify: `lib/services/system-population.ts`, `lib/services/universe.ts` (`getSystemIndustry`), `lib/services/trade-flow.ts` (`getSystemLogistics`), `lib/services/market.ts`
- Create: `lib/services/__tests__/developed-gate-services.test.ts`

**Interfaces:**
- Consumes: `useOwnership()` → `Map<string, { factionId; developed }>`; `isEconomicallyActive` (services). `SystemPopulationData`/`SystemIndustryData`/`SystemLogisticsData` already carry a `{ visibility: "unknown" }` variant. `getMarket` returns `{ stationId; entries }` — its inert shape is empty `entries`.

- [ ] **Step 1: Write the failing service test**

Create `lib/services/__tests__/developed-gate-services.test.ts`. It generates a world, finds a non-developed system, and asserts the four services return the inert shape. (World-gen: homeworlds are `developed`; every non-homeworld starts `unclaimed`.)
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld } from "@/lib/world/store";
import { getSystemPopulation } from "@/lib/services/system-population";
import { getSystemIndustry } from "@/lib/services/universe";
import { getSystemLogistics } from "@/lib/services/trade-flow";
import { getMarket } from "@/lib/services/market";

describe("system-detail services gate on developed control", () => {
  beforeEach(() => {
    setWorld(generateWorld({ systemCount: 60, seed: 7 }));
  });

  it("returns the inert shape for a non-developed system", () => {
    const world = generateWorld({ systemCount: 60, seed: 7 });
    setWorld(world);
    const undeveloped = world.systems.find((s) => s.control !== "developed")!;

    expect(getSystemPopulation(undeveloped.id)).toEqual({ visibility: "unknown" });
    expect(getSystemIndustry(undeveloped.id)).toEqual({ visibility: "unknown" });
    expect(getSystemLogistics(undeveloped.id)).toEqual({ visibility: "unknown" });
    expect(getMarket(undeveloped.id)).toEqual({ stationId: undeveloped.id, entries: [] });
  });

  it("returns visible data for a developed homeworld", () => {
    const world = generateWorld({ systemCount: 60, seed: 7 });
    setWorld(world);
    const developed = world.systems.find((s) => s.control === "developed")!;

    expect(getSystemPopulation(developed.id).visibility).toBe("visible");
    expect(getSystemIndustry(developed.id).visibility).toBe("visible");
  });
});
```
Confirm the `setWorld` export name first: `rg "export function setWorld|export const setWorld" lib/world/store.ts`. If the store uses a different setter, use that name.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/services/__tests__/developed-gate-services.test.ts`
Expected: FAIL — the services currently return visible data (or throw) for a non-developed system.

- [ ] **Step 3: Gate `getSystemPopulation`**

In `lib/services/system-population.ts`, add the import:
```ts
import { isEconomicallyActive } from "@/lib/engine/control";
```
and after the not-found check, return the inert shape for non-developed systems:
```ts
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError("System not found.", 404);
```
to:
```ts
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError("System not found.", 404);
  if (!isEconomicallyActive(system.control)) return { visibility: "unknown" };
```

- [ ] **Step 4: Gate `getSystemIndustry`**

In `lib/services/universe.ts`, add `isEconomicallyActive` to the imports from `@/lib/engine/control` (add a new import line if none exists), and after the not-found check in `getSystemIndustry`:
```ts
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) {
    throw new ServiceError("System not found.", 404);
  }
```
to:
```ts
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) {
    throw new ServiceError("System not found.", 404);
  }
  if (!isEconomicallyActive(system.control)) return { visibility: "unknown" };
```

- [ ] **Step 5: Gate `getSystemLogistics`**

In `lib/services/trade-flow.ts`, add the import:
```ts
import { isEconomicallyActive } from "@/lib/engine/control";
```
and gate right after the system lookup (it already returns `{ visibility: "unknown" }` when the system is absent):
```ts
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) return { visibility: "unknown" };
```
to:
```ts
  const system = world.systems.find((s) => s.id === systemId);
  if (!system || !isEconomicallyActive(system.control)) return { visibility: "unknown" };
```

- [ ] **Step 6: Gate `getMarket`**

In `lib/services/market.ts`, add the import:
```ts
import { isEconomicallyActive } from "@/lib/engine/control";
```
and return empty entries for a non-developed system (its inert shape — no `visibility` field on this response):
```ts
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) {
    throw new ServiceError("System not found.", 404);
  }
```
to:
```ts
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) {
    throw new ServiceError("System not found.", 404);
  }
  if (!isEconomicallyActive(system.control)) {
    return { stationId: systemId, entries: [] };
  }
```

- [ ] **Step 7: Run the service test to verify GREEN**

Run: `npx vitest run lib/services/__tests__/developed-gate-services.test.ts`
Expected: PASS.

- [ ] **Step 8: Hide the four tabs in the panel layout**

In `app/(game)/@panel/system/[systemId]/layout.tsx`, add the import:
```ts
import { useOwnership } from "@/lib/hooks/use-ownership";
```
In `SystemPanelContent`, read the live developed tier and filter the tab list. Change:
```ts
  const { systemInfo, regionInfo } = useSystemInfo(systemId);
  const pathname = usePathname();

  const basePath = `/system/${systemId}`;
  const tabs = SYSTEM_TABS.map((tab) => {
    const href = tab.segment ? `${basePath}/${tab.segment}` : basePath;
    return {
      label: tab.label,
      href,
      active: tab.segment ? pathname.startsWith(href) : pathname === basePath,
    };
  });
```
to:
```ts
  const { systemInfo, regionInfo } = useSystemInfo(systemId);
  const ownership = useOwnership();
  const pathname = usePathname();

  // Live developed tier (tick-invalidated). Non-developed systems show only Overview +
  // Astrography; the four economy tabs (Population/Industry/Logistics/Market) are hidden.
  // Default to developed while ownership is still loading so we never hide a real system's
  // tabs on a cold direct-load — the services gate the inert case regardless.
  const isDeveloped = ownership.get(systemId)?.developed ?? true;
  const visibleTabs = SYSTEM_TABS.filter(
    (tab) => isDeveloped || tab.segment === "" || tab.segment === "astrography",
  );

  const basePath = `/system/${systemId}`;
  const tabs = visibleTabs.map((tab) => {
    const href = tab.segment ? `${basePath}/${tab.segment}` : basePath;
    return {
      label: tab.label,
      href,
      active: tab.segment ? pathname.startsWith(href) : pathname === basePath,
    };
  });
```

- [ ] **Step 9: Hide the four shortcut buttons in the map system-detail panel**

In `components/map/system-detail-panel.tsx`, the tab shortcuts (rendered when `visibility === "visible"`) iterate `SYSTEM_TABS`. Gate the four economy segments on the system's live `developed` flag (`StarSystemInfo.developed`, populated by the ownership-overlaid atlas in `star-map.tsx`). Change:
```ts
            {SYSTEM_TABS.filter((tab) => tab.segment).map((tab) => (
```
to:
```ts
            {SYSTEM_TABS.filter(
              (tab) => tab.segment && (system.developed || tab.segment === "astrography"),
            ).map((tab) => (
```
(`system` is non-null here — the early `if (!system) return null;` guards it.)

- [ ] **Step 10: Verify gates**

Run:
```bash
npx tsc --noEmit
npx vitest run
npx next build --webpack
```
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(ui): hide economy tabs for non-developed systems + gate services

The panel tab bar and the map detail-panel shortcuts show only Overview +
Astrography for non-developed systems (live developed tier from useOwnership).
The four backing services return the inert empty shape as defense-in-depth
against direct URLs.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Promote the docs and delete the build-plans

Fold the shipped reality ("developed = economically active; controlled/unclaimed inert; the trade-flow processor is gone, directed-logistics is the sole goods-mover") into the active gameplay docs in present tense, then delete both transient build-plan docs. Do this on the feature branch **before** the squash-merge so no docs-only follow-up PR is needed.

**Files:**
- Modify: `docs/active/gameplay/faction-system.md`, `docs/active/gameplay/economy-autonomic-agency.md`, `docs/SPEC.md`
- Delete: `docs/build-plans/developed-economy-gate-design.md`, `docs/build-plans/developed-economy-gate-plan.md`

- [ ] **Step 1: Read the target active docs**

Read `docs/active/gameplay/economy-autonomic-agency.md` (it already states the develop-gate for building at `control === "developed"`) and `docs/active/gameplay/faction-system.md`. Identify where the economy-participation rule and the goods-movement model are described.

- [ ] **Step 2: Fold in the economy-participation rule**

In `docs/active/gameplay/economy-autonomic-agency.md`, add a present-tense statement that only developed systems are economically active — population, migration, market resolution, and directed-logistics all require `control === "developed"` (via `isEconomicallyActive`); unclaimed and controlled systems are inert (seeded markets frozen, population 0). State that goods move only via directed-logistics (there is no price-diffusion between markets). No change-history framing ("removed", "Phase") — describe current reality.

- [ ] **Step 3: Reconcile any trade-flow-processor references in active docs**

Run `rg -l "trade-flow|price diffusion|market diffusion" docs/active docs/SPEC.md`. In each active/SPEC hit that describes the deleted **processor** or price-diffusion as a live mechanic, rewrite to present reality: directed-logistics is the sole goods-mover; the trade-flow *service*/logistics overlay still exist. Leave `docs/planned/` untouched.

- [ ] **Step 4: Update SPEC.md system-interaction map**

In `docs/SPEC.md`, update the tick/processor list and any system-interaction description that names the trade-flow processor or price-diffusion, so it reflects the current pipeline (ship-arrivals → events → economy → infrastructure-decay → population → migration → directed-logistics → directed-build → relations) and the developed-gate.

- [ ] **Step 5: Delete both build-plan docs**

```bash
git rm docs/build-plans/developed-economy-gate-design.md docs/build-plans/developed-economy-gate-plan.md
```

- [ ] **Step 6: Verify gates (build must pass — docs are Tailwind-scanned)**

Run:
```bash
npx vitest run
npx next build --webpack
```
Expected: green. `docs/` is excluded from the Tailwind scan via `@source not "../docs"`, but run the webpack build anyway to confirm no prose triggers the `Invalid code point` abort.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
docs: promote developed-economy-gate to active docs; delete build-plans

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage (design spec → task):**
- Part 1 delete trade-flow processor (files, `EdgeView` relocation, tick.ts wiring, tick.test.ts) → Task 1. Plus the plan's correction: flowEvents pruning relocated, `TRADE_SIMULATION` import kept (Task 1 Steps 4, 6).
- Part 1 strip market overlay (overlays hook, session, controls/legend, `useTradeFlow`, `use-map-data`, pixi canvas, api type, service) → Task 2. Plus the tests the spec's KEEP-list didn't flag but the type change forces (`map-session.test.ts`, `services/__tests__/trade-flow.test.ts`) → Task 2 Steps 3, 7.
- Part 2 the predicate → Task 3; the three gates + directed-build adoption → Task 4 (economy via adapter selection — spec-sanctioned "filter inside the adapter's selection method"; migration + directed-logistics in the tick body; the shared developed set co-located in the tick body).
- Part 3 UI tabs + four service gates → Task 5 (plus the map detail-panel shortcuts, for consistency).
- Part 4 tripwire invariant test → Task 4 Step 1 (used as the TDD RED driver).
- Sequencing (one PR, ordered Part 1 → 2 → 3 → 4) and doc lifecycle → Task 6.

**Placeholder scan:** No "TBD"/"handle edge cases"/"write tests for the above" — every code step shows the exact old→new text or full file content; every command has an expected outcome.

**Type consistency:** `isEconomicallyActive(control: SystemControl): boolean` is defined once (Task 3) and consumed with `SystemControl` values everywhere (`SimSystem.control`, `WorldSystem.control`, `BuildSystemState.control`). `TradeFlowEdges` narrows to `{ logisticsEdges }` in Task 2 Step 1 and every consumer (`useTradeFlow`, `getTradeFlowEdges`) is updated in the same task. `MapData` drops `flowEdges` (Step 9) and its only reader (`pixi-map-canvas` sync) is removed in the same task (Step 11). `EdgeView` moves to `trade-flow-topology.ts` (Task 1 Step 1) and all four importers repoint in Steps 2 and 4.

**Known residuals (intentionally out of scope):** `SimConstants.tradeFlow` in `lib/engine/simulator/constants.ts` is pre-existing sim config not wired to the deleted processor (the runner calls `runWorldTick`, which reads the real `TRADE_SIMULATION` constant directly); it stays inert and its scaling test is unaffected. The `tradeFlowAlpha` LOD field is a generic particle-fade shared by the surviving logistics layer; it stays. Both are noted here so a reviewer doesn't read their absence as an oversight.
