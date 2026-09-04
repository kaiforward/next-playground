# Map Rendering & Selection

The map's visual language and interaction model — how the galaxy is drawn, coloured, numbered, and clicked.
Companion to [map-data-loading](./map-data-loading.md), which covers how the data reaches the client; this doc
covers what is done with it once it arrives.

## Headline

The map is **EU5-style**: the **magnitude** value modes (population / development / stability) are read from the
**number printed inside each system's Voronoi cell**, with colour complementing rather than carrying the meaning;
**migration** and **provision** are colour-only heatmaps (no natural printed unit — provision's own number lives on
the per-system panel, not the map). Everything stays **selectable at any zoom** via the cell rather than a tiny
star hitbox. Each system's dot is coloured by its **star type**. Five value modes (stability / population /
development / migration / provision) share one choropleth; two structural modes (political / regions) and a plain
"none" round out the toggle, and a single additive **logistics** overlay sits on top of any mode.

## Map modes

A single mode toggle (`MapMode` in `lib/types/map.ts`) selects what the territory layer paints:

- **Political** — faction ownership. Zoomed in, cells are per-system; zoomed out they merge into faction shapes.
- **Regions** — transparent fills with uniform neutral-slate borders (`0x64748b`). `regionId` is sim-load-bearing
  (region-targeted event modifiers, relations, derivations); only its colouring is neutral.
- **Stability / Population / Development / Migration / Provision** — the **value modes**, rendered by the shared
  value-choropleth layer (below). `isValueMapMode()` gates the value-mode-only behaviours (cell numbers, faction
  re-scaling). **Migration** is the per-system **attractiveness** heatmap (reuses `migrationAttractiveness`) —
  colour-only (a `SHOWS_NUMBERS` gate suppresses cell numbers) and **developed-gated** (undeveloped = absent =
  black); it re-scales to a focused faction's worlds like population/development. **Provision** is the per-system
  **Provisioned** heatmap (reuses the persisted `StarSystem.provision` via `getProvisionBySystem`, with
  `.supplyBand` consulted only as the assessment gate, never shipped) —
  also colour-only and gated on assessment (never-assessed = absent = black), but unlike every other value mode it
  is **stepped, not continuous**, and never re-scales to a focused faction (see below).
- **None** — no territory fill.

One **overlay** is additive and sits on top of whichever mode is active:

- **Logistics** — directed faction hauls drawn as travelling particles over the lane network itself
  (below), never a chord arcing between a haul's origin and destination.

## Value modes — relative, faction-scopable gradients

Every cell in a value mode **except provision** is coloured on a **relative** ramp normalised to a reference max, so
the read is "which of these is highest," not an absolute scale. Colour complements the printed number rather than
carrying the meaning. **Provision is the one absolute, stepped exception** — see its own subsection below. Ramp
semantics (`components/map/pixi/value-ramp.ts`):

- **Absent → black** (`0x08090c`). Absence is decided by the *consumer*: a cell missing from the value map (an
  undeveloped system with no live value) draws black. Population and development additionally reserve black for a
  literal **0** (0 people / nothing built). Stability does **not** — every present system has a stability, and 0
  (maximal unrest) rides the red floor.
- **Per-mode hues.** Population and migration both run a **two-pole red → green** heat ramp (green = most /
  most-attractive; the amber midpoint was dropped so the value-quality modes share one colour language). Population
  keeps literal-**0 = black**; migration does **not** reserve black for 0 (a developed system always has a real
  attractiveness — black means only undeveloped/absent). Stability runs **red (unstable) → teal → cyan (calm)** — it
  is shown as stability (`1 − unrest`), gated on the live `developed` flag so undeveloped space reads black.
  Development rides a **grey floor → warm copper** hue.
- **Development value = raw "development points"**, not a fraction. A map-only pure score
  (`lib/engine/development-points.ts`) sums a population term (people, skilled people weighted more) and a
  **staffed**-industry term (per staffed production level: tier-0 = 1, tier-1 = 2, tier-2 = 4; each
  specialisation complex = 20), so idle shells score ~0. This is distinct from the build planner's
  `systemDevelopment` (measured against potential) — that stays untouched; the map colours its own raw magnitude
  ÷ the scope max, symmetric with population. All point weights are calibration knobs.

The **legend renders from the same ramp source** (`rampCssStops`), so a swatch can never drift from the cell fill.

### Provision — stepped, absolute, never re-scaled

Provision breaks the pattern above on purpose, because its band edges (`SUPPLIED_PROVISION`, `RATIONING_PROVISION`,
`DEPRIVED_PROVISION` — the same three the Population-tab band chip classifies on) are **fixed percentages of the
civilian basket**, not relative magnitudes:

- **Stepped, not interpolated.** `valueRampColorPixi` samples a flat 4-band lookup (deep maroon below
  `DEPRIVED_PROVISION`, red the Rationing band, amber the Strained band, green at/above `SUPPLIED_PROVISION`)
  instead of blending between stops — a mature galaxy sits mostly at ~92-96% Supplied, so a continuous ramp would
  paint almost everything one colour. Every value inside a band renders identically. Famine (the survival
  punch-through) owns no span of this axis — it's a separate signal, carried on the per-system read
  (`SystemProvisionRead.band`) and not on the map payload at all, so the map shows the Provision axis only. The map's four steps are one heat scale in its own hues; the band chip's five tones are the badge
  palette's. The two surfaces must agree on how many states exist, not on which hue each wears.
- **Absolute — `referenceMax` is ignored.** Every other value mode normalises to a reference max (global or
  faction-scoped); provision does not, because re-scaling would slide its colours out from under the fixed band
  edges. `RESCALES_TO_SCOPE.provision` is `false` for the same reason stability's is, but provision's invariance is
  additionally enforced inside `valueRampColorPixi` itself, which never reads `referenceMax` for this mode.
- **Legend carries stop positions.** `rampCssStops` (used by every continuous mode's legend) discards stop
  positions, which is lossless only while a ramp's stops are evenly spaced — provision's aren't. Its legend instead
  reads `provisionLegendStops()`, which returns `{ position, css }` pairs so the legend's boundaries land at the
  real band edges rather than even thirds.
- **Colour-only** (`SHOWS_NUMBERS.provision = false`), same as migration — the per-system Provisioned percentage
  lives on the Population tab, not the map.

## Faction focus — zoom-gated re-scaling

The value ramp normalises to a **scope**, and the scope is the pathname — there is no separate focus state:

- **Nothing focused** (`/`) → the ramp spans **all visible systems** (global): the galaxy's top value is the top
  of the ramp.
- **A faction focused** (`/factions/[id]`) → population, development and migration **re-normalise to that
  faction's members** (its worlds span the full ramp), and out-of-scope cells are **de-emphasised** — desaturated
  *and* dimmed ("both", the default treatment). Stability and provision never re-scale — stability's `1 − unrest`
  scale is absolute, and provision's band edges are fixed percentages that would slide out from under the colours
  if rescaled — but their non-focused factions still de-emphasise for visual consistency.

The re-scale is **zoom-gated for free**: you can only reach `/factions/[id]` via a zoomed-out faction click, so
close work (zoomed in, selecting systems) never rescales the map underfoot. A **faction-union outline** is stroked
over the value fills (reusing the political layer's cached unions — no new triangulation) so faction borders stay
legible while a value mode paints the interior. `RESCALES_TO_SCOPE` marks the modes that re-normalise (population,
development, migration); a "hide" de-emphasis treatment is kept as a future user-preference toggle, not built.

## Numbers — three-tier zoom aggregation

Colour is always per-cell; **numbers coalesce upward** as you zoom out (`number-aggregation.ts`):

1. **System** (per-cell) — zoomed in, each cell shows its own value.
2. **Faction-within-region** — systems sharing **both** a `factionId` and a `regionId`. A faction across 3 regions
   shows 3 numbers; a region split between 2 factions shows 2. This mid-tier is **derived from existing data** — no
   stored "sector".
3. **Whole faction** — furthest out.

`pickTier(zoom)` selects the finest tier for the current zoom; the aggregate is **mode-appropriate** —
**extensive** magnitudes (population, development points) → **sum**, so a faction spreading into new systems
*adds* rather than dilutes; **intensive** stability (`1 − unrest`) → a **population-weighted mean**, so a
populous stable core dominates and a tiny outpost can't drag the number down (`weightedMean`, shared with the
faction Overview roll-up). Absent-value members (undeveloped, no value) are skipped, never counted as a
dragging 0. Numbers are pooled `Text` objects placed at each
group's centroid, **frustum-gated** and **greedy-collision-avoided** (highest-value groups placed first, a label
skipped if its screen rect overlaps a placed one). Placement re-runs only when the tier or frustum meaningfully
changes, not every frame.

> The `(faction, region)` group is a **lightweight, derived "sector."** When the war / casus-belli system later
> wants real, stored sub-region granularity, it can formalise what the map already visualises.

## Selection

