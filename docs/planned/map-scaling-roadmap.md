# Map Scaling & Visibility — Implementation Roadmap

Unified implementation plan for scaling the map to 10K systems with fog of war. Phases are ordered by dependency — each phase is a standalone PR that builds on the previous one.

**Design docs** (read these for the full "why" and detailed architecture):
- [Scalable Data Loading](./scalable-data-loading.md) — tile architecture, caching strategy, data tiers
- [Visibility System](./visibility-system.md) — fog of war, sensor range, visibility sources

**Current state**: 600 systems, viewport API with cache miss problems, global event broadcast, no fog of war.

**Target state**: 10K systems, tile-based loading, per-player visibility gating, information scarcity as a gameplay mechanic.

---

## Core Phases (ship in order)

### Phase 1: Atlas Caching & Tile Math

**Goal**: Foundation utilities for the tile system. No visible changes yet.

**Design ref**: [Scalable Data Loading §2 Tier 1](./scalable-data-loading.md)

**Scope**:
- Add `Cache-Control: public, max-age=31536000, immutable` header to `/api/game/atlas` endpoint
- Ensure atlas query performs well at 10K systems (check query plan, response size, gzip)
- Define tile grid constants: `TILE_COLS`, `TILE_ROWS` — target ~30-50 systems per tile
- Tile math utilities (pure functions, unit tested):
  - `systemToTile(x, y) → { col, row }` — which tile a system belongs to
  - `frustumToTiles(bounds) → { col, row }[]` — which tiles are visible on screen
  - `tileBounds(col, row) → { minX, minY, maxX, maxY }` — world-space bounds of a tile

**New files**:
- `lib/engine/tiles.ts` — tile grid math
- Tests for tile math

**Modified files**:
- `/api/game/atlas` route — add cache header

---

### Phase 2: Static Tile System

**Goal**: Replace the viewport API for display labels. Names and economy badges load per-tile with immutable caching. Panning reuses cached tiles.

**Design ref**: [Scalable Data Loading §2 Tier 2](./scalable-data-loading.md)

**Depends on**: Phase 1 (tile math utilities)

**Scope**:
- New API route: `/api/game/systems/tile/static?col=X&row=Y`
  - Returns: `{ systems: [{ id, name, economyType, traitIcons }] }`
  - `Cache-Control: public, max-age=31536000, immutable` header
  - Service function queries systems within tile bounds
- TanStack Query hook: `useStaticTile(col, row)` with `staleTime: Infinity`
- Hook that computes visible tiles from frustum and manages tile queries: `useStaticTiles(frustumBounds, zoomLevel)`
  - Only fetches when zoom crosses name-visibility threshold (~0.5)
  - Computes visible tile coords, returns merged system data
- Map components load names from static tiles instead of viewport API

**New files**:
- `/api/game/systems/tile/static` route + service function
- `lib/hooks/use-static-tiles.ts`

**Modified files**:
- Map components — switch from viewport to static tiles for name rendering

**Does NOT remove**: Viewport API stays for now (backward compat). Removed in Phase 4.

---

### Phase 3: Visibility Computation & Dynamic Tiles

**Goal**: Fog of war is live. Players only see dynamic game state (events, danger, ship presence) near their ships. The map goes dark beyond sensor range.

**Design ref**: [Visibility System §2-4](./visibility-system.md), [Scalable Data Loading §2 Tier 3](./scalable-data-loading.md)

**Depends on**: Phase 2 (static tiles working)

**Scope — Visibility engine**:
- Pure function: `computeVisibilitySet(shipPositions, atlasGraph, sensorRanges) → Set<systemId>`
  - BFS from each ship position, N hops per ship role
  - Union of all ship visibility ranges
- Sensor range constants per ship role (scout=3, trade/support=2, combat/stealth=1)
- Atlas graph structure (adjacency list) built from atlas data, held in memory
- Unit tests for visibility computation (various ship layouts, overlapping ranges, edge cases)

**Scope — Dynamic tiles**:
- New API route: `/api/game/systems/tile/dynamic?col=X&row=Y` (requires auth)
  - Computes player's visibility set from their ship positions
  - Returns per system: `{ id, visibility: "visible" | "unknown", eventTypeIds?, hasPlayerShips?, danger? }`
  - Dynamic data only included for visible systems. Unknown systems: `{ id, visibility: "unknown" }`
  - `Cache-Control: private, no-cache` — per-player, changes on tick
