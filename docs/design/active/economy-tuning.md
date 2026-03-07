# Economy Tuning — Known Issues & Next Steps

Status: **Active** — structural issues identified, trade flow feature planned.

## Structural Issues

### 1. Neutral goods are dead markets

For goods a system neither produces nor consumes, equilibrium is `{ supply: 75, demand: 75 }`. With 2% reversion, price = `basePrice * (75/75)` = exactly basePrice. Only noise creates any variation (+/-3 random walk).

In a 600-system universe, each system stocks 12 goods but only produces 1-2 and consumes 3-8. That leaves 3-8 goods per system sitting at flat basePrice. That's a lot of dead inventory and wasted DB rows.

**Options:**
- (a) Remove neutral goods from stations entirely — only stock produced + consumed goods. Simplest, reduces DB size.
- (b) Give neutral markets a slight consumer lean (supply 70, demand 80) — creates small opportunities
- (c) Leave them — they serve as price anchors for passing traders

Recommendation: (a) for a clean system, or (b) if we want every station to stock everything for UI simplicity.

### 2. All systems start stagnant

New systems start at prosperity 0 (stagnant, 0.7x multiplier). Without player trade, they stay stagnant forever — 70% of normal activity. This is correct for the game design (reward trading), but it means the entire universe starts sluggish.

Trade flow (see below) should also contribute to prosperity, or systems should start at a small positive prosperity value so the universe feels alive before players arrive.

### 3. Global rate constants are misleading

`ECONOMY_CONSTANTS.PRODUCTION_RATE` (1.5) and `CONSUMPTION_RATE` (1.0) appear important but are never used in the live game. They only serve as fallbacks in `simulateEconomyTick` when `entry.productionRate` is undefined — which both the processor and simulator always provide via `resolveMarketTickEntry`.

**Fix:** Either remove global rate constants or explicitly document them as fallbacks for goods with no per-economy-type rate.

## Planned Feature: Trade Flow

### Problem

The economy requires ~3 bots/system density for meaningful competition. With potentially 10-50 real players in a 600+ system universe, natural player density is far too low. Markets need baseline competitive pressure.

### Solution: Inter-system trade flow

A new tick processor that simulates NPC merchant activity by moving goods between connected systems based on price differentials. Runs during the economy tick alongside production/consumption.

### Design considerations

**Virtual trader model, not pure diffusion.** Pure supply diffusion (move supply proportionally to price gap) would flatten all prices and kill trade margins. Instead, simulate small trades:
- Source system: supply decreases, small demand signal
- Destination system: supply increases
- Volume calibrated to ~3 bots/system equivalent pressure

**Key parameters to calibrate:**
- Flow rate per edge per tick
- Price differential threshold (minimum gap to trigger flow)
- Maximum flow per system per tick (prevent drain)
- Whether flow contributes to prosperity

**Risks:**
- Too much flow = homogenized prices, no trade opportunities
- Too little flow = irrelevant, markets still stagnate
- Flow across region boundaries vs intra-region only

### Implementation sketch

```
For each system in the current region (round-robin):
  For each connected neighbor:
    For each good at both stations:
      priceHere = demand/supply at this system
      priceThere = demand/supply at neighbor
      if priceThere > priceHere * threshold:
        flow = min(available, maxFlow) * (priceThere/priceHere - 1)
        source.supply -= flow
        dest.supply += flow
```

## Simulation Tools

- `npm run simulate` — 500-tick sanity check with bot strategies
- `npm run simulate -- --config <file>` — run experiment from YAML config
- `scripts/spread-calculator.ts` (not committed) — analysis tool for equilibrium target changes
