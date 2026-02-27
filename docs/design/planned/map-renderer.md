# Star Map Renderer — Pixi.js Migration

Replace the React Flow-based star map with a custom Pixi.js (WebGL) renderer. Procedural visuals — no external image assets. Replicates all current map functionality (two-level view, navigation mode, system detail panel, route preview) with enhanced visual quality.

**Replaces**: React Flow (`@xyflow/react`), `systemNode.tsx`, `regionNode.tsx`, all React Flow node/edge derivation in `use-map-graph.ts`.

**Preserves**: `use-map-view-state.ts` (view state logic), `use-navigation-state.ts` (navigation state machine), `system-detail-panel.tsx` (HTML overlay), `route-preview-panel.tsx` (HTML overlay), `map-session.ts` (session persistence). These are renderer-agnostic.

**Depends on**: Nothing — can be done before or after map-centric UI migration.

---

## 1. Architecture

### Rendering layers

The canvas and HTML overlays coexist as sibling DOM elements:

```
<div class="relative w-full h-full">
  <!-- Pixi.js WebGL canvas — fills container -->
  <canvas />

  <!-- HTML overlays — positioned absolutely on top -->
  <SystemDetailPanel />
  <RoutePreviewPanel />
  <NavigationBanner />
  <BackToRegionsButton />
  <MapControls />
</div>
```

The Pixi.js canvas handles all spatial rendering (systems, connections, regions, effects). HTML overlays handle complex interactive UI (panels, buttons, text inputs). They share coordinate space through a world-to-screen projection function exposed by the camera system.

### Component structure

```
components/map/
  star-map.tsx              ← Root orchestrator (keeps hooks, swaps renderer)
  pixi/
    pixi-map-canvas.tsx     ← React wrapper: creates Pixi app, manages resize
    camera.ts               ← Pan/zoom state, world↔screen transforms
    layers/
      starfield-layer.ts    ← Background parallax stars
      region-layer.ts       ← Region boundaries and labels (region view)
      connection-layer.ts   ← System connections / edges
      system-layer.ts       ← System nodes (circles, glows, labels)
      effect-layer.ts       ← Particles, animated route paths
    objects/
      system-object.ts      ← Single system: circle + glow + label + badges
      region-object.ts      ← Single region: boundary + label + badges
      connection-object.ts  ← Single connection line
    interactions.ts         ← Hit testing, click/hover handlers
    theme.ts                ← Color palette, sizes, animation constants
```

### Preserved hooks (unchanged)

- `use-map-view-state.ts` — view level, selected system, drill in/out
- `use-navigation-state.ts` — phase machine, reachable systems, route
- `map-session.ts` — session persistence

### Modified hook

- `use-map-graph.ts` → `use-map-data.ts` — Same derivation logic (ships per system, events per system, navigation states, route edges) but outputs plain data objects instead of React Flow `Node[]`/`Edge[]`. No React Flow types.

---

## 2. Camera System

Replaces React Flow's built-in pan/zoom.

### State

```typescript
interface CameraState {
  x: number;           // world-space center X
  y: number;           // world-space center Y
  zoom: number;        // scale factor (1.0 = 100%)
}
```

### Controls

- **Pan**: Click-drag on empty space, or middle-mouse drag
- **Zoom**: Scroll wheel, pinch-to-zoom on trackpad. Zoom toward cursor position.
- **Constraints**: `minZoom: 0.3`, `maxZoom: 2.0` (match current React Flow config)
- **Animated transitions**: `fitView(padding, duration)` and `setCenter(x, y, zoom, duration)` with easing

### Coordinate transforms

```typescript
worldToScreen(worldX, worldY): { x: number, y: number }
screenToWorld(screenX, screenY): { x: number, y: number }
```

These are used by:
- Hit testing (screen click → world position → which system?)
- HTML overlay positioning (world position of selected system → screen position for panel anchoring)
- Culling (only render objects within the visible viewport)

---

## 3. Visual Design — Procedural

### Background — Starfield

Multiple parallax layers of point-like stars:

| Layer | Count | Size | Opacity | Parallax factor |
|---|---|---|---|---|
| Deep | 300 | 1px | 0.15–0.3 | 0.1 (barely moves) |
| Mid | 200 | 1–2px | 0.3–0.5 | 0.3 |
| Near | 100 | 2–3px | 0.5–0.8 | 0.6 |

Stars generated once from a seeded RNG (deterministic across sessions). Optional subtle twinkle: sinusoidal alpha modulation at random phase offsets, very slow (period 3–8s). Background color: `#030712` (gray-950, matches current).

### System nodes

Each system rendered as a layered procedural object:

