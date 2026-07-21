# Reviewer context routing

Use this table to minimize repeated context without weakening a review. `AGENTS.md` remains canonical: extract the named current bullets/subsections verbatim at dispatch time.

| Reviewer | Changed-file payload | Project-rule context |
|----------|----------------------|----------------------|
| Architect | Full in-scope source diff plus changed design/spec docs. Exclude user-requested paths, assets, generated files, and unrelated config. | Only architecture/layering rules needed for Lens 1. Lens 2 reads the changed spec docs directly. |
| Conventions | All changed executable source hunks; exclude docs and unchanged whole-file content. | Changed paths' applicable Conventions/Gotchas plus matching `code-standards.md` rows and nuance. Omit UI rules when there is no UI, map rules when there is no map, and boundary rules handled by another lens. |
| World integrity | Runtime hunks under `lib/world`, `lib/tick`, `lib/engine`, and `lib/services`; exclude tests unless needed to understand a claimed guard. | JSON serialization, determinism, tick atomicity, worker portability, processor architecture, world-shape/save-version rules. |
| Data contract | Changed contract-bearing runtime hunks across participating layers: world types, adapters, services, API, hooks, components, and shared types. Include a layer only when it participates in the changed contract. | Boundary narrowing, no `unknown`, no casts, typed maps/unions, generic integrity, result unions, and `ApiResponse<T>`. |
| Boundary safety | Only changed route/service/schema/save/world hunks that receive input or touch env, cache headers, or file paths. Include triggering source hunks found by the boundary grep gate. | Zod/system-boundary validation, client-trusted writes, save-path safety, API caching, and server-only env rules. |
| Silent failures | Changed runtime hunks containing async control flow, error handling, cadence/pulse/shard gates, state sorting, SSE seeding, or throttle/debounce behavior. For engine/tick changes, include directly changed gating callers. | Await/async callback, swallowed-error, render-state sort, SSE seed, throttle, and tick-boundary rules only. |
| User journey | Changed `app/(game)` and `components` runtime hunks plus directly changed hooks they consume. | QueryBoundary/Suspense, shared UI/form primitives, dialog behavior, lifted cached state, semantic UI, and interaction rules applicable to the changed surface. |
| Tests | Changed testable runtime hunks and their changed/co-located tests. Include tick-harness analysis/metrics when gameplay behavior changes. | Engine purity/testing, real in-memory adapter/store tests, simulator-evidence practice, no-jsdom constraint, and meaningful-assertion guidance. |
| Performance | Changed production runtime hunks only; exclude tests, docs, and type-only declarations unless they change runtime representation. | Tick hot-path/peak-latency rules, gameplay-vs-performance separation, query/render performance, and map/Pixi rules only when those surfaces changed. |

## Payload rules

- Prefer a unified diff slice plus a file manifest over whole-file copies.
- Count payload files and added/deleted lines before dispatch and show them in the preflight.
- Allow the reviewer to read a whole file or direct caller only when needed to verify a concrete candidate.
- Do not send docs to downstream executable-code lenses merely because docs share a chunk.
- Do not repeat the full `AGENTS.md` sections. Extract only the rows above from the current file.
- If path routing would omit a changed file that directly participates in the reviewer's data/control flow, include it and record why.
