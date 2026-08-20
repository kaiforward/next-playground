# Client Runtime

The whole simulation runs inside the game page itself, in a background thread, and the UI reads
game state directly instead of requesting it over a network. Opening a system or faction panel
shows its content immediately — there is no server round-trip to wait for, and loading states exist
only at boot, new game, and load game. Saves are written locally (IndexedDB in the browser, real
files under a desktop shell), and one codebase ships as both a static website and a desktop app.

This doc covers the worker↔UI channel, the snapshot store, commands, persistence, and lifecycle.
World storage, world generation and the save JSON shape are [single-player-runtime.md](./single-player-runtime.md).
The tick pipeline itself is [tick-engine.md](./tick-engine.md); the per-processor pattern is
[processor-architecture.md](./processor-architecture.md).

---

## Process model

The engine, world store and tick loop run in a Web Worker (`client/worker/`); the UI thread never
executes a tick. This is what the codebase was already shaped for: engine functions are pure with
no `fs`/`process.env` imports, the world is a `globalThis` singleton, and the one shared tick body
is `runWorldTick`. The headless harness (`npm run simulate`) keeps driving `runWorldTick` directly
under Node — the engine runs unmodified in both hosts.

**The worker↔UI channel is two message types.** The **pacing frame** (`PacingFrame`,
`lib/runtime/channel.ts`) carries tick number, speed, achieved tps and this tick's event
notifications — never world state. The **state frame** (`StateFrame`, `lib/runtime/snapshot.ts`)
carries the UI-facing slices of world state (below), assembled worker-side from the same read
services the API routes used to wrap. Both ride the tick loop's existing throttle
(`BROADCAST_MIN_INTERVAL_MS = 250ms`, latest-wins): frames coalesce to at most ~4/sec at high speed.
A coalesced frame *replaces* the pending one, so **each frame is self-contained latest state for
the slices it carries** — a dropped frame is harmless.

**Subscribe handshake:** on `{type: "subscribe"}` the worker immediately replies with a full pacing
frame plus a full state frame — including a defined no-world frame before any game exists — so a UI
attaching to a paused or world-less worker renders current state without waiting for a tick.

**The boot seam:** the worker entry (`client/worker/entry.ts`) reads its boot configuration and
registers the IndexedDB save backend, then only afterwards dynamically imports the engine/constants
graph (`ECONOMY_SCALE` and its ~10 derived constant tables are frozen at module-evaluation time, so
nothing that imports them may run before the config is resolved). A `boot` message never blocks the
worker's message loop; a command that arrives before boot settles awaits the same in-flight boot
promise rather than rejecting.

## The snapshot store

The UI thread holds one store (`lib/store/game-store.ts`, Zustand's vanilla store as the
subscribe/getState container, with the merge/notify/liveness logic layered on top) — the
**snapshot**: the UI-facing slices of world state, organised per view and, where a view is per-
system or per-faction, per entity id. Components read via `useGameSlice` (`lib/store/use-game-
store.ts`) and never cross an async boundary except to issue a command.

**Notify contract: once per committed world version, not per tick.** `applyStateFrame` adopts a
frame only when its `worldVersion` is strictly newer than the held one — an out-of-order or
already-observed frame is dropped without notifying. Version bumps come from ticks and from every
non-tick writer (pins, tracker/alert settings, treasury policy, construction/colony orders,
automation, dev cheats, new/load), so a player acting while paused sees the change immediately.

**Derived views compute on the UI thread, on read, against the snapshot.** The two services that
read `ECONOMY_SCALE` for its value — colony-eligibility pricing and construction-stall pricing —
run inside the worker instead, their already-priced results riding the snapshot (`colonyEligibility`
and `constructionStalls` slices), so `ECONOMY_SCALE` itself never crosses the channel.