1. **Outer glow** — Large soft circle, additive blend, low alpha. Color derived from economy type. Radius ~40px. Creates a bloom/nebula effect around each system.
2. **Core circle** — Solid filled circle, radius ~10-14px. Color from economy type palette (brighter/saturated version of glow color).
3. **Inner highlight** — Smaller bright spot at center, near-white with economy tint. Creates a "star-like" bright core.
4. **Label** — System name, positioned below the node. `BitmapText` for performance. White, small font.
5. **Economy indicator** — Small colored text or dot below label, matching `EconomyBadge` colors.

#### Economy type color palette

Derived from existing `EconomyBadge` colors, adapted for glow rendering:

| Economy | Core color | Glow color |
|---|---|---|
| Agriculture | `#4ade80` (green-400) | `#22c55e` at 0.15 alpha |
| Industrial | `#f97316` (orange-500) | `#ea580c` at 0.15 alpha |
| Technology | `#3b82f6` (blue-500) | `#2563eb` at 0.15 alpha |
| Extraction | `#a78bfa` (violet-400) | `#7c3aed` at 0.15 alpha |
| Trade Hub | `#fbbf24` (amber-400) | `#d97706` at 0.15 alpha |
| Refinery | `#f472b6` (pink-400) | `#db2777` at 0.15 alpha |

#### State overlays

Navigation states modify the system object appearance:

| State | Visual effect |
|---|---|
| Default | Standard glow + core |
| Origin | Cyan ring (`#22d3ee`), brighter glow, scale 1.1× |
| Reachable | Subtle white ring, standard glow |
| Unreachable | Desaturated, alpha 0.3 (grayscale + fade) |
| Route hop | Sky-blue ring (`#38bdf8`), pulsing glow |
| Destination | Emerald ring (`#34d399`), brighter glow, scale 1.1× |

#### Badges

- **Ship count**: Small yellow text or indicator near the node when `shipCount > 0`
- **Gateway**: Amber dot indicator (top-right of node) when `isGateway`
- **Event indicators**: Colored dots (up to 3) positioned bottom-right, using existing event color palette
- **Player presence pulse**: Animated expanding/fading ring (cyan) when player ships are docked and not in navigation mode — replaces CSS `animate-ping`

### Connections

Lines drawn between system centers (no handle logic):

| State | Style |
|---|---|
| Default | `rgba(148, 163, 184, 0.4)`, 1.5px, dashed pattern |
| Route path | `rgba(99, 179, 237, 0.9)`, 2.5px, solid, animated particle flow |
| Dimmed (navigating) | `rgba(148, 163, 184, 0.12)`, 1px, dashed |
| Region-level | `rgba(148, 163, 184, 0.5)`, 3px, dashed |

**Fuel labels**: Small text at edge midpoint showing fuel cost. Background pill: `rgba(15, 23, 42, 0.8)` with rounded corners.

**Route animation**: Instead of React Flow's `animated: true` (CSS marching ants), use a particle stream effect — small bright dots flowing along the route path from origin to destination. More visually appealing and clearly directional.

### Region nodes (region view)

Larger objects with similar layered structure:

1. **Region boundary** — Rounded rectangle or soft polygon outline, semi-transparent fill
2. **Label** — Region name, larger font
3. **Economy badge** — Dominant economy color indicator
4. **Counts** — System count and ship count as small text
5. **Navigation overlays** — Origin/reachable/unreachable states (same approach as systems)

### Region boundaries (system view, optional enhancement)

Subtle background color or soft boundary indicating the current region's extent. Not present in current implementation but a natural visual enhancement.

---

## 4. Interaction Model

### Hit testing

Pixi.js has built-in event handling on display objects. Each system/region object is an interactive `Container` with `eventMode = 'static'` and a hit area (circle for systems, rectangle for regions).

### Click handling

Clicks are translated to the same callbacks the current `star-map.tsx` `onNodeClick` handler uses:

| View | Click target | Action |
|---|---|---|
| Region | Region node | `drillIntoRegion(regionId)` |
| System, default phase | System node | `selectSystem(system)` → opens detail panel |
| System, unit_selected | Reachable system | `selectDestination(system)` |
| System, unit_selected | Origin system | `cancel()` |
| System, unit_selected | Unreachable system | Ignored (cursor: not-allowed) |
| System, route_preview | Any | Ignored |
| Any | Empty space | Close system selection / deselect |

### Hover

- System node hover: Subtle brightness increase, cursor: pointer
- Unreachable system hover: cursor: not-allowed, no brightness change
- Empty space: cursor: grab (default), cursor: grabbing (while panning)

### Keyboard

- Escape: Cancel navigation mode / close detail panel (unchanged, handled by `star-map.tsx`)

