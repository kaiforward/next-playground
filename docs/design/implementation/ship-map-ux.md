# Ship Map UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source spec:** [`docs/design/planned/ship-map-ux/ship-map-ux.md`](../planned/ship-map-ux/ship-map-ux.md) · **Visual reference:** [`docs/design/planned/ship-map-ux/mockup.html`](../planned/ship-map-ux/mockup.html) (the v2 mockup — the binding source of truth for colours, shapes, and sizing).

**Goal:** Make the player's fleet legible on the star map — a high-contrast docked-ship pill (replacing the faint pulse ring) and always-visible directional in-transit markers with progressive-disclosure routes (hover ghost / click select / "Ship Routes" overlay).

**Architecture:** Entirely client-side — **no schema, API, or service changes**. In-transit ships already arrive via `useFleet().fleet.ships` (status `in_transit`); the live tick comes from `useTickContext`. A new pure engine module (`lib/engine/transit-position.ts`, unit-tested) does all path/position/cluster math; a thin new Pixi layer (`fleet-transit-layer.ts`) renders markers + routes; the docked pill is folded into the existing `SystemObject`.

**Tech Stack:** Next.js 16 (App Router), TypeScript 5 (strict), Pixi.js v8, Tailwind v4 + `tv()`, TanStack Query v5 Suspense, Vitest 4 (unit project).

**Branch state at plan start:** Branch `feat/ship-map-ux` already exists and contains the spec commit `350f7de`. Land each PR below back on this shared branch via phase PRs, then one final PR to `main` (per `[[workflow-shared-feature-branch]]`).

---

## Conventions Recap

Pulled forward so the executor doesn't re-read CLAUDE.md:

- **No `as` casts** (only `as const` / guards in `lib/types/guards.ts`). **No `unknown`** — type at the source.
- **Engine functions are pure** (no DB, no Pixi imports); tests in sibling `__tests__/`. Run with `npx vitest run --project unit`.
- **Pixi layers** follow the established pattern (see `components/map/pixi/layers/price-heatmap-layer.ts` and `effect-layer.ts`): a `container`, a `sync()` that ingests React data, an `updateVisibility(frustum, alpha)` for per-frame culling, an `update(dtMs, …)` for animation, and a `destroy()` that frees Maps/objects.
- **Foundry theme**: sharp corners except the existing small map-badge rounding (the price badge uses `BADGE_CORNER = 2`); `font-mono` for numerics.
- **Vitest include glob**: `lib/**/__tests__/**/*.test.ts` already covers `lib/engine/__tests__/` — no config change needed.
- **Shell**: never `cd` in compound commands; run from repo root.

**Verification commands** (used throughout):
- Unit tests: `npx vitest run --project unit`
- Single test file: `npx vitest run lib/engine/__tests__/transit-position.test.ts`
- Lint: `npm run lint`
- Typecheck + build: `npm run build`
- Manual: `npm run dev` then view `http://localhost:3000` (the map is the home route).

---

## PR 1 — Docked pill + remove pulse ring

**Scope:** `theme.ts`, `system-object.ts`, `effect-layer.ts`, `pixi-map-canvas.tsx`. No tests (pure Pixi rendering — verified manually). Self-contained and shippable on its own.

### Task 1.1: Add `FLEET` theme constants; remove unused pulse constants

**Files:**
- Modify: `components/map/pixi/theme.ts`

- [ ] **Step 1: Add the `FLEET` block** (after the `FLEET_DOTS` block, ~line 43)

```typescript
// ── Fleet markers (docked pill + in-transit marker + routes) ─────
// Colours/sizes are the binding values from the v2 mockup
// (docs/design/planned/ship-map-ux/mockup.html).
export const FLEET = {
  pillFill: 0x38bdf8,     // sky-400 — pill body, docked + in-transit
  pillContent: 0x0a1018,  // near-black — ship glyph + count drawn on the pill
  pillCorner: 2,          // matches the price-heatmap badge corner
  markerHeight: 18,       // pill height (world units, before counter-scale)
  markerMinWidth: 22,     // single-ship pill width
  chevronSize: 8,         // direction nose / ship glyph size
  countDigitWidth: 8,     // extra pill width per count digit
  hitRadius: 16,          // marker pointer hit radius
  clusterBadge: 0xd06a42, // copper accent — cluster/convoy count badge
  clusterThresholdPx: 26, // SCREEN-space merge distance (÷ zoom for world)
  markerScreenScale: 1,   // markers held at constant screen size (÷ zoom)
  routeHover:  { color: 0x38bdf8, alpha: 0.4,  width: 1.8 },
  routeActive: { color: 0x22d3ee, alpha: 0.85, width: 2.6 },
  routeAll:    { color: 0x38bdf8, alpha: 0.22, width: 1.4 },
} as const;
```

- [ ] **Step 2: Remove the now-unused pulse-ring constants** from the `ANIM` block (the pulse ring is deleted in Task 1.3). Delete these two lines:

```typescript
  pulseRingPeriod:   2000,   // ms per cycle
  pulseRingMaxRadius: 30,
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: builds — but it will FAIL until Task 1.3 removes the `ANIM.pulseRing*` references in `effect-layer.ts`. That's expected; proceed to 1.2/1.3 and re-run at 1.4.

### Task 1.2: Draw the docked pill in `SystemObject`

**Files:**
- Modify: `components/map/pixi/objects/system-object.ts`

- [ ] **Step 1: Replace the `SHIP_STYLE` text style** (lines 20–26) with a count style:

```typescript
const DOCKED_COUNT_STYLE = new TextStyle({
  fontSize: 12,
  fill: FLEET.pillContent,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontWeight: "700",
  align: "center",
});
```

- [ ] **Step 2: Update the theme import** (line 5) to include `FLEET`:

```typescript
import { ECONOMY_COLORS, NAV_COLORS, SIZES, TEXT_COLORS, EVENT_DOT_COLORS, FLEET, TEXT_RESOLUTION } from "../theme";
```

- [ ] **Step 3: Swap the `shipLabel` field for a docked-pill container.** Replace the `private shipLabel: Text;` declaration (line 37) with:

```typescript
  private dockedPill: Container;
  private dockedPillBg: Graphics;
  private dockedGlyph: Graphics;
  private dockedCount: Text;