**Identity stability by UI-side structural sharing.** When a frame arrives, the store merges it
value-wise against what it holds, per slice (`replaceEqualDeep`, `lib/store/replace-equal-deep.ts`):
where a subtree is deep-equal, the previous object is kept, so unchanged views keep object identity
with no per-entity bookkeeping. This is the mechanism, not worker-side dirty-knowledge — the tick
adapters hand back fresh rows whether or not anything changed, and reference-identity dirty-checking
is explicitly off the table (see the roadmap's *Markets need a real dirty/ownership model* row).
Worker-side dirty-sets that would let a frame carry only changed slices are an optimisation gated on
that row landing, not this design's mechanism — every frame today is a full frame.

**Shared reads.** Every component reads the same store instance, so sibling surfaces that must agree
(the Tracker panel and its settings panel, synchronised through one shared slice) agree by
construction — no cache key to coordinate through.

## Commands

Commands (build orders, colony orders, treasury policy, pins, settings, speed, save/load, dev
cheats) post to the worker (`lib/runtime/command-client.ts`) and are **queued and drained at the
tick boundary** — never applied inside `runWorldTick`'s await window (`TickLoop.enqueueCommand`).
Each command returns the discriminated-union result the mutation services already produce,
acknowledged asynchronously — the one exception to "reads are synchronous". A worker's own state
frame is pushed as the very next message after a command's result, with nothing interleaved between
them (`lib/store/command-overlay.ts` relies on that ordering to clear its in-flight overlay without a
flicker). The UI rule for a command in flight: a control holds its set value until the result's
world version lands, so a rapid second command is always built from the last committed value.

**Read errors.** Derived-view reads throw `ServiceError` as before, caught by the store's read path
and rendered by the surviving error boundaries. `ServiceError`'s `status` field is a transport-free
discriminant (`"no-world" | "not-found" | "conflict"`) — its old HTTP-status job ended with the
routes it used to ride. The reachable cases today are the world-replacement swap window (below) and
command rejections.

## Panels and loading states

Opening any panel reads the current snapshot synchronously and commits in the same render pass —
there is no fetch to wait for and no per-panel loading fallback. Error boundaries for render errors
remain. Loading UI exists exactly three places: boot, new game, load game.

A panel whose URL names an entity absent from the current snapshot renders a *not found* state (the
existing `EmptyState`, composed rather than rebuilt) — the normal outcome after new game or load game
replaces the world, and after back/forward returns to a pre-replacement URL.

Panels stay URL-addressable with working back/forward over a five-route table (`client/routes.ts`,
built on wouter): the map root, `/start`, `/system/:id/:tab?`, `/factions/:id/:tab?`, and
`/styleguide`. `useRoute()` returns a discriminated union rather than a raw pathname, so route-aware
components switch on `route.name` instead of re-parsing the URL. The world-existence gate — the
successor to the old server-side redirect — is part of `RouteBody` (`client/main.tsx`): the game
routes render only once the store reports a world, routing to the start screen otherwise (a
boot-time loading state, inside the three above).

## Tick, speed, clock — and worker failure

The top bar's tick/speed/achievedTps and the calendar read the store's pacing state, fed by worker
frames. Speed changes are commands; the worker's next pacing frame confirms them.

**Failure is an observable state.** A failing tick hard-pauses the loop (as it always did) and now
posts a typed `tickFailed` message carrying the error, surfaced as a persistent banner
(`LivenessBanner`, `components/runtime/liveness-banner.tsx`) — game paused, cause shown, reload
offered — never a silent stop. The store carries a worker-liveness field, `Liveness = "no-world" |
"live" | "paused" | "dead"`, driven by `worker.onerror`/`worker.onmessageerror`. A dead worker shows
the same banner offering a reload; commands issued while dead are rejected, never queued silently.

**What "Reload" actually offers, in practice:** both the dead-worker and paused-by-failure banner
states offer only a page reload, not a live in-place recovery — a reload boots a fresh worker,
lands world-less on the start screen, and the player's own Continue/Load picks the autosave back up.
A third state, a persistently failing autosave, has no reload path (the write itself is what failed)
and instead points at the start screen's Export control so the player can get bytes off the machine
before closing the tab.

## Persistence

Autosave triggers are unchanged in cadence — every 60 s and on pause — running inside the worker,
with additions the client-only host requires because **the tab is now the process**:

- **A save fires on `pagehide`** (refresh, tab close) in the web packaging, fire-and-log by
  construction (`pagehide` gives no reliable window to await a result). The desktop shell instead
  intercepts window close and awaits the save.
- **Autosave failure is surfaced to the player**, not swallowed to the console — the worker relays
  every autosave attempt's outcome (`{type: "autosaveResult", error}`), and a persistently failing
  save shows in `LivenessBanner`.
- **Save backends are swappable behind one interface** (`SaveBackend`, `lib/world/save-backend.ts`):
  `write`/`read`/`list`/`remove` over raw save JSON, resolved via `getSaveBackend()`. The real
  browser worker registers the IndexedDB backend (`client/save-indexeddb.ts`) explicitly at boot,
  before any command can run; every Node host (the harness, unit tests) that never registers one
  falls back to the Node/file backend (`lib/world/save-files.ts`) via a dynamic `import()`, so no
  existing Node caller needed to change. Both backends give **atomic-or-recoverable writes**: the
  IndexedDB backend commits a save's blob under a fresh key first, then swaps the index record to
  point at it in a second transaction — a process death between the two leaves the index pointing at
  the last good blob, never a torn read. `list()` reads only the index, so listing costs nothing
  proportional to save size (saves run several MB). `navigator.storage.persist()` is requested once
  at boot, fire-and-forget. The start screen also offers manual export/import of the raw save JSON.

`save.ts` stays pure; the save JSON shape is unchanged from the desktop-free era.

## Environment seams

The worker has no `process.env`. `ECONOMY_SCALE` and the debug flags (`DEBUG_ECONOMY`,
`DEBUG_EVENTS`) are resolved into a `BootConfig` and set on a worker-global **before** the dynamic
import that evaluates the engine/constants graph, so the module-evaluation-time constant tables see
the resolved value. Under Node the env read is unchanged (the harness's dotenv-ordering guard is
preserved against the new resolution point). Every reader's semantics are unchanged — only the
resolution mechanics moved.

Dev cheats (advance ticks, spawn event, reset economy, economy snapshot, inspect world) are worker
commands registered only in a dev build (`import.meta.env.DEV`, dead-code-eliminated from a
production bundle) rather than runtime-guarded routes.

**A build-time stopgap survives in `vite.config.ts`:** the Node/file save backend's fallback
`import("./save-files")` is textually reachable from the worker's module graph (it is the only
module that may reach `lib/world/save-files.ts` at all), so Rollup bundles `node:fs/promises` into
the worker chunk even though the browser never takes that branch at runtime. A small Vite plugin
marks `node:*` specifiers external before Vite's default resolver turns them into a browser shim
that would otherwise hard-fail the build. This is verified still needed, not assumed — removing the
plugin reproduces the build failure.

