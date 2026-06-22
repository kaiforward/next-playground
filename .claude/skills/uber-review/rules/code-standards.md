# Code-review projection of CLAUDE.md

**`CLAUDE.md` is the canonical source** of every project rule and its rationale — its **`## Conventions`** and **`## Gotchas / Known Pitfalls`** sections. The `/uber-review` orchestrator injects those two sections verbatim into the reviewer agents, so the rules live in exactly one place. **This file does NOT restate them.** It is the *review projection*: the dedup `category` slug for each flaggable rule, plus review-only flagging nuance (false-positive traps) that doesn't belong in CLAUDE.md.

When you flag a violation, use the matching slug below so dedup is deterministic. To find a rule's meaning, read the injected CLAUDE.md sections — not this file.

## Category slugs

### Conventions (CLAUDE.md `## Conventions`, plus the UI / Quality-checklist rules)

| Slug | Flags (read CLAUDE.md for the rule) |
|------|-------------------------------------|
| `as-cast` | `x as Foo` outside `as const` / a `lib/types/guards.ts` guard |
| `non-null-assertion` | postfix `!` (`foo!`, `arr[i]!`, `getThing()!`) — see nuance below |
| `unknown-in-types` | `unknown` / `Record<string, unknown>` / untyped maps in app code |
| `generic-widened` | a generic `T` intersected with `Record<string, unknown>` or accessed by string key |
| `boundary-validation-leak` | re-validating downstream a type already validated in the service layer |
| `loose-mutation-result` | a mutation result that isn't a discriminated union (`{ ok: true; data }` / `{ ok: false; error }`) |
| `api-response-shape` | an API response that isn't `ApiResponse<T>` (`{ data?, error? }`) |
| `raw-form-element` | raw `<input>` / `<select>` instead of the `components/form/` controls |
| `unnecessary-use-client` | `"use client"` on a component with no hooks / state / handlers |
| `non-suspense-data-fetch` | client data fetch not via `useSuspenseQuery` + `QueryBoundary` |
| `comment-references-plan` | a comment naming a plan / phase / PR / migration instead of describing the code |

### Gotchas (CLAUDE.md `## Gotchas / Known Pitfalls`)

| Slug | Flags (read CLAUDE.md for the rule) |
|------|-------------------------------------|
| `missing-driver-adapter` | `new PrismaClient()` with no `@prisma/adapter-pg` |
| `missing-tx-timeout` | `$transaction()` without `{ timeout: 30_000 }` |
| `n+1-writes-in-tx` | per-row `create` / `update` / `findMany` inside `$transaction` (batch via `createMany` / `unnest()`) |
| `tx-error-swallowed` | catching a query error inside `$transaction` and continuing on the same `tx` (PG aborts it) |
| `nan-to-raw-sql` | `NaN` / `Infinity` reaching raw SQL unguarded |
| `int-overflow-sentinel` | `MAX_SAFE_INTEGER` / `Infinity` into a Prisma `Int` (`int4`); use a `2_000_000_000` sentinel |
| `static-prisma-in-unit-graph` | static `@/lib/prisma` import (direct or transitive) in a unit-tested module — use a dynamic import |
| `record-includes` | `.includes()` on a `Record` (e.g. `ECONOMY_PRODUCTION[type]`) — use the `in` operator / an accessor |
| `toctou-outside-tx` | computing a write from a pre-`$transaction` snapshot instead of re-reading inside |
| `cache-public-on-auth-route` | `Cache-Control: public` on a `requirePlayer()`-gated route (use `private`) |
| `immutable-on-api` | `Cache-Control: immutable` on an API response |
| `sort-mutates-state` | `.sort()` on a React state array during render (use `[...arr].sort()` / `.toSorted()`) |
| `unawaited-async-callback` | a child not awaiting an async callback prop (type it `() => Promise<void>`) |
| `sse-without-seed` | an SSE-driven hook with no REST seed of initial state |
| `debounce-in-render-loop` | debounce (not throttle) on a Pixi-ticker → `setState` loop |

## Flagging nuance (review-only — not in CLAUDE.md)

Distinguish carefully before flagging; these are the recurring false-positive traps:

- **`non-null-assertion`** — only the **postfix `!`** operator (`foo!`, `foo!.bar`, `arr[i]!`, `getThing()!`). NEVER flag `!foo` (logical-not), `!==` / `!=` (inequality, incl. `x !== null`), or `!!foo` (boolean coercion). **And do NOT flag `find(...)!` in test files** — it is an accepted project idiom (CLAUDE.md Conventions). Confirm the `!` is postfix at the character level before flagging.
- **`as-cast`** — the `as` type-assertion keyword (`x as Foo`), not the word "as" in identifiers / comments / strings; `as const` is permitted.
- **`unknown-in-types`** — the literal `unknown` in a type position, not the English word in prose.
- **`sort-mutates-state`** — only a `.sort()` on a React **state** value during render, not every `.sort()`.
- Non-executable text (markdown, prompts, YAML) is never a violation by content match — see the severity rubric's scope guard.

## Maintenance note

`CLAUDE.md` is canonical. When a convention or gotcha is added there, add its `category` slug here in the same change (plus any review-only false-positive nuance). Slugs are lowercase-kebab-case, short, and stable — renaming one fragments dedup history. Do **not** copy rule text or rationale into this file; that's CLAUDE.md's job. This file only carries the slug and review-only nuance.
