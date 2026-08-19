# Retire Next.js + TanStack Query — working file

## Spec

Written to [docs/planned/client-runtime.md](../planned/client-runtime.md) rather than inline: this
is an XL multi-PR feature and this file already carries ~270 lines of evidence — the spec would
stop both being readable. The falsifiers below are the provenance source the spec's copies are
diffed against.

Roadmap queue head. This file starts at the row's `/measure` step: where a system-panel open
actually spends its time, and the query layer's load-bearing surface. The evidence sizes the design
pass that settles what replaces the query layer.

## Claims and falsifiers (committed before any instrument runs)

### Claim A — panel-open latency

Opening a system detail panel is dominated by client–server round-trips: the App Router RSC
navigation fetch for the `@panel` parallel route, plus the panel's `useSuspenseQuery` HTTP fetches
(six hooks in `SystemOverviewContent`, which within one component resolve as a serial waterfall).
The visible loading state ends when the last fetch resolves; render time is negligible.

**Falsifier A:** if, on a cold panel open, the summed network time (RSC nav fetch + `/api/game/*`
fetches, read from the browser network log) is under 50% of the click→content interval, or the
loading fallback persists ≥100 ms after the last response arrives, the claim is false — the visible
load is a framework/render cost that removing the server hop will not remove, and the retirement's
instant-panel benefit claim goes back to brainstorm.

Conditions to read (the "both horizons" of this measurement):
- **cold open** — first visit to a system this session (nothing cached);
- **warm open** — re-opening the same system (query cache populated);
- **open while ticks run** — with `useTickInvalidation` live, since invalidation may re-trigger
  fetches mid-open.

### Claim B — the query layer's load-bearing surface

Every behaviour the query layer is load-bearing for — `useTickInvalidation`, the map atlas held at
`staleTime: Infinity`, the SSE-driven hooks that seed initial state from REST — exists solely to
manage the client–server boundary. No consumer relies on cache semantics beyond that boundary
management: no request dedup hiding an expensive computation, no `keepPreviousData`/placeholder
smoothing a UI depends on, no optimistic updates, no cross-component reliance on cached-object
identity.

**Falsifier B:** if the census finds any hook or component whose correctness or UX depends on cache
behaviour that a direct synchronous read of the in-process world would not provide, the "no cache
to invalidate at all" simplification claimed by the roadmap row is dead, and the replacement design
must carry that behaviour explicitly — which changes the size of everything downstream.

## Instruments

- **A:** dev server + real browser. One system-panel open per condition; per-request timings from
  the network log; click→content interval via performance marks. Instrumented in the browser, not
  guessed from code.
- **B:** full census of `lib/hooks/` (44 hooks), `lib/query/keys.ts`, `useTickInvalidation`,
  `QueryBoundary`, and every `staleTime`/`invalidate`/SSE-seeding site — classified by which cache
  behaviour each consumer actually depends on.

## Evidence

### A (partial) — server-side half of the panel-open path

Conditions: live dev server (`next dev`, Turbopack, port 3000), warm routes (session in active
use), live world seed 1971552978, 600 systems, tick ~11908, tick loop running at speed 1
(~1 tick/s, `achievedTps: 1`). Timed with curl from localhost. The client-side half (click→content
split, Suspense fallback duration, waterfall serialisation) requires the browser and is **not yet
measured** — the Chrome extension was not connected this session.

```
Meaning:    Every server round-trip in a system-panel open is single-digit-to-low-tens of
            milliseconds warm — the whole server side of a panel open (RSC nav + all six API
            fetches, even fully serial) sums to ~60 ms, which cannot alone produce a visible
            loading panel. Whatever the player sees is dominated by something this half did not
            measure: client-side cost, or dev-mode cold compilation, or invalidation churn.
Claim:      Claim A (panel open dominated by client–server round-trips).
Number:     API endpoints warm, 5 runs each: events 4.9–6.9 ms; systems 5.5–9.3 ms (322 KB!);
            world 4.9–6.1 ms; substrate 5.8–12.9 ms; vitals 6.0–11.5 ms; construction 5.6–10.7 ms.
            RSC nav payload for /system/<id>: 19.1–23.3 ms (32 KB). Full SSR document: 33–41 ms
            warm (52 KB), 213 ms on the first hit of the sequence.
Horizon:    warm-server only. Cold-compile (first route hit after server start) NOT measured —
            the running server's lock blocks a second instance, and its routes were already
            compiled. Cold open vs warm open at the *query cache* level also not yet split (browser
            needed).
Cohort:     one developed system (system-24) + one other (system-77) for route-compile
            confirmation; localhost, no network latency.
Licenses:   Supports: the server round-trips themselves are not the felt cost at warm state — a
            fully serial waterfall is ~60 ms of server time. Does NOT support: any conclusion
            about where the visible load actually comes from (client render/hydration, Suspense
            fallback flash, serial waterfall's client-side re-render gaps, or first-hit dev
            compilation) — that needs the in-browser split. Does NOT support ruling Claim A out:
            round-trips include client-side scheduling gaps between serial suspense fetches,
            which curl cannot see.
```

Raw output (curl, `%{time_total}`):

