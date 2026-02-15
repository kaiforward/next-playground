# Stellar Trader

Browser-based multiplayer space trading game. Players navigate star systems, trade goods between stations, and grow their wealth in a living economy.

## Skills

- `/bootstrap` — Run environment checks (node, deps, database, env, outdated packages, build)

## Commands

- `npm run dev` — Start dev server (Turbopack)
- `npm run build` — Production build
- `npx vitest run` — Run unit tests (322 tests, engine + API)
- `npm run simulate` — Quick sanity check (all strategies, 500 ticks, seed 42). Outputs summary table, goods breakdown, route diversity, market health, event impact, idle stats.
- `npm run simulate -- --config <file>` — Run experiment from YAML config (saves result to `experiments/`). New simulator features go here only — don't expand the CLI flags.
- `npx prisma db seed` — Seed database
- `npx prisma db push` — Push schema changes to SQLite

## Tech Stack

Next.js 16 (App Router), TypeScript 5 (strict), Tailwind CSS v4 + tailwind-variants, SQLite via better-sqlite3, Prisma 7 (driver adapter required), NextAuth v5 (JWT/Credentials), TanStack Query v5 (Suspense mode), react-error-boundary, React Flow v12, Recharts, React Hook Form + Zod v4, Vitest 4.

## Project Structure

- `lib/engine/` — Pure game logic (pricing, trade, navigation, pathfinding, tick, events, danger, refuel, snapshot, shipyard, missions). Zero DB dependency.
- `lib/auth/` — NextAuth config, helpers, password hashing, ship serialization
- `lib/types/` — Shared types (`game.ts`, `api.ts`) and runtime type guards (`guards.ts`) for Prisma boundary validation
- `lib/constants/` — Goods (12), universe (6 economy types, per-good rates), economy, government (4 types), event, missions, rate-limit, fuel, snapshot, and ship type definitions
- `lib/tick/` — Tick engine, processor pipeline, registry. Processors: ship-arrivals (docking + danger + gameNotifications), events (lifecycle + spread + enriched refs), economy (simulation + modifiers), trade-missions (generation + expiry), price-snapshots (periodic price recording).
- `lib/services/` — Server-side business logic (fleet, world, universe, market, trade, navigation, events, refuel, price-history, shipyard, missions). Called by route handlers and future server components.
- `lib/api/` — API utilities: `parse-json.ts` (POST body parser), `rate-limit.ts` (sliding window), `dev-guard.ts` (dev-only route guard)
- `lib/query/` — TanStack Query setup (client factory, query key factory, typed `apiFetch`/`apiMutate` helpers)
- `lib/hooks/` — Client hooks: TanStack Query read hooks via `useSuspenseQuery` (use-fleet, use-universe, use-market, use-events, use-price-history, use-system-missions, use-player-missions), mutation hooks (use-trade-mutation, use-navigate-mutation, use-refuel-mutation, use-purchase-ship-mutation, use-mission-mutations), SSE (use-tick, use-tick-context, use-tick-invalidation), map state (use-navigation-state), dev tools (use-dev-tools), notifications (use-event-history via provider)
- `app/api/game/` — Thin HTTP wrappers: auth check → call service → NextResponse.json (fleet, world, tick-stream, ship/[shipId]/navigate, ship/[shipId]/trade, ship/[shipId]/refuel, shipyard, systems, market, history, events, prices/[systemId], missions, missions/accept, missions/deliver, missions/abandon)
- `app/(game)/` — Dashboard, map, ship/[shipId], system/[systemId] with tabbed sub-routes (overview, market, ships, shipyard, contracts) (auth-protected via layout)
- `app/(auth)/` — Login, register pages
- `components/ui/` — Primitives (Button, Card, Badge, ProgressBar, PageContainer, StatRow)
- `components/form/` — Form controls (TextInput, NumberInput, RangeInput, FormError)
- `components/providers/` — Context providers (session-provider, query-provider, event-history-provider)
- `components/fleet/`, `map/`, `trade/`, `dashboard/`, `events/`, `missions/`, `shipyard/`, `dev-tools/` — Feature components
- `prisma/` — Schema and seed script

