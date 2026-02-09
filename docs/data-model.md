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
| `GameWorld` | Tick state singleton | Tracks currentTick, tickRate, lastTickAt |
| `Player` | Game profile | 1:1 with User, has many Ships |
| `Ship` | Player's vessel | Belongs to Player, belongs to StarSystem (current + destination), has many CargoItems |
| `CargoItem` | Goods in cargo hold | Belongs to Ship + Good, unique per ship+good |
| `StarSystem` | A location in the universe | Has Station, has Ships (docked + incoming), has connections |
| `SystemConnection` | Jump lane between systems | From/To StarSystem, has fuelCost |
| `Station` | Trading post in a system | 1:1 with StarSystem, has markets |
| `Good` | Tradeable commodity definition | Reference table |
| `StationMarket` | Supply/demand per good per station | Belongs to Station + Good |
| `TradeHistory` | Record of completed trades | Belongs to Station + Good |

Key changes from MVP: Ships now own location (`systemId`) instead of players. Players can have multiple ships (1:N). Ships have `status` (docked/in_transit), `destinationSystemId`, `departureTick`, and `arrivalTick` for tick-based travel.

## Shared Types

- `lib/types/game.ts` — Game state interfaces (FleetState, ShipState, GameWorldState, StarSystemInfo, MarketEntry, etc.). No Prisma dependency, importable anywhere.
- `lib/types/api.ts` — Request/response types for all API routes (FleetResponse, ShipNavigateResponse, ShipTradeResponse, TickEvent, etc.).

## Constants

- `lib/constants/goods.ts` — 6 goods with name, basePrice, category
- `lib/constants/universe.ts` — 8 star systems, 12 connections, economy production/consumption rules

## Seed Script

`prisma/seed.ts` populates:
- 6 goods
- 8 star systems with stations
- 48 market entries (6 goods x 8 stations) with supply/demand based on economy type
- 24 connections (12 bidirectional pairs)
- 1 GameWorld singleton (tick 0, 5000ms tick rate)

Run with: `npx prisma db seed`

## App Shell

- `app/(game)/layout.tsx` — Auth-protected game layout with GameShell (tick provider + nav)
- `app/(auth)/login/page.tsx`, `register/page.tsx` — Auth pages
- `app/(game)/dashboard/page.tsx` — Command Center (fleet overview)
- `app/(game)/map/page.tsx` — Fleet-aware star map
- `app/(game)/trade/page.tsx` — Ship-contextual trading (requires shipId + systemId query params)
- `app/(game)/ship/[shipId]/page.tsx` — Ship detail view
- `app/(game)/system/[systemId]/page.tsx` — System info + docked ships + market summary