```

Add the `Container` import to the top-of-file Pixi import (line 1):

```typescript
import { Container, Graphics, Text, TextStyle } from "pixi.js";
```

- [ ] **Step 4: Replace the `shipLabel` construction** (lines 84–87) in the constructor with the pill container, anchored top-left of the core:

```typescript
    // Docked-ship pill (top-left of the glyph; replaces the pulse ring + text)
    this.dockedPill = new Container();
    this.dockedPillBg = new Graphics();
    this.dockedGlyph = new Graphics();
    this.dockedCount = new Text({ text: "", style: DOCKED_COUNT_STYLE, resolution: TEXT_RESOLUTION });
    this.dockedCount.anchor.set(0, 0.5);
    this.dockedPill.addChild(this.dockedPillBg, this.dockedGlyph, this.dockedCount);
    this.dockedPill.visible = false;
    this.addChild(this.dockedPill);
```

- [ ] **Step 5: Replace the ship-count update block** (lines 164–177) with a pill redraw:

```typescript
    if (shipChanged) {
      this.currentShipCount = data.shipCount;
      if (data.shipCount > 0) {
        this.dockedPill.visible = true;
        this.drawDockedPill(data.shipCount);
      } else {
        this.dockedPill.visible = false;
      }
    }
```

- [ ] **Step 6: Add the `drawDockedPill` method** (after `update`, before `setLOD`):

```typescript
  private drawDockedPill(count: number) {
    const h = FLEET.markerHeight;
    const pad = 5;
    const glyphW = FLEET.chevronSize;
    this.dockedCount.text = String(count);
    const textW = this.dockedCount.width;
    const w = pad + glyphW + 4 + textW + pad;

    this.dockedPillBg.clear();
    this.dockedPillBg.roundRect(-w, -h / 2, w, h, FLEET.pillCorner);
    this.dockedPillBg.fill(FLEET.pillFill);

    // ship glyph (small right-pointing chevron) near the left
    const gx = -w + pad;
    this.dockedGlyph.clear();
    this.dockedGlyph.poly([gx, -glyphW / 2, gx + glyphW, 0, gx, glyphW / 2, gx + glyphW * 0.35, 0]);
    this.dockedGlyph.fill(FLEET.pillContent);

    this.dockedCount.position.set(gx + glyphW + 4, 0);

    // anchor the pill's bottom-right just off the glyph's top-left corner
    this.dockedPill.position.set(-SIZES.systemCoreRadius + 2, -SIZES.systemCoreRadius - 2);
  }
```

- [ ] **Step 7: Update `setLOD`** — replace the `shipLabel` visibility block (lines 213–216) with:

```typescript
    if (this.currentShipCount > 0) {
      this.dockedPill.visible = lod.showShipLabels;
      this.dockedPill.alpha = lod.detailAlpha;
    }
```

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: no errors in `system-object.ts` (an unused-`Text`-import error is fine to ignore only if `Text` is still used — it is, by other labels).

### Task 1.3: Remove the pulse ring from `EffectLayer`

**Files:**
- Modify: `components/map/pixi/layers/effect-layer.ts`

- [ ] **Step 1: Delete the `PulseRing` interface** (lines 16–22).

- [ ] **Step 2: Delete the pulse-ring fields** from the class (the `pulseRings`, `pulseRingMap`, `pulseContainer` declarations) and remove `this.container.addChild(this.pulseContainer)` from the constructor. Keep `particleContainer` and its `addChild`.

- [ ] **Step 3: Delete the `syncPulseRings` method** entirely (lines 91–132).

- [ ] **Step 4: Delete the pulse-ring animation block** inside `update` (the `for (const ring of this.pulseRings)` loop, lines 143–153). Keep the route-particle loop.

- [ ] **Step 5: Delete the `clearPulseRings` method** (lines 164–171) and remove the `this.clearPulseRings()` call from `destroy()`. Keep `clearParticles()`.

- [ ] **Step 6: Confirm no dangling references** — `NAV_COLORS` is still used by `syncRoute`; `ANIM.pulseRing*` must no longer appear.

Run: `npm run lint`
Expected: no errors.

### Task 1.4: Stop calling `syncPulseRings`; verify build

**Files:**
- Modify: `components/map/pixi/pixi-map-canvas.tsx:371`

- [ ] **Step 1: Remove the pulse-ring sync call.** Delete this line from the map-data sync effect (line 371):

```typescript
    p.effectLayer.syncPulseRings(mapData.systems, navigationMode.phase === "default");
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run build`
Expected: PASS (clean).

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open `http://localhost:3000`, zoom into a system where you have a docked ship (the home page shows "Ships" count in the sidebar; the Fleet panel lists each ship's system). Confirm:
- A solid sky-blue pill with a ship chevron + count sits at the **top-left** of the glyph.
- The old faint pulse ring and yellow "N SHIPS" text are gone.
- The pill does **not** overlap the gateway dot / event dots / price badge (top-right). If it does, adjust the `dockedPill.position` offset in `drawDockedPill` and re-verify.

- [ ] **Step 4: Commit**

```bash
git add components/map/pixi/theme.ts components/map/pixi/objects/system-object.ts components/map/pixi/layers/effect-layer.ts components/map/pixi/pixi-map-canvas.tsx
git commit -m "feat(map): docked-ship pill replaces faint pulse ring"
```

---

## PR 2 — In-transit markers + routes + interaction + overlay

**Scope:** new engine module + tests, new Pixi layer, new transit card, `useMapData`, overlay plumbing, canvas + `star-map` wiring.

