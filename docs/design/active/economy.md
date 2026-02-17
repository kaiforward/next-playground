# Economy System

The economy is a mean-reverting market simulation where supply and demand drift toward equilibrium, modified by production, consumption, random noise, and events. Prices emerge naturally from supply/demand ratios.

---

## Goods

12 goods organized in 3 tiers. Tier determines price volatility, clamp ranges, and mission reward multipliers.

### Tier 0 — Raw Materials
| Good | Base Price | Volatility | Hazard |
|---|---|---|---|
| Water | 25 | 0.5 | none |
| Food | 30 | 0.6 | none |
| Ore | 35 | 0.8 | none |
| Textiles | 28 | 0.5 | none |

Price range: 0.1x to 8.0x base. Wide equilibrium spreads (up to 6x between producing and consuming systems). Cheap, high volume, low risk.

### Tier 1 — Processed Goods
| Good | Base Price | Volatility | Hazard |
|---|---|---|---|
| Fuel | 45 | 1.0 | low |
| Metals | 50 | 0.8 | none |
| Chemicals | 55 | 1.2 | low |
| Medicine | 65 | 1.5 | none |

Price range: 0.15x to 6.0x base. Medium equilibrium spreads. Moderate margins, some hazard risk.

### Tier 2 — Advanced Goods
| Good | Base Price | Volatility | Hazard |
|---|---|---|---|
| Electronics | 80 | 0.8 | none |
| Machinery | 100 | 1.0 | none |
| Weapons | 120 | 2.0 | high |
| Luxuries | 150 | 1.5 | none |

Price range: 0.2x to 4.0x base. Tight equilibrium spreads (1.6-2.7x). High value, tight margins, high risk for weapons.

### Good Properties
Each good also has volume (1-2 cargo slots) and mass (0.5-2.5 kg) — stored in data but not currently enforced for cargo. Reserved for future use.

---

## Economy Types

6 economy types define what a system produces and consumes. Each type has specific production and consumption rates per good (units/tick).

| Type | Produces | Key Consumption |
|---|---|---|
| Agricultural | Food (5), Textiles (4) | Water, Machinery, Chemicals, Medicine |
| Extraction | Ore (4), Water (5) | Food, Fuel, Machinery, Textiles |
| Refinery | Fuel (3), Metals (3), Chemicals (2) | Ore, Water, Food |
| Industrial | Machinery (2), Weapons (1) | Metals, Electronics, Chemicals, Fuel (+ many others) |
| Tech | Electronics (2), Medicine (2) | Metals, Chemicals, Luxuries, Food |
| Core | Luxuries (1) | Food, Textiles, Electronics, Medicine, Weapons |

This creates natural supply chains: Extraction produces ore, Refinery consumes ore and produces metals, Industrial consumes metals and produces machinery. Disrupting any link cascades through the chain.

---

## Government Types

8 government types shape regional market behavior. Every type has trade-offs — buffs balanced by debuffs.

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

1. **Determine equilibrium target** — producing systems target high supply/low demand, consuming systems target opposite, neutral systems use balanced defaults
2. **Apply event modifiers** — active events shift supply/demand targets, multiply production/consumption rates, and dampen reversion speed
3. **Apply government modifiers** — scale volatility, adjust equilibrium spread, add consumption boosts
4. **Mean reversion** — supply and demand are pulled 5% of the gap toward their equilibrium target each tick
5. **Production** — producing systems add goods to supply and slightly suppress demand
6. **Consumption** — consuming systems remove goods from supply and boost demand
7. **Noise** — random walk scaled by good volatility and government modifier (base amplitude ±3 units)
8. **Clamp** — supply and demand bounded to [5, 200]

### Key Parameters
| Parameter | Value | Effect |
|---|---|---|
| Reversion rate | 5% per tick | ~20 ticks to move halfway to equilibrium |
| Noise amplitude | ±3 base | Micro-volatility within trends |
| Min/max levels | 5 / 200 | Supply/demand bounds |
| Snapshot interval | Every 20 ticks | Price history recorded for charts |
| Max snapshots | 50 per system | Rolling window of ~1000 ticks |

---

## System Interactions

- **Events** inject economic shocks — supply/demand shifts, production halts, consumption surges (see [events.md](./events.md))
- **Trade missions** are generated from price extremes — high prices spawn import missions, low prices spawn export missions (see [trading.md](./trading.md))
- **Navigation danger** is partly driven by government danger baseline — affects cargo loss on arrival (see [navigation.md](./navigation.md))
- **Faction system** (planned) will add faction-specific economic modifiers and war-driven market disruption (see [faction-system.md](../planned/faction-system.md))