```
/api/game/events run1: 0.006855s size=37370   run2: 0.005263s  run3: 0.004861s  run4: 0.004928s  run5: 0.004978s
/api/game/systems run1: 0.006530s size=322182 run2: 0.005506s  run3: 0.006288s  run4: 0.008718s  run5: 0.009293s
/api/game/world run1: 0.006058s size=116      run2: 0.004944s  run3: 0.005427s  run4: 0.004960s  run5: 0.005162s
/api/game/systems/system-24/substrate run1: 0.012904s size=539 run2: 0.012858s run3: 0.005967s run4: 0.006358s run5: 0.005824s
/api/game/systems/system-24/vitals run1: 0.011498s size=33     run2: 0.005992s run3: 0.006334s run4: 0.006455s run5: 0.006246s
/api/game/systems/system-24/construction run1: 0.010652s size=80 run2: 0.006513s run3: 0.006913s run4: 0.006309s run5: 0.005649s
document /system/system-24 run1: 0.213453s size=51951 run2: 0.035713s run3: 0.040689s
RSC /system/system-24 run1: 0.023261s size=32347      run2: 0.019850s run3: 0.019052s
document /system/system-77 run1: 0.033005s size=51959 run2: 0.041169s
world tick check: currentTick 11908 → 11911 over 3 s (speed 1, achievedTps 1)
```

Side-finding with a receipt: `/api/game/systems` is 322 KB per response — resolved by census B:
it backs the `universe` key at `staleTime: Infinity` and is never invalidated, so it is a
once-per-session read, not per-tick churn.

### B — census of the query layer's load-bearing surface (dispatched agent, receipts spot-checked)

```
Meaning:    The query layer is NOT pure boundary management. Five behaviours depend on cache
            semantics a direct synchronous world read would not supply: cross-component sync
            through a shared cached key, dedup across N mounts, referentially-stable snapshots
            driving Pixi repaints, read-modify-write against cached objects, and cross-parallel-
            route sharing. Three of the five are correctness, not just performance.
Claim:      Claim B (query layer exists solely to manage the client–server boundary).
Number:     44 hooks classed: 7 plain fetch-through / 6 static staleTime:Infinity /
            11 tick-invalidated suspense / 8 enabled-gated map layers / 13 mutations /
            7 no-query. 42 API routes, all thin service wrappers (~20 lines avg), all
            Cache-Control: private, no-cache. 5 counterexamples to Claim B (below).
            Confirmed clean: zero keepPreviousData/placeholderData, zero select, zero
            refetchInterval, zero onMutate/rollback, zero prefetch/dehydrate/HydrationBoundary,
            zero direct getQueryData outside hooks.
Horizon:    n/a (static code census, whole repo at feat/retire-nextjs == main 1aa2de02).
Cohort:     all of lib/hooks/ (44 files), lib/query/, components consuming them, app/api/game/
            (42 routes), QueryBoundary and provider wiring.
Licenses:   Supports: sizing the replacement design — it must carry (1) a subscriber/notification
            mechanism for shared reads, (2) referentially-stable snapshots (structural sharing),
            (3) a read-back path for mutation payload construction, or redesign the treasury band
            commit. Does NOT support: keeping TanStack (the roadmap Don't stands — these are
            requirements on the replacement, not a case for the cache). Does NOT support: any
            claim about panel-open latency — that is instrument A.
```

**Verdict: Falsifier B fires — Claim B is false as written.** The five counterexamples, receipts
spot-checked against the working tree:

1. **C1 — cross-component sync through one cached key (correctness).** `TrackerPanel` and
   `TrackerSettingsPanel` are siblings in separate `QueryBoundary`s that must agree instantly on
   section flags; each reads its own `useTracker()` and the shared cache entry is the designed
   synchronisation mechanism (`components/tracker/tracker-settings.tsx:66-68`,
   `components/map/map-right-rail.tsx:43-46`; behaviour pinned by
   `components/map/__tests__/map-right-rail.test.tsx:62-63`).
2. **C2 — dedup + already-resolved suspense across N mounts (perf).** `ActiveAlertFlyout` mounts
   once per alert chip, each calling `useAtlas()`; safe only because the entry is already resolved
   at `staleTime: Infinity` (`components/alerts/alert-run.tsx:307-313`; same bet in
   `components/system/pin-toggle.tsx:34,41-42`).
3. **C3 — referential stability from structural sharing (correctness at tick cadence).**
   `useOwnership` is invalidated every economy tick; structural sharing keeps `data` referentially
   stable when ownership is unchanged, and that identity gates the Pixi territory/marker rebuild
   (`lib/hooks/use-ownership.ts:22-23`, `components/map/star-map.tsx:137-150`,
   `lib/hooks/use-map-data.ts:100-118,193`). Without it: full geometry rebuild ~every second.
4. **C4 — read-modify-write against cached objects (correctness).** The treasury band commit
   builds its payload from cached bands; without the immediate `setQueryData` write, a quick
   second slider release spreads the pre-commit value and silently reverts the first change
   (`lib/hooks/use-faction-treasury.ts:29-37`). Three sibling latency-motivated sites:
   `use-player-pins.ts:20-22`, `use-player-settings.ts:25-27,40-42`.
5. **C5 — cross-parallel-route sharing (perf).** The `@panel` tree reads `useOwnership` /
   `useFactionTreasury` the map/top-bar tree already fetched — panel tab visibility costs no
   fetch because the sibling tree holds the key (`app/(game)/@panel/system/layout.tsx:24,33-36`,
   `components/top-bar.tsx:52-57`).