### Task 2.1: Pure engine module `transit-position.ts` — failing tests first

**Files:**
- Create: `lib/engine/__tests__/transit-position.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import {
  reconstructTransitPath,
  interpolateTransit,
  clusterMarkers,
} from "@/lib/engine/transit-position";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import { REFERENCE_SPEED } from "@/lib/constants/ships";

// A -- B -- C chain; fuelCost 2 each => 1 tick/hop at reference speed.
const chain: ConnectionInfo[] = [
  { fromSystemId: "A", toSystemId: "B", fuelCost: 2 },
  { fromSystemId: "B", toSystemId: "A", fuelCost: 2 },
  { fromSystemId: "B", toSystemId: "C", fuelCost: 2 },
  { fromSystemId: "C", toSystemId: "B", fuelCost: 2 },
];

const positions = new Map([
  ["A", { x: 0, y: 0 }],
  ["B", { x: 100, y: 0 }],
  ["C", { x: 200, y: 0 }],
]);

describe("reconstructTransitPath", () => {
  it("annotates each node with cumulative duration", () => {
    const path = reconstructTransitPath("A", "C", chain, REFERENCE_SPEED);
    expect(path.straightLine).toBe(false);
    expect(path.nodes.map((n) => n.systemId)).toEqual(["A", "B", "C"]);
    expect(path.nodes.map((n) => n.cumulativeDuration)).toEqual([0, 1, 2]);
    expect(path.totalDuration).toBe(2);
  });

  it("falls back to a straight 2-node line when disconnected", () => {
    const path = reconstructTransitPath("A", "Z", chain, REFERENCE_SPEED);
    expect(path.straightLine).toBe(true);
    expect(path.nodes.map((n) => n.systemId)).toEqual(["A", "Z"]);
    expect(path.totalDuration).toBe(1);
  });
});

describe("interpolateTransit", () => {
  const path = reconstructTransitPath("A", "C", chain, REFERENCE_SPEED);

  it("places the marker at the origin at progress 0", () => {
    expect(interpolateTransit(path, positions, 0)).toEqual({
      x: 0, y: 0, angleRad: 0, segmentIndex: 0,
    });
  });

  it("places the marker at the destination at progress 1", () => {
    const p = interpolateTransit(path, positions, 1)!;
    expect(p.x).toBeCloseTo(200);
    expect(p.segmentIndex).toBe(1);
  });

  it("places the marker mid-second-segment at progress 0.75", () => {
    const p = interpolateTransit(path, positions, 0.75)!;
    expect(p.x).toBeCloseTo(150);
    expect(p.segmentIndex).toBe(1);
  });

  it("clamps progress outside [0,1]", () => {
    expect(interpolateTransit(path, positions, 5)!.x).toBeCloseTo(200);
    expect(interpolateTransit(path, positions, -1)!.x).toBeCloseTo(0);
  });

  it("returns null when a path system has no position", () => {
    expect(interpolateTransit(path, new Map([["A", { x: 0, y: 0 }]]), 0.75)).toBeNull();
  });
});

describe("clusterMarkers", () => {
  it("groups markers within the threshold and keeps far ones separate, order-stable", () => {
    const clusters = clusterMarkers(
      [
        { id: "1", x: 0, y: 0, item: "a" },
        { id: "2", x: 5, y: 0, item: "b" },
        { id: "3", x: 100, y: 0, item: "c" },
      ],
      10,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0].items).toEqual(["a", "b"]);
    expect(clusters[1].items).toEqual(["c"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/engine/__tests__/transit-position.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/engine/transit-position"`.

### Task 2.2: Implement `transit-position.ts`

**Files:**
- Create: `lib/engine/transit-position.ts`

- [ ] **Step 1: Write the implementation**

```typescript
/**
 * Pure helpers for placing in-transit ship markers on the map. Zero DB / Pixi
 * dependency, testable with Vitest. The path is reconstructed client-side
 * because only origin → final destination + ticks are persisted on the ship.
 */
import type { ConnectionInfo } from "./navigation";
import { findShortestPath } from "./pathfinding";
import { hopDuration } from "./travel";

export interface Vec2 {
  x: number;
  y: number;
}

export interface TransitPathNode {
  systemId: string;
  cumulativeDuration: number; // ticks from origin to this node
}

export interface TransitPath {
  nodes: TransitPathNode[];
  totalDuration: number; // ticks, always >= 1
  straightLine: boolean; // true when we fell back to a direct origin→dest line
}

export interface TransitPlacement {
  x: number;
  y: number;
  angleRad: number; // heading of the active segment (toward destination)
  segmentIndex: number;
}

export interface ClusterInput<T> {
  id: string;
  x: number;
  y: number;
  item: T;
}

export interface Cluster<T> {
  x: number;
  y: number;
  items: T[];
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Reconstruct the hop path + per-node cumulative duration for an in-transit unit. */
export function reconstructTransitPath(
  originId: string,
  destinationId: string,
  connections: ConnectionInfo[],
  speed: number,
): TransitPath {
  const result = findShortestPath(originId, destinationId, connections, speed);
  if (!result || result.path.length < 2) {
    return {
      nodes: [
        { systemId: originId, cumulativeDuration: 0 },
        { systemId: destinationId, cumulativeDuration: 1 },
      ],
      totalDuration: 1,
      straightLine: true,
    };
  }

  const fuelByPair = new Map<string, number>();
  for (const c of connections) {
    fuelByPair.set(`${c.fromSystemId}|${c.toSystemId}`, c.fuelCost);
    fuelByPair.set(`${c.toSystemId}|${c.fromSystemId}`, c.fuelCost);
  }

  const nodes: TransitPathNode[] = [{ systemId: result.path[0], cumulativeDuration: 0 }];
  let cum = 0;
  for (let i = 0; i < result.path.length - 1; i++) {
    const fuel = fuelByPair.get(`${result.path[i]}|${result.path[i + 1]}`) ?? 0;
    cum += hopDuration(fuel, speed);
    nodes.push({ systemId: result.path[i + 1], cumulativeDuration: cum });
  }

  return { nodes, totalDuration: Math.max(1, cum), straightLine: false };
}

/** Interpolate a marker's world position + heading along a path at `progress` ∈ [0,1]. */
export function interpolateTransit(
  path: TransitPath,
  positions: Map<string, Vec2>,
  progress: number,
): TransitPlacement | null {
  const target = clamp01(progress) * path.totalDuration;

  for (let i = 0; i < path.nodes.length - 1; i++) {
    const a = path.nodes[i];
    const b = path.nodes[i + 1];
    if (target <= b.cumulativeDuration || i === path.nodes.length - 2) {
      const from = positions.get(a.systemId);
      const to = positions.get(b.systemId);
      if (!from || !to) return null;
      const span = b.cumulativeDuration - a.cumulativeDuration;
      const segT = span <= 0 ? 0 : clamp01((target - a.cumulativeDuration) / span);
      return {
        x: from.x + (to.x - from.x) * segT,
        y: from.y + (to.y - from.y) * segT,
        angleRad: Math.atan2(to.y - from.y, to.x - from.x),
        segmentIndex: i,
      };
    }
  }
  return null;
}

/** Greedy, order-stable screen-space clustering of markers within `thresholdPx`. */
export function clusterMarkers<T>(
  inputs: ClusterInput<T>[],
  thresholdPx: number,
): Cluster<T>[] {
  const clusters: Cluster<T>[] = [];
  const t2 = thresholdPx * thresholdPx;
  for (const input of inputs) {
    let placed = false;
    for (const c of clusters) {
      const dx = c.x - input.x;
      const dy = c.y - input.y;
      if (dx * dx + dy * dy <= t2) {
        c.items.push(input.item);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ x: input.x, y: input.y, items: [input.item] });
  }
  return clusters;
}
```

