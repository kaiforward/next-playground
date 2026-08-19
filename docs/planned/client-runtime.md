# Client-only runtime — retiring Next.js and TanStack Query

Functional spec. Evidence and falsifier provenance live in the working file,
`docs/build-plans/retire-nextjs.md`. Packaging path B from
[grand-strategy-vision.md](./grand-strategy-vision.md) §6.

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
The store-not-cache replacement shape below was walked through with Kai this session and accepted
("that's a great explanation, no need to go further").

**Evidence** (full frames in the working file, `## Evidence`):
- **A/A2 — panel-open split.** Meaning: the visible loading panel is real (~310 ms of spinner per
  cold open) but only ~a third of it is network; ~240–250 ms is client-side render work inside the
  navigation transition, in a dev-build React. Licenses: the framework owns the RSC-gates-the-
  waterfall architecture, the serial five-fetch suspense waterfall and the warm-open fallback
  flash — all removed by this design by construction; it does NOT license "React rendering is
  inherently too slow" (dev build, unprofiled) nor a promise the 240 ms disappears.
- **B — query-layer census.** Meaning: the query layer is NOT pure boundary management — five
  behaviours depend on real cache semantics, three of them correctness (shared-key sync,
  referential stability, mutation read-back). Licenses: sizes the replacement — it must carry a
  subscriber mechanism, referentially-stable snapshots and a read-back path; it does not argue
  for keeping TanStack.
- **A — server timings.** Meaning: every server round-trip is 5–13 ms warm; the server was never
  the felt cost. Licenses: supports removing the HTTP layer without expecting a large latency win
  from that removal alone.

**Not claimed:** No engine, mechanic, constant or simulation behaviour changes — the tick, the
economy and the save JSON shape are untouched. No multiplayer design (the retirement is merely
compatible with one). No claim that the ~240–250 ms render cost vanishes — attributing it between
dev-build overhead, panel-tree render and map churn is an explicit build-plan gate (production
build + profiler), not settled here. The choice of client router, bundler and desktop shell
(Tauri vs Electron) are proposals below, not decisions. Tick-loop performance and the events
processor's scaling are separate roadmap rows and out of scope.

---

## Behaviour

### 1. Process model

The engine, world store and tick loop run in a Web Worker; the UI thread never executes a tick.
This is what the codebase was shaped for: engine functions are pure with no `fs`/`process.env`
imports (AGENTS.md convention; the one `fs` importer is `lib/world/save-files.ts`, reached only by
dynamic `import()` — `lib/world/tick-loop.ts:8`), the world is a `globalThis` singleton
(`lib/world/store.ts:11`), and the one shared tick body is `runWorldTick` (`lib/world/tick.ts`).
The tick loop already broadcasts each committed tick to subscribers
(`lib/world/tick-loop.ts:110`, `TickBroadcast` snapshot at `:80`); today its only consumer is the
SSE route (`app/api/game/tick-stream/route.ts:19`), which retires. The worker posts each committed
tick's changes to the UI thread on the same subscription.

The headless harness (`npm run simulate`) keeps driving `runWorldTick` directly under Node — the
engine must stay runnable in both hosts, which the dynamic-import rule for Node-edge code already
guarantees and this design must not regress.

### 2. The snapshot store (replaces the query layer)

