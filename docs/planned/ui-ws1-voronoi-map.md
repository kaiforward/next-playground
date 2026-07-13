# WS1 — Voronoi Map Rendering & Selection ("the EU5 spine")

> **Status:** Planned (design). The detailed design for WS1 of the [UI overhaul](./ui-overhaul.md). The
> interaction model is modelled on EU5, adapted to our two-tier (region / faction) galaxy. Its build plan lands
> in `docs/build-plans/` when implementation starts; the number-legibility and selection *feel* get an
> interactive HTML prototype approved before the Pixi rewrite.

## Headline

The map becomes **EU5-style**: value map-modes are read from the **number printed inside each system's Voronoi
cell**, with colour complementing rather than carrying the meaning, and everything stays **selectable at any
zoom** via the cell rather than a tiny star hitbox. Two mode families behave differently, exactly as in EU5:

- **Political mode** shows faction ownership. Zoomed in, you select individual **systems** (click → system view);
  zoomed out, cells merge into **faction shapes** and a click opens the **faction screen** — the one place a
  click selects something other than a system.
- **Value modes** (stability, population, development) paint every cell by a **relative gradient** (score 0 →
  black). With nothing selected the ramp spans the whole visible map; **click a cell and the ramp re-normalises
  to that system's faction** — so you read "which of *this faction's* worlds is highest," not how they compare to
  the galaxy. That click still opens the system view; the faction-scoping rides along.

**Numbers aggregate on zoom-out** up a three-tier hierarchy derived from data we already have —
**system → faction-within-region → whole faction** — so a sprawling empire breaks into per-region chunks instead
of collapsing to one meaningless figure. Cell *colour* stays per-system at every zoom; only the numbers coalesce.

