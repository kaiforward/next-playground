# System & Faction Detail Panels

The detail surfaces are **left-docked, non-blocking drawers** you can scrub the live map behind. The
system and faction screens share one drawer shell and one reusable **vitals grid**, are organised into
**tabs**, and lead each Overview with a few loud stats over quiet context. Most of the surface is still
read-only reporting; the player's own territory additionally carries the construction/colonisation
control surface — quick-add, new-industry, establish-colony, cancel, and the faction's automation
switches — detailed in [player-seat.md](../gameplay/player-seat.md). Theme rules are in
[theme.md](./theme.md); the map side is [map-rendering.md](../engineering/map-rendering.md).

## Docked drawer shell

`DetailPanel` (`components/ui/detail-panel.tsx`) is a fixed, left-docked, full-height drawer
(`top: var(--topbar-height); left: 0; bottom: 0`, width `clamp(400px, 30vw, 560px)`), shared by every
panel (system, faction, faction list, diplomacy, events, styleguide).

- **Non-blocking** — there is no backdrop, so the map keeps all pointer events: you pan, zoom, and click
  other systems with a panel open.
- **Re-points on click** — clicking another system re-targets the drawer in place (the URL is the single
  source of truth); content swaps with no open/close churn, and the map recentres so the selection clears
  the drawer. The drawer shell itself persists across the switch (no remount, no re-animation), and the
  system panel's open sub-tab carries over onto the newly selected system where it still applies
  (Astrography always; an economy tab only if the target is developed) — panning between systems doesn't
  bounce you back to Overview.
- **Close = X / Escape → map** (`backPath` defaults to `/`).
- The header is pinned; an optional `subHeader` slot carries the tab strip; the body scrolls internally
  with Foundry-themed custom scrollbars (`scrollbar-gutter: stable`).

Navigation (Events / Factions / Diplomacy), game speed + tick, and Save / Exit live in the top bar —
there is no separate sidebar, and the top bar's center-left is left roomy for the future treasury strip.

## Vitals grid

`VitalTile` / `VitalGrid` / `GhostVitalTile` (`components/ui/vital-tile.tsx`) are a reusable, N-up
stat-tile grid both Overviews use. Each tile carries an uppercase label + status dot, a large `font-mono`
value, an optional thin meter *or* a `children` body (e.g. a composition sub-bar), and a one-line hint.
Tile hues align with the map's value-mode ramps (stability cyan, development copper) so a value reads the
same colour on the tile as on the map. A dashed `GhostVitalTile` marks slots reserved for future stats
(treasury / control / tax base), proving the grid extends with no redesign.

## System detail — tabs

**Overview · Astrography · Population · Industry · Logistics · Market** (the four economy tabs hide on an
undeveloped system).

- **Overview** — a loud vitals band (**Stability** = `1 − unrest`%; **Development** = % of the system's
  *own* build-out potential + raw points; **Population** = headcount + an unskilled/technician/engineer
  composition sub-bar; **Construction** = open-project count, linking to Industry), then, on a
  controlled-but-undeveloped player system, the colonisation founding entry (establish verb + preview,
  forming, or the disabled verb with its blocking reason); then a quiet 2-up context strip (faction ·
  government · danger · astrography) and an events banner.
- **Population** — magnitude, `popCap` utilisation, unrest/stability, strike state, and a
  **consumer-segmented demand chart**: one stacked bar per good split into base / technician / engineer
  demand, the `MIN_DEMAND` floor drawn as a hatched "market minimum" tail.
- **Industry** — the deposit/space breakdown as compact tables: a per-deposit row (health glyph ·
  resource · `worked/slots` · yield · output, multi-type deposits carrying per-type sub-rows under a
  shared slot pool) and a general-land magnitude bar + a buildings table grouped **Housing · Academies ·
  Specialisation · Production · Support** with per-input supply-chain rows, plus the skill-tiered Labour
  card. Health reads **stable / contracting / collapsing**, grounded on the infrastructure-decay engine's
  exact triggers (contracting = a whole idle level `floor(built − used) ≥ 1`; collapsing = the unrest
  teardown), so a healthy system reads stable. On the player's own systems, in-flight builds render as
  ghost rows in place with a quick-add `+` per row and a **New industry** dialog; see
  [player-seat.md](../gameplay/player-seat.md).
- **Astrography / Logistics / Market** — the physical substrate, the imports/exports + production/
  consumption dashboard, and the read-only market inspection surface.

## Faction detail — tabs

**Overview · Diplomacy · Territory** — the Victoria-3 country-panel model: the same lens for every
faction, with diplomacy as one tab.

- **Overview** — `FactionCard` identity + the shared vitals grid rolled up over the faction's systems
  (Territory · Population · Stability · Development) + compacted government/doctrine (homeworld + flavour)
  + the faction construction command card (pool composition, systems-building and colonies-forming link
  lists, and — player faction only — the automation switch pair).
- **Diplomacy** — active alliances, the relation-score stance across every other faction, and recent
  diplomatic events.
- **Territory** — the full owned-system list (gateways first), each linking to its system.

## Faction / map aggregation

Faction- and region-level roll-ups — the Overview vitals *and* the map's zoomed-out numbers — are
**quantity-aware**, so a faction spreading into new systems never *looks* like it is declining when it is
only spreading thin. **Extensive** magnitudes (population, development points) **sum**; **intensive**
stability (`1 − unrest`) is a **population-weighted mean** so a populous core dominates and a tiny outpost
can't drag the number down. The faction Overview reads a tick-dynamic `getFactionVitals` service; the map
computes the same via `number-aggregation`; both share one `weightedMean` (`lib/utils/math`) so the
stability figures can't drift. Systems with no value (undeveloped) are skipped, never counted as a
dragging zero.
