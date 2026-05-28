# Economy Rework — Design Document

Status: **Design** — agreed direction, implementation pending.

Supersedes: `economy-tuning.md` (analysis of the problems this rework solves).
Reference: `economy-flow.md` (current system flow — will be updated after implementation).

## Why

The economy has several structural problems that can't be solved by tuning numbers:

1. **Consumed goods rail at the price floor.** Consumption is a constant drain with no self-limiting feedback. Even with 50 active traders in 200 systems, supply drifts negative across all goods. Markets generate infinite opportunity and never saturate.

2. **The economy cycle is bugged by design.** A single correction dial per system can't fix produced goods (oversupplied) and consumed goods (undersupplied) in opposite directions. When oversupply triggers "boom" (consume more, produce less), it helps drain surplus but *worsens* the consumed goods shortage. The cycle actively works against its own goal.

3. **Trading is too easy.** In simulation, greedy/optimal bots achieve 0% idle time even at 50 bots / 200 systems. Every system has extreme price spreads. There's no scarcity of opportunity — players can't make a bad trade. Going from 20 to 50 bots only reduced profit by ~15-20%.

4. **No price variety between systems.** All systems of the same economy type have identical equilibrium targets. Every Agricultural system has the same cheap food, every Industrial system has the same expensive metals. There's no reason to prefer one Agricultural system over another.

5. **Reversion is doing the wrong job.** At 5%, it's the dominant stabilizing force — fighting consumption to prevent floor-railing. It should be a gentle background hum representing local commerce, not the main correction mechanism.

## Design Principles

These guide all the changes below:

