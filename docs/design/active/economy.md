# Economy System

The economy is a self-limiting market simulation where supply and demand drift toward equilibrium, modified by production, consumption, prosperity, random noise, and events. Prices emerge naturally from supply/demand ratios. Player trade is the primary correction mechanism for inter-system imbalances.

---

## Goods

12 goods organized in 3 tiers. Tiers create a natural progression: cheap high-volume goods for early game, expensive scarce goods for late game.

### Tier 0 — Raw Materials

High volume (150-160 supply), widest ratio spread (~20%). Cheap per unit, always available. A shuttle pilot with 500cr fills cargo with these.

| Good | Base Price | Volatility | Hazard | Price Range |
|---|---|---|---|---|
| Water | 25 | 0.5 | none | 0.5x-2.0x |
| Food | 30 | 0.7 | none | 0.5x-2.0x |
| Ore | 35 | 0.6 | none | 0.5x-2.0x |
| Textiles | 35 | 0.8 | none | 0.5x-2.0x |

### Tier 1 — Processed Goods

Medium volume (78-90 supply), moderate ratio spread (~17-20%). Better per-unit margin but needs more capital. Mid-game income.

| Good | Base Price | Volatility | Hazard | Price Range |
|---|---|---|---|---|
| Fuel | 35 | 1.0 | low | 0.5x-2.5x |
| Metals | 45 | 0.8 | none | 0.5x-2.5x |
| Chemicals | 55 | 1.2 | low | 0.5x-2.5x |
| Medicine | 65 | 1.5 | none | 0.5x-2.5x |

### Tier 2 — Advanced Goods

Scarce (38-45 supply), tightest ratio spread (~12-17%). Highest absolute margin per unit but can't fill cargo from one system. Late-game income — needs big capital AND multi-system routes.

| Good | Base Price | Volatility | Hazard | Price Range |
|---|---|---|---|---|
| Electronics | 80 | 1.0 | none | 0.5x-3.0x |
| Machinery | 100 | 0.8 | none | 0.5x-3.0x |
| Weapons | 120 | 2.0 | high | 0.5x-3.0x |
| Luxuries | 150 | 1.8 | none | 0.5x-3.0x |

### Per-Good Equilibrium Targets

Each good has custom supply/demand equilibrium targets for producing and consuming systems. These determine the natural price spread between where a good is made and where it's needed.

Example (Water):
- Produces: `{ supply: 160, demand: 136 }` — high supply relative to demand = cheap
- Consumes: `{ supply: 110, demand: 116 }` — lower supply, higher demand = expensive
- Buy price ~21cr, sell price ~26cr, margin ~5cr/unit

The ratio spread is inverted by tier: T0 has the widest % margin (~20%), T2 has the tightest (~12%). But because T2 has much higher base prices, the absolute margin per unit is still higher (T0: ~5cr vs T2: ~16cr). This creates a natural capital gate — you earn more per unit with luxuries, but you need 150cr/unit to buy them vs 25cr/unit for water.

Full values in `lib/constants/goods.ts`.

### Good Properties
Each good also has volume (1-2 cargo slots) and mass (0.5-2.5 kg) — stored in data but not currently enforced for cargo. Reserved for future use.

---

## Economy Types

6 economy types define what a system produces and consumes. Each type has specific production and consumption rates per good (units/tick).

| Type | Produces (rate/tick) | Consumes (rate/tick) |
|---|---|---|
| Agricultural | Food (5), Textiles (4) | Water (4), Chemicals (3), Machinery (1), Medicine (1) |
| Extraction | Water (5), Ore (4) | Food (3), Fuel (3), Textiles (2), Machinery (1) |
| Refinery | Fuel (3), Metals (3), Chemicals (2) | Ore (4), Water (3), Food (1) |
| Industrial | Machinery (2), Weapons (1) | Metals (3), Electronics (2), Chemicals (2), Fuel (2), Water (2), Food (2), Ore (2), Textiles (1) |
| Tech | Electronics (2), Medicine (2) | Metals (2), Chemicals (2), Food (2), Luxuries (1), Water (1) |
| Core | Luxuries (1) | Food (3), Textiles (2), Electronics (2), Medicine (2), Water (2), Weapons (1) |

