# Client-only runtime — retiring Next.js and TanStack Query

Functional spec. Evidence and falsifier provenance live in the working file,
`docs/build-plans/retire-nextjs.md`. Packaging path B from
[grand-strategy-vision.md](./grand-strategy-vision.md) §6. Spec-reviewed 2026-08-19 (3-lens
adversarial review; all amendments below are the accepted findings applied).

**What changes:** The game stops needing a server. The whole simulation runs inside the game page
itself, in a background thread, and the UI reads game state directly instead of requesting it over
HTTP. Opening a system or faction panel shows its content immediately — the loading spinner on
panel clicks is gone, and loading states exist only at boot, new game, and load-game. Saves are
written locally (browser storage on the web, real files in a desktop shell), and one codebase
ships as both a static website and a desktop app.

**Why:** Kai queued this to the roadmap head (2026-08-19) because "a loading panel on every system
click" fails "the EU5 instant-panel genre bar", and reframed the goal this session: "the most
important thing here is just moving away from two libraries that are not suited for a client only
game" — the retirement itself is the point, performance is one consequence. His standing read
(2026-08-12, roadmap row): "real performance gains, no delay opening panels, the coupling below
all solvable, the end state simpler than what it replaces — and the retirement holds even for
future multiplayer." The roadmap *Don't* stands and is encoded here: "don't port TanStack across
as-is. Caching in front of an in-process world is the indirection this work exists to remove."
Decisions from the spec review's triage (2026-08-19, all Kai's): the store's implementing tool is
deliberately undecided until the build plan ("let's note the state management tool is yet to be
decided"); the panel-latency figure is an aim, not a merge gate ("that sounds good to me as an
aim, but its not set in stone… the performance targets can come later"); derived views compute on
the UI thread with the two pricing services worker-side ("Okay I think im sold"); and the
migration books an end-task tick-speed audit ("lets book as an end task an audit of the tick speed
at a high number of systems and population to see what our acceptable max is").

**Evidence** (full frames in the working file, `## Evidence`):
- **A/A2 — panel-open split.** Meaning: the visible loading panel is real (~310 ms of spinner
  inside a ~360 ms cold open) but only ~a third of the ~360 ms click→content interval is network
  (115–155 ms, 32–43% — the denominator Falsifier A is written on); ~240–250 ms is client-side
  render work inside the navigation transition, in a dev-build React. Licenses: the framework owns
  the RSC-gates-the-waterfall architecture, the serial five-fetch suspense waterfall and the
  warm-open fallback flash — all removed by this design by construction; it does NOT license
  "React rendering is inherently too slow" (dev build, unprofiled) nor a promise the 240 ms
  disappears.
- **B — query-layer census.** Meaning: the query layer is NOT pure boundary management — five
  behaviours depend on real cache semantics, three of them correctness (shared-key sync,
  referential stability, mutation read-back). Licenses: sizes the replacement — it must carry a
  subscriber mechanism, referentially-stable snapshots and a read-back path; it does not argue
  for keeping TanStack.
- **A — server timings.** Meaning: every `/api/game/*` round-trip is 5–13 ms warm, the RSC nav
  ~20 ms and the SSR document 33–41 ms; the server was never the felt cost. Licenses: supports
  removing the HTTP layer without expecting a large latency win from that removal alone.

**Not claimed:** No engine, mechanic, constant or simulation behaviour changes — the tick, the
economy and the save JSON shape are untouched. No multiplayer design (the retirement is merely
compatible with one). No claim that the ~240–250 ms render cost vanishes — attributing it between
dev-build overhead, panel-tree render and map churn is an explicit build-plan gate (production
build + profiler), and §3's latency figure is an aim, not a merge gate. The store's implementing
library (an off-the-shelf state manager vs a hand-rolled `useSyncExternalStore` store) is a
build-plan choice; this spec pins only the store's guarantees. The choice of client router,
bundler and desktop shell (Tauri vs Electron) are proposals below, not decisions. Tick-loop
performance and the events processor's scaling are separate roadmap rows and out of scope — but
see §11 for the ceiling this design preserves an escape from.

---

## Behaviour

### 1. Process model

The engine, world store and tick loop run in a Web Worker; the UI thread never executes a tick.
This is what the codebase was shaped for: engine functions are pure with no `fs`/`process.env`
imports (AGENTS.md convention; the one `fs` importer is `lib/world/save-files.ts`, reached only by
dynamic `import()` — `lib/world/tick-loop.ts:8`), the world is a `globalThis` singleton
(`lib/world/store.ts:11`), and the one shared tick body is `runWorldTick` (`lib/world/tick.ts`).

**The worker↔UI channel is two message types, one existing and one new.** The existing
`TickBroadcast` (`lib/world/tick-loop.ts:23-28`) is the *pacing* frame only — tick number, speed,
achieved tps, event notifications; it carries no world state and never has (today its one consumer
is the SSE route, `app/api/game/tick-stream/route.ts:19`, which retires). The **state frame is
new**: a message carrying the UI-facing slices of world state (§2), emitted at the worker boundary
alongside the pacing frame. Both ride the existing latest-wins throttle
(`BROADCAST_MIN_INTERVAL_MS = 250`, `lib/world/tick-loop.ts:44,177-203`), whose contract is kept:
frames coalesce to at most ~4/sec at high speed. Because a coalesced frame *replaces* the pending
one, the state frame's payload discipline is: **each frame is self-contained latest state for the
slices it carries** — a dropped frame is harmless — or, where a slice ships as changes, the
changes are **merged across the throttle window** (union of changed entries), never dropped.
Per-tick event lists never ride a droppable frame; events are read from state (§2).

**Subscribe handshake:** on subscription the worker immediately replies with a full pacing frame
plus a full state frame — the replacement for both the SSE route's on-connect send and the retired
REST seeding effect (`lib/hooks/use-tick.ts:72-80`) — so a UI attaching to a *paused* world (the
default after new game) renders current state without waiting for a tick.

The headless harness (`npm run simulate`) keeps driving `runWorldTick` directly under Node — the
engine must stay runnable in both hosts, which the dynamic-import rule for Node-edge code already
guarantees and this design must not regress.

### 2. The snapshot store (replaces the query layer)

The UI thread holds one store: the **snapshot** — the UI-facing slices of world state, organised
much like today's query keys (per view, and per entity id where views are per-system). Components
subscribe (via `useSyncExternalStore` or an off-the-shelf store built on it — tool decided at
build plan) and read synchronously; after boot, no *read* ever crosses an async boundary
(commands are the stated exception below).

**Notify contract: once per committed world version, not per tick.** The world version already
exists as a producer — the derived-view cache is keyed on `getWorldVersion()`
(`lib/services/world-index.ts:16`). Version bumps come from ticks AND from the non-tick writers:
pins (`lib/services/player-pins.ts:39`), tracker sections and alert categories
(`lib/services/player-settings.ts:69,84`), treasury policy (`lib/services/treasury.ts:72`),
construction/colony orders and automation (`lib/services/construction-orders.ts:46-231`), dev
cheats, and new/load. The paused game is the primary case: a player pinning a system or queueing a
build while paused sees the change immediately. Delivery is coalesced by the throttle (§1), so
the guarantee is "the store always holds the latest committed state, delivered at most every
250 ms" — never "every tick is observed" (`lib/world/tick-loop.ts:32-42` forbids edge-counting
consumers, and that rule survives).

**Derived views compute on the UI thread, on read, against the snapshot** — the only placement
compatible with synchronous reads. No derived view is computed per tick for a panel that is not
open. The exception is the two services that read `ECONOMY_SCALE` for its value with "Server-only"
docstrings — colony pricing (`lib/services/colony-eligibility.ts:7,20,106`) and construction stall
pricing (`lib/services/construction.ts:6,14,107`): these run **in the worker**, their
already-priced results riding the snapshot, so the scale never reaches the UI thread (worksheet
row 2). **Transfer budget:** what crosses per tick is the changed UI-facing slices, not the
`World` — the world serialises at ~6.6 MB at 600 systems (`saves/autosave.json`, 6,626,920 bytes)
and never crosses whole. Off-boundary ticks change little (ships, clock, occasional events);
the cycle-boundary tick (1 in 24) rewrites markets/treasury/construction/ownership and bounds the
worst-case frame at roughly what today's per-tick HTTP refetch volley already carries. The build
plan measures both frame sizes at 600 systems and states them.

**Identity stability — by UI-side structural sharing, not worker dirty-knowledge.** When a frame
arrives, the store merges it value-wise against what it holds, per slice (the `replaceEqualDeep`
technique TanStack uses today over freshly-parsed JSON — `lib/query/fetcher.ts:23-30`,
`lib/hooks/use-ownership.ts:22-23`): where a subtree is deep-equal, the previous object is kept,
so unchanged views keep object identity with no custom per-entity logic. This is required because
the worker largely cannot know what changed — the tick adapters hand back fresh rows whether or
not anything changed (`lib/tick/adapters/memory/events.ts:50`), and the roadmap's *Markets need a
real dirty/ownership model* row explicitly forbids reference-identity dirty-checking. Worker-side
dirty-sets are an **optimisation gated on that roadmap row landing**, not this design's mechanism.
Observable bar, stated per view: with the map open and no ownership change, the ownership view,
`liveAtlas` and `mergedSystems` keep identity across ticks and the Pixi territory/marker layers
perform zero rebuilds (`components/map/star-map.tsx:137-172`).

**Shared reads.** Every component reads the same store instance, so sibling surfaces that must
agree (TrackerPanel and TrackerSettingsPanel, today synchronised through one shared cached query —
`components/tracker/tracker-settings.tsx:66-68`) agree by construction. The existing test that
pins "a section write re-renders both panels at once"
(`components/map/__tests__/map-right-rail.test.tsx:62-63`) must pass against the store.

**Commands.** Commands (build orders, colony orders, treasury policy, pins, settings, speed,
save/load) post to the worker, are **queued and drained at the tick boundary — never applied
inside `runWorldTick`'s await window** (`lib/world/tick-loop.ts:140-141` reads the world before
the await and writes after it, so a mid-window write would be silently overwritten). Each command
returns the discriminated-union result mutation services already produce (AGENTS.md convention),
acknowledged **asynchronously — the one exception to "reads are synchronous"**. The UI rule for a
command in flight: the control holds its set value until the result's world version lands, so a
rapid second command is always built from the last committed value — which dissolves the four
`setQueryData` sites, including the treasury band commit built from cached bands to avoid a silent
revert (`lib/hooks/use-faction-treasury.ts:29-37`).

