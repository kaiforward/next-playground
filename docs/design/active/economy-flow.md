# Economy System Flow

How the economy works end-to-end, focused on mechanisms and interactions rather than specific numbers.

## The Core Loop

Every tick, one region's markets update (round-robin). Each market has two values: **supply** and **demand**. Price is derived from the ratio between them — high demand against low supply means a high price, and the result is clamped to a per-tier band so the price can't run away in either direction.

```
                         EACH TICK (one region)
                         ======================

  +------------------+
  |  EVENTS          |  Runs FIRST
  |  (shocks +       |  - Shocks: one-time jolts to supply/demand
  |   modifiers)     |  - Modifiers: ongoing multipliers that persist
  +--------+---------+    across ticks (affect targets, rates, reversion)
           |
           | modified supply/demand values + active modifiers
           v
  +------------------+
  |  ECONOMY ENGINE  |  Runs SECOND
  |                  |
  |  For each market:|
  |  1. Mean revert  |  Pull supply AND demand toward equilibrium
  |  2. Add noise    |  Small random drift (volatility-scaled)
  |  3. Produce      |  Supply increases, self-limiting near ceiling
  |  4. Consume      |  Supply decreases, self-limiting near floor
  |  5. Prosperity   |  Scale production + consumption equally
  |  6. Clamp        |  Keep within [min, max] bounds
  +--------+---------+
           |
           | updated supply/demand written to DB
           v
  +------------------+
  |  TRADE FLOW      |  Runs THIRD
  |                  |
  |  For each edge   |  Goods flow along graph edges based on price
  |  in the region:  |  differences — no NPC entities, just bookkeeping.
  |  - pick the good |  The good with the steepest gradient wins,
  |    with steepest |  capped by a per-edge per-run budget.
  |    gradient      |
  |  - move from     |  Source and destination markets see the same
  |    cheap to dear |  supply/demand deltas a player trade would.
  |  - record event  |  Volume increments feed prosperity below.
  +--------+---------+
           |
           | flow events appended; per-system volume incremented
           v
  +------------------+
  |  PROSPERITY      |  Also during economy tick
  |  UPDATE          |
  |  Trade volume    |  High trade -> prosperity rises (-> booming)
  |  drives          |  No trade -> prosperity decays (-> stagnant)
  |  prosperity      |  Events can push into crisis (below zero)
  +--------+---------+
           |
           | prosperity value persisted per system
           v
  +------------------+
  |  PLAYER TRADES   |  Anytime (not tick-locked)
  |                  |
  |  Buy:  supply -  |  Direct impact on the market they trade at
  |  Sell: supply +  |  Small demand signal (50% of volume)
  +------------------+
```

## What Each Mechanism Does

### Mean Reversion — "Gravity toward normal"

Every market has an equilibrium target (where supply/demand "wants" to be). Each tick, the gap closes by 2%. This is a gentle stabilizing force representing local commerce — not the main correction mechanism.

```
  current supply: 50          target: 160
  |---------X--------------------------------------------------T---|
            ^                                                  ^
            supply pulls toward target each tick (2% of gap)
```

At 2%, a market abandoned for 100 ticks closes ~87% of the gap. Slow enough that player trades have lasting impact (dozens of ticks), fast enough that truly abandoned systems eventually normalize.

Events can **dampen** reversion (making markets sluggish and volatile) or targets can shift (changing what "normal" means).

### Self-Limiting Production & Consumption — "Physical limits"

Production and consumption don't run flat-out — they each scale with how much room is left in the market. The curve is gentle (square-root shaped) rather than linear, so the effect kicks in gradually rather than all at once near the extremes.

```
  PRODUCTION                           CONSUMPTION
  ~~~~~~~~~~                           ~~~~~~~~~~~
  At floor:   full rate (warehouses    At floor:   zero (nothing to
              empty, ramp up)                      consume)
  At mid:     ~70% rate                At mid:     ~54% rate
  At ceiling: zero (warehouses full)   At ceiling: full rate
```

This prevents floor/ceiling railing without relying on reversion. Markets find their own balance point — as supply drops, consumption slows and production accelerates. As supply rises, production slows and consumption accelerates.

### Production & Consumption — "The push and pull"

Each economy type (Agricultural, Extraction, Refinery, etc.) produces specific goods and consumes others. Per-good rates (1-5 units/tick) are applied every tick, scaled by self-limiting and prosperity.

```
  AGRICULTURAL SYSTEM
  ===================
  Produces: food (5/tick), textiles (4/tick)  -> supply goes UP
  Consumes: water (4/tick), machinery (1/tick),
            chemicals (3/tick), medicine (1/tick)  -> supply goes DOWN

  What this creates:
  - Produced goods: high supply, low demand -> LOW prices (cheap here)
  - Consumed goods: low supply, high demand -> HIGH prices (expensive here)
  - This price spread IS the trade opportunity
```

The asymmetry is intentional: each good has 1-2 producer types but 3-6 consumer types. Universe-wide, consumption pressure exceeds production. **Player trade is meant to bridge this gap** — moving goods from where they're cheap (produced) to where they're expensive (consumed).

### Self-Sufficiency — "Not all consumers are equal"

Different economy types have different self-sufficiency levels for goods they consume. This creates price variety between systems consuming the same good.

```
  WATER PRICES AT DIFFERENT CONSUMERS
  ====================================
  Agricultural (s=0.5):  has irrigation -> moderate water prices
  Refinery (s=0.2):      some recycling -> expensive but not desperate
  Tech (s=0.1):          imports nearly everything -> very expensive

  Traders must decide WHICH consumers to serve — not all are equally profitable.
```

