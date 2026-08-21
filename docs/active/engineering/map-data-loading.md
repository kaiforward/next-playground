# Map Data Loading

How the map gets data for a universe that can hold ~10,000 systems without crippling the browser. The core idea: keep a lightweight point-cloud for drawing the whole galaxy, and a richer per-system record for on-screen detail — but both live in the store already, not behind a fetch.

> Every system is fully visible — there is **no fog of war**. Per-player, ship-based visibility is planned (see [grand-strategy-vision.md](../../planned/grand-strategy-vision.md)); the plumbing that would gate detail by a visibility set is noted below where it still shapes the design.

---

## Where the data comes from

The game worker (`client/worker/`) holds the world and pushes a `StateFrame` to the UI thread — a `postMessage` carrying named slices (`buildStateFrame`, `lib/runtime/snapshot.ts`). The UI-side store (`lib/store/`) applies each frame with structural sharing: an unchanged slice keeps its object identity, so a hook reading one slice (`useGameSlice`) only re-renders when that slice actually changed, never on an unrelated one. Every slice named in `SnapshotSlices` rides the first frame a subscriber receives; nothing is fetched afterward — a hook is a synchronous read of whatever the store currently holds.

The two tiers below are two different *slices* of that one frame protocol, not two fetch strategies — the split is about how each is worked with client-side, not about network cost.

---

## The Two-Tier Model

### Tier 1 — Atlas (the whole galaxy's shape)

A single lightweight point-cloud of the entire universe: every system's id, position, region, and owning faction, plus all connections, region/faction metadata, and a `meta` block (`mapSize`, `systemCount`, `seed`). No names, descriptions, prices, or events — just enough to draw the dots, region territories, and the navigation/adjacency graph.

- Read via `useAtlas()` (`lib/hooks/use-atlas.ts`) — the store's `atlas` slice, falling back to an empty player-less atlas before the first frame lands.
- Drives the universe-zoom point cloud, territory polygons, and the in-memory adjacency graph used for pathfinding.
- **Map extent comes from `meta.mapSize`**, generated from the requested system count — the client reads it here rather than recomputing from an env var (there is no `UNIVERSE_SCALE`).

Source: `lib/services/atlas.ts` (`getAtlas`), assembled into the `atlas` slice by `buildStateFrame`.

### Tier 2 — Universe detail, filtered client-side per viewport

The richer per-system record — name, economy type, position — for every system in the world rides the store's `universe` slice (`getUniverse`, `lib/services/universe.ts`) as part of the same frame; nothing further is fetched to show it. `useStaticTiles` (`lib/hooks/use-static-tiles.ts`) is a **pure client-side filter** of that slice: the map is divided into a fixed 16×16 grid (`lib/engine/tiles.ts`), and when the camera zooms past the label threshold (0.35) the hook computes which tiles the frustum overlaps (`frustumToTiles`) and filters `universe.systems` down to the ones inside those tile bounds — an in-memory `Array.filter`, not a request. Viewport changes are throttled (leading + trailing edge, 150 ms) so continuous pan/zoom doesn't recompute on every frame.

Source: `lib/services/universe.ts` (`getUniverse`), `lib/hooks/use-static-tiles.ts`.

### System detail (on click)

Full per-system detail (description, prices, stock, active events) is read from the store's per-id slices (`systemVitals`, `systemPopulation`, `systemIndustry`, etc. — `SnapshotSlices`), keyed by system id and populated as part of the frame. Every system carries full intel — there is no visibility gate in this slice.

---

## Map modes and visibility

Map modes (stability, population, development, migration, ownership, trade flow) are each their own named slice in `SnapshotSlices` — small, tick-scoped, whole-galaxy payloads independent of the tile grid — applied with the same structural-sharing merge as everything else, so switching modes never touches slices the newly-active mode doesn't own. Read via the matching hook (`use-stability.ts`, `use-population.ts`, etc.).

There is no fog of war, so nothing is visibility-gated. The `visibility` slice carries **every** system id unconditionally (`buildStateFrame` emits the full set — the arrival-driven partial visibility an old design once described was never wired, see `use-visibility.ts`'s own docstring), and `useVisibility()` wraps it in a `Set` for the map's fog-of-war checks.

Per-player visibility — a BFS over the atlas graph from a player's ships, memoised per tick — is planned (it needs ships and a faction viewpoint). The visibility engine (`lib/engine/visibility.ts`) and its rules are in place for it.

---

## How It Holds Up at 10K Systems

- **One whole-galaxy transfer, not a fetch.** The full `atlas` and `universe` slices ride the worker's first frame to a subscriber as a single `postMessage` (structured clone, in-process — no HTTP round trip, no serialisation-over-the-network latency). After that, both live in the store as plain in-memory data.
- **Detail scales with the screen, not the universe.** `useStaticTiles`'s frustum filter costs one pass over `universe.systems` per throttled viewport change, bounded by how many systems fall inside the visible tiles — not by total system count. Zooming in on a corner of a 10K-system galaxy costs the same filter as on a 600-system one.
- **Every read is a synchronous memory read.** There is no cache to invalidate and nothing to re-fetch — a store slice either changed (new object identity, subscribers re-render) or it didn't (same identity, nothing re-renders).
- **Map-mode payloads stay tiny.** Each tick-scoped all-systems slice (stability, population, development, migration, ownership, trade flow) carries only a few numbers per system, so it stays small even for the whole universe, and structural sharing means an unrelated slice's write never forces a map-mode re-render.