The UI thread holds one store: the latest committed game state plus the derived views panels read.
Components subscribe to it (React's `useSyncExternalStore` — new, emitted by the store module) and
are notified once per committed tick, replacing the `economyTick` invalidation of 17 key prefixes
(`lib/hooks/use-tick-invalidation.ts:20-54`, retired) and the `eventNotifications` channel
(`:56-61`, retired). All reads are synchronous against the current snapshot; no read ever crosses
an async boundary after boot.

The census's three correctness behaviours become store guarantees:

- **Shared reads.** Every component reads the same store instance, so sibling surfaces that must
  agree (TrackerPanel and TrackerSettingsPanel, today synchronised through one shared cached query
  — `components/tracker/tracker-settings.tsx:66-68`) agree by construction. The existing test that
  pins "a section write re-renders both panels at once"
  (`components/map/__tests__/map-right-rail.test.tsx:62-63`) must pass against the store.
- **Identity stability.** Entities unchanged since the last tick keep object identity across
  snapshot updates — the guarantee TanStack's structural sharing provides today
  (`lib/hooks/use-ownership.ts:22-23`), which is what stops the Pixi territory/marker layers
  rebuilding geometry every tick (`components/map/star-map.tsx:137-150`). Worker messages arrive
  as fresh copies (structured clone), so the store must re-establish identity deliberately —
  deltas or dirty-sets, new, emitted at the worker's broadcast boundary. Observable bar: with the
  map open and no ownership change, the territory layer performs zero rebuilds across ticks.
- **Mutation read-back.** Commands (build orders, colony orders, treasury policy, pins, settings,
  speed, save/load) post to the worker and return the discriminated-union results mutation
  services already produce (AGENTS.md convention). The UI reads current state synchronously after
  the commit lands, which dissolves the four `setQueryData` sites — including the treasury band
  commit whose payload is built from cached bands to avoid a silent revert
  (`lib/hooks/use-faction-treasury.ts:29-37`).

The two performance behaviours (fetch dedup across N alert-chip mounts,
`components/alerts/alert-run.tsx:307-313`; cross-parallel-route sharing,
`app/(game)/@panel/system/layout.tsx:24`) need no replacement: reads are cheap and shared by
construction.

### 3. Panels and loading states

Opening any panel renders its content from the current snapshot in the same render pass — there is
no per-panel loading fallback, because there is nothing to wait for. The `QueryBoundary`
architecture retires with its mounted guard, whose one-frame fallback flash on every open
regardless of cache is documented in-tree (`components/ui/query-boundary.tsx:20-28`,
`components/map/map-right-rail.tsx:55-61`) and measured (A2: ~15 ms flash on a 72 ms warm open).
Error boundaries for render errors remain. Loading UI exists exactly three places: boot, new game,
load game.

Panels stay URL-addressable with working back/forward — parity with today's App Router routes
(`app/(game)/@panel/system/[systemId]/...`). Proposal: a client-side router or the History API
directly; which one is a build-plan decision.

### 4. Tick, speed, clock

The top bar's tick/speed/achievedTps and the calendar read the store's tick snapshot, fed by
worker messages — replacing the SSE stream plus the REST seeding effect (`lib/hooks/use-tick.ts:72-80`,
retired). Speed changes are commands; the worker's broadcast confirms them, as the SSE broadcast
does today (`lib/hooks/use-game-lifecycle.ts:15-19`).

### 5. Persistence

Autosave cadence and triggers are unchanged: every 60 s and on pause
(`lib/world/tick-loop.ts:47,95,144`), running inside the worker. `save.ts` stays pure; the save
JSON shape is unchanged. The storage backend splits per packaging: desktop keeps real files
(`lib/world/save-files.ts:44-65` — `writeSave`/`readSave`/`listSaves`); web gets a browser-storage
backend (new — OPFS or IndexedDB, chosen at build plan) behind the same interface. Web builds also
offer manual export/import of the save JSON so a save can leave the browser.

### 6. Environment seams (the worker has no `process.env`)

Four `lib/` modules read `process.env` at load and must be re-seamed:

- `ECONOMY_SCALE` (`lib/constants/economy-scale.ts:29`). Its docstring is explicit that it is
  "Server-only — never read for its value by the client"; in the client-only runtime the *worker*
  takes the server's role, so the knob becomes a boot parameter resolved once at worker start
  (new — passed into world-gen/boot), defaulting to 100 exactly as today. Its meaning and readers
  are untouched.
- `DEBUG_ECONOMY` / `DEBUG_EVENTS` (`lib/tick/processors/economy.ts:30`,
  `lib/tick/processors/events.ts:40`) — same treatment: boot flags.
- The dev-route guard (`lib/api/dev-guard.ts:8`) dies with the routes; dev cheats become worker
  commands compiled only into dev builds.

### 7. What retires, observably

The Next.js server and App Router, all 42 `app/api/game/` route handlers (census: thin service
wrappers, ~20 lines each), the SSE tick stream, TanStack Query and all 44 hooks' query wiring, and
`QueryBoundary`. Services (`lib/services/`) survive as the derived-view layer the store exposes;
routes' Zod validation survives at the command boundary (validate at system boundaries —
AGENTS.md). React, Pixi, Tailwind, RHF+Zod, Recharts and every component are unaffected. Proposal:
Vite as the bundler for both packagings; desktop shell (Tauri vs Electron) decided at build plan.

---

## Hazard worksheet

Scope: this change touches world-state hosting and the tick delivery channel, so all six rows are
filled (not the pure-UI carve-out).

### 1. One quantity, several unrelated jobs

