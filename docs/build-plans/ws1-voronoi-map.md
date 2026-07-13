# WS1 — Voronoi Map: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the map into the EU5-style Voronoi spine — per-cell relative value gradients (black reserved for
"no value"), three-tier number aggregation on zoom, faction-scoped re-normalisation on click, star-type dots — on
the real Pixi map, replacing the three duplicate choropleth layers with one shared-geometry layer.

**Architecture:** Compute the Voronoi **once** into a shared cell cache (`buildSystemCells`), hand per-system
cells to a single generic `ValueChoroplethLayer` parameterised by (value map, reference map, mode). Colour is a
pure function (`value-ramp.ts`); numbers coalesce up a pure three-tier hierarchy (`number-aggregation.ts`);
selection uses analytic per-cell hit-testing (`delaunay.find`) routed through the existing pointer flow. Pure
modules are TDD'd with Vitest; Pixi integration is verified by `next build --webpack` + a visual smoke against the
approved prototype.

**Tech Stack:** TypeScript 5 (strict), Pixi.js v8, d3-delaunay, polyclip-ts (via existing `territory-utils`),
TanStack Query v5, Vitest 4.

## Global Constraints

- **Conventions (verbatim from `CLAUDE.md`):** No `as` casts except `as const` / guards. No `unknown`. No postfix
  `!` non-null assertion (except `find(...)!` in tests). Discriminated unions for result types. Typed union keys,
  never `Record<string, ...>` for known key sets. Engine/services/world stay pure (no `fs`/`process.env`/DB).
- **World stays JSON-serializable:** no `Map`/`Set`/`Date`/`Infinity`/`NaN` in world state. (This plan adds no
  world-state fields — `sunClass` and dev potential already live on `WorldSystem`.)
- **Perf guardrails (from `CLAUDE.md` + code investigation):** `pixi-map-canvas.tsx` (~442 lines, 10 layers) and
  `objects/system-object.ts` (~443 lines, per-frame `setLOD` fast-path) are large and perf-sensitive — don't add
  per-frame branching without a fast-path guard. Frustum-gate object *creation*, not just visibility. Text is
  budget-limited: never one always-on `Text` per system — pool and frustum-gate (the aggregation model is what
  makes numbers tractable).
- **Determinism:** no `Date.now`/`Math.random`/`new Date()` in any engine/service/processor body.
- **Branch strategy:** each Phase is one PR into the shared branch `feat/economy-rework-base` (squash or
  fast-forward merge — never a regular merge commit). Phase branch names: `feat/ws1-cell-spine`,
  `feat/ws1-faction-scope`, `feat/ws1-star-dots`. Commit after each task.
- **Build gate:** `npx next build --webpack` must pass before a Phase PR. Unit tests: `npx vitest run <path>`.
- **Verification split:** Pure modules (`value-ramp`, `number-aggregation`, `voronoi-cache`, dev-potential
  service) are proven by Vitest. Pixi rendering/interaction tasks are proven by `next build --webpack` + a manual
  smoke on `npm run dev` — the interactive prototype
  (`docs/build-plans/ws1-map-prototype.html`, user-approved) is the visual oracle for "does it look/feel right."
  It is self-contained — open it in a browser to compare feel, no build step.

---

## Design decisions settled in the prototype (the contract)

These were felt and approved by the user in the interactive prototype. Implement to these:

1. **Ramp semantics — black is a discrete flag for zero.** A system with **value ≤ 0 (or absent from the value
   map) → black** (`0x08090c`) = uncolonised / no value. A present value rides a **grey floor → mode-hue
   ceiling** ramp and never reaches black, so "has a value" is instantly distinguishable from "has none." This
   solves the historic colonised-vs-uncolonised legibility problem. Per-mode hues: population → gold
   (`#fcd34d`), development → copper (`#e0845f`), stability → cyan (`#67e8f9`); grey floor ≈ `rgb(78,84,94)`.
2. **Relative, faction-scopable gradient.** The ramp normalises to a scope's max. Nothing selected → global
   (all visible systems). A system selected → re-normalise to **that system's faction**; out-of-scope cells
   de-emphasised. Reference is mode-appropriate: population → max population; development → max **potential**
   (ceiling); stability → max stability.
3. **De-emphasis default = "Both" (desaturate + dim).** Out-of-scope cells grey-out and darken (keeps the map
   legible, EU5-faithful). **Hide** (out-of-scope → background) is kept as a *future user-preference toggle*, not
   built now.
4. **Three-tier numbers, colour stays per-cell.** system → faction-within-region → whole faction. Aggregate is
   mode-appropriate: **population → sum; development / stability → average.** Tier swaps on zoom; thresholds are
   calibration knobs (prototype defaults are a starting point, expected to be re-tuned on the real map).
5. **Selection:** click a cell → select the system + open the system view (universal, every mode, any zoom). The
   one exception — political mode zoomed out → click selects the **faction**. Empty-click (outside the map
   extent, or same cell) clears → gradient returns to global.
6. **Star dot coloured by star type** (`SUN_CLASS_COLORS`), subdued in value modes so the cell carries the value.

---

## File structure

**New files (Phase 1):**
- `components/map/pixi/value-ramp.ts` — pure colour ramp (black-at-zero, grey floor → mode hue). Tested.
- `components/map/pixi/number-aggregation.ts` — pure three-tier grouping + aggregate + tier selection. Tested.
- `components/map/pixi/voronoi-cache.ts` — build the Voronoi once → per-system cells + centroids + analytic
  `findSystemAt` hit-testing. Tested.
- `components/map/pixi/layers/value-choropleth-layer.ts` — the one generic value layer (fills + number sublayer)
  replacing the three.
- `components/map/pixi/__tests__/value-ramp.test.ts`, `number-aggregation.test.ts`, `voronoi-cache.test.ts`.

**Modified (Phase 1):**
- `components/map/pixi/territory-utils.ts` — export `MultiPolygon`/`Polygon`/`Ring` types if not already exported.
- `components/map/pixi/pixi-map-canvas.tsx` — build shared cells once; construct one `ValueChoroplethLayer`
  instead of three; wire per-mode `setValues`; per-frame `updateNumbers(zoom, frustum)`; mode toggle.
- `components/map/pixi/interactions.ts` — value-mode empty-stage click → cell hit-test → `onSystemClick`.

**Deleted (end of Phase 1):**
- `components/map/pixi/layers/stability-territory-layer.ts`
- `components/map/pixi/layers/population-territory-layer.ts`
- `components/map/pixi/layers/development-territory-layer.ts`
  (their ramp utils `lib/utils/{stability,population}.ts` are still used by the `*RampLegend` UI components and
  the stability badge — keep those; only the layer files are deleted.)

**Modified (Phase 2):**
- `lib/types/game.ts` — `DevelopmentEntry` gains `potential: number`.
- `lib/services/development-map.ts` — emit per-system `potential`.
- `lib/hooks/use-development.ts` — expose a `potentialBySystem` map alongside development.
- `components/map/star-map.tsx` — pass selected faction id (scope) + dev potential map to the canvas.
- `components/map/pixi/value-ramp.ts` — add `deEmphasize(color, treatment)`.
- `components/map/pixi/layers/value-choropleth-layer.ts` — `setScope`, faction-union outline, de-emphasis.
- `components/map/pixi/layers/political-territory-layer.ts` — expose faction-union polygons + centroids for reuse.
- `components/map/pixi/interactions.ts` — political-zoomed-out faction hit-test → `onFactionClick`.

