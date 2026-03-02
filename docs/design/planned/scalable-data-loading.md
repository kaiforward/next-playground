# Scalable Map Data Loading — Design Doc

**Status**: Design discussion — not ready for implementation.
**Context**: The current map loads 600 systems. We're scaling to ~10,000. The current viewport API has caching problems that will get worse at scale. This doc captures the architecture we're converging on and the open questions.

---

## Current Architecture (600 systems)

### Three data sources
1. **Atlas** (`/api/game/atlas`) — all systems, regions, connections. `staleTime: Infinity`. Fields: `id, x, y, regionId, economyType, isGateway`. Used for point cloud dots + territories.
2. **Viewport** (`/api/game/systems/viewport?minX=...`) — systems in bounding box with full detail (name, description, traits). Triggers at zoom 0.28. `staleTime: 30s`. Has quantization (grid 500) + 2x buffer.
3. **Events** (`/api/game/events`) — all active events globally. Fetched once, invalidated by tick SSE.

### Problems at scale
- **Viewport cache misses**: Every pan generates unique bounds -> unique cache key -> re-fetch. Even with quantization, small pans at the same zoom level miss the cache constantly.
- **Viewport triggers too early**: Fires at zoom 0.28 where the frustum covers nearly the entire map. Names aren't readable until ~0.5.
- **Viewport fetches unused data**: Traits and descriptions only needed on click, not for map rendering.
- **Events are global**: All events loaded regardless of where the player is or what's on screen.

---

## Proposed Architecture (10K systems)

### Tier 1: Atlas (topology — all systems, one-time)
- **What**: id, x, y, regionId, economyType, isGateway, connections, regions
- **When**: App startup, cached forever
- **Why**: Point cloud rendering, territory computation, navigation pathfinding
- **Caching**: `staleTime: Infinity` client-side. Could add `Cache-Control: immutable` server-side.
- **Size at 10K**: ~10K systems x ~50 bytes + ~40K connections x ~40 bytes ~ ~2MB. Acceptable for one-time load. May want gzip.

### Tier 2: Tiles (display detail — per viewport, static)
- **What**: name, traits (for richer zoomed-in labels). Everything the map needs beyond atlas dots.
- **When**: Zoom crosses "names visible" threshold (~0.5). Only visible tiles fetched.
- **Why**: Names for system labels. Traits for badge/icon hints at medium zoom.
- **Caching**: `staleTime: Infinity` per tile (static data). Plus `Cache-Control: immutable` header so the browser HTTP cache handles it — TanStack Query never re-fetches.

#### How tiles work
- Map divided into fixed grid (e.g., 16x16 = 256 tiles over MAP_SIZE)
- One API route: `/api/game/systems/tile?col=3&row=5`
- One TanStack Query per tile: `queryKey: ["tile", col, row]`
- Client computes visible tile coords from frustum bounds
- TanStack deduplicates concurrent fetches to same key
- Panning: most tiles already cached, only edge tiles are new (0-2 fetches)
- At 10K systems / 256 tiles ~ ~40 systems per tile. Response ~2KB per tile.

#### Why TanStack + HTTP caching together
- **HTTP `Cache-Control: immutable`**: Browser caches the response. Second request to same tile URL never hits the server. This is the primary cache.
- **TanStack Query**: Client-side state management. Merges tile data into React render pipeline. Deduplicates concurrent requests. Provides `isPending` states. The cache here is a bonus, not the primary mechanism.
- **Next.js static routes**: Route handlers with `searchParams` are always dynamic in Next.js — they can't be statically generated. But the `Cache-Control` header achieves the same result at the browser level.

### Tier 3: System detail (per click, on demand)
- **What**: description, traits (enriched with names/descriptions), station info
- **When**: Player clicks a system on the map
- **Route**: Existing `/api/game/systems/[systemId]` — already built
- **Caching**: `staleTime: Infinity` (static data). Fetched once per system, cached forever.
- **UI**: System detail panel shows header immediately (name from tile data), loads description/traits async.

---

## Open Questions

### Events at scale
Currently `getActiveEvents()` loads ALL events globally (`prisma.gameEvent.findMany()` with no filter). At 10K systems with proportionally more events, this becomes:
- **Bandwidth problem**: Sending all events to every client on every tick
- **Relevance problem**: Most events aren't near the player's viewport

Options:
- **Tile-based events**: Same grid as system tiles, but dynamic (`staleTime` tied to tick rate). Fetched per visible tile. Server filters by region/system location.
- **Region-based events**: Coarser than tiles. Fetch events for visible regions only.
- **Player-proximity events**: Only events in regions where the player has ships. This is the fog-of-war question below.

### Information propagation / fog of war
Should a player see events everywhere, or only near their ships? This is a game design decision with major architectural implications:

**Full visibility** (current):
- Simpler architecture — broadcast everything
- Player can plan routes to avoid distant threats
- Less atmospheric / less discovery

**Fog of war**:
- Player only sees events in systems/regions where they have ships or have recently visited
- Creates exploration incentive and information asymmetry
- Data loading becomes player-scoped, not viewport-scoped
- Changes the question from "what's on screen" to "what does this player know about"
- Affects: event loading, system detail, possibly even connection discovery
- Much more complex — needs a "known systems" concept per player

**Hybrid** (likely best):
- Atlas topology is always visible (you can see the stars)
- Events and dynamic state only visible near player ships
- "Rumors" system: distant events arrive delayed or with less detail
- Ties into the planned faction system (faction intel networks)

### Ship/fleet visualization at scale
Currently ship counts per system come from fleet data (loaded globally). At 10K systems:
- Other players' ships become relevant (multiplayer)
- Ship markers need spatial filtering like events
- Ties into the multiplayer infrastructure design

### Connection rendering at universe zoom
Connections should be visible on the zoomed-out map (for route visualization). Currently connections only render at system zoom. Could render a simplified connection graph (only gateway-to-gateway routes?) at universe zoom using the point cloud layer or a new lightweight edge layer.

---

## What we can ship now (incremental)

These don't depend on the open questions and improve the current 600-system map:

1. **Drop traits from viewport response** — only name needed for map labels, traits on click
2. **Raise viewport zoom threshold** to ~0.5 (where names are actually readable)
3. **System detail panel lazy-loads** description + traits from `/api/game/systems/[systemId]` on click
4. **Set `Cache-Control: immutable`** on atlas response

The tile system is the right architecture but depends on deciding tile size, which depends on the target system count and map size — both tied to the 10K scaling work.
