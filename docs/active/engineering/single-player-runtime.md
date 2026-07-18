# Single-Player Runtime

The living galaxy runs locally as an observable simulation — **no Postgres, no login**. The world lives in memory inside the Next.js server process; services read it directly; save/load is JSON snapshots on local disk; a thin start screen (system count + seed) is the entry point; and the tick advances under pause/speed controls up to a CPU-bound max. Every system is fully visible — there is no fog of war.

This doc covers the runtime substrate. The tick pipeline itself is [tick-engine.md](./tick-engine.md); the per-processor pattern is [processor-architecture.md](./processor-architecture.md).

---

## The world lives in memory

The whole world is a single in-memory object held by a globalThis-cached store (`lib/world/store.ts`):

- `getWorld()` returns the current `World` or throws `ServiceError(409)` if none is loaded; `hasWorld()` is the cheap presence check the layout gates on; `setWorld(world)` replaces it wholesale and bumps a monotonic `version`; `clearWorld()` drops it.
- The store is `globalThis.__world`, so dev-server module reloads don't spawn a second world.
- `version` is a plain change counter (used to key caches / detect new-game swaps), **not** a tick-level optimistic lock. Ticks don't contend: one in-process loop owns advancement.

`World` (`lib/world/types.ts`) is **hand-owned and JSON-serializable**: flat arrays of plain rows (`WorldSystem`, `WorldMarket`, `WorldBuilding`, `WorldEvent`, …) plus a `meta` block (`{ currentTick, systemCount, seed, mapSize }`) and a `player` seat (`{ controlledFactionId } | null`). No `Map`/`Set`/`Date`/class instances ever enter world state — that keeps it structured-clone-able (save files, and a future path-B worker boundary) and schema-faithful to the pre-pivot relational shape.

## World generation

`generateWorld(systemCount, seed)` (`lib/world/gen.ts`) is the pure, in-process world generator — invoked synchronously on **New game**, it returns a fully-populated `World`. Generation params scale continuously with system count via `genConfigForSystemCount` (`lib/constants/universe-gen.ts`): map extent, region count, region spacing, and minor-faction count interpolate over `√N` between the 600-system and 10K anchors.

- There is **no scale env var** (`UNIVERSE_SCALE`), no `next.config.ts` `env` entry for it, and no client-bundle scale gotcha. Map extent is `meta.mapSize`, generated from the requested system count and read by the client from the API like any other world data.
- `systemCount` is Zod-validated to a sane range (50–20,000) at the `/api/game/new` route; `seed` is optional (route mints a random one when blank).

## Save / load

A save is **one JSON snapshot of the whole world**, written under a local `saves/` directory.

- `lib/world/save.ts` is pure and client-importable: `serialize` wraps the world in a `{ formatVersion: 1, world }` envelope; `deserialize` narrows an untrusted parse honestly (guard-predicate style, no `as`) and returns `null` on any shape mismatch. `sanitizeSaveName` and `AUTOSAVE_NAME` live here too so the start-screen form and the disk layer share one definition.
- `lib/world/save-files.ts` is the **only `fs` importer in `lib/`** — the thin Node edge. Writes are atomic (temp file + rename); names are sanitized to `[a-z0-9-_]`; `saves/` is git-ignored. It is loaded via dynamic `import()` from anything on the pure path so the static graph stays Node-free.
- **One rolling autosave** (`autosave`) plus manual named saves. The autosave is written every 60 s of wall-clock while running, and once on pause.
- **Pre-1.0 rule: saves break on upgrade.** There is no migration — when world shape changes, `deserialize` rejects the old snapshot as invalid. No compression until file size proves it necessary.

## The tick loop & speed

`TickLoop` (`lib/world/tick-loop.ts`) is a globalThis-cached singleton that paces `runWorldTick` against the store and broadcasts each tick's global events to SSE subscribers.

- **Speed steps:** `paused · 1 · 5 · max`. Paced speeds fire on a `setInterval`; **max** runs a yielding loop — it ticks for a ~50 ms budget, then yields the event loop so HTTP requests and the map stay responsive, and reports *achieved* ticks/sec rather than promising a rate.
- **Wall-clock is pacing only.** `Date.now`/`setInterval`/`setTimeout` drive cadence, the broadcast throttle, and autosave timing — **never** tick math, which stays deterministic inside `runWorldTick`. The old 5-second tick existed for DB load and is dead; cadence is now a pure game-feel dial.
- **Broadcast throttle:** at most ~4 emits/sec (250 ms, latest-wins) so `max` speed can't melt SSE clients — per-tick delivery was never a contract.
- **A failing tick hard-pauses the loop.** If `runWorldTick` throws, the loop pauses and does **not** `setWorld` — the broken world is never committed and never autosaved, and `currentTick` doesn't advance. Atomicity comes from the store only accepting a fully-successful tick, not from a transaction.

## Entry & lifecycle

The start screen (`app/start/page.tsx`) is the entry surface: **Continue** (rolling autosave) · **Load** (named saves) · **New game** (system count + optional seed). The game layout gates on `hasWorld()` and redirects to `/start` when no world is loaded.

Lifecycle is a handful of thin API routes over `lib/services/game.ts`:

| Route | Purpose |
|---|---|
| `POST /api/game/new` | generate + load a world (Zod 50–20,000, route-side random seed) |
| `POST /api/game/speed` | set loop speed |
| `GET /api/game/world` | `{ meta, speed, achievedTps }` — seeds the client's tick state |
| `GET·POST /api/game/saves` | list · write a named save |
| `POST /api/game/load` | load a named save (or autosave) |

The tick event stream (SSE) is **de-authed and single-client** — the multiplayer fan-out apparatus is gone; what remains is transport. Frames are `TickBroadcast` (`{ currentTick, speed, achievedTps, events }`); a connecting client is seeded from `GET /api/game/world` so its tick position is correct before the first frame arrives.

## No fog of war

Every system is fully visible — the visibility endpoint returns every system id. Per-player, ship-based visibility is planned (see [grand-strategy-vision.md](../../planned/grand-strategy-vision.md)); the data plumbing is in [map-data-loading.md](./map-data-loading.md).

## Purity & multiplayer-someday guardrails

The runtime is packaging **path A** (in-process singleton) held to **path-B purity rules**, so moving the engine into a Web Worker (or a desktop shell) later stays a cheap transport swap:

- **Engine, services, and world-gen are pure TS** — no `fs`, no `process.env` reads, no DB — with the Node-touching code (disk saves, env, HTTP) confined to thin adapters nothing else imports.
- **Determinism:** seeded RNG (`tickRng(seed, tick)` = `mulberry32`), no wall-clock reads inside the tick. This is what keeps Paradox-style lockstep multiplayer open — no database and no stateful server are required, only a command boundary (player verbs applied at tick boundaries) crossing a stateless relay.
- **Known deferred constraint:** JS transcendental `Math` functions are implementation-defined and could diverge in the last bit across engines and desync a lockstep session — solved at MP time via same-engine packaging or a deterministic math shim, not designed for now.

## Not yet implemented

Planned, not built (see [grand-strategy-vision.md](../../planned/grand-strategy-vision.md)): the rest of the player seat — direct control verbs; treasury/budgets and build orders; small-cores world-gen and colonisation; fog of war; the map-first UI redesign; time fiction; desktop (Electron/Tauri) packaging; the worker-side engine extraction. Ship travel, the fleet models, and the `ship-arrivals` processor exist in the backend, but world-gen seeds no ships, so they stay dormant until player fleets are built.