The per-system **star dot is coloured by its star type** (replacing WS3's interim neutral slate), and the three
duplicate value-layers collapse into **one shared-geometry choropleth layer**.

## Grounding (from a code investigation — don't re-derive)

- **Per-system Voronoi cells already render.** `stability`/`population`/`development-territory-layer.ts` call
  `computeTerritoryPolygons` (`territory-utils.ts`) keyed by `system.id`, so each "territory" is already one
  system's own cell (the per-group `union()` path is a no-op for singleton groups). Region and faction layers key
  by `regionId` / `factionId` and genuinely union. So WS1 adds **numbers + per-cell hit-testing + star colour**
  on top of cells that already exist — it is not a Voronoi-from-scratch build.
- **Selection is per-star only today.** Each `SystemObject` owns an invisible `hitCircle` (radius
  `SIZES.systemHitRadius`, `system-object.ts`) → `pointerdown` → `onSystemClick` (`interactions.ts`) → resolves
  the `StarSystemInfo` → `star-map.tsx` `selectSystem` → drives the URL/panel. Territory `Graphics` are
  non-interactive, so a click off a star inside a cell falls through to the empty-click handler. **Cell-level
  hit-testing is new.**
- **Star type is not on the map atlas.** `AtlasSystem` (`lib/types/game.ts`) carries
  `id/x/y/regionId/factionId/economyType/isGateway/developed` — no `sunClass`. But `SunClass`
  (`game.ts`, 4 values) and a ready palette `SUN_CLASS_COLORS` (`lib/constants/ui.ts`, hex strings) already
  exist, and `sunClass` lives on the world system row (`lib/world/types.ts`) — it just isn't copied through
  `getAtlas()` (`lib/services/atlas.ts`). `theme.ts` explicitly flags `NEUTRAL_GLYPH` as the WS1 recolour anchor.
- **Text is the constraint.** All map text today is large world-space fonts (`TEXT_RESOLUTION = 3` fixed
  multiplier) gated to LOD bands; region-scale text and system-scale text are deliberately never shown at the
  same zoom. A `Text` object per system (hundreds) would blow past the frustum-culling budget
  (`MAX_CREATES_PER_FRAME` in `system-layer.ts`). The **number-aggregation model is what makes numbers
  tractable** — see below.
- **Data flows in two cadences to preserve.** Static atlas (`useAtlas`, `staleTime: Infinity` — geometry +
  `regionId`/`factionId`) drives the one-time Voronoi build; tick-scoped `Map<systemId, number>` per mode
  (`use-stability`/`-population`/`-development`, `staleTime: 10_000`, `enabled: active`) drives fills without
  recomputing geometry. Fog-of-war is applied in `star-map.tsx` before data reaches Pixi. WS1 keeps this split.
- **Tech-debt WS1 should resolve as it goes:** the three value-layers are near-identical (~90 lines each) and
  each rebuilds its own Delaunay/Voronoi from the same point set — five triangulations per atlas change. WS1
  computes the Voronoi **once** and hands cells to one generic value-choropleth layer parameterised by a colour
  function. `pixi-map-canvas.tsx` (~440 lines, 10 hand-wired layers) and `system-object.ts` (~440 lines,
  per-frame `setLOD` fast-path) are large and perf-sensitive — touch with care, don't add per-frame branching
  without a fast-path guard.

## Interaction model

### Selection — one rule, one exception

- **Default, every mode, any zoom:** click a cell → **select the system + open the system view.** (WS4 later
  offsets that panel so the map stays visible alongside it, EU5-style — out of scope here, but WS1's selection
  feeds it.)
- **Value modes additionally:** the same click **toggles the gradient scope** to the selected system's faction
  (see below). Empty-click clears selection → gradient returns to global.
- **The one exception — political mode zoomed out:** cells merge into faction shapes; individual cells are not
  separately selectable (unless a faction is a single system), so a click selects the **faction → faction
  screen.** Zoom back in and political mode returns to per-cell system selection.

So: *system-select is universal; faction-select is the single exception (political mode, zoomed out).* Selection
granularity is therefore **zoom-dependent in political mode** (system when in, faction when out) and **always
per-cell in value modes**.

### Value modes — relative, faction-scopable gradients

- Every cell is coloured by its value on a ramp where **score 0 → black** (so low, similar values stay
  distinguishable). Colour **complements** the number rather than carrying the meaning.
- **The ramp is relative, and clicking chooses what it's relative to:**
  - **Nothing selected** → normalised across **all visible systems** (global): the galaxy's top value is the top
    of the ramp.
  - **A system selected** → normalised across **only that system's faction's** systems. Other factions' cells are
    de-emphasised (dimmed) so the selected faction's intra-faction variation reads. The faction panel opens
    alongside the system view.
- **The reference is mode-appropriate.** population → **max actual population** in the scope; development →
  the scope's **highest development *potential*** (the ceiling — a system's habitable-space / slot-cap, distinct
  from current development); stability → analogous. Each relative mode picks its own top-of-ramp.
- Faction-scoping and system-selection are driven by the **same persistent "selected system"** state (its
  `factionId` gives the scope) — not a separate selection channel.

### Numbers — three-tier zoom aggregation

Colour is always per-cell; **numbers coalesce upward** as you zoom out / as screen space per group shrinks:

1. **System** (per-cell) — zoomed in, each cell shows its own value.
2. **Faction-within-region** — the group of systems sharing **both** a `factionId` and a `regionId`. A faction
   across 3 regions shows 3 numbers; a region shared by 2 factions shows 2. This is the missing mid-tier,
   **derived from existing data** — no stored "sector" needed.
3. **Whole faction** — zoomed furthest out.

At each zoom the map shows the **finest tier whose group is large enough on-screen to hold a legible number**,
coalescing to the next tier up otherwise. The aggregate value is **mode-appropriate**: population → **sum** of
the group; stability/development → **average** across the group.

> The `(faction, region)` group is effectively a **lightweight, derived "sector."** When the war / space-casus-
> belli system later wants real, stored sub-region granularity, it can formalise what the map already
> visualises. Bookmarked there — **not built in WS1.**

## Rendering architecture

- **Compute the Voronoi once.** Build the Delaunay/Voronoi from the system point set a single time (in
  `pixi-map-canvas` or a shared geometry cache) and hand per-system cells to every layer, replacing the five
  independent triangulations. Cells are keyed `Map<systemId, MultiPolygon>` (already produced by
  `computeTerritoryPolygons` keyed by id).
- **One generic value-choropleth layer.** Fold `stability`/`population`/`development-territory-layer.ts` into a
  single layer parameterised by (value map, colour-ramp function, aggregation function). It draws per-cell fills
  from the shared geometry and hosts the number sublayer.