- TanStack Query hook: `useDynamicTile(col, row)` with short `staleTime` (~5-10s), invalidated by tick SSE
- Hook: `useDynamicTiles(frustumBounds, zoomLevel)` — same pattern as static tiles
- Map components merge static + dynamic tile data for rendering
  - Visible systems: full brightness, event icons, ship indicators, danger coloring
  - Unknown systems: dimmed dot, name still visible (from static tile), no dynamic overlays

**Scope — System detail gating**:
- Existing `/api/game/systems/[systemId]` endpoint gated by visibility
  - Visible: full detail (description, traits, prices, events, ships)
  - Unknown: atlas-level only (name, economy type, region, connections) + "no current intel" flag

**Scope — Event migration**:
- Global `/api/game/events` endpoint deprecated (kept temporarily but marked for removal)
- Event data now flows through dynamic tiles (event type IDs on map) and system detail (full event info on click)
- Tick SSE invalidates dynamic tile queries instead of a global events query

**New files**:
- `lib/engine/visibility.ts` — visibility set computation
- `/api/game/systems/tile/dynamic` route + service function
- `lib/hooks/use-dynamic-tiles.ts`
- Tests for visibility computation

**Modified files**:
- Map components — merge static + dynamic data, render visibility states
- `/api/game/systems/[systemId]` — add visibility check
- Tick SSE / `useTickInvalidation` — invalidate dynamic tiles instead of global events
- Map event rendering — switch from global events to dynamic tile data

---

### Phase 4: Cleanup & Migration

**Goal**: Remove all legacy data loading paths. The tile system is the only way map data loads.

**Depends on**: Phase 3 (all tile types working, verified)

**Scope**:
- Remove viewport API (`/api/game/systems/viewport`) endpoint and service
- Remove global events endpoint (`/api/game/events`) or confirm it's no longer called
- Remove viewport-related hooks, query keys, and components
- Remove any viewport quantization/buffer logic
- Verify all map features work exclusively through the tile system
- Performance testing at 10K systems:
  - Atlas load time and response size (gzipped)
  - Static tile cache hit rates
  - Dynamic tile response times under player load
  - Visibility computation timing with many ships

**Modified files**:
- Delete viewport route, service, hooks
- Clean up query key registry
- Remove unused imports and dead code

---

## Future Phases (ship independently, in any order)

These extend the visibility system. Each is a standalone feature that plugs into the architecture built in Phases 1-4. They don't depend on each other.

### Phase 5: Faction Visibility

**Design ref**: [Visibility System §6](./visibility-system.md)

**Depends on**: Phases 1-4 complete + faction system implemented

**Summary**: Players with Friendly+ standing (+25 rep) with a faction gain visibility of all systems that faction controls. Adds faction territories as a visibility source alongside ship sensor range.

**Key changes**:
- `computeVisibilitySet` gains faction territory input
- Service to look up allied faction territories for a player
- Standing drop / faction territory loss triggers visibility change

---

### Phase 6: Purchased Intel & Mission Reveals

**Design ref**: [Visibility System §7](./visibility-system.md)

**Depends on**: Phases 1-4 complete

**Summary**: Players buy time-limited intel on regions/systems from trade stations. Active missions reveal relevant systems. Both add temporary entries to the player's visibility set.

**Key changes**:
- `PurchasedIntel` table: `playerId, systemId/regionId, expiresAtTick`
- Intel purchase UI at trade stations
- Mission accept/complete hooks update visibility sources
- `computeVisibilitySet` gains intel + mission inputs

---

### Phase 7: Staleness & Snapshots

**Design ref**: [Visibility System §5](./visibility-system.md)

**Depends on**: Phases 1-4 complete

**Summary**: When a player loses visibility of a system, the server snapshots its dynamic state. The player sees stale data (faded, with age indicator) instead of nothing. Adds a third visibility state between "visible" and "unknown."

**Key changes**:
- `PlayerVisibilitySnapshot` table: `playerId, systemId, lastSeenTick, snapshot`
- Snapshot write on visibility loss (detected by comparing current vs previous visibility set)
- Dynamic tile response gains `"stale"` visibility state with `lastSeenTick` and snapshot data
- Client renders stale state: faded UI, "Last intel: X ticks ago" label
