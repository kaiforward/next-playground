# Simulator Metrics Enhancement

Richer metrics from the economy simulator to answer specific game balance questions. Each section is a self-contained enhancement that adds new data collection and output without changing simulation behavior.

Current metrics are aggregate-only: final credits, total trades, credits/tick, fuel spent. These tell you *how much* a strategy earned but not *why* — which goods drove profit, which systems were used, how events disrupted earnings, or whether the universe topology rewards exploration.

## Current State

### Per-tick metrics (`TickMetrics`)
- `credits` — player balance after this tick
- `tradeCount` — buy + sell operations this tick
- `tradeProfitSum` — net profit from trades this tick
- `fuelSpent` — fuel consumed navigating this tick

### Summary (`PlayerSummary`)
- `finalCredits`, `totalTrades`, `avgProfitPerTrade`, `creditsPerTick`
- `freighterTick` — first tick reaching 5,000 credits
- `totalFuelSpent`, `profitPerFuel`
- `creditsCurve` — credits at each tick (for charting)

### Output
Formatted table with one row per bot. JSON mode dumps the full `SimResults` object.

---

## Phase 1: Per-Good Trade Breakdown — DONE

**Question answered:** Are all 6 goods useful? Which goods drive profit for each strategy?

### Data to collect

Add to `TickMetrics`:
```ts
/** Per-good trade data recorded this tick. */
goodsTraded: GoodTradeRecord[];
```

New type:
```ts
interface GoodTradeRecord {
  goodId: string;
  /** Quantity bought (0 if only sold this tick). */
  bought: number;
  /** Quantity sold (0 if only bought this tick). */
  sold: number;
  /** Credits spent buying. */
  buyCost: number;
  /** Credits earned selling. */
  sellRevenue: number;
}
```

**Where to record:** `bot.ts` already tracks individual buy/sell operations. Add a `GoodTradeRecord[]` accumulator alongside the existing `tradeCount`/`tradeProfitSum` counters. Record good ID, quantity, and cost/revenue for each operation.

Add to `PlayerSummary`:
```ts
/** Aggregate stats per good across the full run. */
goodBreakdown: GoodBreakdownEntry[];
```

New type:
```ts
interface GoodBreakdownEntry {
  goodId: string;
  timesBought: number;
  timesSold: number;
  totalQuantityBought: number;
  totalQuantitySold: number;
  totalSpent: number;
  totalRevenue: number;
  netProfit: number;
}
```

**Where to compute:** `metrics.ts` `computeSummary()` — aggregate from `goodsTraded` across all ticks.

### Output

New table section after the main summary:

```
Goods Breakdown (greedy):
Good         | Bought | Sold | Spent       | Revenue     | Net Profit  | % of Total
food         |     85 |   82 |     34,000  |     98,400  |     64,400  |     15.2%
ore          |     72 |   70 |     43,200  |    126,000  |     82,800  |     19.6%
fuel         |     60 |   58 |     48,000  |    116,000  |     68,000  |     16.1%
electronics  |     45 |   43 |     72,000  |    172,000  |    100,000  |     23.7%
ship_parts   |     30 |   28 |     60,000  |    140,000  |     80,000  |     18.9%
luxuries     |      5 |    3 |     15,000  |     42,000  |     27,000  |      6.4%
```

This immediately answers the luxury goods question: if luxuries show up as <5% of trades and profit, they need a balance pass.

### Files modified
- `lib/engine/simulator/types.ts` — `GoodTradeRecord`, `GoodBreakdownEntry`, extended `TickMetrics` and `PlayerSummary`
- `lib/engine/simulator/bot.ts` — records per-good buy/sell data
- `lib/engine/simulator/metrics.ts` — `aggregateGoodsBreakdown()` in `computeSummary()`
- `scripts/simulate.ts` — goods breakdown table per strategy

### Findings (seed 42, 500 ticks, all strategies)

- **ship_parts and electronics dominate.** They account for 95-100% of profit for greedy/optimal. Optimal is the most extreme at 98.5% ship_parts.
- **food, ore, fuel are essentially never traded** by any smart strategy. Random trades them but loses money on fuel and electronics.
- **luxuries are traded occasionally but contribute <1% of profit** across all strategies, confirming the user-observed impression.
- **Root cause:** high-base-price goods (ship_parts 100, electronics 80) create larger absolute arbitrage opportunities than cheap goods (food 20, ore 30) even at similar supply/demand ratios. Strategies rationally ignore low-margin goods.

