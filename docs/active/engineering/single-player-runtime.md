# Single-Player Runtime

The living galaxy runs locally as an observable simulation — **no Postgres, no login, no server**. The world lives in memory inside a Web Worker in the browser tab (a Node process for `npm run simulate`); services read it directly; save/load is JSON snapshots (IndexedDB in the browser, local disk under a desktop shell); a thin start screen (system count + seed) is the entry point; and the tick advances under pause/speed controls up to a CPU-bound max. Every system is fully visible — there is no fog of war.

This doc covers world storage, world generation and the save format. The worker↔UI channel, the snapshot store, commands and lifecycle are [client-runtime.md](./client-runtime.md). The tick pipeline itself is [tick-engine.md](./tick-engine.md); the per-processor pattern is [processor-architecture.md](./processor-architecture.md).

---

## The world lives in memory

The whole world is a single in-memory object held by a globalThis-cached store (`lib/world/store.ts`):

- `getWorld()` returns the current `World` or throws `ServiceError(409)` if none is loaded; `hasWorld()` is the cheap presence check the worker's world-existence gate reads; `setWorld(world)` replaces it wholesale and bumps a monotonic `version`; `clearWorld()` drops it.
- The store is `globalThis.__world`, so a dev worker's module reload doesn't spawn a second world (see [client-runtime.md](./client-runtime.md)'s Development loop).
- `version` is a plain change counter (used to key caches / detect new-game swaps), **not** a tick-level optimistic lock. Ticks don't contend: one in-process loop owns advancement.

`World` (`lib/world/types.ts`) is **hand-owned and JSON-serialisable**: flat arrays of plain rows (`WorldSystem`, `WorldMarket`, `WorldBuilding`, `WorldEvent`, …) plus a `meta` block (`{ currentTick, systemCount, seed, mapSize }`) and a `player` seat (`{ controlledFactionId } | null`). No `Map`/`Set`/`Date`/class instances ever enter world state — that keeps it structured-clone-able (save files, and the worker's own message channel) and schema-faithful to the pre-pivot relational shape.

## World generation

`generateWorld(systemCount, seed)` (`lib/world/gen.ts`) is the pure, in-process world generator — invoked synchronously on **New game**, it returns a fully-populated `World`. Generation params scale continuously with system count via `genConfigForSystemCount` (`lib/constants/universe-gen.ts`): map extent, region count, region spacing, and minor-faction count interpolate over `√N` between the 600-system and 10K anchors.

- There is **no scale env var** (`UNIVERSE_SCALE`), and no client-bundle scale gotcha. Map extent is `meta.mapSize`, generated from the requested system count and read by the UI from the snapshot's `atlas` slice like any other world data.
- `systemCount` is Zod-validated to a sane range (50–20,000) at the `newGame` command boundary; `seed` is optional (a random one is minted when blank).

## Save / load

A save is **one JSON snapshot of the whole world**, written through a swappable backend
(`SaveBackend`, `lib/world/save-backend.ts` — the seam [client-runtime.md](./client-runtime.md)'s
Persistence section covers): IndexedDB in the browser, real files on local disk under a desktop
shell or `npm run simulate`.

- `lib/world/save.ts` is pure and worker-importable: `serialise` wraps the world in a `{ formatVersion: 1, world }` envelope; `deserialise` narrows an untrusted parse honestly (guard-predicate style, no `as`) and returns `null` on any shape mismatch. `sanitiseSaveName` and `AUTOSAVE_NAME` live here too so the start screen and every backend share one definition.
- `lib/world/save-files.ts` is the **only `fs` importer in `lib/`** — the Node/file `SaveBackend` implementation, reached only via dynamic `import()` so the static graph stays Node-free. Writes are atomic (temp file + rename); names are sanitised to `[a-z0-9-_]`; `saves/` is git-ignored.
- **One rolling autosave** (`autosave`) plus manual named saves. The autosave is written every 60 s of wall-clock while running, on pause, and on tab close/refresh in the web packaging.
- **Pre-1.0 rule: saves break on upgrade.** There is no migration — when world shape changes, `deserialise` rejects the old snapshot as invalid. No compression until file size proves it necessary.

## The tick loop & speed

`TickLoop` (`lib/world/tick-loop.ts`) is a globalThis-cached singleton that paces `runWorldTick` against the store and broadcasts each tick's global events over the worker channel ([client-runtime.md](./client-runtime.md) covers the frame shapes and delivery).

- **Speed steps:** `paused · 1 · 5 · max`. Paced speeds fire on a `setInterval`; **max** runs a yielding loop — it ticks for a ~50 ms budget, then yields the event loop so the worker keeps answering messages and posting frames, and reports *achieved* ticks/sec rather than promising a rate.
- **Wall-clock is pacing only.** `Date.now`/`setInterval`/`setTimeout` drive cadence, the broadcast throttle, and autosave timing — **never** tick math, which stays deterministic inside `runWorldTick`.
- **Broadcast throttle:** at most ~4 emits/sec (250 ms, latest-wins) so `max` speed can't flood the UI thread with frames — per-tick delivery was never a contract.
- **A failing tick hard-pauses the loop.** If `runWorldTick` throws, the loop pauses and does **not** `setWorld` — the broken world is never committed and never autosaved, and `currentTick` doesn't advance. Atomicity comes from the store only accepting a fully-successful tick, not from a transaction. The failure's cause rides a `tickFailed` message to the UI (see [client-runtime.md](./client-runtime.md)'s worker-failure section) rather than reaching only a console.

## Entry & lifecycle

The start screen is the entry surface: **Continue** (rolling autosave) · **Load** (named saves) · **New game** (author a faction, then system count + optional seed). Listing saves, new game and load game are worker commands valid before a world exists — see [client-runtime.md](./client-runtime.md)'s Entry and lifecycle section for the command boundary and the world-existence gate.

## No fog of war

Every system is fully visible — the snapshot's `visibility` slice carries every system id. Per-player, ship-based visibility is planned (see [grand-strategy-vision.md](../../planned/grand-strategy-vision.md)); the data plumbing is in [map-data-loading.md](./map-data-loading.md).

## Purity & multiplayer-someday guardrails

- **Engine, services, and world-gen are pure TS** — no `fs`, no `process.env` reads, no DB — with the Node-touching code (disk saves, env) confined to thin adapters nothing else imports. This is what let the engine move into a Web Worker as a transport swap rather than a rewrite, and is what keeps it running unmodified under Node for `npm run simulate`.
- **Determinism:** seeded RNG (`tickRng(seed, tick)` = `mulberry32`), no wall-clock reads inside the tick. This is what keeps Paradox-style lockstep multiplayer open — no database and no stateful server are required, only a command boundary (player verbs applied at tick boundaries) crossing a stateless relay.
- **Known deferred constraint:** JS transcendental `Math` functions are implementation-defined and could diverge in the last bit across engines and desync a lockstep session — solved at MP time via same-engine packaging or a deterministic math shim, not designed for now.

## Not yet implemented

Planned, not built (see [grand-strategy-vision.md](../../planned/grand-strategy-vision.md)):

- **Fog of war** — every system is fully visible; see "No fog of war" above.
- **Time fiction** — a tick has no defined in-fiction span. What is wanted first is a shared measuring language (wall-clock per speed setting, the 24-tick cycle as the unit pacing arguments are made in), not a design of game-time itself.
- **Desktop (Electron/Tauri) packaging** — the worker-side engine extraction and the client-only runtime have shipped ([client-runtime.md](./client-runtime.md)); the save-backend seam and worker channel are the prerequisites, both built. Choosing and wiring the shell is the remaining roadmap row.
- **Player fleets.** Ship travel, the fleet models and the `ship-arrivals` processor exist in the backend, but world-gen seeds no ships (`ships: []`), so they stay dormant until fleets are built.
