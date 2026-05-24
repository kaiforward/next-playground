# Economy Tuning — Known Issues & Next Steps

Status: **Active** — structural issues identified, trade simulation feature planned.

## Structural Issues

### 1. ~~Neutral goods are dead markets~~ — FIXED

Changed neutral equilibrium from `{ supply: 75, demand: 75 }` to `{ supply: 20, demand: 23 }`. Low volumes reflect that transit stations don't stockpile goods they don't produce/consume. Slight consumer lean (ratio 1.15) creates a subtle markup. Noise amplitude now scales proportionally to target level (`target / 75`), preventing the random walk drift that occurred when fixed ±3 noise overwhelmed the 2% reversion at low absolute values. `driftValue` no longer rounds to integers (DB columns are Float).

### 2. All systems start stagnant

New systems start at prosperity 0 (stagnant, 0.7x multiplier). Without player trade, they stay stagnant forever — 70% of normal activity. This is correct for the game design (reward trading), but it means the entire universe starts sluggish.

Trade simulation (see below) will contribute to prosperity via the same `tradeVolumeAccum` channel as player trades, lifting systems out of stagnant baseline without players present.

### 3. ~~Global rate constants are misleading~~ — FIXED

Removed `ECONOMY_CONSTANTS.PRODUCTION_RATE` and `CONSUMPTION_RATE`. These were never used — both the processor and simulator always provide per-economy-type rates via `resolveMarketTickEntry`. The fallback in `simulateEconomyTick` now defaults to 0 (no production/consumption) for goods without explicit rates, which is correct for neutral goods.

### 4. No spatial restoring force between markets

Markets evolve in isolation — production/consumption + random walk per system, with no mechanism for goods to flow between systems based on price gradients. Without sustained trade pressure, supply/demand drifts to clamp boundaries because the only restoring force is local equilibrium reversion. Player density (10-50 players across 10K systems) is far too sparse to provide this pressure.

Trade simulation (see below) addresses this directly.

## Planned Feature: Trade Simulation (Edge Flow)

Replaces an earlier NPC-entity design with a pure-math edge-flow simulation: goods flow along graph edges based on local price gradients, rate-limited per edge per tick. No entities — flow is aggregate math, with per-system and per-edge metrics stored as first-class data.

Full design: `docs/design/planned/trade-simulation.md`.

**Why edge flow over NPC entities:** ~80% of the economic value at ~10-20% of the runtime cost at 10K-system scale. Trade route data becomes a first-class queryable table (deterministic, not inferred from entity movements), which enables trade-skill-tiered route visibility, mission hooks, and predictive analytics for high-skill players. Interactable entities (pirate prey, escort targets) can be added as a smaller named-convoy layer on top if gameplay demands it.

**Builds on:** Processor architecture — see `docs/design/active/processor-architecture.md`. The unified processor pattern eliminates orchestration drift between simulator and live game.

## Simulation Tools

- `npm run simulate` — 500-tick sanity check with bot strategies
- `npm run simulate -- --config <file>` — run experiment from YAML config
- `scripts/spread-calculator.ts` (not committed) — analysis tool for equilibrium target changes
