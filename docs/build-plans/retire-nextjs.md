# Retire Next.js + TanStack Query — working file

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
