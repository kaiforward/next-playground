# UI Overhaul — Map Legibility & System-Detail Redesign

> **Status:** Planned (roadmap) for WS2/WS5. WS3 (cleanup), WS1 (map spine), and WS4 (system + faction detail) have shipped. Captures the
> full set of UI issues raised for the map and system-detail surfaces, grouped into sequenced workstreams. Each
> remaining workstream gets its own `docs/build-plans/` entry when it starts; until then it's specced here at
> intent level and designed in detail when picked up.

## Headline

The colony simulation is now accurate — population fills the frontier, colonies develop, delivery routes
people — but the UI predates it and hides more than it shows. This overhaul makes the working sim **legible**:
an **EU5-style Voronoi map** where value modes print the number inside each system's cell and stay readable
at any zoom, a **cleaner system-detail screen** that shows real industry/deposit/consumption breakdowns, and
the **removal of deprecated flavour** (system traits, economic-type and region colouring) that no longer
earns its place. One gameplay rule (pops dying → undeveloped) rides along because it surfaced in the same
pass, but it is engine work, not UI.

## Guiding principles

- **Read at a glance.** Value map-modes (stability / population / development) print the number *inside* the
  Voronoi cell, colour complementing rather than carrying the meaning. A score of 0 reads as black.
- **Selectable at any zoom.** Selection is by clickable Voronoi cell, not a tiny star hitbox — the map works
  zoomed out (cells) and zoomed in (stars), like EU5.
- **Strip what's being re-thought.** Concepts marked for redesign (system traits) come out entirely rather
  than lingering as dead flavour; the visual layers that no longer make sense (economy / region colouring)
  go with them.
- **Keep sim-load-bearing data even when its visuals go.** `economyType` (event targeting) and `regionId`
  (region-targeted event modifiers, relations, derivations) stay; only their map/badge rendering is removed.

## Sim-load-bearing constraints (from a code investigation — don't re-derive)

- **`economyType` field must stay** — event spawning filters on it (`lib/engine/events.ts` +
  `lib/constants/events.ts`). Only `ECONOMY_COLORS` and its render consumers + the economy badge are removable.
- **`regionId` must stay** — region-targeted event modifiers, relations, and dominant-faction/economy
  derivations depend on it. The "Regions" map mode stays too — only its dominant-economy fill is removable;
  the territory layer can render transparent fills with neutral-slate borders instead.
- **System traits are NOT cosmetic** — trait quality is weighted into homeworld placement (`faction-gen`,
  0.5) and runtime claim/expansion scoring (`expansion`, 2.0). Removing traits requires dropping those two
  score terms too; same-seed worlds will then generate and expand differently (acceptable in dev). The
  economy-tick `traits` plumbing is dead code; the danger badge's trait contribution is UI-only.

---

## Workstreams (in build order)

### WS3 · Cleanup — strip deprecated concepts _(SHIPPED)_

Pure structural removals; no calibration.

- **`[Sys 6]` System traits are removed entirely.** The types, catalog, generation, storage, economy-tick
  plumbing, and UI are gone; homeworld placement and claim/expansion scoring fall back to habitable space,
  resource diversity, danger, and proximity (no trait term). Danger badge reflects **body danger** only.
- **`[Map 9]` Economic-type markers/colours are removed.** `ECONOMY_COLORS` and its consumers (zoom
  point-cloud tint, system-glyph core fill, the `ECON` label, `economy-badge`) are gone; every system glyph
  renders a single neutral slate colour (`NEUTRAL_GLYPH`). The `economyType` field stays (event targeting
  still reads it) — only its visuals are gone.
- **`[Map 9]` The "Regions" map mode is kept, recoloured.** It no longer tints territories by dominant
  economy: the territory layer renders transparent fills with neutral-slate borders. `regionId` stays
  (region-targeted event modifiers, relations, and derivations still read it).
- **`[Sys 7]` Connection count is removed** from the system overview.

### WS1 · Map rendering & selection overhaul — the "EU5 spine" _(SHIPPED)_

> **Detailed spec:** [map-rendering.md](../active/engineering/map-rendering.md) — the shipped interaction model,
> ramp semantics, and rendering architecture. The items below are the issue-level summary of what shipped.

The Voronoi-centric rewrite the rest of the map leans on.

- **`[Map 1]` Numbers inside Voronoi cells** for the three value modes (stability / population / development),
  coalescing system → faction-within-region → faction on zoom-out; star markers give way to cells + numbers at
  distance.
- **`[Map 2]` Black reserved for "absent"** — a cell with no live value (undeveloped) reads black, and
  population / development also draw a literal 0 black, while stability's 0 (max unrest) rides the red floor.
  Present values ride a per-mode relative ramp normalised to the scope max.
- **`[Map 3]` Faction outline + per-system cells** shown together — per-system value fills under a
  faction-union border.
- **`[Map 4]` Clickable Voronoi cells** — selection works at any zoom via analytic per-cell hit-testing (the
  star hitbox still works zoomed in); a zoomed-out faction click opens the faction panel and re-scales the
  gradient to it.