- **Every mode, any zoom:** click a Voronoi cell → open `/system/[id]`. Selection is analytic — a Voronoi cell is
  the set of points nearest its site, so `delaunay.find(x, y)` resolves the cell under the cursor in O(log n)
  (`voronoi-cache.ts`), routed through the existing pointer flow. Selection resolves on pointer-**up** and only
  when the pointer barely moved (< `CAMERA.clickDragThreshold`), so a quick click selects while a drag pans the
  camera instead (see Navigation).
- **A lane click** (within `LANE_HIT_TOLERANCE_PX` screen pixels of its segment) opens `/lane/[key]` instead — see "Selection
  precedence" below for exactly where this sits relative to the faction/system/cell checks.
- **The one exception — zoomed out:** a faction click routes to `/factions/[id]`, opening the faction panel and
  re-scaling the value gradient (above).
- **Selection ≠ camera.** A generic `?focus=<x>,<y>[,<zoom>]` param recentres the camera on any world coordinate
  (a system, later a fleet or event); `?systemId=<id>` is a convenience that resolves a system to its
  coordinates. A focus link never opens the panel, and a click (which routes to `/system/[id]`) never recentres —
  the two channels are independent.

## Navigation

Panning and zoom are camera-level (`camera.ts`), independent of selection:

- **Mouse drag** pans; the **wheel** zooms toward the cursor. Because selection only fires on a barely-moved
  pointer-up, a drag never also selects.
- **Keyboard pan** — WASD **and** arrow keys, held for continuous panning (diagonals via two keys) at a constant
  **screen-space** speed so it feels identical at every zoom; **Shift** applies a 2× boost. Listeners are
  window-level (no need to click the canvas first) but stand down while a text field is focused, and a keypress
  cancels any in-flight camera glide. All folded into the camera's existing per-frame `update()`.

## Star-type dots

The per-system dot is coloured by its **star type** (`sunClass`), threaded through the atlas
(`getAtlas()` → `AtlasSystem` → `SystemNodeData`) and mapped to Pixi colours via `SUN_CLASS_COLORS_PIXI`
(`theme.ts`). The dot is a small disc with a **radial-gradient bloom** — a soft same-hue under-disc (a shared
canvas-texture sprite, `glow-texture.ts`), not a hard ring. In **value modes** the *cell* carries the value
gradient and the dot is **subdued** (bloom alpha dropped) so it doesn't fight the value read; in political / none
modes the star-type colour carries the dot. Star colouring is **zoomed-in only** (`SystemObject`); the far-zoom
point cloud stays neutral slate.

**Settlement marks** — a square badge at the star's north-east shoulder shows the **player's** systems' control
tier in every mode: hollow slate = claimed (`controlled`), hollow amber with a soft pulse expanding from its
centre = colony forming (an open colony-establish project), solid copper = `developed`. Data rides the same
tick-scoped ownership payload the political layer reads (`OwnershipEntry.forming`); the mark decision is the pure
`settlementMarkFor` (`lib/types/map.ts`) — widening marks beyond the player's faction is a change to that one
gate. Geometry and colours live in `SETTLEMENT_MARK` (`theme.ts`); the pulse clock is shared per layer so every
forming colony pulses in phase, and marks subdue with the dot under value modes. Like all star-glyph detail the
marks are zoomed-in only — the point cloud stays status-blind.

## Lane layer

Every generated jump lane (`WorldLane`, docs/planned/logistics-lanes.md §1) draws as a segment
between its two systems, styled by `laneStyle` (`components/map/pixi/objects/lane-style.ts`) from
four inputs — no separate chord overlay:

- **Fuel-cost tier** (`ordinary`/`notable`/`major`, unchanged from the map-generation pass) sets the
  base line weight/alpha and, for a `major` (crossing-priced) lane, a wide soft glow underlay behind
  a crisp core line.
- **Invested level** (`WorldLane.level`) widens the line further on top of its tier's base width — a
  heavier corridor reads thicker regardless of how it was priced.
- **Load** (`bookedLoad ÷ capacity`) colours the line: grey at ~0 booked load, warming toward amber
  as load approaches capacity.
- **Blocked** (`blockedVolume > 0` this run) overrides the colour to red — congestion that turned
  volume away, i.e. "invest here." Red is never a "nearly full" reading; a lane can sit at high load
  and stay amber all the way to capacity.

The selected lane (the open `/lane/:key` route) gets an additional copper highlight, read from the
router the same way the selected system's cell is.

