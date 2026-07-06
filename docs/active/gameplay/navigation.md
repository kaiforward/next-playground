# Navigation & Fleet

Ship management, travel between systems, fuel mechanics, convoys, upgrades, damage, and the cargo danger pipeline on arrival.

---

## Ships

12 ship classes across 3 sizes and 5 roles, each with 10 core stats (cargo, fuel, speed, hull, shields, firepower, evasion, stealth, sensors, crew). Three of those feed the arrival danger pipeline directly — hull reduces hazard severity, stealth reduces inspection chance, evasion reduces event cargo-loss — and firepower drives convoy escort protection. The full class roster, stat blocks, sizes, and roles are in [ship-roster.md](./ship-roster.md).

Players start with one Shuttle; more are bought at shipyards. Each ship has its own location, cargo, fuel, hull/shield state, and upgrade slots.

### Disabled Ships

When hull reaches 0, the ship is disabled:
- All cargo is lost
- Ship stays at its current system
- Cannot travel, trade, or take actions
- Must be repaired to restore functionality

### Repair

Available at any station while docked. Cost is 10 CR per hull point of damage. Shields regenerate automatically on dock at no cost.

---

## Upgrade Modules

12 modules across 4 slot types (engine, cargo, defence, systems) — tiered stat boosts (Mk I/II/III) or single-tier capability unlocks, installed into a ship's fixed slot layout. The full module catalog, per-class slot layouts, and install/remove flow are in [ship-upgrades.md](./ship-upgrades.md). Their pipeline-relevant effects:

### Module Effects in Danger Pipeline

- **Manoeuvring Thrusters**: +evasion bonus → reduces cargo loss probability
- **Reinforced Containers**: Reduces hazard loss severity
- **Hidden Compartment**: Conceals a fraction of cargo from contraband inspection
- **Armour Plating**: +hull bonus → reduces hazard incident severity
- **Shield Booster**: +shield max → more damage absorption
- **Point Defence Array**: Flat reduction to cargo loss probability

### Stat Reduction Formula

Ship stats reduce danger through diminishing returns: `reduction = stat / (stat + K)` where K varies per pipeline stage.

---

## Convoys

Ships can be grouped into convoys for collective travel and trade.

### Formation
- Minimum 2 ships, all docked at the same system
- Ships cannot be disabled or already in a convoy
- Only docked convoys can be modified

### Travel
- Convoy speed = slowest member's speed
- All ships depart and arrive together
- Fuel deducted from each ship individually

### Escort Protection
- All convoy members contribute their firepower — combat ships dominate because their firepower (10–18) far exceeds traders (1–3)
- Protection scales with diminishing returns: `firepowerSum / (firepowerSum + 30)`, max 70% reduction
- Chance reduction at full value, severity reduction at half value

### Convoy Cargo & Trade
- DB stores cargo per ship; trade operations see combined cargo capacity
- Convoy trade uses a dedicated endpoint (`/api/game/convoy/[convoyId]/trade`) — individual ship trade is blocked for convoy members
- Buy: goods distributed sequentially across member ships by available space
- Sell: goods pulled sequentially from first ship with stock

### Convoy Repair
- Fraction-based bulk repair: repair 0–100% of damage across all members in one operation
- Per-ship heal amount rounds up (generous to player): `ceil(damage × fraction)`
- Cost: heal amount × 10 CR per hull point per ship

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

### Travel Duration — Speed-Based
- Base ticks per hop: `max(1, ceil(fuelCost / 2))`
- Speed adjustment: `max(1, ceil(baseTicks * referenceSpeed / shipSpeed))`
- Reference speed = 5 (Shuttle). Faster ships (speed > 5) travel in fewer ticks. Slower ships take more.
- Multi-hop routes: sum of all hop durations
- Ships are locked in transit until arrival tick

---

## Arrival — Danger Pipeline

When a ship arrives at its destination, it passes through 5 sequential stages. Ship stats and upgrade modules modify each stage through diminishing returns.

### Stage 1: Hazard Incidents
Dangerous cargo (low or high hazard goods) can spontaneously cause incidents based on the system's danger level.