- **`[Map 5]` System icons refresh** on the tick heartbeat — folded into the rebuild.
- **`[Sys 4]` System-object visual** — hover styling, a larger cell selection zone, and the system as a small
  star dot **coloured by star type with a radial-gradient bloom** (replacing WS3's interim neutral slate),
  subdued under value modes.

### WS2 · Map modes _(P1 shipped: migration mode in, price cut; P2 flow-viz later)_

> **Detailed spec:** [ui-ws2-map-modes.md](./ui-ws2-map-modes.md) — the design pass split WS2 into P1 (value modes)
> and P2 (flow-viz, a later dedicated pass). P1 shipped Migration; Price was built then cut. Summary below.

- **`[Map 6]` Migration mode** → the **attractiveness heatmap** (the *pull*, reusing `migrationAttractiveness`),
  colour-only red→green — matching Vic3/EU5, where attraction *is* the migration map mode. **P1 — SHIPPED.** The
  realized **movement arrows** (built *inside* the mode, EU4-trade model) are the flow-viz half → **P2**.
- **`[Map 7]` Price map mode** → **CUT (premature).** Built in P1, then removed: the buy/sell deal-quality framing
  is a **trader hangover** with no consuming mechanic in the current grand-strategy form. The pre-existing price
  **pill + overlay were removed too**; market data stays on the per-system Market panel. Revisit — as a
  *scarcity/surplus* per-system read or a *faction-aggregate* "who has good X" read — when a faction-trading
  mechanic exists.
- **`[Map 8]` Logistics** → **stays an overlay**, its final fate settled holistically in the **P2** flow-viz pass
  (the last remaining overlay; same problem the arrows solve).
- **Event pills + overlay removed (P1, shipped)** for cleanliness — the Events page + data stay; events-as-mode
  deferred to the events rework. The population ramp was also simplified to **two-pole red→green** (amber dropped).

### WS4 · System- & faction-detail redesign _(SHIPPED)_

> **Detailed spec:** [detail-panels.md](../active/design-system/detail-panels.md) — the shipped docked-drawer
> shell, the tabbed system + faction screens, the reusable vitals grid, and the quantity-aware faction
> aggregation. The items below are the issue-level summary of what shipped.

The detail surfaces became **left-docked, non-blocking drawers** over a live map, tabbed over a reusable
vitals grid; the faction screen split into tabs; and faction/region roll-ups became quantity-aware.

- **`[Sys 8]` Gamified overview layout** — the centered modal became a left-docked, full-height,
  non-blocking drawer (the map stays interactive; clicking another system re-points the drawer in place),
  and the sidebar folded into the top bar.
- **`[Sys 1]` Industry/deposit breakdown** — the header bar + bars became compact **deposit/space tables**
  (settled on tables over chips after the prototype), preserving the Labour card, supply-chain rows, and
  health glyphs.
- **`[Sys 2]` Stale industry labels fixed** — health re-grounded on the infrastructure-decay engine's exact
  triggers and renamed **stable / contracting / collapsing**, so a healthy system reads green (no threshold
  guesswork; the old idle-fraction constants are gone).
- **`[Sys 3]` Tech/engineer consumption shown** — resolved **additive**; the Population tab's demand chart
  segments each good into base / technician / engineer.
- **Faction screen tabbed** (Overview / Diplomacy / Territory) over the same vitals grid. The Overview
  aggregates **and** the map's zoomed-out numbers are quantity-aware — extensive magnitudes sum, stability
  is population-weighted — so a faction spreading into new systems no longer reads as decline.

### WS5 · Gameplay rule — pops die → undeveloped _(engine, not UI; specced/built separately)_

- **`[Sys 5]`** When a system's population dies out from unrest, it reverts `developed → false`: its logistics
  market is hidden and its goods are lost. A tick/engine change (mirrors the develop transition in reverse),
  not part of the UI design — gets its own spec + build plan.

---

## Decisions log

- Traits: **strip entirely** (incl. the two scoring terms), not UI-hide. Re-thought as a concept later.
- Danger badge: **kept on body danger** after traits go (substrate property, not trait).
- `economyType` / `regionId` fields: **kept** (sim-load-bearing); only their visuals removed.
- System-glyph colour after economy removal: **single neutral slate (`NEUTRAL_GLYPH`) interim**, proper
  star-type colour in WS1 — no throwaway palette.
- Stale industry labels `[Sys 2]`: **moved to WS4** (same surface, needs live calibration).

## Open questions

- WS2's open decisions are **resolved** — see [ui-ws2-map-modes.md](./ui-ws2-map-modes.md): migration mode = the
  attractiveness heatmap (movement arrows → P2); logistics stays an overlay (fate settled in P2).

## Sequence

WS3 (cleanup, shipped) → WS1 (map spine, shipped) → WS4 (system + faction detail, shipped) → WS2 (map modes:
P1 value modes shipped — migration in, price cut; P2 flow-viz later). WS5 (gameplay) is independent and can slot in any time. Map-heavy
workstreams get a browser-viewable HTML prototype approved before implementation — **WS2 P1 is the exception**
(it reuses the shipped value-choropleth + ramp, so there is no new visual to prototype; WS2 P2's flow-viz keeps
its prototype).
