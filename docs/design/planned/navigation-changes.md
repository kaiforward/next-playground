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
- Each ship passes through the danger pipeline individually, but escort ships apply protective modifiers (see §3 Escort Protection)
- Escort effectiveness is calculated from the combat ships' firepower and hull relative to the system's danger level
- After arrival, ships remain grouped until the player splits the convoy or sends individual ships on new routes

### Splitting and Regrouping

- A convoy can be split at any system where it's docked — the player removes one or more ships from the group
- Ships can be added to an existing docked convoy (same rules: must be docked at the same system)
- A convoy of one ship is just a regular ship — no special handling needed

---

## 2. Travel Speed

**Replaces**: The current fixed formula `max(1, ceil(fuelCost / 2))` ticks per hop (`lib/engine/travel.ts`).

With the ship roster's speed stat, travel time becomes ship-dependent. Faster ships reach destinations sooner, making speed a meaningful stat for trade (time-sensitive missions, market opportunities) and combat (rapid deployment, interception).

### Formula

```
baseTicks = ceil(fuelCost / 2)
hopDuration = max(1, ceil(baseTicks × (shipSpeed / referenceSpeed)))
```

- **`shipSpeed`** — the ship's speed stat (lower is faster, per [ship-roster.md §1.1](./ship-roster.md)). Modified by Thruster Upgrade module
- **`referenceSpeed`** — a baseline constant calibrated so the current Shuttle travel times are preserved after migration. Set once during implementation and left fixed
- **`baseTicks`** — distance still matters. Longer hops (higher fuel cost) produce more base ticks. The speed stat scales that, it doesn't replace it
- **Minimum**: 1 tick per hop, regardless of how fast the ship is

### Convoy Speed

Convoy uses `max(shipSpeed)` across all convoy members — the slowest ship dictates travel time, same formula but with the worst speed stat in the group.

### Module Effects

Two engine-slot modules interact with travel speed, each on a different axis:

| Module | Axis | Mechanism |
|---|---|---|
| **Thruster Upgrade** (Mk I/II/III) | **Speed** | Reduces effective `shipSpeed` stat → fewer ticks per hop. Directly reduces travel time |
| **Fuel Optimiser** (Mk I/II/III) | **Range** | Reduces `fuelCost` per hop → more hops per fuel tank. Does not change travel time |

One engine slot, choose one. Thruster Upgrade makes you faster. Fuel Optimiser lets you go further. A scout that needs to cross the galaxy quickly wants thrusters. A heavy freighter that needs to reach distant systems without refuelling wants fuel optimisation.

### Representative Travel Times

Approximate ticks per hop for short (fuel cost 2), medium (fuel cost 6), and long (fuel cost 10) hops:

| Ship | Size | Speed profile | Short hop | Medium hop | Long hop |
|---|---|---|---|---|---|
| Interceptor | Small | Very fast | 1 | 1–2 | 2–3 |
| Shuttle | Small | Fast (reference) | 1 | 3 | 5 |
| Corvette | Medium | Moderate | 1–2 | 4–5 | 7–8 |
| Bulk Freighter | Medium | Slow | 2 | 5–6 | 8–10 |
| Heavy Freighter | Large | Very slow | 2–3 | 6–8 | 10–13 |
| Frigate | Large | Slow | 2–3 | 6–7 | 9–12 |

Exact values depend on tuning `referenceSpeed` and per-ship speed stats. The key pattern: small ships are 2–3× faster than large ships over long distances. Over short hops the minimum-1-tick floor compresses the gap.

---

## 3. Danger Pipeline — Ship Stats, Upgrades, and Escorts

**Replaces**: The current four-stage pipeline where ship capability has no effect.

The four arrival stages are preserved. Each stage now has up to four layers of modification: **base mechanic → ship stat → upgrade modules → escort protection**. Two stages also introduce **hull damage** as a new outcome alongside cargo loss.

### Stage 1: Hazard Incidents

