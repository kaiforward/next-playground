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
```

- Checks a direct connection exists between systems
- Validates sufficient fuel

### Economy Tick (`lib/engine/tick.ts`)

```
simulateEconomyTick(markets) → updatedMarkets
```

- Producers gain supply, lose demand
- Consumers lose supply, gain demand
- Small random drift applied
- All values clamped to `[5, 200]`

### NPC Traders (`lib/engine/npc.ts`)

- `pickNpcDestination` — random connected system
- `simulateNpcTrade` — buys cheap goods (< basePrice), sells expensive goods (> 1.5x basePrice)

## API Routes

All routes return `ApiResponse<T>` format: `{ data?: T, error?: string }`.

| Route | Method | Description |
|---|---|---|
| `/api/game/systems` | GET | All systems + connections |
| `/api/game/systems/[systemId]` | GET | Single system with station |
| `/api/game/market/[systemId]` | GET | Market entries with computed prices |
| `/api/game/trade` | POST | Buy/sell — validates, transacts, returns updated state |
| `/api/game/navigate` | POST | Travel — validates fuel/connection, updates player location |
| `/api/game/player` | GET | Full player state (ship, cargo, system) |
| `/api/game/history/[systemId]` | GET | Last 50 trade history entries |

### Auth on API Routes

All mutation routes (`trade`, `navigate`) and the `player` route use `getSessionPlayer()` to authenticate and look up the current player from the JWT session.

## Tests

20 unit tests across 3 files in `lib/engine/__tests__/`:

- `pricing.test.ts` — 7 tests (equal s/d, high demand, high supply, clamping, zero supply)
- `trade.test.ts` — 8 tests (buy/sell success, credit/cargo/supply validation, edge cases)
- `navigation.test.ts` — 5 tests (valid connection, exact fuel, no connection, insufficient fuel)

Run with: `npx vitest run`
