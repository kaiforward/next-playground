# Scalable Map Data Loading

Data architecture for rendering and interacting with a 10K-system universe. Replaces the current viewport API with a tiered loading system: atlas for topology, static tiles for display labels, dynamic tiles for live game state, and detail-on-click for full system info.

**Status**: Designed — ready for phased implementation.

**Context**: The current map loads 600 systems. We're scaling to ~10,000. The current viewport API has caching problems that get worse at scale (see §1). This doc defines the replacement architecture.

**Related**: [Visibility System](./visibility-system.md) — gates dynamic tile data per player.

---

## 1. Current Architecture (600 systems) — What We're Replacing

### Three data sources
1. **Atlas** (`/api/game/atlas`) — all systems, regions, connections. `staleTime: Infinity`. Used for point cloud dots + territories.
2. **Viewport** (`/api/game/systems/viewport?minX=...`) — systems in bounding box with full detail. Triggers at zoom 0.28. `staleTime: 30s`. Has quantization (grid 500) + 2x buffer.
3. **Events** (`/api/game/events`) — all active events globally. Fetched once, invalidated by tick SSE.

### Problems at scale
- **Viewport cache misses**: Every pan generates unique bounds → unique cache key → re-fetch. Quantization helps but small pans still miss.
- **Viewport triggers too early**: Fires at zoom 0.28 where the frustum covers nearly the entire map. Names aren't readable until ~0.5.
- **Viewport fetches unused data**: Traits and descriptions only needed on click, not for map rendering.
- **Events are global**: All events sent to every client regardless of proximity. Bandwidth scales linearly with event count × player count.

---

## 2. Target Architecture (10K systems)

Four tiers, each with a distinct caching strategy and update frequency.

### Tier 1: Atlas (topology — all systems, one-time)

Unchanged from current implementation, with caching improvements.

- **What**: `id, x, y, regionId, economyType, isGateway, connections, regions`
- **When**: App startup, cached forever
- **Why**: Point cloud rendering, territory boundaries, navigation pathfinding, visibility BFS graph
- **Client cache**: `staleTime: Infinity` (TanStack Query)
- **HTTP cache**: `Cache-Control: public, max-age=31536000, immutable`
- **Size at 10K**: ~10K systems × ~50B + ~40K connections × ~40B ≈ 2MB. Acceptable for one-time load. gzip reduces to ~300-500KB.

### Tier 2: Static Tiles (display labels — per viewport, immutable)

New. Replaces the viewport API for static display data.

- **What**: `name, economyType, traitIcons[]` per system. Everything the map needs for zoomed-in labels beyond the atlas dots.
- **When**: Zoom crosses "names visible" threshold (~0.5). Only visible tiles fetched.
- **Why**: System name labels, economy badges, trait icon hints at medium zoom.
- **Not visibility-gated**: System names and economy types are "star chart" data — publicly known. All players see the same static tiles.
- **Client cache**: `staleTime: Infinity` (TanStack Query). Fetched once per tile, never re-fetched.
- **HTTP cache**: `Cache-Control: public, max-age=31536000, immutable`. Browser HTTP cache is the primary cache — TanStack never even makes a second request.

#### How static tiles work

- Map divided into a fixed grid over `MAP_SIZE`. Grid dimensions TBD based on final system count and map size — target ~30-50 systems per tile.
- One API route: `/api/game/systems/tile/static?col=3&row=5`
- One TanStack Query per tile: `queryKey: ["tile", "static", col, row]`
- Client computes visible tile coords from current frustum bounds
- TanStack deduplicates concurrent fetches to the same tile key
- Panning: most tiles already cached from browser HTTP cache, only edge tiles fetch (0-2 requests per pan)
- Response size: ~40 systems × ~50 bytes ≈ 2KB per tile

#### Why TanStack + HTTP caching together

- **HTTP `Cache-Control: immutable`**: Browser caches the response. Second request to same tile URL never hits the server. Primary cache.
- **TanStack Query**: Client-side state management. Merges tile data into React render pipeline. Deduplicates concurrent requests. Provides `isPending` states for loading UI. Secondary cache.
- **Next.js route handlers**: Routes with `searchParams` are always dynamic in Next.js — can't be statically generated. The `Cache-Control` header achieves the same result at the browser level.

### Tier 3: Dynamic Tiles (live game state — per viewport, per player)

New. Replaces the global events endpoint and adds per-player game state to the map.

- **What**: Minimal dynamic data per system — just enough for map icons:
  - `eventTypeIds: string[]` — show event icon next to system (~20B)
  - `hasPlayerShips: boolean` — show ship presence indicator (~1B)
  - `danger: number` — color-code system dot by danger level (~4B)
  - `visibility: "visible" | "unknown"` — per system