**Modified (Phase 3):**
- `lib/types/game.ts` — `AtlasSystem` + `StarSystemInfo` gain `sunClass: SunClass`.
- `lib/services/atlas.ts` — copy `sunClass` through `getAtlas()`.
- `components/map/star-map.tsx` + `lib/hooks/use-map-data.ts` — thread `sunClass` into `SystemNodeData`.
- `components/map/pixi/objects/system-object.ts` — star-type dot (radial gradient), hover, larger hit-zone.
- `components/map/pixi/theme.ts` — `SUN_CLASS_COLORS_PIXI` (hex→0xRRGGBB) constant.

---

# Phase 1 — Cell / number / selection spine (PR: `feat/ws1-cell-spine`)

Branch off `feat/economy-rework-base`. This is the prototype's subject: one shared-geometry value-choropleth with
score-0→black relative fills, three-tier numbers, and per-cell selection. Global scope only (faction scope is
Phase 2). Dev mode uses current-development max as its v1 reference (potential arrives in Phase 2).

### Task 1.1: Value ramp module

**Files:**
- Create: `components/map/pixi/value-ramp.ts`
- Test: `components/map/pixi/__tests__/value-ramp.test.ts`

**Interfaces:**
- Produces: `type ValueMode = "population" | "development" | "stability"`;
  `valueRampColorPixi(value: number, referenceMax: number, mode: ValueMode): number` (returns `0xRRGGBB`);
  `rampFloorPixi(mode): number`; `rampTopPixi(mode): number`; `ABSENT_COLOR: number`.

- [ ] **Step 1: Write the failing test**

```ts
// components/map/pixi/__tests__/value-ramp.test.ts
import { describe, it, expect } from "vitest";
import { valueRampColorPixi, rampFloorPixi, rampTopPixi, ABSENT_COLOR } from "@/components/map/pixi/value-ramp";

describe("valueRampColorPixi", () => {
  it("returns black for exactly zero", () => {
    expect(valueRampColorPixi(0, 100, "development")).toBe(ABSENT_COLOR);
  });
  it("returns black for negative or NaN (never a coloured cell)", () => {
    expect(valueRampColorPixi(-5, 100, "population")).toBe(ABSENT_COLOR);
    expect(valueRampColorPixi(Number.NaN, 100, "population")).toBe(ABSENT_COLOR);
  });
  it("a tiny present value reads the grey floor, NOT black", () => {
    const c = valueRampColorPixi(0.0001, 1, "development");
    expect(c).not.toBe(ABSENT_COLOR);
    expect(c).toBe(rampFloorPixi("development"));
  });
  it("the reference-max value reads the top of the ramp", () => {
    expect(valueRampColorPixi(50, 50, "population")).toBe(rampTopPixi("population"));
  });
  it("clamps values above the reference to the top", () => {
    expect(valueRampColorPixi(200, 50, "stability")).toBe(rampTopPixi("stability"));
  });
  it("guards a zero reference max (no divide-by-zero → floor)", () => {
    expect(valueRampColorPixi(5, 0, "population")).toBe(rampTopPixi("population"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/map/pixi/__tests__/value-ramp.test.ts`
Expected: FAIL — "Failed to resolve import … value-ramp".

- [ ] **Step 3: Write the implementation**

```ts
// components/map/pixi/value-ramp.ts
export type ValueMode = "population" | "development" | "stability";

type Stop = readonly [number, readonly [number, number, number]];

// Black is reserved for value 0 (uncolonised / no value). Present values ride a grey floor → mode-hue
// ceiling, so "has a value" never blurs into "has none". Stops are [t, [r,g,b]] with t ascending 0..1.
const ABSENT = 0x08090c;
const RAMPS: Record<ValueMode, readonly Stop[]> = {
  population: [[0, [78, 84, 94]], [0.5, [168, 120, 52]], [1, [252, 211, 77]]],
  development: [[0, [80, 84, 92]], [0.5, [158, 74, 44]], [1, [224, 132, 95]]],
  stability: [[0, [76, 86, 96]], [0.5, [26, 120, 140]], [1, [103, 232, 249]]],
};

function pack(c: readonly [number, number, number]): number {
  return (c[0] << 16) | (c[1] << 8) | c[2];
}
function sample(stops: readonly Stop[], t: number): number {
  const c = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (c <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const f = (c - p0) / (p1 - p0 || 1);
      return pack([
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ]);
    }
  }
  return pack(stops[stops.length - 1][1]);
}

/** value ≤ 0 / NaN → black (absent). Otherwise grey floor → mode hue, normalised to referenceMax. */
export function valueRampColorPixi(value: number, referenceMax: number, mode: ValueMode): number {
  if (!(value > 0)) return ABSENT;
  const max = referenceMax > 0 ? referenceMax : 1;
  return sample(RAMPS[mode], value / max);
}
export function rampFloorPixi(mode: ValueMode): number { return pack(RAMPS[mode][0][1]); }
export function rampTopPixi(mode: ValueMode): number { return pack(RAMPS[mode][RAMPS[mode].length - 1][1]); }
export const ABSENT_COLOR = ABSENT;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/map/pixi/__tests__/value-ramp.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add components/map/pixi/value-ramp.ts components/map/pixi/__tests__/value-ramp.test.ts
git commit -m "feat(map): value ramp with black-reserved-for-zero (WS1)"
```

---

### Task 1.2: Number aggregation module

**Files:**
- Create: `components/map/pixi/number-aggregation.ts`
- Test: `components/map/pixi/__tests__/number-aggregation.test.ts`

**Interfaces:**
- Consumes: `AtlasSystem` (`@/lib/types/game`), `ValueMode` (Task 1.1).
- Produces: `type Tier = "system" | "faction-region" | "faction"`;
  `interface AggGroup { key: string; tier: Tier; cx: number; cy: number; memberIds: string[]; value: number }`;
  `buildAggregationGroups(systems, values, mode): { system: AggGroup[]; factionRegion: AggGroup[]; faction: AggGroup[] }`;
  `interface TierThresholds { factionToRegion: number; regionToSystem: number }`;
  `pickTier(zoom: number, t: TierThresholds): Tier`; `DEFAULT_TIER_THRESHOLDS: TierThresholds`.

- [ ] **Step 1: Write the failing test**

