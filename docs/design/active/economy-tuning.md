# Economy Tuning — Known Issues & Next Steps

Status: **Active** — structural issues identified, trade flow feature planned.

## Structural Issues

### 1. ~~Neutral goods are dead markets~~ — FIXED

Changed neutral equilibrium from `{ supply: 75, demand: 75 }` to `{ supply: 20, demand: 23 }`. Low volumes reflect that transit stations don't stockpile goods they don't produce/consume. Slight consumer lean (ratio 1.15) creates a subtle markup. Noise amplitude now scales proportionally to target level (`target / 75`), preventing the random walk drift that occurred when fixed ±3 noise overwhelmed the 2% reversion at low absolute values. `driftValue` no longer rounds to integers (DB columns are Float).

### 2. All systems start stagnant

New systems start at prosperity 0 (stagnant, 0.7x multiplier). Without player trade, they stay stagnant forever — 70% of normal activity. This is correct for the game design (reward trading), but it means the entire universe starts sluggish.

Trade flow (see below) should also contribute to prosperity, or systems should start at a small positive prosperity value so the universe feels alive before players arrive.

### 3. ~~Global rate constants are misleading~~ — FIXED

Removed `ECONOMY_CONSTANTS.PRODUCTION_RATE` and `CONSUMPTION_RATE`. These were never used — both the processor and simulator always provide per-economy-type rates via `resolveMarketTickEntry`. The fallback in `simulateEconomyTick` now defaults to 0 (no production/consumption) for goods without explicit rates, which is correct for neutral goods.

## Planned Feature: NPC Trade Bots

Replaced the original virtual trade flow design with stateful NPC traders. Full design: `docs/design/planned/npc-trade-bots.md`.

**Why NPCs over diffusion:** Stateful bots that travel and trade create emergent trade routes that shift naturally with market conditions. Virtual diffusion would homogenize prices; NPCs create localized, realistic competitive pressure that scales down as players arrive.

## Simulation Tools

- `npm run simulate` — 500-tick sanity check with bot strategies
- `npm run simulate -- --config <file>` — run experiment from YAML config
- `scripts/spread-calculator.ts` (not committed) — analysis tool for equilibrium target changes