**Read errors.** Derived-view reads throw `ServiceError` as today, caught by the store's read path
and rendered by the surviving error boundaries. `ServiceError.status`'s HTTP job ends with the
routes (~30 wrappers, `lib/api/with-service-errors.ts:22-27`, and the retry predicate's 4xx rule,
`lib/query/client.ts:10-14`, all retire); the field becomes a transport-free discriminant
(`"no-world" | "not-found" | "conflict"`). Most of today's read errors become impossible states
in-process; the reachable remainder are the swap-window no-world state (§8) and command
rejections (§2, §4).

The two performance behaviours the census found (fetch dedup across N alert-chip mounts,
`components/alerts/alert-run.tsx:307-313`; cross-parallel-route sharing,
`app/(game)/@panel/system/layout.tsx:24`) need no replacement: reads are cheap and shared by
construction.

### 3. Panels and loading states

Opening any panel reads the current snapshot synchronously and commits in the same render pass;
there is no fetch to wait for and no per-panel loading fallback. The `QueryBoundary` architecture
retires with its mounted guard, whose one-frame fallback flash on every open regardless of cache
is documented in-tree (`components/ui/query-boundary.tsx:20-28`,
`components/map/map-right-rail.tsx:55-61`) and measured (A2: ~15 ms flash on a 72 ms warm open).
Error boundaries for render errors remain. Loading UI exists exactly three places: boot, new game,
load game.

