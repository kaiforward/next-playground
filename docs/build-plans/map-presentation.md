# Map presentation — build plan

## Spec

[docs/planned/map-presentation.md](../planned/map-presentation.md), approved 2026-09-05. Pure
presentation (no world state, no processor, no tick read) — `/spec-review` skipped by rule; the HTML
prototype was waived by the owner after the design discussion.

## Build plan

### Resolution — every measure the spec uses, and what produces it

| Measure (spec wording) | State | Producer |
| --- | --- | --- |
| invested level (width) | exists | `ConnectionData.level`, `lib/hooks/use-map-data.ts:47` |
| load over capacity | exists | `ConnectionData.load`, `lib/hooks/use-map-data.ts:49` (`bookedLoad / capacity`, `:164`) |
| congested (`blockedVolume > 0` this run) | exists | `ConnectionData.blocked`, `lib/hooks/use-map-data.ts:51`, `:165` |
| busy threshold | new | `LANE_BUSY_LOAD_FRACTION`, Task 1 |
| the band (fine / busy / congested) | new | `laneBand`, Task 1 |
| worst band among a system's lanes | new | `worstLaneBand` (Task 1) applied per system in Task 2 |
| investor faction of a lane | exists | `LaneStateRow.investorFactionId`, `lib/types/api.ts:50` (joined in Task 2) |
| a faction's colour | exists | `AtlasFaction.color`, `lib/types/game.ts:274`; as Pixi hex `PoliticalTerritoryLayer.getFactionColors()`, `political-territory-layer.ts:65` |
| major fuel tier | exists | `laneTier(fuelCost) === "major"`, `lib/engine/lanes.ts:86` |
| lane click tolerance | exists | `LANE_HIT_TOLERANCE_PX`, `components/map/pixi/theme.ts:63`, divided by zoom at `pixi-map-canvas.tsx:245` |
| endpoint gap the lane hit ignores | new | `LANE_HIT_END_GAP_PX`, Task 6 |
| convoy volume per lane-direction | exists | `TradeFlowEdgeInfo.totalVolume`, `lib/types/api.ts:22` — no longer drives count (Task 5) |
| particle count per band | new | `LOGISTICS_FLOW.particlesPerBand`, Task 5 |
| lanes visible / hidden by zoom | exists | `lod.systemLayerAlpha`, `lod.ts:95`, applied at `connection-layer.ts:52` |
| cell tint alpha at zoom-out | new | `lod.lanesCellAlpha`, Task 4 |
| label box (screen px) | exists | Pixi `Text.width` / `.height` at scale 1 (`system-object.ts:252-253` reads them today) |
| the system's cell polygon | exists | `SystemCells.cellsBySystemId`, `components/map/pixi/voronoi-cache.ts:13` |
| name zoom gate | exists | `lod.showSystemNames`, `lod.ts:112` |
| selected / hovered system | exists | `SystemLayer.selectedId` (`system-layer.ts:17`); hovered id resolved at `pixi-map-canvas.tsx:334` — pushed to the layer in Task 7 |
| status colours green / amber / red | exists | `theme.md` Status Colors: `#22c55e`, `#f59e0b`, `#ef4444` (`docs/active/design-system/theme.md:45-47`) |

Nothing unresolvable.

---

### Task 1 — One band definition for lane, particle and cell

Files:
- `components/map/pixi/objects/lane-band.ts` (new)
- `components/map/pixi/objects/__tests__/lane-band.test.ts` (new)
- `components/map/pixi/theme.ts` (existing; `LANE_BAND_COLOR`, `LANE_BUSY_LOAD_FRACTION`)

Interface:
- `type LaneBand = "fine" | "busy" | "congested"`; `LANE_BANDS: readonly LaneBand[]` in worst-last order.
- `laneBand(input: { load: number; blocked: boolean }): LaneBand`.
- `worstLaneBand(bands: Iterable<LaneBand>): LaneBand | null` — null for an empty input.
- `LANE_BUSY_LOAD_FRACTION: number` (theme.ts) — the busy edge on `load`; a presentation knob, default
  chosen at the smoke.
- `LANE_BAND_COLOR: Record<LaneBand, number>` (theme.ts) — the three status hexes.
- `laneBandCss(band): string` for the legend, via the existing `pixiHexToCss` (`lib/constants/good-colors.ts:42`).
- No Pixi import: `.test.ts` from node.

