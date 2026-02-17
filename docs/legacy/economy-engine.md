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

### Refuel (`lib/engine/refuel.ts`)

```
calculateRefuelCost(amount, baseFuelPrice) → number
calculateMaxRefuel(currentFuel, maxFuel, credits, baseFuelPrice) → { amount, cost }
```

- `calculateRefuelCost`: `amount * baseFuelPrice`, rounded to 2 decimal places
- `calculateMaxRefuel`: computes maximum refuel amount given tank capacity and available credits
- Constants in `lib/constants/fuel.ts` (BASE_FUEL_PRICE)

### Price Snapshots (`lib/engine/snapshot.ts`)

```
buildPriceEntry(markets, tick) → Map<systemId, PriceHistoryEntry>
appendSnapshot(existing, entry, max) → PriceHistoryEntry[]
```

- `buildPriceEntry`: groups flat market array by systemId, calls `calculatePrice()` per good, returns one `{ tick, prices: Record<goodId, price> }` per system
- `appendSnapshot`: immutably appends entry and caps at `max` via `.slice(-max)`
- Constants in `lib/constants/snapshot.ts` (SNAPSHOT_INTERVAL: 20, MAX_SNAPSHOTS: 50)

### Shipyard (`lib/engine/shipyard.ts`)

```
validateShipPurchase({ shipType, playerCredits }) → { ok: true; data: { shipTypeDef, totalCost } } | { ok: false; error }
```

- Validates ship type exists in `SHIP_TYPES`, is purchasable (price > 0), and player can afford it
- Returns the full `ShipTypeDefinition` and total cost on success
- Ship types defined in `lib/constants/ships.ts`: shuttle (100 fuel, 50 cargo, starter-only) and freighter (80 fuel, 120 cargo, 5,000 CR)

### Missions (`lib/engine/missions.ts`)

Pure functions for trade mission generation, reward calculation, and validation.

```
calculateReward(quantity, hops, goodTier, isEventLinked) → number
selectEconomyCandidates(markets, hopDistances, goodTiers, tick, rng) → MissionCandidate[]
selectEventCandidates(events, missionGoods, hopDistances, goodTiers, tick, rng) → MissionCandidate[]
validateAccept(missionPlayerId, dockedSystemIds, missionSystemId, activeCount) → ok | error
validateDelivery(missionPlayerId, playerId, shipSystemId, destId, cargoQty, quantity, deadline, tick) → ok | error
```

- `calculateReward`: `REWARD_PER_UNIT * quantity * 1.25^hops * tierMult * eventMult`, floor at REWARD_MIN (50)
- `selectEconomyCandidates`: high-price (>2x base) → import missions, low-price (<0.5x base) → export missions with random destination 1-3 hops away, probability-gated
- `selectEventCandidates`: maps event types to themed goods via `EVENT_MISSION_GOODS`, generates 1-3 missions per event with eventId for cascade expiry
- `validateAccept`: checks mission unclaimed, player has docked ship at board station, under active cap (10)
- `validateDelivery`: checks ownership, ship at destination, sufficient cargo, not expired

### Pathfinding — All-pairs hop distances (`lib/engine/pathfinding.ts`)

```
computeAllHopDistances(connections) → Map<origin, Map<dest, hops>>
```

- BFS from each system, bidirectional adjacency. Used by mission generation and reward calculation.

### Economy Tick (`lib/engine/tick.ts`)

```
simulateEconomyTick(markets, params, rng?) → updatedMarkets
processShipArrivals(ships, currentTick) → arrivedShipIds
```