**The observable aim — not a merge gate (owner decision, 2026-08-19):** click→content under
~100 ms at the 95th percentile, measured on a production build at a fixed system-development tier
(worksheet row 6). Two hard rules ride with it: the build-plan gate that attributes the ~240–250 ms
dev-build render cost (production build + profiler) runs **before** the loading fallback is
removed; and the clicked system shows its pressed/selected state on the frame the click lands, so
a slow panel is never silent unresponsiveness. If a panel's synchronous render exceeds the aim,
the answer is cutting render cost — never reintroducing a fetch.

**A panel whose URL names an entity absent from the current snapshot renders a *not found* state**,
not a loading state — the normal outcome after new game or load game replaces the world (§8), and
after back/forward returns to a pre-replacement URL.

Panels stay URL-addressable with working back/forward — parity with today's App Router routes
(`app/(game)/@panel/system/[systemId]/...`). Proposal: a client-side router or the History API
directly; which one is a build-plan decision. The world-existence gate — today a synchronous
server-side `hasWorld()` + `redirect("/start")` (`app/(game)/layout.tsx:15-17`) — becomes part of
the boot handshake: the game route renders only after the worker's ready message reports a world,
routing to the start screen otherwise (a boot-time loading state, inside §3's three).

### 4. Tick, speed, clock — and worker failure

The top bar's tick/speed/achievedTps and the calendar read the store's pacing state, fed by worker
frames (§1) — replacing the SSE stream plus the REST seeding effect. Speed changes are commands;
the worker's broadcast confirms them, as today (`lib/hooks/use-game-lifecycle.ts:15-19`).

**Failure is an observable state.** A failing tick hard-pauses the loop today and broadcasts the
pause (`lib/world/tick-loop.ts:155-164`) but its cause reaches only the server console; the worker
version posts a typed `tickFailed` message carrying the error, which the UI surfaces as a
persistent banner — game paused, cause shown, last autosave offered — never a silent stop. The
store carries a worker-liveness state, `live | paused | dead`, driven by `worker.onerror` /
`onmessageerror` plus a heartbeat; it replaces the retired SSE `isConnected` signal
(`lib/hooks/use-tick.ts:116-118`). A dead worker renders an app-level surface offering reload from
the last autosave; commands issued while dead are rejected, never queued silently.

### 5. Persistence

Autosave triggers are unchanged in cadence — every 60 s and on pause
(`lib/world/tick-loop.ts:47,95,144`), running inside the worker — with the additions the
client-only host requires, **because the tab is now the process** (today a browser refresh costs
nothing; client-only it would discard up to 60 s of play):

- **A save fires on `pagehide`** (refresh, tab close) in the web packaging. The desktop shell
  instead intercepts window close and awaits the save (`whenAutosaveSettled()`'s job,
  `lib/world/tick-loop.ts:218-225`, which has no browser analogue) — and owns its chrome, so
  accidental refresh does not exist there.
- **Autosave failure is surfaced to the player**, not swallowed to the console
  (`lib/world/tick-loop.ts:210-215`): on the web backend, quota exhaustion and storage eviction
  are routine, and a persistently failing autosave raises a visible warning offering manual
  export.
- **The web backend's contract matches what the disk backend guarantees implicitly**
  (`lib/world/save-files.ts:38-49,64-85`): atomic-or-recoverable writes (write-then-swap-key or an
  IndexedDB transaction — mechanism named at build plan, with the torn-write recovery stated); an
  index record (name, tick, savedAt, bytes) written beside each save so the start screen's listing
  never parses multi-megabyte blobs (saves run 5.8–13 MB); `navigator.storage.persist()`
  requested, with eviction/"clear site data" behaviour stated.

`save.ts` stays pure; the save JSON shape is unchanged. Desktop keeps real files
(`lib/world/save-files.ts:44-65`); web builds also offer manual export/import of the save JSON.

### 6. Environment seams (the worker has no `process.env`)

`ECONOMY_SCALE` (`lib/constants/economy-scale.ts:29`) is a module-scope const consumed **at module
evaluation** to freeze ~10 constant tables (`lib/constants/industry.ts:94-300`,
`market-economy.ts:29`, `physical-economy.ts:60,167,175`, `directed-logistics.ts:16`) — so no
runtime message can reach it after import. The seam, stated: **the worker entry module reads its
boot configuration first and only then dynamically imports the engine/constants graph**, so the
module-evaluation-time `scaleValue`/`scaleRecord` calls see the resolved value. The seam is
**dual-host**: under Node the env read remains (the harness's dotenv-ordering crash guard,
`scripts/simulate.ts:89-97`, is preserved against the new resolution point). Default 100,
meaning and every reader's *semantics* unchanged — but the resolution mechanics touch every
importing module, and row 1 records that honestly. `DEBUG_ECONOMY` / `DEBUG_EVENTS`
(`lib/tick/processors/economy.ts:30`, `lib/tick/processors/events.ts:40`) get the same treatment
as boot flags. The moved docstring keeps the intent with the new word: "worker-only — never read
for its value by the UI thread".

Three client components read `process.env.NODE_ENV` at render and rely on framework inlining
(`app/layout.tsx:35`, `components/game-shell.tsx:42`,
`components/dev-tools/axe-accessibility.tsx:7`): they move to the bundler's dev/prod define.

**The dev cheat surface** is four `app/api/dev/` routes outside §7's 42-route census, guarded at
runtime (`lib/api/dev-guard.ts:8`), not build time. They become worker commands **excluded at
build time** (bundler define + dead-code elimination; the dev-tools panel's imports resolve to
nothing in production). `advanceTicks` today bypasses the loop's re-entrancy guard and broadcast
(`lib/services/dev-tools.ts:36-40`); as a command it runs through the loop's tick path (or
publishes a world-version notification per batch) so the store is never left stale after a cheat.

