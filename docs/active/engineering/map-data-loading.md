# Map Data Loading

How the map fetches data for a universe that can hold ~10,000 systems without crippling the browser or the server. The core idea: load the whole galaxy's *shape* once, then stream the *detail* only for what's on screen.

> Every system is fully visible — there is **no fog of war**. Per-player, ship-based visibility is planned (see [grand-strategy-vision.md](../../planned/grand-strategy-vision.md)); the plumbing that would gate detail by a visibility set is noted below where it still shapes the design.

---

## Why It's Split This Way

A naive map loads every system's full record up front. At 600 systems that's fine. At 10,000 it isn't — the payload balloons and every pan re-queries.

The fix is to separate data by **how often it changes** and cache each tier accordingly:

- **Topology** (where the stars are, how they connect) never changes after world-gen → load once, cache hard.
- **Display labels** (names, economy types) never change either, but there are too many to load all at once → load per on-screen tile, cache forever.
- **Live game state** (events, danger) changes every tick → fetch fresh, keep payloads tiny.

Mixing these tiers would force the cacheable 80% of the payload to inherit the uncacheable lifetime of the dynamic 20%. Keeping them apart lets the bulk of the data sit in cache untouched while only the small, volatile slice hits the server each tick.

---

## The Two-Tier Model

### Tier 1 — Atlas (the whole galaxy, loaded once)

A single lightweight point-cloud of the entire universe: every system's id, position, region, economy type, gateway flag, and owning faction, plus all connections, region/faction metadata, and a `meta` block (`mapSize`, `systemCount`, `seed`). No names, descriptions, prices, or events — just enough to draw the dots, region territories, and the navigation/adjacency graph.

- Fetched once at mount, held with `staleTime: Infinity` in TanStack Query.
- Drives the universe-zoom point cloud, territory polygons, and the in-memory adjacency graph used for pathfinding.
- **Map extent comes from `meta.mapSize`**, generated from the requested system count — the client reads it here rather than recomputing from an env var (there is no `UNIVERSE_SCALE`).
- HTTP cache is `private, no-cache` — **not** `immutable` or a long `max-age`. The atlas is keyed by the current world's system ids, which change when a new game is generated; a long cache would serve stale ids that mismatch the live tile/dynamic data. Revalidate-on-use is the safe choice; TanStack handles in-memory reuse.

Source: `lib/services/atlas.ts`, `app/api/game/atlas/route.ts`.

### Tier 2 — Tiles (on-screen detail, loaded per viewport)

The map is divided into a fixed 16×16 grid over the world (`lib/engine/tiles.ts`). When the camera zooms in past the label threshold, the client computes which tiles the frustum overlaps (`frustumToTiles`) and fetches detail only for those. Panning reuses already-cached tiles and only fetches the new edge tiles.

Tile data comes in two flavours with deliberately different caching:

**Static tile data** — names, economy types. This is "star chart" data: it never changes for the life of a generated world.
- One request per tile: `/api/game/systems/tile/static?col=X&row=Y`.
- `staleTime: Infinity`, `gcTime: Infinity` — fetched once per tile, never refetched.
- Activates slightly before names render (zoom ~0.35) so labels are ready when they fade in. Viewport callbacks are throttled to avoid a fetch storm during continuous zoom.

Source: `lib/services/static-tiles.ts`, `app/api/game/systems/tile/static/route.ts`, `lib/hooks/use-static-tiles.ts`.

**Dynamic data** — events and danger. This changes every tick, so it can't be cached like static tiles.
- Served by a single endpoint, `/api/game/systems/dynamic`, that returns dynamic state for **all** systems at once (not per-tile). The combined payload is tiny per system, so one response stays small; the client does viewport culling itself. Decoupling it from the viewport also eliminates the flicker and redundant fetches a viewport-keyed query causes on every pan.
- `staleTime: 10s`, invalidated by the tick SSE (event notifications) so the map updates as the world advances.
- `private, no-cache` — tick-scoped.
- No visibility gate — with no fog of war, every system's dynamic state is returned. Danger derives purely from the events currently active on a system (ship presence is gone with the fleet UI).

Source: `lib/services/dynamic-tiles.ts`, `app/api/game/systems/dynamic/route.ts`, `lib/hooks/use-dynamic-tiles.ts`.

### System detail (on click)

Full per-system detail (description, prices, stock, active events) loads on demand when a system is clicked, via the system-detail endpoint. Every system returns full intel — there is no visibility gate in this slice.

---

## Visibility

There is no fog of war, so nothing is gated. `/api/game/systems/visibility` returns **every** system id, and the dynamic-data service returns state for all systems. The `use-visibility` hook receives that full set.

Per-player visibility — a BFS over the atlas graph from a player's ships, memoised per tick — is planned (it needs ships and a faction viewpoint). The visibility engine (`lib/engine/visibility.ts`) and its rules are in place for it.

---

## How It Holds Up at 10K Systems

- **One bounded up-front load.** The atlas is the only request that scales with universe size, and it's a slim point cloud (gzipped to a few hundred KB at 10K) fetched once.
- **Detail scales with the screen, not the universe.** Tile fetches are bounded by how many tiles fit in the frustum, not by total system count. Zooming in on a corner of a 10K-system galaxy costs the same as on a 600-system one.
- **The expensive 80% never re-hits the server.** Static tiles are immutable per-tile for the life of a world, so after first view they sit in cache.
- **The volatile 20% stays tiny.** Dynamic data is minimal-per-system (events + danger only), so it stays small even when returned for the whole universe.