Full inventory (hook→key→route→settings tables, mutation/invalidation wiring, QueryBoundary
anatomy) is in the census agent's report; the classes and counts above are its summary and the
receipts above were re-read from the tree, not trusted.

**`useTickInvalidation` wiring (for the replacement design):** `economyTick` invalidates 17 key
prefixes (`lib/hooks/use-tick-invalidation.ts:20-54`); `eventNotifications` invalidates `events` +
`alerts` (`:56-61`). Signal source is the SSE `EventSource("/api/game/tick-stream")`
(`lib/hooks/use-tick.ts:94`). Exactly one SSE-seeded hook exists: `useTick` seeds
tick/speed/achievedTps from `/api/game/world` via plain `useState`, never touching the query cache
(`use-tick.ts:72-80`).

**Side-finding (pre-existing, unrelated to this measure's claims):** the `shipArrived` SSE channel
has **zero subscribers** (dispatch registry `use-tick.ts:66,110`; no `subscribeToEvent("shipArrived")`
anywhere in non-test code), and `queryKeys.visibility` is **never invalidated** despite
`use-visibility.ts:14` claiming "Invalidated on shipArrived only" — fog-of-war is a session-lifetime
read today. `use-system-logistics.ts:10` and `AGENTS.md:74` carry the same stale claim.

## Outcomes

- **Claim B: Falsified.** The "no cache to invalidate at all" simplification is dead as literally
  stated. This is the measure doing its job — the replacement data layer's requirements are now
  concrete: a subscriber/notification mechanism, referentially-stable snapshots, and a read-back
  path (or a redesigned band commit). C2/C5 are degradation-not-incorrectness and can be accepted
  or carried deliberately.
- **Claim A: Falsified as stated — see A2 below.** Network round-trips are ~32% of a cold panel
  open; the dominant cost (~240–250 ms, ~two-thirds) is client-side render work inside the
  navigation transition. Both falsifier conditions fired.

### A2 — in-browser click→content split (Chrome, real clicks on the Pixi map)

Conditions: same live dev server and world as A (600 systems, tick loop running at speed 1,
~1 tick/s). Fresh tab (page JS cold on first open). Instrument: a capture-phase `pointerdown`
listener stamping `performance.now()`, a rAF loop detecting the `role="status"` loading fallback
appearing/disappearing and panel content committing, `performance.getEntriesByType('resource')`
for the network waterfall (buffer resized — the default 250-entry buffer was full and silently
returned nothing on the first read), and a `PerformanceObserver({type:'longtask'})`. All
instrumentation was page-side JS, removed from the page afterwards; no tracked code touched.

```
Meaning:    The visible loading panel on a system click is real (~310 ms of spinner on every
            cold-target open) but it is NOT the server: round-trips account for about a third of
            it. The single biggest cost is ~240–250 ms of client-side render work between the
            last blocking fetch and the panel committing — time-sliced by React's transition
            rendering (no single ≥50 ms task), in a dev-build React. The framework still owns the
            other two-thirds' architecture: an RSC hop before any query can start, a serial
            five-fetch suspense waterfall behind it, and a fallback that flashes even fully warm.
Claim:      Claim A (panel open dominated by client–server round-trips; fallback ends when the
            last fetch resolves).
Number:     Cold-target opens (3 runs, map→panel ×2 and panel→panel ×1):
              click→content 361 / 357 / 368 ms; fallback visible from ~46-62 ms to content.
              Anatomy (consistent): RSC nav fetch @~1 ms +28-39 ms → serial waterfall
              cadence+substrate → vitals → construction → build-options, each step starting only
              after the previous resolves (~2 ms suspense-retry gaps), all done by ~104-118 ms →
              ~240-250 ms with ZERO network and ZERO ≥50 ms long tasks → commit.
            First-ever open of the session (page JS chunks cold): 713 ms (fallback at 117 ms).
            Warm reopen of an already-visited system: 72 ms click→content, including a ~15 ms
            one-frame fallback flash (the QueryBoundary mounted-guard paints its fallback once
            regardless of cache — documented at components/map/map-right-rail.tsx:55-61).
            Panel→panel switch: header renames at ~51 ms (atlas cached), body spinner otherwise
            identical to a cold open.
            Tick churn: every economy tick refetches 10-11 queries while one panel is open
            (volleys observed @468/@564/@595/@848 ms after clicks, ~1/s), occasionally with a
            ~200-240 ms long task (207 ms and 241 ms observed twice, not on every volley).
Horizon:    dev server only (next dev, React development build). Production build NOT measured —
            the ~240-250 ms render figure is dev-build React and Turbopack dev output; a prod
            measurement is the open condition before attributing it to architecture vs dev mode.
Cohort:     4 developed systems (system-538, 385, 379, 569) + 1 (429) discarded for a marker
            artefact; one faction's view; localhost.
Licenses:   Supports: the felt loading panel is real and its floor is NOT server time — killing
            the HTTP hop alone (leaving the render architecture) would shave ~115-155 ms off
            ~360 ms and a spinner would remain. Supports: the retirement's target list must
            include the route-transition render path and the per-route QueryBoundary fallback
            architecture (the mounted-guard flash means even a perfect cache still flashes),
            not only the fetch layer. Does NOT support: "React rendering is inherently too slow"
            — dev build, unprofiled; the 240 ms attribution between panel-tree render, dev-build
            overhead and map churn needs a profiler pass or a prod build. Does NOT support: the
            EU5 instant-panel bar being unreachable in-framework — warm opens are 72 ms.
Raw:        cold open system-385: fallback 46.6→361.5, content 361.5;
              res: /system/system-385?_rsc @1+28, cadence @44+14, substrate @44+24, vitals @69+17,
              construction @86+13, build-options @102+13, events @347+7; tick volleys @468, @1475.
            cold open system-379: fallback 46→356.8, content 356.8; longtasks: none;
              res: ?_rsc @1+29, cadence @47+17, substrate @48+25, vitals @75+12, construction
              @88+13, build-options @103+15, events @357+6; tick volley @595 (10 requests).
            panel→panel cold system-569: fallback 61.8→367.8; longtasks: none;
              res: ?_rsc @2+37, cadence @51+22, substrate @52+29, vitals @81+10, construction
              @92+11, build-options @104+13; tick volley @520 (10 requests). events NOT refetched
              before commit (still fresh) — commit time unchanged, killing the "content waits on
              the events fetch" alternative.
            warm reopen system-385: fallback 56.8→72.2, content 72.2; longtasks: none;
              res: ?_rsc @1+39, then construction/events/build-options/vitals @61 in PARALLEL
              (background stale refetches, non-blocking); tick volley @564.
            first-ever open system-538: fallback 117.1→712.8, content 712.8 (resource log lost to
              the full default buffer).
```

**Verdict: Falsifier A fires on both conditions** — summed blocking network ≈ 115-155 ms of
~360 ms (~32-43%, under 50%), and the fallback persists ~240-250 ms after the last blocking
response. The claim's *architecture* half survives in a weaker form worth carrying to the design
pass: the RSC hop gates the entire waterfall (nothing fetches until it returns), the five API
fetches are serial behind it, and the mounted-guard flash is per-open regardless of cache — all
three are framework artefacts the retirement removes by construction. What the retirement does
NOT automatically remove is the ~240-250 ms render cost, and sizing that (prod build, profiler)
is the first open question for `/feature-spec`.

## Build plan

Spec: [docs/planned/client-runtime.md](../planned/client-runtime.md) (spec-reviewed 2026-08-19,
amendments applied). PR structure: integration branch `shared/client-runtime`, four sub-PRs (one
per stage below); stages are check-in pauses inside those sub-PRs, never PRs of their own.

**Plan-level decisions proposed here (owner approves before /implement-plan):**
- **Store: hand-rolled on `useSyncExternalStore`, no library.** The store's whole content is this
  feature's logic (structural-sharing merge, version tracking, liveness) — a state library would
  wrap the same React primitive and own none of it. The owner deferred this choice at spec triage;
  this is the plan's proposal.
- **Router: hand-rolled History API module.** The route table is five entries; a router library's
  value (nested layouts, loaders, search-param schemas) is the framework surface being removed.
- **Web save backend: IndexedDB** (not OPFS) — Safari-safe, transactional (gives the
  atomic-or-recoverable write), and the index-record pattern fits object stores naturally.
- **New entry directory `client/`** (Vite root: entry, worker, router, fonts). `components/` and
  `lib/` stay where they are; `app/` is deleted at Task 14.
- **Desktop shell packaging (Tauri vs Electron) is NOT in this migration** — booked, see Not
  covered. The save-backend interface keeps the Node/file implementation so desktop slots in later.

### Resolution — every measure the spec's prose names, to its producer

| Measure (spec prose) | State | Producer |
|---|---|---|
| pacing frame ("tick/speed/tps/events") | exists | `TickBroadcast`, `lib/world/tick-loop.ts:23-28` |
| state frame ("UI-facing slices") | new | Task 1 `buildStateFrame` |
| coalescing throttle ("at most every 250 ms") | exists | `BROADCAST_MIN_INTERVAL_MS`, `lib/world/tick-loop.ts:44,177-203` |
| "committed world version" | exists | `getWorldVersion()` / `setWorld()` bump, `lib/world/store.ts:19-20` (every non-tick writer calls `setWorld`) |
| "value-wise merge / structural sharing" | new | Task 3 `replaceEqualDeep` (hand-rolled; technique per TanStack) |
| "worker-liveness state" | new | Task 3 store field + Task 5/11 drivers |
| "tickFailed message" | new | Task 5 (wraps the existing hard-pause path, `lib/world/tick-loop.ts:155-164`) |
| "boot configuration" (scale, DEBUG flags) | new | Task 4 `resolveHostConfig` (env under Node — `lib/constants/economy-scale.ts:29`; guard `scripts/simulate.ts:89-97` preserved) |
| "command queue drained at the tick boundary" | new | Task 2 (the await window it avoids: `lib/world/tick-loop.ts:140-141`) |
| command results (discriminated unions) | exists | mutation services (`lib/services/construction-orders.ts` etc., AGENTS convention) |
| derived views | exists | `lib/services/*` + `versionCached`, `lib/services/world-index.ts:13-33`; two worker-side: `colony-eligibility.ts`, `construction.ts` |
| save backend ("write/read/list") | exists (Node) | `lib/world/save-files.ts:44-65`; web impl new — Task 12 |
| save index record ("name, tick, savedAt, bytes") | new | Task 12 |
| "pagehide save" | new | Task 11 |
| "not found" panel state | new | Task 9 (composes `EmptyState`, props read: `{message, className}`) |
| `ServiceError` discriminant | exists (field change) | `lib/services/errors.ts`; re-pointed Task 14 |
| world-existence gate | exists | `hasWorld()`, `app/(game)/layout.tsx:15-17` → boot handshake, Task 11 |
| route table / `useRoute` | new | Task 6 |
| font variables `--font-*` | exists (producer replaced) | consumed `app/globals.css:22-24`; new producer Task 10 `@font-face` over `app/fonts/*.woff2` + self-hosted Geist |
| click-frame selected feedback | exists | map selection ring (Pixi, `star-map.tsx`) — kept, verified at Gate C |
| tick-speed audit ("acceptable max") | gate | Gate D booked end task (`/measure`) |

No `Interface` line below names a measure outside this table.

---

### Stage A — substrate (headless; no app behaviour change) — sub-PR 1

### Task 1 — Snapshot slice types and worker-side frame assembly
Files:      lib/runtime/channel.ts (new), lib/runtime/snapshot.ts (new)
Interface:  `SnapshotSlices` — the UI-facing slice types, keyed like today's query keys (atlas,
            universe, visibility, events, alerts, tracker, playerSettings, ownership, value-map
            slices, factions, relations, per-id: systemVitals/Population/Industry/Logistics/
            Construction/BuildOptions, factionVitals/Construction/Treasury incl. worker-priced
            colonyEligibility + constructionStalls);
            `StateFrame { worldVersion: number; slices: Partial<SnapshotSlices> }`;
            `buildStateFrame(world: World, since: number | null): StateFrame` (since=null gives
            the full frame);
            `PacingFrame` (= TickBroadcast shape), `TickFailedMsg { error: string }`,
            `CommandEnvelope` / `CommandResult<T>` (discriminated), `BootConfig`.