Proves:
- A blocked lane is congested whatever its load, including load 0.
- Load exactly at the busy fraction is busy; a hair below is fine.
- Load above 1 (unclamped input) is still busy, never congested.
- Worst-of takes congested over busy over fine regardless of order; an empty set is null, not fine.
- Vacuity: a band function that returns "fine" for everything fails the blocked and at-threshold cases.

Consumes: nothing.

### Task 2 — Map data carries the investor and the band, per lane and per system

Files:
- `lib/hooks/use-map-data.ts`
- `lib/hooks/__tests__/use-map-data.test.tsx`

Interface:
- `ConnectionData` gains `investorFactionId: string | null` (from `LaneStateRow.investorFactionId`,
  null pre-boot) and `band: LaneBand` (from `laneBand`, fine pre-boot).
- `MapData` gains `laneBandBySystem: Map<string, LaneBand>` — every system with at least one
  connection, keyed by system id, value `worstLaneBand` over its connections. A system with no
  connection is absent from the map.
- `ConnectionData.load` and `.blocked` stay (the band is derived from them; the lane card and tests
  still read them).

Proves:
- The investor id joins by `laneKey` and reads null when the lane state is missing.
- A system touching one congested lane and three fine ones reads congested; one touching only fine
  lanes reads fine; a system with no connection is absent from the map.
- A lane's band on the connection row agrees with `laneBand` of its own load/blocked.
- Vacuity: a `laneBandBySystem` built from an empty connection list is empty, and the test that
  asserts a congested system fails against it.

Consumes: Task 1.

### Task 3 — The base lane layer goes quiet

Files:
- `components/map/pixi/objects/lane-style.ts`
- `components/map/pixi/objects/__tests__/lane-style.test.ts`
- `components/map/pixi/objects/connection-object.ts`
- `components/map/pixi/objects/__tests__/connection-object.test.tsx`
- `components/map/pixi/layers/connection-layer.ts`
- `components/map/pixi/theme.ts` (`LANE_WIDTH` reshaped; `LANE_LOAD_COLOR`, `LANE_MAJOR_GLOW` deleted; `SIZES.dashLength/dashGap` stay for Task 4)

Interface:
- `laneStyle({ fuelCost, level }): { width: number; alpha: number }` — uniform base width plus
  `LANE_WIDTH.perLevel × level`, plus `LANE_WIDTH.majorExtra` when `laneTier(fuelCost) === "major"`;
  one alpha; no colour, no tier field.
- `LANE_WIDTH = { base, majorExtra, perLevel }`; `LANE_BASE_COLOR: number` (slate) in theme.ts.
- `ConnectionObject.update(data, fromX, fromY, toX, toY, state: { selected: boolean; hovered: boolean })`
  — draws one solid stroke; the copper selection underlay (`LANE_SELECTED`) unchanged; a hover
  underlay `LANE_HOVERED = { color, glowWidth, glowAlpha }` (theme.ts) drawn the same way.
- `ConnectionLayer.setHovered(laneKey: string | null)` — re-renders only the lane leaving and the lane
  entering hover; `sync(connections, systems, selectedLaneKey)` unchanged in shape.
- The redraw fingerprint covers width, selected and hovered.

Proves:
- Two lanes of different fuel tier and equal level draw the same width unless one is major.
- Width rises with level; colour is identical across load 0, load 1 and blocked.
- No dashed pass is ever stroked in the base style (an ordinary lane strokes exactly one pass when
  neither selected nor hovered).
- Hovering adds a pass and un-hovering removes it; the fingerprint changes on hover so the redraw
  is not skipped.
- Vacuity: the "same width across tiers" test fails when the old per-tier base widths are restored.

Consumes: nothing (independent of Tasks 1-2; ordered here so Task 4 builds on the new object).

Reuse: `LANE_SELECTED` underlay pattern (`connection-object.ts:42-48`) for the hover underlay.
New: `LANE_HOVERED` theme constant — nothing fits because no lane hover state exists
(`pixi-map-canvas.tsx:321-340` resolves cells and factions only).

### Task 4 — The Lanes map mode: lane styling, cell tint, legend

Files:
- `lib/types/map.ts` (`MapMode` + `MAP_MODES` + `isValueMapMode`)
- `components/map/pixi/value-ramp.ts` (`ValueMode` gains `"lanes"`; stepped three-band lookup;
  `lanesLegendStops()`)