### 7. What retires, observably

The Next.js server and App Router, all 42 `app/api/game/` route handlers (census: thin service
wrappers, ~20 lines each) plus the four `app/api/dev/` routes (§6), the SSE tick stream, TanStack
Query and all 44 hooks' query wiring, and `QueryBoundary`. Services (`lib/services/`) survive as
the derived-view layer (§2 states which two run worker-side); routes' Zod validation survives at
the command boundary (validate at system boundaries — AGENTS.md).

**The client-side framework surface retires with it** (this is why "every component is unaffected"
is *not* claimed):

- `next/link` — 14 files, including the `Button`, `BackLink` and `Tabs` primitives
  (`components/ui/button.tsx:2`, `back-link.tsx:1`, `tabs.tsx:3`), which gain a router-agnostic
  link prop.
- `next/navigation` hooks — 14 files, including `components/map/star-map.tsx:4`,
  `components/ui/detail-panel.tsx:4`, `lib/hooks/use-system-focus.ts:4` and the panel layouts;
  four test files mock the module and retarget with the router.
- **The font pipeline**: the theme's three variables (`--font-chakra`, `--font-geist-sans`,
  `--font-geist-mono`, consumed at `app/globals.css:22-24`) are produced only by
  `next/font/local` + the `geist` package (`app/layout.tsx:2-16,31`). They are replaced by
  hand-written `@font-face` rules over the existing `app/fonts/*.woff2` (plus self-hosted Geist
  files) emitting the same variables, so the `@theme inline` block is untouched.
  `app/layout.tsx`'s `<html className>` composition and its `next` `Metadata` export go with it.