Proves:     a full frame carries every slice any panel can open on (open-panel coverage, checked
            against the slice key list); each slice in a frame is self-contained — applying only
            the newer of two frames equals applying both (drop-harmless); per-tick event lists
            never appear outside a state slice; every slice survives JSON round-trip (no
            Map/Set/Date/NaN — the postMessage/save discipline); vacuity: a seeded world's full
            frame is non-empty for every populated slice.
Consumes:   —

### Task 2 — Command queue drained at the tick boundary
Files:      lib/world/tick-loop.ts
Interface:  `TickLoop.enqueueCommand<T>(run: (world: World) => { world: World; result: T }):
            Promise<{ result: T; worldVersion: number }>` — queued; drained between ticks and
            immediately when paused; never applied inside `runWorldTick`'s await window; each
            drain commits via `setWorld` (version bump).
Proves:     a command enqueued while a tick is awaiting applies AFTER that tick and is not
            overwritten (the await-window race); on a paused loop a command applies immediately
            and bumps the version; two rapid commands apply in order and the second reads the
            first's committed state (the silent-revert kill); a throwing command rejects its own
            promise without pausing the loop or corrupting the world.
Consumes:   Task 1 (`CommandResult`)

### Task 3 — The UI-side snapshot store
Files:      lib/store/replace-equal-deep.ts (new), lib/store/game-store.ts (new),
            lib/store/use-game-store.ts (new)
