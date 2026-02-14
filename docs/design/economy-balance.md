# Economy Balance — Data-Driven Improvements

Concrete changes to make all 6 goods worth trading, spread player activity across the universe, and make events strategically relevant. Every proposal is grounded in simulator findings (see [archive/simulator-metrics.md](./archive/simulator-metrics.md)).

## Problems Summary

Five interconnected problems, one root cause.

### 1. Goods imbalance

ship_parts and electronics account for 95-100% of profit across all smart strategies. food, ore, and fuel are essentially never traded. luxuries contribute <1%.

**Root cause:** `price = basePrice * (demand / supply)`. Absolute profit scales linearly with basePrice. A 3:1 demand/supply ratio on ship_parts (base 100) yields 200cr per unit. The same ratio on food (base 20) yields 40cr. Same cargo slot, same fuel cost, 5x less reward. Strategies rationally ignore cheap goods.

### 2. Universe underutilization

Bots visit 5-12% of ~200 systems. Strategies converge on the same hub systems (Confluence, Vertex types). 88-95% of the universe is dead weight.

**Root cause:** When only 2 goods matter, only the systems that produce/consume those goods matter. Industrial (produces ship_parts) and tech (produces electronics) systems are the only worthwhile destinations.

### 3. Event irrelevance

Events work mechanically — prices change, phases progress, spread fires — but most events happen at systems nobody visits. Only events at hub systems show measurable impact.

**Root cause:** Direct consequence of problem 2. If players use 10 systems out of 200, the probability that a random event hits one of those 10 is 5%.

### 4. Route monotony

The optimal bot visits Confluence-22 188 times out of ~250 docked ticks. Smart strategies find a single dominant loop and repeat it indefinitely. Players aren't idle — they're bored.

**Root cause:** Without good diversity, the optimal route is stable. Nothing disrupts it because events rarely hit the hub, and no new opportunity can compete with the established loop.

### 5. Luxury stagnation

Luxuries have the highest base price (150) but the lowest profit contribution. Core systems produce luxuries, but no economy type strongly consumes them. Supply accumulates (+9.2 drift). The only demand driver is the trade_festival event, which is random and rare.

**Root cause:** Incomplete consumption web. Core produces luxuries but there's no matching consumer economy type.

---

## Proposals

Ordered by expected impact. Each proposal includes what to change, why it helps, and how to verify with the simulator.

### Proposal 1: Widen price clamp range for cheap goods