React, Pixi, Tailwind's theme, RHF+Zod and Recharts are unaffected. Proposal: Vite as the bundler
for both packagings; desktop shell (Tauri vs Electron) decided at build plan.

### 8. World replacement (new game / load game)

Today the hazard is discharged by a hard document navigation ("Hard navigation on purpose: a fresh
document gets a fresh TanStack cache" — `components/start/start-screen.tsx:47-51`, same in
`create-faction-form.tsx:42-45`), which also resets Pixi, the camera and the panel URL. The worker
version replaces the world **without a reload**, under an explicit reset contract: the router
resets to the map root (never keeping a `/system/<oldId>` URL); every world-keyed surface — Pixi
layers and geometry, camera and selection, all store slices — tears down and rebuilds from the new
snapshot, delivered as one committed version so no surface ever reads a half-swapped world. Reads
during the swap window return a defined no-world state covered by the new-game/load loading UI —
never a thrown `ServiceError` into a render (`lib/world/store.ts:16` throws today). Panels reached
afterwards via back/forward whose entity is absent render §3's *not found* state.

### 9. Entry and lifecycle

The start screen (`app/start/`, deliberately outside the game shell) becomes a client route in the
same bundle. Listing saves, new game and load game are worker commands **valid before a world
exists** — the worker boots world-less and answers them in that state (the saves-listing route,
`components/start/start-screen.tsx:28-38`, retires with the rest). The game route gates on the
store's no-world state and routes to the start screen (§3). Exit-to-menu tears the world down in
the worker (after a save) and returns to the world-less state.

