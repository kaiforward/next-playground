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
- `npm run index` — Regenerate `docs/MODULE_INDEX.md` (shared module export inventory)
- `npx prisma db seed` — Seed database (scale controlled by `UNIVERSE_SCALE` in `.env`: `"default"` = 600 systems/7K map, `"10k"` = 10,000 systems/25K map)
- `npx prisma db push` — Push schema changes to SQLite

## Tech Stack

Next.js 16 (App Router), TypeScript 5 (strict), Tailwind CSS v4 + tailwind-variants, SQLite via better-sqlite3, Prisma 7 (driver adapter), NextAuth v5 (JWT/Credentials), TanStack Query v5 (Suspense mode), react-error-boundary, React Flow v12, Recharts, React Hook Form + Zod v4, Vitest 4.

**Prisma 7 gotcha**: Seed command lives in `prisma.config.ts` under `migrations.seed`, not in `package.json`. Command: `npx tsx --tsconfig tsconfig.json prisma/seed.ts`.

## Project Structure

Core layers (fixed roles — see CLAUDE.md conventions for rules):
- `lib/engine/` — Pure game logic. Zero DB dependency. Test with Vitest.
- `lib/services/` — All DB access and business logic. Route handlers are thin wrappers.
- `lib/tick/` — Tick engine and processor pipeline.
- `app/api/game/` — Thin HTTP wrappers: auth check → call service → NextResponse.json.
- `app/(game)/` — Game UI pages. `app/(auth)/` — Auth pages.
- `prisma/` — Schema and seed script.

Shared modules (utils, hooks, constants, components) are inventoried in `docs/MODULE_INDEX.md` — run `npm run index` to regenerate.

## Docs

Functional spec: `docs/SPEC.md` — master game spec with system interaction map. Read this first.
Module index: `docs/MODULE_INDEX.md` — auto-generated inventory of all shared exports (utils, hooks, components, constants). Regenerate with `npm run index`.

Design docs:
- `docs/design/active/` — Implemented systems (economy, events, trading, navigation, universe, tick-engine, event-catalog)
- `docs/design/planned/` — Designed but not yet built (faction-system, player-progression, system-enrichment, multiplayer-infrastructure, simulation-enhancements)
- `docs/design/archive/` — Historical design docs (may be outdated)
- `docs/design/BACKLOG.md` — Actionable work items (delete when shipped)

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
- Client data fetching uses TanStack Query hooks (`lib/hooks/`) with `useSuspenseQuery`. Pages/components wrap data-fetching sections in `QueryBoundary` instead of inline loading/error checks. Query keys are centralized in `lib/query/keys.ts`. Ship arrival invalidation is centralized in `useTickInvalidation` — pages do not subscribe to arrivals individually.
- Forms use React Hook Form + Zod schemas (`lib/schemas/`). Use `TextInput`/`NumberInput`/`SelectInput` from `components/form/`, never raw `<input>` or `<select>`.

## UI Components

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

## Shell Commands

- **Never use `cd` in compound commands** — The working directory is already the project root. Compound commands like `cd /path && git log` trigger security approval prompts. Just run the command directly (e.g. `git log`).

## Codebase Search

Prefer **cocoindex semantic search** (`mcp__cocoindex-code__search`) over grep/glob for codebase exploration, especially for vague or cross-system questions. Use `refresh_index: false` for consecutive queries within the same session. Fall back to grep/glob only for exact-string or regex matches where you know the precise term.

## Troubleshooting

When hitting errors, don't fix symptoms directly. Step back and search for the canonical
implementation pattern for the specific tool combination (e.g. "Next.js 16 + Prisma 7 + SQLite
setup"). Official docs and standard patterns resolve issues faster than iterating on type errors.