## Docs

Reference docs (how things work now):

- `docs/SPEC.md` — Full game spec, MVP scope, and future enhancement ideas
- `docs/data-model.md` — Prisma schema, types, constants, seed details
- `docs/auth.md` — Auth architecture, registration flow, route protection
- `docs/economy-engine.md` — Engine functions, API routes, test coverage
- `docs/star-map.md` — React Flow map, custom nodes, data flow
- `docs/trading-ui.md` — Market table, trade forms, charts, dashboard components
- `docs/rate-limiting.md` — Rate-limit tiers, sliding window store, route integration
- `docs/dev-tools.md` — Dev tools UI/API, economy simulator, bot strategies, tuning workflow

Design docs (plans and backlog):

- `docs/design/event-catalog.md` — Implemented and planned event definitions (arcs, shocks, ideas)
- `docs/design/simulation-enhancements.md` — Future mechanics requiring new engine capabilities
- `docs/design/BACKLOG.md` — Prioritized backlog (sized, grouped by readiness). Delete items when shipped.
- `docs/design/archive/` — Completed designs (economy-sim, tick-engine-redesign, event-system, economy-testing, simulator-metrics, goods-and-economy-types, economy-balance)

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

- **Button** (`components/ui/button.tsx`) — All clickable actions. Variants: `primary`, `action`, `ghost`, `pill`, `dismiss`. Colors: `blue`, `green`, `red`, `indigo`, `cyan`. Supports `href` for link-as-button.
- **PageContainer** — All page wrappers. Sizes: `sm` (3xl), `md` (4xl), `lg` (7xl, default).
- **ProgressBar** — Labeled bars with ARIA. Colors: `blue`, `amber`, `red`. Sizes: `sm`, `md`.
- **Dialog** (`components/ui/dialog.tsx`) — Native `<dialog>` wrapper. Props: `open`, `onClose`, `modal` (default false), `initialFocus`. Non-modal uses `.show()` + manual Escape/focus; modal uses `showModal()` + browser-native focus trap. Companion `useDialog` hook for open/close state.
- **SelectInput** (`components/form/select-input.tsx`) — Searchable dropdown (react-select). Props: `options`, `value`, `onChange`, `isSearchable` (default true). Sizes: `sm` (default), `md`. Dark-themed, portal menu.
- **DataTable** (`components/ui/data-table.tsx`) — Generic sortable table. Props: `columns` (key, label, sortable, render), `data`, `onRowClick`, `rowClassName`.
- **StatDisplay** (`components/ui/stat-display.tsx`) — Large-value stat with optional trend arrow and icon. Props: `label`, `value`, `trend` (up/down/neutral), `icon`.
- **QueryBoundary** (`components/ui/query-boundary.tsx`) — Composes `QueryErrorResetBoundary` + `ErrorBoundary` + `Suspense`. Wrap data-fetching sections to get automatic loading spinners and error-with-retry UI. Props: `loadingFallback?`, `errorFallback?`.
- **LoadingFallback** (`components/ui/loading-fallback.tsx`) — Centered spinner + message. Props: `message?`, `className?`.
- **ErrorFallback** (`components/ui/error-fallback.tsx`) — Error message + "Try again" button. Props: `error`, `onRetry`.
- **Card** / **Badge** / **StatList+StatRow** — Layout and data display primitives.

## Git Workflow

- Feature branch per feature (`feat/feature-name`), PR to main when complete.
- Commit after each meaningful unit of work (new model, API route, component).
- Parallel agents for research/exploration only — sequential for writing code.
- Never let two agents edit the same files (types, schema, constants are shared — handle sequentially).

## Troubleshooting

When hitting errors, don't fix symptoms directly. Step back and search for the canonical
implementation pattern for the specific tool combination (e.g. "Next.js 16 + Prisma 7 + SQLite
setup"). Official docs and standard patterns resolve issues faster than iterating on type errors.