- [ ] **Step 2: Run to verify it passes**

Run: `npx vitest run lib/engine/__tests__/transit-position.test.ts`
Expected: PASS (all cases).

- [ ] **Step 3: Commit**

```bash
git add lib/engine/transit-position.ts lib/engine/__tests__/transit-position.test.ts
git commit -m "feat(map): pure transit-position engine (path/interp/cluster)"
```

### Task 2.3: Expose `transitUnits` from `useMapData`

**Files:**
- Modify: `lib/hooks/use-map-data.ts`

- [ ] **Step 1: Add the `TransitUnit` type** (after the `SystemNodeData` interface, ~line 45):

```typescript
export interface TransitUnit {
  id: string;
  kind: "ship" | "convoy";
  name: string;
  originSystemId: string;
  destinationSystemId: string;
  destinationName: string;
  departureTick: number;
  arrivalTick: number;
  speed: number;
  memberCount: number;
  cargoUsed: number;
  cargoMax: number;
}
```

- [ ] **Step 2: Add `transitUnits` to the `MapData` interface** (after `convoysAtSelected`, ~line 69):

```typescript
  transitUnits: TransitUnit[];
```

- [ ] **Step 3: Build the memo** (inside `useMapData`, after the `convoysAtSelected` memo, ~line 145). Note: solo in-transit ships carry their own cargo; convoys use combined cargo:

```typescript
  // ── In-transit units (solo ships + convoys) for map markers ───
  const transitUnits = useMemo((): TransitUnit[] => {
    const nameById = new Map(universe.systems.map((s) => [s.id, s.name]));
    const sumCargo = (s: ShipState) => s.cargo.reduce((n, c) => n + c.quantity, 0);
    const out: TransitUnit[] = [];

    for (const ship of ships) {
      if (ship.status !== "in_transit" || ship.convoyId) continue;
      if (!ship.destinationSystemId || ship.departureTick === null || ship.arrivalTick === null) continue;
      out.push({
        id: ship.id,
        kind: "ship",
        name: ship.name,
        originSystemId: ship.systemId,
        destinationSystemId: ship.destinationSystemId,
        destinationName: nameById.get(ship.destinationSystemId) ?? "Unknown",
        departureTick: ship.departureTick,
        arrivalTick: ship.arrivalTick,
        speed: ship.speed,
        memberCount: 1,
        cargoUsed: sumCargo(ship),
        cargoMax: ship.cargoMax,
      });
    }

    for (const convoy of convoys) {
      if (convoy.status !== "in_transit") continue;
      if (!convoy.destinationSystemId || convoy.departureTick === null || convoy.arrivalTick === null) continue;
      const speed = convoy.members.length > 0 ? Math.min(...convoy.members.map((m) => m.speed)) : 1;
      out.push({
        id: convoy.id,
        kind: "convoy",
        name: convoy.name ?? "Convoy",
        originSystemId: convoy.systemId,
        destinationSystemId: convoy.destinationSystemId,
        destinationName: nameById.get(convoy.destinationSystemId) ?? "Unknown",
        departureTick: convoy.departureTick,
        arrivalTick: convoy.arrivalTick,
        speed,
        memberCount: convoy.members.length,
        cargoUsed: convoy.combinedCargoUsed,
        cargoMax: convoy.combinedCargoMax,
      });
    }
    return out;
  }, [ships, convoys, universe.systems]);
```

- [ ] **Step 4: Return `transitUnits`** in the hook's return object (add the key near `convoysAtSelected`).

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/hooks/use-map-data.ts
git commit -m "feat(map): expose in-transit units from useMapData"
```

### Task 2.4: Add the `shipRoutes` overlay toggle

**Files:**
- Modify: `components/map/map-session.ts`
- Modify: `lib/hooks/use-map-overlays.ts`
- Modify: `components/map/map-overlay-controls.tsx`

- [ ] **Step 1: `map-session.ts`** — add `shipRoutes` to `MapOverlaysState` (line 7–10) and parse it in `parseOverlays` (after the `priceHeatmap` block):

```typescript
export interface MapOverlaysState {
  tradeFlow?: boolean;
  priceHeatmap?: boolean;
  shipRoutes?: boolean;
}
```

```typescript
  if ("shipRoutes" in value && typeof value.shipRoutes === "boolean") {
    out.shipRoutes = value.shipRoutes;
  }