Interface:  `replaceEqualDeep<T>(prev: T, next: T): T`;
            `createGameStore()` returning `{ applyStateFrame(f), applyPacingFrame(f),
            setLiveness(s: Liveness), subscribe(fn), getSnapshot(): StoreState }` with
            `Liveness = "no-world" | "live" | "paused" | "dead"`;
            React `useGameSlice<T>(select: (s: StoreState) => T): T` via `useSyncExternalStore`.
Proves:     an unchanged slice keeps object identity across two applies (the per-view identity
            bar); a changed subtree gets new identity while unchanged siblings keep theirs;
            subscribers notify once per applied version including non-tick versions; a frame
            older than the held version is ignored (out-of-order safety); vacuity: applying a
            frame to an empty store stores it verbatim.
Consumes:   Task 1

### Gate A
Arms: Tasks 1-3. Reads: vitest green including every new suite; each Proves entry red-proofed;
`npx next build --webpack` green (no app-visible change). Merge condition: sub-PR into
`shared/client-runtime`; no gameplay surface changed.

---

### Stage B — the worker runtime and shell — sub-PR 2

### Task 4 — Host seam for env-resolved constants
Files:      lib/constants/economy-scale.ts, lib/tick/processors/economy.ts,
            lib/tick/processors/events.ts, scripts/simulate.ts, client/worker/boot.ts (new)
Interface:  `resolveHostConfig(): { economyScale?: string; debugEconomy: boolean;
            debugEvents: boolean }` — reads `process.env` under Node, a host-set global under the
            worker; the worker entry sets it from `BootConfig` BEFORE dynamically importing the
            engine/constants graph (module-eval `scaleValue`/`scaleRecord` tables then see the
            resolved value); the simulate mismatch guard survives against the new resolution
            point.
