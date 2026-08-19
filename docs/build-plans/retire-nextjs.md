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

Side-finding with a receipt: `/api/game/systems` is 322 KB per response, and the tick loop
invalidates every mounted query ~every second — if that key is tick-invalidated, the client
re-downloads ~322 KB/s while the map is open. Whether it is tick-invalidated is part of census B.

(census B and the in-browser half: pending)