- `components/map/pixi/__tests__/value-ramp.test.ts`
- `components/map/pixi/layers/value-choropleth-layer.ts` (`RESCALES_TO_SCOPE` / `SHOWS_NUMBERS`
  entries; per-mode fill alpha)
- `components/map/pixi/number-aggregation.ts`, `components/map/pixi/number-format.ts` (the
  `ValueMode` records — walk them; lanes shows no numbers)
- `components/map/pixi/lod.ts`, `components/map/pixi/__tests__/lod.test.ts` (`lanesCellAlpha`)
- `components/map/pixi/objects/lane-style.ts`, `__tests__/lane-style.test.ts` (`laneModeStyle`)
- `components/map/pixi/objects/connection-object.ts`, `__tests__/connection-object.test.tsx`
- `components/map/pixi/layers/connection-layer.ts` (mode + faction colours + congested pulse)
- `components/map/pixi/theme.ts` (`LANE_MODE = { baseWidth, perLevel, fineAlpha, busyAlpha, pulsePeriodMs, pulseColor }`)
- `components/map/pixi/pixi-map-canvas.tsx` (mode effect, `setValues` branch, `connectionLayer.setMode`, per-frame `connectionLayer.update(dtMs)`)
- `components/map/star-map.tsx` (pass `laneBandBySystem`)
- `components/map/map-overlay-controls.tsx` (`MODE_LABELS.lanes`, `LanesLegend`)
- `components/map/__tests__/map-overlay-controls.test.tsx` (new — legend renders the three band names and the dashed/no-investor line)

Interface:
- `MapMode` gains `"lanes"`, placed after `"provision"` in `MAP_MODES`; `isValueMapMode("lanes")`
  is true (choropleth active, star dot subdued, faction outlines drawn, faction-interactive
  zoomed out — the same framework provision rides).
- `ValueMode` gains `"lanes"`; `valueRampColorPixi(value, _ref, "lanes")` is stepped on the band
  index (`0` fine, `1` busy, `2` congested) to `LANE_BAND_COLOR`, never normalised;
  `lanesLegendStops(): SteppedLegendStop[]` in band order.
- `laneBandIndex(band: LaneBand): number` (lane-band.ts) — the value the choropleth map carries.
- `LODState.lanesCellAlpha: number` — 1 at universe zoom, 0 once lanes are fully in
  (`1 − systemLayerAlpha`); `ValueChoroplethLayer.updateVisibility` uses it for the fills and
  outlines when `mode === "lanes"`, `valueChoroplethAlpha` otherwise.
- `laneModeStyle({ investorFactionId, factionColor: number | null, level, band }): { color; width; alpha; dashed: boolean }`
  — colour the investor's hex or slate when null; dashed exactly when `investorFactionId === null`;
  width `LANE_MODE.baseWidth + perLevel × level`; alpha steps by band (fine dim, busy and congested full).
- `ConnectionLayer.setMode(mode: MapMode, factionColors: Map<string, number> | null)`;
  `ConnectionLayer.update(dtMs)` advances the congested pulse — a per-frame alpha on an overlay
  stroke in `LANE_MODE.pulseColor`, iterated over a `Set` of congested lane keys maintained in
  `sync`, never over every lane.
- `ConnectionObject.update(..., state: { selected; hovered; mode: "base" | "lanes"; factionColor: number | null })`.
- `PixiMapCanvasProps.laneBandBySystem?: Map<string, LaneBand>`; the canvas converts to
  `Map<string, number>` via `laneBandIndex` for `setValues(values, values, "lanes")`.
- Controls: `MODE_LABELS.lanes = "Lanes"`; `LanesLegend` follows `ProvisionRampLegend`'s stepped
  swatch row (`map-overlay-controls.tsx:256-281`) plus one line for dashed = no investor. Copy via
  `/game-copy`.

Proves:
- `valueRampColorPixi` returns exactly three distinct colours for the three band indexes and the same
  colour for any value within a band (0.4 reads fine, 1.6 reads busy).
- `lanesCellAlpha` is 1 below zoom 0.3, 0 above 0.4, and monotone non-increasing.
- A lane with no investor is dashed; the same lane with an investor is solid and takes that faction's
  colour; a level-3 lane is wider than a level-0 lane in mode style.
- Only congested lanes are touched by `update(dtMs)` (a spy on the pulse stroke sees calls for the
  congested key and none for a fine one).