---

## Phase 2: Market Health Snapshots — DONE

**Question answered:** Is the economy self-correcting? Do supply/demand converge to equilibrium or spiral?

### Data to collect

New type:
```ts
interface MarketSnapshot {
  systemId: string;
  goodId: string;
  supply: number;
  demand: number;
  price: number;
}
```

Add to `SimResults`:
```ts
/** Market state sampled at regular intervals. */
marketSnapshots: { tick: number; markets: MarketSnapshot[] }[];
```

**Where to record:** `runner.ts` main loop — sample every N ticks (configurable, default every 50 ticks). Read from `world.markets` and compute price via `calculatePrice()`. Only sample, don't copy every tick — 500 ticks with 200 systems x 6 goods = 120K entries per tick is too much. At every-50 that's 10 snapshots = 12K entries, manageable.

### Derived metrics

Compute in `metrics.ts` or a new `market-analysis.ts`:

```ts
interface MarketHealthSummary {
  /** Per-good average price standard deviation across systems (high = price dispersion = trade opportunity). */
  priceDispersion: { goodId: string; avgStdDev: number }[];
  /** Per-good average distance from equilibrium at simulation end. */
  equilibriumDrift: { goodId: string; avgDrift: number }[];
}
```

### Output

Summary line in the table output:
```
Market Health:
  Price dispersion: food 12.3, ore 18.7, electronics 45.2, luxuries 8.1
  Equilibrium drift: food +2.1%, ore -5.3%, electronics +12.8%, luxuries +0.4%
```

Low dispersion on luxuries + low drift = nobody is trading them enough to move the market. High dispersion = healthy arbitrage opportunities exist.

### Files modified
- `lib/engine/simulator/types.ts` — `MarketSnapshot`, `MarketHealthSummary`, extended `SimResults`
- New `lib/engine/simulator/market-analysis.ts` — `takeMarketSnapshot()`, `computeMarketHealth()`, price dispersion + equilibrium drift
- `lib/engine/simulator/runner.ts` — samples markets every 50 ticks, computes health post-simulation
- `lib/engine/simulator/experiment.ts` — `ExperimentResult` includes `marketHealth`
- `scripts/simulate.ts` — market health table in output

### Findings (seed 42, 500 ticks, all strategies)

- **Economy is self-correcting.** Equilibrium drift is single-digit across all goods — supply/demand stay close to targets. The reversion mechanics work.
- **Price dispersion correlates with trade volume.** ship_parts (stddev 205) and electronics (166) have the highest price variance, which is both cause and effect of bot activity — bots trade them because spreads exist, and trading creates new spreads.
- **Untouched goods have low dispersion.** food (42), luxuries (48) — prices are uniform across systems, confirming no meaningful arbitrage opportunity exists for these goods.
- **Luxuries accumulate supply.** +9.2 supply drift = supply building up with nobody buying. The economy reverts demand to equilibrium, but without trade-driven demand pressure, luxuries stagnate.
- **Key insight:** The economy engine is healthy (self-correcting, stable). The problem is in goods balance, not simulation mechanics. Cheap goods need wider spread potential or some other incentive to make them worth trading.

---

## Phase 3: Route Diversity & System Usage — DONE

**Question answered:** Does universe topology matter? Are bots exploring or looping the same route?

### Data to collect

Add to `TickMetrics`:
```ts
/** System the bot was at (or departed from) this tick. Null if in transit. */
systemVisited: string | null;
```

**Where to record:** `bot.ts` — record `ship.systemId` when docked, null when in transit.

Add to `PlayerSummary`:
```ts
/** Number of unique systems visited. */
uniqueSystemsVisited: number;
/** Top 5 most-visited systems with visit counts. */
topSystems: { systemId: string; systemName: string; visits: number }[];
/** Fraction of total systems visited at least once. */
explorationRate: number;
```

**Where to compute:** `metrics.ts` — count from `systemVisited` across all ticks.

### Output

```
Route Diversity:
  Strategy     | Unique Systems | Exploration % | Top System (visits)
  random       |            34  |         17.0% | Arcturus (8)
  greedy       |            12  |          6.0% | Vega (42)
  optimal      |            15  |          7.5% | Deneb (38)
```

If greedy visits 12 out of 200 systems, the universe has dead zones. If all strategies converge on the same top system, that system's economy type is too rewarding.

