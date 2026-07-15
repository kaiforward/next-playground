# WS4 — System-/Faction-Detail Redesign · Build Plan

> **Transient build plan** — delete when WS4 ships (promote the spec to `docs/active/`, update
> `docs/SPEC.md` + `docs/planned/ui-overhaul.md`, delete this file + the prototype).
> **Design spec (source of truth):** `docs/planned/ui-ws4-system-detail.md`.
> **Visual oracle:** `docs/build-plans/ws4-system-detail-prototype.html` (open in a browser; the
> pixel reference — match it).

Four phase PRs into the shared `feat/economy-rework-base` branch, **subagent-driven** (fresh
implementer + task-reviewer per task, Opus final review), squash-merged back when reviewed — the
proven WS1/WS3 pattern. Build gate: `npx next build --webpack` + `npx vitest run` green; UI verified
in the browser against the oracle. Order matters: Phase 1 unblocks the live-map win and every panel
inherits the shell; Phase 2 establishes the `VitalTile` primitive that Phase 4 reuses.

---

## Phase 1 — Shell + chrome reshape (keystone, structural; no data changes)

Reshape the shared frame so the map is live behind a docked drawer. Verifiable purely by interaction.

1. **`DetailPanel` → docked non-blocking drawer** (`components/ui/detail-panel.tsx`): left-docked
   (`top: topbar-height; left-0; bottom-0`, width ~`clamp(400px,30vw,560px)`), delete the `inset-0`
   backdrop (map keeps pointer events), slide-in-from-left, close = X/Escape → `backPath`. Collapse
   the md/lg/xl size variants toward one docked width. All six consumers inherit.
2. **Faction close-fix:** `factions/[factionId]/page.tsx` `backPath` `/factions` → `/`.
3. **Map re-points on click / recenter offset:** confirm clicking a system with the panel open swaps
   content (URL is source of truth from WS1); add a map-centre offset so the selection clears the
   drawer (reuse the WS1 `?focus=` channel).
4. **Retire `GameSidebar` → `TopBar`:** move logo + nav (Events/Factions/Diplomacy) + `SpeedControls`
   + tick/TPS + Save/Exit into `top-bar.tsx`; **reserve roomy center-left space** for future
   treasury/resources. Delete `game-sidebar.tsx`, the `marginLeft` shim + `useSidebar` machinery in
   `game-shell.tsx`, fold away the breadcrumb.
5. **Right-align `MapControlsDock`** (`bottom-4 left-4` → `right-4`, `items-end`) — **position only, the
   map-mode tool itself is unchanged.**
6. **Custom scrollbars:** Foundry-themed `::-webkit-scrollbar` in `globals.css` (thin, square, slate
   thumb → copper hover, `scrollbar-gutter: stable`).

**Verify:** open a system, pan/zoom + click another system (panel re-points, map never blocked);
faction close returns to map; all six system tabs fit with no horizontal scroll; sidebar gone.

## Phase 2 — System overview + reusable vitals grid

1. **`VitalTile` + grid** (`components/ui/` — reusable, N-up, extensible). Tile: label + status dot,
   `font-mono` value, thin meter, hint. Grid built to take more tiles with no redesign.
2. **Service extension:** emit per-system **development points + potential** (map already computes
   `developmentPoints`; potential from `habitablePotentialPop` + `industryPotential`) via the
   system-info/dynamic read a tile can consume.
3. **Rebuild overview** (`app/(game)/@panel/system/[systemId]/page.tsx`): vitals band (Stability =
   `1−unrest`%; Development = % of potential + pts; Population = headcount + unskilled/tech/eng
   composition sub-bar + trend) → quiet context strip (faction/gov/danger/astrography) → compact
   Produces/Consumes → events + construction. **Delete the Market Snapshot + Stock-Distribution pie.**

**Verify:** vitals read at a glance; grid visibly extensible; overview matches the oracle.

## Phase 3 — Industry breakdown + demand chart (dataviz)

