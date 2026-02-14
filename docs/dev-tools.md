# Dev Tools & Economy Simulator

Tools for manipulating game state during development and quantifying game balance via bot simulations.

## Dev Tools UI

Floating panel in the bottom-right corner of the game UI. Only renders when `NODE_ENV=development` (guarded in `components/game-shell.tsx`). Toggle with the gear button.

### Tabs

| Tab | Controls |
|-----|----------|
| **Tick** | Pause/resume, step 1 tick, advance N ticks (1-1000) |
| **Events** | System + event type + severity pickers, spawn button |
| **Economy** | All-systems price overview table (10s refresh), reset economy |
| **Cheats** | Give/remove credits, teleport ships to any system |

### Components

```
components/dev-tools/
  dev-tools-panel.tsx          — Container, tab switching, toggle button
  tick-control-section.tsx     — Pause/resume/step/advance controls
  event-spawner-section.tsx    — Event spawning form
  economy-overview-section.tsx — Price table, reset button
  cheats-section.tsx           — Credits + teleport forms
```

## Dev Tools API

Server-side routes for state manipulation. Protected by `devOnly()` guard (`lib/api/dev-guard.ts`) — returns 403 when `NODE_ENV !== "development"`.

| Route | Method | Body | Returns |
|-------|--------|------|---------|
| `/api/dev/advance-ticks` | POST | `{ count }` (1-1000) | `{ newTick, elapsed }` |
| `/api/dev/spawn-event` | POST | `{ systemId, eventType, severity? }` | `{ eventId, type, phase }` |
| `/api/dev/give-credits` | POST | `{ playerId, amount }` | `{ credits }` |
| `/api/dev/teleport-ship` | POST | `{ shipId, systemId }` | `{ shipId, systemId }` |
| `/api/dev/set-cargo` | POST | `{ shipId, cargo[] }` | `{ shipId, cargoCount }` |
| `/api/dev/economy-snapshot` | GET | — | `{ systems[] }` with prices |
| `/api/dev/reset-economy` | POST | — | `{ marketsReset, eventsCleared }` |
| `/api/dev/tick-control` | POST | `{ action, tickRate? }` | `{ tickRate, paused }` |

Valid `eventType` values: `war`, `plague`, `trade_festival`, `conflict_spillover`, `plague_risk`.

### Service Layer (`lib/services/dev-tools.ts`)

All service functions return discriminated unions (`{ ok, data } | { ok, error }`). Key behaviors:

- **advanceTicks** — Runs the full tick processor pipeline N times inline (same order as the real tick engine).
- **spawnEvent** — Creates a `GameEvent` + rolls first phase duration + inserts `EventModifier` rows.
- **giveCredits** — Atomic `{ increment }` on player credits.
- **teleportShip** — Sets `status: "docked"`, clears navigation state.
- **setShipCargo** — Transaction: delete-all then create. Accepts good IDs or good key names.
- **resetEconomy** — Transaction: deletes all events (modifiers cascade), resets markets to equilibrium targets.

### Client Hooks (`lib/hooks/use-dev-tools.ts`)

| Hook | Type | Invalidates |
|------|------|-------------|
| `useEconomySnapshot(enabled)` | Query (10s stale) | — |
| `useAdvanceTicksMutation` | Mutation | fleet, marketAll, events, devEconomy |
| `useSpawnEventMutation` | Mutation | events |
| `useGiveCreditsMutation` | Mutation | fleet |
| `useTeleportShipMutation` | Mutation | fleet |
| `useResetEconomyMutation` | Mutation | marketAll, events, devEconomy |
| `useTickControlMutation` | Mutation | — |

## Economy Simulator

Pure-engine, in-memory simulation. No database — generates a universe, runs bots with different strategies, and outputs earning curves. Useful for quantifying balance changes before testing in-game.

### CLI Usage

Two modes: quick-run (CLI flags) for ad-hoc checks, and `--config` (YAML) for reproducible experiments. New features go in `--config` only — the CLI flags are frozen at their current set.

```bash
# All strategies, 500 ticks (default)
npm run simulate

# Custom configuration
npm run simulate -- --ticks 500 --strategies greedy,random --seed 42

# JSON output for scripting
npm run simulate -- --ticks 500 --json

# See all options
npm run simulate -- --help
```