- **When**: Same zoom threshold as static tiles (~0.5). Fetched alongside static tiles but with different caching.
- **Why**: Live game state that changes per tick and varies per player.
- **Visibility-gated**: Only returns dynamic data for systems in the player's visibility set (see [Visibility System §2](./visibility-system.md)). Unknown systems return `{ visibility: "unknown" }` with no data.
- **Client cache**: Short `staleTime` tied to tick rate (~5-10s). Invalidated by tick SSE.
- **HTTP cache**: `Cache-Control: private, no-cache` — responses are per-player and change on tick. `ETag` or `Last-Modified` based on current tick ID to allow conditional requests.

#### How dynamic tiles work

- Same grid as static tiles — same col/row coordinates
- One API route: `/api/game/systems/tile/dynamic?col=3&row=5` (requires auth)
- Server computes player's visibility set (BFS from ship positions — see [Visibility System §2.3](./visibility-system.md))
- Filters tile systems: only include dynamic data for visible systems
- Response size: ~25 bytes per visible system. Most tiles will be partially or fully unknown. Worst case (all 40 systems visible): ~1KB.

#### Why separate static and dynamic tiles

- Static tiles are `Cache-Control: immutable` and identical for all players → browser never re-fetches, zero server load after first visit
- Dynamic tiles are per-player and change per tick → must hit the server, but payloads are tiny
- Combining them would make the entire tile per-player and uncacheable, losing the immutable cache benefit for the static data that represents 80% of the tile payload

### Tier 4: System Detail (per click, on demand)

Existing endpoint, enhanced with visibility gating.

- **What**: Full system info — description, traits (enriched names/descriptions), market prices, supply/demand, active events with full detail, docked ships
- **When**: Player clicks a system on the map
- **Route**: Existing `/api/game/systems/[systemId]`
- **Visibility gating**: Visible systems return full detail. Unknown systems return atlas-level data only (name, economy type, region, connections) with a "no current intel" indicator.
- **Client cache**: `staleTime: Infinity` for visible systems (invalidated by tick SSE when relevant). Unknown systems cached briefly (player might gain visibility soon).
- **UI**: System detail panel shows header immediately (name from static tile), loads detail async. Unknown systems show a reduced panel with available info.

---

## 3. Resolved Design Questions

These were open questions in the previous version of this doc. All resolved.

### Events at scale → Visibility-gated dynamic tiles

**Decision**: Events are embedded in dynamic tile responses, filtered by player visibility. No global event broadcast. A player only sees events at systems where they have sensor range (ships within N hops).

**Rationale**: Events are dynamic, per-player data — they belong in the dynamic tile, not a separate global endpoint. The visibility system naturally solves the bandwidth and relevance problems. See [Visibility System §3.3](./visibility-system.md).

### Information propagation / fog of war → Hybrid visibility

**Decision**: Hybrid model. Atlas topology (star positions, connections, regions) is always visible. Static identity (names, economy types, trait icons) is always visible. Dynamic state (events, ship presence, danger, prices) requires sensor range from the player's ships.

**Rationale**: The galaxy's shape is public knowledge — you can see the stars. What's happening at those stars requires eyes on the ground. This creates exploration incentive and information scarcity without hiding the map structure. See [Visibility System](./visibility-system.md) for full design.

### Ship/fleet visualization at scale → Ship presence boolean in dynamic tiles

**Decision**: Dynamic tiles include a `hasPlayerShips: boolean` per system. Detailed ship/fleet info is on the system detail endpoint (Tier 4). No global fleet data on the map.

**Rationale**: The map only needs to show "you have ships here" as an icon. Full fleet composition (ship names, cargo, status) is detail-on-click. Other players' ships are a multiplayer concern — deferred to multiplayer infrastructure.

### Connection rendering at universe zoom → Deferred

**Decision**: Not part of this work. Connections currently render at system zoom. Gateway-to-gateway route rendering at universe zoom is a visual polish item that can be added independently.

---

## 4. What We Can Ship Now (Pre-Tile Quick Wins)

These improve the current 600-system map without the tile architecture. They're optional — the tile system replaces all of them. But if we want incremental progress before the full tile rework:

1. **Set `Cache-Control: immutable`** on atlas response — free performance win
2. **Raise viewport zoom threshold** to ~0.5 (where names are actually readable)
3. **Drop traits from viewport response** — only name needed for map labels
4. **System detail panel lazy-loads** description + traits on click instead of preloading in viewport

---

## 5. Implementation

See **[Map Scaling Roadmap](./map-scaling-roadmap.md)** for the unified phase sequence across data loading and visibility. This doc covers Phases 1-4 of the roadmap (atlas caching, static tiles, dynamic tiles + visibility, cleanup).

---

## Related Design Docs

- **[Visibility System](./visibility-system.md)** — player visibility model that gates dynamic tiles
- **[Faction System](./faction-system.md)** — faction territories affect visibility (future)
- **[Universe](../active/universe.md)** — current universe generation (will need scaling updates)
