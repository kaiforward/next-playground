# Navigation Changes

Changes to the active navigation system ([navigation.md](../active/navigation.md)) driven by the ship roster expansion and faction system. This is a delta document — it describes what changes, not the full system. When implemented, merge these changes into the active navigation doc.

---

## 1. Convoys

Currently, ships travel independently — each ship plots its own route, departs alone, arrives alone. With the expanded ship roster introducing combat escorts and stealth ships, players need a way to group ships for mutual protection.

### Formation

- Player selects two or more ships **docked at the same system**
- Groups them into a convoy and assigns a route
- All ships in the convoy travel the same route (same hops, same destination)
- A convoy can be formed from any mix of ship roles — trade ships with combat escorts is the typical case, but any combination is valid

### Travel

- The convoy travels at the speed of the **slowest ship** in the group
- This is the core trade-off: escorts make you safer but slower. A heavy freighter escorted by an interceptor forces the interceptor to crawl at freighter speed
- Fuel is consumed per-ship based on each ship's own fuel stats — convoy travel doesn't change fuel costs
- Ships in a convoy are locked in transit together, same as individual ships

### Speed Trade-off

Speed becomes a genuine fleet composition consideration:

| Escort choice | Safety | Speed cost |
|---|---|---|
| Interceptor (fast) | Moderate firepower/hull | Minimal — interceptor is fast, unlikely to be the bottleneck |
| Corvette (medium) | Strong firepower/hull | Moderate — corvette may slow down lighter trade ships |
| Frigate (slow) | Maximum firepower/hull | Significant — frigate is one of the slowest ships, drags the whole convoy down |

Players must decide: is the extra protection of a frigate worth the time cost, or is a faster corvette "good enough" for the danger level?

### Arrival and Pipeline

- All ships in a convoy arrive at the same tick
- Each ship passes through the danger pipeline individually, but escort ships apply protective modifiers (see [ship-roster.md §4.2](./ship-roster.md))
- Escort effectiveness is calculated from the combat ships' firepower and hull relative to the system's danger level
- After arrival, ships remain grouped until the player splits the convoy or sends individual ships on new routes

### Splitting and Regrouping

- A convoy can be split at any system where it's docked — the player removes one or more ships from the group
- Ships can be added to an existing docked convoy (same rules: must be docked at the same system)
- A convoy of one ship is just a regular ship — no special handling needed

---

## 2. Travel Speed

**Replaces**: The current fixed formula `ceil(fuelCost / 2)` ticks per hop.

With the ship roster's speed stat, travel time becomes ship-dependent. Faster ships reach destinations sooner, making speed a meaningful stat for trade (time-sensitive missions, market opportunities) and combat (rapid deployment, interception).

The exact formula is an implementation detail, but the principle is:
- **Base travel time** is still derived from hop distance/fuel cost
- **Speed stat** modifies this as a multiplier — higher speed reduces travel time, lower speed increases it
- **Convoy speed** uses the slowest ship's speed stat
- Minimum travel time per hop is 1 tick (no instant travel regardless of speed)

---

## 3. Danger Pipeline — Ship Stat Modifiers

The four-stage arrival pipeline gains ship stat modifiers. Full details are in [ship-roster.md §4.3](./ship-roster.md), but the summary for navigation purposes:

| Stage | Modifier | Effect |
|---|---|---|
| Hazard Incidents | Hull | Reduces loss severity per incident |
| Import Duty | None | Unchanged |
| Contraband Inspection | Stealth | Reduces inspection chance |
| Event-Based Cargo Loss | Evasion | Reduces loss probability |

Escort ships in a convoy provide additional modifiers on top of the individual ship's stats.

---

## 4. Contraband and Goods Restrictions

**Replaces**: The current model where all 12 goods are available at all systems.

Government type determines which goods are **restricted** at regular markets. Restricted goods cannot be bought or sold at standard markets in systems with that government — they are contraband.

- **Frontier**: No restrictions (anything goes)
- **Corporate**: Minimal restrictions
- **Federation**: Weapons restricted
- **Authoritarian**: Weapons and Chemicals restricted
- Other government types (cooperative, technocratic, militarist, theocratic): restrictions defined per type during implementation

**Black markets** (see [system-enrichment.md](./system-enrichment.md) §5) bypass government restrictions entirely — all goods are available regardless of government type. This creates the smuggling loop: buy restricted goods at a black market or frontier system, transport them through restricted space (risking inspection), sell at another black market for a premium.

### Customs House Facility

The base contraband inspection chance is set by government type (25% base × government modifier, as in current navigation.md). The **Customs House** facility (system-enrichment.md §5) adds a per-system bonus on top:

`effective_inspection_chance = government_base × government_modifier + customs_house_bonus`

This makes inspection rates system-specific, not just government-specific. Smugglers route around customs house systems even within the same government territory. Destroying a customs house during wartime opens smuggling routes — a strategic consideration.

---

## 5. Fuel and Refueling

All systems offer refueling — no system lacks the ability to refuel a ship. The base cost remains universal (currently 2 CR per fuel unit).

The **Fuel Depot** facility (see [system-enrichment.md](./system-enrichment.md) §5) provides a discount on refueling at that system. Higher-tier fuel depots give larger discounts. This makes fuel depots valuable waypoints for long-haul routes but never gates access — a player can always refuel, they just pay more at systems without a depot.

---

## Related Design Docs

- **[Navigation (active)](../active/navigation.md)** — current implementation this doc modifies
- **[Ship Roster](./ship-roster.md)** — ship stats, escort mechanics, fleet composition
- **[War System](./war-system.md)** — war zones create elevated danger, convoy protection becomes critical in contested space