```ts
// components/map/pixi/__tests__/number-aggregation.test.ts
import { describe, it, expect } from "vitest";
import {
  buildAggregationGroups, pickTier, DEFAULT_TIER_THRESHOLDS,
} from "@/components/map/pixi/number-aggregation";
import type { AtlasSystem } from "@/lib/types/game";

const sys = (id: string, x: number, y: number, factionId: string | null, regionId: string): AtlasSystem => ({
  id, x, y, regionId, factionId, economyType: "agricultural", isGateway: false, developed: true,
});

describe("buildAggregationGroups", () => {
  const systems = [
    sys("a", 0, 0, "f1", "r1"), sys("b", 10, 0, "f1", "r1"),   // f1 in r1 (2)
    sys("c", 100, 0, "f1", "r2"),                               // f1 in r2 (1) → f1 spans 2 regions
    sys("d", 0, 100, "f2", "r1"),                               // f2 in r1
    sys("u", 50, 50, null, "r1"),                               // unclaimed
  ];
  const values = new Map([["a", 4], ["b", 6], ["c", 10], ["d", 2], ["u", 0]]);

  it("splits a multi-region faction into one faction-region group per region", () => {
    const g = buildAggregationGroups(systems, values, "population");
    const f1regions = g.factionRegion.filter((x) => x.key.startsWith("f1|"));
    expect(f1regions).toHaveLength(2);
  });
  it("population aggregates by SUM", () => {
    const g = buildAggregationGroups(systems, values, "population");
    const f1 = g.faction.find((x) => x.key === "f1")!;
    expect(f1.value).toBe(20); // 4 + 6 + 10
  });
  it("development aggregates by AVERAGE", () => {
    const g = buildAggregationGroups(systems, values, "development");
    const f1r1 = g.factionRegion.find((x) => x.key === "f1|r1")!;
    expect(f1r1.value).toBe(5); // (4 + 6) / 2
  });
  it("unclaimed (null faction) systems form no faction/faction-region group", () => {
    const g = buildAggregationGroups(systems, values, "population");
    expect(g.faction.some((x) => x.key === "null")).toBe(false);
    expect(g.factionRegion.some((x) => x.key.startsWith("null"))).toBe(false);
    expect(g.system).toHaveLength(5); // system tier still includes the unclaimed cell
  });
  it("group centroid is the mean of member positions", () => {
    const g = buildAggregationGroups(systems, values, "population");
    const f1r1 = g.factionRegion.find((x) => x.key === "f1|r1")!;
    expect(f1r1.cx).toBe(5); // (0 + 10) / 2
    expect(f1r1.cy).toBe(0);
  });
});

describe("pickTier", () => {
  it("zooms from faction → faction-region → system as zoom rises", () => {
    const t = DEFAULT_TIER_THRESHOLDS;
    expect(pickTier(t.factionToRegion - 0.01, t)).toBe("faction");
    expect(pickTier(t.factionToRegion, t)).toBe("faction-region");
    expect(pickTier(t.regionToSystem, t)).toBe("system");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/map/pixi/__tests__/number-aggregation.test.ts`
Expected: FAIL — cannot resolve `number-aggregation`.

- [ ] **Step 3: Write the implementation**

```ts
// components/map/pixi/number-aggregation.ts
import type { AtlasSystem } from "@/lib/types/game";
import type { ValueMode } from "./value-ramp";

export type Tier = "system" | "faction-region" | "faction";

export interface AggGroup {
  key: string;
  tier: Tier;
  cx: number;
  cy: number;
  memberIds: string[];
  value: number; // population → sum; development / stability → average
}

export interface AggregationTiers {
  system: AggGroup[];
  factionRegion: AggGroup[];
  faction: AggGroup[];
}

const isAverageMode = (m: ValueMode) => m !== "population";

export function aggregateValue(vals: number[], mode: ValueMode): number {
  if (vals.length === 0) return 0;
  const sum = vals.reduce((a, b) => a + b, 0);
  return isAverageMode(mode) ? sum / vals.length : sum;
}

function push<K>(map: Map<K, AtlasSystem[]>, key: K, s: AtlasSystem): void {
  const arr = map.get(key);
  if (arr) arr.push(s);
  else map.set(key, [s]);
}

export function buildAggregationGroups(
  systems: AtlasSystem[],
  values: Map<string, number>,
  mode: ValueMode,
): AggregationTiers {
  const system: AggGroup[] = [];
  const frMap = new Map<string, AtlasSystem[]>();
  const faMap = new Map<string, AtlasSystem[]>();

  for (const s of systems) {
    system.push({ key: s.id, tier: "system", cx: s.x, cy: s.y, memberIds: [s.id], value: values.get(s.id) ?? 0 });
    if (s.factionId == null) continue; // unclaimed → forms no group
    push(frMap, `${s.factionId}|${s.regionId}`, s);
    push(faMap, s.factionId, s);
  }

  const groupFrom = (key: string, tier: Tier, mem: AtlasSystem[]): AggGroup => ({
    key,
    tier,
    cx: mem.reduce((a, s) => a + s.x, 0) / mem.length,
    cy: mem.reduce((a, s) => a + s.y, 0) / mem.length,
    memberIds: mem.map((s) => s.id),
    value: aggregateValue(mem.map((s) => values.get(s.id) ?? 0), mode),
  });

  return {
    system,
    factionRegion: [...frMap].map(([k, mem]) => groupFrom(k, "faction-region", mem)),
    faction: [...faMap].map(([k, mem]) => groupFrom(k, "faction", mem)),
  };
}

export interface TierThresholds {
  factionToRegion: number; // camera zoom at/above which mid-tier shows
  regionToSystem: number; // camera zoom at/above which per-system numbers show
}

// Placeholders — camera zoom runs 0..CAMERA.maxZoom (2.5). Re-tune on the real map (see prototype defaults).
export const DEFAULT_TIER_THRESHOLDS: TierThresholds = { factionToRegion: 0.5, regionToSystem: 1.1 };

export function pickTier(zoom: number, t: TierThresholds): Tier {
  if (zoom >= t.regionToSystem) return "system";
  if (zoom >= t.factionToRegion) return "faction-region";
  return "faction";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/map/pixi/__tests__/number-aggregation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/map/pixi/number-aggregation.ts components/map/pixi/__tests__/number-aggregation.test.ts
git commit -m "feat(map): three-tier number aggregation (system→faction-region→faction) (WS1)"
```

---

### Task 1.3: Shared Voronoi cell cache + analytic hit-testing

**Files:**
- Modify: `components/map/pixi/territory-utils.ts` (export the polygon types if not already exported)
- Create: `components/map/pixi/voronoi-cache.ts`
- Test: `components/map/pixi/__tests__/voronoi-cache.test.ts`

**Interfaces:**
- Consumes: `computeTerritoryPolygons` + `MultiPolygon` (`./territory-utils`), `AtlasSystem`.
- Produces: `interface SystemCells { cellsBySystemId: Map<string, MultiPolygon>; centroidBySystemId: Map<string, { x: number; y: number }>; findSystemAt(x: number, y: number): string | null }`;
  `buildSystemCells(systems: AtlasSystem[], mapSize: number): SystemCells`.

- [ ] **Step 1: Ensure the polygon types are exported**

Open `components/map/pixi/territory-utils.ts` (types at lines ~4–6). If `MultiPolygon` is not already `export`ed,
add the keyword:

```ts
export type Ring = [number, number][];
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];
```

- [ ] **Step 2: Write the failing test**

```ts
// components/map/pixi/__tests__/voronoi-cache.test.ts
import { describe, it, expect } from "vitest";
import { buildSystemCells } from "@/components/map/pixi/voronoi-cache";
import type { AtlasSystem } from "@/lib/types/game";

const sys = (id: string, x: number, y: number): AtlasSystem => ({
  id, x, y, regionId: "r", factionId: "f", economyType: "agricultural", isGateway: false, developed: true,
});

describe("buildSystemCells", () => {
  const MAP = 1000;
  const systems = [sys("a", 250, 250), sys("b", 750, 250), sys("c", 250, 750), sys("d", 750, 750)];
  const cells = buildSystemCells(systems, MAP);

  it("produces one cell per system", () => {
    expect(cells.cellsBySystemId.size).toBe(4);
    for (const s of systems) expect(cells.cellsBySystemId.has(s.id)).toBe(true);
  });
  it("findSystemAt returns the id of the nearest site (the containing Voronoi cell)", () => {
    expect(cells.findSystemAt(260, 260)).toBe("a");
    expect(cells.findSystemAt(740, 760)).toBe("d");
  });
  it("findSystemAt returns null outside the map extent", () => {
    expect(cells.findSystemAt(-10, 500)).toBeNull();
    expect(cells.findSystemAt(500, MAP + 10)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run components/map/pixi/__tests__/voronoi-cache.test.ts`
Expected: FAIL — cannot resolve `voronoi-cache`.

- [ ] **Step 4: Write the implementation**