**The logistics overlay's particles ride the lane network, not a chord.** `getTradeFlowEdges`
(`lib/services/trade-flow.ts`) reads the scheduled-freight ledger's `routeEdges`
(`WorldPendingArrival`) and produces one `TradeFlowEdgeInfo` per lane per direction currently
carrying volume — a haul crossing three lanes lights up three edges, not one arc between its origin
and destination. `TradeFlowLayer`'s particle machinery (unchanged) is fed these edges and travels
each lane's own straight segment; particles are dropped at the same zoomed-out tier the map's other
overlays fade at (`LODState.logisticsAlpha`). An empty ledger reads as zero edges.

## Selection precedence

Selection resolves in one stated order (`resolveMapClick`, `components/map/pixi/lane-hit-test.ts`),
tried on every stage pointer-up:

1. **Faction** — zoomed out (below `FACTION_SELECT_ZOOM`) and the point lands on a faction's
   territory union → `/factions/[id]`.
2. **System, by the star's own hover radius** (`findSystemNear`, `SIZES.systemHitRadius`) — a
   precise click on a star wins even when a lane also passes near that point.
3. **Lane, by tolerance** (`findLaneAt`, world-unit point-to-segment distance,
   `LANE_HIT_TOLERANCE_PX` screen pixels divided by the camera zoom) — a lane is a segment between two system points, which no cell-based
   hit-test shape fits, hence its own hit-test module.
4. **System, by the ordinary Voronoi cell** (`SystemCells.findSystemAt`) — a click anywhere inside a
   system's cell, at any zoom, in every mode.
5. **Empty** — clears the selection.

Selecting a lane opens its route-docked panel (`/lane/:key`); selecting a system while that panel is
open re-points to the system panel, the same navigation system-to-system already does.

## Rendering architecture

- **Compute the Voronoi once.** `buildSystemCells(systems, mapSize)` builds the map's only Delaunay/Voronoi from
  the system point set, clips every cell once, and hands the result to every consumer: per-system cells
  (`Map<systemId, MultiPolygon>`), centroids, analytic hit-testing, and `groupBy(key)`. The region and political
  layers union their territories out of those cached cells rather than triangulating for themselves — a layer that
  builds its own is the regression, since the per-cell disc clip, not the triangulation, is where the cost sits.
- **One generic value-choropleth layer.** `ValueChoroplethLayer` is parameterised by (value map, reference map,
  mode); it draws per-cell fills, hosts the pooled number sublayer, applies scope re-normalisation + de-emphasis,
  and strokes the faction-union outline. It replaced three near-identical stability/population/development layers.
- **Perf guardrails.** `pixi-map-canvas.tsx` and `objects/system-object.ts` are large and perf-sensitive: object
  *creation* is frustum-gated (not just visibility), number `Text` is pooled rather than one-always-on-per-system,
  and per-frame work is guarded by cheap dirty/zoom-band checks.

## Gotchas

Non-obvious traps on this surface. Read before touching the map or any WebGL code.

- Map extent comes from the atlas (`meta.mapSize`), never an env — pass it explicitly to `systemToTile` /
  `tileBounds` / `frustumToTiles`.
- Pixi rasterizes small text and sharp corners as aliased mush, so map markers use rounded corners plus
  zoom-gated text — a deliberate departure from Foundry's no-rounding rule, which is HTML-only.
- Throttle (leading+trailing), not debounce, for Pixi-ticker → `setState`. Debounce never fires during a
  continuous zoom.
- Frustum-gate object *creation*, not just visibility — `SystemObject` is expensive; create only in-frustum,
  batched per frame.
- `frustumToTiles` max col/row uses `ceil(max / TILE_SIZE) - 1` (half-open, matching `systemToTile`).
- Keep tick-scoped data on tick-keyed queries, never viewport-keyed — viewport keys cause flicker and redundant
  calls on every pan.
- Native `<dialog>` modal: never `m-0` / `inset-auto`, which breaks `showModal()` UA centering.

## Deferred / bookmarked

- **Stored "sectors"** → the war / casus-belli system (the derived `(faction, region)` group serves the map now).
- **A true "control" mode** (occupation %) → arrives with the war system; slots into this same value-mode
  framework.
- **Migration mode** shipped in the map-modes workstream (WS2 P1) as the attractiveness heatmap above. A **price**
  map mode was built then **cut as premature** for the current grand-strategy form (the buy/sell deal-quality
  framing is a trader hangover) — its price pill + overlay are removed too; market data lives on the per-system
  Market panel. **Migration movement arrows + logistics-as-mode** are the deferred **WS2 P2** flow-viz pass
  ([ui-ws2-map-modes.md](../../planned/ui-ws2-map-modes.md)).
- **Panel offset / gamified layout** → the system-detail workstream (WS4).
