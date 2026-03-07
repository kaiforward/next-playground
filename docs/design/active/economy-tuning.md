# Economy Tuning — Trade Margins & Progression

Status: **Design Discussion** — values identified as broken, approach agreed, implementation pending.

## Problem Statement

Trade margins are wildly too generous. A single 50-cargo trade can generate enough profit to buy multiple ships. The equilibrium spread between producing and consuming systems creates 5-35x price ratios, when we need ~1.4-1.6x for meaningful competition at realistic player counts.

This makes progression trivial — the game has no economic tension.

## Current State (Committed on `feature/economy-sim-update`)

### What was built (Phases 1-3)

1. **Self-limiting production/consumption** — rates scale with available supply, preventing floor/ceiling railing
2. **Trade-driven prosperity** — replaces the old boom/bust cycle with a prosperity score driven by actual trade activity
3. **Per-good equilibrium targets** — each good has custom supply/demand targets for producing vs consuming systems
4. **Per-economy-type self-sufficiency** — different economy types have different consumption floor factors

### Phase 4 simulation improvements (committed)

1. **Nearest strategy rewritten** — was 100% idle (2-hop hard cap found no trades). Now searches all reachable systems with quadratic distance penalty: `profit / (1 + travelDuration)^2`
2. **Round-robin bot spawning** — bots spread across all systems instead of clustering at one start
3. **Trade impact factor 5x** — increased from 0.1 to 0.5 so trades actually move markets
4. **Per-strategy aggregate metrics** — simulation output shows one row per strategy (avg/min/max credits, idle rate, exploration rate) instead of one row per bot
5. **Experiment configs** — YAML configs for saturation testing (50-in-50, 100-in-30, sticky-markets)

## Simulation Findings

### Saturation only kicks in at extreme density

| Scenario | Bots/System | Greedy Idle | Nearest Idle | Optimal Idle |
|----------|-------------|-------------|--------------|--------------|
| 50 in 50 | 1.0 | ~10% | ~5% | ~8% |
| 100 in 30 | 3.3 | ~86% | ~25% | ~45% |

At 1 bot per system, markets refill faster than bots can drain them. Competition only becomes visible at 3+ bots/system. For a game targeting maybe 10-50 concurrent players in a 600-system universe, that's nowhere near enough density for natural competition.

### Strategy differentiation works well under pressure

At high density, greedy collapses first (picks global best route, everyone converges), nearest survives best (local focus, less contention), and optimal sits in between. This is good emergent behavior that rewards different playstyles.

### The real problem: margins are absurdly high

From the spread calculator analysis:

| Good | Buy Price | Sell Price | Margin/Unit | Profit per 50 cargo |
|------|-----------|-----------|-------------|---------------------|
| Water (base 25) | 4.2 | 140.0 | 135.8 | 6,790 |
| Luxuries (base 150) | 75.0 | 400.0 | 325.0 | 16,250 |

A single trade of water (the cheapest good!) generates enough to buy two Light Freighters. One trade of luxuries buys five. The entire ship progression (Shuttle -> Light Freighter -> Freighter -> Bulk Hauler) can be completed in 3-4 trades.

### Proposed tighter spreads

With equilibrium targets producing ~1.3x price ratios instead of 5-35x:

| Good | Buy Price | Sell Price | Margin/Unit | Profit per 50 cargo |
|------|-----------|-----------|-------------|---------------------|
| Water (base 25) | 19.9 | 31.4 | 11.5 | 575 |
| Luxuries (base 150) | 129.5 | 184.6 | 55.1 | 2,755 |

This is better but still only ~6 trades to afford the Light Freighter at 500 starting credits. And that's the BEST route — average routes would be 10-15 trades.

## Key Insight: All Values Are Linked

Trade margins and ship prices are not independent knobs. They form a progression curve:

```
trades_to_milestone = ship_price / (margin_per_unit * cargo_capacity - fuel_cost)
```

Changing any one variable shifts the whole curve. We can't tune margins without also considering:

- **Ship prices** — Shuttle (free), Light Freighter (3,000), Freighter (12,000), Bulk Hauler (35,000)
- **Cargo capacity** — 50, 80, 200, 400
- **Fuel costs** — ~30cr per round trip currently
- **Base prices** — determine capital requirements (can you fill your cargo hold?)
- **Future purchases** — facilities, upgrades, etc. will also need price anchoring

### The progression curve question

How many trades should each milestone take? This is the design anchor that everything else derives from.

**Draft targets** (not yet agreed):

| Milestone | Current (~trades) | Proposed range |
|-----------|-------------------|----------------|
| Shuttle -> Light Freighter | 1 | 15-25 |
| Light Freighter -> Freighter | 1-2 | 30-50 |
| Freighter -> Bulk Hauler | 2-3 | 40-60 |

The key tension: too few trades and progression is trivial, too many and the game feels grindy. The sweet spot depends on how long a "trade" takes in real time (travel + market browsing + route planning).

### Proposed approach

1. **Anchor to progression curve** — decide trades-per-milestone first
2. **Derive margins** — work backwards from progression targets to required margin/unit
3. **Set equilibrium spreads** — calculate supply/demand ratios that produce those margins
4. **Adjust ship prices if needed** — prices should be relational to trade income, not arbitrary
5. **Validate with simulation** — run saturation tests to confirm competition works at target density

Ship prices could be expressed as multiples of "best average profit per trade" to stay self-consistent as we tune margins.

## Spread Calculator

`scripts/spread-calculator.ts` (not committed) — analysis tool that:
1. Calculates buy/sell prices from equilibrium supply/demand targets
2. Shows margin per unit and profit per 50 cargo for each good
3. Simulates early-game progression with capital constraints (picks best affordable good each trip, deducts fuel)

Useful for testing equilibrium target changes before touching game code.

## Simulation Tools

- `npm run simulate` — 500-tick sanity check with bot strategies
- `npm run simulate -- --config experiments/examples/extreme-density.yaml` — high-density stress test
- `npm run simulate -- --config experiments/examples/sticky-markets.yaml` — low-reversion variant
- `npm run simulate -- --config experiments/examples/saturation-scaling.yaml` — 1:1 bot-to-system ratio

## Next Steps

1. **Agree on progression curve** — how many trades per ship milestone
2. **Decide if ship prices move** — or only margins
3. **Calculate target equilibrium spreads** — using the spread calculator
4. **Implement in `lib/constants/goods.ts`** — update per-good equilibrium targets
5. **Reseed dev database** — current universe has pre-change equilibrium values
6. **Validate with simulation** — confirm competition at 1-bot-per-10-systems density
7. **Clean up** — remove spread-calculator.ts, delete stale worktree
