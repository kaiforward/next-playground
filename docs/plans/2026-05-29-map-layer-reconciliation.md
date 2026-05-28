# Map Layer & Symbol Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the Pixi map's per-system glyph furniture, z-order, LOD, colour palette, and overlay control panel into one coherent system per [docs/planned/map-layer-reconciliation.md](../planned/map-layer-reconciliation.md).

**Architecture:** Two PRs. **PR 1** (rendering) consolidates all per-glyph furniture into `SystemObject` — halo-as-lens, magenta gateway ring, big dashed nav ring, four uniform corner pills with two-stage shape→content LOD — removing the standalone `PriceHeatmapLayer` and fixing z-order. **PR 2** (control) adds Fleet/Events as toggleable overlays, presets, hover/select reveal, and the compact preset-driven control panel. PR 2 branches off `main` after PR 1 merges (it depends on PR 1's glyph rendering).

**Tech Stack:** Next.js 16, TypeScript 5 (strict — no `as`, no `unknown`), Pixi.js v12, Tailwind v4 + tailwind-variants, Vitest 4.

**Testing approach (read this):** This repo has **no Pixi unit tests** — the only map test is `components/map/pixi/__tests__/lod.test.ts` (pure LOD math). We follow that precedent: **pure logic is TDD'd** (LOD thresholds, the preset↔overlay mapping, price→tint), **Pixi rendering is verified by running the dev server and inspecting the map** against explicit acceptance criteria in each task. Do not fabricate Pixi unit tests. `vitest.config.ts` only includes `lib/**/__tests__/**` and `components/map/pixi/__tests__/**` — put any new pure-logic tests in those locations or they will be silently skipped.

**Branch strategy:** PR 1 on `feat/map-render-reconciliation` → `main`. After merge, PR 2 on `feat/map-control-panel` → `main`. Commit after each task.

---

## File Structure

**PR 1 — rendering (mostly `SystemObject` + theme + LOD):**
- Modify `components/map/pixi/theme.ts` — radial-budget radii, magenta gateway, unified pill geometry, event-icon map.
- Modify `components/map/pixi/lod.ts` + `__tests__/lod.test.ts` — `pillContentAlpha` / `showPillContent`, retune bands.
- Modify `lib/hooks/use-map-data.ts` — compute `priceTint` + `priceDelta` into `SystemNodeData`.
- Modify `components/map/pixi/objects/system-object.ts` — halo lens, gateway ring, nav ring, four corner pills, two-stage LOD.
- Modify `components/map/pixi/pixi-map-canvas.tsx` — remove `PriceHeatmapLayer`, fix z-order.
- Delete `components/map/pixi/layers/price-heatmap-layer.ts` (its job moves into the glyph).

**PR 2 — control (overlay state + panel):**
- Modify `lib/hooks/use-map-overlays.ts` — add `fleet`/`events`, new defaults, preset state.
- Create `lib/utils/map-presets.ts` + `lib/utils/__tests__/map-presets.test.ts` — pure preset↔overlay mapping.
- Modify `components/map/map-session.ts` — persist new overlay keys.
- Modify `components/map/pixi/objects/system-object.ts` + `system-layer.ts` + `pixi-map-canvas.tsx` — respect Fleet/Events overlay flags + hover/select reveal.
- Modify `components/map/map-overlay-controls.tsx` — preset row, segmented territory, 2-col overlay grid, hover-tooltip legends.
- Modify `components/map/star-map.tsx` — pass overlay flags to the canvas.

---

# PR 1 — Map Rendering Reconciliation

### Task 1.1: Theme constants for the new glyph

**Files:**
- Modify: `components/map/pixi/theme.ts`

- [ ] **Step 1: Add the radial budget, gateway colour, unified pill geometry, and event-icon map**

Add to `theme.ts` (keep existing exports; these are additive — old `FLEET` pill values are reused):

```ts
// ── Glyph radial budget (world units, glyph-local) ───────────────
export const GLYPH = {
  coreRadius:    12,   // economy core (unchanged)
  haloRadius:    20,   // soft-body lens (was the 40px glow — pulled in)
  haloAlpha:     0.16, // economy default
  haloPriceAlpha: 0.5, // when the halo carries the price ramp
  gatewayRingRadius: 28,
  gatewayRingWidth:  3,
  navRingRadius:     34, // outermost, dashed
  navRingWidth:      3,
} as const;

// Gateway: reserved magenta, used by nothing else on the map.
export const GATEWAY_COLOR = 0xe879f9; // fuchsia-400

// ── Unified corner-pill geometry (all four corners share this) ───
export const PILL = {
  height:     18,
  corner:     5,
  padX:       5,
  gap:        3,   // vertical gap when stacking (ships+convoys)
  offset:     4,   // radial gap between pill edge and core
  glyphSize:  8,   // inner ship chevron / icon box
} as const;

// Event icon by colour bucket (SystemEventInfo.color already categorises).
export const EVENT_ICON: Record<SystemEventInfo["color"], string> = {
  red:    "⚔",   // ⚔ conflict / raid
  amber:  "▲",   // ▲ boom / shock
  purple: "✦",   // ✦ anomaly / precursor
  green:  "★",   // ★ festival / boon
  blue:   "⚛",   // ⚛ tech
  slate:  "●",   // ● generic
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. (`SystemEventInfo` is already imported at the top of `theme.ts`.)

- [ ] **Step 3: Commit**

```bash
git add components/map/pixi/theme.ts
git commit -m "feat(map): add glyph radial budget, magenta gateway, unified pill geometry"
```

---

### Task 1.2: LOD — two-stage pill reveal + retune

**Files:**
- Modify: `components/map/pixi/lod.ts`
- Test: `components/map/pixi/__tests__/lod.test.ts`

- [ ] **Step 1: Write failing tests for the new content gate**

Append to `lod.test.ts`:

```ts
import { computeLOD } from "../lod";

describe("pill content staging", () => {
  it("hides pill content while the system layer is still fading in", () => {
    const lod = computeLOD(0.42); // crossfade just finished, names not yet in
    expect(lod.showPillContent).toBe(false);
    expect(lod.pillContentAlpha).toBe(0);
  });

  it("reveals pill content at closer zoom, in step with names", () => {
    const near = computeLOD(0.6);
    expect(near.showPillContent).toBe(true);
    expect(near.pillContentAlpha).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run components/map/pixi/__tests__/lod.test.ts`
Expected: FAIL — `showPillContent` / `pillContentAlpha` undefined.

- [ ] **Step 3: Add the fields to `LODState` and `computeLOD`**

In `lod.ts`, add to the `LODState` interface:

```ts
  /** Whether pill TEXT/ICON content shows (shapes show earlier, with the layer). */
  showPillContent: boolean;
  /** Alpha for pill text/icon content (smooth fade). */
  pillContentAlpha: number;
```

In the `computeLOD` return object, add (content reveals with system names, one band after the pill shapes appear with `systemLayerAlpha`):

```ts
    showPillContent: zoom > 0.5,
    pillContentAlpha: smoothStep(0.5, 0.6, zoom),
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx vitest run components/map/pixi/__tests__/lod.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add components/map/pixi/lod.ts components/map/pixi/__tests__/lod.test.ts
git commit -m "feat(map): add two-stage pill LOD (shape early, content near)"
```

---

### Task 1.3: Feed price tint + delta into `SystemNodeData`

**Files:**
- Modify: `lib/hooks/use-map-data.ts`

The glyph needs price data to recolour its halo and fill the top-right pill. Today price lives only in `MapData.priceHeatmap`. Compute it per-system into `SystemNodeData`.

- [ ] **Step 1: Add fields to `SystemNodeData`**

In `use-map-data.ts`, extend the interface (after `activeEvents`):

```ts
  /** Price-ramp tint for the active heatmap good, or null when none/overlay off. */
  priceTint?: number | null;
  /** Signed % deviation from base price for the active heatmap good. */
  priceDelta?: number | null;
```

- [ ] **Step 2: Populate them where each `SystemNodeData` is built**

Import the ramp helper at the top:

```ts
import { priceRampColorPixi } from "@/lib/utils/price-ramp";
```

In the `useMemo` that maps systems → `SystemNodeData` (the block that already sets `dockedShipCount`, `activeEvents`, etc.), resolve the per-system price from the `priceHeatmap` map argument:

```ts
const price = priceHeatmap?.get(sys.id) ?? null;
const priceTint = price ? priceRampColorPixi(price.currentPrice, price.basePrice) : null;
const priceDelta = price
  ? Math.round((price.currentPrice / price.basePrice - 1) * 100)
  : null;
```

and include `priceTint, priceDelta` in the returned node object.

- [ ] **Step 3: Verify build + existing tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/hooks/use-map-data.ts
git commit -m "feat(map): compute price tint + delta into SystemNodeData"
```

---

### Task 1.4: SystemObject — halo as the overlay lens

**Files:**
- Modify: `components/map/pixi/objects/system-object.ts`

Replace the fixed-economy glow with a halo that recolours to the price ramp when price data is present, else economy. Use `GLYPH` from theme.

- [ ] **Step 1: Import the new constants**

```ts
import { ECONOMY_COLORS, NAV_COLORS, SIZES, GLYPH, GATEWAY_COLOR, PILL, EVENT_ICON, TEXT_COLORS, TEXT_RESOLUTION } from "../theme";
```

- [ ] **Step 2: Recolour the halo in `update()`**

In the `econChanged || visibilityChanged` block, replace the `this.glow` fill logic so the halo uses `GLYPH.haloRadius` and chooses tint by price presence:

```ts
const hasPrice = data.priceTint != null;
const haloColor = hasPrice ? data.priceTint! : colors.glow;
const haloAlpha = isUnknown ? 0.05 : (hasPrice ? GLYPH.haloPriceAlpha : GLYPH.haloAlpha);
this.glow.clear();
this.glow.circle(0, 0, GLYPH.haloRadius);
this.glow.fill({ color: haloColor, alpha: haloAlpha });
```

> Note: `data.priceTint!` is permitted here only because `hasPrice` already null-checked it — this is a control-flow narrowing, not an `as` cast. If the linter objects, hoist to `const tint = data.priceTint; if (tint != null) {…}`.

Track price in the diff guard so live changes redraw: add `priceTint`/`priceDelta` to the change detection (compare against stored `currentPriceTint`/`currentPriceDelta` fields you add alongside the other `current*` fields).

- [ ] **Step 3: Visual verify**

Run: `npm run dev`, open the map, turn on the Price overlay, pick a good. Acceptance:
- System halos recolour along the price ramp (green bargains → red premiums); cores keep their economy colour.
- With Price off, halos are the faint economy tint as before.
- Zooming to universe view, halos fade out with the system layer (unchanged).

- [ ] **Step 4: Commit**

```bash
git add components/map/pixi/objects/system-object.ts
git commit -m "feat(map): halo recolours as the active-overlay (price) lens"
```

---

### Task 1.5: SystemObject — magenta gateway ring (replaces the dot)

**Files:**
- Modify: `components/map/pixi/objects/system-object.ts`

- [ ] **Step 1: Replace the `gatewayDot` graphics with a ring**

Rename the field to `gatewayRing` (keep it a `Graphics`). In the `gatewayChanged` block, draw a stroked ring instead of a filled dot:

```ts
this.gatewayRing.clear();
if (data.isGateway) {
  this.gatewayRing.visible = true;
  this.gatewayRing.circle(0, 0, GLYPH.gatewayRingRadius);
  this.gatewayRing.stroke({ color: GATEWAY_COLOR, width: GLYPH.gatewayRingWidth });
} else {
  this.gatewayRing.visible = false;
}
```

Add `this.gatewayRing` to the scene graph **below the core's z-position is wrong** — the ring must sit outside the halo but the child draw order in the constructor should be: glow(halo) → gatewayRing → navigationRing → core → … . Reorder `addChild` calls so the ring renders behind the core but its larger radius is visible around the halo.

- [ ] **Step 2: Visual verify**

Run: `npm run dev`. Acceptance: gateway systems show a bright magenta ring around the glyph (no amber dot); non-gateways show no ring. The magenta is visually distinct from core-economy purple and purple event pills.

- [ ] **Step 3: Commit**

```bash
git add components/map/pixi/objects/system-object.ts
git commit -m "feat(map): replace gateway dot with magenta gateway ring"
```

---

### Task 1.6: SystemObject — big dashed nav-state ring

**Files:**
- Modify: `components/map/pixi/objects/system-object.ts`

Make the navigation ring the outermost, large, dashed ring and restrict it to `origin` / `destination` / selected. `reachable` keeps its current subtle thin ring; `unreachable` keeps dimming.

- [ ] **Step 1: Draw origin/destination/selected as a dashed outer ring**

Pixi v12 has no native dashed stroke on `circle()`; draw the dashes as short arcs. Add a helper to the class:

```ts
private strokeDashedRing(g: Graphics, radius: number, color: number, width: number) {
  const dash = 0.5;  // radians drawn
  const gap = 0.32;  // radians skipped
  for (let a = 0; a < Math.PI * 2; a += dash + gap) {
    g.arc(0, 0, radius, a, a + dash);
  }
  g.stroke({ color, width });
}
```

In `updateNavigationVisuals`, for `origin` and `destination` (and the selected-no-nav case), call:

```ts
this.strokeDashedRing(this.navigationRing, GLYPH.navRingRadius, NAV_COLORS.origin /* or destination */, GLYPH.navRingWidth);
```

Keep the `reachable` thin solid ring and `unreachable` `alpha = 0.3` exactly as today.

- [ ] **Step 2: Visual verify**

Run: `npm run dev`. Plan a route. Acceptance: the origin and destination systems show a big dashed ring as the outermost element (outside the gateway ring if present); reachable nodes show the subtle thin ring; unreachable nodes dim. No dashed ring on ordinary systems.

- [ ] **Step 3: Commit**

```bash
git add components/map/pixi/objects/system-object.ts
git commit -m "feat(map): big dashed nav-state ring on origin/destination"
```

---

### Task 1.7: SystemObject — top-right price pill

**Files:**
- Modify: `components/map/pixi/objects/system-object.ts`

Reuse the existing `drawPill` pattern (already used for docked fleet pills) for a price pill at the top-right, tinted to match the halo, showing the signed delta.

- [ ] **Step 1: Add a price pill member + draw it**

Add `private pricePill: DockedPill;` (reuse the `DockedPill` shape: container + bg + label; the chevron glyph is unused for price — hide it). In `update()`, when `data.priceTint != null`, position it top-right using `PILL` geometry, fill `data.priceTint`, label `` `${delta > 0 ? "+" : ""}${delta}%` ``. Hide it when price is null.

Anchor: top-right mirror of the fleet pills' top-left anchor — `x = +GLYPH.coreRadius - 2`, growing rightward; `y = -GLYPH.coreRadius - 2`.

- [ ] **Step 2: Visual verify**

Run: `npm run dev`, Price overlay on. Acceptance: each priced system shows a top-right pill with its % delta, same height as the fleet pills, tinted to the ramp; the halo + pill agree in colour. No pill when Price is off.

- [ ] **Step 3: Commit**

```bash
git add components/map/pixi/objects/system-object.ts
git commit -m "feat(map): top-right price delta pill (matches halo tint)"
```

---

### Task 1.8: SystemObject — bottom-right event icon pills

**Files:**
- Modify: `components/map/pixi/objects/system-object.ts`

Replace the `eventDots` (tiny circles) with a single bottom-right pill: dominant event's icon + count, bordered by the dominant event colour.

- [ ] **Step 1: Replace `drawEventDots` with an event pill**

Keep choosing the highest-priority event (existing sort). Draw a pill at bottom-right (`PILL` geometry) with: dark fill (`0x1e293b`), 1.5px stroke in `EVENT_DOT_COLORS[topColor]`, an icon `Text` using `EVENT_ICON[topColor]`, and a count `Text` when `events.length > 1`. Hide when no events or `unreachable`.

- [ ] **Step 2: Visual verify**

Run: `npm run dev`. Acceptance: systems with events show one bottom-right pill (icon + count) instead of stacked dots; the border colour matches the dominant event category; no pill on event-free systems.

- [ ] **Step 3: Commit**

```bash
git add components/map/pixi/objects/system-object.ts
git commit -m "feat(map): bottom-right event icon pill (replaces event dots)"
```

---

### Task 1.9: SystemObject — uniform fleet-pill geometry + two-stage LOD

**Files:**
- Modify: `components/map/pixi/objects/system-object.ts`

Make all four corner pills share `PILL` height/offset, and gate **content** (text + icon) on `lod.showPillContent` while **shapes** show with the layer.

- [ ] **Step 1: Normalise pill geometry**

Update `drawPill` and the price/event pills to use `PILL.height`, `PILL.corner`, `PILL.padX`, `PILL.offset`, `PILL.gap` so every corner pill is the same height and sits the same distance from the core.

- [ ] **Step 2: Two-stage reveal in `setLOD`**

In `setLOD(lod)`, set each pill's **background** visible whenever its data is present (shape stage), but set the **label/icon/glyph** `visible` to `lod.showPillContent` and `alpha` to `lod.pillContentAlpha` (content stage). Apply to fleet, convoy, price, and event pills uniformly.

- [ ] **Step 3: Visual verify**

Run: `npm run dev`. Zoom from far → near. Acceptance: just after systems fade in, pills are bare coloured shapes (no text/icons); continuing to zoom in, contents fade in around the same point names appear; all four corners are the same height and offset.

- [ ] **Step 4: Commit**

```bash
git add components/map/pixi/objects/system-object.ts
git commit -m "feat(map): uniform pill geometry + shape-then-content LOD"
```

---

### Task 1.10: Remove PriceHeatmapLayer + fix z-order

**Files:**
- Modify: `components/map/pixi/pixi-map-canvas.tsx`
- Delete: `components/map/pixi/layers/price-heatmap-layer.ts`

Price now renders inside `SystemObject`, so the standalone layer is dead.

- [ ] **Step 1: Remove the layer from the canvas**

In `pixi-map-canvas.tsx`: delete the `PriceHeatmapLayer` import, its field in `PixiRefs`, its construction + `addChild`, its per-frame `updateVisibility` call, its `sync` call in the data effect, and its `destroy()` in cleanup. Confirm final `world.addChild` order matches the spec z-order: pointCloud → connection → tradeFlow → territory → political → fleetDot → systemLayer → fleetTransit → effect.

- [ ] **Step 2: Delete the file**

```bash
git rm components/map/pixi/layers/price-heatmap-layer.ts
```

- [ ] **Step 3: Verify build + no dangling refs**

Run: `npx tsc --noEmit`
Expected: no errors, no references to `PriceHeatmapLayer` remain.

- [ ] **Step 4: Visual verify**

Run: `npm run dev`. Acceptance: price still renders (halo + pill from the glyph), the old concentric price ring is gone, ship transit markers still draw on top of glyphs, nothing flickers when toggling Price.

- [ ] **Step 5: Commit**

```bash
git add components/map/pixi/pixi-map-canvas.tsx
git commit -m "refactor(map): remove PriceHeatmapLayer; price renders in the glyph"
```

---

### Task 1.11: PR 1 QA pass + open PR

- [ ] **Step 1: Full check**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all green.

- [ ] **Step 2: Manual QA checklist** (`npm run dev`)
  - Everyday system: economy core + faint halo, no rings unless gateway; calm.
  - Gateway: magenta ring. Price on: halo + TR pill ramp-coloured. Events: BR icon pill. Docked ships: TL pills.
  - Zoom staging: pill shapes far, content near, names ~0.5, economy/fuel ~0.6.
  - Routing: dashed nav ring on origin/destination; unreachable dim.
  - Universe zoom: glyph furniture fades, point cloud shows, transit markers persist.

- [ ] **Step 3: Push + open PR** (only after the user confirms QA)

```bash
git push -u origin feat/map-render-reconciliation
gh pr create --title "Map render reconciliation: halo lens, rings, uniform pills" --body "Implements PR 1 of docs/planned/map-layer-reconciliation.md"
```

---

# PR 2 — Control Panel & Overlay Model

*Branch `feat/map-control-panel` off `main` after PR 1 merges.*

### Task 2.1: Pure preset ↔ overlay mapping

**Files:**
- Create: `lib/utils/map-presets.ts`
- Test: `lib/utils/__tests__/map-presets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { PRESETS, overlaysForPreset, presetForOverlays, type MapPreset } from "../map-presets";

const base = { fleet: false, events: false, priceHeatmap: false, tradeFlow: false, shipRoutes: false };

describe("map presets", () => {
  it("Default preset = fleet + events", () => {
    expect(overlaysForPreset("default")).toEqual({ ...base, fleet: true, events: true });
  });
  it("Trader preset = price + events", () => {
    expect(overlaysForPreset("trader")).toEqual({ ...base, priceHeatmap: true, events: true });
  });
  it("round-trips a known preset", () => {
    expect(presetForOverlays(overlaysForPreset("navigator"))).toBe("navigator");
  });
  it("falls back to custom for an unmatched set", () => {
    expect(presetForOverlays({ ...base, fleet: true, tradeFlow: true })).toBe("custom");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/utils/__tests__/map-presets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `map-presets.ts`**

```ts
import type { MapOverlays } from "@/lib/hooks/use-map-overlays";

export type MapPreset = "default" | "trader" | "navigator" | "custom";

const SETS: Record<Exclude<MapPreset, "custom">, MapOverlays> = {
  default:   { fleet: true,  events: true,  priceHeatmap: false, tradeFlow: false, shipRoutes: false },
  trader:    { fleet: false, events: true,  priceHeatmap: true,  tradeFlow: false, shipRoutes: false },
  navigator: { fleet: true,  events: false, priceHeatmap: false, tradeFlow: false, shipRoutes: true  },
};

export const PRESETS: readonly MapPreset[] = ["default", "trader", "navigator", "custom"];

export function overlaysForPreset(p: Exclude<MapPreset, "custom">): MapOverlays {
  return { ...SETS[p] };
}

export function presetForOverlays(o: MapOverlays): MapPreset {
  for (const key of ["default", "trader", "navigator"] as const) {
    const s = SETS[key];
    if (
      s.fleet === o.fleet && s.events === o.events && s.priceHeatmap === o.priceHeatmap &&
      s.tradeFlow === o.tradeFlow && s.shipRoutes === o.shipRoutes
    ) return key;
  }
  return "custom";
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run lib/utils/__tests__/map-presets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/map-presets.ts lib/utils/__tests__/map-presets.test.ts
git commit -m "feat(map): pure preset <-> overlay mapping"
```

---

### Task 2.2: Extend overlay state (fleet/events, new defaults, presets)

**Files:**
- Modify: `lib/hooks/use-map-overlays.ts`
- Modify: `components/map/map-session.ts`

- [ ] **Step 1: Add the two keys + new defaults to `MapOverlays`**

In `use-map-overlays.ts`, extend the interface with `fleet: boolean;` and `events: boolean;`, and change `DEFAULT_OVERLAYS` to the Default preset:

```ts
const DEFAULT_OVERLAYS: MapOverlays = {
  fleet: true, events: true, priceHeatmap: false, tradeFlow: false, shipRoutes: false,
};
```

Update `hydrateFromSession` and the persistence effect to read/write `fleet` and `events` alongside the existing keys.

- [ ] **Step 2: Add preset to the hook return**

Track active preset with `presetForOverlays(overlays)` (derived, not stored) and add a `setPreset(p)` that calls `setOverlays(overlaysForPreset(p))` for non-custom presets. Return `{ overlays, toggle, preset, setPreset }`.

- [ ] **Step 3: Persist the new keys in `map-session.ts`**

Add `fleet?: boolean;` and `events?: boolean;` to `MapOverlaysState`, and extend `parseOverlays` with the same `in`/`typeof` guards used for the existing keys.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: green. (Hook itself isn't unit-tested — no jsdom; the pure mapping is covered by Task 2.1.)

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/use-map-overlays.ts components/map/map-session.ts
git commit -m "feat(map): fleet/events overlays, preset state, new defaults"
```

---

### Task 2.3: Glyph respects Fleet/Events overlays + hover/select reveal

**Files:**
- Modify: `components/map/pixi/objects/system-object.ts`
- Modify: `components/map/pixi/layers/system-layer.ts`
- Modify: `components/map/pixi/pixi-map-canvas.tsx`
- Modify: `components/map/star-map.tsx`

Fleet/Events pills currently always render. Gate their **ambient** display on the overlay flag, but still show them when the system is hovered or selected (overlay-off ≠ data hidden).

- [ ] **Step 1: Thread overlay flags to the system layer**

Add a `setOverlayVisibility({ fleet, events }: { fleet: boolean; events: boolean })` to `SystemLayer` that stores the flags and re-applies LOD. Pass `overlays.fleet` / `overlays.events` from `star-map.tsx` → `PixiMapCanvas` prop → an effect that calls `systemLayer.setOverlayVisibility(...)`.

- [ ] **Step 2: Apply in `SystemObject.setLOD`**

Give `SystemObject` `showFleet` / `showEvents` flags (set from the layer). In `setLOD`, a pill's shape shows when `(overlayOn || isHovered || isSelected)` AND it has data. (Hover state: add `setHovered(boolean)` to `SystemObject`, driven by the existing interaction handler in `interactions.ts`; selected is already known via `sync`.)

- [ ] **Step 3: Visual verify**

Run: `npm run dev`. Acceptance: with Fleet off, docked pills are hidden ambiently but appear when you hover/select that system; same for Events. With them on, behaviour matches PR 1.

- [ ] **Step 4: Commit**

```bash
git add components/map/pixi/objects/system-object.ts components/map/pixi/layers/system-layer.ts components/map/pixi/pixi-map-canvas.tsx components/map/star-map.tsx
git commit -m "feat(map): fleet/events overlays gate ambient pills; reveal on hover/select"
```

---

### Task 2.4: Redesign the control panel (Direction A)

**Files:**
- Modify: `components/map/map-overlay-controls.tsx`

Restructure into: preset row → segmented Territory → 2-column overlay grid (colour-coded chips) → inline price picker (when Price on). Legends move to hover tooltips (Task 2.5).

- [ ] **Step 1: Add the preset row**

Accept `preset` + `setPreset` props (from the hook). Render a row of chips for `["default","trader","navigator","custom"]` (Custom non-clickable / shown only when active). Active chip uses the copper accent (`border-l-accent bg-accent/10` style already in `rowVariants`, or a dedicated chip variant).

- [ ] **Step 2: Convert Territory + Overlays to compact controls**

Territory: keep the radio group but render as a 3-segment horizontal control. Overlays: render `["fleet","events","priceHeatmap","tradeFlow","shipRoutes"]` as a 2-column grid; each chip carries a colour swatch matching its glyph element (fleet `#38bdf8`, events `#f59e0b`, price ramp mid `#dc7b4a`, tradeFlow tier cyan, routes `#38bdf8`). Reuse `dotVariants`/`rowVariants` where possible.

- [ ] **Step 3: Keep the price picker inline**

The `PriceOverlaySection` (good `SelectInput` + "Show all prices" button) stays, shown only when `overlays.priceHeatmap`. Remove the always-rendered `PriceRampLegend`/`TradeFlowLegend` from the inline flow (they move to tooltips).

- [ ] **Step 4: Visual verify**

Run: `npm run dev`. Acceptance: panel shows presets + segmented territory + 2-col overlay grid; selecting a preset flips the right toggles; toggling anything sets Custom; panel is visibly shorter than before; price picker still appears when Price is on.

- [ ] **Step 5: Commit**

```bash
git add components/map/map-overlay-controls.tsx
git commit -m "feat(map): preset-driven compact control panel (Direction A)"
```

---

### Task 2.5: Hover-tooltip legends

**Files:**
- Modify: `components/map/map-overlay-controls.tsx`

Move the price-ramp and trade-flow tier keys (and a short routes note) into tooltips on their overlay chips so they cost no permanent height.

- [ ] **Step 1: Wrap chips that have a legend in a hover tooltip**

Use a CSS hover popover (group-hover) or the project's existing tooltip primitive if one exists (check `components/ui/`). Price chip → the ramp gradient + `0.6×ǀbaseǀ1.4×`; Trade-flow chip → the three tier swatches (`TIER_COLOR`/`TIER_LABEL`); Routes chip → the one-line explanation. Render the tooltip absolutely-positioned so it doesn't grow the panel.

- [ ] **Step 2: Visual verify**

Run: `npm run dev`. Acceptance: hovering the Price/Trade-flow/Routes chips shows their legend in a floating tooltip; the panel height does not change when overlays toggle on.

- [ ] **Step 3: Commit**

```bash
git add components/map/map-overlay-controls.tsx
git commit -m "feat(map): hover-tooltip legends for overlay chips"
```

---

### Task 2.6: PR 2 QA + fold spec into active docs

**Files:**
- Modify: `docs/active/gameplay/universe.md` (and `docs/active/design-system/theme.md` if pill/colour rules belong there)
- Delete: `docs/planned/map-layer-reconciliation.md`
- Delete: `docs/plans/2026-05-29-map-layer-reconciliation.md`

- [ ] **Step 1: Full check**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: green.

- [ ] **Step 2: Manual QA** (`npm run dev`)
  - New player lands on Default (Fleet + Events on, Political territory).
  - Presets flip toggles; manual toggle → Custom.
  - Overlay-off still reveals on hover/select.
  - Panel compact; legends only on hover.

- [ ] **Step 3: Fold the design into `docs/active/gameplay/universe.md`**

Summarise the reconciled glyph anatomy, overlay model, and control panel into the active universe doc (the code is now the source of truth), then delete both the planned spec and this plan per the docs workflow.

- [ ] **Step 4: Commit + open PR** (after user confirms QA)

```bash
git add -A
git commit -m "docs(map): fold reconciliation into active universe spec; remove plan"
git push -u origin feat/map-control-panel
gh pr create --title "Map control panel: presets, overlays, compact legends" --body "Implements PR 2 of the map reconciliation spec"
```

---

## Self-Review (author checklist)

- **Spec coverage:** §1 mental model → PRs 1+2; §2 radial budget → 1.1/1.4/1.5/1.6; §3 pills → 1.7/1.8/1.9; §4 colour → 1.1/1.4/1.5; §5 z-order → 1.10; §6 overlays + defaults → 2.1/2.2/2.3; §7 hover/select → 2.3; §8 control panel → 2.4/2.5. All sections mapped.
- **Type consistency:** `MapOverlays` keys (`fleet, events, priceHeatmap, tradeFlow, shipRoutes`) are identical across Tasks 2.1/2.2/2.3; `GLYPH`/`PILL`/`GATEWAY_COLOR`/`EVENT_ICON` defined once in 1.1 and consumed by name thereafter; `priceTint`/`priceDelta` defined in 1.3, consumed in 1.4/1.7.
- **Open risk:** Pixi dashed-ring arcs and exact radii are visual-tuning targets, flagged in their tasks. Event icons use unicode via `Text`; if a glyph fails to render, fall back to drawn `Graphics` shapes (noted in 1.8).