- **Mean-reverting drift:** supply/demand pull toward equilibrium targets (producers: high supply/low demand, consumers: inverse, neutral: balanced)
- Reversion rate: 5% of gap per tick + random noise (±3 units)
- **Per-good rates:** `MarketTickEntry` accepts optional `productionRate`, `consumptionRate`, and `volatility` fields. When present, these override the global `params.productionRate`/`params.consumptionRate`. Volatility scales the noise amplitude (`noiseAmplitude * volatility`).
- Production effect: producers gain supply (+rate/tick), slightly reduce demand. Default rate in `lib/constants/economy.ts`, per-good overrides from `lib/constants/universe.ts` (`ECONOMY_PRODUCTION`).
- Consumption effect: consumers deplete supply (-rate/tick), generate demand. Per-good overrides from `ECONOMY_CONSUMPTION`.
- 12 goods across 3 tiers (tier 0: water, food, ore, textiles; tier 1: fuel, metals, chemicals, medicine; tier 2: electronics, machinery, weapons, luxuries). Defined in `lib/constants/goods.ts` with basePrice, volume, mass, volatility, and hazard.
- 6 economy types: agricultural, extraction, refinery, industrial, tech, core. Each has per-good production and consumption rates in `lib/constants/universe.ts`.
- All values clamped to `[5, 200]`
- Accepts optional RNG function for deterministic testing
- Constants in `lib/constants/economy.ts` (reversion rate, noise, fallback production/consumption rates, equilibrium targets)
- `processShipArrivals` returns ship IDs where `arrivalTick <= currentTick`

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
| `/api/game/ship/[shipId]/refuel` | POST | Refuel a docked ship (amount in body) |
| `/api/game/prices/[systemId]` | GET | Price snapshot history for a system |
| `/api/game/shipyard` | POST | Purchase a new ship at a system's shipyard |
| `/api/game/missions` | GET | Available missions at a system (?systemId=X) or player's active missions |
| `/api/game/missions/accept` | POST | Accept an available mission |
| `/api/game/missions/deliver` | POST | Deliver cargo for an accepted mission |
| `/api/game/missions/abandon` | POST | Abandon an accepted mission (returns to available pool) |

### Auth on API Routes

All authenticated routes use `getSessionPlayerId()` for lightweight auth, delegating to the services layer for DB queries.

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
- `economy` — Every tick, round-robin by region. Processes one region's markets per tick (~150 entries). Reads active `EventModifier` rows (domain: "economy") and applies equilibrium shifts, rate multipliers, and reversion dampening. Passes per-good production/consumption rates and volatility from `lib/constants/universe.ts` and `lib/constants/goods.ts`. Emits global `economyTick` events.
- `trade-missions` — Every 5 ticks, depends on `events` + `economy`. Expires unclaimed missions past deadline, generates economy-based candidates (high/low price markets) and event-based candidates (themed goods from active events), caps per station, batch creates. Emits global `missionsUpdated` event.
- `price-snapshots` — Every 20 ticks, depends on `economy`. Fetches all 1,200 market rows, computes current prices via `buildPriceEntry()`, appends to each system's rolling JSON history (capped at 50 entries). Emits global `priceSnapshot` event.

**Registry** (`lib/tick/registry.ts`): All processors are registered in a single array. `sortProcessors()` filters by frequency/offset and topologically sorts by `dependsOn`. Adding a new game system = one processor file + one registry line.

Clients connect to `GET /api/game/tick-stream` (Server-Sent Events) with per-player event filtering. The `useTick` hook wraps an `EventSource` connection with `subscribeToEvent(name, cb)` API. `useTickInvalidation` centralizes query invalidation: `shipArrived` → fleet+market, `economyTick` → market, `eventNotifications` → events, `cargoLost` → fleet, `priceSnapshot` → priceHistory, `missionsUpdated` → missions.

See `docs/design/archive/tick-engine-redesign.md` for the original architecture design.

## Tests

323 unit tests across 18 files in `lib/engine/__tests__/` and `lib/api/__tests__/`:

- `pricing.test.ts` — 7 tests (equal s/d, high demand, high supply, clamping, zero supply)
- `trade.test.ts` — 11 tests (buy/sell success, credit/cargo/supply validation, edge cases, fleet trade docked guard)
- `navigation.test.ts` — 5 tests (valid connection, exact fuel, no connection, insufficient fuel)
- `fleet-navigation.test.ts` — 13 tests (docked requirement, travel duration calc, departure/arrival ticks, delegation, multi-hop route validation)
- `pathfinding.test.ts` — 17 tests (shortest path, multi-hop optimal, reachability with fuel constraints, route validation)
- `tick.test.ts` — 30 tests (ship arrival processing, economy tick simulation, regional round-robin, edge cases)
- `universe-gen.test.ts` — 27 tests (region/system generation, connections, gateways, economy type distribution)
- `events.test.ts` — 56 tests (phase transitions, modifier building/aggregation, spawn selection, shocks, spread evaluation)
- `danger.test.ts` — 19 tests (danger level aggregation, cargo loss rolling, edge cases, caps)
- `refuel.test.ts` — 9 tests (cost calculation, max refuel, edge cases)
- `snapshot.test.ts` — 8 tests (price entry building, grouping, append/cap, immutability)
- `shipyard.test.ts` — 5 tests (valid purchase, exact credits, unknown type, starter-only type, insufficient credits)
- `missions.test.ts` — 23 tests (reward calculation, economy/event candidate generation, accept/deliver validation)
- `rate-limit.test.ts` — 10 tests (sliding window store, tier enforcement)

Run with: `npx vitest run`