```ts
// components/map/pixi/voronoi-cache.ts
import { Delaunay } from "d3-delaunay";
import { computeTerritoryPolygons, type MultiPolygon } from "./territory-utils";
import type { AtlasSystem } from "@/lib/types/game";

export interface SystemCells {
  cellsBySystemId: Map<string, MultiPolygon>;
  centroidBySystemId: Map<string, { x: number; y: number }>;
  findSystemAt(x: number, y: number): string | null;
}

/**
 * Build the Voronoi ONCE from the system point set and hand per-system cells to every consumer,
 * replacing the five independent triangulations. Hit-testing is analytic: a Voronoi cell is the set
 * of points nearest its site, so `delaunay.find(x, y)` is the cell under the cursor in O(log n).
 */
export function buildSystemCells(systems: AtlasSystem[], mapSize: number): SystemCells {
  const points: [number, number][] = systems.map((s) => [s.x, s.y]);
  const delaunay = Delaunay.from(points);
  const voronoi = delaunay.voronoi([0, 0, mapSize, mapSize]);
  const cellsBySystemId = computeTerritoryPolygons(systems.length, voronoi, (i) => systems[i].id);
  const centroidBySystemId = new Map(systems.map((s) => [s.id, { x: s.x, y: s.y }]));

  return {
    cellsBySystemId,
    centroidBySystemId,
    findSystemAt(x, y) {
      if (x < 0 || y < 0 || x > mapSize || y > mapSize) return null;
      const i = delaunay.find(x, y);
      return i >= 0 && i < systems.length ? systems[i].id : null;
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run components/map/pixi/__tests__/voronoi-cache.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/map/pixi/voronoi-cache.ts components/map/pixi/territory-utils.ts components/map/pixi/__tests__/voronoi-cache.test.ts
git commit -m "feat(map): shared Voronoi cell cache + analytic per-cell hit-testing (WS1)"
```

---

### Task 1.4: `ValueChoroplethLayer` — fills + number sublayer

**Files:**
- Create: `components/map/pixi/layers/value-choropleth-layer.ts`

**Interfaces:**
- Consumes: `SystemCells` (1.3), `valueRampColorPixi`/`ValueMode` (1.1), `buildAggregationGroups`/`pickTier`/
  `AggGroup`/`DEFAULT_TIER_THRESHOLDS` (1.2), `AtlasSystem`, `LODState` (`../lod`), `Frustum` (`../frustum`),
  `TERRITORY`/`BG_COLOR`/`TEXT_RESOLUTION` (`../theme`).
- Produces: `class ValueChoroplethLayer` with:
  `readonly container: Container`; `setActive(active: boolean): void`;
  `sync(cells: SystemCells, systems: AtlasSystem[]): void`;
  `setValues(values: Map<string, number>, reference: Map<string, number>, mode: ValueMode): void`;
  `setScope(factionId: string | null): void` (Phase-1 stub → global);
  `updateNumbers(zoom: number, frustum: Frustum): void`;
  `updateVisibility(lod: LODState): void`; `destroy(): void`.

This is Pixi rendering — verified by build + smoke, not a unit test. Follow the existing choropleth layers
(`stability-territory-layer.ts` draw loop) and `political-territory-layer.ts` (Text pooling/labels) as the
pattern. Key algorithm points, then the skeleton:

- **Fills:** for each `[systemId, multiPoly]` in `cells.cellsBySystemId`, colour =
  `valueRampColorPixi(values.get(id) ?? 0, referenceMax, mode)`. Draw the exterior ring
  (`.poly(exterior.flat()).fill({ color, alpha: TERRITORY.fillAlpha })`) plus a faint stroke, exactly like
  `stability-territory-layer.ts:58-71`. `referenceMax` = max of `reference` over the current scope (Phase 1:
  global = all systems).
- **Numbers:** rebuild `AggregationTiers` from `buildAggregationGroups(systems, values, mode)` in `setValues`.
  Each frame `updateNumbers(zoom, frustum)` picks the tier via `pickTier(zoom, this.thresholds)`, then places
  pooled `Text` at each group's `(cx, cy)` — **frustum-gated** and **greedy collision-avoided** (place
  highest-value groups first; skip a label whose screen rect overlaps a placed one). At `system` tier, skip
  groups whose value ≤ 0 (empty cells carry no number) and cull cells too small on-screen. Pool `Text` objects
  in an array; hide the unused tail rather than destroy/recreate (Text is expensive; `TEXT_RESOLUTION = 3`).
- **Number formatting:** population → `fmtCompact` (e.g. `1.2M`, `45K`); development/stability → `Math.round(v)`
  where the ramp value is 0..1 scaled ×100 for display (a small local `formatNumber(value, mode)`).
- **Perf:** `updateNumbers` runs every frame — guard with a cheap dirty/zoom-band check: cache the last tier and
  last integer-ish zoom bucket; only re-place labels when the tier or frustum meaningfully changed.

- [ ] **Step 1: Write the layer**

