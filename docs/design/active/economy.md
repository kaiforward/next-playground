# Economy System

The economy is a self-limiting market simulation where supply and demand drift toward equilibrium, modified by production, consumption, prosperity, random noise, and events. Prices emerge naturally from supply/demand ratios. Player trade is the primary correction mechanism for inter-system imbalances.

---

## Goods

12 goods organized in 3 tiers. Tier determines price volatility, clamp ranges, and mission reward multipliers.

### Tier 0 — Raw Materials
| Good | Base Price | Volatility | Hazard |
|---|---|---|---|
| Water | 25 | 0.5 | none |
| Food | 30 | 0.7 | none |
| Ore | 35 | 0.6 | none |
| Textiles | 35 | 0.8 | none |

Price range: 0.1x to 8.0x base. Wide equilibrium spreads. Cheap, high volume, low risk.

### Tier 1 — Processed Goods
| Good | Base Price | Volatility | Hazard |
|---|---|---|---|
| Fuel | 35 | 1.0 | low |
| Metals | 45 | 0.8 | none |
| Chemicals | 55 | 1.2 | low |
| Medicine | 65 | 1.5 | none |

Price range: 0.15x to 6.0x base. Medium equilibrium spreads. Moderate margins, some hazard risk.

### Tier 2 — Advanced Goods
| Good | Base Price | Volatility | Hazard |
|---|---|---|---|
| Electronics | 80 | 1.0 | none |
| Machinery | 100 | 0.8 | none |
| Weapons | 120 | 2.0 | high |
| Luxuries | 150 | 1.8 | none |

Price range: 0.2x to 4.0x base (Luxuries: 0.15x to 4.5x). Tighter equilibrium spreads. High value per unit, requires capital to trade.

### Per-Good Equilibrium Targets

Each good has custom supply/demand equilibrium targets for producing and consuming systems. These determine the natural price spread between where a good is made and where it's needed.

Example (Water): produces `{ supply: 150, demand: 25 }`, consumes `{ supply: 25, demand: 140 }`. A producing system has high supply + low demand = cheap. A consuming system has low supply + high demand = expensive.

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

(4 new types designed, modifiers to be defined during implementation — see [faction-system.md](../planned/faction-system.md) §1)

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

1. **Determine equilibrium target** — per-good targets for producing/consuming systems, adjusted by self-sufficiency factors for the system's economy type. Neutral systems use balanced defaults (supply 60/demand 60). Government equilibrium spread adjustments scale these targets.
2. **Apply event modifiers** — active events shift supply/demand targets, multiply production/consumption rates, and dampen reversion speed
3. **Apply government modifiers** — scale volatility, adjust equilibrium spread, add consumption boosts
4. **Mean reversion** — supply and demand are pulled 2% of the gap toward their equilibrium target each tick
5. **Self-limiting production** — producing systems add goods to supply, scaled by `sqrt((MAX - supply) / (MAX - MIN))`. Near ceiling, production approaches zero (warehouses full).
6. **Self-limiting consumption** — consuming systems remove goods from supply, scaled by `sqrt((supply - MIN) / (MAX - MIN))`. Near floor, consumption approaches zero (nothing left to consume).
7. **Prosperity multiplier** — both production and consumption rates are scaled by the system's prosperity multiplier (0.3x crisis to 1.3x booming)
8. **Noise** — random walk scaled by good volatility and government modifier (base amplitude ±3 units)
9. **Clamp** — supply and demand bounded to [5, 200]

### Key Parameters
| Parameter | Value | Effect |
|---|---|---|
| Reversion rate | 2% per tick | ~35 ticks to move halfway to equilibrium |
| Noise amplitude | ±3 base | Micro-volatility within trends |
| Min/max levels | 5 / 200 | Supply/demand bounds |
| Production rate | 3 base | Scaled by self-limiting + prosperity |
| Consumption rate | 2 base | Scaled by self-limiting + prosperity |
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

---

## System Interactions

- **Events** inject economic shocks — supply/demand shifts, production halts, consumption surges (see [events.md](./events.md))
- **Trade missions** are generated from price extremes — high prices spawn import missions, low prices spawn export missions (see [trading.md](./trading.md))
- **Navigation danger** is partly driven by government danger baseline — affects cargo loss on arrival (see [navigation.md](./navigation.md))
- **Faction system** (planned) will add faction-specific economic modifiers and war-driven market disruption (see [faction-system.md](../planned/faction-system.md))

---

## Known Issues

Trade margins are currently far too generous — see [economy-tuning.md](./economy-tuning.md) for the active design discussion on progression curve and margin balancing.
