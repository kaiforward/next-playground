# Stellar Trader

Browser-based multiplayer space trading game.

## Skills

- `/bootstrap` — Run environment checks (node, deps, database, env, outdated packages, build)

## Commands

- `npm run dev` — Start dev server (Turbopack)
- `npm run build` — Production build
- `npx vitest run` — Run unit tests
- `npm run simulate` — Quick sanity check (all strategies, 500 ticks, seed 42)
- `npm run simulate -- --config <file>` — Run experiment from YAML config (saves to `experiments/`)
- `npx prisma db seed` — Seed database
- `npx prisma db push` — Push schema changes to SQLite

## Tech Stack

Next.js 16 (App Router), TypeScript 5 (strict), Tailwind CSS v4 + tailwind-variants, SQLite via better-sqlite3, Prisma 7 (driver adapter), NextAuth v5 (JWT/Credentials), TanStack Query v5 (Suspense mode), react-error-boundary, React Flow v12, Recharts, React Hook Form + Zod v4, Vitest 4.

## Project Structure

- `lib/engine/` — Pure game logic. Zero DB dependency. Test with Vitest.
- `lib/services/` — Server-side business logic. All DB access lives here. Route handlers are thin wrappers.
- `lib/tick/` — Tick engine and processor pipeline (ship-arrivals, events, economy, trade-missions, price-snapshots).
- `lib/constants/` — Game data definitions (goods, economy types, government types, events, ships, etc.).
- `lib/types/` — Shared types (`game.ts`, `api.ts`) and runtime type guards (`guards.ts`).
- `lib/auth/` — NextAuth config, helpers, password hashing.
- `lib/query/` — TanStack Query client factory, query key factory, `apiFetch`/`apiMutate` helpers.
- `lib/hooks/` — Read hooks (`useSuspenseQuery`), mutation hooks, SSE (tick stream + invalidation), map state, dev tools.
- `lib/api/` — API utilities (body parser, rate limiter, dev-only guard).
- `app/api/game/` — Thin HTTP wrappers: auth check → call service → NextResponse.json.
- `app/(game)/` — Dashboard, map, ship/[shipId], system/[systemId] with tabbed sub-routes (auth-protected via layout).
- `app/(auth)/` — Login, register pages.
- `prisma/` — Schema and seed script.

## Docs

Reference: `docs/SPEC.md`, `docs/data-model.md`, `docs/auth.md`, `docs/economy-engine.md`, `docs/star-map.md`, `docs/trading-ui.md`, `docs/rate-limiting.md`, `docs/dev-tools.md`

Design: `docs/design/BACKLOG.md` (delete items when shipped), `docs/design/event-catalog.md`, `docs/design/simulation-enhancements.md`, `docs/design/archive/` (completed designs)

## Design Principles

- **Separation of concerns** — Components render UI; they don't fetch data or hold business logic. Prefer additional boilerplate (hooks, schemas, services) over mixing concerns in components.
- **Reusability first** — Extract shared UI into `components/ui/` or `components/form/`. Never duplicate markup that already has a component. Keep variant counts small and intentional.
- **Scalability** — Design for the next 10 uses, not just the current one. Use `tv()` variants, typed props, and semantic HTML (`<dl>` for key-value, `<button>` for actions).
- **Security** — Validate at system boundaries (API routes, form schemas). Use Prisma transactions with optimistic locking for mutations. Never trust client state for writes.

## Conventions

- Engine functions are pure — no DB imports. Test with Vitest.
- Prisma singleton in `lib/prisma.ts` — always use this, never create new clients.
- Prisma Client imported from `@/app/generated/prisma/client`.
- Tailwind v4 theme is in `globals.css` (`@theme inline {}`), no tailwind.config.js.
- API responses use `ApiResponse<T>` format: `{ data?: T, error?: string }`.
- Services layer (`lib/services/`) holds all DB/business logic. Route handlers are thin wrappers. Read services throw `ServiceError`; mutation services return discriminated unions.
- Client data fetching uses TanStack Query hooks (`lib/hooks/`) with `useSuspenseQuery`. Pages/components wrap data-fetching sections in `QueryBoundary` instead of inline loading/error checks. Query keys are centralized in `lib/query/keys.ts`. Ship arrival invalidation is centralized in `useTickInvalidation` — pages do not subscribe to arrivals individually.
- Forms use React Hook Form + Zod schemas (`lib/schemas/`). Use `TextInput`/`NumberInput`/`SelectInput` from `components/form/`, never raw `<input>` or `<select>`.

## UI Components

Use existing components instead of inline markup. When a pattern appears twice, extract it.

- `components/ui/` — Layout and action primitives (Button, Card, Badge, PageContainer, ProgressBar, StatDisplay, DataTable, StatList, LoadingFallback, ErrorFallback). Read the file for props/variants.
- `components/form/` — Form controls (TextInput, NumberInput, RangeInput, SelectInput, FormError). Never use raw `<input>` or `<select>`.
- **QueryBoundary** (`components/ui/query-boundary.tsx`) — Wraps data-fetching sections. Uses a mounted guard to defer children past SSR hydration so `useSuspenseQuery` only fires in the browser. Composes Suspense + ErrorBoundary + QueryErrorResetBoundary.
- **Dialog** (`components/ui/dialog.tsx`) — Native `<dialog>` wrapper. Non-modal uses `.show()` + manual Escape/focus; modal uses `showModal()` + browser-native focus trap. Companion `useDialog` hook.

## Git Workflow

- Feature branch per feature (`feat/feature-name`), PR to main when complete.
- Commit after each meaningful unit of work (new model, API route, component).

## Troubleshooting

When hitting errors, don't fix symptoms directly. Step back and search for the canonical
implementation pattern for the specific tool combination (e.g. "Next.js 16 + Prisma 7 + SQLite
setup"). Official docs and standard patterns resolve issues faster than iterating on type errors.