This creates natural supply chains: Extraction produces ore, Refinery consumes ore and produces metals, Industrial consumes metals and produces machinery. Disrupting any link cascades through the chain.

**Note**: These per-good rates (1-5/tick) are the actual rates used by both the live game and the simulator via `resolveMarketTickEntry` (`lib/engine/market-tick-builder.ts`). The global `PRODUCTION_RATE` (1.5) and `CONSUMPTION_RATE` (1.0) in `ECONOMY_CONSTANTS` are only fallbacks when no per-good rate exists.

### Self-Sufficiency Factors

Different economy types have different self-sufficiency levels for goods they consume. An Agricultural system consuming water (s=0.5, has irrigation) gets better equilibrium targets than a Tech system consuming water (s=0.05, imports everything).

Self-sufficiency blends between consumer and producer equilibrium targets:
- `s = 0.0` — fully dependent on imports (worst prices)
- `s = 0.5` — mostly self-sufficient (moderate prices)
- `s = 1.0` — meets own needs (prices match producer levels)

This creates price variety between systems consuming the same good. Full factor table in `lib/constants/economy.ts`.

---

## Government Types

4 government types shape regional market behavior (4 more planned). Every type has trade-offs — buffs balanced by debuffs.

| Government | Volatility | Eq. Spread | Tax Rate | Danger | Contraband | Identity |
|---|---|---|---|---|---|---|
| Federation | 0.8x (stable) | -10% (tight) | 12% | 0.0 | Weapons | Balanced, regulated, safe |
| Corporate | 0.9x | -5% | 10% | 0.02 | None | Best margins, volatile |
| Authoritarian | 0.7x (very stable) | -15% (very tight) | 15% | 0.0 | Weapons, Chemicals | Safest, most restricted |
| Frontier | 1.5x (chaotic) | +20% (wide) | 0% | 0.1 | None | Highest profit, highest risk |
| Cooperative | TBD | TBD | TBD | TBD | TBD | Rock-solid, low margins |
| Technocratic | TBD | TBD | TBD | TBD | TBD | Premium on advanced goods |
| Militarist | TBD | TBD | TBD | TBD | TBD | War economy, resource hungry |
| Theocratic | TBD | TBD | TBD | TBD | TBD | Premium on basics, vice banned |

(4 new types designed, modifiers to be defined during implementation — see [faction-system.md](../planned/faction-system.md) S1)

### Government Effects on Gameplay
- **Volatility modifier**: Scales price noise amplitude. Frontier = wild swings, authoritarian = smooth predictability.
- **Equilibrium spread**: Widens/tightens the gap between producing and consuming prices. Wider = bigger margins but more chaos.
- **Tax rate**: Fraction of taxed goods seized on arrival (import duty).
- **Danger baseline**: Added to all event-based danger. Frontier adds 10% base cargo loss risk.
- **Contraband**: Goods that are inspected and confiscated if caught. Inspection chance varies by government (0% frontier to 37.5% authoritarian).
- **Consumption boosts**: Extra demand per tick for specific goods (e.g., authoritarian +1 weapons consumption).

---

## Market Simulation

### Price Formula
```
price = basePrice x (demand / supply)
```
Clamped to tier-specific floor/ceiling. If supply = 0, price hits the ceiling (maximum incentive for imports).

### Per-Tick Simulation (runs once per region per tick, round-robin)
Each good at each station is updated:

1. **Determine equilibrium target** — per-good targets for producing/consuming systems, adjusted by self-sufficiency factors for the system's economy type. Neutral systems use balanced defaults (supply 75/demand 75). Government equilibrium spread adjustments scale these targets.
2. **Apply event modifiers** — active events shift supply/demand targets, multiply production/consumption rates, and dampen reversion speed
3. **Apply government modifiers** — scale volatility, adjust equilibrium spread, add consumption boosts
4. **Mean reversion** — supply and demand are pulled 2% of the gap toward their equilibrium target each tick
5. **Self-limiting production** — producing systems add supply, scaled by `sqrt((MAX - supply) / (MAX - MIN))`. Near ceiling, production approaches zero (warehouses full). Only affects supply — demand is driven by equilibrium targets.
6. **Self-limiting consumption** — consuming systems remove supply, scaled by `sqrt((supply - MIN) / (MAX - MIN))`. Near floor, consumption approaches zero (nothing left to consume). Only affects supply — demand is driven by equilibrium targets.
7. **Prosperity multiplier** — both production and consumption rates are scaled by the system's prosperity multiplier (0.3x crisis to 1.3x booming)
8. **Noise** — random walk scaled by good volatility and government modifier (base amplitude +/-3 units)
9. **Clamp** — supply and demand bounded to [5, 200]

