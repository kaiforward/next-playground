 UI Overhaul — Workstream B: Map Renderer (Pixi.js Migration)

 Replace the React Flow-based star map with a custom Pixi.js v8 (WebGL) renderer.
 Procedural visuals — no external image assets. Replicates all current map
 functionality with enhanced visual quality.

 Design spec: ../../../docs/design/planned/map-renderer.md

 ---
 Context

 Workstream A (map-centric UI) is merged. The star map is now always visible at /,
 with all game pages rendering as overlay panels via parallel routes. The map is the
 persistent base layer — React Flow's limitations (DOM-based nodes, no glow effects,
 basic animation) become more noticeable now that the map is always on screen.
 Swapping the renderer while the layout is fresh minimizes rework.

 What changes: The rendering layer only — React Flow → Pixi.js canvas.
 What doesn't change: Navigation state machine, pathfinding engine, view state hook,
 HTML overlay panels, session persistence, all game logic.

 ---
 New File Structure

 components/map/
   star-map.tsx              ← Rewrite: swap ReactFlow for PixiMapCanvas
   pixi/
     pixi-map-canvas.tsx     ← NEW: React wrapper — creates Pixi app, manages resize
     camera.ts               ← NEW: Pan/zoom state, world↔screen transforms
     layers/
       starfield-layer.ts    ← NEW: Background parallax stars
       region-layer.ts       ← NEW: Region boundaries and labels
       connection-layer.ts   ← NEW: System connections / edges
       system-layer.ts       ← NEW: System nodes
       effect-layer.ts       ← NEW: Route particles, pulse rings
     objects/
       system-object.ts      ← NEW: Single system — circle + glow + label + badges
       region-object.ts      ← NEW: Single region — boundary + label + counts
       connection-object.ts  ← NEW: Single connection line with fuel label
     interactions.ts         ← NEW: Hit testing, click/hover dispatch
     theme.ts                ← NEW: Color palette, sizes, animation constants
   system-node.tsx           ← DELETE (Phase 5)
   region-node.tsx           ← DELETE (Phase 5)
   system-detail-panel.tsx   ← UNCHANGED
   route-preview-panel.tsx   ← UNCHANGED
   map-session.ts            ← UNCHANGED

 lib/hooks/
   use-map-data.ts           ← NEW (replaces use-map-graph.ts)
   use-map-graph.ts          ← DELETE (Phase 5)
   use-map-view-state.ts     ← UNCHANGED
   use-navigation-state.ts   ← UNCHANGED

 ---
 1. PixiMapCanvas — React Integration Pattern

 The central pattern for Pixi-in-React. No @pixi/react — purely imperative.

 Lifecycle

 Mount:    useEffect → create Application → init() → attach canvas to container div
           → create layers in z-order → initial data sync
 Update:   useEffect(deps) → sync React data → Pixi display objects (surgical
 updates)
 Unmount:  useEffect cleanup → app.destroy(true) → cleans up WebGL context

 Props

 interface PixiMapCanvasProps {
   mapData: MapData;                       // from use-map-data (replaces
 use-map-graph)
   viewLevel: MapViewLevel;
   selectedSystem: StarSystemInfo | null;
   navigationMode: NavigationMode;
   onSystemClick: (system: StarSystemInfo) => void;
   onRegionClick: (regionId: string) => void;
   onEmptyClick: () => void;
   fitViewTrigger: number;                 // increment to trigger fitView animation
   centerTarget?: { x: number; y: number; zoom: number };
   onReady: () => void;                    // called after first render
 }

 Key rules

 - useRef for Pixi Application — never in React state
 - useRef for all layer/object references — mutable GPU resources
 - useEffect with data deps for syncing — not renders
 - Canvas element via ref={containerRef} on a plain <div>
 - Resize via ResizeObserver on the container div → app.renderer.resize()

 ---
 2. Camera System

 Replaces React Flow's built-in pan/zoom. Lives in camera.ts as a plain class (not a
 React hook).

 State

 interface CameraState {
   x: number;       // world-space center X
   y: number;       // world-space center Y
   zoom: number;    // scale factor (1.0 = 100%)
 }

 API

 - pan(dx, dy) — offset camera by screen-space delta
 - zoomAt(screenX, screenY, delta) — zoom toward cursor, clamped to [0.3, 2.0]
 - fitView(bounds, padding, duration?) — animate to fit a bounding box
 - setCenter(x, y, zoom, duration?) — animate to a specific position
 - worldToScreen(wx, wy) → { x, y } — for HTML overlay positioning
 - screenToWorld(sx, sy) → { x, y } — for hit testing
 - getTransform() → { x, y, scale } — applied to the world container each frame

 Input handling

 Bound to the Pixi canvas element:
 - Pan: pointerdown + pointermove (left button or middle button)
 - Zoom: wheel event → zoomAt(cursor, delta). Pinch-zoom via pointer events.
 - Animated transitions: RAF-based lerp with easing (ease-out cubic). Camera exposes
 update(dt) called from Pixi ticker.

 Integration with star-map.tsx

 The fitViewTrigger prop (incremented on view level change) triggers camera.fitView()
  with the current nodes' bounding box. The centerTarget prop (from
 initialSelectedSystem) triggers camera.setCenter() on mount.

 ---
 3. Theme Constants

 pixi/theme.ts — single source for all visual constants. Derived from existing
 EconomyBadge colors and current edge colors.

 Economy colors (core / glow)

 ┌─────────────┬─────────┬───────────────────┐
 │   Economy   │  Core   │ Glow (0.15 alpha) │
 ├─────────────┼─────────┼───────────────────┤
 │ agriculture │ #4ade80 │ #22c55e           │
 ├─────────────┼─────────┼───────────────────┤
 │ industrial  │ #f97316 │ #ea580c           │
 ├─────────────┼─────────┼───────────────────┤
 │ technology  │ #3b82f6 │ #2563eb           │
 ├─────────────┼─────────┼───────────────────┤
 │ extraction  │ #a78bfa │ #7c3aed           │
 ├─────────────┼─────────┼───────────────────┤
 │ trade_hub   │ #fbbf24 │ #d97706           │
 ├─────────────┼─────────┼───────────────────┤
 │ refinery    │ #f472b6 │ #db2777           │
 └─────────────┴─────────┴───────────────────┘

 Navigation state colors

 ┌─────────────┬───────────────────────┬───────────────────────────┐
 │    State    │      Ring color       │        Additional         │
 ├─────────────┼───────────────────────┼───────────────────────────┤
 │ origin      │ #22d3ee (cyan-400)    │ scale 1.1×, brighter glow │
 ├─────────────┼───────────────────────┼───────────────────────────┤
 │ reachable   │ #ffffff at 0.6 alpha  │ subtle ring               │
 ├─────────────┼───────────────────────┼───────────────────────────┤
 │ unreachable │ desaturated           │ alpha 0.3                 │
 ├─────────────┼───────────────────────┼───────────────────────────┤
 │ route_hop   │ #38bdf8 (sky-400)     │ pulsing glow              │
 ├─────────────┼───────────────────────┼───────────────────────────┤
 │ destination │ #34d399 (emerald-400) │ scale 1.1×, brighter glow │
 └─────────────┴───────────────────────┴───────────────────────────┘

 Edge colors (reuse existing constants)

 default:  rgba(148, 163, 184, 0.4), 1.5px, dashed
 dimmed:   rgba(148, 163, 184, 0.12), 1px, dashed
 route:    rgba(99, 179, 237, 0.9), 2.5px, solid
 region:   rgba(148, 163, 184, 0.5), 3px, dashed

 Sizes

 - System core radius: 12px
 - System glow radius: 40px
 - Region node: ~180px wide rounded rect
 - Label font size: 11px (systems), 14px (regions)
 - Background: #030712 (gray-950)

 ---
 4. use-map-data.ts — Refactoring use-map-graph.ts

 Same derivation logic, different output shape. Strips all Node<T>[] / Edge[] React
 Flow types.

 What stays identical

 All the memoized derivations that compute game state:
 - activeRegionSystems — systems in current region
 - shipsAtSystem — per-system docked ship counts
 - shipsPerRegion / systemsPerRegion — per-region counts
 - shipsAtSelected / convoysAtSelected — for detail panel
 - eventsPerSystem — Map of SystemEventInfo[]
 - eventsAtSelected — for detail panel
 - regionNavigationStates — Map of origin/reachable/unreachable
 - nodeNavigationStates — Map of NavigationNodeState
 - routeEdgeSet — Set of sorted pair keys
 - selectedGatewayTargets / activeRegion / selectedRegionName — panel data

 What changes

 The final nodes and edges memos are replaced with plain data objects:

 export interface SystemNodeData {
   id: string;
   x: number;
   y: number;
   name: string;
   economyType: EconomyType;
   shipCount: number;
   isGateway: boolean;
   navigationState?: NavigationNodeState;
   activeEvents?: SystemEventInfo[];
 }

 export interface RegionNodeData {
   id: string;
   x: number;
   y: number;
   name: string;
   dominantEconomy: EconomyType;
   systemCount: number;
   shipCount: number;
   navigationState?: RegionNavigationState;
 }

 export interface ConnectionData {
   id: string;
   fromId: string;
   toId: string;
   fuelCost: number;
   isRoute: boolean;     // part of active route
   isDimmed: boolean;    // non-route during navigation
 }

 export interface MapData {
   systems: SystemNodeData[];
   regions: RegionNodeData[];
   connections: ConnectionData[];
   // Detail panel data (unchanged)
   shipsAtSelected: ShipState[];
   convoysAtSelected: ConvoyState[];
   eventsAtSelected: ActiveEvent[];
   selectedGatewayTargets: { regionId: string; regionName: string }[];
   selectedRegionName: string | undefined;
   activeRegion: RegionInfo | undefined;
   activeRegionSystems: StarSystemInfo[];
   regionNavigationStates: Map<string, "origin" | "reachable" | "unreachable">;
 }

 The hook returns MapData instead of MapGraphData. The Pixi canvas consumes systems,
 regions, and connections arrays directly — no React Flow node/edge wrapper objects.

 ---
 Phase 1: Scaffolding

 Goal

 Canvas renders with interactive camera and starfield background. No game data yet.

 Files to create

 1. components/map/pixi/theme.ts — All color constants, sizes, animation timing
 2. components/map/pixi/camera.ts — Camera class with
 pan/zoom/fitView/setCenter/transforms
 3. components/map/pixi/layers/starfield-layer.ts — Three parallax layers of point
 stars
 4. components/map/pixi/pixi-map-canvas.tsx — React wrapper component

 Implementation details

 starfield-layer.ts:
 - Class StarfieldLayer wraps a Container with 3 child containers (deep/mid/near)
 - Stars generated from seeded PRNG on init (deterministic). Each star: x, y, size,
 alpha.
 - Each layer has a parallax factor (0.1, 0.3, 0.6). On camera move, offset =
 cameraDelta × factor.
 - Stars drawn as small Graphics circles or as a single Graphics object with many
 circles (batch-friendly).
 - Optional twinkle: per-star sinusoidal alpha modulation on ticker (period 3–8s,
 random phase).
 - Background color set on app.renderer.background.color = 0x030712.

 pixi-map-canvas.tsx:
 - Creates a <div ref={containerRef}> that fills its parent
 - On mount: new Application(), await app.init({ resizeTo: container, antialias:
 true, background: 0x030712 }), append app.canvas to container
 - Creates world container (child of app.stage) — all game objects go here. Camera
 transform applied to this container.
 - Creates starfield layer (child of app.stage, NOT world container — parallax is
 separate)
 - Sets up ResizeObserver for responsive resize
 - Cleanup: app.destroy(true, { children: true })

 camera.ts:
 - Registers pointer events on the canvas element for pan (pointerdown/move/up)
 - Registers wheel event for zoom
 - update(dt) method called from Pixi ticker for animated transitions
 - Applies transform to the world container:
 worldContainer.position.set(screenCenterX - x * zoom, screenCenterY - y * zoom);
 worldContainer.scale.set(zoom)

 Verify

 - Canvas renders full-size in the map area
 - Stars visible on dark background
 - Pan and zoom work smoothly
 - fitView animates to a hardcoded bounding box
 - Resize handler works when sidebar collapses/expands

 ---
 Phase 2: System View

 Goal

 System-level map is fully functional — systems render as procedural circles with
 glows, connections draw between them, clicking opens the detail panel, all
 navigation states work.

 Files to create

 1. lib/hooks/use-map-data.ts — Refactored data hook (see section 4 above)
 2. components/map/pixi/objects/system-object.ts — Single system display object
 3. components/map/pixi/objects/connection-object.ts — Single connection line
 4. components/map/pixi/layers/system-layer.ts — Manages all system objects for a
 region
 5. components/map/pixi/layers/connection-layer.ts — Manages all connection lines
 6. components/map/pixi/interactions.ts — Click/hover dispatch

 Files to modify

 1. components/map/star-map.tsx — Replace <ReactFlow> with <PixiMapCanvas>, replace
 useMapGraph with useMapData

 Implementation details

 system-object.ts:
 - Class SystemObject extends Pixi Container
 - Children (bottom to top):
   a. Glow — Graphics circle, radius ~40px, economy glow color, alpha 0.15,
 blendMode: 'add'
   b. Core — Graphics circle, radius ~12px, economy core color, filled
   c. Highlight — Graphics circle, radius ~4px, near-white with economy tint
   d. Label — Text (system name), positioned below core, white, fontSize 11
   e. Economy label — Small Text below name label, economy type color, fontSize 9
   f. Ship count — Text "3 SHIPS", yellow-300, fontSize 9, hidden when 0
   g. Gateway indicator — Small Graphics circle (amber), top-right of core, hidden
 when not gateway
   h. Event dots — Up to 3 small Graphics circles, bottom-right, colored by event
 type priority
 - update(data: SystemNodeData) — sync all visual properties from data. Only update
 changed fields.
 - eventMode = 'static', hitArea = circle around core (radius ~20px for comfortable
 clicking)
 - Stores systemId for click handler lookup

 connection-object.ts:
 - Class ConnectionObject — Graphics line between two world positions
 - Draws a line from (x1,y1) to (x2,y2) with stroke color/width/dash from state
 - Fuel label: Text at midpoint, small font, with a dark background rect behind it
 (drawn with Graphics)
 - update(data: ConnectionData, fromPos, toPos) — redraws line and label
 - Dashed lines: Pixi v8 doesn't have native dash. Use a custom dash shader, or draw
 multiple short line segments, or use a simple approach of drawing the line solid and
  overlaying the gaps. Simplest: draw short segments with gaps in a loop.

 system-layer.ts:
 - Class SystemLayer wraps a Container
 - sync(systems: SystemNodeData[]) — diff current objects vs new data. Create new
 SystemObjects, remove stale ones, update existing ones. Use a Map<string,
 SystemObject> for O(1) lookup.
 - Returns the container to add to the world container

 connection-layer.ts:
 - Class ConnectionLayer wraps a Container
 - sync(connections: ConnectionData[], systemPositions: Map<string, {x,y}>) — same
 diff pattern
 - Map<string, ConnectionObject> keyed by connection id

 interactions.ts:
 - Receives references to system-layer and region-layer
 - On pointerdown on a SystemObject → lookup systemId → call onSystemClick(system)
 - On pointerdown on empty space (stage background) → call onEmptyClick()
 - Hover: pointerover → slight brightness increase (tint), cursor set to 'pointer'.
 pointerout → reset.
 - Unreachable systems: cursor 'not-allowed', no brightness change on hover

 star-map.tsx changes:
 - Remove all @xyflow/react imports
 - Replace useMapGraph with useMapData
 - Replace <ReactFlow> block with <PixiMapCanvas mapData={mapData} ...callbacks />
 - Keep all HTML overlays (back button, nav banner, route preview, detail panel) —
 they render as siblings of the canvas
 - The onNodeClick handler logic moves mostly into interactions.ts, but the
 high-level routing (region drill, navigation select, system select) stays in
 star-map.tsx callbacks passed as props

 Verify

 - Systems render as glowing circles with labels in system view
 - Connection lines draw between systems with fuel labels
 - Clicking a system opens the detail panel (HTML overlay)
 - Clicking empty space closes the detail panel
 - Camera pan/zoom works
 - fitView centers on the current region's systems
 - Back to Regions button works (switches to region view — will show nothing in Pixi
 until Phase 3, but the button triggers the state change)

 ---
 Phase 3: Region View

 Goal

 Region-level map renders with region nodes and inter-region connections.
 Drill-in/out transitions work with camera animation.

 Files to create

 1. components/map/pixi/objects/region-object.ts — Single region display object
 2. components/map/pixi/layers/region-layer.ts — Manages all region objects

 Implementation details

 region-object.ts:
 - Class RegionObject extends Container
 - Children:
   a. Background — Graphics rounded rectangle (~180×100px), semi-transparent fill
 (slate-800/60)
   b. Border — Graphics rounded rect stroke, slate-500 at 0.5 alpha
   c. Label — Text region name, white, fontSize 14, bold
   d. Economy label — Text economy type, colored, fontSize 10
   e. System count — Text "25 systems", text-tertiary, fontSize 10
   f. Ship count — Text "3 SHIPS", yellow, fontSize 10, hidden when 0
 - update(data: RegionNodeData) — sync visuals
 - eventMode = 'static', hitArea = rectangle matching background bounds
 - Stores regionId for click handler

 region-layer.ts:
 - Class RegionLayer wraps a Container
 - sync(regions: RegionNodeData[]) — same diff pattern as system-layer
 - Inter-region connections: drawn as part of connection-layer (the ConnectionData
 from use-map-data already includes region-level edges when in region view)

 View transition in PixiMapCanvas:
 - When viewLevel changes from region→system: hide region layer, show
 system+connection layers, animate camera fitView to new region's system bounds
 - When viewLevel changes from system→region: hide system+connection layers, show
 region layer, animate camera fitView to all regions' bounds
 - Layer visibility is simple container.visible = true/false

 Verify

 - Region view shows 24 region nodes with names, economy types, system/ship counts
 - Inter-region connections draw between regions
 - Clicking a region drills into system view with camera animation
 - "Back to Regions" button returns to region view with camera animation
 - Hard refresh at region view renders correctly

 ---
 Phase 4: Navigation Visuals

 Goal

 Full navigation flow works visually — origin/destination/reachable/unreachable state
  overlays, route path highlighting with particle animation, dimming of non-route
 elements.

 Files to create/modify

 1. components/map/pixi/layers/effect-layer.ts — Route particle animation, pulse
 rings

 Implementation details

 Navigation state overlays in system-object.ts:
 Add a navigationRing Graphics child that draws a colored ring around the core based
 on navigationState:
 - origin: cyan ring, thicker (3px), scale container to 1.1×, brighten glow alpha to
 0.3
 - reachable: white ring at 0.6 alpha, thin (1.5px)
 - unreachable: set entire container's alpha = 0.3, apply desaturation via tint (gray
  tint)
 - route_hop: sky-400 ring, 2px, pulsing glow (alpha oscillation on ticker)
 - destination: emerald ring, 3px, scale 1.1×, brighten glow

 Navigation state overlays in region-object.ts:
 Same concept — colored border stroke change:
 - origin: cyan border, ring-offset effect (draw second rect slightly larger)
 - reachable: white border at 0.6
 - unreachable: alpha 0.4, grayscale tint

 Route particle animation in effect-layer.ts:
 - Class EffectLayer wraps a Container
 - Route particles: When route edges exist, spawn small bright dots that flow along
 each route edge from origin→destination direction
 - Each particle: small Graphics circle (2px), sky-blue color, travels along the edge
  line at constant speed, wraps when reaching the end
 - ~5 particles per edge, staggered start positions
 - Uses Pixi ticker for animation. When no route, no particles (layer idle).

 Dimming in connection-layer.ts:
 Already handled by ConnectionData.isDimmed from use-map-data. Connection objects
 just read this flag and set alpha/color accordingly.

 Verify

 - Select a ship → systems highlight as origin (cyan), reachable (white ring),
 unreachable (gray/faded)
 - Click reachable system → route preview shows, route edges glow with flowing
 particles
 - Intermediate hops show sky-blue rings
 - Destination shows emerald ring
 - Non-route connections dim
 - Cancel navigation → everything returns to default
 - Region view during navigation: regions show origin/reachable/unreachable states

 ---
 Phase 5: Polish & Cleanup

 Goal

 Visual polish, performance verification, dependency removal.

 Enhancements

 1. Starfield parallax: In starfield-layer.ts, offset each layer by cameraDelta ×
 parallaxFactor on every camera update. Creates depth illusion on pan.
 2. Pulse ring for player ships: In effect-layer.ts, add an expanding/fading ring
 animation on systems where shipCount > 0 and navigation is in default mode. Ring
 expands from core radius to ~30px while fading from 0.4→0 alpha. Cyan color.
 Repeating.
 3. Hover effects: In interactions.ts, on pointerover for system objects: increase
 core brightness (tint toward white), scale up slightly (1.05×). On pointerout:
 reset. Cursor changes: 'pointer' for clickable, 'not-allowed' for unreachable,
 'grab'/'grabbing' for pan.
 4. View transition animations: On view level change, briefly fade old layer out
 (alpha 1→0 over 200ms) while fading new layer in (alpha 0→1). Combined with camera
 fitView animation.
 5. Color tuning: Adjust glow intensity, alpha values, and animation speeds based on
 visual testing.

 Cleanup — Files to delete

 - components/map/system-node.tsx
 - components/map/region-node.tsx
 - lib/hooks/use-map-graph.ts

 Dependency removal

 - npm uninstall @xyflow/react
 - Remove @xyflow/react/dist/style.css import (already gone from star-map.tsx by
 Phase 2)
 - Verify no other files import from @xyflow/react

 Performance verification

 - Load full universe (600 systems, 24 regions) — confirm smooth 60fps pan/zoom
 - Navigate through all regions — confirm no memory leaks (Pixi objects properly
 destroyed)
 - Resize window, collapse/expand sidebar — confirm responsive resize
 - Test all navigation flows end-to-end

 ---
 Verification Checklist (End-to-End)

 After all phases:

 - Navigate to / — map renders full screen with starfield, no panel
 - Region view: 24 regions visible with names, economy badges, system/ship counts
 - Click region → drills into system view with camera animation
 - System view: ~25 systems with glowing circles, economy colors, labels
 - Connection lines with fuel cost labels between systems
 - Click system → tier-1 detail panel opens (HTML overlay, right side)
 - Click "View System" → tier-2 panel opens (parallel route), map visible around
 edges
 - Close panel → returns to map-only view
 - Back to Regions button → returns to region view
 - Select ship for navigation → origin (cyan), reachable (white), unreachable (gray)
 - Click reachable destination → route preview with particle flow animation
 - Confirm navigation → API call, returns to default mode
 - Cancel → returns to default mode
 - Pan (drag) and zoom (scroll) work smoothly
 - Starfield parallax visible during pan
 - Pulse rings on systems with player ships (default mode only)
 - Hard refresh at any URL → map + correct panel renders
 - Browser back/forward across panel navigations works
 - Sidebar collapse/expand → map resizes correctly
 - No console errors, no WebGL context warnings
 - @xyflow/react fully removed from package.json