```

- [ ] **Step 2: `use-map-overlays.ts`** — add `shipRoutes` to the `MapOverlays` interface, `DEFAULT_OVERLAYS` (`false`), `hydrateFromSession`, and the persist effect:

```typescript
export interface MapOverlays {
  tradeFlow: boolean;
  priceHeatmap: boolean;
  shipRoutes: boolean;
}
```

```typescript
const DEFAULT_OVERLAYS: MapOverlays = {
  tradeFlow: false,
  priceHeatmap: false,
  shipRoutes: false,
};
```

In `hydrateFromSession`, add: `shipRoutes: stored.shipRoutes ?? DEFAULT_OVERLAYS.shipRoutes,`
In the persist effect, add: `if (overlays.shipRoutes) stored.shipRoutes = true;`

- [ ] **Step 3: `map-overlay-controls.tsx`** — add a row to `OVERLAY_DEFS` (after `priceHeatmap`):

```typescript
  { key: "shipRoutes", label: "Ship Routes" },
```

Add a short legend rendered when the overlay is on (after the `priceHeatmap` section, ~line 146):

```tsx
      {overlays.shipRoutes && (
        <div className="border-t border-border px-3 py-2 text-[10px] text-text-secondary font-mono leading-relaxed">
          Shows every in-transit ship&apos;s route. Markers are always visible; hover one for its ETA, click to pin its route.
        </div>
      )}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/map/map-session.ts lib/hooks/use-map-overlays.ts components/map/map-overlay-controls.tsx
git commit -m "feat(map): add Ship Routes overlay toggle"
```

### Task 2.5: Create the `CompactTransitCard`

**Files:**
- Create: `components/map/compact-transit-card.tsx`

- [ ] **Step 1: Write the component** (fixed-position card; mirrors `CompactShipCard` styling — Foundry surface + cyan left stripe):

```tsx
"use client";

import type { TransitUnit } from "@/lib/hooks/use-map-data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface CompactTransitCardProps {
  unit: TransitUnit;
  /** Ticks remaining until arrival (already clamped to >= 0). */
  etaTicks: number;
  onClose: () => void;
}