| Quantity | Every reader today (`file:line`) | Which this design moves | Intended? |
|---|---|---|---|
| `TickBroadcast` | produced `lib/world/tick-loop.ts:80,110`; consumed by SSE route `app/api/game/tick-stream/route.ts:19`, seeded via `lib/hooks/use-tick.ts:72-80` | both consumers replaced by the worker→store channel | yes — that is the feature |
| `ECONOMY_SCALE` | 15 non-test `lib/` modules (grep 2026-08-19: constants ×5, engine ×4, services ×2, processors ×2, harness, `lib/world/tick.ts`) | none — only its *resolution point* moves (env → boot parameter); value, meaning and every reader unchanged | yes |
| query keys / invalidation list | `lib/query/keys.ts`, `lib/hooks/use-tick-invalidation.ts:20-61` | deleted wholesale with the layer | yes — the *Don't* forbids porting them |

No economy quantity, constant or signal changes meaning or gains a reader.

### 2. A constant read for a meaning it was not authored to have

| Constant | Docstring says | This design uses it as | Same thing? |
|---|---|---|---|
| `ECONOMY_SCALE` | "Server-only — it is never read for its value by the client (the client consumes already-scaled data from the API)" (`lib/constants/economy-scale.ts:9-11`) | worker-only boot parameter; the UI thread still never reads it — it consumes already-scaled snapshot data | yes — the worker inherits the server's role; the docstring's *intent* (keep it off the UI thread) is preserved and must be restated in the docstring when the seam moves |

### 3. A system you did not think about

| System | Interaction | Reason if none |
|---|---|---|
| Events | delivery only: `eventNotifications` SSE → worker message. Processor untouched. The `shipArrived` channel is dead code today (zero subscribers; census) — decide kill-or-wire when the channel moves, don't port it blind | — |
| Population + migration | none | engine untouched; host changes only |
| Unrest / regime | none | engine untouched |
| Industry + staffing | none | engine untouched |
| Infrastructure decay | none | engine untouched |
| Directed logistics | none | engine untouched |
| Directed build / planner | none | engine untouched; build *orders* are commands already returning discriminated unions |
| Colonisation + founding | none | engine untouched; colony orders as above |
| Treasury / purse | UI only: the band-commit read-back moves from `setQueryData` to the store (§2). Settlement logic untouched | — |
| Factions + relations | none | engine untouched |
| Save format (`World` shape) | shape unchanged; backend splits web/desktop (§5). JSON-serialisable rule (AGENTS.md) now also guards `postMessage` structured clone — same constraint, second enforcement point | — |
| Harness metrics | none — but the harness is a *portability constraint*: `npm run simulate` must keep driving `runWorldTick` under Node (§1) | — |

### 4. Claims about current behaviour

All carried from the working file's `## Evidence` with horizon and cohort; headline rows:

| Claim | Evidence | Horizon | Cohort |
|---|---|---|---|
| Cold panel open ~360 ms; network ~32–43%; ~240–250 ms client render gap | A2 raw runs (357/361/368 ms) | dev build, warm server | 4 developed systems, localhost |
| Warm open 72 ms incl. ~15 ms mounted-guard flash | A2 | dev build | same |
| Server round-trips 5–13 ms; RSC ~20 ms | A raw curl | warm dev server | 600-system world, tick 11908 |
| Query layer carries 5 cache-semantic dependencies, 3 correctness | census B, receipts spot-checked | repo @ `1aa2de02` | all 44 hooks, 42 routes |
| `shipArrived` has zero subscribers; `visibility` never invalidated | census B + grep | repo @ `1aa2de02` | non-test code |

### 5. Signals / primitives consumed

| Consumes | Produced at | Actual shape today | Design assumes |
|---|---|---|---|
| `TickBroadcast` | `lib/world/tick-loop.ts:80` | snapshot object incl. tick/speed/tps, broadcast per tick + immediately on subscribe (`:107,:161`) | same, crossing `postMessage` |
| `getWorld()` singleton | `lib/world/store.ts:11` | `globalThis`-keyed, HMR-surviving | lives in the worker; UI never calls it |
| Derived views (vitals, tracker, alerts…) | `lib/services/*` pure reads | computed per request | computed per tick or on read against the snapshot — placement is build-plan |
| `useSyncExternalStore` | React 18+ built-in | — | available (React already ≥18) |
| Structured clone / `postMessage` | browser | copies objects, kills identity | store re-establishes identity (§2) — the design's hard problem, stated |

### 6. Aggregates that move for other reasons

| Metric | Read at which cohort | What else moves it |
|---|---|---|
| Panel-open click→content | dev build vs prod build — **different cohorts; never compare across them** | JS-chunk cold/warm (713 vs 360 ms), tick volley landing mid-open, machine load |
| Per-tick UI update cost | must be read at fixed galaxy size and fixed panel-open state | galaxy size scales snapshot size; open surfaces scale subscriber count |

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