**Problem addressed:** Goods imbalance (#1)

**Current state:** All goods use the same price clamp: `[0.2x, 5.0x]` basePrice. This means:
- food (base 20): price range 4-100
- ship_parts (base 100): price range 20-500
- Maximum possible profit per unit: food 96cr, ship_parts 480cr

**Change:** Per-good or per-category price clamp multipliers. Cheap goods get a wider ceiling, expensive goods get a tighter one.

```
Category     | Current range | Proposed range | Max profit/unit
raw          | 0.2x - 5.0x  | 0.1x - 8.0x   | food: 158, ore: 237
manufactured | 0.2x - 5.0x  | 0.2x - 4.0x   | electronics: 304, ship_parts: 380
luxury       | 0.2x - 5.0x  | 0.1x - 6.0x   | luxuries: 885
```

**Why it works:** Brings maximum per-unit profit closer together across goods. food can never match ship_parts per-unit, but at 158 vs 380 (2.4x gap) instead of 96 vs 480 (5x gap), a strategy that finds a great food route will take it.

**Files to modify:**
- `lib/engine/pricing.ts` — Accept min/max multipliers as parameters (or look up from good definition)
- `lib/constants/goods.ts` — Add `priceFloor` and `priceCeiling` multipliers per good
- `lib/engine/simulator/bot.ts` — Already uses `calculatePrice()`, no change needed
- `lib/tick/processors/economy.ts` — Already uses `calculatePrice()`, no change needed

**Verify:** Run simulator, check goods breakdown. food/ore should appear in greedy/optimal breakdown at >5% of profit. Price dispersion for cheap goods should increase.

### Proposal 2: Differentiated equilibrium targets

**Problem addressed:** Goods imbalance (#1), universe underutilization (#2)

**Current state:** All produce/consume relationships use the same equilibrium targets: produces = {supply: 120, demand: 40}, consumes = {supply: 40, demand: 120}. This means the supply/demand ratio (and thus profit margin) is identical for all goods at their producing/consuming systems.

**Change:** Per-good equilibrium modifiers that create different spread characteristics:

```
Good         | Produces (S/D)  | Consumes (S/D)  | Ratio spread
food         | 140 / 30        | 30 / 140        | 4.67x (was 3.0x)
ore          | 130 / 35        | 35 / 130         | 3.71x (was 3.0x)
fuel         | 120 / 40        | 40 / 120         | 3.0x (unchanged)
electronics  | 110 / 50        | 50 / 110         | 2.2x (was 3.0x)
ship_parts   | 100 / 55        | 55 / 100         | 1.82x (was 3.0x)
luxuries     | 130 / 30        | 25 / 150         | 6.0x (new)
```

**Why it works:** Cheap goods get wider natural spreads, partially compensating for their lower base price. Combined with Proposal 1, food's effective max profit approaches ship_parts levels. This also diversifies which systems are "interesting" — agricultural and mining systems become worthwhile destinations.

**Files to modify:**
- `lib/constants/economy.ts` — Change `EQUILIBRIUM_TARGETS` from flat structure to per-good or per-category
- `prisma/seed.ts` — Seed uses equilibrium targets for initial market values
- `lib/tick/processors/economy.ts` — Reversion needs per-good targets
- `lib/engine/simulator/world.ts` — Sim world creation uses equilibrium targets
- `lib/engine/simulator/economy.ts` — Sim economy tick uses equilibrium targets

**Verify:** Run simulator. Check that more economy types appear in topSystems. Check that goods breakdown is more diverse (no single good >60% of profit).

### Proposal 3: Add luxury consumers

**Problem addressed:** Luxury stagnation (#5), universe underutilization (#2)

**Current state:** Production/consumption web:
- Core produces luxuries, consumes everything else
- No other economy type consumes luxuries

**Change:** Add luxuries as a consumed good for tech and agricultural systems.

| Economy Type | Produces | Consumes (current) | Consumes (proposed) |
|---|---|---|---|
| agricultural | food | electronics | electronics, **luxuries** |
| tech | electronics | ore, ship_parts | ore, ship_parts, **luxuries** |

**Why it works:** Creates demand sinks for luxuries at two economy types. Combined with the wider price clamp (Proposal 1), luxury routes become viable: buy at core (high supply, low demand) → sell at tech/agricultural (low supply, high demand). This also gives players a reason to visit core systems as a *source*, not just a destination.

**Files to modify:**
- `lib/constants/universe.ts` — Add luxuries to tech and agricultural consumption lists
- `prisma/seed.ts` — New market entries for luxuries at tech/agricultural systems
- `lib/engine/simulator/world.ts` — Sim world picks up new consumption mapping

**Verify:** Run simulator. luxuries should appear in goods breakdown at >5% of profit. Core systems should appear as source systems in route diversity.

### Proposal 4: Production/consumption rate differentiation

**Problem addressed:** Goods imbalance (#1), route monotony (#4)

**Current state:** All goods use the same production rate (3/tick) and consumption rate (2/tick). Markets recover at the same speed regardless of good type.

**Change:** Per-good production and consumption rates:

```
Good         | Production | Consumption | Net effect
food         | 5          | 4           | Fast turnover, markets reset quickly
ore          | 4          | 3           | Moderate turnover
fuel         | 3          | 2           | Unchanged (baseline)
electronics  | 2          | 2           | Slower to replenish
ship_parts   | 1          | 1           | Scarce, slow recovery after trade
luxuries     | 1          | 1           | Scarce, high-value
```

**Why it works:** Cheap goods turn over fast — you can trade them repeatedly because supply replenishes quickly. Expensive goods are scarcer — one big trade depletes the market, forcing you to find a different route. This naturally breaks the "same loop forever" pattern for expensive goods while making cheap goods viable through volume.

**Files to modify:**
- `lib/constants/economy.ts` — Per-good production/consumption rates (or multipliers on the base rate)
- `lib/tick/processors/economy.ts` — Apply per-good rates in production/consumption step
- `lib/engine/simulator/economy.ts` — Same for sim economy

**Verify:** Run simulator. Optimal bot should show higher uniqueSystemsVisited as it's forced to rotate. ship_parts trades-per-system should decrease while food/ore trades increase.

### Proposal 5: Fuel cost scaling with reward

**Problem addressed:** Universe underutilization (#2)

**Current state:** Fuel cost to reach distant systems is high, but the reward for visiting them is identical to nearby systems. A food route 5 hops away earns the same per-unit profit as one 1 hop away.

**Change:** Systems farther from the player's starting region have slightly amplified equilibrium targets — wider supply/demand spreads.

Implementation option A (simple): Add a `remoteness` modifier to equilibrium targets during world generation. Systems with fewer connections (graph periphery) get +10-20% wider spreads.

Implementation option B (dynamic): The economy processor applies a "trade isolation" bonus — systems that haven't been traded at recently get gradually widening spreads, creating a natural incentive to explore.

**Why it works:** Creates a risk/reward tradeoff for exploration. Nearby systems are safe and consistent. Distant systems cost more fuel but offer better margins. Players who invest in fuel efficiency (freighter upgrade) are rewarded with access to these opportunities.

**Files to modify (option A):**
- `lib/engine/universe-gen.ts` — Compute remoteness score during generation
- `prisma/seed.ts` — Apply remoteness modifier to equilibrium targets
- `lib/engine/simulator/world.ts` — Same for sim world

**Verify:** Run simulator. Exploration rate should increase for all strategies. Unique systems visited should at least double for greedy/optimal.

---

## Implementation Order

| # | Proposal | Effort | Impact | Dependencies |
|---|----------|--------|--------|-------------|
| 1 | Widen price clamps | S | High | None |
| 2 | Differentiated equilibrium | M | High | None |
| 3 | Add luxury consumers | S | Medium | None |
| 4 | Production rate differentiation | M | Medium | None |
| 5 | Fuel cost scaling | M | Medium | None |

Proposals 1-3 are independent and can be implemented in any order. All three together should produce a dramatic improvement in goods diversity. Proposal 4 addresses route monotony after goods are balanced. Proposal 5 addresses universe utilization and can be done in parallel with anything.

**Recommended first pass:** Proposals 1 + 2 + 3 together (one PR). These are the highest-impact changes and directly address the root cause. Run the simulator before and after to quantify improvement.

---

## Success Criteria

Measured via simulator (seed 42, 500 ticks, all strategies):

| Metric | Current | Target |
|--------|---------|--------|
| Goods with >5% profit share (greedy) | 2 of 6 | 4+ of 6 |
| Goods with >5% profit share (optimal) | 1 of 6 | 4+ of 6 |
| Unique systems visited (greedy) | 10 (5.0%) | 25+ (12.5%) |
| Unique systems visited (optimal) | 14 (7.0%) | 25+ (12.5%) |
| Top system visit concentration (optimal) | 188 (75%) | <80 (32%) |
| Luxuries profit share (any strategy) | <1% | >5% |
| Events at traded systems (% of total) | ~5% | >20% |

These targets aren't precise goals — they're directional. The key signal is that the numbers move meaningfully in the right direction.

## Notes

- All proposals are **constants/config changes** — no new processors, no schema changes, no new game mechanics. This is pure tuning.
- Every change is testable via the simulator before touching the real game. Run `npm run simulate` before and after each proposal.
- The real game and simulator share the same engine code (`lib/engine/pricing.ts`, `lib/constants/`), so simulator results directly predict in-game behavior.
- These proposals are intentionally conservative — they adjust existing levers rather than adding new mechanics. If the numbers don't move enough, the next step is the more ambitious mechanics in [simulation-enhancements.md](./simulation-enhancements.md).