Proves:     a worker booted with scale S yields S-scaled constant tables; a Node run with the env
            set behaves exactly as today; the simulate guard still crashes when an import
            reaches the constants before the config (the fault it exists for); no config means
            default 100.
Consumes:   —

### Task 5 — The game worker
Files:      client/worker/game-worker.ts (new), client/worker/host.ts (new)
Interface:  message protocol — inbound `{type:"boot", config: BootConfig}`,
            `{type:"subscribe"}`, `{type:"command", envelope: CommandEnvelope}`; outbound
            `PacingFrame`, `StateFrame`, `TickFailedMsg`, `CommandResult`. Subscribe replies
            immediately with a full pacing + state frame (paused/world-less included). The worker
            boots world-less and answers `listSaves`/`newGame`/`loadGame` commands in that state.
            Frames ride TickLoop's existing throttle; command handlers wrap the existing mutation
            services plus the two worker-side pricing services.
Proves:     subscribing to a world-less worker returns a defined no-world frame (not silence); a
            failing tick emits `TickFailedMsg` and the pause frame (never a silent stop); a burst
            of ticks inside one throttle window coalesces to a frame whose store-applied result
            equals the world (nothing lost to latest-wins); `newGame` yields a full frame for the
            fresh world; a command while paused returns its result plus a version frame.
Consumes:   Tasks 1, 2, 4

### Task 6 — Vite shell and router
Files:      vite.config.ts (new), client/index.html (new), client/main.tsx (new),
            client/router.ts (new), components/ui/button.tsx, components/ui/tabs.tsx,
            components/ui/back-link.tsx
Interface:  `navigate(path: string): void`; `useRoute(): Route` — discriminated union over the
            route table (map root, /start, /system/:id/:tab, /factions/:id/:tab, /styleguide);
            `RouterLink({ href, ...anchor })` — the `href` contract Button link-mode, `TabLink`
            and `BackLink` swap onto (their public props unchanged; props read this session:
            button.tsx:62-77, tabs.tsx:111, back-link.tsx:4).
Proves:     back/forward re-render the matching route; an unknown path lands on the map root;
            `TabLink` active state follows the route without `next/navigation`; Button link-mode
            navigates with no document reload.
Reuse:      Button, TabList/Tab/TabLink, BackLink (verified above). New: RouterLink — nothing
            fits because every existing link component delegates to `next/link`, which retires.
Consumes:   Task 5 (shell boots worker + store; top-bar clock is the end-to-end proof)

### Gate B
Arms: Tasks 4-6. Reads: `vite dev` boots the real game in-browser — worker ticks, top-bar clock
advances, speed round-trips; vitest green; simulate both horizons unchanged vs main (engine
identity — same seed, byte-equal world hash after N ticks). Merge condition: manual smoke by Kai
(clock + speed only; panels are Stage C); sub-PR into shared.

---

### Stage C — UI migration — sub-PR 3

### Task 7 — Store-backed hooks: system, faction, market, global reads
Files:      lib/hooks/use-events.ts, use-universe.ts, use-atlas.ts, use-visibility.ts,
            use-system-info.ts, use-system-{substrate,vitals,population,industry,logistics,
            construction,cadence}.ts, use-build-options.ts, use-market.ts,
            use-market-comparison.ts, use-faction.ts, use-factions.ts, use-relations.ts,
            use-faction-{vitals,construction}.ts, use-static-tiles.ts, hook test setup
Interface:  every hook keeps its existing public signature; implementation becomes
            `useGameSlice` reads. Per-id hooks return a discriminated not-found for an absent id
            (consumed by Task 9). Visibility keeps all-visible semantics.
Proves:     existing component tests pass with a store test-double replacing the QueryClient
            wrapper; the shared-store sync test (map-right-rail.test.tsx:62-63) still passes; a
            hook re-renders on its slice's version and not on unrelated slices; a per-id hook on
            an absent id returns not-found, never throws.
Consumes:   Tasks 3, 5

### Task 8 — Store-backed map hooks and mutations-as-commands
Files:      lib/hooks/use-ownership.ts, use-{stability,population,development,migration,
            provision}.ts, use-system-value-map.ts, use-trade-flow.ts, use-tracker.ts,
            use-alerts.ts, use-player-pins.ts, use-player-settings.ts,
            use-construction-orders.ts, use-faction-treasury.ts, use-game-lifecycle.ts,
            use-tick.ts, use-map-data.ts