| Hazard Level | Base Chance | Loss on Incident | Affected Goods |
|---|---|---|---|
| None | 0% | — | Water, Food, Ore, Textiles, Metals, Medicine, Electronics, Machinery, Luxuries |
| Low | 3% + (danger x 0.5) | 10-25% of stack | Fuel, Chemicals |
| High | 6% + (danger x 0.5) | 50-100% of stack | Weapons |

**Ship modifiers**: Hull stat and Armour Plating bonus reduce loss severity. Reinforced Containers bonus reduces severity further.

### Stage 2: Import Duty
Government taxes on specific goods — a fraction is seized on arrival.
- Federation: Chemicals taxed at 12%
- Other governments: Currently no taxed goods

### Stage 3: Contraband Inspection
Government inspects for illegal goods. If caught, the entire stack is confiscated.
- Base inspection chance: 25%
- Modified by government: Federation 1.2x (30%), Corporate 0.8x (20%), Authoritarian 1.5x (37.5%), Frontier 0x (never inspected)
- **Ship modifiers**: Stealth stat reduces inspection chance. Hidden Compartment conceals a fraction of cargo.

### Stage 4: Event-Based Cargo Loss
If the system has active danger from events or government baseline:
- Probability = danger level (capped at 50%)
- If triggered: all remaining cargo stacks lose 20-40% each
- **Ship modifiers**: Evasion stat, Manoeuvring Thrusters bonus, and Point Defence Array bonus reduce loss probability.

### Stage 5: Hull/Shield Damage
After cargo processing, the ship may take structural damage:
- Damage chance = danger level × 60% (max base chance = 30% at the hard danger cap of 0.5)
- Damage amount: 10-35% of combined hull+shield pool
- Shields absorb first, remainder hits hull
- Hull at 0 → ship disabled, all remaining cargo lost
- **Ship modifiers**: Escort protection (all convoy members, firepower-weighted) reduces both chance and severity

### Danger Sources Summary
| Source | Contribution |
|---|---|
| Government baseline | 0-10% (Frontier highest) |
| Event modifiers | 0-25% (Solar Storm highest) |
| Feature danger (`computeTraitDanger`) | -3% to +8% per feature. Positive: subspace_rift (+8%), pirate_stronghold (+8%), dark_nebula (+6%), ancient_minefield (+5%), ion_storm_corridor (+4%), solar_flare_activity (+3%), binary_star (+3%). Negative: lagrange_stations (-3%). Sums across the system's features |
| Body danger | +5% per volcanic-world body (sum of body-archetype danger baselines) |
| Combined max | 50% (hard cap, clamped to [0, 0.5]) |

---

## Fleet Management
- Players can own multiple ships simultaneously
- Each ship is docked at a specific system or in transit between systems
- Cargo belongs to individual ships, not players
- Ships in transit are locked — cannot trade, refuel, or take other actions until arrival
- Ships can be grouped into convoys for collective travel

---

## Gameplay Implications

- **Route planning is strategic**: Fuel limits, travel time, and destination danger all factor into deciding where to trade
- **Gateway systems are chokepoints**: Inter-region travel requires passing through specific gateway systems with higher fuel costs
- **Cargo risk scales with reward**: Frontier systems have the best prices but the highest danger. Authoritarian systems are safe but restrict profitable goods
- **Ship choice matters**: 12 classes across 5 roles create meaningful fleet composition decisions. Trade ships haul more, combat ships escort, stealth ships avoid inspection
- **Convoys reduce risk**: All convoy members contribute firepower to escort protection (combat ships dominate), at the cost of traveling at the slowest ship's speed
- **Upgrades specialize ships**: Module choices create build diversity within each ship class
- **Hazard goods are a gamble**: Weapons are the most profitable tier 2 good but have high hazard AND are contraband in 2 of 4 government types

---

## System Interactions

- **Economy**: Government modifiers affect market volatility and equilibrium (see [economy.md](./economy.md))
- **Events**: Active events add danger modifiers that increase cargo loss risk. Events also disrupt production, creating price signals worth navigating toward (see [events.md](./events.md))
- **Trading**: removed in the pivot Phase 1 teardown — goods move via the simulated trade flow, not player hauling
- **Faction system** (planned): Faction territory will determine government type. War zones will have elevated danger. Player reputation may affect inspection rates (see [faction-system.md](./faction-system.md))