Hazardous cargo (determined by the good's `hazard` property and system danger) may cause containment failures during transit.

| Layer | Mechanism |
|---|---|
| **Base** | Incident chance driven by cargo hazard level × system danger. Severity = percentage of hazardous cargo lost |
| **Ship stat: Hull** | Higher hull reduces loss *severity* — a sturdier ship contains dangerous cargo better (smaller percentage lost per incident). Does not reduce incident *chance* |
| **Upgrades** | **Armour Plating** increases hull stat → indirect severity reduction. **Reinforced Containers** directly reduces cargo loss percentage on top of hull |
| **Escorts** | None — hazard incidents are internal to the ship's own cargo. Escorts can't stabilise another ship's containment |
| **Hull damage** | Yes — containment failures damage the ship. Hull stat and Armour Plating reduce damage taken. Creates demand for Repair Bay module and shipyard repairs |

### Stage 2: Import Duty

Government tax on specific goods. Administrative — no physical threat.

| Layer | Mechanism |
|---|---|
| **Base** | Government type defines taxed goods and tax rate (see §4) |
| **Ship stat** | None — taxes are assessed on cargo, not the ship |
| **Upgrades** | None — no module bypasses government taxes |
| **Escorts** | None |
| **Hull damage** | No |

### Stage 3: Contraband Inspection

Authorities scan arriving ships for restricted goods.

| Layer | Mechanism |
|---|---|
| **Base** | Inspection chance = 25% base × government inspection modifier (see §4). Customs House facility adds per-system bonus |
| **Ship stat: Stealth** | Higher stealth reduces inspection *chance*. A stealthy ship is harder to scan — makes Blockade Runner and Stealth Transport natural smuggling choices |
| **Upgrades** | **Stealth Coating** increases stealth stat → indirect inspection reduction. **Hidden Compartment** conceals a portion of cargo *if inspected* — the scan happens, but hidden goods aren't found. Layered defence: stealth avoids the check, compartment survives it |
| **Escorts** | None — escorts don't fool customs officials. A corvette escorting a blockade runner doesn't make the runner less suspicious |
| **Hull damage** | No — administrative process |

### Stage 4: Event-Based Cargo Loss

External threats — pirates, debris fields, environmental hazards, event-driven dangers.

| Layer | Mechanism |
|---|---|
| **Base** | Loss probability driven by system danger level (government baseline + active events + war zone danger). Severity = percentage of cargo lost |
| **Ship stat: Evasion** | Higher evasion reduces loss *probability*. An agile ship dodges debris, outmanoeuvres pirates, evades event-driven hazards |
| **Upgrades** | **Manoeuvring Thrusters** add bonus evasion → reduces probability. **Point Defence Array** provides a separate flat reduction to loss probability (destroys threats rather than dodging). **Reinforced Containers** reduce loss *severity* if the event triggers. Three modules can influence this stage through different mechanisms |
| **Escorts** | Yes — this is the only stage where escorts matter. See Escort Protection below |
| **Hull damage** | Yes — external threats (pirate attacks, debris impacts) damage the ship alongside cargo loss. Hull stat and Armour Plating reduce damage taken |

### Escort Protection

Escort mechanics apply **only to Stage 4**. Escorts deter or defeat external threats — they can't prevent internal cargo incidents (Stage 1), fool customs (Stage 3), or avoid taxes (Stage 2).

**Relevant escort stats**: firepower + hull (combined combat capability of all escort ships in the convoy).

**Diminishing returns formula**:

```
totalEscortPower = sum(escort.firepower + escort.hull) for all escort ships
escortReduction = totalEscortPower / (totalEscortPower + K)
```

Where `K` is a tuning constant. This produces a diminishing-returns curve: the first escort gives a large danger reduction, each additional escort gives progressively less. Example with K = 20:

| Escorts | Total power (approx) | Reduction |
|---|---|---|
| 1 Interceptor | ~12 | 37% |
| 1 Corvette | ~25 | 56% |
| 2 Corvettes | ~50 | 71% |
| 1 Frigate | ~40 | 67% |
| 1 Frigate + 1 Corvette | ~65 | 76% |

**Stacking with evasion**: Escort reduction stacks *multiplicatively* with the individual ship's own evasion:

```
effectiveDanger = baseDanger × (1 - evasionReduction) × (1 - escortReduction)
```

A nimble ship in an escorted convoy benefits from both its own dodging and the escort's firepower. All convoy ships benefit equally from escort protection — the escort defends the whole group.

### Hull Damage

Stages 1 and 4 cause hull damage alongside cargo loss when incidents trigger. This connects the danger pipeline to the ship damage system ([ship-roster.md §5.3](./ship-roster.md)):

- **Damage severity** scales with the incident severity — a minor containment leak does less hull damage than a pirate boarding
- **Hull stat** and **Armour Plating** reduce damage taken (same stat, same mechanism as cargo loss severity reduction)
- **Repair Bay** module restores hull between voyages without visiting a shipyard — valuable for ships operating far from friendly ports
- **Ships at 0 hull are destroyed** — all cargo and installed modules lost (ship-roster.md §5.3 handles consequences). This is the ultimate risk for unescorted heavy freighters in dangerous space

### Pipeline Summary

| Stage | Ship stat | Upgrade modules | Escort | Hull damage |
|---|---|---|---|---|
| 1: Hazard Incidents | Hull (severity) | Armour Plating, Reinforced Containers | No | Yes |
| 2: Import Duty | — | — | No | No |
| 3: Contraband Inspection | Stealth (chance) | Stealth Coating, Hidden Compartment | No | No |
| 4: Event-Based Cargo Loss | Evasion (probability) | Manoeuvring Thrusters, Point Defence Array, Reinforced Containers | Yes | Yes |

---

## 4. Contraband and Goods Restrictions

**Replaces**: The current model where all 12 goods are available at all systems.

Government type determines which goods are **restricted** at regular markets. Restricted goods cannot be bought or sold at standard markets in systems with that government — they are contraband. Government type also determines which goods are **taxed** on import (Stage 2 of the pipeline) and the **inspection modifier** that scales contraband detection chance (Stage 3).

### Government Trade Rules

| Government | Contraband | Taxed goods | Inspection mod | Identity |
|---|---|---|---|---|
| **Federation** | Weapons | Chemicals @12% | 1.2× | Regulated but fair — weapons banned, light taxes, moderate enforcement |
| **Corporate** | — | — | 0.8× | Wide open, profit-first — minimal enforcement, anything profitable goes |
| **Authoritarian** | Weapons, Chemicals | — | 1.5× | Strict state control — strategic goods banned, heavy inspection presence |
| **Frontier** | — | — | 0× | Lawless — no enforcement of any kind, smuggler's paradise |
| **Cooperative** | Luxuries | — | 1.0× | Egalitarian — ostentatious wealth rejected, but otherwise fair and open |
| **Technocratic** | — | Water, Food @8% | 0.6× | Innovation-focused — basics taxed to fund research, minimal enforcement. Best market for advanced goods |
| **Militarist** | — | Electronics, Machinery @10% | 1.3× | War economy — industrial goods appropriated for military use, military patrols enforce compliance |
| **Theocratic** | Weapons, Chemicals, Luxuries | — | 1.4× | Ideological — immoral goods banned, zealous inspection corps. Most restricted trade environment |

### Design Rationale

The 8 governments create a clean gradient of trade restriction:

| Restriction level | Governments | Contraband count |
|---|---|---|
| Open trade | Corporate, Frontier, Technocratic, Militarist | 0 |
| Moderate restriction | Federation, Cooperative | 1 |
| Strict restriction | Authoritarian | 2 |
| Heavy restriction | Theocratic | 3 |

Each government has a distinct smuggling/trading identity:
- **Frontier** and **Corporate** are safe destinations for any cargo — no inspection risk
- **Technocratic** is open to trade but taxes staple goods (water, food) to fund research — traders bringing basics pay a premium, but advanced/luxury goods flow freely
- **Militarist** has no contraband because a war economy *wants* everything flowing in — it taxes industrial goods instead, appropriating electronics and machinery for the military. High inspection rate means smugglers bringing contraband *through* militarist space get caught often
- **Cooperative** bans luxuries — egalitarian values reject ostentatious wealth. Neutral inspection rate
- **Theocratic** is the hardest to trade with — three contraband goods and high inspection. Chemicals maps to "narcotics" (closest match in the 12-good catalog). But theocratic systems pay premiums for basic goods they can't easily produce

### Black Markets

**Black markets** (see [system-enrichment.md](./system-enrichment.md) §5) bypass government restrictions entirely — all goods are available regardless of government type. This creates the smuggling loop: buy restricted goods at a black market or frontier system, transport them through restricted space (risking inspection), sell at another black market for a premium.

### Customs House Facility

The base contraband inspection chance is set by government type (25% base × government modifier). The **Customs House** facility (system-enrichment.md §5) adds a per-system bonus on top:

`effective_inspection_chance = government_base × government_modifier + customs_house_bonus`

This makes inspection rates system-specific, not just government-specific. Smugglers route around customs house systems even within the same government territory. Destroying a customs house during wartime opens smuggling routes — a strategic consideration.

---

## 5. Fuel and Refueling

All systems offer refueling — no system lacks the ability to refuel a ship. The base cost remains universal (currently 2 CR per fuel unit).

The **Fuel Depot** facility (see [system-enrichment.md](./system-enrichment.md) §5) provides a discount on refueling at that system. Higher-tier fuel depots give larger discounts. This makes fuel depots valuable waypoints for long-haul routes but never gates access — a player can always refuel, they just pay more at systems without a depot.

---

## 6. War Zone Navigation Effects

**New section** — how active wars ([war-system.md](./war-system.md)) modify the navigation experience. Wars create the most dangerous travel conditions in the game and are where convoy mechanics matter most.

### War Zone Danger

War zones are an additional danger source, additive with government baseline and events:

```
totalDanger = min(governmentBaseline + eventDanger + warZoneDanger, 0.5)
```

The 0.5 cap prevents danger from becoming a guaranteed loss — even in the worst conditions, there's always a chance of safe passage.

**Danger values by war state:**

| System state | War zone danger | Duration | Notes |
|---|---|---|---|
| **Contested** (active battle) | ~0.20–0.25 | While war is active | Systems being actively fought over ([war-system.md §5.1](./war-system.md)). Highest sustained danger |
| **Staging** (border, no active battle) | ~0.10–0.15 | While war is active | Border systems adjacent to contested zones. Military buildup, supply convoys, nervous patrols |
| **Recently captured** | ~0.15 → decaying | Post-capture, fades over ~50 ticks | Post-capture instability — resistance, looting, power vacuum. Decays as the new faction establishes control |
| **Rear territory** | 0 | — | Deep in either faction's territory. War doesn't increase danger away from the front |

These are tuning numbers — exact values set during implementation and simulation.

### Pipeline Interaction

War zone danger feeds into the existing pipeline through the total danger calculation:

- **Stage 1 (Hazard)**: Indirectly affected — higher total danger means hazard incidents are more likely in contested systems, but the primary driver is still cargo hazard level
- **Stage 4 (Event Loss)**: Directly affected — war zone danger adds to the event-based loss probability. This is the main impact: pirates exploiting the chaos, debris from battles, military engagements that catch civilian ships in crossfire
- **Stages 2–3 (Duty/Inspection)**: Unaffected by war danger — taxes and inspections are government policy, not combat. A system's government doesn't change during wartime (though it may change if the system is captured and the new faction has a different government type)

### Convoys in War Zones

War zones are where escort mechanics earn their keep:

- Unescorted trade ships in contested systems face very high effective danger — war zone danger stacked on event danger can approach the 0.5 cap
- A single corvette escort in a contested system reduces Stage 4 loss probability by ~50% (diminishing returns curve from §3)
- Convoy speed trade-off is sharpest here: a frigate escort gives maximum protection but crawls through the most time-sensitive space. A faster corvette gets through quicker but with less protection
- War zones create natural demand for combat ships — players who invested in escorts see their fleet composition pay off when wars break out

### Blockades

**Not in initial design.** The current system adds danger to war zones but doesn't restrict access — any ship can still plot a route through contested space, they just face higher danger. Full blockade mechanics (preventing passage entirely, requiring blockade runners) are a future extension noted in [war-system.md](./war-system.md). The danger-based system is sufficient for initial implementation and avoids the complexity of route-blocking logic.

---

## Related Design Docs

- **[Navigation (active)](../active/navigation.md)** — current implementation this doc modifies
- **[Ship Roster](./ship-roster.md)** — ship stats, escort mechanics, fleet composition, ship damage
- **[Ship Upgrades](./ship-upgrades.md)** — module catalog, slot types, danger pipeline interactions (§7)
- **[War System](./war-system.md)** — war zones, contested systems, battle mechanics
- **[Faction System](./faction-system.md)** — government types, doctrine effects on navigation
- **[System Enrichment](./system-enrichment.md)** — customs house, fuel depot, black market, drydock facilities
