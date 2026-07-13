# UI Overhaul — Map Legibility & System-Detail Redesign

> **Status:** Planned (roadmap). Captures the full set of UI issues raised for the map and system-detail
> surfaces, grouped into sequenced workstreams. Each workstream gets its own `docs/build-plans/` entry when
> it starts. The cleanup pass (WS3) is first and has a build plan; the rest are specced here at intent level
> and designed in detail when picked up.

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
  derivations depend on it. Only the map colour tint (the "Regions" mode, which recolours territories by
  dominant economy) is removable.
- **System traits are NOT cosmetic** — trait quality is weighted into homeworld placement (`faction-gen`,
  0.5) and runtime claim/expansion scoring (`expansion`, 2.0). Removing traits requires dropping those two
  score terms too; same-seed worlds will then generate and expand differently (acceptable in dev). The
  economy-tick `traits` plumbing is dead code; the danger badge's trait contribution is UI-only.

---

## Workstreams (in build order)

### WS3 · Cleanup — strip deprecated concepts _(first; build plan exists)_

Pure structural removals; no calibration. Detail in `docs/build-plans/ui-cleanup-pass.md`.

- **`[Sys 6]` Strip system traits entirely.** Delete the types, catalog, generation, storage, dead
  economy-tick plumbing, and UI; drop the trait term from homeworld placement and claim/expansion scoring
  (fall back to habitable space, resource diversity, danger, proximity); retire `system-traits.md`. Danger
  badge kept on **body danger** only. Same-seed worlds shift — verified sane via the simulator.
- **`[Map 9]` Remove economic-type markers/colours.** Delete `ECONOMY_COLORS` + consumers (zoom point-cloud
  tint, system-glyph core fill + `ECON` label, `economy-badge`). Keep the `economyType` field. Glyph falls
  back to price-based / neutral colour until WS1 recolours by star type.
- **`[Map 9]` Remove region colours → drop the "Regions" map mode.** It only tints territories by dominant
  economy, so it dies with the economy palette. Keep `regionId`.
- **`[Sys 7]` Remove connection count** from the system overview (belongs in astrography if anywhere).

### WS1 · Map rendering & selection overhaul — the "EU5 spine" _(foundational)_

The Voronoi-centric rewrite the rest of the map leans on.

- **`[Map 1]` Numbers inside Voronoi cells** for value modes (stability / population / development); hide the
  star markers at distance so cells + numbers carry the read. (Reference: EU5 map-mode number-in-province.)
- **`[Map 2]` Score 0 → black** on the dev/pop (and other value) modes, so low, similar values are
  distinguishable.
- **`[Map 3]` Faction outline + per-system cells** shown together in modes — the individual Voronoi cells
  *and* a bolder faction border.
- **`[Map 4]` Clickable Voronoi cells** — selection works at range via cells (no per-star hitbox / label
  render issues); the star is shown when zoomed in, as now.
- **`[Map 5]` Fix system icons not refreshing** — folded into the rebuild.
- **`[Sys 4]` System-object visual** — hover styles, a larger transparent selection zone, and the system as a
  small star dot **coloured by star type with a gradient** (this is where WS3's removed economy colour is
  replaced).

### WS2 · Map modes _(depends on WS1's mode framework)_

- **`[Map 6]` Migration mode** — visualise population flow. **Open:** arrows (directional) vs. a per-cell
  number. EU5-style arrows are the reference.
- **`[Map 7]` Price as a first-class map mode**, not the current overlay.
- **`[Map 8]` Logistics** — **open:** keep as an overlay or promote to a map mode.

### WS4 · System-detail screen redesign

- **`[Sys 1]` Industry/deposit breakdown.** The Industry tab doesn't show a proper deposit breakdown. Replace
  the header bar + bars with **chipped bars** (divided into the number of available units, a distinct colour
  for filled), or move to a **proper table** for maximum clarity. For industry, show a single extra "empty"
  chip to represent available general space.
- **`[Sys 2]` Fix stale collapsing/declining labels** _(moved here from WS3)_. The Industry tab shows
  red/orange decay/health labels under rules that no longer apply — most things should read green now. The
  labels are UI strings in `industry-panel.tsx`; the thresholds are `IDLE_COASTING_FRACTION` (0.15),
  `IDLE_COLLAPSING_FRACTION` (0.5), and unrest θ (0.75) in `industry.ts`/`infrastructure.ts`. Needs live-data
  calibration — done with the tab redesign, not as a throwaway patch.
- **`[Sys 3]` Show tech/engineer good consumption** in the Industry/logistics view. **Open data question:**
  does the pop-page consumption figure already include the skilled-worker (technician/engineer) tiers, or are
  they additive? Resolve against `demandRateForGood` / the consumption model before designing the readout.
- **`[Sys 8]` Gamify the overview layout** — offset the panel left, full-height, less wide.

### WS5 · Gameplay rule — pops die → undeveloped _(engine, not UI; specced/built separately)_

- **`[Sys 5]`** When a system's population dies out from unrest, it reverts `developed → false`: its logistics
  market is hidden and its goods are lost. A tick/engine change (mirrors the develop transition in reverse),
  not part of the UI design — gets its own spec + build plan.

---

## Decisions log

- Traits: **strip entirely** (incl. the two scoring terms), not UI-hide. Re-thought as a concept later.
- Danger badge: **kept on body danger** after traits go (substrate property, not trait).
- `economyType` / `regionId` fields: **kept** (sim-load-bearing); only their visuals removed.
- System-glyph colour after economy removal: **neutral/price interim**, proper star-type colour in WS1 — no
  throwaway palette.
- Stale industry labels `[Sys 2]`: **moved to WS4** (same surface, needs live calibration).

## Open questions (resolve when the owning workstream starts)

- WS2 `[Map 6]`: migration mode — arrows vs. number.
- WS2 `[Map 8]`: logistics — overlay vs. map mode.
- WS4 `[Sys 3]`: does pop-consumption already include the technician/engineer tiers?
- WS4 `[Sys 1]`: chipped bars vs. table for the industry/deposit breakdown (settle in an HTML prototype).

## Sequence

WS3 (cleanup) → WS1 (map spine) → WS2 (map modes) → WS4 (system detail). WS5 (gameplay) is independent and
can slot in any time. Map-heavy workstreams (WS1, WS2, WS4 layout) get a browser-viewable HTML prototype
approved before implementation.
