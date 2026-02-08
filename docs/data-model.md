# Stream 1: Data Foundation

## Prisma Schema

All models are defined in `prisma/schema.prisma`. The database uses SQLite with the `better-sqlite3` driver adapter (required by Prisma 7).

### Auth Models (NextAuth)

| Model | Purpose |
|---|---|
| `User` | Core user account with `passwordHash` field |
| `Account` | OAuth provider accounts (for future use) |
| `Session` | Database sessions (unused — JWT strategy) |
| `VerificationToken` | Email verification tokens (for future use) |

### Game Models

| Model | Purpose | Key Relations |
|---|---|---|
| `Player` | Game profile | 1:1 with User, belongs to StarSystem |
| `Ship` | Player's vessel | 1:1 with Player, has many CargoItems |
| `CargoItem` | Goods in cargo hold | Belongs to Ship + Good, unique per ship+good |
| `StarSystem` | A location in the universe | Has Station, has connections |
| `SystemConnection` | Jump lane between systems | From/To StarSystem, has fuelCost |
| `Station` | Trading post in a system | 1:1 with StarSystem, has markets |
| `Good` | Tradeable commodity definition | Reference table |
| `StationMarket` | Supply/demand per good per station | Belongs to Station + Good |
| `TradeHistory` | Record of completed trades | Belongs to Station + Good |

## Shared Types

- `lib/types/game.ts` — Game state interfaces (PlayerState, ShipState, StarSystemInfo, MarketEntry, etc.). No Prisma dependency, importable anywhere.
- `lib/types/api.ts` — Request/response types for all API routes.

## Constants

- `lib/constants/goods.ts` — 6 goods with name, basePrice, category
- `lib/constants/universe.ts` — 8 star systems, 12 connections, economy production/consumption rules

## Seed Script

`prisma/seed.ts` populates:
- 6 goods
- 8 star systems with stations
- 48 market entries (6 goods x 8 stations) with supply/demand based on economy type
- 24 connections (12 bidirectional pairs)

Run with: `npx prisma db seed`

## App Shell

- `app/(game)/layout.tsx` — Auth-protected game layout with nav bar
- `app/(auth)/login/page.tsx`, `register/page.tsx` — Auth pages
- `app/(game)/dashboard/page.tsx`, `map/page.tsx`, `trade/page.tsx` — Game pages
