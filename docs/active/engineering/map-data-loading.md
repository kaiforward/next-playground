# Map Data Loading

How the map fetches data for a universe that can hold ~10,000 systems without crippling the browser or the server. The core idea: load the whole galaxy's *shape* once, then stream the *detail* only for what's on screen and only for what the player can actually see.

---

## Why It's Split This Way

A naive map loads every system's full record up front. At 600 systems that's fine. At 10,000 it isn't — the payload balloons, every pan re-queries, and per-player dynamic state (events, danger, ship presence) gets broadcast to everyone regardless of where they are.

The fix is to separate data by **how often it changes** and **who it's for**, and cache each tier accordingly:

- **Topology** (where the stars are, how they connect) never changes after seed and is the same for everyone → load once, cache hard.
- **Display labels** (names, economy types) never change either, but there are too many to load all at once → load per on-screen tile, cache forever.
- **Live game state** (events, danger, your ships) changes every tick and differs per player → fetch fresh, keep payloads tiny, gate by visibility.

Mixing these tiers would force the cacheable 80% of the payload to inherit the uncacheable lifetime of the dynamic 20%. Keeping them apart lets the bulk of the data sit in cache untouched while only the small, volatile slice hits the server each tick.

---

## The Two-Tier Model

### Tier 1 — Atlas (the whole galaxy, loaded once)

A single lightweight point-cloud of the entire universe: every system's id, position, region, economy type, gateway flag, and owning faction, plus all connections and region/faction metadata. No names, descriptions, traits, prices, or events — just enough to draw the dots, region territories, and the navigation/visibility graph.

- Fetched once at mount, held with `staleTime: Infinity` in TanStack Query.
- Drives the universe-zoom point cloud, territory polygons, and the in-memory adjacency graph used for pathfinding and visibility BFS.
- HTTP cache is `private, max-age=3600` — **not** `immutable`. The atlas is auth-gated (per-player session) so a shared/immutable cache could leak one player's response to another, and `immutable` would serve stale topology across a reseed. A short private max-age is the safe choice; TanStack handles in-memory reuse.

Source: `lib/services/atlas.ts`, `app/api/game/atlas/route.ts`.

### Tier 2 — Tiles (on-screen detail, loaded per viewport)

The map is divided into a fixed 16×16 grid over the world (`lib/engine/tiles.ts`). When the camera zooms in past the label threshold, the client computes which tiles the frustum overlaps (`frustumToTiles`) and fetches detail only for those. Panning reuses already-cached tiles and only fetches the new edge tiles.

Tile data comes in two flavours with deliberately different caching:

**Static tile data** — names, economy types, trait hints. This is "star chart" data: public, identical for every player, and never changes after seed.
- One request per tile: `/api/game/systems/tile/static?col=X&row=Y`.
- `staleTime: Infinity`, `gcTime: Infinity` — fetched once per tile, never refetched.
- Activates slightly before names render (zoom ~0.35) so labels are ready when they fade in. Viewport callbacks are throttled to avoid a fetch storm during continuous zoom.

Source: `lib/services/static-tiles.ts`, `app/api/game/systems/tile/static/route.ts`, `lib/hooks/use-static-tiles.ts`.

**Dynamic data** — events, danger, ship presence. This changes every tick and differs per player, so it can't be cached like static tiles.
- Served by a single endpoint, `/api/game/systems/dynamic`, that returns dynamic state for **all** of the player's visible systems at once (not per-tile). Decoupling it from the viewport eliminates the flicker and redundant fetches that a viewport-keyed query causes on every pan, and the per-system payload is tiny enough that one combined response stays small.
- `staleTime: 10s`, invalidated by the tick SSE (`shipArrived` / event notifications) so the map updates as the world advances.
- `private, no-cache` — per-player and tick-scoped.
- Visibility-gated: only systems in the player's visibility set get dynamic data (see [Fog of War in universe.md](../gameplay/universe.md#fog-of-war--visibility)).

Source: `lib/services/dynamic-tiles.ts`, `app/api/game/systems/dynamic/route.ts`, `lib/hooks/use-dynamic-tiles.ts`.

### System detail (on click)

Full per-system detail (description, traits, prices, supply/demand, active events, docked ships) loads on demand when a system is clicked, via the existing system-detail endpoint. Visible systems return full intel; unknown systems return atlas-level data only.

---

## The Visibility Cache

Fog of war means each dynamic request must know which systems the player can currently see. That's a BFS over the atlas graph from every one of the player's ships — cheap per run, but wasteful to recompute on every tile or dynamic fetch within the same tick.

`lib/services/visibility-cache.ts` memoises the result keyed by `(playerId, currentTick)`:

- A player's ships only move on a tick, so their visibility set is stable between ticks.
- The first request in a tick computes the BFS (loading ships + the shared adjacency list); every subsequent request that tick reuses it.
- The cache is invalidated naturally when the tick advances, and can be force-cleared (`invalidateVisibilityCache`) after an out-of-band ship move.

The visibility set is exposed directly via `/api/game/systems/visibility` (consumed by `use-visibility` for fog-of-war rendering) and is also the gate the dynamic-data service applies before returning live state.

The visibility *rules* (sensor range per ship role, what gets gated) are gameplay and live in [universe.md → Fog of War / Visibility](../gameplay/universe.md#fog-of-war--visibility); the engine is `lib/engine/visibility.ts`.

---

## How It Holds Up at 10K Systems

- **One bounded up-front load.** The atlas is the only request that scales with universe size, and it's a slim point cloud (gzipped to a few hundred KB at 10K) fetched once.
- **Detail scales with the screen, not the universe.** Tile fetches are bounded by how many tiles fit in the frustum, not by total system count. Zooming in on a corner of a 10K-system galaxy costs the same as on a 600-system one.
- **The expensive 80% never re-hits the server.** Static tiles are immutable per-tile and shared across players, so after first view they sit in cache.
- **The volatile 20% stays tiny and relevant.** Dynamic data is minimal-per-system, gated to visible systems, and computed off a once-per-tick cached BFS — so it doesn't grow with universe size or fan out to every player.