```ts
// components/map/pixi/layers/value-choropleth-layer.ts
import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { LODState } from "../lod";
import type { Frustum } from "../frustum";
import { TERRITORY, TEXT_RESOLUTION } from "../theme";
import { valueRampColorPixi, type ValueMode } from "../value-ramp";
import {
  buildAggregationGroups, pickTier, DEFAULT_TIER_THRESHOLDS,
  type AggGroup, type AggregationTiers, type TierThresholds,
} from "../number-aggregation";
import type { SystemCells } from "../voronoi-cache";
import type { AtlasSystem } from "@/lib/types/game";

const NUMBER_STYLE = new TextStyle({ fontSize: 28, fill: 0xf0e9df, fontFamily: "monospace", fontWeight: "600" });

/** Compact SI-ish formatting for population; 0..1 scores render ×100. */
function formatNumber(value: number, mode: ValueMode): string {
  if (mode === "population") {
    if (value >= 1e6) return `${(value / 1e6).toFixed(value < 1e7 ? 1 : 0)}M`;
    if (value >= 1e3) return `${Math.round(value / 1e3)}K`;
    return `${Math.round(value)}`;
  }
  return `${Math.round(value * 100)}`;
}

export class ValueChoroplethLayer {
  readonly container = new Container();
  private fills = new Graphics();
  private numbers = new Container();
  private pool: Text[] = [];

  private cells: SystemCells | null = null;
  private systems: AtlasSystem[] = [];
  private values = new Map<string, number>();
  private reference = new Map<string, number>();
  private mode: ValueMode = "population";
  private scopeFaction: string | null = null;
  private tiers: AggregationTiers = { system: [], factionRegion: [], faction: [] };
  private thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS;
  private referenceMax = 1;

  constructor() {
    this.container.addChild(this.fills);
    this.container.addChild(this.numbers);
    this.container.visible = false;
  }

  setActive(active: boolean) { this.container.visible = active; }

  /** Static geometry — call on atlas change only. */
  sync(cells: SystemCells, systems: AtlasSystem[]) {
    this.cells = cells;
    this.systems = systems;
    this.recomputeReferenceMax();
    this.drawFills();
    this.rebuildTiers();
  }

  /** Per-mode tick data. reference == values for pop/stability; == potential for development. */
  setValues(values: Map<string, number>, reference: Map<string, number>, mode: ValueMode) {
    this.values = values;
    this.reference = reference;
    this.mode = mode;
    this.recomputeReferenceMax();
    this.drawFills();
    this.rebuildTiers();
  }

  /** Phase 1: global only. Phase 2 re-normalises to a faction and de-emphasises the rest. */
  setScope(factionId: string | null) {
    this.scopeFaction = factionId;
    this.recomputeReferenceMax();
    this.drawFills();
  }

  private scopeMembers(): AtlasSystem[] {
    return this.scopeFaction == null
      ? this.systems
      : this.systems.filter((s) => s.factionId === this.scopeFaction);
  }

  private recomputeReferenceMax() {
    let max = 0;
    for (const s of this.scopeMembers()) max = Math.max(max, this.reference.get(s.id) ?? 0);
    this.referenceMax = max > 0 ? max : 1;
  }

  private drawFills() {
    if (!this.cells) return;
    this.fills.clear();
    for (const [id, multiPoly] of this.cells.cellsBySystemId) {
      const color = valueRampColorPixi(this.values.get(id) ?? 0, this.referenceMax, this.mode);
      for (const poly of multiPoly) {
        const exterior = poly[0];
        if (!exterior || exterior.length < 3) continue;
        const flat = exterior.flat();
        this.fills.poly(flat).fill({ color, alpha: TERRITORY.fillAlpha + 0.12 });
        this.fills.poly(flat).stroke({ color, alpha: TERRITORY.strokeAlpha, width: TERRITORY.strokeWidth });
      }
    }
  }

  private rebuildTiers() {
    this.tiers = buildAggregationGroups(this.systems, this.values, this.mode);
  }

  private lease(i: number): Text {
    let t = this.pool[i];
    if (!t) {
      t = new Text({ text: "", style: NUMBER_STYLE, resolution: TEXT_RESOLUTION });
      t.anchor.set(0.5);
      this.pool[i] = t;
      this.numbers.addChild(t);
    }
    return t;
  }

  /** Per-frame: choose tier by zoom, place pooled Text with frustum-gating + greedy collision avoidance. */
  updateNumbers(zoom: number, frustum: Frustum) {
    const tier = pickTier(zoom, this.thresholds);
    const groups: AggGroup[] =
      tier === "system" ? this.tiers.system.filter((g) => g.value > 0)
      : tier === "faction-region" ? this.tiers.factionRegion
      : this.tiers.faction;

    const sorted = [...groups].sort((a, b) => b.value - a.value);
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    let used = 0;
    for (const g of sorted) {
      if (!frustum.contains(g.cx, g.cy)) continue;
      const w = 90 / zoom, h = 44 / zoom; // world-space box ≈ constant screen size
      const box = { x: g.cx - w / 2, y: g.cy - h / 2, w, h };
      if (placed.some((p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y)) continue;
      placed.push(box);
      const t = this.lease(used++);
      t.text = formatNumber(g.value, this.mode);
      t.position.set(g.cx, g.cy);
      t.scale.set(1 / zoom); // keep numbers a stable on-screen size
      t.visible = true;
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  updateVisibility(lod: LODState) {
    if (!this.container.visible) return;
    this.fills.alpha = lod.territoryAlpha;
  }

  destroy() {
    for (const t of this.pool) t.destroy();
    this.fills.destroy();
    this.numbers.destroy({ children: true });
    this.container.destroy({ children: true });
  }
}
```

- [ ] **Step 2: Type-check compiles**

Run: `npx tsc --noEmit`
Expected: no errors in `value-choropleth-layer.ts` (frustum/theme imports resolve; verify `Frustum.contains(x, y)`
signature in `components/map/pixi/frustum.ts` matches — it is used the same way in `system-layer.ts:84`).

- [ ] **Step 3: Commit**

```bash
git add components/map/pixi/layers/value-choropleth-layer.ts
git commit -m "feat(map): generic value-choropleth layer with per-cell fills + number sublayer (WS1)"
```

---

### Task 1.5: Wire the value-choropleth layer into the canvas (replace the three)

**Files:**
- Modify: `components/map/pixi/pixi-map-canvas.tsx`

Verified by build + smoke. Changes, with the existing line anchors from the investigation:

- **Construct one layer, not three.** Remove the `StabilityTerritoryLayer`/`PopulationTerritoryLayer`/
  `DevelopmentTerritoryLayer` construction (lines ~183–194) and the matching `PixiRefs` fields (52–67). Add a
  single `valueChoroplethLayer = new ValueChoroplethLayer()` at the same z-order (added to `world` after
  `politicalTerritoryLayer`, before `systemLayer`).
- **Build shared cells once.** In the territory-sync effect (deps `atlasData.systems/factions/meta.mapSize`,
  lines ~323–333), build `const cells = buildSystemCells(atlasData.systems, mapSize)` and call
  `valueChoroplethLayer.sync(cells, atlasData.systems)`. Keep `territoryLayer.sync(...)` and
  `politicalTerritoryLayer.sync(...)` (they group differently). Stash `cells` on the `pixiRef` so interactions
  (Task 1.6) can hit-test against it.
- **Per-mode values via one setter.** Replace the three `set{Stability,Population,Development}` effects
  (lines ~350–369) with one effect that, when the active `mapMode` is a value mode, calls
  `valueChoroplethLayer.setValues(valueMap, referenceMap, mode)`:

```tsx
// effect deps: [mapMode, stabilityBySystem, populationBySystem, developmentBySystem, pixiReady]
const p = pixiRef.current;
if (!p) return;
if (mapMode === "population") p.valueChoroplethLayer.setValues(populationBySystem ?? EMPTY, populationBySystem ?? EMPTY, "population");
else if (mapMode === "stability") p.valueChoroplethLayer.setValues(stabilityBySystem ?? EMPTY, stabilityBySystem ?? EMPTY, "stability");
else if (mapMode === "development") p.valueChoroplethLayer.setValues(developmentBySystem ?? EMPTY, developmentBySystem ?? EMPTY, "development");
// Phase 1: reference == value map (dev uses current-development max as its v1 reference; potential lands in Phase 2).
```

  where `const EMPTY = new Map<string, number>()` is a module constant.
- **Activate the layer for value modes.** In the mode-toggle effect (lines ~341–349) replace the three
  `container.visible` lines with:
  `p.valueChoroplethLayer.setActive(mapMode === "population" || mapMode === "stability" || mapMode === "development")`.
- **Per-frame number placement.** In the ticker (lines ~256–260, where territory layers get `updateVisibility(lod)`),
  add: `p.valueChoroplethLayer.updateVisibility(lod)` and, when active,
  `p.valueChoroplethLayer.updateNumbers(camera.zoom, frustum)` (camera.zoom + frustum are already in scope at
  lines 220–221).