- **Per-cell hit-testing.** Add cell-level selection by **point-in-polygon against the cached cell polygons**
  (cheaper and simpler than hundreds of interactive `Graphics`), routed through the existing pointer handler in
  `pixi-map-canvas`/`interactions.ts` so it reuses `onSystemClick`/`onEmptyClick` and the current selection →
  URL flow. Political mode zoomed out hit-tests against the **faction-union** polygons for faction selection.
- **Number sublayer.** Render aggregated numbers as pooled `Text` objects placed at each active group's
  **centroid** (mean of member system positions — already computed for region/faction labels; the site point is
  a cheap per-system fallback). Pool and reuse `Text` objects across zoom rather than one-per-system always-on;
  gate creation to the visible frustum and the active aggregation tier.
- **Star-type dot** (`[Sys 4]`). Thread `sunClass` through `getAtlas()` → `AtlasSystem` →
  `SystemNodeData`/`mergedSystems`, and colour the system dot via the existing `SUN_CLASS_COLORS` palette
  (converted to Pixi `0xRRGGBB`), rendered as a **small star dot with a radial gradient** (core → darker edge),
  replacing `NEUTRAL_GLYPH`. The point-cloud (far-zoom) dots take the same star-type tint. **Mode interaction:**
  star-type colour carries the dot in **political / none** modes; in **value modes** the *cell* carries the
  value gradient and the dot renders subdued so it doesn't fight the value read. Also fold in `[Sys 4]`'s hover
  style and a **larger transparent selection hit-zone**, and `[Map 5]` (icons-not-refreshing) as part of the
  rebuild.
- **Political + value coexistence** (`[Map 3]`): show the individual per-system cells *and* a bolder faction
  outline together in the relevant modes — the faction-union polygon rendered as an outline over the per-cell
  fills.

## Scope

**In WS1:** the Voronoi-cell value rendering with score-0→black, per-cell numbers + system→faction-within-region
→faction aggregation, per-cell (and zoomed-out faction) hit-testing/selection, faction-scoped relative gradients,
the star-type dot + hover + hit-zone, the icons-refresh fix, and the three-layers→one-layer consolidation.

**Explicitly deferred:**
- **Stored "sectors"** → the war / casus-belli system (the derived `(faction,region)` group serves the map now).
- **A true "control" mode** (occupation %) → arrives with the war system; slots into this same value-mode
  framework. WS1's value modes are stability / population / development.
- **Panel offset / gamified layout** (`[Sys 8]`) → WS4.
- **New modes** (migration, price, logistics) → WS2, which builds on this mode framework.

## Open questions — settle in the prototype / at build time

- **Number-tier thresholds:** the exact "is there space for this number" test and the zoom bands where tiers
  swap. Tune interactively in the prototype.
- **Development potential source:** the dev mode's relative reference is development *potential* (ceiling), a
  quantity the current dev map (0–1 current development) doesn't carry. Confirm where it comes from (habitable-
  space / slot-cap) and how it reaches the map, or fall back to current-dev max as the v1 reference.
- **De-emphasis treatment** when a faction is scoped: how non-scope cells read (dim / desaturate / hide) —
  a prototype call.
- **Star dot gradient** rendering approach in Pixi v8 (radial gradient fill vs. core+glow layering) — prototype.
- **`(faction, region)` group contiguity:** a faction with two separate pockets in one region yields a
  non-contiguous group; centroid placement is usually fine but the edge case gets a prototype check.

## Build slices (indicative — detailed plan comes from the build-plan step)

1. **Cell/number/selection spine:** shared-geometry Voronoi + one value-choropleth layer (score-0→black),
   per-cell hit-testing wired to the existing selection flow, and the three-tier number aggregation. *This is the
   prototype's subject.*
2. **Faction-scoped gradients + political/value coexistence:** relative re-normalisation on faction selection,
   faction-union outline over per-cell fills, political-mode zoomed-out faction selection.
3. **Star-type dot:** `sunClass` atlas plumbing, `SUN_CLASS_COLORS` → Pixi dot with gradient, hover + hit-zone,
   icons-refresh fix.