### 10. Development loop

The `globalThis` singletons exist to survive dev HMR (`lib/world/store.ts:11`,
`lib/world/tick-loop.ts:10-12`; AGENTS.md: "HMR survives"). A worker is re-created, not
hot-patched, when its modules change — so without mitigation every engine edit would destroy the
running galaxy. The contract: **the dev-mode worker saves on teardown and its replacement boots
from that save**, preserving today's "edits don't lose the galaxy" (the same autosave path §5
requires). Dev inspection of the world — today possible by poking the server process — is a
dev-only command exposing the current snapshot.

### 11. The ceiling this design preserves an escape from

The tick pipeline is sequential (nine processors in a fixed run order over shared world state) and
JavaScript threads share no objects — in the browser *and* in Node (`worker_threads` is the same
share-nothing model) — so the tick is effectively single-threaded in any JS host. The scaling wall
is tick compute (the roadmap names the events processor), not the UI boundary: what crosses the
channel scales with what is on screen, not with galaxy size. If the JS tick ever hits its ceiling,
the channel boundary this spec creates is what makes a compiled engine (e.g. Rust behind Tauri)
a contained swap — same messages, same React UI. **Booked end task (Kai, 2026-08-19):** a
`/measure` audit of tick speed at high system and population counts to establish the acceptable
maximum — runs at the end of this migration.

---

## Hazard worksheet

Scope: this change touches world-state hosting and the tick delivery channel, so all six rows are
filled (not the pure-UI carve-out).

### 1. One quantity, several unrelated jobs

| Quantity | Every reader today (`file:line`) | Which this design moves | Intended? |
|---|---|---|---|
| `TickBroadcast` | produced `lib/world/tick-loop.ts:80,110`; consumed by SSE route `app/api/game/tick-stream/route.ts:19`, seeded via `lib/hooks/use-tick.ts:72-80` | both consumers replaced by the worker→store channel; the on-subscribe send moves from the SSE route into the worker handshake (§1) | yes — that is the feature |
| `ECONOMY_SCALE` | 12 references in 5 non-test modules (impact run 2026-08-19): `lib/constants/economy-scale.ts` ×4, `lib/world/tick.ts:62,1582,1780`, `lib/services/colony-eligibility.ts:20,106`, `lib/services/construction.ts:14,107`, `lib/tick-harness/runner.ts:53,447`; plus ~10 constant tables materialised from it at import (§6) | resolution mechanics move (env → boot-config-then-dynamic-import in the worker; env kept under Node); every reader's *semantics* unchanged, but the import-time tables and the harness guard (`scripts/simulate.ts:89-97`) constrain the mechanism | yes — §6 states it |
| `ServiceError.status` | error class for services + HTTP status for ~30 route wrappers (`lib/api/with-service-errors.ts:22-27`) + the retry predicate's 4xx rule (`lib/query/client.ts:10-14`) | the HTTP job ends with the routes; becomes a transport-free discriminant (§2) | yes |
| query keys / invalidation list | `lib/query/keys.ts`, `lib/hooks/use-tick-invalidation.ts:20-61` | deleted wholesale with the layer | yes — the *Don't* forbids porting them |

No economy quantity, constant or signal changes meaning or gains a reader.

### 2. A constant read for a meaning it was not authored to have