- [ ] **Step 1: Apply the edits above.**
- [ ] **Step 2: Type-check.** Run: `npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 3: Build gate.** Run: `npx next build --webpack` — Expected: compiles.
- [ ] **Step 4: Visual smoke.** Run: `npm run dev`, open the map, select each of Population / Development /
  Stability from the mode control. Expected against the prototype: cells fill with the grey→hue gradient;
  uncolonised/zero systems read **black**; numbers appear and **coalesce system → faction-region → faction** as
  you zoom out. Confirm no per-frame stutter on zoom (Text pooling + frustum gate working).
- [ ] **Step 5: Commit**

```bash
git add components/map/pixi/pixi-map-canvas.tsx
git commit -m "feat(map): drive one value-choropleth layer from the canvas, three-tier numbers on zoom (WS1)"
```

---

### Task 1.6: Per-cell selection wiring

**Files:**
- Modify: `components/map/pixi/interactions.ts`
- Modify: `components/map/pixi/pixi-map-canvas.tsx` (pass the cell cache + current mode into interactions)

Cell-level selection: in a **value mode**, a click anywhere in a cell selects that system (not just the tiny star
hitCircle). The star's own `pointerdown` already calls `onSystemClick` and `stopPropagation`s; we extend the
**stage** (empty-space) handler so a click that misses a star still resolves to its cell.

- **Extend the interaction inputs.** `setupInteractions` currently takes `{ app, systemLayer, getCallbacks,
  getMapData }` (interactions.ts:26). Add `getCellContext: () => { cells: SystemCells | null; isValueMode: boolean;
  toWorld: (screenX: number, screenY: number) => { x: number; y: number } }`. The canvas already owns the camera,
  so `toWorld` maps a screen point to world space (inverse of the world transform set at pixi-map-canvas:213–217).
- **Cell-aware empty click** (interactions.ts:60–68, `onStageClick`):

```ts
function onStageClick(e: FederatedPointerEvent) {
  const { onSystemClick, onEmptyClick } = getCallbacks();
  const { cells, isValueMode, toWorld } = getCellContext();
  if (isValueMode && cells) {
    const w = toWorld(e.global.x, e.global.y);
    const id = cells.findSystemAt(w.x, w.y);
    if (id != null) {
      const system = getMapData().allSystems.find((s) => s.id === id);
      if (system) { onSystemClick(system); return; }
    }
  }
  onEmptyClick(); // outside the map extent, or a non-value mode → clear
}
```

- **Wire from the canvas.** Where `setupInteractions(...)` is called (pixi-map-canvas:200), pass `getCellContext`
  reading `pixiRef.current.cells`, `mapMode` (via a ref, like `callbacksRef`), and a `toWorld` built from the
  `camera`. Keep everything behind refs so the once-only `setupInteractions` sees live values (same pattern as
  `callbacksRef`, 90–101).

- [ ] **Step 1: Apply the edits.**
- [ ] **Step 2: Type-check + build.** Run: `npx tsc --noEmit && npx next build --webpack` — Expected: passes.
- [ ] **Step 3: Visual smoke.** In a value mode, click **inside a cell but away from the star** → the system
  selects (detail panel opens, camera behaviour unchanged). Click **outside the map extent** → selection clears.
  Clicking directly on a star still selects (unchanged).
- [ ] **Step 4: Commit**

```bash
git add components/map/pixi/interactions.ts components/map/pixi/pixi-map-canvas.tsx
git commit -m "feat(map): per-cell selection via analytic hit-testing in value modes (WS1)"
```

---

### Task 1.7: Delete the three old choropleth layers

**Files:**
- Delete: `components/map/pixi/layers/stability-territory-layer.ts`
- Delete: `components/map/pixi/layers/population-territory-layer.ts`
- Delete: `components/map/pixi/layers/development-territory-layer.ts`

- [ ] **Step 1: Delete the three files** and remove their imports from `pixi-map-canvas.tsx` (should already be
  unreferenced after Task 1.5). Do NOT delete `lib/utils/stability.ts` / `lib/utils/population.ts` /
  `lib/utils/development.ts` — the `*RampLegend` components and the stability badge still import their ramp
  helpers.
- [ ] **Step 2: Grep for dangling references.**

Run: `git grep -n "TerritoryLayer" components/map/pixi | grep -iE "stability|population|development"`
Expected: no matches (only `ValueChoroplethLayer`, `TerritoryLayer`, `PoliticalTerritoryLayer` remain).

- [ ] **Step 3: Full unit run + build.** Run: `npx vitest run && npx next build --webpack` — Expected: green.
- [ ] **Step 4: Commit**

```bash
git add -A components/map/pixi
git commit -m "refactor(map): remove the three duplicate choropleth layers, folded into one (WS1)"
```

- [ ] **Step 5: Open the Phase 1 PR** into `feat/economy-rework-base`.

---

# Phase 2 — Faction-scoped gradients + political/value coexistence (PR: `feat/ws1-faction-scope`)

Branch off `feat/economy-rework-base` after Phase 1 merges. Adds relative re-normalisation on selection,
"Both" de-emphasis, the dev-potential reference, the faction-union outline, and political-zoomed-out faction
selection.

### Task 2.1: Emit per-system development potential

**Files:**
- Modify: `lib/types/game.ts` (`DevelopmentEntry`)
- Modify: `lib/services/development-map.ts` (`getDevelopmentBySystem`)
- Test: `lib/services/__tests__/development-map.test.ts` (create if absent; else extend)

**Interfaces:**
- Produces: `interface DevelopmentEntry { systemId: string; development: number; potential: number }`;
  `getDevelopmentBySystem()` now sets `potential` per system.

- [ ] **Step 1: Write the failing test**

```ts
// lib/services/__tests__/development-map.test.ts
import { describe, it, expect } from "vitest";
import { getDevelopmentBySystem } from "@/lib/services/development-map";
// (Use the project's world-fixture helper if one exists; otherwise build a minimal world with 2 systems
//  of clearly different habitableSpace/generalSpace/slot totals and assert potential tracks the substrate.)