| Flag | Default | Description |
|------|---------|-------------|
| `--ticks N` | 500 | Ticks to simulate |
| `--strategies S` | all | Comma-separated: `random`, `nearest`, `greedy`, `optimal` |
| `--bots N` | 1 | Bots per strategy |
| `--seed N` | 42 | RNG seed (deterministic) |
| `--json` | false | JSON output instead of table |
| `--config PATH` | — | Load experiment from YAML (see [Experiment System](#experiment-system)) |

### Output

```
Strategy     | Final Credits  | Trades | Cr/Tick  | Avg Profit | Freighter @ | Fuel Spent | Profit/Fuel
random       |             14 |      5 |     -0.1 |      -97.2 |       never |       88.5 |        -5.5
greedy       |      408,679   |     95 |   8173.6 |     4297.7 |      tick 5 |       88.2 |      4629.0
```

"Freighter @" is the first tick where credits reached 5,000 — a proxy for early-game progression speed.

### Bot Strategies

| Strategy | Approach | Player proxy |
|----------|----------|--------------|
| **random** | Random good + random destination | Worst case baseline |
| **nearest** | Best profit within 2 ticks travel | Casual player |
| **greedy** | Best profit-per-tick across all reachable systems | Active player |
| **optimal** | 2-leg look-ahead with pathfinding | Expert player |

### Bot Decision Loop (per tick)

1. Skip if ship is in transit
2. Refuel if fuel < 50% capacity
3. Sell all cargo at current prices
4. Evaluate strategy — decide what to buy and where to go
5. Buy goods, depart for target system

Market impact: selling adds supply + reduces demand, buying removes supply + adds demand (10% of traded quantity as delta). Same formula as the real trade engine.

### Architecture

```
lib/engine/simulator/
  types.ts        — SimWorld, SimConfig, SimResults, TickMetrics, PlayerSummary, SimRunContext
  constants.ts    — SimConstants, resolveConstants(), DEFAULT_SIM_CONSTANTS
  experiment.ts   — ExperimentConfigSchema (Zod), YAML→SimConfig conversion, result serialization
  world.ts        — createSimWorld() using generateUniverse()
  economy.ts      — simulateWorldTick() (arrivals → events → economy)
  bot.ts          — executeBotTick() (refuel → sell → evaluate → buy → navigate)
  metrics.ts      — recordTickMetrics(), computeSummary()
  runner.ts       — runSimulation() orchestrator
  strategies/
    types.ts      — TradeStrategy interface, TradeDecision type
    helpers.ts    — Shared profit/price/reachability utils
    random.ts     — Random strategy
    nearest.ts    — Nearest-profit strategy
    greedy.ts     — Best profit-per-tick strategy
    optimal.ts    — 2-leg lookahead strategy
    index.ts      — STRATEGIES registry map
```

The simulator mirrors the real tick processor pipeline (ship arrivals → events → economy) but operates entirely in memory. All state is immutable — each tick returns a new `SimWorld`.

### Tests

```bash
npx vitest run lib/engine/__tests__/simulator.test.ts
npx vitest run lib/engine/__tests__/sim-constants.test.ts
npx vitest run lib/engine/__tests__/experiment.test.ts
```

Coverage: world creation, market drift, ship arrivals, determinism (same seed = same results), strategy comparison (greedy > random), credits never negative, all four strategies produce valid metrics, event injection (economyType/systemIndex targeting, severity, multi-inject, invalid type), constants resolution + overrides, experiment config parsing.

## Experiment System

Experiments are self-documenting simulation runs driven by YAML config files. Every result includes a full snapshot of the constants that produced it, so changing a constant and re-running doesn't lose the previous baseline.

### YAML Config Format

```yaml
label: "war-impact-on-mining"   # optional, used in result filename
seed: 42                        # default 42
ticks: 500                      # default 500

bots:
  - strategy: greedy
    count: 1
  - strategy: random
    count: 2

overrides:                      # optional — all sections optional
  economy:
    reversionRate: 0.025
  fuel:
    refuelCostPerUnit: 3
  goods:
    food:
      basePrice: 30

events:                         # optional
  disableRandom: true           # suppress random event spawning
  inject:
    - tick: 50
      target: { economyType: mining }   # or { systemIndex: 5 }
      type: war
      severity: 1.5
```

### CLI Usage

```bash
# Run experiment from YAML config
npm run simulate -- --config experiments/examples/war-on-mining.yaml

# Same, with JSON output
npm run simulate -- --config experiments/examples/baseline.yaml --json
```

When `--config` is used, the YAML file controls all simulation parameters. Other flags (`--ticks`, `--strategies`) are ignored. Results are auto-saved to `experiments/<slug>-<timestamp>.json`.

### Result JSON Structure

Saved results contain everything needed to reproduce and compare:

```json
{
  "label": "war-impact-on-mining",
  "timestamp": "2026-02-13T15:30:00.000Z",
  "config": { "tickCount": 500, "bots": [...], "seed": 42, ... },
  "constants": { "economy": {...}, "goods": {...}, ... },
  "overrides": { "economy": { "reversionRate": 0.025 } },
  "summaries": [ ... ],
  "elapsedMs": 1234
}
```

- `constants` — full snapshot of every constant used in the run
- `overrides` — only the values that were changed from defaults (empty `{}` if none)

### Event Injection Targeting

Two targeting modes for injected events:

| Target | Description |
|--------|-------------|
| `{ economyType: "mining" }` | First mining system (sorted by ID) |
| `{ economyType: "mining", nth: 2 }` | Third mining system |
| `{ systemIndex: 5 }` | System at index 5 in the generated universe |

### Overridable Constants

| Section | Fields |
|---------|--------|
| `economy` | `reversionRate`, `noiseAmplitude`, `minLevel`, `maxLevel`, `productionRate`, `consumptionRate` |
| `equilibrium` | `produces.{supply,demand}`, `consumes.{supply,demand}`, `neutral.{supply,demand}` |
| `goods.<name>` | `basePrice` |
| `fuel` | `refuelCostPerUnit` |
| `events` | `spawnInterval`, `maxPerSystem`, `maxGlobal`, `modifierCaps.{maxShift,minMultiplier,maxMultiplier,minReversionMult}` |
| `ships.<name>` | `fuel`, `cargo`, `price` |
| `universe` | `regionCount`, `systemsPerRegion`, `intraRegionBaseFuel`, `gatewayFuelMultiplier`, `intraRegionExtraEdges` |
| `bots` | `startingCredits`, `refuelThreshold`, `tradeImpactFactor` |
| `pricing` | *(read-only — not overridable)* |

## Tuning Workflow

1. **Identify**: "Players earn credits too fast"
2. **Quantify**: `npm run simulate -- --ticks 500 --strategies greedy`
3. **Tune**: Create a YAML config with overrides (or edit constants directly)
4. **Re-run**: `npm run simulate -- --config experiments/examples/my-test.yaml`
5. **Compare**: Saved JSON results include full constants snapshot for diffing
6. **Verify in-game**: Use dev tools UI to spawn events, advance ticks, observe behavior