- The legend names fine, busy, congested and the no-investor line, from the DOM.
- Vacuity: a stepped lookup that ignores the band index fails the three-distinct-colours test; a
  `lanesCellAlpha` pinned at 1 fails the above-0.4 case.

Consumes: Tasks 1, 2, 3.

Reuse: `RadioOptionGroup` option `tooltip` (already used for provision, `map-overlay-controls.tsx:54-65`);
`ProvisionRampLegend` swatch-row shape; `SteppedLegendStop` (`value-ramp.ts:166`);
`PoliticalTerritoryLayer.getFactionColors()`. New: `LanesLegend` component — a fourth legend body in the
same file, the same shape as the existing four; nothing generic to extract yet beyond the swatch row,
which the implementer extracts as `SteppedSwatchRow` if it is copied a second time.

### Task 5 — The logistics overlay folds into Lanes mode; particles read the band

Files:
- `lib/hooks/use-map-overlays.ts` (deleted)
- `components/map/map-session.ts`, `components/map/__tests__/map-session.test.ts` (`overlays` key
  dropped from state; a stored `overlays` object is silently ignored the way the legacy
  `politicalTerritory` key already is, `map-session.ts:23`)
- `components/map/map-overlay-controls.tsx` (Overlays section, `OVERLAY_DEFS`, `LogisticsLegend`,
  `TierSwatchList`, `OverlayLegend`, the `MapOverlays` props removed)
- `components/map/map-controls-dock.tsx` (overlay props no longer threaded)
- `components/map/star-map.tsx` (`useTradeFlow(mapMode === "lanes")`; no `useMapOverlays`)
- `components/map/__tests__/star-map.test.tsx` (mock list)
- `lib/hooks/use-trade-flow.ts` (doc comment: gated by the Lanes mode, not an overlay)
- `lib/hooks/use-map-data.ts` (`MapData.logisticsFlowEdges` doc: empty outside Lanes mode)
- `components/map/pixi/layers/trade-flow-layer.ts` (`sync` takes the band per lane; count by band; colour by band)
- `components/map/pixi/objects/trade-flow-edge.ts` (identity drops `dominantGoodId`; recreate on band change)
- `components/map/pixi/theme.ts` (`LOGISTICS_FLOW`: `particlesPerBand: Record<LaneBand, number>` replaces `minParticlesPerEdge` / `volumePerExtraParticle` / `maxParticlesPerEdge`)
- `components/map/pixi/pixi-map-canvas.tsx` (`logisticsFlowLayer.sync(systems, edges, bandByLaneKey)`)
- `lib/constants/good-colors.ts` (`TIER_COLOR` / `TIER_LABEL` keep their logistics-panel reader, `components/system/logistics-panel.tsx:394`; `getGoodColor` loses its only reader, `trade-flow-layer.ts:104` — delete it)
- `lib/types/api.ts` (`TradeFlowEdgeInfo.dominantGoodId` loses its only reader — delete), `lib/engine/trade-flow-edges.ts:100-114` and `lib/engine/__tests__/trade-flow-edges.test.ts` (stop computing it)
- `docs/active/gameplay/logistics-lanes.md` §6 wording (Task 8 owns the fold; this task only stops the overlay)

Interface:
- `TradeFlowLayer.sync(systems, flowEdges, bandByLaneKey: Map<string, LaneBand>)` — particle count
  per edge is `LOGISTICS_FLOW.particlesPerBand[band]`, colour `LANE_BAND_COLOR[band]`; `totalVolume`
  still orders edges for the global `maxTotalParticles` budget.
- `TradeFlowEdge` identity `{ fromSystemId; toSystemId; band }`.
- `useTradeFlow(active: boolean)` — parameter renamed from `logisticsActive`; semantics unchanged.
- `MapSessionState` is `{ mode?: MapMode }`.

Proves:
- An edge on a congested lane gets more particles than one on a fine lane, whatever their volumes.
- A band change on an existing edge recreates it (a spy sees dispose + create); an unchanged band
  does not.
- A stored session with `{ overlays: { logistics: true } }` hydrates to a mode-only state without
  throwing.
- The controls render no "Overlays" group and no checkbox (`queryByRole("checkbox")` is null).
- Vacuity: a `particlesPerBand` collapsed to one value fails the congested-vs-fine count test.

Consumes: Tasks 1, 2, 4.

Reuse: `TradeFlowLayer` / `TradeFlowEdge` machinery (`trade-flow-layer.ts:51-169`) unchanged in
lifecycle. Nothing new.

