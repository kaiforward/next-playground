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

### Events (`lib/engine/events.ts`)

Pure functions for event lifecycle management. All randomness injected via `rng` parameter.

```
checkPhaseTransition(event, tick, definition) → "none" | "advance" | "expire"
buildModifiersForPhase(phase, systemId, regionId, severity) → ModifierRow[]
aggregateModifiers(modifiers, goodId, caps) → AggregatedModifiers
selectEventToSpawn(definitions, activeEvents, systems, tick, caps, rng) → SpawnDecision | null
rollPhaseDuration(range, rng) → number
buildShocksForPhase(phase, severity) → ShockRow[]
evaluateSpreadTargets(rules, sourceEvent, neighbors, activeEvents, caps, definitions, rng) → SpawnDecision[]
```

- Phase transitions: checks elapsed ticks vs phase duration, returns advance/expire/none
- Modifier building: resolves system/region targets, scales values by severity (linear for shifts, lerp-to-1.0 for multipliers)
- Modifier aggregation: sums shifts, multiplies rate multipliers, takes min for dampening, applies safety caps
- Spawn selection: weighted random among eligible (definition, system) pairs, respects global/per-type/per-system caps and cooldowns
- Shocks: one-time supply/demand deltas, severity-scaled
- Spread: evaluates spread rules at phase transitions, filters neighbours by region/economy type, rolls probability per neighbour

Types exported: `EventSnapshot`, `SystemSnapshot`, `ModifierRow`, `AggregatedModifiers`, `SpawnDecision`, `ShockRow`, `NeighborSnapshot`.

### Danger (`lib/engine/danger.ts`)

Pure functions for navigation danger and cargo loss.

```
aggregateDangerLevel(modifiers, maxDanger?) → number
rollCargoLoss(danger, cargo, rng) → CargoLossEntry[]
```

- `aggregateDangerLevel`: filters modifiers to `parameter === "danger_level"`, sums values, caps at 0.5 (configurable)
- `rollCargoLoss`: rolls `rng()` against danger level; on hit, each cargo item loses 20-40% (Math.ceil). Returns entries with `goodId`, `lost`, `remaining`
- Constants: `DANGER_CONSTANTS` (MAX_DANGER: 0.5, MIN_LOSS_FRACTION: 0.2, MAX_LOSS_FRACTION: 0.4)

### Economy Tick (`lib/engine/tick.ts`)

```
simulateEconomyTick(markets, params, rng?) → updatedMarkets
processShipArrivals(ships, currentTick) → arrivedShipIds
```

- **Mean-reverting drift:** supply/demand pull toward equilibrium targets (producers: high supply/low demand, consumers: inverse, neutral: balanced)
- Reversion rate: 5% of gap per tick + random noise (±3 units)
- Production effect: producers gain supply (+3/tick), slightly reduce demand
- Consumption effect: consumers deplete supply (-2/tick), generate demand
- All values clamped to `[5, 200]`
- Accepts optional RNG function for deterministic testing
- Constants in `lib/constants/economy.ts` (reversion rate, noise, production/consumption rates, equilibrium targets)
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
| `/api/game/events` | GET | Active events with system/region info |

### Auth on API Routes

Ship mutation routes (`navigate`, `trade`) use `getSessionPlayerId()` for lightweight auth, delegating to the services layer for DB queries. Read routes (`fleet`, `market`, `systems`) use `getSessionPlayer()` or `getSessionPlayerId()` depending on whether they need the full player object.

### Tick System (Processor Pipeline)

The game clock is driven by a **server-side tick engine** (`lib/tick/engine.ts`), a singleton that polls on a 1s interval. It starts automatically via the Next.js instrumentation hook (`instrumentation.ts`) on server boot.

Each tick:
1. Checks if `tickRate` ms have elapsed since last tick
2. Uses optimistic locking (`updateMany` with `currentTick` WHERE clause) to prevent double-processing
3. Determines which processors run this tick (based on `frequency` and `offset`)
4. Topologically sorts active processors by `dependsOn`
5. Runs processors sequentially in a shared Prisma transaction with error isolation
6. Merges processor results into a single `TickEventRaw`
7. Emits event via EventEmitter to connected SSE clients
8. Logs per-processor timing; warns on overrun (>80% of tick rate)

**Processors** (`lib/tick/processors/`):
- `ship-arrivals` — Every tick. Transitions arrived ships from in_transit → docked. Queries navigation modifiers at destination, rolls for cargo loss via `aggregateDangerLevel`/`rollCargoLoss`, updates cargo in DB. Emits per-player `shipArrived` and `cargoLost` events.
- `events` — Every tick. Manages event lifecycle: spawns new events (weighted random), advances phases, swaps modifiers, executes spread rules, applies shocks, expires completed events. Emits global `eventNotifications`.
- `economy` — Every tick, round-robin by region. Processes one region's markets per tick (~150 entries). Reads active `EventModifier` rows (domain: "economy") and applies equilibrium shifts, rate multipliers, and reversion dampening. Emits global `economyTick` events.

**Registry** (`lib/tick/registry.ts`): All processors are registered in a single array. `sortProcessors()` filters by frequency/offset and topologically sorts by `dependsOn`. Adding a new game system = one processor file + one registry line.

Clients connect to `GET /api/game/tick-stream` (Server-Sent Events) with per-player event filtering. The `useTick` hook wraps an `EventSource` connection with `subscribeToEvent(name, cb)` API. `useTickInvalidation` centralizes query invalidation: `shipArrived` → fleet+market, `economyTick` → market, `eventNotifications` → events, `cargoLost` → fleet.

See `docs/design/archive/tick-engine-redesign.md` for the original architecture design.

## Tests

185 unit tests across 9 files in `lib/engine/__tests__/`:

- `pricing.test.ts` — 7 tests (equal s/d, high demand, high supply, clamping, zero supply)
- `trade.test.ts` — 11 tests (buy/sell success, credit/cargo/supply validation, edge cases, fleet trade docked guard)
- `navigation.test.ts` — 5 tests (valid connection, exact fuel, no connection, insufficient fuel)
- `fleet-navigation.test.ts` — 13 tests (docked requirement, travel duration calc, departure/arrival ticks, delegation, multi-hop route validation)
- `pathfinding.test.ts` — 17 tests (shortest path, multi-hop optimal, reachability with fuel constraints, route validation)
- `tick.test.ts` — 30 tests (ship arrival processing, economy tick simulation, regional round-robin, edge cases)
- `universe-gen.test.ts` — 27 tests (region/system generation, connections, gateways, economy type distribution)
- `events.test.ts` — 56 tests (phase transitions, modifier building/aggregation, spawn selection, shocks, spread evaluation)
- `danger.test.ts` — 19 tests (danger level aggregation, cargo loss rolling, edge cases, caps)

Run with: `npx vitest run`