### Files modified
- `lib/engine/simulator/types.ts` — `systemVisited` on `TickMetrics`, `uniqueSystemsVisited`/`topSystems`/`explorationRate` on `PlayerSummary`
- `lib/engine/simulator/bot.ts` — records `ship.systemId` when docked, `null` when in transit
- `lib/engine/simulator/metrics.ts` — `computeRouteDiversity()`, `computeSummary()` now accepts `totalSystems` + `systemNames`
- `lib/engine/simulator/runner.ts` — passes system count and name lookup to `computeSummary()`
- `scripts/simulate.ts` — route diversity table (top 3 systems per strategy)

### Findings (seed 42, 500 ticks, all strategies)

- **Massive universe underutilization.** Even the most exploratory strategy (nearest, 25 systems) only visits 12.5% of ~200 systems. Greedy visits just 10 (5.0%), optimal 14 (7.0%).
- **Strategies converge on the same hubs.** Confluence-22, Confluence-25, and Vertex systems appear as top destinations across nearest, greedy, and optimal. These are likely high-value economy types at graph-central positions.
- **Optimal is the most concentrated.** 188 visits to Confluence-22 out of ~250 docked ticks = the bot runs the same loop repeatedly. The 2-leg lookahead found a single dominant route and stuck with it.
- **Random is actually the most diverse** (21 systems) but still only ~10% coverage — even random walks don't reach most of the universe within 500 ticks.
- **Implication:** Most of the generated universe is dead weight. Either fuel costs make distant systems unreachable, or the reward for exploring doesn't justify the fuel. This reinforces the goods balance issue — if ship_parts and electronics are the only profitable goods, bots converge on the systems that produce/consume them.

---

## Phase 4: Event Impact Measurement — DONE

**Question answered:** Are events impactful enough? Do wars actually hurt? Do festivals actually help?

### Data to collect

Requires Phase 2 (market snapshots) as a prerequisite for price comparison.

Add to `SimResults`:
```ts
/** Impact measurement for each event that occurred. */
eventImpacts: EventImpact[];
```

New type:
```ts
interface EventImpact {
  eventId: string;
  eventType: string;
  systemId: string;
  startTick: number;
  endTick: number;
  /** Average bot earning rate (credits/tick) in the N ticks before the event. */
  preEventEarningRate: number;
  /** Average bot earning rate during the event. */
  duringEventEarningRate: number;
  /** Price change at the affected system (average across goods). */
  priceImpactPct: number;
}
```

**Where to compute:** Post-simulation pass in `runner.ts` or a new `event-analysis.ts`. Walk the event list, slice the relevant ticks from `creditsCurve` and `marketSnapshots`, compute deltas.

### Output

```
Event Impact:
  Type             | System    | Ticks    | Earning Rate (before → during) | Price Impact
  war              | Vega      | 50-85    | 8,200 → 5,100 cr/tick (-37.8%) | +42.3%
  trade_festival   | Arcturus  | 120-145  | 8,200 → 11,400 cr/tick (+39.0%)| -18.7%
```

### Files modified
- `lib/engine/simulator/types.ts` — `EventLifecycle`, `EventImpact`, extended `SimResults`
- New `lib/engine/simulator/event-analysis.ts` — lifecycle tracking (diff-based), `computeEventImpacts()` with earning rate + price impact
- `lib/engine/simulator/runner.ts` — tracks event lifecycles per tick, flushes at end, calls impact analysis
- `lib/engine/simulator/experiment.ts` — `ExperimentResult` includes `eventImpacts`
- `scripts/simulate.ts` — event impact table (type, system, ticks, severity, earning rate change, price impact)

### Findings (seed 42, 500 ticks, all strategies, random events enabled)

- **Events have measurable earning rate impact but the direction is counterintuitive.** Wars show *positive* earning rate changes (+10-53%), not negative. This is because wars happen at random systems, while bots concentrate on a few hub systems — a war elsewhere doesn't hurt the bots, and the economy-wide noise from natural supply/demand shifts dominates.
- **Trade festivals show mixed signals.** Some festivals correlate with earning drops (-34%, -25%), others with gains (+14%). This is noise — festivals at systems bots don't visit have no direct effect on bot earnings.
- **Price impact is minimal for most events.** Most events show +0.0% price impact because they occur at systems with no market snapshot coverage near the event window, or at systems the bots don't trade at.
- **Events at hub systems are the exception.** The few events at Confluence-22 or Vertex-18 (where bots actually trade) show real price effects (-12.5%, +17.6%).
- **Controlled injection is more revealing.** War-on-mining (severity 1.5 injected at tick 50 on a Pastoral system) shows +76.4% earning rate and +26.7% price impact — the disruption created new arbitrage opportunities rather than hurting traders.
- **Key insight:** Events are working mechanically (prices change, phases progress) but don't meaningfully affect player strategy because bots trade on a tiny subset of systems. Event impact is diluted by universe underutilization. This ties directly to the Phase 3 finding: if bots only use 5-12% of the universe, most events happen in "dead space."