1. **Industry deposit/space breakdown** (`components/system/industry-panel.tsx`): Chipped/Table
   toggle; the **four-state chip grammar** (copper staffed / partial / **red** built-idle / dashed
   unbuilt) for deposits (full slot count, no header bar, wrapping via `flex-wrap` + row
   `align-items: flex-start`) and production (built + 1 dashed room chip); general-land aggregate =
   magnitude bar. **Preserve** the labour card, tier-1/2 input/supply-chain "needs" lines, health
   glyphs, tooltips, density toggle. Pure chip/table render helpers unit-tested.
2. **`[Sys 2]` label recalibration:** run `npm run simulate`, read idle-fraction/unrest on a healthy
   galaxy, re-tune `IDLE_COASTING_FRACTION` / `IDLE_COLLAPSING_FRACTION` / unrest θ
   (`lib/engine/industry.ts`, `lib/constants/infrastructure.ts`) + reword labels so healthy reads
   green. Loosen magnitude-pinning tests to ranges.
3. **Population demand chart** (`components/system/population-panel.tsx`): swap the Demand-footprint
   `<ul>` for the consumer-segmented horizontal bar chart (base copper / tech deep-cyan / eng purple,
   validated palette), `MIN_DEMAND` floor as a hatched tail, legend + per-segment hover per `dataviz`.

**Verify:** chips render all four states incl. wrapping on a ≥10-slot deposit; toggle works; healthy
system reads green; demand chart segments read; oracle match.

## Phase 4 — Faction screen tabs

Split the single faction `page.tsx` into a `layout.tsx` (`DetailPanel` + `subHeader` `TabList` from a
`FACTION_TABS` constant) with nested **Overview / Diplomacy / Territory** route pages — the exact
system-tab pattern.

- **Overview** — `FactionCard` + the `VitalTile` grid rolled up over the faction's economically-active
  systems, + compacted government/doctrine (homeworld + flavour) + the construction card.
- **Diplomacy** — alliances + relation-score stance + recent diplomatic events (lifted verbatim).
- **Territory** — the full owned-system list (the old 20-cap `territorySample` uncapped and renamed
  `FactionDetail.territory`) + the political-map note.

**Weighted aggregates (the one new decision, applied on BOTH the panel and the map).** Averaging faction
stats per-system makes expansion *look* like decline — spreading thin, not weakening. So:

- **Extensive** stats (population, development points) → **SUM**. The faction Development tile shows
  *total* points (`formatUnitsShort`) with a "% of potential" meter (`Σpoints / Σpotential`).
- **Intensive** stability (`1 − unrest`) → **population-weighted mean** (`weightedMean`, in
  `lib/utils/math`), so a populous core dominates.
- New tick-dynamic `getFactionVitals` service (`/api/game/factions/[id]/vitals` + `useFactionVitals`,
  tick-invalidated), kept separate from the static faction detail. Shares `developmentPointsAndPotential`
  (`lib/services/system-development.ts`) with the system overview.

**Folded-in map fix** (same weighting bug, surfaced during this pass): `number-aggregation.aggregateValue`
took a plain mean for development *and* stability. Now development → sum (extensive), stability →
population-weighted mean (weights threaded via `usePopulation` extended to stability mode →
`setValues` → `buildAggregationGroups`). `weightedMean` is the shared formula. Active
`map-rendering.md` updated to match.

**Verify:** faction panel is tabbed, Overview vitals match the system grid, nothing lost from the old
scroll; on the map, a faction that spreads into small systems no longer sees its stability/development
number sag.

---

## Notes

- **Read-only pass** — no player controls (agency workstream next); layouts reserve quiet space.
- **Doc lifecycle before the shared→main squash:** promote `ui-ws4-system-detail.md` → `docs/active/`
  present-tense, mark WS4 shipped in `docs/SPEC.md` + `docs/planned/ui-overhaul.md`, delete this plan
  + the prototype HTML.
- Prototype divergences allowed where real data demands; match the oracle's *visual language*, not
  its mock numbers.