---

## 5. Performance

### Culling

Only render objects within the visible viewport + a small margin. With 600 systems across 24 regions, and only one region visible at a time (~25 systems), this is well within Pixi.js capability. Even rendering all 600 systems at once (if needed for a zoomed-out all-systems view) is trivial for WebGL.

### Object pooling

Not needed at this scale. 25–30 system objects + edges per region view is lightweight.

### Render loop

Use Pixi.js ticker for animation (starfield twinkle, route particle flow, pulse rings). When nothing is animating and camera is static, the render loop can idle (no unnecessary redraws). The `Ticker` can be paused when the map is not visible (panel covers most of the viewport).

### Text rendering

Use `BitmapText` for system/region labels and fuel cost labels. Bitmap fonts are rendered once to a texture atlas and reused — much faster than HTML-style text rendering for many labels. Generate the font atlas on app initialization.

---

## 6. React Integration

### `pixi-map-canvas.tsx`

```typescript
interface PixiMapCanvasProps {
  mapData: MapData;                    // from use-map-data hook (replaces use-map-graph)
  viewLevel: MapViewLevel;
  selectedSystem: StarSystemInfo | null;
  navigationMode: NavigationMode;
  onSystemClick: (system: StarSystemInfo) => void;
  onRegionClick: (regionId: string) => void;
  onEmptyClick: () => void;
  fitViewTrigger: number;             // increment to trigger fitView animation
  centerTarget?: { x: number; y: number; zoom: number };  // for URL-param centering
}
```

Lifecycle:
- **Mount**: Create Pixi `Application`, attach to container div, initialize layers
- **Update**: React props changes → update Pixi display objects (positions, colors, visibility, states). Not full re-renders — surgical updates to changed objects.
- **Unmount**: Destroy Pixi application, clean up WebGL context

Use `useRef` for the Pixi app instance. Avoid putting Pixi objects in React state — they're mutable, GPU-backed resources, not serializable data.

### Data flow

```
API data (TanStack Query)
  → use-map-view-state (view level, selection)
  → use-navigation-state (phase, reachable, route)
  → use-map-data (derive display data: node states, edge states, badges)
  → PixiMapCanvas (render to WebGL)

Click events:
  PixiMapCanvas → star-map.tsx callbacks → hooks update state → re-derive data → re-render
```

---

## 7. Migration Approach

### Phase 1: Scaffolding
- Install `pixi.js` (v8) and `@pixi/react` (evaluate whether the React wrapper helps or just use imperative Pixi)
- Create `pixi-map-canvas.tsx` shell with Pixi app initialization, resize handling
- Implement camera system (pan, zoom, fitView, setCenter)
- Render starfield background layer

### Phase 2: System view
- Refactor `use-map-graph.ts` → `use-map-data.ts` (strip React Flow types, output plain data)
- Implement `system-object.ts` — procedural circle + glow + label
- Implement `connection-object.ts` — lines with fuel labels
- Implement `system-layer.ts` — manages all system objects for current region
- Implement `connection-layer.ts` — manages all connection lines
- Wire click handlers through `interactions.ts`
- Verify: system view renders, clicking opens detail panel, navigation mode works

### Phase 3: Region view
- Implement `region-object.ts` — larger node with boundary, labels, counts
- Implement `region-layer.ts` — manages region nodes and inter-region edges
- Wire region click → drill-in transition
- Verify: region ↔ system transitions work, fitView animates correctly

### Phase 4: Navigation visuals
- Implement navigation state overlays (origin/reachable/unreachable/route_hop/destination)
- Implement route path animation (particle flow along route edges)
- Implement dimming of non-route elements during navigation
- Verify: full navigation flow works (select unit → see reachable → pick destination → route preview → confirm)

### Phase 5: Polish and cleanup
- Add starfield parallax on pan
- Add pulse ring animation for player ship presence
- Add hover effects (brightness, cursor changes)
- Add transition animations for view changes (fade in/out on drill)
- Tune colors, glow intensity, animation speeds
- Remove `@xyflow/react` dependency
- Remove old `system-node.tsx`, `region-node.tsx`, `use-map-graph.ts`
- Performance test with full universe data

---

## 8. Dependencies

### New
- `pixi.js` v8 — core renderer
- Possibly `@pixi/react` — React bindings (evaluate whether imperative API is cleaner)

### Removed
- `@xyflow/react` — React Flow

### Unchanged
- All game logic hooks, services, API routes, data fetching — completely unaffected
- HTML overlay panels (`system-detail-panel.tsx`, `route-preview-panel.tsx`) — still HTML, positioned absolutely
- View state and navigation state hooks — renderer-agnostic
