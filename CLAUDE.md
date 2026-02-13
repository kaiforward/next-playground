# Stellar Trader

Browser-based multiplayer space trading game. Players navigate star systems, trade goods between stations, and grow their wealth in a living economy.

## Skills

- `/bootstrap` — Run environment checks (node, deps, database, env, outdated packages, build)

## Commands

- `npm run dev` — Start dev server (Turbopack)
- `npm run build` — Production build
- `npx vitest run` — Run unit tests (212 tests, engine + API)
- `npx prisma db seed` — Seed database
- `npx prisma db push` — Push schema changes to SQLite

## Tech Stack

Next.js 16 (App Router), TypeScript 5 (strict), Tailwind CSS v4 + tailwind-variants, SQLite via better-sqlite3, Prisma 7 (driver adapter required), NextAuth v5 (JWT/Credentials), TanStack Query v5, React Flow v12, Recharts, React Hook Form + Zod v4, Vitest 4.

## Project Structure

- `lib/engine/` — Pure game logic (pricing, trade, navigation, pathfinding, tick, events, danger, refuel, snapshot). Zero DB dependency.
- `lib/auth/` — NextAuth config, helpers, password hashing, ship serialization
- `lib/types/` — Shared types (`game.ts`, `api.ts`)
- `lib/constants/` — Goods, universe, economy, event, rate-limit, fuel, and snapshot definitions
- `lib/tick/` — Tick engine, processor pipeline, registry. Processors: ship-arrivals (docking + danger + gameNotifications), events (lifecycle + spread + enriched refs), economy (simulation + modifiers), price-snapshots (periodic price recording).
- `lib/services/` — Server-side business logic (fleet, world, universe, market, trade, navigation, events, refuel, price-history). Called by route handlers and future server components.
- `lib/query/` — TanStack Query setup (client factory, query key factory, typed apiFetch helper)
- `lib/hooks/` — Client hooks: TanStack Query read hooks (use-fleet, use-game-world, use-universe, use-market, use-trade-history, use-events, use-price-history), mutation hooks (use-trade-mutation, use-navigate-mutation, use-refuel-mutation), SSE (use-tick, use-tick-context, use-tick-invalidation), map state (use-navigation-state), notifications (use-event-history via provider)
- `app/api/game/` — Thin HTTP wrappers: auth check → call service → NextResponse.json (fleet, world, tick, ship/[shipId]/navigate, ship/[shipId]/trade, ship/[shipId]/refuel, systems, market, history, events, prices/[systemId])
- `app/(game)/` — Dashboard, map, trade, ship/[shipId], system/[systemId] (auth-protected via layout)
- `app/(auth)/` — Login, register pages
- `components/ui/` — Primitives (Button, Card, Badge, ProgressBar, PageContainer, StatRow)
- `components/form/` — Form controls (TextInput, NumberInput, RangeInput, FormError)
- `components/providers/` — Context providers (session-provider, query-provider, event-history-provider)
- `components/fleet/`, `map/`, `trade/`, `dashboard/`, `events/` — Feature components
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

Design docs (plans and backlog):

- `docs/design/event-catalog.md` — Implemented and planned event definitions (arcs, shocks, ideas)
- `docs/design/simulation-enhancements.md` — Future mechanics requiring new engine capabilities
- `docs/design/BACKLOG.md` — Prioritized backlog (sized, grouped by readiness). Delete items when shipped.
- `docs/design/archive/` — Completed designs (economy-sim, tick-engine-redesign, event-system)

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
- Client data fetching uses TanStack Query hooks (`lib/hooks/`). Query keys are centralized in `lib/query/keys.ts`. Ship arrival invalidation is centralized in `useTickInvalidation` — pages do not subscribe to arrivals individually.
- Forms use React Hook Form + Zod schemas (`lib/schemas/`). Use `TextInput`/`NumberInput` from `components/form/`, never raw `<input>`.

## UI Components

Use existing components instead of inline markup. When a pattern appears twice, extract it.

- **Button** (`components/ui/button.tsx`) — All clickable actions. Variants: `primary`, `action`, `ghost`, `pill`, `dismiss`. Colors: `blue`, `green`, `red`, `indigo`, `cyan`. Supports `href` for link-as-button.
- **PageContainer** — All page wrappers. Sizes: `sm` (3xl), `md` (4xl), `lg` (7xl, default).
- **ProgressBar** — Labeled bars with ARIA. Colors: `blue`, `amber`, `red`. Sizes: `sm`, `md`.
- **Dialog** (`components/ui/dialog.tsx`) — Native `<dialog>` wrapper. Props: `open`, `onClose`, `modal` (default false), `initialFocus`. Non-modal uses `.show()` + manual Escape/focus; modal uses `showModal()` + browser-native focus trap. Companion `useDialog` hook for open/close state.
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