| Constant | Docstring says | This design uses it as | Same thing? |
|---|---|---|---|
| `ECONOMY_SCALE` | "Server-only — it is never read for its value by the client (the client consumes already-scaled data from the API)" (`lib/constants/economy-scale.ts:9-11`) | worker-only boot configuration; the UI thread still never reads it — the two services that read it by value (`lib/services/colony-eligibility.ts:7,20,106`, `lib/services/construction.ts:6,14,107`, both docstringed "Server-only") are **sited in the worker** (§2), their priced results riding the snapshot | yes — preserved by the placement decision, not by assertion; the moved docstring says "worker-only" |

### 3. A system you did not think about

| System | Interaction | Reason if none |
|---|---|---|
| Events | delivery only: `eventNotifications` moves from SSE to the pacing frame, but events are *read from state* by a derived view, never consumed from a droppable frame (§1). The `shipArrived` channel is **killed** (decided at spec review): zero subscribers, and its intended consumer reads a stub returning every system (`app/api/game/systems/visibility/route.ts:6-13`), so wiring it changes nothing — removed from `GlobalEventMap` and the ship-arrivals processor's `globalEvents` (`lib/tick/processors/ship-arrivals.ts:34`); the SPEC.md interaction-map edge and the stale docstrings (`use-visibility.ts:14`, `use-system-logistics.ts:10`, `AGENTS.md:74`) are corrected on the same branch | — |
| Population + migration | none | engine untouched; host changes only |
| Unrest / regime | none | engine untouched |
| Industry + staffing | none | engine untouched |
| Infrastructure decay | none | engine untouched |
| Directed logistics | none | engine untouched |
| Directed build / planner | none | engine untouched; build *orders* are commands (queued at the tick boundary, §2) |
| Colonisation + founding | pricing service sited worker-side (§2); founding logic untouched | — |
| Treasury / purse | UI only: the band-commit read-back moves to the store's command rule (§2); settlement logic untouched | — |
| Factions + relations | none | engine untouched |
| Save format (`World` shape) | shape unchanged; backend splits web/desktop with a stated contract (§5). The JSON-serialisable rule gains **no** enforcement from `postMessage` — structured clone preserves `Map`/`Set`/`Date`/`Infinity`/`NaN` faithfully, so a violation crosses the channel cleanly and surfaces only as silent save corruption; `save.ts` remains the only enforcer, and a dev-build serialisability check at the worker boundary is worth carrying | — |
| World replacement (new/load) | full reset contract in §8 — the successor to AGENTS.md's "New game replaces the world, so cached ids mismatch" hazard | — |
| Harness metrics | the harness is a *portability constraint* (§1) and the `ECONOMY_SCALE` guard (`scripts/simulate.ts:89-97`) is an affected consumer (§6) | — |

### 4. Claims about current behaviour

All carried from the working file's `## Evidence` with horizon and cohort; headline rows:

| Claim | Evidence | Horizon | Cohort |
|---|---|---|---|
| Cold panel open ~360 ms; network ~32–43%; ~240–250 ms client render gap | A2 raw runs (357/361/368 ms) | dev build, warm server | 4 developed systems, localhost |
| Warm open 72 ms incl. ~15 ms mounted-guard flash | A2 | dev build | same |
| Server round-trips 5–13 ms; RSC ~20 ms; SSR doc 33–41 ms | A raw curl | warm dev server | 600-system world, tick 11908 |
| Query layer carries 5 cache-semantic dependencies, 3 correctness | census B, receipts spot-checked | repo @ `1aa2de02` | all 44 hooks, 42 routes |
| `shipArrived` has zero subscribers; `visibility` never invalidated; visibility source is an all-systems stub | census B + grep + `app/api/game/systems/visibility/route.ts:6-13` | repo @ `1aa2de02` | non-test code |
| World serialises at ~6.6 MB | `saves/autosave.json` 6,626,920 bytes | live game 2026-08-19 | 600 systems, tick ~11.9k |

### 5. Signals / primitives consumed

