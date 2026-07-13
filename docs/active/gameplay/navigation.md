# Navigation & Fleet

Ship travel between systems: route planning, fuel, and travel duration. Ships dock on arrival — there is no arrival pipeline.

---

## Ships

12 ship classes across 3 sizes and 5 roles, each with a fixed stat block (fuel, speed, hull, shields, firepower, evasion, stealth, sensors, crew). Combat-facing stats are inert until the war layer lands. The full class roster, stat blocks, sizes, and roles are in [ship-roster.md](./ship-roster.md).

Players start with one Shuttle. Fleets are fixed — there is no ship purchase (the dev teleport tool remains for testing).

---

## Travel

### Route Planning
- Systems are connected by jump lanes (directed graph)
- Routes are plotted across one or more hops
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

### Arrival
The ship-arrivals processor docks any in-transit ship whose arrival tick has come due (status → docked, destination/arrival fields cleared) and emits a `shipArrived` SSE event that drives client cache invalidation.

---

## System Danger (world attribute)

Systems retain a danger readout on the overview panel — it is player-independent world state, kept for events and the future war layer:

| Source | Contribution |
|---|---|
| Government baseline | 0-10% (Frontier highest) |
| Body danger | +5% per volcanic-world body (sum of body-archetype danger baselines) |

Nothing consumes danger mechanically — there is no arrival-danger pipeline. Events and the future war layer are the intended consumers.

---

## Fleet Management
- Players can own multiple ships simultaneously
- Each ship is docked at a specific system or in transit between systems
- Ships in transit are locked — cannot refuel or take other actions until arrival

---

## System Interactions

- **Economy**: Government modifiers affect market volatility and equilibrium (see [economy.md](./economy.md))
- **Events**: Events disrupt production and add navigation-domain danger modifiers; only the danger *readout* consumes them now (see [events.md](./events.md))
- **Faction system** (planned): Faction territory will determine government type. War zones will have elevated danger (see [faction-system.md](./faction-system.md))
