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

(to be filled by the instruments — raw output pasted, not summarised)