| Consumes | Produced at | Actual shape today | Design assumes |
|---|---|---|---|
| `TickBroadcast` (pacing frame) | `lib/world/tick-loop.ts:80` | `{currentTick, speed, achievedTps, events}` — **no world data**; latest-wins throttled at 250 ms (`:44,177-203`); on-subscribe send lives in the SSE route (`route.ts:19`), not in `subscribe` (`:110-115`) | same shape over `postMessage`; on-subscribe send moves into the worker handshake (§1) |
| State frame | **new** — emitted at the worker boundary (§1) | does not exist today | self-contained latest state per slice, or merged-across-window changes; never latest-wins deltas |
| World version | `getWorldVersion()`, keyed by `lib/services/world-index.ts:16` | monotonic counter bumped on `setWorld` | the notify contract's unit (§2) |
| `getWorld()` singleton | `lib/world/store.ts:11` | `globalThis`-keyed, HMR-surviving; **one UI-tree reader exists today**: `hasWorld()` + `redirect` in `app/(game)/layout.tsx:15-17` | lives in the worker; the UI gate becomes the boot handshake (§3) |
| Derived views (vitals, tracker, alerts…) | `lib/services/*` pure reads; whole-world scanners via `versionCached` (`lib/services/world-index.ts:13-33`) | computed per request, cached per world version | computed on the UI thread on read (§2), except the two worker-side pricing services |
| Identity stability | **UI-side structural sharing** — the mechanism proven today (`lib/query/fetcher.ts:23-30`, `lib/hooks/use-ownership.ts:22-23`); worker dirty-sets have NO producer (`lib/tick/adapters/memory/events.ts:50` copies every row; roadmap *Don't* forbids reference-identity checks) | — | value-wise merge per slice; dirty-sets an optimisation gated on the roadmap dirty-model row |
| `useSyncExternalStore` | React 19.2.3 built-in | — | available |
| Structured clone / `postMessage` | browser | copies objects, kills identity; **more permissive than JSON** (carries Map/Set/Date/Infinity/NaN) | store re-establishes identity (§2); clone is NOT a JSON-rule enforcement point (row 3) |

### 6. Designing against an aggregate that moves for other reasons

| Metric | Read at which cohort | What else moves this number |
|---|---|---|
| Panel-open click→content | dev build vs prod build — **different cohorts; never compare across them** — at a fixed system-development tier (the A2 baseline is 4 *developed* systems in a 600-system world, one faction's view, localhost) | JS-chunk cold/warm (713 vs 360 ms); tick volley landing mid-open; machine load; how developed the opened system is (panel content scales render work); galaxy size |
| Per-tick UI update cost | fixed galaxy size, fixed panel-open state, **split boundary vs off-boundary tick (`tick % CYCLE_LENGTH === 0`) and quoted at a stated speed** | galaxy size scales snapshot size; open surfaces scale subscriber count; the cycle boundary rewrites markets/treasury/construction/ownership so an unsplit 24-tick mean moves with sampling alignment; the 250 ms latest-wins throttle means notifies-per-tick falls as speed rises (`lib/world/tick-loop.ts:44`) |

---

## Falsifiers (provenance: committed at `949a2a1c` in `docs/build-plans/retire-nextjs.md`, moved
here unedited)

> **Falsifier A:** if, on a cold panel open, the summed network time (RSC nav fetch + `/api/game/*`
> fetches, read from the browser network log) is under 50% of the click→content interval, or the
> loading fallback persists ≥100 ms after the last response arrives, the claim is false — the visible
> load is a framework/render cost that removing the server hop will not remove, and the retirement's
> instant-panel benefit claim goes back to brainstorm.

> **Falsifier B:** if the census finds any hook or component whose correctness or UX depends on cache
> behaviour that a direct synchronous read of the in-process world would not provide, the "no cache
> to invalidate at all" simplification claimed by the roadmap row is dead, and the replacement design
> must carry that behaviour explicitly — which changes the size of everything downstream.

Both fired (working file, `## Outcomes`). The spec is written on the falsified-and-resized ground:
the benefit claim is architectural (no RSC gate, no waterfall, no fallback flash, no invalidation
churn) rather than "remove the server hop, get instant panels", and the store carries the three
correctness behaviours explicitly.
