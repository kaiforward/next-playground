# Stellar Trader

Browser-based multiplayer space trading game.

**Important**: Read `docs/SPEC.md` at the start of every session to understand the full game, all active systems, and how they interact. The SPEC is the functional source of truth — this file is the code reference.

## Skills

- `/bootstrap` — Run environment checks (node, deps, database, env, outdated packages, build)

## Commands

- `npm run dev` — Start dev server (Turbopack)
- `npm run build` — Production build
- `npx vitest run` — Run unit tests
- `npm run simulate` — Quick sanity check (all strategies, 500 ticks, seed 42). **Main game economy only** — does not simulate mini-games.
- `npm run simulate -- --config <file>` — Run experiment from YAML config (saves to `experiments/`). Main game economy only.

The simulator is a **calibration harness**, not a game feature — it runs the same economy tick the live game does, with synthetic "bots" providing trading pressure (`lib/engine/simulator/bot.ts`). There are no NPC bots in the live game; the simulator is for validating economy changes against equilibrium targets before they hit players.

- `npx prisma db seed` — Seed database (scale controlled by `UNIVERSE_SCALE` in `.env`: `"default"` = 600 systems/7K map, `"10k"` = 10,000 systems/25K map)
- `npx prisma db push` — Push schema changes to PostgreSQL

## Tech Stack