### Prosperity — "Player-driven activity level"

Each system has a prosperity value from -1 to +1. It amplifies both production AND consumption equally — a booming system is more active overall, not corrected in one direction.

```
  PROSPERITY FLOW
  ===============

  Player trade at system
       |
       v
  Prosperity rises ---------> Both production AND consumption increase
       |                              |
       v                              v
  More goods flowing              More activity, more opportunities
       |
  No trade for a while
       |
       v
  Prosperity decays --------> Activity slows (stagnant = 0.7x rates)
       |
       v
  Supply slowly accumulates -> Cheap goods attract traders -> cycle repeats


  Events can push below zero:
  +-----------+--------------+----------+
  | Prosperity| Multiplier   | Label    |
  +-----------+--------------+----------+
  | -1 (crisis)| x0.3        | Crisis   |  <- event-driven only
  |  0         | x0.7        | Stagnant |  <- natural resting point
  | +1 (boom)  | x1.3        | Booming  |  <- sustained player trade
  +-----------+--------------+----------+
```

### Events — "External disruptions"

Events inject chaos into the system in two ways:

```
  EVENT SPAWNS (or advances phase)
       |
       +---> SHOCKS: One-time immediate hits
       |     "A meteor destroyed 40% of ore supply"
       |     Directly modifies supply or demand values right now
       |
       +---> MODIFIERS: Ongoing effects while event is active
             "Trade route disrupted -- reversion dampened, production slowed"
             Multipliers that compound with other modifiers each tick:
               - Shift equilibrium targets (what "normal" means)
               - Scale production/consumption rates
               - Dampen mean reversion (markets stay disrupted longer)
```

### Edge-Flow Trade Simulation — "The background pressure"

Edge flow is the simulated inter-system trade that runs without players. For each connection edge within the region being processed, the simulator picks the good with the largest price difference between the two ends and moves some of it from the cheap side to the expensive side.

```
  SYSTEM A (cheap)  --- edge ---  SYSTEM B (expensive)
       |                                  ^
       |   the price gradient picks       |
       |   the good; the per-edge budget, |
       |   destination headroom, and      |
       |   source surplus cap the move    |
       |                                  |
       +-------- goods move A -> B -------+
       supply drops, demand ticks up      supply rises, demand ticks down
       (mirrors a player buy)             (mirrors a player sell)
```

Properties:
- **Threshold-gated**: small gradients don't trigger flow (no equilibrium churn).
- **Budget-capped**: per-edge, per-run cap on quantity moved.
- **Reuses trade math**: supply/demand deltas are identical to a player trade — flow volume increments the same accumulator that prosperity reads, so edge flow and player trade contribute symmetrically.
- **One good per edge per run**: steepest-gradient good wins; other goods get their turn when their gradient becomes the steepest.
- **Player-displaced**: when players are active in a region, the budget scales down — players' own trade pressure replaces the simulation's.

Chains emerge naturally: a system pulling food from a neighbor lowers that neighbor's supply, which then pulls from *its* neighbor. Real supply chains without explicitly programming them.

Full design in [trade-simulation.md](./trade-simulation.md).

### Player Trading — "Direct intervention"

Players move goods between systems on top of the edge-flow background, with the same per-market effect.

```
  AGRICULTURAL SYSTEM              INDUSTRIAL SYSTEM
  (food is cheap)                  (food is expensive)
       |                                  ^
       |  Player buys food here           |  Player sells food here
       |  supply -= quantity              |  supply += quantity
       |  (price goes up slightly)        |  (price goes down slightly)
       |                                  |
       +---------> CARGO HOLD -----------+
```

Player trade also drives prosperity — actively traded systems become more active (booming), while neglected systems slow down (stagnant) and accumulate cheap goods that eventually attract traders.

### Price Derivation — "Simple ratio"

Price is calculated on-read, not stored. It's the good's base price scaled by the demand-to-supply ratio — high demand against low supply pushes the price up, glut pulls it down. Each tier clamps how far that ratio can swing so wild fluctuations don't produce absurd numbers:

```
  T0 (raw):       0.5x - 2.0x base price
  T1 (processed): 0.5x - 2.5x base price
  T2 (advanced):  0.5x - 3.0x base price
```

## How Systems Layer Together

```
  LAYER 1: Base Identity (static)
  ================================
  Economy type -> what you produce/consume and at what rate
  Self-sufficiency -> how dependent on imports for each consumed good
  System traits -> production bonuses for specific goods
  Region government -> volatility scaling, consumption boosts

  LAYER 2: Tick Evolution (each tick)
  ====================================
  Mean reversion     -> gentle pull toward equilibrium (2%/tick)
  Noise              -> small random variation (life)
  Production         -> supply grows, self-limiting near ceiling (1-5/tick)
  Consumption        -> supply shrinks, self-limiting near floor (1-4/tick)
  Prosperity         -> scales both production + consumption (0.3x to 1.3x)
  Edge-flow trade    -> goods flow between connected systems by price
                        gradient (background trade pressure, no entities)

  LAYER 3: Disruptions (unpredictable)
  =====================================
  Event shocks       -> sudden supply/demand shifts
  Event modifiers    -> temporarily change how Layer 2 operates
                        (shift targets, scale rates, dampen reversion)

  LAYER 4: Player Agency (real-time)
  ===================================
  Trading            -> direct buy/sell on top of edge-flow background
                        (also displaces edge flow in active regions)
  Prosperity impact  -> sustained trade boosts system activity
```
