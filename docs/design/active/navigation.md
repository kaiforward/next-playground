# Navigation & Fleet

Ship management, travel between systems, fuel mechanics, and the cargo danger pipeline on arrival.

---

## Ships

### Ship Types

| Type | Fuel Capacity | Cargo Capacity | Cost | Notes |
|---|---|---|---|---|
| Shuttle | 100 | 50 | Free (starter) | Long range, small hold. Given to new players |
| Freighter | 80 | 120 | 5,000 CR | Short range, large hold. The workhorse |

Players start with one Shuttle. Additional ships are purchased at any system's shipyard. Ships are auto-named ("[Type] #N"). Each ship has its own location, cargo, and fuel — they operate independently.

### Fleet Management
- Players can own multiple ships simultaneously
- Each ship is docked at a specific system or in transit between systems
- Cargo belongs to individual ships, not players
- Ships in transit are locked — cannot trade, refuel, or take other actions until arrival

---

## Travel

### Route Planning
- Systems are connected by jump lanes (directed graph)
- Players plot routes across one or more hops
- Pathfinding uses Dijkstra's algorithm to find the lowest fuel cost path
- Multi-hop routes are committed in full — no stopping mid-journey

### Fuel
- Each connection has a fixed fuel cost (varies by distance)
- Inter-region gateway jumps cost ~2.5x more fuel than intra-region jumps
- Total fuel for a route = sum of all hop costs
- Fuel is deducted entirely at departure (not during transit)
- Refueling costs 2 CR per fuel unit at any station

### Travel Duration
- Per hop: `ceil(fuelCost / 2)` ticks
- Multi-hop routes: sum of all hop durations
- Ships are locked in transit until arrival tick

---

## Arrival — Cargo Danger Pipeline

When a ship arrives at its destination, cargo passes through 4 sequential stages of potential loss. Each stage operates on whatever cargo remains after previous stages.

### Stage 1: Hazard Incidents
Dangerous cargo (low or high hazard goods) can spontaneously cause incidents based on the system's danger level.

| Hazard Level | Base Chance | Loss on Incident | Affected Goods |
|---|---|---|---|
| None | 0% | — | Water, Food, Ore, Textiles, Metals, Medicine, Electronics, Machinery, Luxuries |
| Low | 3% + (danger x 0.5) | 10-25% of stack | Fuel, Chemicals |
| High | 6% + (danger x 0.5) | 50-100% of stack | Weapons |

At max danger (0.5), low hazard goods have ~28% incident chance, high hazard ~31%.

### Stage 2: Import Duty
Government taxes on specific goods — a fraction is seized on arrival.
- Federation: Chemicals taxed at 12%
- Other governments: Currently no taxed goods (but tax rates defined for future use)

### Stage 3: Contraband Inspection
Government inspects for illegal goods. If caught, the entire stack is confiscated.
- Base inspection chance: 25%
- Modified by government: Federation 1.2x (30%), Corporate 0.8x (20%), Authoritarian 1.5x (37.5%), Frontier 0x (never inspected)
- Federation contraband: Weapons
- Authoritarian contraband: Weapons, Chemicals
- Corporate/Frontier: No contraband

### Stage 4: Event-Based Cargo Loss
If the system has active danger from events or government baseline:
- Probability = danger level (capped at 50%)
- If triggered: all remaining cargo stacks lose 20-40% each
- Danger sources: event modifiers + government baseline (Frontier +10%, Corporate +2%)

### Danger Sources Summary
| Source | Contribution |
|---|---|
| Government baseline | 0-10% (Frontier highest) |
| Event modifiers | 0-25% (Solar Storm highest) |
| Combined max | 50% (hard cap) |

---

## Gameplay Implications

- **Route planning is strategic**: Fuel limits, travel time, and destination danger all factor into deciding where to trade
- **Gateway systems are chokepoints**: Inter-region travel requires passing through specific gateway systems with higher fuel costs
- **Cargo risk scales with reward**: Frontier systems have the best prices but the highest danger. Authoritarian systems are safe but restrict profitable goods
- **Ship choice matters**: Shuttles reach farther (more fuel) but carry less. Freighters haul more but run out of fuel faster. Fleet composition drives strategy
- **Hazard goods are a gamble**: Weapons are the most profitable tier 2 good but have high hazard AND are contraband in 2 of 4 government types

---

## System Interactions

- **Economy**: Government modifiers affect market volatility and equilibrium (see [economy.md](./economy.md))
- **Events**: Active events add danger modifiers that increase cargo loss risk. Events also disrupt production, creating price signals worth navigating toward (see [events.md](./events.md))
- **Trading**: Cargo loss directly affects trade profitability. Mission delivery requires surviving the arrival pipeline with enough goods (see [trading.md](./trading.md))
- **Faction system** (planned): Faction territory will determine government type. War zones will have elevated danger. Player reputation may affect inspection rates (see [faction-system.md](../planned/faction-system.md))