- **Player trade is THE correction mechanism.** The economy should have structural imbalances that players resolve by moving goods. Without trade, markets should drift toward extremes. With trade, they should stabilize.
- **Self-limiting prevents railing.** Physical limits (can't consume what isn't there, can't produce when warehouses are full) prevent markets from permanently sitting at floor/ceiling.
- **The cycle creates temporal variety, not corrections.** Systems should feel different at different times, driven by player activity. The cycle is "weather" not "thermostat."
- **Production always outstrips reversion.** Even in the worst conditions, production should be net positive. This ensures goods accumulate over time and eventually create trade opportunities. If reversion is stronger than production, goods never become cheap enough to attract traders.

## Changes

### 1. Self-Limiting Production and Consumption

**Problem:** Production and consumption are constant rates regardless of current supply levels. Consumption drains supply to the floor and stays there. Production fills supply to the ceiling and stays there.

**Solution:** Scale rates based on how much room there is to produce/consume.

```
Consumption:
  effectiveRate = baseRate * (supply - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL)

  At floor (supply = 10):   rate * 0/490 = 0       (nothing to consume)
  At equilibrium (150):     rate * 140/490 = ~0.29x (moderate)
  At ceiling (supply = 500): rate * 490/490 = 1.0x  (full rate)

Production:
  effectiveRate = baseRate * (MAX_LEVEL - supply) / (MAX_LEVEL - MIN_LEVEL)

  At floor (supply = 10):   rate * 490/490 = 1.0x  (full rate, warehouses empty)
  At equilibrium (150):     rate * 350/490 = ~0.71x (moderate)
  At ceiling (supply = 500): rate * 0/490 = 0       (warehouses full)
```

This creates natural oscillation: as supply drops, consumption slows and production accelerates. As supply rises, production slows and consumption accelerates. Markets find their own balance point without needing external correction.

**Decision:** Use a **square root curve** rather than linear. Linear scaling is too aggressive at mid-range (consumption at only 29% at equilibrium would make markets boringly stable). The square root curve keeps rates higher through mid-range and only drops sharply near extremes:

```
Square root curve:
  Consumption: effectiveRate = baseRate * sqrt((supply - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL))
  Production:  effectiveRate = baseRate * sqrt((MAX_LEVEL - supply) / (MAX_LEVEL - MIN_LEVEL))

  Consumption at floor (10):       rate * sqrt(0)    = 0       (nothing to consume)
  Consumption at equilibrium (150): rate * sqrt(0.29) = ~0.54x  (moderate, not dead)
  Consumption at 250:               rate * sqrt(0.49) = ~0.70x  (healthy activity)
  Consumption at ceiling (500):     rate * sqrt(1.0)  = 1.0x   (full rate)
```

This prevents railing while keeping markets active enough to generate meaningful price spreads.

### 2. Reversion Rate Reduction

**Problem:** At 5%, reversion is the dominant stabilizing force. It fights consumption, erases player trade impact within a few ticks, and makes all markets converge toward the same equilibrium.

**Solution:** Reduce to 1-2%.

**Rationale:** Reversion represents the "local invisible economy" — people on planets trading with each other, local industry processing goods. It's not the main correction mechanism. With self-limiting rates handling floor/ceiling prevention and player trade handling redistribution, reversion just needs to prevent abandoned systems from freezing at stale values indefinitely.

At 1%, a system abandoned for 100 ticks would close ~63% of the gap to equilibrium. That feels right — slow enough that player trades have lasting impact (dozens of ticks), fast enough that truly abandoned systems eventually normalize.

### 3. Cycle Redesign — Prosperity System

**Problem:** The current cycle is a corrective feedback loop (oversupply → boost consumption, undersupply → boost production). This creates a single-lever tug-of-war that helps produced goods but hurts consumed goods. All systems drift to the same state (Expansion, 98.5%).

**Solution:** Replace with a player-driven prosperity meter.

#### How it works

Each system has a `prosperity` value from -1.0 (crisis) to +1.0 (booming).

**Driving transitions:**
- Player trade volume at the system drives prosperity upward (0 → +1)
- Without trade, prosperity decays slowly toward 0 (natural resting state)
- Boom requires active maintenance — players must keep trading to sustain it
- Stagnant (0) is the natural state for unvisited systems, not a penalty
- Only **events** can push prosperity below 0 (famine, blockade, plague, etc.)
- When the triggering event ends, prosperity naturally recovers toward 0

```
  +1.0 (Booming)  <- requires sustained player trade to reach and maintain
       ^ player trade pushes up
       |
   0.0 (Stagnant) <- natural resting point, gravity always pulls here
       |
       v only events push below zero
  -1.0 (Crisis)   <- famine, blockade, plague — recovers when event ends
```

The natural player-driven range is 0 to +1. The -1 to 0 range is reserved for event-driven crises, keeping the two drivers cleanly separated.

**What prosperity does:**
- Boom amplifies both production AND consumption equally
- Both sides scale together, so the cycle doesn't fight itself
- A booming system is more active overall — more goods flowing in and out

```
  Prosperity | Production Mult | Consumption Mult | Label
  -----------+-----------------+------------------+----------
  -1.0       | x0.3            | x0.3             | Crisis (event-driven only)
  -0.5       | x0.5            | x0.5             | Disrupted (event-driven only)
   0.0       | x0.7            | x0.7             | Stagnant
   0.5       | x1.0            | x1.0             | Active
   1.0       | x1.3            | x1.3             | Booming
```

**Tunables (iterate during implementation with simulator):**

- **Stagnant multiplier (0.7x):** Goods still accumulate at 0.7x, just slower. Neglected systems slowly build up cheap goods and eventually attract traders. If too low, systems feel dead. Start at 0.7x.
- **Boom multiplier (1.3x):** Modest amplification. A booming Agricultural system produces food at 5 * 1.3 = 6.5/tick. Could go 1.5x for more drama but risks oversaturation. Start at 1.3x.
- **Decay rate:** How fast prosperity decays without trade. Too fast = systems can never boom with occasional trade. Too slow = systems stay booming after traders leave. Start at 0.01-0.02 per tick (returns to stagnant in ~50-100 ticks).
- **Trade volume → prosperity mapping:** How much trade pushes prosperity up. Define a "target trades per tick" constant for a healthy system, scale gain relative to that. Must feel achievable at realistic player counts (1 trade per 10 ticks per system with 20 players in 200 systems).
- **Crisis multipliers:** How severely events suppress activity. Start at 0.3x for full crisis (-1.0), linearly interpolated.

#### Gameplay implications

**For producers in boom:**
- Production UP → more goods available → cheaper prices
- But consumption also UP → goods drain faster
- Net effect: more volume, moderate prices. Good for bulk traders.
- Heavy trade eventually depletes supply → prices rise → traders leave → prosperity decays → supply rebuilds

**For stagnant producers (no trade):**
- Production at 0.7x → goods still accumulate, just slower
- Consumption at 0.7x → less drain
- Over many ticks, supply builds up, prices drop
- Eventually becomes attractive for traders who discover it → trading begins → prosperity rises
- This is the natural "bust recovery" — it happens through accumulation, not a corrective mechanism

**What creates interesting price variety:**
- Economy type specialization (structural — which goods are produced/consumed)
- Prosperity differences between systems (temporal — some are booming, some stagnant)
- Events (disruptive — shocks and modifiers)
- Government type (regional — different rules per region)
- Equilibrium granularity (structural — see section 4)

### 4. Equilibrium Granularity

**Problem:** All systems of the same role (producer vs consumer) have the same equilibrium targets for a given good. An Agricultural system consuming water has the same target as an Industrial system consuming water. This means every consumer of the same good has identical prices, reducing variety.

**Solution:** Per-economy-type equilibrium targets for consumed goods.

The idea: different economy types have different relationships with the goods they consume. An Agricultural system that consumes water should have higher natural supply (irrigation infrastructure, local wells) than a Tech system that consumes water (they import everything).

**Current state:**
```
Water equilibrium:
  produces:  { supply: 375, demand: 65 }   (Extraction systems)
  consumes:  { supply: 65, demand: 350 }   (ALL consumer types — same target)
```

**Proposed:**
```
Water equilibrium:
  produces:  { supply: 375, demand: 65 }   (Extraction systems)
  consumes:
    agricultural: { supply: 200, demand: 250 }   (irrigation, local wells)
    refinery:     { supply: 120, demand: 300 }   (process cooling)
    industrial:   { supply: 80, demand: 330 }    (heavy industrial use)
    tech:         { supply: 60, demand: 350 }    (pure import dependency)
    core:         { supply: 150, demand: 280 }   (municipal infrastructure)
```

This means water at an Agricultural system is moderately priced (they have some local supply), while water at a Tech system is very expensive (they have almost none). Traders must decide which consumers to serve — not all are equally profitable.

**Decision:** Use a **self-sufficiency factor** (0.0 to 1.0) per economy-type per consumed good. This reduces 144 numbers to 72 single intuitive values, and derives actual supply/demand targets from the per-good producer/consumer base values that already exist.

```
selfSufficiency = 0.0 (fully dependent on imports) to 1.0 (meets own needs)

consumeTarget.supply = baseConsumeSupply + s * (produceSupply - baseConsumeSupply)
consumeTarget.demand = baseConsumeDemand - s * (baseConsumeDemand - produceDemand)
```

**Example — Water (producer target: supply 375, demand 65; consumer base: supply 65, demand 350):**

```
  Agricultural (s=0.6, has irrigation/wells):
    supply = 65 + 0.6 * (375-65) = 251    demand = 350 - 0.6 * (350-65) = 179
    → Water is moderately priced, not desperate

  Tech (s=0.1, almost no local supply):
    supply = 65 + 0.1 * (375-65) = 96     demand = 350 - 0.1 * (350-65) = 321
    → Water is very expensive, nearly as scarce as today

  Refinery (s=0.2, some process water recycling):
    supply = 65 + 0.2 * (375-65) = 127    demand = 350 - 0.2 * (350-65) = 293
    → Water is expensive but not desperate
```

**Intuition for the number:**
- `s = 0.0` → "We have none of this, we import everything" (current consumer behavior)
- `s = 0.3` → "We have some local supply but still need imports"
- `s = 0.6` → "We're mostly self-sufficient, imports are a bonus"
- `s = 1.0` → "We're basically a producer" (target matches producer levels)

The data definition would look like:
```
SELF_SUFFICIENCY: Record<EconomyType, Record<goodId, number>> = {
  agricultural: { water: 0.6, machinery: 0.0, chemicals: 0.1, medicine: 0.0 },
  extraction:   { food: 0.3, fuel: 0.1, machinery: 0.0, textiles: 0.2 },
  refinery:     { ore: 0.1, water: 0.2, food: 0.3 },
  industrial:   { metals: 0.1, electronics: 0.0, chemicals: 0.1, fuel: 0.1, ... },
  tech:         { metals: 0.0, chemicals: 0.1, luxuries: 0.0, water: 0.1, food: 0.2 },
  core:         { food: 0.4, textiles: 0.3, electronics: 0.1, medicine: 0.1, ... },
}
```

Specific factor values are tunables — iterate during implementation.

### 5. Price Spread Narrowing

**Problem:** Current equilibrium targets create 3-5x supply differences between producers and consumers (e.g. producer supply target 375 vs consumer supply target 65). Combined with the price formula `basePrice * demand/supply`, this creates extreme price differentials at every system. Trading is trivially profitable everywhere.

**Solution:** Narrow the spread by raising consumer supply targets and/or lowering producer supply targets.

This interacts heavily with section 4 (equilibrium granularity) — once we have per-economy-type targets, the spread naturally varies. Some consumers are nearly self-sufficient (narrow spread, small profit margin), others are fully dependent (wide spread, high profit).

This interacts with self-sufficiency factors — once different consumers have different targets, the spread naturally varies per system. However, the **base** spread (the s=0.0 fully-dependent case) may still need narrowing.

**Tunable (iterate during implementation):** How narrow should the base (s=0.0) spread be? Currently ~5:1 (375 vs 65 supply). Options:
- 3:1 (e.g. 300 vs 100) — still profitable, less extreme
- 2:1 (e.g. 250 vs 125) — moderate, requires good route planning
- Variable by good tier — tier 0 (basics) have narrow spreads, tier 2 (luxuries) have wide spreads

Tier-based spreads make gameplay sense: basic goods like food and water are available everywhere (narrow spread, thin margins, high volume), while luxuries and weapons are scarce (wide spread, fat margins, low volume). This gives players a progression from "safe thin-margin bulk runs" to "risky high-margin specialty runs."

### 6. Simulation Improvements

**Problem:** Current simulation runs 2-4 bots, which is unrealistic. The economy can't be validated without realistic trade pressure.

**Changes:**
- Default quick-run should use more bots (10-20 instead of 4)
- Experiment configs for density testing: 20 bots / 200 systems (baseline), 50 bots / 200 systems (saturation)
- Fix or rethink the `nearest` strategy — currently 100% idle in all tests, which means it's not testing anything useful

**Validation targets for "economy feels right":**
- Greedy bots should have 5-15% idle time at 20 bots / 200 systems (some ticks with no good route)
- Doubling bot count should meaningfully reduce profit per bot (30-50% drop, not 15%)
- Supply drift at end of simulation should be mixed (some goods positive, some negative) not uniformly negative
- Price dispersion should vary by system — some systems have great deals, some are mediocre

## Summary of All Changes

| # | Change | Why |
|---|--------|-----|
| 1 | Self-limiting production/consumption | Prevent floor/ceiling railing without relying on reversion |
| 2 | Reversion rate 5% → 1-2% | Local invisible economy, not correction mechanism. Player trades last longer. |
| 3 | Cycle → Prosperity system (-1 to +1, player+event driven) | Create temporal variety. Boom amplifies both sides equally. No corrective tug-of-war. Events drive crisis states. |
| 4 | Per-economy-type equilibrium targets | Price variety between systems of different types consuming the same good |
| 5 | Narrower price spreads (possibly tier-based) | Trading shouldn't be trivially profitable everywhere |
| 6 | More realistic simulation bot counts | Can't validate economy with 2-4 bots |

## Implementation Order

Suggested phasing — each phase is independently testable:

**Phase 1: Self-limiting + reversion reduction**
- Implement percentage-based production/consumption scaling
- Reduce reversion to 1-2%
- Run snapshot + simulation to verify floor/ceiling railing is gone
- Minimal code change, big impact

**Phase 2: Prosperity system**
- Replace cycle computation with trade-volume-driven prosperity
- Update cycle phases/multipliers to amplify equally
- Update UI badge
- Run simulation to verify variety between systems

**Phase 3: Equilibrium granularity + price spreads**
- Define per-economy-type equilibrium targets (or self-sufficiency factors)
- Adjust base spreads (possibly tier-based)
- Run simulation to verify trading difficulty and variety

**Phase 4: Simulation improvements**
- Bump default bot count
- Fix nearest strategy
- Define validation targets and create regression experiments

## Decisions Made

1. **Self-limiting curve shape:** Square root curve. Keeps rates active mid-range, only drops sharply near extremes. (Section 1)
2. **Prosperity range:** -1 to +1. Natural range is 0 to +1 (player-driven). Only events push below 0 (crisis). Recovers toward 0 when event ends. (Section 3)
3. **Equilibrium data format:** Self-sufficiency factor (0-1 per economy-type per good). Derives targets from existing per-good base values. (Section 4)

## Tunables (Iterate During Implementation)

These are values we expect to adjust using the simulator. Start with the recommended defaults and tune based on bot idle rates, profit curves, and price dispersion:

- **Reversion rate:** 1% or 2%? (Section 2)
- **Stagnant multiplier:** 0.7x? 0.5x? (Section 3)
- **Boom multiplier:** 1.3x? 1.5x? (Section 3)
- **Crisis multiplier:** 0.3x? 0.5x? (Section 3)
- **Prosperity decay rate:** 0.01? 0.02 per tick? (Section 3)
- **Trade volume → prosperity mapping:** What's "enough trade" to push toward boom? (Section 3)
- **Self-sufficiency factor values:** Per economy-type per good (Section 4)
- **Base price spread:** 3:1? 2:1? Tier-based? (Section 5)

## Evidence

### Simulation: 20 bots / 200 systems / 2000 ticks
- Greedy/optimal: ~2,200-2,700 cr/tick, 0% idle, freighter by tick 14-28
- Every good has negative supply drift and positive demand drift (consumption wins everywhere)
- Luxuries dominate profits (25-45% of all earnings)

### Simulation: 50 bots / 200 systems / 2000 ticks
- Greedy/optimal: ~1,800-2,300 cr/tick, still 0% idle
- 2.5x more competition → only 15-20% profit reduction (economy doesn't saturate)
- Random bots go from "mostly working" to "mostly broken" (easy trades snapped up)
- One optimal bot hit 23% idle — only sign of any saturation

### Elite Dangerous reference
- Uses automatic supply regeneration (similar to our reversion)
- Has NPC trade routes for inter-system redistribution
- Economy states (Boom, Bust, Famine) are driven by player activity
- Boom = ~80% more supply available (amplifies, doesn't correct)
- Stations restock automatically over time even without player trade
