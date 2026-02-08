# Stellar Trader

Browser-based multiplayer space trading game. Players navigate star systems, trade goods between stations, and grow their wealth in a living economy.

## Commands

- `npm run dev` — Start dev server (Turbopack)
- `npm run build` — Production build
- `npx vitest run` — Run unit tests (20 tests, engine only)
- `npx prisma db seed` — Seed database
- `npx prisma db push` — Push schema changes to SQLite

## Tech Stack

Next.js 16 (App Router), TypeScript 5 (strict), Tailwind CSS v4 + tailwind-variants, SQLite via better-sqlite3, Prisma 7 (driver adapter required), NextAuth v5 (JWT/Credentials), React Flow v12, Recharts, React Hook Form + Zod v4, Vitest 4.

## Project Structure

- `lib/engine/` — Pure game logic (pricing, trade, navigation, economy tick, NPC). Zero DB dependency.
- `lib/auth/` — NextAuth config, helpers, password hashing
- `lib/types/` — Shared types (`game.ts`, `api.ts`)
- `lib/constants/` — Goods and universe definitions
- `app/api/game/` — 7 API routes (systems, market, trade, navigate, player, history)
- `app/(game)/` — Dashboard, map, trade pages (auth-protected via layout)
- `app/(auth)/` — Login, register pages
- `components/` — UI components (map/, trade/, dashboard/, ui/)
- `prisma/` — Schema and seed script

## Docs

Read these when working on related features:

- `docs/SPEC.md` — Full game spec, MVP scope, and future enhancement ideas
- `docs/data-model.md` — Prisma schema, types, constants, seed details
- `docs/auth.md` — Auth architecture, registration flow, route protection
- `docs/economy-engine.md` — Engine functions, API routes, test coverage
- `docs/star-map.md` — React Flow map, custom nodes, data flow
- `docs/trading-ui.md` — Market table, trade forms, charts, dashboard components

## Conventions

- Engine functions are pure — no DB imports. Test with Vitest.
- Prisma singleton in `lib/prisma.ts` — always use this, never create new clients.
- Prisma Client imported from `@/app/generated/prisma/client`.
- Tailwind v4 theme is in `globals.css` (`@theme inline {}`), no tailwind.config.js.
- API responses use `ApiResponse<T>` format: `{ data?: T, error?: string }`.
- Forms use React Hook Form + Zod directly per component, no shared form abstractions.