## World replacement (new game / load game)

The world is replaced **without a page reload**: the router resets to the map root, and every
world-keyed surface — Pixi layers and geometry, camera and selection, every store slice — tears down
and rebuilds from the new snapshot in one committed version, so no surface ever reads a
half-swapped world. `GameStore.beginWorldReplacement()` fires the instant a newGame/loadGame command
is dispatched, resetting the store to its no-world shape and latching a replacement floor at the
outgoing world's version — a stale frame still in flight from the world being discarded is dropped
rather than transiently re-merged, and only the new world's own frame (whose version exceeds the
floor) clears it. Reads during the swap window get the defined no-world state rather than a thrown
error; panels reached afterwards via back/forward whose entity is absent render the not-found state.

## Entry and lifecycle

The start screen is a client route in the same bundle. Listing saves, new game and load game are
worker commands valid **before** a world exists — the worker boots world-less and answers them in
that state. The game routes gate on the store's no-world state and route to the start screen. Exit-
to-menu tears the world down in the worker (after a save) and returns to the world-less state.

## Development loop

The `globalThis` singletons exist to survive dev HMR. A worker module is re-created, not
hot-patched, when its modules change, so without mitigation an engine edit during development would
destroy the running galaxy — the dev-mode worker saves on teardown and its replacement boots from
that save, preserving "edits don't lose the galaxy." Dev inspection of the running world — a command
exposing the current snapshot — replaces poking the old server process directly.

## The ceiling this design preserves an escape from

The tick pipeline is sequential and JavaScript threads share no objects, in the browser and in Node
alike — so the tick is effectively single-threaded in any JS host. The scaling wall is tick compute
(the events processor, tracked on the roadmap's Tick performance rows), not the UI boundary: what
crosses the worker channel scales with what is on screen, not with galaxy size. If the JS tick ever
hits its ceiling, the channel boundary this design establishes is what makes a compiled engine (e.g.
Rust behind a desktop shell) a contained swap — same messages, same React UI.
