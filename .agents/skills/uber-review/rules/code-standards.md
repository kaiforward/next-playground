# Code-review projection of AGENTS.md

**`AGENTS.md` is the canonical source** of every project rule and its rationale — its **`## Conventions`** and **`## Gotchas / Known Pitfalls`** sections. The `/uber-review` orchestrator injects those two sections verbatim into the reviewer agents, so the rules live in exactly one place. **This file does NOT restate them.** It is the *review projection*: the dedup `category` slug for each flaggable rule, plus review-only flagging nuance (false-positive traps) that doesn't belong in AGENTS.md.

When you flag a violation, use the matching slug below so dedup is deterministic. To find a rule's meaning, read the injected AGENTS.md sections — not this file.

## Category slugs

### Conventions (AGENTS.md `## Conventions`, plus the UI / Quality-checklist rules)

| Slug | Flags (read AGENTS.md for the rule) |
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

### Gotchas (AGENTS.md `## Gotchas / Known Pitfalls`)

| Slug | Flags (read AGENTS.md for the rule) |
|------|-------------------------------------|
| `world-not-serializable` | a `Map`/`Set`/`Date`/class instance or `Infinity`/`NaN` stored in `World` state (breaks JSON save/load) |
| `static-node-edge-in-pure-path` | static `fs`/`process.env` import in `lib/engine` / `lib/services` / `lib/world` (except `save-files.ts`) — use a dynamic `import()` |
| `nondeterministic-tick` | `Date.now` / `Math.random` / `new Date()` inside a processor body or tick math (use seeded `tickRng`) |
| `record-includes` | `.includes()` on a `Record` (e.g. `ECONOMY_PRODUCTION[type]`) — use the `in` operator / an accessor |
| `immutable-on-api` | `Cache-Control: immutable` (or a long `max-age`) on an API response — a new game replaces world state |
| `sort-mutates-state` | `.sort()` on a React state array during render (use `[...arr].sort()` / `.toSorted()`) |
| `unawaited-async-callback` | a child not awaiting an async callback prop (type it `() => Promise<void>`) |
| `sse-without-seed` | an SSE-driven hook with no REST seed of initial state |
| `debounce-in-render-loop` | debounce (not throttle) on a Pixi-ticker → `setState` loop |
| `deferred-in-reach` | a new `docs/BACKLOG.md` row deferring a cheap, self-contained problem in a file this diff already edits — see nuance below |
| `stranded-by-own-change` | a field/prop/helper this diff leaves with no readers — dead code the same diff created — see nuance below |

## Flagging nuance (review-only — not in AGENTS.md)

Distinguish carefully before flagging; these are the recurring false-positive traps:

- **`non-null-assertion`** — only the **postfix `!`** operator (`foo!`, `foo!.bar`, `arr[i]!`, `getThing()!`). NEVER flag `!foo` (logical-not), `!==` / `!=` (inequality, incl. `x !== null`), or `!!foo` (boolean coercion). **And do NOT flag `find(...)!` in test files** — it is an accepted project idiom (AGENTS.md Conventions). Confirm the `!` is postfix at the character level before flagging.
- **`as-cast`** — the `as` type-assertion keyword (`x as Foo`), not the word "as" in identifiers / comments / strings; `as const` is permitted.
- **`unknown-in-types`** — the literal `unknown` in a type position, not the English word in prose.
- **`sort-mutates-state`** — only a `.sort()` on a React **state** value during render, not every `.sort()`.
- **`static-node-edge-in-pure-path`** — flag a **static** `import` of `fs`/`node:fs`/`process.env` reads in `lib/engine`, `lib/services`, or `lib/world` (except `save-files.ts`). A dynamic `await import(...)` inside a function body is the sanctioned pattern; don't flag those, and don't flag Node imports in `scripts/` or route handlers.
- **`world-not-serializable`** — flag a `Map`/`Set`/`Date`/class instance or a possible `Infinity`/`NaN` assigned into a `World` row / `meta`. Ordinary local `Map`/`Set` inside a processor body (not persisted into `World`) is fine.
- **`deferred-in-reach`** — the one case where a `docs/BACKLOG.md` addition IS reviewable, and the deliberate exception to "respect clearly-deferred items". Flag only when all three hold: the row is **added by this diff**, it describes a problem in a file **this diff already edits**, and fixing it needs no design decision. Judge cheapness by judgement required, not lines touched — a compiler-guided mechanical sweep is cheap at any size. Escalate to `major` when the commit message or PR body claims the review findings were fixed. Do NOT flag pre-existing backlog rows, rows about untouched files, or anything needing a design call — those are legitimate deferrals.
- **`stranded-by-own-change`** — the companion to `deferred-in-reach`: that slug fires only when a diff *books* the dead code, this one when it simply leaves it. Flag when this diff removes the last reader of a field/prop/helper and does not remove the thing itself. Verify the last reader is actually gone — grep the whole repo, not the diff, and remember a declaration reached through generic inference (an object literal returned from an `Array.from`/`map` callback) never trips TypeScript's excess-property check, so "tsc is clean" is not evidence the sweep was complete. Do NOT flag code that was already dead before this diff — that is pre-existing, and belongs to whoever stranded it.
- Non-executable text (markdown, prompts, YAML) is never a violation by content match — see the severity rubric's scope guard. The `deferred-in-reach` slug above is the one exception, and it flags the *act of deferring*, not any rule matched inside the prose.

## Maintenance note

`AGENTS.md` is canonical. When a convention or gotcha is added there, add its `category` slug here in the same change (plus any review-only false-positive nuance). Slugs are lowercase-kebab-case, short, and stable — renaming one fragments dedup history. Do **not** copy rule text or rationale into this file; that's AGENTS.md's job. This file only carries the slug and review-only nuance.
