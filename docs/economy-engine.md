# Stream 3: Economy Engine + Game API

## Engine (Pure Functions)

All engine functions live in `lib/engine/` and have zero database dependency. They accept plain data and return plain results, making them fully testable with Vitest.

### Pricing (`lib/engine/pricing.ts`)

```
calculatePrice(basePrice, supply, demand) → number
```

- Formula: `basePrice * (demand / supply)`
- Clamped to `[0.2x, 5.0x]` of basePrice
- Returns max price (5x) when supply is 0

### Trade (`lib/engine/trade.ts`)

```
validateAndCalculateTrade(params) → { ok: true, delta } | { ok: false, error }
```

- Validates credits, cargo space, supply (buy) or cargo quantity (sell)
- Returns a `TradeDelta` with changes to credits, cargo, supply, and demand
- Demand adjusts by 10% of traded quantity

### Navigation (`lib/engine/navigation.ts`)

```
validateNavigation(params) → { ok: true, fuelCost } | { ok: false, error }
validateFleetNavigation(params) → { ok, fuelCost, travelDuration, departureTick, arrivalTick } | { ok: false, error }
validateFleetRouteNavigation(params) → { ok, totalFuelCost, totalTravelDuration, departureTick, arrivalTick, destinationSystemId } | { ok: false, error }
```

- Checks a direct connection exists between systems
- Validates sufficient fuel
- `validateFleetNavigation` adds: ship must be docked, calculates `travelDuration = ceil(fuelCost / 2)` (min 1)
- `validateFleetRouteNavigation` validates a multi-hop route array, sums fuel/duration across all hops

### Pathfinding (`lib/engine/pathfinding.ts`)

```
findShortestPath(originId, destinationId, connections) → PathResult | null
findReachableSystems(originId, currentFuel, connections) → Map<string, ReachableSystem>
validateRoute(route, connections, currentFuel) → RouteValidationResult
```

- Dijkstra-based lowest-fuel pathfinding between any two systems
- Fuel-constrained reachability: all systems reachable within fuel budget
- Linear route validation: walks each hop, checks connections exist and fuel suffices
- Travel duration per hop: `ceil(fuelCost / 2)` (min 1)

### Economy Tick (`lib/engine/tick.ts`)

```
simulateEconomyTick(markets) → updatedMarkets
processShipArrivals(ships, currentTick) → arrivedShipIds
```

- Producers gain supply, lose demand
- Consumers lose supply, gain demand
- Small random drift applied
- All values clamped to `[5, 200]`
- `processShipArrivals` returns ship IDs where `arrivalTick <= currentTick`

### NPC Traders (`lib/engine/npc.ts`)

- `pickNpcDestination` — random connected system
- `simulateNpcTrade` — buys cheap goods (< basePrice), sells expensive goods (> 1.5x basePrice)

## API Routes

All routes return `ApiResponse<T>` format: `{ data?: T, error?: string }`.

| Route | Method | Description |
|---|---|---|
| `/api/game/fleet` | GET | Player's fleet state (credits + all ships) |
| `/api/game/world` | GET | Game world state (currentTick, tickRate) |
| `/api/game/tick-stream` | GET | SSE stream — pushes `TickEvent` on each tick |
| `/api/game/ship/[shipId]/navigate` | POST | Order ship to navigate (sets in_transit) |
| `/api/game/ship/[shipId]/trade` | POST | Execute trade for a docked ship |
| `/api/game/systems` | GET | All systems + connections |
| `/api/game/systems/[systemId]` | GET | Single system with station |
| `/api/game/market/[systemId]` | GET | Market entries with computed prices |
| `/api/game/history/[systemId]` | GET | Last 50 trade history entries |

### Auth on API Routes

Ship mutation routes (`navigate`, `trade`) and the `fleet` route use `getSessionPlayer()` to authenticate. Ship ownership is verified by checking the ship belongs to the player.

### Tick System (Server-Driven)

The game clock is driven by a **server-side tick engine** (`lib/tick-engine.ts`), a singleton that runs on a `setInterval`. It starts automatically via the Next.js instrumentation hook (`instrumentation.ts`) on server boot.

Each tick:
1. Checks if `tickRate` ms have elapsed since last tick
2. Uses optimistic locking (`updateMany` with `currentTick` WHERE clause) to prevent double-processing
3. Processes ship arrivals (in_transit → docked)
4. Runs economy simulation on all markets
5. Increments `currentTick`
6. Emits a `TickEvent` via EventEmitter to connected SSE clients

Clients connect to `GET /api/game/tick-stream` (Server-Sent Events). The `useTick` hook wraps an `EventSource` connection, and `TickProvider` shares a single connection across all game pages via React context.

## Tests

58 unit tests across 6 files in `lib/engine/__tests__/`:

- `pricing.test.ts` — 7 tests (equal s/d, high demand, high supply, clamping, zero supply)
- `trade.test.ts` — 11 tests (buy/sell success, credit/cargo/supply validation, edge cases, fleet trade docked guard)
- `navigation.test.ts` — 5 tests (valid connection, exact fuel, no connection, insufficient fuel)
- `fleet-navigation.test.ts` — 13 tests (docked requirement, travel duration calc, departure/arrival ticks, delegation, multi-hop route validation)
- `pathfinding.test.ts` — 17 tests (shortest path, multi-hop optimal, reachability with fuel constraints, route validation)
- `tick.test.ts` — 5 tests (ship arrival processing, edge cases)

Run with: `npx vitest run`