Interface:  mutation hooks keep signatures and dispatch worker commands; the in-flight rule (a
            control holds its set value until the result's world version lands); `useTick` reads
            pacing state from the store (SSE seeding gone); ownership/value-map hooks read
            slices with the store's identity guarantee.
Proves:     ownership keeps object identity across no-change ticks (the Pixi zero-rebuild bar at
            hook level); two rapid treasury band commits — the second is built from the first's
            committed state; a pin while paused updates the tracker immediately; a rejected
            command surfaces its error and is never silently queued.
Consumes:   Tasks 3, 5, 7

### Task 9 — Panels as route components; QueryBoundary retirement
Files:      components/panels/** (new — contents move from app/(game)/@panel/** pages/layouts),
            components/map/star-map.tsx, components/ui/detail-panel.tsx,
            lib/hooks/use-system-focus.ts, components/alerts/alert-run.tsx, the 26 QueryBoundary
            mount sites, four test files mocking next/navigation
Interface:  `SystemPanel({ systemId, tab })`, `FactionPanel({ factionId, tab })`, a panel root
            switching on `useRoute()`; a not-found panel state for absent entities (composes
            EmptyState); QueryBoundary deleted — error boundaries remain via
            react-error-boundary directly.
Proves:     a panel URL naming an absent system renders the not-found state (not blank, not
            loading); no `role="status"` fallback ever mounts on a panel open; back/forward
            across panels restores content; the click frame shows the selection ring (the
            feedback bar).
Reuse:      EmptyState, DetailPanel, every existing panel body component unchanged; error
            fallback components (error-fallback.tsx). New: none — panel bodies move, not rebuilt.
Consumes:   Tasks 6, 7, 8

### Task 10 — Fonts, document shell, client env
Files:      client/fonts.css (new), client/index.html, client/fonts/ (new — Geist woff2s
            self-hosted; Chakra Petch stays at app/fonts until Task 14 moves it),
            components/game-shell.tsx, components/dev-tools/axe-accessibility.tsx
Interface:  `@font-face` rules emitting `--font-chakra`, `--font-geist-sans`,
            `--font-geist-mono` (the `@theme inline` block in globals.css untouched); client
            `NODE_ENV` reads become the bundler's dev flag.
Proves:     all three font variables resolve to loaded faces (visual smoke at Gate C); a
            production bundle contains no dev-only components (bundle grep).
Reuse:      globals.css theme as-is.
Consumes:   Task 6

### Task 11 — Lifecycle: start screen, world replacement, failure surfaces
Files:      components/start/start-screen.tsx, components/start/create-faction-form.tsx,
            client/main.tsx, components/runtime/liveness-banner.tsx (new), pagehide save wiring,
            store swap-reset path
Interface:  start-screen actions become worker commands (listSaves/newGame/loadGame) valid
            world-less; world replacement per spec §8 — navigate to map root, one-commit store
            swap, Pixi teardown/rebuild; `LivenessBanner` renders tickFailed (paused + cause +
            autosave offer) and dead-worker (reload-from-autosave) states; a `pagehide` save in
            the web packaging; autosave failure surfaces through the same banner.
Proves:     new game from a live game lands on the map root with no stale panel URL and no
            no-world throw reaching a render; a terminated worker flips liveness to dead,
            commands reject, the banner offers reload; tickFailed shows cause and pause; reads
            during the swap window get the defined no-world state.
Reuse:      Card, Button, Dialog/useDialog (read before use at implementation), alert-bar styling
            as reference. New: LivenessBanner — searched "banner", "toast", "connection": nothing
            app-level exists; the alert bar is game-alert-specific.
Consumes:   Tasks 5, 6, 8

### Gate C
Arms: Tasks 7-11. Reads: the full game runs under Vite; Kai smokes every surface side-by-side
against the Next build (same save loaded in both); vitest green; the A2 browser instrument re-run
on the new panel opens — informational against the ~100 ms aim, not a merge gate (owner decision).
Merge condition: owner smoke sign-off; sub-PR into shared.

---

### Stage D — persistence, dev loop, deletion — sub-PR 4

### Task 12 — Save backend seam and the web backend
Files:      lib/world/save-backend.ts (new — interface), lib/world/save-files.ts (becomes the
            Node/file implementation), client/save-indexeddb.ts (new),
            lib/world/tick-loop.ts (autosave via the seam), start-screen export/import controls
Interface:  `SaveBackend { write(name, json): Promise<void>; read(name): Promise<string>;
            list(): Promise<SaveInfo[]>; remove(name): Promise<void> }` — write is
            atomic-or-recoverable (IndexedDB transaction, write-then-swap-key); `SaveInfo`
            gains its values from an index record (name, tick, savedAt, bytes) written in the
            same transaction; `navigator.storage.persist()` requested at boot; export/import
            moves the raw save JSON.
Proves:     an interrupted write (value committed, index not) recovers to the last good save;
            listing never parses save blobs (index only — proven by listing cost on a multi-MB
            fixture); a simulated quota failure surfaces through the banner, not the console;
            export then import round-trips byte-equal.
Consumes:   Tasks 5, 11

### Task 13 — Dev loop and cheats
Files:      lib/hooks/use-dev-tools.ts, client/worker/game-worker.ts (dev command registration,
            build-time excluded), lib/services/dev-tools.ts (advanceTicks through the loop's
            notify path), dev teardown save + boot-from-save, dev world-inspection command
Interface:  dev commands (advanceTicks, spawnEvent, resetEconomy, economySnapshot, inspectWorld)
            registered only when the bundler's dev flag is set; advanceTicks publishes a world
            version per batch; the dev worker saves on teardown and its replacement boots from
            that save (spec §10).
Proves:     advanceTicks leaves the store current (no stale UI); a production bundle contains no
            dev command handler (bundle grep); a worker module edit in dev restores the running
            galaxy from the teardown save (manual, Gate D).
Consumes:   Tasks 5, 12

### Task 14 — The deletion and repo re-point
Files:      delete app/api/** (46 routes), app/(game)/**, app/start/** (old pages), app/layout.tsx,
            components/ui/query-boundary.tsx, components/providers/query-provider.tsx,
            lib/query/**, lib/api/** (all four files are route-only — verified),
            lib/hooks/use-tick-invalidation.ts; shipArrived removal (lib/tick/types.ts
            GlobalEventMap, lib/tick/processors/ship-arrivals.ts:34, lib/hooks/use-tick.ts
            dispatch, docstrings use-visibility.ts:14 + use-system-logistics.ts:10);
            lib/services/errors.ts (`status` becomes a discriminant) + its consumers;
            package.json (drop next/@tanstack/geist; scripts: dev/build to vite, the build gate
            becomes `tsc && vite build`), .github/workflows/ci.yml, next.config.ts (delete),
            AGENTS.md (Commands, the Next/TanStack gotcha rows, line 74), docs/SPEC.md
            (interaction map: SSE to worker channel; shipArrived edge removed)
Interface:  none new — this task removes; the repo's build gate identity changes and AGENTS.md
            names the new one.
Proves:     the new build gate is green with Next absent; repo-wide grep finds zero live
            `next/`, `@tanstack`, `queryKeys`, `apiFetch`, `QueryBoundary`, `shipArrived`
            references outside git history; the full test suite is green; the stranded-reader
            text sweep (AGENTS rule) over fields/props/helpers the deletion orphans comes back
            empty.
Consumes:   Tasks 7-13 (everything must already run without what this deletes)

### Task 15 — Doc fold and final verification
Files:      docs/SPEC.md, docs/active/engineering/single-player-runtime.md (rewritten for the
            worker runtime), docs/planned/client-runtime.md (promoted to docs/active, present
            tense), docs/planned/grand-strategy-vision.md (§6 path decision recorded),
            docs/ROADMAP.md (row deleted; desktop-shell row added), this working file (deleted)
Interface:  none — docs only; the deferred-work sweep before deletion (grep this file and the
            spec for deferred/booked items; verify each reached the roadmap).
Proves:     no doc in docs/active describes the Next runtime; `npm run duplication` on the
            branch diff; every booking named in Not covered exists as a roadmap row.
Consumes:   Task 14

### Gate D — final (shared to main PR)
Arms: Tasks 12-15. Reads: new build gate green; full vitest; `npm run simulate` both horizons
quoted with the engine-identity check (same seed, byte-equal world hash vs main after N ticks —
the "engine untouched" proof); full manual smoke by Kai; **the booked end task runs here:
`/measure` tick speed at high system and population counts, producing the acceptable-maximum
report** (informs the roadmap's tick-performance rows; not a merge gate). Merge condition: all of
the above plus owner sign-off; squash shared to main.

---

### Verification

The feature's proof is behavioural parity plus the removals: (1) engine identity — same seed,
same tick count, byte-equal `JSON.stringify(world)` hash between main and the branch, run under
`npm run simulate` (the engine-untouched claim, both horizons quoted); (2) the A2 browser
instrument re-run on the new runtime (cold/warm panel opens, tick churn) — informational against
the ~100 ms aim; (3) the build gate — `npx next build --webpack` through Stage C, `tsc && vite
build` from Task 14 on (AGENTS.md updated in the same commit); (4) no new harness metric — the
sim is untouched by design, and the identity check is what proves that.

### Doc fold

`docs/active/engineering/single-player-runtime.md` goes stale (rewritten, Task 15);
`docs/planned/client-runtime.md` is superseded by its promotion to docs/active;
`grand-strategy-vision.md` §6's "don't decide today" is resolved to path B (recorded, Task 15);
AGENTS.md's Next/TanStack gotchas and commands change at Task 14, on the branch. This working
file is deleted at ship, after the deferred-work sweep.

### Not covered

- **Desktop shell packaging (Tauri vs Electron)** — booked: new roadmap row at Task 15 (the
  save-backend seam and §11's channel boundary are its prerequisites, both shipped here).
- **Worker-side dirty-sets / delta frames** — booked: the existing roadmap row *Markets need a
  real dirty/ownership model* (spec §2 gates the optimisation on it).
- **The ~100 ms p95 panel aim as an enforced gate** — dropped by owner decision at spec triage
  ("the performance targets can come later"); re-raised by the Gate C/D informational readings.
- **The events processor's scaling and tick performance rows** — booked already (roadmap, Tick
  performance section); the Gate D tick-speed audit feeds them.
- **Multiplayer** — dropped per the spec's Not-claimed.
- **Nested tooltips migration, map accessibility, and every other UI roadmap row** — untouched;
  they ride on components this plan deliberately does not rebuild.

### Net-new UI (owner approval before /implement-plan)

- `RouterLink` (Task 6) — infrastructure, replaces `next/link` inside the three link-bearing
  primitives; no visual change.
- `LivenessBanner` (Task 11) — the only genuinely new visible component: tick-failure / dead
  worker / autosave-failure banner with cause and autosave-restore offer.
- Not-found panel state (Task 9) — composes the existing `EmptyState`; a state, not a component.
- Start-screen export/import controls (Task 12) — two Buttons on the existing start screen.

Everything else is moved or re-wired, not new; no HTML prototype pass is owed under the
approved-prototype rule unless the owner wants one for `LivenessBanner`.
