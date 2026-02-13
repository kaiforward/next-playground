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
| `Region` | Group of ~25 systems | Has many StarSystems. Identity: resource_rich, agricultural, industrial, tech, trade_hub |
| `Player` | Game profile | 1:1 with User, has many Ships |
| `Ship` | Player's vessel | Belongs to Player, belongs to StarSystem (current + destination), has many CargoItems |
| `CargoItem` | Goods in cargo hold | Belongs to Ship + Good, unique per ship+good |
| `StarSystem` | A location in the universe | Belongs to Region, has Station, has Ships, has connections. `isGateway` marks inter-region connection points |
| `SystemConnection` | Jump lane between systems | From/To StarSystem, has fuelCost. Gateway connections have higher fuel cost |
| `Station` | Trading post in a system | 1:1 with StarSystem, has markets |
| `Good` | Tradeable commodity definition | Reference table |
| `StationMarket` | Supply/demand per good per station | Belongs to Station + Good |
| `TradeHistory` | Record of completed trades | Belongs to Station + Good |
| `PriceHistory` | Rolling price snapshots per system | 1:1 with StarSystem (unique systemId). JSON `entries` column: `{ tick, prices: Record<goodId, price> }[]`, capped at 50 entries |
| `GameEvent` | Active world event instance | Belongs to StarSystem + Region, has many EventModifiers. Tracks type, phase, severity, duration, spread source |
| `EventModifier` | Active modifier from an event | Belongs to GameEvent. domain (economy/navigation), type, target (system/region), parameter, value |

Key design decisions:
- Ships own location (`systemId`) instead of players. Players can have multiple ships (1:N).
- Ships have `status` (docked/in_transit), `destinationSystemId`, `departureTick`, and `arrivalTick` for tick-based travel.
- ~200 systems across ~8 regions (~25 systems per region), procedurally generated.
- Gateway systems (1-3 per region) are the only inter-region connection points.
- `@@index` on foreign keys used in frequent queries: `Ship.playerId`, `StarSystem.regionId`, `TradeHistory.stationId`.

## Shared Types

- `lib/types/game.ts` — Game state interfaces (FleetState, ShipState, GameWorldState, StarSystemInfo, MarketEntry, etc.). No Prisma dependency, importable anywhere.
- `lib/types/api.ts` — Request/response types for all API routes (FleetResponse, ShipNavigateResponse, ShipTradeResponse, TickEvent, etc.).

## Constants

- `lib/constants/goods.ts` — 6 goods with name, basePrice, category
- `lib/constants/universe.ts` — Economy production/consumption rules per economy type
- `lib/constants/economy.ts` — Simulation constants (reversion rate, noise, production/consumption rates, equilibrium targets)
- `lib/constants/universe-gen.ts` — Universe generation parameters (region count, systems per region, distances, fuel costs)
- `lib/constants/events.ts` — Event definitions (war, plague, trade_festival, conflict_spillover, plague_risk), spawn/cap constants, modifier caps
- `lib/constants/fuel.ts` — Base fuel price for refueling
- `lib/constants/snapshot.ts` — Snapshot interval (20 ticks) and max entries (50)

## Seed Script

`prisma/seed.ts` uses procedural generation (`lib/engine/universe-gen.ts`) to populate:
- ~8 regions with economic identities (resource_rich, agricultural, industrial, tech, trade_hub)
- ~200 star systems (~25 per region) with economy types weighted by region identity
- ~1,200 market entries (6 goods × ~200 stations) with supply/demand based on economy type
- Intra-region connections (MST + extra edges) and inter-region gateway connections
- 1-3 gateway systems per region for inter-region travel
- 200 PriceHistory rows (one per system, initially empty JSON arrays)
- 6 goods, 1 GameWorld singleton (tick 0, 5000ms tick rate)

Generation is deterministic given a seed value (`UNIVERSE_GEN.SEED`). Run with: `npx prisma db seed`

## App Shell

- `app/(game)/layout.tsx` — Auth-protected game layout with GameShell (tick provider + nav)
- `app/(auth)/login/page.tsx`, `register/page.tsx` — Auth pages
- `app/(game)/dashboard/page.tsx` — Command Center (fleet overview)
- `app/(game)/map/page.tsx` — Fleet-aware star map
- `app/(game)/trade/page.tsx` — Ship-contextual trading (requires shipId + systemId query params)
- `app/(game)/ship/[shipId]/page.tsx` — Ship detail view
- `app/(game)/system/[systemId]/page.tsx` — System info + docked ships + market summary