---

## Phase 5: Earning Rate & Idle Analysis — DONE

**Question answered:** Is there a boring mid-game? Are bots frequently stuck with nothing to do?

### Data to collect

Add to `TickMetrics`:
```ts
/** True if the bot was docked but found no profitable trade this tick. */
idle: boolean;
```

**Where to record:** `bot.ts` — when `strategy.evaluate()` returns null and the ship is docked.

Add to `PlayerSummary`:
```ts
/** Number of ticks spent docked with no trade available. */
idleTicks: number;
/** Idle rate as fraction of total docked ticks. */
idleRate: number;
/** Earning rate per tick as a rolling window (window size = 50 ticks). */
earningRateCurve: number[];
```

**Where to compute:** `metrics.ts` — `idleTicks` from counting `idle: true`, `earningRateCurve` as sliding window delta on `creditsCurve`.

### Output

Add columns to main table:
```
Strategy     | ... | Idle Ticks | Idle %
greedy       | ... |         12 |   2.4%
random       | ... |         89 |  17.8%
```

High idle rate on greedy = markets are saturated. High idle on random = expected (random picks bad routes). If all strategies show high idle in the same tick range, that's a systemic mid-game issue.

### Files modified
- `lib/engine/simulator/types.ts` — `idle` on `TickMetrics`, `idleTicks`/`idleRate`/`earningRateCurve` on `PlayerSummary`
- `lib/engine/simulator/bot.ts` — detects idle (strategy returns null while docked), passes to `recordTickMetrics()`
- `lib/engine/simulator/metrics.ts` — idle counting, idle rate (fraction of docked ticks), earning rate curve (50-tick rolling window on creditsCurve)
- `scripts/simulate.ts` — Idle and Idle % columns in main summary table

### Findings (seed 42, 500 ticks, all strategies)

- **Smart strategies never idle.** Nearest, greedy, and optimal all show 0 idle ticks — there is always a profitable trade available when they dock. This means market saturation is not a problem at current bot density (1 bot per strategy).
- **Random idles rarely** (1 tick, 4.2%). Even random finds *something* to do almost every time — the universe has enough trade opportunities that landing anywhere tends to surface at least one viable buy.
- **No boring mid-game detected.** The earning rate curves (available in JSON output) show consistent growth without plateaus. The exponential growth pattern (more credits → bigger trades → more credits) means the game accelerates, not stagnates.
- **Key insight:** Idle rate is the wrong signal for "boring mid-game." The problem isn't that bots can't find trades — it's that they find the *same* trades repeatedly (Phase 3 finding). A player doing the same loop 188 times isn't idle, but the experience is monotonous. Player engagement is about route diversity, not idle rate.

---

## Implementation Order

| Phase | Depends on | Effort | Value |
|-------|-----------|--------|-------|
| ~~1. Per-good breakdown~~ | — | ~~Small~~ | ~~DONE~~ |
| ~~2. Market health~~ | — | ~~Medium~~ | ~~DONE~~ |
| ~~3. Route diversity~~ | — | ~~Small~~ | ~~DONE~~ |
| ~~4. Event impact~~ | ~~Phase 2~~ | ~~Medium~~ | ~~DONE~~ |
| ~~5. Earning rate & idle~~ | — | ~~Small~~ | ~~DONE~~ |

All phases complete.

## Notes

- All new data is **read-only** — no changes to simulation behavior, strategy logic, or economy processing.
- Market snapshots (Phase 2) are the most memory-intensive addition. The every-50-ticks sampling keeps it bounded. For longer runs, the interval should scale with tick count.
- JSON output (`--json`) gets all new fields automatically. Table output gets summarized views. Experiment result files get the full data for offline analysis.
- None of these changes affect the real game engine — everything stays within `lib/engine/simulator/`.
