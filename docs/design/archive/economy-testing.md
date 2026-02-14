# Economy Testing & Dev Tools

Tools for quantifying game balance, testing tuning changes, and manipulating game state during development.

## Economy Simulator

Pure-engine, in-memory simulation. No database — runs bots with different strategies and outputs earning curves.

### CLI Usage

```bash
# Run with all strategies (default)
npm run simulate

# Custom configuration
npm run simulate -- --ticks 500 --strategies greedy,random --seed 42

# JSON output for scripting
npm run simulate -- --ticks 500 --json

# See all options
npm run simulate -- --help
```

**Options:**
| Flag | Default | Description |
|------|---------|-------------|
| `--ticks N` | 500 | Number of ticks to simulate |
| `--strategies S` | all | Comma-separated: `random`, `nearest`, `greedy`, `optimal` |
| `--bots N` | 1 | Bots per strategy |
| `--seed N` | 42 | RNG seed (deterministic) |
| `--json` | false | Output JSON instead of table |

### Output

```
Strategy     | Final Credits  | Trades | Cr/Tick  | Avg Profit | Freighter @ | Fuel Spent | Profit/Fuel
random       |             14 |      5 |     -0.1 |      -97.2 |       never |       88.5 |        -5.5
greedy       |      408,679   |     95 |   8173.6 |     4297.7 |      tick 5 |       88.2 |      4629.0
```

### Vitest Tests

```bash
npx vitest run lib/engine/__tests__/simulator.test.ts
```

Tests cover: world creation, market drift, ship arrivals, determinism (same seed = same results), strategy comparison (greedy > random), and metrics validity.

### Bot Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| **random** | Random good + random destination | Baseline (worst case) |
| **nearest** | Best profit within 2 ticks travel | Casual player proxy |
| **greedy** | Best profit-per-tick across all reachable | Active player proxy |
| **optimal** | 2-leg look-ahead with pathfinding | Expert player proxy |

### How Bots Work (per tick)

1. Skip if ship is in transit
2. Refuel if fuel < 50% capacity
3. Sell all cargo at current prices
4. Evaluate strategy -> decide what to buy and where to go
5. Buy goods, depart for target system

## Dev Tools API

Server-side routes for manipulating game state. **Only available when `NODE_ENV=development`** — returns 403 in production.

### Routes

| Route | Method | Body | Description |
|-------|--------|------|-------------|
| `/api/dev/advance-ticks` | POST | `{ count }` | Run N ticks inline (max 1000) |
| `/api/dev/spawn-event` | POST | `{ systemId, eventType, severity? }` | Create event with modifiers |
| `/api/dev/give-credits` | POST | `{ playerId, amount }` | Add/subtract credits |
| `/api/dev/teleport-ship` | POST | `{ shipId, systemId }` | Instant move + dock |
| `/api/dev/set-cargo` | POST | `{ shipId, cargo[] }` | Replace cargo |
| `/api/dev/economy-snapshot` | GET | — | All systems with prices |
| `/api/dev/reset-economy` | POST | — | Reset markets + clear events |
| `/api/dev/tick-control` | POST | `{ action, tickRate? }` | Pause/resume/set speed |

### Event Types

Valid `eventType` values: `war`, `plague`, `trade_festival`, `conflict_spillover`, `plague_risk`.

## Dev Tools UI

Floating panel in the bottom-right corner of the game UI (dev mode only). Toggle with the gear button.

### Tabs

- **Tick** — Pause/resume, step 1 tick, advance N ticks
- **Events** — Pick system + event type + severity, spawn instantly
- **Economy** — Overview table of all systems with avg prices, reset economy button
- **Cheats** — Give credits, teleport ships to any system

## Tuning Workflow

1. **Identify the problem**: "Players earn credits too fast"
2. **Quantify**: `npm run simulate -- --ticks 500 --strategies greedy`
3. **Tune constants**: Edit `lib/constants/economy.ts` or `lib/constants/goods.ts`
4. **Re-run**: Same seed, compare earning curves
5. **Verify in-game**: Use dev tools UI to spawn events, advance ticks, observe behavior

## Architecture

```
lib/engine/simulator/
  types.ts        — SimWorld, SimConfig, SimResults, etc.
  world.ts        — createSimWorld() using generateUniverse()
  economy.ts      — simulateWorldTick() (events + economy)
  metrics.ts      — recordTickMetrics(), computeSummary()
  bot.ts          — executeBotTick() (refuel → sell → evaluate → buy → navigate)
  runner.ts       — runSimulation() orchestrator
  strategies/
    types.ts      — TradeStrategy interface
    random.ts     — Random strategy
    nearest.ts    — Nearest-profit strategy
    greedy.ts     — Best profit-per-tick strategy
    optimal.ts    — 2-leg lookahead strategy
    helpers.ts    — Shared profit calculation utils
    index.ts      — Strategy registry

lib/api/dev-guard.ts       — devOnly() middleware
lib/services/dev-tools.ts  — All dev service functions
lib/hooks/use-dev-tools.ts — TanStack Query hooks for dev routes

app/api/dev/               — 8 route handlers
components/dev-tools/      — Panel + 4 tab sections
```
