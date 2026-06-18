# Project code standards (forbidden patterns)

Patterns explicitly forbidden by `CLAUDE.md`. The Conventions agent uses this as its checklist; other agents may reference it too. When flagging a violation, use the suggested category slug for dedup consistency.

## Type safety

- **No `as` casts** — category: `as-cast`
  - Only `as const` and casts inside runtime guards in `lib/types/guards.ts` are permitted.
  - Any other `as Foo` is a violation.

- **No non-null assertion `!`** — category: `non-null-assertion`
  - This rule covers the **TypeScript postfix `!` operator only** — `foo!`, `foo!.bar`, `arr[i]!`, `getThing()!`. It strips `null | undefined` from the type without a runtime check.
  - This rule does NOT cover any of the following — these are normal operators and **never** a violation:
    - `!foo` (logical-not, prefix)
    - `!==` / `!=` (inequality comparisons; e.g. `bestId !== null` is a guard, NOT an assertion)
    - `!!foo` (boolean coercion)
    - `if (!foo)`, `while (!done)`, etc.
  - Before flagging: confirm the offending character is a **postfix `!`** directly attached to an expression (`identifier!`, `expr.prop!`, `expr[i]!`, `(expr)!`). If the `!` is in a prefix or comparison position, it is not a non-null assertion — do not flag.
  - Exception: postfix `!` is acceptable only in narrow contexts where a runtime check immediately precedes (rare and worth scrutiny).

- **No `unknown` in the codebase** — category: `unknown-in-types`
  - `Record<string, unknown>`, `unknown`, and untyped maps/arrays are banned in components, hooks, services, processors, engine, constants.
  - Only exception: `JSON.parse` result at a system boundary (API route, sessionStorage) — must be narrowed via `typeof`/`in` immediately, never stored as `unknown`.

- **Generics must stay generic** — category: `generic-widened`
  - `DataTable<T>` and similar must work with `T` directly.
  - Never intersect `T` with `Record<string, unknown>` or widen to weaken type safety.
  - Use typed accessor functions (`render(row: T)`, `getValue(row: T)`) over string-key property access.

## API & data flow

- **Validate at boundaries only** — category: `boundary-validation-leak`
  - Prisma returns strings for union fields; validate once in the service layer using `lib/types/guards.ts`.
  - Components, hooks, processors never re-validate types that were already validated upstream.

- **Mutation services return discriminated unions** — category: `loose-mutation-result`
  - Pattern: `{ ok: true; data } | { ok: false; error }`.
  - Never `{ ok: boolean; data?; error? }`.

- **API responses use `ApiResponse<T>`** — category: `api-response-shape`
  - Shape: `{ data?: T, error?: string }`.

## UI

- **Use existing form components, never raw `<input>` / `<select>`** — category: `raw-form-element`
  - `TextInput`, `NumberInput`, `RangeInput`, `SelectInput` from `components/form/`.

- **`"use client"` only when needed** — category: `unnecessary-use-client`
  - Components without hooks, state, or event handlers don't need it.

- **No `.sort()` on state arrays during render** — category: `sort-mutates-state`
  - Use `[...arr].sort()` or `.toSorted()`.

- **Data fetching uses `useSuspenseQuery` + `QueryBoundary`** — category: `non-suspense-data-fetch`
  - Deviations are architect-level.

## Server / DB

- **TOCTOU in mutating routes** — category: `toctou-outside-tx`
  - Re-read state inside `prisma.$transaction` before writing.
  - Never compute new values from a pre-transaction snapshot.
  - Use `{ increment }` for atomic numeric updates.

- **Prisma 7 driver adapter required** — category: `missing-driver-adapter`
  - `new PrismaClient()` without an adapter throws.

- **PostgreSQL transaction timeout** — category: `missing-tx-timeout`
  - Default 5000ms; set `{ timeout: 30_000 }` on `$transaction()`.

- **Auth-gated routes use `Cache-Control: private`** — category: `cache-public-on-auth-route`
  - Never `public` on routes behind `requirePlayer()`.

- **Never `Cache-Control: immutable` on APIs** — category: `immutable-on-api`
  - For static assets only.

## Async correctness

- **Await async callbacks** — category: `unawaited-async-callback`
  - If a parent passes an async callback, the child must `await` it.
  - Prop types should be `() => Promise<void>` not `() => void` when the callback is async.

- **SSE hooks seed initial state via REST** — category: `sse-without-seed`
  - Otherwise components see stale defaults until first SSE event.

- **Throttle (not debounce) for high-frequency render loops** — category: `debounce-in-render-loop`
  - Pixi ticker etc.

## Comments

- **Comments describe code, not plans** — category: `comment-references-plan`
  - A comment must explain the code as it is: what it does, why, invariants, and gotchas — anchored to real symbols, files, and behavior.
  - Never reference an implementation plan, build phase, PR number, sub-project, or migration stage (e.g. "PR3b Phase 4", "the substrate rebuild", "retired in Phase 1", "until SP1 ships"). These rot the moment the plan moves and mean nothing to a future reader of the code.
  - Don't cite plan or design docs from code comments. (The spec's own `[PENDING: <system>]` markers live in `docs/`, not in code.)
  - A temporary shim/workaround SHOULD be labelled temporary and state — in code terms — the condition that lets it go away (e.g. "drop once `X` is non-null everywhere"), but not by naming a plan, phase, or PR.

## Maintenance note

This list grows. When a new project convention is discovered, add it here in the next PR alongside the fix. Categories are slugs for deterministic dedup — keep them lowercase-kebab-case and short.