describe("getDevelopmentBySystem", () => {
  it("emits a per-system potential derived from habitable + industry substrate", () => {
    const entries = getDevelopmentBySystem();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e).toHaveProperty("potential");
      expect(e.potential).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(e.potential)).toBe(true);
    }
    // the system with the largest substrate has the largest potential
    const max = entries.reduce((a, b) => (b.potential > a.potential ? b : a));
    expect(max.potential).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `npx vitest run lib/services/__tests__/development-map.test.ts`
  Expected: FAIL (`potential` undefined).
- [ ] **Step 3: Implement.** In `lib/types/game.ts`, add `potential: number` to `DevelopmentEntry` (line ~202).
  In `lib/services/development-map.ts` (`getDevelopmentBySystem`, ~31–46), compute per system, reusing the pure
  engine functions already imported for `developmentRefsForWorld`:

```ts
import { habitablePotentialPop, industryPotential } from "@/lib/engine/development";
// inside the per-system map:
const depositSlots = s.slotGas + s.slotMinerals + s.slotOre + s.slotBiomass + s.slotArable + s.slotWater + s.slotRadioactive;
const potential = habitablePotentialPop(s.habitableSpace) + industryPotential(depositSlots, s.generalSpace);
return { systemId: s.id, development, potential };
```

  (Verify the exact `slot*` field names against `lib/world/types.ts:83-89`.)
- [ ] **Step 4: Run to verify it passes.** Run: `npx vitest run lib/services/__tests__/development-map.test.ts` —
  Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add lib/types/game.ts lib/services/development-map.ts lib/services/__tests__/development-map.test.ts
git commit -m "feat(map): emit per-system development potential as the dev-mode ramp reference (WS1)"
```

### Task 2.2: Expose the potential map from `useDevelopment`

**Files:**
- Modify: `lib/hooks/use-development.ts`

- [ ] **Step 1:** Change the hook to fold both maps and return a discriminated object rather than a bare `Map`:
  `return { developmentBySystem, potentialBySystem }` (both `Map<string, number>`). Update the two call sites
  (`components/map/star-map.tsx:60/85-91` and anywhere else `git grep -n "useDevelopment("` reports).
- [ ] **Step 2:** In `star-map.tsx`, apply the same fog-of-war filter to `potentialBySystem` as to the value maps
  (lines ~85–91) and pass it to the canvas as `developmentReferenceBySystem`.
- [ ] **Step 3: Build.** Run: `npx tsc --noEmit && npx next build --webpack` — Expected: passes.
- [ ] **Step 4: Commit**

```bash
git add lib/hooks/use-development.ts components/map/star-map.tsx
git commit -m "feat(map): surface development potential to the map as the dev ramp reference (WS1)"
```

### Task 2.3: Faction scope re-normalisation + "Both" de-emphasis

**Files:**
- Modify: `components/map/pixi/value-ramp.ts` (add `deEmphasize`)
- Test: `components/map/pixi/__tests__/value-ramp.test.ts` (extend)
- Modify: `components/map/pixi/layers/value-choropleth-layer.ts` (`drawFills` honours scope + de-emphasis)
- Modify: `components/map/pixi/pixi-map-canvas.tsx` (pass selected faction id + dev reference)
- Modify: `components/map/star-map.tsx` (thread `selectedSystem?.factionId`)

- [ ] **Step 1: Failing test for `deEmphasize`.**

```ts
// append to value-ramp.test.ts
import { deEmphasize } from "@/components/map/pixi/value-ramp";
it("deEmphasize 'both' greys and darkens a colour but never returns pure black", () => {
  const top = rampTopPixi("population");
  const out = deEmphasize(top, "both");
  expect(out).not.toBe(top);
  expect(out).not.toBe(ABSENT_COLOR);
  // darker than the original (lower summed channels)
  const sum = (c: number) => (c >> 16) + ((c >> 8) & 255) + (c & 255);
  expect(sum(out)).toBeLessThan(sum(top));
});
```

- [ ] **Step 2: Implement `deEmphasize`** in `value-ramp.ts` (mirrors the prototype's "Both": mix toward
  luminance grey, then darken ×0.42):

```ts
export type DeEmphasis = "both" | "dim" | "desat"; // "hide" handled by the layer (→ background), future toggle
export function deEmphasize(color: number, treatment: DeEmphasis): number {
  const r = color >> 16, g = (color >> 8) & 255, b = color & 255;
  const L = r * 0.3 + g * 0.59 + b * 0.11;
  if (treatment === "desat") return (Math.round(r * 0.2 + L * 0.8) << 16) | (Math.round(g * 0.2 + L * 0.8) << 8) | Math.round(b * 0.2 + L * 0.8);
  if (treatment === "dim") return (Math.round(r * 0.26) << 16) | (Math.round(g * 0.26) << 8) | Math.round(b * 0.26);
  const mix = (c: number) => Math.round((c * 0.12 + L * 0.88) * 0.42);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}
```

- [ ] **Step 3: Layer honours scope.** In `value-choropleth-layer.ts` `drawFills`, when `scopeFaction != null` and
  the cell's system is out of scope, run the ramp against the **global** max then `deEmphasize(color, "both")`;
  in-scope cells use the scoped `referenceMax` (already computed by `recomputeReferenceMax` over `scopeMembers`).
  A `value ≤ 0` cell stays black regardless of scope (absence is absence — apply the zero check first).
  Requires the layer to know each system's `factionId`: build a `Map<id, factionId>` in `sync`.
- [ ] **Step 4: Thread the scope.** Add `setScope` calls from the canvas when `selectedSystem` changes: in a value
  mode, `valueChoroplethLayer.setScope(selectedSystem?.factionId ?? null)`. For development mode, pass
  `developmentReferenceBySystem` as the `reference` arg to `setValues` (instead of the value map).
- [ ] **Step 5: Build + smoke.** Run: `npx vitest run components/map/pixi/__tests__/value-ramp.test.ts && npx next build --webpack`.
  Smoke: click a system in a value mode → the gradient re-normalises to its faction (that faction's worlds now
  span the full ramp), other factions grey-and-dim; click empty → back to global. Against the prototype's
  "Both" treatment.
- [ ] **Step 6: Commit**

```bash
git add components/map/pixi/value-ramp.ts components/map/pixi/__tests__/value-ramp.test.ts components/map/pixi/layers/value-choropleth-layer.ts components/map/pixi/pixi-map-canvas.tsx components/map/star-map.tsx
git commit -m "feat(map): faction-scoped relative gradients with 'Both' de-emphasis (WS1)"
```

### Task 2.4: Faction-union outline over per-cell fills (political + value coexistence)

**Files:**
- Modify: `components/map/pixi/layers/political-territory-layer.ts` (expose `getFactionUnions(): Map<string, MultiPolygon>`)
- Modify: `components/map/pixi/layers/value-choropleth-layer.ts` (draw faction-union outlines)

- [ ] **Step 1:** In `political-territory-layer.ts`, expose the already-computed union polygons (`cachedTerritories`,
  keyed by factionId) via a getter. In `value-choropleth-layer.ts`, add an optional bolder faction outline drawn
  over the per-cell fills (stroke only, faction colour or copper), so value modes still show political borders.
  Reuse the union polygons — do not recompute a triangulation.
- [ ] **Step 2: Build + smoke.** In a value mode, faction borders read as a bolder outline over the per-cell
  gradient. Run: `npx next build --webpack`.
- [ ] **Step 3: Commit**

```bash
git add components/map/pixi/layers/political-territory-layer.ts components/map/pixi/layers/value-choropleth-layer.ts
git commit -m "feat(map): faction-union outline over per-cell value fills (WS1)"
```

### Task 2.5: Political-mode zoomed-out faction selection

**Files:**
- Modify: `components/map/pixi/interactions.ts` (faction hit-test when political + zoomed out)
- Modify: `components/map/pixi/pixi-map-canvas.tsx` + `components/map/star-map.tsx` (`onFactionClick`)

- [ ] **Step 1: Verify the faction-view target first.** `git grep -n "faction" app/(game) lib/query/keys.ts` to
  confirm how a faction screen/panel is opened today (route or panel). The `onFactionClick` handler navigates
  there. If no faction screen exists yet, scope this step to selecting the faction and opening whatever faction
  detail surface exists; note the gap in the PR description.
- [ ] **Step 2:** Add `onFactionClick: (factionId: string) => void` to `InteractionCallbacks`. In `onStageClick`,
  when `mapMode === "political"` and `camera.zoom < FACTION_SELECT_ZOOM` (a threshold aligned with the political
  layer's union LOD), point-in-polygon test the click against `getFactionUnions()` and call `onFactionClick`.
  Otherwise fall through to per-cell system selection (Task 1.6) or `onEmptyClick`.
- [ ] **Step 3: Build + smoke.** Political mode, zoomed out → clicking a faction shape opens the faction view;
  zoomed in → clicking selects the individual system (per-cell). Run: `npx next build --webpack`.
- [ ] **Step 4: Commit**

```bash
git add components/map/pixi/interactions.ts components/map/pixi/pixi-map-canvas.tsx components/map/star-map.tsx
git commit -m "feat(map): political-mode zoomed-out faction selection (WS1)"
```

- [ ] **Step 5: Open the Phase 2 PR** into `feat/economy-rework-base`.

---

# Phase 3 — Star-type dot + hover / hit-zone + icons refresh (PR: `feat/ws1-star-dots`)

Branch off `feat/economy-rework-base` after Phase 2 merges.

### Task 3.1: Thread `sunClass` through the atlas

**Files:**
- Modify: `lib/types/game.ts` (`AtlasSystem`, `StarSystemInfo`)
- Modify: `lib/services/atlas.ts` (`getAtlas` copies `sunClass`)
- Modify: `lib/hooks/use-map-data.ts` (`SystemNodeData` gains `sunClass`) + `components/map/star-map.tsx`
  (`mergedSystems` carries it through)
- Test: `lib/services/__tests__/atlas.test.ts` (create/extend)

**Interfaces:**
- Produces: `AtlasSystem.sunClass: SunClass`, `StarSystemInfo.sunClass: SunClass`,
  `SystemNodeData.sunClass: SunClass`.

- [ ] **Step 1: Failing test.**

```ts
// lib/services/__tests__/atlas.test.ts
import { describe, it, expect } from "vitest";
import { getAtlas } from "@/lib/services/atlas";
describe("getAtlas", () => {
  it("copies sunClass onto every AtlasSystem", () => {
    const atlas = getAtlas();
    expect(atlas.systems.length).toBeGreaterThan(0);
    for (const s of atlas.systems) {
      expect(["blue_white", "yellow", "orange_dwarf", "red_dwarf"]).toContain(s.sunClass);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `npx vitest run lib/services/__tests__/atlas.test.ts` — Expected:
  FAIL (`sunClass` undefined / type error).
- [ ] **Step 3: Implement.** Add `sunClass: SunClass` to `AtlasSystem` (game.ts:225-238) and `StarSystemInfo`
  (game.ts:121-136); in `getAtlas` (atlas.ts:55-64) add `sunClass: s.sunClass,` to the per-system map; add
  `sunClass` to `SystemNodeData` (use-map-data.ts:24-41) and set it where nodes are built; carry it through
  `mergedSystems` (star-map.tsx:136-155).
- [ ] **Step 4: Run to verify it passes** + build. Run:
  `npx vitest run lib/services/__tests__/atlas.test.ts && npx next build --webpack` — Expected: green.
- [ ] **Step 5: Commit**

```bash
git add lib/types/game.ts lib/services/atlas.ts lib/hooks/use-map-data.ts components/map/star-map.tsx lib/services/__tests__/atlas.test.ts
git commit -m "feat(map): thread sunClass through the atlas to the map nodes (WS1)"
```

### Task 3.2: Star-type dot rendering

**Files:**
- Modify: `components/map/pixi/theme.ts` (add `SUN_CLASS_COLORS_PIXI`)
- Modify: `components/map/pixi/objects/system-object.ts` (colour the core by star type; subdue in value modes)

- [ ] **Step 1:** In `theme.ts`, add a Pixi palette derived from `SUN_CLASS_COLORS`
  (`lib/constants/ui.ts` — hex strings): `export const SUN_CLASS_COLORS_PIXI: Record<SunClass, number> = { yellow: 0xfacc15, blue_white: 0x93c5fd, orange_dwarf: 0xfb923c, red_dwarf: 0xf87171 }`.
  Replace the `NEUTRAL_GLYPH` anchor comment usage.
- [ ] **Step 2:** In `system-object.ts` `update()` (the glyph draw, ~162–188) and `redrawHalo` (~240–256), colour
  the `core` and `glow` from `SUN_CLASS_COLORS_PIXI[data.sunClass]` instead of the flat `NEUTRAL_GLYPH`. Render
  the dot as a small star with a radial gradient (core → darker edge) — in Pixi v8 use a two-stop `FillGradient`
  or layer a bright core disc over a dimmer larger disc if a gradient fill regresses (prototype fell back to
  core+glow layering; pick whichever renders crisp at `CAMERA.maxZoom`). In **value modes** render the dot
  subdued (lower alpha / smaller) so the cell carries the value; in **political / none** it carries the star
  colour at full strength. `SystemObject` needs the current mode — pass it via `setOverlayFlags`/a `setMode`
  method threaded from `SystemLayer.sync`.
- [ ] **Step 3: Build + smoke.** Dots are tinted by star type (reds/oranges dominant, occasional blue-white);
  subdued under value modes, full under political/none. Run: `npx next build --webpack`.
- [ ] **Step 4: Commit**

```bash
git add components/map/pixi/theme.ts components/map/pixi/objects/system-object.ts
git commit -m "feat(map): colour the system dot by star type, subdued under value modes (WS1)"
```

### Task 3.3: Hover style + larger transparent selection hit-zone

**Files:**
- Modify: `components/map/pixi/objects/system-object.ts`, `components/map/pixi/theme.ts` (`SIZES.systemHitRadius`)

- [ ] **Step 1:** Fold in `[Sys 4]`: a clearer hover style (the existing `ANIM.hoverScale` plus a subtle
  star-coloured ring) and a **larger transparent selection hit-zone** — bump the invisible `hitCircle` radius
  (`SIZES.systemHitRadius`, theme.ts:70) or add a second larger invisible hit disc, so stars are easier to click
  at low zoom. (Cell hit-testing from Phase 1 covers value modes; this improves political/none where the star is
  the target.)
- [ ] **Step 2: Build + smoke.** Hover reads clearly; stars are comfortably clickable at low zoom. Run:
  `npx next build --webpack`.
- [ ] **Step 3: Commit**

```bash
git add components/map/pixi/objects/system-object.ts components/map/pixi/theme.ts
git commit -m "feat(map): clearer hover + larger star selection hit-zone (WS1)"
```

### Task 3.4: Icons-not-refreshing fix

**Files:**
- Modify: `components/map/pixi/objects/system-object.ts` and/or `components/map/pixi/layers/system-layer.ts`

- [ ] **Step 1: Reproduce + diagnose.** `[Map 5]`: identify the case where event/price pill icons fail to refresh
  after a tick. Likely the diff-guard in `system-object.ts` `update()` (the `current*` change-detection fields,
  ~76–84) skips a redraw when the underlying data changed but the guarded key did not. Add the missing field to
  the change check, or invalidate the texture on the relevant data change.
- [ ] **Step 2: Build + smoke.** Trigger an event / price change on a system and confirm the icon updates on the
  next tick without a full remount. Run: `npx next build --webpack`.
- [ ] **Step 3: Commit**

```bash
git add components/map/pixi/objects/system-object.ts components/map/pixi/layers/system-layer.ts
git commit -m "fix(map): refresh system pill icons on data change (WS1)"
```

- [ ] **Step 4: Open the Phase 3 PR** into `feat/economy-rework-base`.

---

## Docs lifecycle (do this on the last phase branch, before its squash-merge)

- Promote `docs/planned/ui-ws1-voronoi-map.md` → `docs/active/gameplay/` (or `docs/active/design-system/`), rewritten
  as present-tense as-built (no phase/PR history — [[feedback-active-docs-present-tense]]).
- Update `docs/SPEC.md` and the UI-overhaul umbrella (`docs/planned/ui-overhaul.md`) to mark WS1 shipped.
- Delete this build plan (`docs/build-plans/ws1-voronoi-map.md`) and its prototype companion
  (`docs/build-plans/ws1-map-prototype.html`) — the code is the source of truth once shipped.

---

## Self-review — spec coverage

- **Per-cell score-0→black relative fills** → Tasks 1.1, 1.4, 1.5 (+ black-reserved-for-zero contract).
- **system → faction-within-region → faction numbers** (pop sum, dev/stab avg) → Tasks 1.2, 1.4, 1.5.
- **Per-cell hit-testing / selection** → Tasks 1.3, 1.6.
- **Faction-scoped relative gradients + de-emphasis ("Both")** → Tasks 2.1–2.3.
- **Mode-appropriate reference (dev = potential)** → Tasks 2.1, 2.2, 2.3.
- **Political + value coexistence (faction-union outline)** → Task 2.4.
- **Political zoomed-out faction selection** → Task 2.5.
- **Star-type dot (sunClass plumbing + Pixi dot)** → Tasks 3.1, 3.2.
- **`[Sys 4]` hover + hit-zone** → Task 3.3. **`[Map 5]` icons refresh** → Task 3.4.
- **Three-layers → one-layer consolidation** → Tasks 1.4, 1.5, 1.7.
- **Deferred (not in this plan, per spec):** stored "sectors"; a true "control" mode; panel offset (WS4); new
  modes migration/price/logistics (WS2); "Hide" de-emphasis as a user toggle (kept reachable, not built).