### Key Parameters
| Parameter | Value | Effect |
|---|---|---|
| Reversion rate | 2% per tick | ~35 ticks to move halfway to equilibrium |
| Noise amplitude | +/-3 base | Micro-volatility within trends |
| Min/max levels | 5 / 200 | Supply/demand bounds |
| Production rate | 1-5 per good | Per economy type, scaled by self-limiting + prosperity |
| Consumption rate | 1-4 per good | Per economy type, scaled by self-limiting + prosperity |
| Snapshot interval | Every 20 ticks | Price history recorded for charts |
| Max snapshots | 50 per system | Rolling window of ~1000 ticks |

### Prosperity System

Each system has a `prosperity` value from -1.0 (crisis) to +1.0 (booming). Replaces the old corrective boom/bust cycle.

**How it moves:**
- Player trade volume pushes prosperity upward (toward +1)
- Without trade, prosperity decays toward 0 (stagnant) at 0.03/run
- Only events can push prosperity below 0 (crisis states)
- When the triggering event ends, prosperity recovers toward 0

**What it does:** A single multiplier applied equally to both production AND consumption.

| Prosperity | Multiplier | Label |
|---|---|---|
| -1.0 | 0.3x | Crisis (event-driven only) |
| -0.5 | 0.5x | Disrupted (event-driven only) |
| 0.0 | 0.7x | Stagnant |
| 0.5 | 1.0x | Active |
| 1.0 | 1.3x | Booming |

Boom amplifies both sides equally — no corrective tug-of-war. A booming system has more goods flowing in and out, not a directional correction.

**Timing**: With 24 regions and round-robin, each system is processed every ~24 ticks. At 0.03 decay/run, prosperity goes from 1.0 to ~0 in ~33 runs (~800 ticks).

---

## Ship Prices & Progression

Ship prices are calibrated relative to trade margins to create a multi-stage progression:

| Ship | Price | Cargo | Role |
|---|---|---|---|
| Shuttle | 0 (starter) | 50 | Early T0 trading |
| Light Freighter | 25,000 | 80 | Upgraded T0/early T1 |
| Scout Skiff | 20,000 | 10 | Exploration |
| Interceptor | 35,000 | 15 | Combat |
| Bulk Freighter | 120,000 | 200 | Serious T1/T2 hauling |
| Corvette | 150,000 | 40 | Combat + opportunistic trade |
| Blockade Runner | 175,000 | 60 | Smuggling |
| Survey Vessel | 90,000 | 50 | Support |
| Heavy Freighter | 350,000 | 400 | Endgame hauling |
| Frigate | 450,000 | 30 | Fleet escort |
| Stealth Transport | 400,000 | 150 | Covert hauling |
| Command Vessel | 500,000 | 80 | Endgame support |

With T0 margins of ~5cr/unit and 50 cargo, a shuttle earns ~250cr/trip. Light Freighter at 25,000cr takes ~100 trips of pure T0 trading. Mixing in T1 goods as capital grows shortens this significantly.

---

## System Interactions

- **Events** inject economic shocks — supply/demand shifts, production halts, consumption surges (see [events.md](./events.md))
- **Trade missions** are generated from price extremes — high prices spawn import missions, low prices spawn export missions (see [trading.md](./trading.md))
- **Navigation danger** is partly driven by government danger baseline — affects cargo loss on arrival (see [navigation.md](./navigation.md))
- **Faction system** (planned) will add faction-specific economic modifiers and war-driven market disruption (see [faction-system.md](../planned/faction-system.md))

---

## Known Issues & Next Steps

See [economy-tuning.md](./economy-tuning.md) for structural issues and planned improvements.