export function CompactTransitCard({ unit, etaTicks, onClose }: CompactTransitCardProps) {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 w-72 bg-surface border border-border border-l-2 border-l-cyan-500 px-3 py-2.5 shadow-lg flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">{unit.name}</span>
          {unit.kind === "convoy" && <Badge color="cyan">{unit.memberCount} ships</Badge>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-text-tertiary hover:text-text-primary text-xs shrink-0"
          aria-label="Deselect ship"
        >
          ✕
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-text-tertiary">Destination</dt>
        <dd className="font-mono text-text-secondary text-right truncate">{unit.destinationName}</dd>
        <dt className="text-text-tertiary">ETA</dt>
        <dd className="font-mono text-text-accent text-right">{etaTicks} {etaTicks === 1 ? "tick" : "ticks"}</dd>
        <dt className="text-text-tertiary">Cargo</dt>
        <dd className="font-mono text-text-secondary text-right">{unit.cargoUsed}/{unit.cargoMax}</dd>
      </dl>
      {unit.kind === "ship" && (
        <Button href={`/ship/${unit.id}`} variant="ghost" size="xs" fullWidth>
          Ship details
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Confirm the `Badge` supports a `cyan` colour.** Run:

Run: `npx grep -n "cyan" components/ui/badge.tsx` *(or read the file)*. If `cyan` is not a valid `Badge` colour, use the closest existing colour (e.g. `"blue"` or `"slate"`).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors. (Not committed yet — wired up in Task 2.8.)

### Task 2.6: Create the `FleetTransitLayer`

**Files:**
- Create: `components/map/pixi/layers/fleet-transit-layer.ts`

- [ ] **Step 1: Write the layer**

```typescript
import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Frustum } from "../frustum";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import type { TransitUnit } from "@/lib/hooks/use-map-data";
import {
  reconstructTransitPath,
  interpolateTransit,
  clusterMarkers,
  type TransitPath,
  type Vec2,
} from "@/lib/engine/transit-position";
import { FLEET, TEXT_RESOLUTION } from "../theme";

const DEFAULT_TICK_MS = 5000;

const COUNT_STYLE = new TextStyle({
  fontSize: 12,
  fontWeight: "700",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fill: FLEET.pillContent,
});

const ETA_STYLE = new TextStyle({
  fontSize: 11,
  fontWeight: "600",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fill: FLEET.routeActive.color,
});

interface MarkerObject {
  container: Container;
  pill: Graphics;
  nose: Graphics;
  count: Text;
  hit: Graphics;
  /** Single-unit id for hover/click, or "" for a multi-ship cluster. */
  unitId: string;
}

/**
 * Renders always-on in-transit ship markers (directional pills) plus on-demand
 * routes (hover ghost / selected / all-routes overlay). Markers are held at a
 * constant screen size and cluster in screen space so they don't pile up.
 */
export class FleetTransitLayer {
  readonly container = new Container();
  private routeLayer = new Container();
  private markerLayer = new Container();
  private hoverRoute = new Graphics();
  private selectedRoute = new Graphics();
  private allRoutes = new Graphics();
  private etaLabel: Text;

  private units: TransitUnit[] = [];
  private positions = new Map<string, Vec2>();
  private paths = new Map<string, TransitPath>();
  private pathKey = "";

  private currentTick = 0;
  private lastTickAt = 0;
  private tickMs = DEFAULT_TICK_MS;

  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private showAllRoutes = false;
  private onClick: (unitId: string | null) => void = () => {};

  private markerPool = new Map<string, MarkerObject>();

  constructor() {
    this.routeLayer.addChild(this.allRoutes, this.hoverRoute, this.selectedRoute);
    this.etaLabel = new Text({ text: "", style: ETA_STYLE, resolution: TEXT_RESOLUTION });
    this.etaLabel.anchor.set(0.5, 1);
    this.etaLabel.visible = false;
    this.container.addChild(this.routeLayer, this.markerLayer, this.etaLabel);
  }

  setOnClick(cb: (unitId: string | null) => void) {
    this.onClick = cb;
  }

  setSelected(id: string | null) {
    this.selectedId = id;
  }

  setShowAllRoutes(v: boolean) {
    this.showAllRoutes = v;
  }

  setTick(tick: number) {
    if (tick === this.currentTick) return;
    const now = performance.now();
    if (this.lastTickAt > 0) {
      this.tickMs = Math.min(30000, Math.max(500, now - this.lastTickAt));
    }
    this.lastTickAt = now;
    this.currentTick = tick;
  }

  sync(units: TransitUnit[], positions: Map<string, Vec2>, connections: ConnectionInfo[]) {
    this.units = units;
    this.positions = positions;

    const key = units
      .map((u) => `${u.id}:${u.originSystemId}>${u.destinationSystemId}@${u.departureTick}-${u.arrivalTick}`)
      .join("|");
    if (key !== this.pathKey) {
      this.pathKey = key;
      this.paths = new Map();
      for (const u of units) {
        this.paths.set(u.id, reconstructTransitPath(u.originSystemId, u.destinationSystemId, connections, u.speed));
      }
    }

    if (this.selectedId && !units.some((u) => u.id === this.selectedId)) this.selectedId = null;
    if (this.hoveredId && !units.some((u) => u.id === this.hoveredId)) this.hoveredId = null;
  }

  private nowTick(): number {
    const frac = this.lastTickAt > 0 ? clamp01((performance.now() - this.lastTickAt) / this.tickMs) : 0;
    return this.currentTick + frac;
  }

  private placement(u: TransitUnit, nowTick: number) {
    const path = this.paths.get(u.id);
    if (!path) return null;
    const span = u.arrivalTick - u.departureTick;
    const progress = span <= 0 ? 1 : clamp01((nowTick - u.departureTick) / span);
    return interpolateTransit(path, this.positions, progress);
  }

  /** Per-frame: interpolate, cluster (screen-space), reconcile markers, draw routes. */
  update(dtMs: number, zoom: number, frustum: Frustum) {
    const nowTick = this.nowTick();

    const placed: { unit: TransitUnit; x: number; y: number; angle: number }[] = [];
    for (const u of this.units) {
      const p = this.placement(u, nowTick);
      if (p) placed.push({ unit: u, x: p.x, y: p.y, angle: p.angleRad });
    }

    const worldThreshold = FLEET.clusterThresholdPx / Math.max(zoom, 0.0001);
    const clusters = clusterMarkers(
      placed.map((p) => ({ id: p.unit.id, x: p.x, y: p.y, item: p })),
      worldThreshold,
    );

    const wanted = new Set<string>();
    const markerScale = FLEET.markerScreenScale / Math.max(zoom, 0.0001);
    for (const c of clusters) {
      const memberIds = c.items.map((i) => i.unit.id).sort();
      const ckey = memberIds.join(",");
      wanted.add(ckey);
      const single = c.items.length === 1;
      const count = c.items.reduce((n, i) => n + i.unit.memberCount, 0);
      const lead = c.items[0];

      let m = this.markerPool.get(ckey);
      if (!m) {
        m = this.createMarker(ckey, single ? lead.unit.id : "");
        this.markerPool.set(ckey, m);
      }
      m.container.position.set(lead.x, lead.y);
      m.container.scale.set(markerScale);
      m.container.visible = frustum.contains(lead.x, lead.y);
      this.drawMarker(m, lead.angle, count, single);
    }

    for (const [k, m] of this.markerPool) {
      if (!wanted.has(k)) {
        this.markerLayer.removeChild(m.container);
        m.container.destroy({ children: true });
        this.markerPool.delete(k);
      }
    }

    this.drawRoutes(zoom);
  }

  private createMarker(ckey: string, unitId: string): MarkerObject {
    const container = new Container();
    const pill = new Graphics();
    const nose = new Graphics();
    const count = new Text({ text: "", style: COUNT_STYLE, resolution: TEXT_RESOLUTION });
    count.anchor.set(0.5, 0.5);
    const hit = new Graphics();
    hit.circle(0, 0, FLEET.hitRadius);
    hit.fill({ color: 0xffffff, alpha: 0.001 });
    container.addChild(pill, nose, count, hit);
    container.eventMode = "static";
    container.cursor = "pointer";

    const m: MarkerObject = { container, pill, nose, count, hit, unitId };

    container.on("pointerover", () => {
      if (m.unitId) this.hoveredId = m.unitId;
    });
    container.on("pointerout", () => {
      if (m.unitId && this.hoveredId === m.unitId) this.hoveredId = null;
    });
    container.on("pointerdown", (e) => {
      e.stopPropagation();
      this.onClick(m.unitId || null);
    });

    this.markerLayer.addChild(container);
    return m;
  }

  private drawMarker(m: MarkerObject, angle: number, count: number, single: boolean) {
    const h = FLEET.markerHeight;
    const pad = 5;
    const w = single ? FLEET.markerMinWidth : FLEET.markerMinWidth + String(count).length * FLEET.countDigitWidth;

    m.pill.clear();
    m.pill.roundRect(-w / 2, -h / 2, w, h, FLEET.pillCorner);
    m.pill.fill(FLEET.pillFill);

    // direction nose: a triangle just off the pill edge, rotated to the heading
    const r = w / 2 + 3;
    const cx = Math.cos(angle) * r;
    const cy = Math.sin(angle) * r;
    const s = FLEET.chevronSize;
    m.nose.clear();
    m.nose.poly([
      cx + Math.cos(angle) * s, cy + Math.sin(angle) * s,
      cx + Math.cos(angle + 2.5) * s, cy + Math.sin(angle + 2.5) * s,
      cx + Math.cos(angle - 2.5) * s, cy + Math.sin(angle - 2.5) * s,
    ]);
    m.nose.fill(FLEET.pillFill);

    if (single) {
      m.count.visible = false;
    } else {
      m.count.visible = true;
      m.count.text = String(count);
      m.count.position.set(0, 0);
    }
  }

  private strokePath(g: Graphics, unit: TransitUnit, style: { color: number; alpha: number; width: number }, zoom: number) {
    const path = this.paths.get(unit.id);
    if (!path) return;
    const pts: Vec2[] = [];
    for (const node of path.nodes) {
      const pos = this.positions.get(node.systemId);
      if (!pos) return;
      pts.push(pos);
    }
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.stroke({ color: style.color, alpha: style.alpha, width: style.width / Math.max(zoom, 0.0001) });
  }

  private drawRoutes(zoom: number) {
    this.allRoutes.clear();
    this.hoverRoute.clear();
    this.selectedRoute.clear();

    if (this.showAllRoutes) {
      for (const u of this.units) this.strokePath(this.allRoutes, u, FLEET.routeAll, zoom);
    }

    if (this.selectedId) {
      const u = this.units.find((x) => x.id === this.selectedId);
      if (u) this.strokePath(this.selectedRoute, u, FLEET.routeActive, zoom);
    }

    if (this.hoveredId && this.hoveredId !== this.selectedId) {
      const u = this.units.find((x) => x.id === this.hoveredId);
      if (u) {
        this.strokePath(this.hoverRoute, u, FLEET.routeHover, zoom);
        const p = this.placement(u, this.nowTick());
        if (p) {
          const remaining = Math.max(0, u.arrivalTick - this.currentTick);
          this.etaLabel.text = `→ ${u.destinationName} · ${remaining}t`;
          this.etaLabel.position.set(p.x, p.y - FLEET.markerHeight / Math.max(zoom, 0.0001) - 4);
          this.etaLabel.scale.set(1 / Math.max(zoom, 0.0001));
          this.etaLabel.visible = true;
          return;
        }
      }
    }
    this.etaLabel.visible = false;
  }

  updateVisibility(layerAlpha: number) {
    this.container.alpha = layerAlpha;
    this.container.visible = layerAlpha > 0.01;
  }

  destroy() {
    for (const m of this.markerPool.values()) m.container.destroy({ children: true });
    this.markerPool.clear();
    this.container.destroy({ children: true });
  }
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
```

- [ ] **Step 2: Lint + typecheck**

Run: `npm run lint && npm run build`
Expected: PASS (build will succeed even before wiring — the layer is just not used yet).

- [ ] **Step 3: Commit**

```bash
git add components/map/pixi/layers/fleet-transit-layer.ts components/map/compact-transit-card.tsx
git commit -m "feat(map): fleet transit layer + compact transit card (unwired)"
```

### Task 2.7: Wire the layer into `PixiMapCanvas`

**Files:**
- Modify: `components/map/pixi/pixi-map-canvas.tsx`

- [ ] **Step 1: Import the layer** (after the `EffectLayer` import, line 17):

```typescript
import { FleetTransitLayer } from "./layers/fleet-transit-layer";
```

- [ ] **Step 2: Add props** to `PixiMapCanvasProps`:

```typescript
  connections: ConnectionInfo[];
  currentTick: number;
  showShipRoutes: boolean;
  selectedTransitId: string | null;
  onTransitClick: (unitId: string | null) => void;
```

Add the import for `ConnectionInfo` (top of file):

```typescript
import type { ConnectionInfo } from "@/lib/engine/navigation";
```

Destructure the new props in the component signature with the others.

- [ ] **Step 3: Add `fleetTransitLayer` to the `PixiRefs` interface** and construct it just after `systemLayer` (so markers sit above glyphs), before `effectLayer`:

```typescript
      const fleetTransitLayer = new FleetTransitLayer();
      world.addChild(fleetTransitLayer.container);
```

Add `fleetTransitLayer` to the `PixiRefs` interface and to the `pixiRef.current = { … }` assignment, and call `refs.fleetTransitLayer.destroy()` in the cleanup block alongside the other layer destroys.

- [ ] **Step 4: Wire the click callback into the layer once, on ready.** Add a ref for the latest callback (like `callbacksRef`) near the top:

```typescript
  const onTransitClickRef = useRef(onTransitClick);
  onTransitClickRef.current = onTransitClick;
```

After constructing the layer (inside the async mount, right after `setupInteractions`), bind:

```typescript
      fleetTransitLayer.setOnClick((id) => onTransitClickRef.current(id));
```

- [ ] **Step 5: Drive the layer in the render loop.** Inside `app.ticker.add`, after the trade-flow block, add:

```typescript
        fleetTransitLayer.setTick(currentTickRef.current);
        fleetTransitLayer.update(dtMs, camera.zoom, frustum);
        fleetTransitLayer.updateVisibility(1); // always-on across zoom levels
```

Add a `currentTickRef` near the other refs and keep it fresh:

```typescript
  const currentTickRef = useRef(currentTick);
  currentTickRef.current = currentTick;
```

- [ ] **Step 6: Sync transit data + selection + overlay** in the map-data sync effect (the one ending line 372). Append:

```typescript
    const transitPositions = new Map(mapData.systems.map((s) => [s.id, { x: s.x, y: s.y }]));
    p.fleetTransitLayer.sync(mapData.transitUnits, transitPositions, connections);
    p.fleetTransitLayer.setSelected(selectedTransitId);
    p.fleetTransitLayer.setShowAllRoutes(showShipRoutes);
```

Add `connections`, `selectedTransitId`, `showShipRoutes` to that effect's dependency array.

- [ ] **Step 7: Typecheck + build**

Run: `npm run build`
Expected: PASS (will fail to compile only because `star-map.tsx` doesn't yet pass the new props — that's Task 2.8; if you run build now expect the `StarMap`→`PixiMapCanvas` prop error, resolved next task).

### Task 2.8: Wire `star-map.tsx` (selection state, card, props, empty-click clear)

**Files:**
- Modify: `components/map/star-map.tsx`

- [ ] **Step 1: Add imports**:

```typescript
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { CompactTransitCard } from "@/components/map/compact-transit-card";
```

- [ ] **Step 2: Read the tick + selection state** (near the other hooks, after `useMapOverlays`):

```typescript
  const { currentTick } = useTickContext();
  const [selectedTransitId, setSelectedTransitId] = useState<string | null>(null);
```

- [ ] **Step 3: Derive the selected unit + ETA** (after `mapData` is built):

```typescript
  const selectedTransit = useMemo(
    () => mapData.transitUnits.find((u) => u.id === selectedTransitId) ?? null,
    [mapData.transitUnits, selectedTransitId],
  );
  const selectedTransitEta = selectedTransit
    ? Math.max(0, selectedTransit.arrivalTick - currentTick)
    : 0;
```

- [ ] **Step 4: Toggle handler + clear on empty click.** Add:

```typescript
  const onTransitClick = useCallback((id: string | null) => {
    setSelectedTransitId((prev) => (prev === id ? null : id));
  }, []);
```

In the existing `onEmptyClick` callback, also clear the transit selection:

```typescript
  const onEmptyClick = useCallback(() => {
    setSelectedTransitId(null);
    if (mode.phase === "default") {
      closeSystem();
    }
  }, [mode.phase, closeSystem]);
```

- [ ] **Step 5: Pass the new props to `PixiMapCanvas`**:

```tsx
        connections={allConnections}
        currentTick={currentTick}
        showShipRoutes={overlays.shipRoutes}
        selectedTransitId={selectedTransitId}
        onTransitClick={onTransitClick}
```

- [ ] **Step 6: Render the card** (after the route-preview panel block, before the detail panel):

```tsx
      {selectedTransit && (
        <CompactTransitCard
          unit={selectedTransit}
          etaTicks={selectedTransitEta}
          onClose={() => setSelectedTransitId(null)}
        />
      )}
```

- [ ] **Step 7: Typecheck + build**

Run: `npm run build`
Expected: PASS (clean).

### Task 2.9: Manual verification + final commit

- [ ] **Step 1: Create an in-transit ship.** Run `npm run dev`, open `http://localhost:3000`. Open the Fleet panel, pick a docked ship, **Navigate** it to a multi-hop destination and confirm. It now has status `in_transit`.

- [ ] **Step 2: Verify markers + interaction.** On the map:
  - A directional sky-blue pill glides along the route, nose pointing toward the destination, at constant screen size across zoom levels.
  - Hovering the marker draws a thin ghost route + an "→ <Dest> · <n>t" ETA label.
  - Clicking the marker pins a brighter route and opens the compact transit card (destination / ETA / cargo + "Ship details"). Clicking empty space clears it.
  - Toggling **Ship Routes** in the overlay panel draws all in-transit routes faintly at once.
  - Send a second ship along the same lane and confirm they either separate by progress or collapse to one pill with a count badge; zooming in separates them.
  - Confirm a docked-ship pill (PR1) and an in-transit pill share the same look.

- [ ] **Step 3: Full check**

Run: `npm run lint && npx vitest run --project unit && npm run build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add components/map/pixi/pixi-map-canvas.tsx components/map/star-map.tsx
git commit -m "feat(map): wire in-transit markers, routes, selection card"
```

---

## Self-Review

**Spec coverage:**
- Docked pill replacing pulse ring → Tasks 1.1–1.4. ✓
- In-transit directional pill, always-on, constant screen size → Task 2.6 (`drawMarker`, counter-scale). ✓
- Reconstructed path + tick interpolation + measured tick interval → Tasks 2.1/2.2 (`reconstructTransitPath`, `interpolateTransit`) + 2.6 (`setTick`/`nowTick`). ✓
- Progressive disclosure (hover ghost + ETA / click select + card / overlay) → Tasks 2.4–2.8. ✓
- Clustering (convoy = 1 unit; overlapping solos merge with count; zoom separates) → Tasks 2.1 (`clusterMarkers`) + 2.6 (screen-space threshold ÷ zoom). ✓
- Fog-of-war independence (player's own units, atlas positions) → `transitUnits` built from fleet; positions from `mapData.systems` (all universe systems). ✓
- Edge cases (no path → straight line; `arrival === departure` → clamp; overshoot → clamp) → Task 2.2 + `placement`. ✓
- "Ship Routes" overlay alongside Trade Flows / Price → Task 2.4. ✓

**Type consistency:** `TransitUnit` defined in `use-map-data.ts` (Task 2.3) and consumed identically by the layer (2.6) and card (2.5). Engine types (`TransitPath`, `Vec2`, `TransitPlacement`, `Cluster`) defined in 2.2 and imported in 2.6. `FLEET` keys defined in 1.1 are exactly those used in 1.2 and 2.6.

**Placeholder scan:** none — every code step is complete. Two visual values are explicitly flagged for in-browser adjustment (docked-pill anchor offset in 1.4-Step 3; `Badge` `cyan` colour fallback in 2.5-Step 2); both have a concrete default and a clear fallback rule, not a placeholder.

**Note:** Route lines are drawn as clean translucent polylines (the moving marker supplies the motion); animated dash-flow from the mockup is deliberately deferred as optional polish to keep PR2 tractable. The marker/pill colours, shapes, and the card match the v2 mockup.