### Task 6 — Selection is the cell; the lane hit-test spares the star

Files:
- `components/map/pixi/lane-hit-test.ts`, `components/map/pixi/__tests__/lane-hit-test.test.ts`
- `components/map/pixi/interactions.ts`
- `components/map/pixi/objects/system-object.ts` (selection ring, hover ring, hit circle,
  `eventMode`, `cursor`, `setHovered`, `updateSelectionRing`, `strokeDashedRing` removed)
- `components/map/pixi/layers/system-layer.ts` (`onObjectCreated` binding no longer needed by
  interactions; `selectedId` kept — Task 7 reads it)
- `components/map/pixi/theme.ts` (`GLYPH.hoverRingRadius`, `.navRingRadius`, `.selectedRingWidth`,
  `SIZES.systemHitRadius`, `ANIM.hoverScale` deleted; `LANE_HIT_END_GAP_PX` added)
- `components/map/pixi/pixi-map-canvas.tsx` (lane hover in the ticker; `getLaneContext` gains the gap)

Interface:
- `findLaneAt(point, lanes, systems, tolerance, endGap: number)` — the segment is shortened by
  `endGap` world units at each end before the distance test; a lane shorter than `2 × endGap` is
  skipped.
- `findSystemNear` deleted; `resolveMapClick({ factionHit, laneAt, cellSystemId })` — precedence
  faction → lane → cell → empty.
- `LANE_HIT_END_GAP_PX: number` (theme.ts), divided by zoom at the call site like the tolerance.
- The ticker's hover block resolves, zoomed in, `findLaneAt` first: a lane hit calls
  `connectionLayer.setHovered(key)` and `cellHighlightLayer.setHovered(null)`; otherwise
  `setHovered(null)` on the lane layer and the cell as today. Cursor is pointer for either.
- `SystemObject` draws bloom, core, settlement mark and name only; `eventMode = "none"`.

Proves:
- A point at a star's centre, with a lane ending there, resolves to the cell, not the lane.
- A point mid-lane still resolves to the lane; a point just inside the end gap does not.
- A lane shorter than twice the gap is never hit.
- Precedence without the star step: lane beats cell; faction beats lane.
- Vacuity: with the gap forced to 0 the star-centre case flips to the lane, so the test is live.

Consumes: Task 3 (`setHovered`).

### Task 7 — Cell-fit, screen-constant names

Files:
- `components/map/pixi/label-fit.ts` (new), `components/map/pixi/__tests__/label-fit.test.ts` (new)
- `components/map/pixi/objects/system-object.ts` (name scale, offset, `setNameShown`)
- `components/map/pixi/layers/system-layer.ts` (`setCells`, `setHovered`, per-zoom-band fit pass)
- `components/map/pixi/pixi-map-canvas.tsx` (`systemLayer.setCells(cells)` in the territory effect;
  `systemLayer.setHovered(id)` beside `cellHighlightLayer.setHovered`)
- `components/map/pixi/theme.ts` (`LABEL.offsetY` becomes a screen-pixel lift; `LABEL.fitZoomStep`)

Interface:
- `labelFitsCell(center: Point, halfW: number, halfH: number, cell: MultiPolygon): boolean` —
  true when all four corners of the box lie inside the cell's first polygon's exterior ring
  (Voronoi cells clipped to a disc are convex, so corner containment is containment). Pure.
- `SystemObject.setNameShown(shown: boolean)`; the name's scale is `1 / zoom` (screen-constant at
  `SIZES.systemLabelSize` px) and its lift below the glyph is
  `GLYPH.coreRadius × dotScale + LABEL.offsetY / zoom`, the choropleth's own formula
  (`value-choropleth-layer.ts:305-306`); both applied in `setLOD`, which gains `zoom` in the fields
  it compares.
- `SystemLayer.setCells(cells: SystemCells | null)`; `SystemLayer.setHovered(systemId: string | null)`.
- The fit pass runs inside `updateVisibility` only when the zoom moved past `LABEL.fitZoomStep`
  (relative, the `updateOutlineZoom` gate at `value-choropleth-layer.ts:194`) or the frustum admitted
  a new object; result per object cached with the zoom it was computed at. Selected and hovered
  objects are shown regardless of fit; `lod.showSystemNames` stays the outer gate.

Proves:
- A box centred in a large cell fits; the same box in a cell narrower than the box does not.
- A box that fits at zoom 2 fails at zoom 0.9 for the same cell (the box in world units grows as
  zoom falls).
