# Map Rendering & Selection

The map's visual language and interaction model — how the galaxy is drawn, coloured, numbered, and clicked.
Companion to [map-data-loading](./map-data-loading.md), which covers how the data reaches the client; this doc
covers what is done with it once it arrives.

## Headline

The map is **EU5-style**: value map-modes are read from the **number printed inside each system's Voronoi cell**,
with colour complementing rather than carrying the meaning, and everything stays **selectable at any zoom** via
the cell rather than a tiny star hitbox. Each system's dot is coloured by its **star type**. Three value modes
(stability / population / development) share one relative-gradient choropleth; two structural modes (political /
regions) and a plain "none" round out the toggle, and two additive overlays (price, logistics) sit on top of any
mode.

## Map modes

A single mode toggle (`MapMode` in `lib/types/map.ts`) selects what the territory layer paints:

- **Political** — faction ownership. Zoomed in, cells are per-system; zoomed out they merge into faction shapes.
- **Regions** — transparent fills with uniform neutral-slate borders (`0x64748b`). `regionId` is sim-load-bearing
  (region-targeted event modifiers, relations, derivations); only its colouring is neutral.
- **Stability / Population / Development** — the three **value modes**, rendered by the shared value-choropleth
  layer (below). `isValueMode()` gates the value-mode-only behaviours (cell numbers, faction re-scaling).
- **None** — no territory fill.

Two **overlays** are additive and sit on top of whichever mode is active:

- **Price** — a per-system **pill** at the top-right of each glyph carrying the buy/sell deal-quality tint for a
  picked good (green ↔ red ramp), with a buy/sell perspective sub-toggle. It is a pill, not an ambient halo.
- **Logistics** — directed faction hauls drawn as curved convoy arcs with travelling particles.

## Value modes — relative, faction-scopable gradients

Every cell in a value mode is coloured on a **relative** ramp normalised to a reference max, so the read is
"which of these is highest," not an absolute scale. Colour complements the printed number rather than carrying the
meaning. Ramp semantics (`components/map/pixi/value-ramp.ts`):

- **Absent → black** (`0x08090c`). Absence is decided by the *consumer*: a cell missing from the value map (an
  undeveloped system with no live value) draws black. Population and development additionally reserve black for a
  literal **0** (0 people / nothing built). Stability does **not** — every present system has a stability, and 0
  (maximal unrest) rides the red floor.
- **Per-mode hues.** Population is the classic **red → amber → green** heat ramp (green = most). Stability runs
  **red (unstable) → teal → cyan (calm)** — it is shown as stability (`1 − unrest`), gated on the live `developed`
  flag so undeveloped space reads black. Development rides a **grey floor → warm copper** hue.
- **Development value = raw "development points"**, not a fraction. A map-only pure score
  (`lib/engine/development-points.ts`) sums a population term (people, skilled people weighted more) and a
  **staffed**-industry term (per staffed production level: tier-0 = 1, tier-1 = 2, tier-2 = 4; each
  specialisation complex = 20), so idle shells score ~0. This is distinct from the build planner's
  `systemDevelopment` (measured against potential) — that stays untouched; the map colours its own raw magnitude
  ÷ the scope max, symmetric with population. All point weights are calibration knobs.

The **legend renders from the same ramp source** (`rampCssStops`), so a swatch can never drift from the cell fill.

## Faction focus — zoom-gated re-scaling

The value ramp normalises to a **scope**, and the scope is the pathname — there is no separate focus state:

- **Nothing focused** (`/`) → the ramp spans **all visible systems** (global): the galaxy's top value is the top
  of the ramp.
- **A faction focused** (`/factions/[id]`) → population and development **re-normalise to that faction's members**
  (its worlds span the full ramp), and out-of-scope cells are **de-emphasised** — desaturated *and* dimmed
  ("both", the default treatment). Stability never re-scales (its `1 − unrest` scale is absolute), but its
  non-focused factions still de-emphasise for visual consistency.