Next.js 16 (App Router), TypeScript 5 (strict), Tailwind CSS v4 + tailwind-variants, PostgreSQL via Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`), NextAuth v5 (JWT/Credentials), TanStack Query v5 (Suspense mode), react-error-boundary, React Flow v12, Recharts, React Hook Form + Zod v4, Vitest 4.

**Prisma 7 gotcha**: Seed command lives in `prisma.config.ts` under `migrations.seed`, not in `package.json`. Command: `npx tsx --tsconfig tsconfig.json prisma/seed.ts`.

## Project Structure

Core layers (fixed roles — see CLAUDE.md conventions for rules):
- `lib/engine/` — Pure game logic. Zero DB dependency. Test with Vitest.
- `lib/services/` — All DB access and business logic. Route handlers are thin wrappers.
- `lib/tick/` — Tick engine and processor pipeline. Each processor splits into a typed `World` interface (`lib/tick/world/`), a Prisma adapter (`lib/tick/adapters/prisma/`), an in-memory adapter when the simulator needs it (`lib/tick/adapters/memory/`), and a pure processor body (`lib/tick/processors/`). Live and sim run the same body. See `docs/active/engineering/processor-architecture.md`.
- `app/api/game/` — Thin HTTP wrappers: auth check → call service → NextResponse.json.
- `app/(game)/` — Game UI pages. `app/(auth)/` — Auth pages.
- `prisma/` — Schema and seed script.

## Docs

Functional spec: `docs/SPEC.md` — master game spec with system interaction map. Read this first.

Design docs (under `docs/`):
- `docs/active/` — Implemented systems, split by type: `gameplay/` (economy, events, trading, trade-simulation, navigation, universe, system-traits, faction-system, combat, notifications, …), `engineering/` (tick-engine, processor-architecture, map-data-loading), `design-system/` (theme)
- `docs/planned/` — Designed but not yet built (war-system, facilities, production, player-progression, multiplayer-infrastructure, …)
- `docs/archive/` — Historical design docs (may be outdated)
- `docs/plans/` — Transient, code-heavy build plans for in-flight features. **Delete each once its feature ships** — the functional spec moves to `docs/active/` and the code is the source of truth. Functional roadmaps that merely order unbuilt features go in `docs/planned/`, not here.
- `docs/BACKLOG.md` — Actionable work items (delete when shipped)

## Design Principles

These apply to every layer — components, hooks, services, engine, processors, constants.

- **Separation of concerns** — Each layer has one job. Components render UI. Hooks manage data fetching and client state. Services own business logic and DB access. Engine functions are pure computation. Route handlers are thin wrappers. Prefer additional boilerplate (hooks, schemas, services) over mixing concerns in a single file.
- **DRY (Don't Repeat Yourself)** — When logic, markup, or configuration appears in more than one place, extract it. Shared UI goes in `components/ui/` or `components/form/`. Shared business logic goes in `lib/utils/` or `lib/engine/`. Shared types go in `lib/types/`. The second occurrence is the signal to extract — don't wait for a third.
- **KISS (Keep It Simple)** — Solve the current problem with the minimum necessary complexity. Don't add indirection, abstraction, or configuration for hypothetical future needs. A straightforward 20-line function is better than a clever 5-line one. When choosing between approaches, pick the one that's easiest to read, debug, and delete.
- **Reusability** — Design interfaces (props, function signatures, types) for the next 10 uses, not just the current one. Use typed props, discriminated unions, and explicit accessor functions over loose string keys or open-ended config objects.
- **Security** — Validate at system boundaries (API routes, form schemas). Use Prisma transactions with optimistic locking for mutations. Never trust client state for writes.

## Conventions

- **No `as` type assertions** — The only permitted uses of `as` are `as const` and inside runtime type guard functions (`lib/types/guards.ts`) that validate before returning. All other `as` casts are strictly forbidden. If TypeScript can't infer the type, fix the types at the source rather than casting at the consumer.
- **Type at the boundary, trust downstream** — Prisma returns strings for union fields; validate these once in the service layer using guards from `lib/types/guards.ts`. Services return fully typed data — components, hooks, and processors never re-validate types that were already validated upstream. If a component needs a type guard, the service isn't returning the right type.
- **No `unknown` in the codebase** — `Record<string, unknown>`, `unknown`, and untyped maps/arrays are banned everywhere: components, hooks, services, processors, engine, constants. The only exception is `JSON.parse` results at system boundaries (API routes, sessionStorage), which must be narrowed immediately with `typeof`/`in` checks — never stored as `unknown`. If a type is too loose, fix it at the source: use Prisma-generated types for where clauses (`Prisma.ModelWhereInput`), typed event maps for event data, specific value unions for filter params. Extra boilerplate is always preferable to `unknown`.
- **Generics must stay generic** — Generic components like `DataTable<T>` must work with `T` directly, never intersect it with `Record<string, unknown>` or widen it to weaken type safety. Use typed accessors (`render(row: T)`, `getValue(row: T)`) instead of string-key property access. If a generic component needs to access row data, require explicit accessor functions — never cast `T` to access properties by dynamic key.
- Engine functions are pure — no DB imports. Test with Vitest.
- Prisma singleton in `lib/prisma.ts` — always use this, never create new clients.
- Prisma Client imported from `@/app/generated/prisma/client`.
- Tailwind v4 theme is in `globals.css` (`@theme inline {}`), no tailwind.config.js.
- API responses use `ApiResponse<T>` format: `{ data?: T, error?: string }`.
- Services layer (`lib/services/`) holds all DB/business logic. Route handlers are thin wrappers. Read services throw `ServiceError`; mutation services return discriminated unions.
- **Discriminated unions for result types** — `{ ok: true; data } | { ok: false; error }`, never `{ ok: boolean; data?; error? }`.
- **Avoid the postfix `!` non-null assertion** — strip `null | undefined` with a real check, not `foo!`. Exception: `find(...)!` in tests is an accepted project idiom.
- Client data fetching uses TanStack Query hooks (`lib/hooks/`) with `useSuspenseQuery`. Pages/components wrap data-fetching sections in `QueryBoundary` instead of inline loading/error checks. Query keys are centralized in `lib/query/keys.ts`. Ship arrival invalidation is centralized in `useTickInvalidation` — pages do not subscribe to arrivals individually.
- Forms use React Hook Form + Zod schemas (`lib/schemas/`). Use `TextInput`/`NumberInput`/`SelectInput` from `components/form/`, never raw `<input>` or `<select>`.

## Gotchas / Known Pitfalls

Non-obvious, stack-specific traps — counter-intuitive enough that you wouldn't think to check, so check here. (The `/uber-review` skill's `rules/code-standards.md` is the review-time projection of these + the Conventions above; when you add a rule here, add its review slug there.)

**Prisma 7 / PostgreSQL**
- `new PrismaClient()` needs a driver adapter (`@prisma/adapter-pg`) or it throws — the `prisma-client` generator uses the client engine.
- Set `{ timeout: 30_000 }` on `$transaction()`; the 5000ms default is blown by tick processors at 10K scale.
- A single query error aborts the whole transaction — you can't catch it and keep querying the same `tx`. Processor errors inside `$transaction` must re-throw (don't advance the tick counter on a no-op commit).
- Batch all writes inside a transaction — per-iteration `create`/`update`/`findMany` is an N+1 time bomb that passes unit tests (tiny universe) but blows the 30s timeout at 10K. Collect into arrays, then `createManyAndReturn` / `createMany` / `unnest()` UPDATE (see `events.ts`, `economy.ts`).
- Bulk SQL: multi-arg `unnest($1::t[], $2::t[]) AS batch(a, b)` (stops at the shortest array; separate `unnest()`s pad NULLs). Guard `NaN`/`Infinity` before raw SQL — PG rejects them and aborts the tx.
- `Number.MAX_SAFE_INTEGER`/`Infinity` overflow Prisma `Int` (`int4` max ~2.1B; PG throws `P2020`, SQLite silently accepted them). Use `2_000_000_000` for "never" sentinels; the tick counter is `int4`. Overflow surfaces only through the live adapter — in-memory test adapters mask it.

**Testing / Vitest**
- The `unit` project sets NO `DATABASE_URL`, and `lib/prisma.ts` throws at module-load when it's unset. Never **statically** import `@/lib/prisma` (directly or transitively) into a unit-tested module graph — the test fails to load ("no tests run"). Keep prisma-tainted deps as **dynamic** imports inside function bodies (`const { prisma } = await import("@/lib/prisma")`). A shell that exports `DATABASE_URL` masks this — verify with `unset DATABASE_URL; npx vitest run --project unit <test>`.
- The `unit` project runs both `lib/**` and `components/**` `*.test.ts`; `*.integration.test.ts` is a separate Postgres project. No jsdom — DOM-touching tests need an inline `globalThis` stub in `beforeAll`.

**Next.js 16 / React / TanStack Query**
- `useSuspenseQuery` fires during SSR render (not in an effect) — relative-URL `fetch()` crashes on the server; `QueryBoundary`'s mounted guard defers children past hydration.
- Parallel-route `@slot`s: a slot with no URL match on soft-nav goes stale — give it a `[...catchAll]/page.tsx` returning `null`, plus a `default.tsx` for hard-nav.
- Never `.sort()` a state array during render — use `[...arr].sort()` / `.toSorted()`.
- Await async callbacks passed to children; type the prop `() => Promise<void>` (TS won't warn on `() => void`).
- SSE-driven hooks must seed initial state from a REST endpoint on mount, else stale defaults until the first event.
- A parent "reset on input change" effect can clobber a child's lifted data when the child's query is **cached** (both `setState`s land in one commit, parent wins). Tag lifted state with the input it was fetched for and render on match — don't clear via a competing effect.
- Zod v4: `superRefine` uses `code: "custom"` (string) and runs only after base validation passes.
- RHF: a resolver swapped via `useMemo` does NOT auto-revalidate — `useEffect` + `trigger()`.
- react-error-boundary v5 `fallbackRender`: `error` is `unknown` — coerce `error instanceof Error ? error : new Error(String(error))`.

**Caching / API / data shapes**
- Never `Cache-Control: public` on auth-gated routes (behind `requirePlayer()`) — shared caches could cross-serve users; use `private`.
- Never `Cache-Control: immutable` on API responses (it's for hashed static assets) — causes stale data after reseeds; use `no-cache`/`max-age` and let TanStack `staleTime` handle in-memory caching.
- TOCTOU: re-read state inside `prisma.$transaction` before writing; never compute from a pre-tx snapshot; use `{ increment }` for atomic numeric updates.
- `ECONOMY_PRODUCTION`/`ECONOMY_CONSUMPTION` are `Record<EconomyType, Record<string, number>>` — use `getProducedGoods()`/`getConsumedGoods()` or the `in` operator, never `.includes()` (fails silently on a Record).

**Map / Pixi** (skip unless touching the map / WebGL surface)
- `UNIVERSE_SCALE` — and any server-only env a client module transitively imports — must be in `next.config.ts` `env`, or it's `undefined` in the client bundle and tile features break silently.
- Pixi rasterizes small text / sharp corners as aliased mush — map markers use rounded corners + zoom-gated text. Deliberate departure from Foundry's no-rounding rule, which is HTML-only; the WebGL map is its own surface.
- Throttle (leading+trailing), not debounce, for Pixi-ticker→`setState` (debounce never fires during continuous zoom).
- Frustum-gate object *creation*, not just visibility — `SystemObject` is expensive; create only in-frustum, batched per frame.
- `frustumToTiles` max col/row uses `ceil(max / TILE_SIZE) - 1` (half-open `[min, max)`, matching `systemToTile`).
- Keep tick-scoped data (visibility, dynamic) on tick-keyed queries, not viewport-keyed — viewport keys cause flicker + redundant calls on every pan.
- Native `<dialog>` modal: never set `m-0`/`inset-auto` — it breaks `showModal()` UA centering.

**Misc**
- An esbuild-bundled worker thread has its own module-level state — module caches (e.g. hop distances) are naturally per-process.

## UI Components

**Theme**: "Foundry" — industrial, sharp-edged, copper/amber accents. Full reference: `docs/active/design-system/theme.md`. Key rules: no rounded corners on cards/buttons/badges (only DetailPanel modal and FilterBar chips get rounding), copper left-accent stripe on all cards, `font-display` (Chakra Petch) for headings, `font-mono` (Geist Mono) for numeric values.

Use existing components instead of inline markup. Never duplicate markup that already has a component. Use `tv()` variants, typed props, and semantic HTML (`<dl>` for key-value, `<button>` for actions). Keep variant counts small and intentional.

- `components/ui/` — Layout and action primitives (Button, Card, Badge, PageContainer, ProgressBar, StatDisplay, DataTable, StatList, LoadingFallback, ErrorFallback). Read the file for props/variants.
- `components/form/` — Form controls (TextInput, NumberInput, RangeInput, SelectInput, FormError). Never use raw `<input>` or `<select>`.
- **QueryBoundary** (`components/ui/query-boundary.tsx`) — Wraps data-fetching sections. Uses a mounted guard to defer children past SSR hydration so `useSuspenseQuery` only fires in the browser. Composes Suspense + ErrorBoundary + QueryErrorResetBoundary.
- **Dialog** (`components/ui/dialog.tsx`) — Native `<dialog>` wrapper. Non-modal uses `.show()` + manual Escape/focus; modal uses `showModal()` + browser-native focus trap. Companion `useDialog` hook.

## Quality Checklist

After each phase or meaningful commit, verify against these common pitfalls before moving on:

- **Typed keys** — Maps use union keys from constants/types, not `Record<string, ...>`
- **Existing components** — `EmptyState`, `ErrorFallback`, form components, `Badge` — not raw markup
- **No duplication** — If logic/markup exists in two places, extract to `lib/utils/` or `components/ui/`
- **`"use client"` only where needed** — Components without hooks, state, or event handlers don't need it
- **Clean up after yourself** — No unused props, dead imports, or orphaned code left behind

## Git Workflow

- Feature branch per feature (`feat/feature-name`), PR to main when complete.
- Use worktrees for larger pieces of work, merging into a shared feature branch.
- Commit after each meaningful unit of work (new model, API route, component).
- **Break large features into 2-4 phase PRs** — each PR small enough to hold full convention context. Review against the quality checklist after each phase, not just at the end. A 12-phase plan should ship as 3-4 PRs, not one monolithic branch.
- **Merge shared→main as squash or fast-forward, never a regular merge commit** — squash when phase-commit subjects carry build-noise (`PR3`/`Phase B`/etc.), else fast-forward to keep clean atomic per-feature history.

## Shell Commands

- **Never use `cd` in compound commands** — The working directory is already the project root. Compound commands like `cd /path && git log` trigger security approval prompts. Just run the command directly (e.g. `git log`).

## Troubleshooting

When hitting errors, don't fix symptoms directly. Step back and search for the canonical
implementation pattern for the specific tool combination (e.g. "Next.js 16 + Prisma 7 + PostgreSQL
setup"). Official docs and standard patterns resolve issues faster than iterating on type errors.