- A corner exactly on the cell edge counts as inside (boundary inclusive), so a snug fit is shown.
- The selected system's name is shown even when it does not fit; clearing selection hides it again.
- Vacuity: a fit function returning true unconditionally fails the narrow-cell case.

Consumes: Task 6 (the object's slimmed draw order), nothing from 1-5.

Reuse: `SystemCells.cellsBySystemId`; the choropleth number lift formula; `MultiPolygon` /
`Ring` types (`territory-utils.ts:4-6`). New: `labelFitsCell` — searched "point in polygon",
"contains", "inside cell" across `components/map/pixi`: `findSystemAt` is analytic (nearest site),
not a polygon test, and `territory-utils.ts` clips, never tests containment.

### Task 8 — Doc fold and cleanup

Files:
- `docs/active/engineering/map-rendering.md` (Headline; Map modes — Lanes mode, overlay paragraph
  removed; Selection; Lane layer rewritten as base layer + Lanes mode; Selection precedence four
  steps; Deferred — "logistics-as-mode" line retired; Gotchas unchanged)
- `docs/active/gameplay/logistics-lanes.md` §6 Map bullet
- `docs/active/gameplay/universe.md:82` (lane line styling) and `:98` (selection focus ring)
- `docs/SPEC.md` Universe & Map paragraph (`:34`, lane drawing + overlay + selection sentences) and
  the Logistics Lanes paragraph where it names the map
- `docs/planned/ui-ws2-map-modes.md` P2 — the logistics half is settled here; migration arrows remain
- `docs/planned/map-presentation.md` (deleted — folded into map-rendering.md)
- `docs/ROADMAP.md` (row deleted)
- `docs/build-plans/map-presentation.md` (this file, deleted on the PR)
- `docs/active/glossary.md` only if `/game-copy` adds a term for the mode

Interface: none.

Proves: the doc-sync test (SPEC entry hand-count) still passes; a grep for `LANE_LOAD_COLOR`,
`findSystemNear`, `useMapOverlays`, `selectionRing`, `hoverRing`, `dominantGoodId` (map side),
`LANE_MAJOR_GLOW` across `components lib docs .agents` returns nothing.

Consumes: Tasks 1-7.

---

### Verification

- Not a game-logic change: no processor, constant or signal moves. `npm run simulate` is not the
  instrument; the gate is `npm run build` (`tsc && vite build`) plus `npx vitest run`, and a
  manual smoke by the owner on a live galaxy at three zooms (0.2, 0.5, 1.5) in Political and Lanes
  modes, watching: no dashes or colour on the base layer; Lanes mode cell tints at 0.2 and lanes at
  0.5+; the congested pulse on a lane the alert bar names; names appearing as zoom rises in a tight
  cluster; no ring on a selected star.
- Perf: the owner's ship baseline is 175 tps at t=14,000 on a 600-system galaxy; the smoke watches the
  map frame rate while zooming with Lanes mode on, since the fit pass and the pulse are the two
  new per-zoom/per-frame costs.

### Doc fold

Task 8. The planned spec is folded into `map-rendering.md` and deleted; `logistics-lanes.md` §6 and
`universe.md` stop describing tier dashes, load colour and the star ring; `SPEC.md`'s Universe & Map
paragraph drops the additive overlay and names the Lanes mode; `ui-ws2-map-modes.md` marks the
logistics half of P2 settled. This file is deleted on the PR that ships the work.

### Not covered

- **Owned/friendly-only cell tint** — dropped for now by owner decision (all systems tint, like the
  other modes); a later filter over `laneBandBySystem`. Not booked: the owner said "we can still
  exclude it later", and it is a one-line filter when wanted.
- **A label priority scheme beyond selected/hovered** — dropped: the cell-fit rule makes one
  unnecessary; revisit after play (spec §5).
- **Migration arrows** (`ui-ws2-map-modes.md` P2) — stay planned there.
- **`LANE_BUSY_LOAD_FRACTION` and the pulse period** — set on the smoke, not tuned by measurement
  (presentation knobs).

### Net-new UI

- `LanesLegend` (Task 4) — a legend body in `map-overlay-controls.tsx`, same shape as the four
  existing ramp legends.
- `LANE_HOVERED` lane underlay (Task 3) — a theme constant, not a component.
- Nothing else new; every other piece is a change to an existing layer, object or hook.