The re-scale is **zoom-gated for free**: you can only reach `/factions/[id]` via a zoomed-out faction click, so
close work (zoomed in, selecting systems) never rescales the map underfoot. A **faction-union outline** is stroked
over the value fills (reusing the political layer's cached unions — no new triangulation) so faction borders stay
legible while a value mode paints the interior. `RESCALES_TO_SCOPE` marks the modes that re-normalise (population,
development); a "hide" de-emphasis treatment is kept as a future user-preference toggle, not built.

## Numbers — three-tier zoom aggregation

Colour is always per-cell; **numbers coalesce upward** as you zoom out (`number-aggregation.ts`):

1. **System** (per-cell) — zoomed in, each cell shows its own value.
2. **Faction-within-region** — systems sharing **both** a `factionId` and a `regionId`. A faction across 3 regions
   shows 3 numbers; a region split between 2 factions shows 2. This mid-tier is **derived from existing data** — no
   stored "sector".
3. **Whole faction** — furthest out.

`pickTier(zoom)` selects the finest tier for the current zoom; the aggregate is **mode-appropriate** —
population → **sum**, stability / development → **average**. Numbers are pooled `Text` objects placed at each
group's centroid, **frustum-gated** and **greedy-collision-avoided** (highest-value groups placed first, a label
skipped if its screen rect overlaps a placed one). Placement re-runs only when the tier or frustum meaningfully
changes, not every frame.

> The `(faction, region)` group is a **lightweight, derived "sector."** When the war / casus-belli system later
> wants real, stored sub-region granularity, it can formalise what the map already visualises.

## Selection

- **Every mode, any zoom:** click a Voronoi cell → open `/system/[id]`. Selection is analytic — a Voronoi cell is
  the set of points nearest its site, so `delaunay.find(x, y)` resolves the cell under the cursor in O(log n)
  (`voronoi-cache.ts`), routed through the existing pointer flow. The star's own hitbox still works when zoomed
  in; the cell hit-test catches clicks that miss it.
- **The one exception — zoomed out:** a faction click routes to `/factions/[id]`, opening the faction panel and
  re-scaling the value gradient (above).
- **Selection ≠ camera.** A generic `?focus=<x>,<y>[,<zoom>]` param recentres the camera on any world coordinate
  (a system, later a fleet or event); `?systemId=<id>` is a convenience that resolves a system to its
  coordinates. A focus link never opens the panel, and a click (which routes to `/system/[id]`) never recentres —
  the two channels are independent.

## Star-type dots

The per-system dot is coloured by its **star type** (`sunClass`), threaded through the atlas
(`getAtlas()` → `AtlasSystem` → `SystemNodeData`) and mapped to Pixi colours via `SUN_CLASS_COLORS_PIXI`
(`theme.ts`). The dot is a small disc with a **radial-gradient bloom** — a soft same-hue under-disc (a shared
canvas-texture sprite, `glow-texture.ts`), not a hard ring. In **value modes** the *cell* carries the value
gradient and the dot is **subdued** (bloom alpha dropped) so it doesn't fight the value read; in political / none
modes the star-type colour carries the dot. Star colouring is **zoomed-in only** (`SystemObject`); the far-zoom
point cloud stays neutral slate.

## Rendering architecture

- **Compute the Voronoi once.** `buildSystemCells(systems, mapSize)` builds one Delaunay/Voronoi from the system
  point set and hands per-system cells (`Map<systemId, MultiPolygon>`) + centroids + analytic hit-testing to every
  consumer, replacing what used to be independent triangulations per value layer.
- **One generic value-choropleth layer.** `ValueChoroplethLayer` is parameterised by (value map, reference map,
  mode); it draws per-cell fills, hosts the pooled number sublayer, applies scope re-normalisation + de-emphasis,
  and strokes the faction-union outline. It replaced three near-identical stability/population/development layers.
- **Perf guardrails.** `pixi-map-canvas.tsx` and `objects/system-object.ts` are large and perf-sensitive: object
  *creation* is frustum-gated (not just visibility), number `Text` is pooled rather than one-always-on-per-system,
  and per-frame work is guarded by cheap dirty/zoom-band checks. See the map gotchas in `CLAUDE.md`.

## Deferred / bookmarked

- **Stored "sectors"** → the war / casus-belli system (the derived `(faction, region)` group serves the map now).
- **A true "control" mode** (occupation %) → arrives with the war system; slots into this same value-mode
  framework.
- **Price as a first-class map mode, migration mode, logistics-as-mode** → the next map-modes workstream (WS2 in
  [ui-overhaul.md](../../planned/ui-overhaul.md)), which builds on this mode framework. Price is an overlay pill
  today.
- **Panel offset / gamified layout** → the system-detail workstream (WS4).
