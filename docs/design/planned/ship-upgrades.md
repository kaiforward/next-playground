# Ship Upgrades Design

Modular upgrade system for ships. Typed upgrade slots, module catalog, drydock tier requirements, and how upgrades gate gameplay mechanics like automation, smuggling, and enhanced combat.

**Design principle**: Upgrades are how players personalise their ships and unlock new capabilities. The base ship defines the role; upgrades let you specialise within that role. A bulk freighter with an automation module is a hands-off income generator. The same freighter with a hidden compartment is a smuggler's hauler. Same ship, different build, different gameplay.

**Depends on**: [Ship Roster](./ship-roster.md) (base ship stats, slot counts), [System Enrichment](./system-enrichment.md) (drydock tiers), [Player Progression](./player-progression.md) (progression gating)

---

## 1. Design Rules

- **Slot-based**: Each ship has 2–5 typed upgrade slots depending on size class. Slot layout is fixed per ship class (see §4)
- **Typed slots**: Slots are typed (engine, cargo, defence, systems) — prevents role-breaking builds. A freighter can't stack four defence modules because it doesn't have four defence slots
- **One module per slot**: Choices are mutually exclusive within a slot. The trade-off is opportunity cost — fitting a hidden compartment means you can't fit an expanded hold in the same cargo slot
- **Hybrid tier model**: Stat-boost modules come in three tiers (Mk I / Mk II / Mk III), gated by drydock tier. Capability modules are flat unlocks gated by a minimum drydock tier (see §3)
- **No module interactions**: Modules do not synergise or conflict with each other. The only trade-off is slot opportunity cost. This keeps the system simple, predictable, and balanceable — players don't need to memorise combo tables
- **Removable and reinstallable**: Modules are assets, not consumables. They can be removed at any drydock and stored or moved to another ship. Removal is free; reinstallation has a small fee (see §6)
- **Installed at drydocks**: All module purchases and installations happen at drydock facilities ([System Enrichment §5.3](./system-enrichment.md)). Higher-tier drydocks stock higher-tier modules

---

## 2. Slot Types

Four slot types govern different aspects of ship performance. Each type maps to specific stats and danger pipeline stages.

| Slot | Governs | Danger pipeline interaction |
|---|---|---|
| **Engine** | Speed, fuel efficiency, evasion | Stage 4 — evasion reduces event-based cargo loss probability |
| **Cargo** | Cargo capacity, cargo protection, contraband concealment | Stage 1 — reinforced containers reduce hazard loss severity. Stage 3 — hidden compartment conceals cargo from inspection. Stage 4 — point defence (defence slot) also applies |
| **Defence** | Hull, stealth, countermeasures | Stage 1 — hull reduces hazard loss severity. Stage 3 — stealth reduces inspection chance. Stage 4 — point defence reduces event cargo loss |
| **Systems** | Sensors, automation, hull repair | No direct pipeline interaction — sensors are for detection/intel, automation for trade strategy |

The danger pipeline stages reference [Navigation §Arrival](../active/navigation.md) and the expanded ship-stat pipeline in [Ship Roster §4.3](./ship-roster.md).

---

## 3. Module Catalog

Twelve modules — three per slot type. Each module is either **tiered** (Mk I/II/III stat boosts, gated by drydock tier 1/2/3) or **capability** (flat unlock gated by a minimum drydock tier).

### Engine Modules

| Module | Type | Drydock tier | Effect |
|---|---|---|---|
| **Fuel Optimiser** | Tiered (Mk I/II/III) | T1 / T2 / T3 | Reduces fuel consumption per hop. Extends effective range without increasing fuel capacity. Makes long-haul routes more profitable |
| **Thruster Upgrade** | Tiered (Mk I/II/III) | T1 / T2 / T3 | Increases speed (fewer ticks per hop). Directly improves travel time and time-sensitive mission performance |
| **Manoeuvring Thrusters** | Capability | T2 | Bonus evasion in the danger pipeline (Stage 4). The "dodge" module — gives trade ships a fighting chance against event hazards without needing a combat-spec hull |

### Cargo Modules

| Module | Type | Drydock tier | Effect |
|---|---|---|---|
| **Expanded Hold** | Tiered (Mk I/II/III) | T1 / T2 / T3 | Increases cargo capacity. The bread-and-butter trade upgrade — more cargo per trip means more profit per run |
| **Reinforced Containers** | Tiered (Mk I/II/III) | T1 / T2 / T3 | Reduces cargo loss severity in hazard incidents (Stage 1) and event-based cargo loss (Stage 4). Doesn't prevent incidents — contains the damage when they happen |
| **Hidden Compartment** | Capability | T2 | Conceals a portion of cargo from contraband inspection (Stage 3). The smuggler's module — inspection still happens, but hidden goods aren't found. Portion concealed is fixed (not tiered) to keep smuggling a deliberate build choice, not an incremental upgrade |

### Defence Modules

| Module | Type | Drydock tier | Effect |
|---|---|---|---|
| **Armour Plating** | Tiered (Mk I/II/III) | T1 / T2 / T3 | Increases hull stat. Reduces hazard loss severity (Stage 1 — sturdier ship contains dangerous cargo better) and improves combat durability. The defensive staple |
| **Stealth Coating** | Tiered (Mk I/II/III) | T1 / T2 / T3 | Increases stealth stat. Reduces contraband inspection chance (Stage 3). Essential for smuggling builds alongside Hidden Compartment — stealth avoids the scan, compartment hides what gets through |
| **Point Defence Array** | Capability | T2 | Reduces event-based cargo loss probability (Stage 4). Automated turrets that shoot down debris, intercept pirate boarding, and deflect environmental hazards. Distinct from evasion — point defence destroys threats rather than dodging them |

### Systems Modules

| Module | Type | Drydock tier | Effect |
|---|---|---|---|
| **Scanner Array** | Tiered (Mk I/II/III) | T1 / T2 / T3 | Increases sensors stat. Better detection range for intel, exploration, and threat assessment. Higher tiers reveal more detailed market/event information from further systems |
| **Automation Module** | Capability tiers | T1 / T2 / T3 | Enables automated trading. Each drydock tier unlocks a strategy tier: T1 = Basic (greedy), T2 = Standard (nearest), T3 = Advanced (optimal). Per-ship upgrade — each ship needs its own module. See [Player Progression §5](./player-progression.md) for automation behaviour |
| **Repair Bay** | Capability | T2 | Restores hull between voyages without visiting a shipyard. Reduces maintenance downtime for ships operating far from friendly ports. Depends on the ship damage mechanic ([Ship Roster §5.3](./ship-roster.md)) — without hull damage, this module has no effect |

### Module Design Notes

- **3 modules per slot** keeps choices meaningful. With one slot, you have exactly three options — enough variety for distinct builds without analysis paralysis
- **Tiered modules** are the incremental power progression. Players revisit drydocks as they access higher tiers, creating a natural reason to travel to well-equipped systems
- **Capability modules** are build-defining choices. Fitting a Hidden Compartment commits a cargo slot to smuggling instead of hauling capacity. Fitting Manoeuvring Thrusters sacrifices speed or fuel efficiency for survivability. These are the interesting decisions
- **Automation Module** is unique — it has tiered capabilities (Basic/Standard/Advanced) but each tier is a complete replacement, not an upgrade-in-place. You buy the T2 module to replace the T1

---

## 4. Slot Layouts Per Ship Class

Each ship class has a fixed slot layout that reinforces its role identity. Players can't add or change slot types — only choose which module goes in each slot. Fewer total slots means more specialisation (every slot matters); more slots means more flexibility.

### Small Ships — 2 slots

| Ship | Role | Layout | Build identity |
|---|---|---|---|
| **Shuttle** | Generalist | 1 engine, 1 systems | Starter ship. Engine slot for speed or fuel. Systems slot for scanner or basic automation. No cargo/defence slots — the shuttle is meant to be outgrown |
| **Light Freighter** | Trade | 1 cargo, 1 engine | Pure hauler. Expanded hold or hidden compartment + speed or fuel efficiency. Two slots, two meaningful choices |
| **Interceptor** | Combat | 1 engine, 1 defence | Fast attack. Thruster upgrade for pursuit speed + armour or stealth. No cargo slots — this ship fights, not trades |
| **Scout Skiff** | Scout | 1 engine, 1 systems | Exploration. Speed or range + scanner array. Similar to shuttle but role-focused — the scout's systems slot is for sensors, not automation |

### Medium Ships — 3–4 slots

| Ship | Role | Slots | Layout | Build identity |
|---|---|---|---|---|
| **Bulk Freighter** | Trade | 4 | 2 cargo, 1 engine, 1 systems | Trade workhorse. Two cargo slots allow mixing (expanded hold + reinforced containers) or doubling down. Engine for efficiency, systems for automation |
| **Corvette** | Combat | 4 | 1 engine, 2 defence, 1 systems | Warship. Two defence slots for armour + stealth or armour + point defence. Engine for speed, systems for sensors |
| **Blockade Runner** | Stealth | 3 | 1 cargo, 1 defence, 1 systems | The smuggler. Exactly three slots — hidden compartment, stealth coating, and automation or scanner. Every slot has a natural choice for the smuggling build |
| **Survey Vessel** | Scout | 3 | 1 engine, 1 defence, 1 systems | Deep explorer. Speed or range, survivability, and advanced sensors. Three slots for a ship that goes far and comes back alive |

### Large Ships — 4–5 slots

| Ship | Role | Slots | Layout | Build identity |
|---|---|---|---|---|
| **Heavy Freighter** | Trade | 5 | 2 cargo, 1 engine, 1 defence, 1 systems | Trade titan. Full coverage — bulk cargo, speed, protection, and automation. The late-game money machine |
| **Frigate** | Combat | 5 | 1 engine, 3 defence, 1 systems | Pure warship. Three defence slots for deep combat customisation — armour + stealth + point defence, or triple armour for maximum hull |
| **Stealth Transport** | Stealth | 4 | 2 cargo, 1 defence, 1 systems | Large-scale smuggler. Two cargo slots (hidden compartment + expanded hold), stealth coating, automation. No engine slot — the stealth transport relies on concealment, not speed |
| **Command Vessel** | Support | 5 | 1 engine, 1 defence, 3 systems | Fleet brain. Three systems slots allow scanner array + automation + repair bay. The support ship that sees everything, runs itself, and patches up between engagements |

### Layout Design Rationale

- **Role reinforcement**: A ship's slot layout pushes it toward its intended role. The Blockade Runner has exactly the three slot types a smuggler needs. The Frigate's three defence slots make it the obvious combat choice
- **Fewer slots = more committed**: Small ships with 2 slots force hard choices (speed vs sensors, cargo vs defence). This makes early-game decisions impactful and gives reason to upgrade to larger ships
- **More slots = more flexibility**: Large ships can cover multiple bases. A Heavy Freighter can trade, protect its cargo, and automate — but a focused Bulk Freighter with 2 cargo slots might haul more per slot
- **No universal slot**: Every ship has at least one engine or systems slot, but no ship has all four types. This prevents any single ship from doing everything well

---

## 5. Faction-Exclusive Modules

Each major faction offers one unique module at their homeworld drydock, available only to players with **Champion reputation (+75)**. These are capability modules, not stat boosts — they unlock faction-specific gameplay rather than providing raw numbers.

| Faction | Module | Slot | Effect | Identity |
|---|---|---|---|---|
| **Terran Sovereignty** | Aegis Shield Generator | Defence | Absorbs a fixed amount of hull damage per voyage before hull HP is affected. Recharges at any port | Protectionist doctrine — their technology protects. Defensive, reliable, reduces repair costs for ships operating in dangerous space |
| **Kessari Dominion** | Siege Projector | Defence | Increases combat power contribution in faction war battles. No effect outside war combat | Expansionist doctrine — their technology conquers. Pure military power, useless for traders, devastating for war-focused players |
| **Meridian Compact** | Trade Nexus Uplink | Systems | Reduces buy/sell spread at all markets. Small but universal margin improvement | Mercantile doctrine — their technology profits. Every trade is slightly more profitable. Compounds across a fleet of automated trade ships |
| **Ashvari Hegemony** | Intimidation Array | Systems | Reduces pirate event probability and contraband inspection severity at the ship's current system | Hegemonic doctrine — their technology dominates through presence. Safer operations just by being there |
| **Free Reaches** | Phase Cloak | Defence | When fleeing a combat encounter, guarantees escape regardless of evasion roll. One use per voyage, recharges at port | Opportunistic doctrine — their technology escapes. Hit-and-run philosophy. Take the trade, dodge the consequences |
| **Solari Collective** | Fleet Harmony Core | Systems | Provides a small stat bonus to all allied ships in the same system. Stacks with convoy escort mechanics but at diminishing returns | Cooperative doctrine — their technology strengthens the group. Force multiplier for coordinated fleets |

### Design Constraints

- **One faction module per ship**: Faction modules use a typed slot, so they compete with standard modules for that slot. Fitting a Siege Projector means giving up armour plating or stealth coating
- **No cross-faction access**: Players cannot buy or install another faction's exclusive module, even if they have the reputation. This makes faction choice meaningful for fleet builds
- **Not strictly better**: Each module trades a standard slot for a unique capability. A Terran shield generator is powerful, but it takes the same defence slot as Stealth Coating. Players must decide whether the faction perk outweighs a standard upgrade for their build

---

## 6. Cost Model

Module costs create meaningful economic decisions at each progression phase. Exact values are tuning numbers for implementation — the structure matters more than the specifics.

### Purchase

One-time cost at a drydock. The player buys the module and owns it permanently.

| Module tier | Approximate cost range | Notes |
|---|---|---|
| Mk I / T1 capability | Low (hundreds) | Accessible in early game. First upgrade on a new ship |
| Mk II / T2 capability | Moderate (low thousands) | Mid-game investment. Worth it for ships that will see heavy use |
| Mk III | Expensive (several thousand) | Late-game. Only makes sense on large, high-value ships |
| Faction-exclusive | Very expensive (tens of thousands) | Prestige purchase. Requires Champion reputation + homeworld drydock access |

### Upkeep

Per-tick operating cost while the module is installed. Referenced by [Ship Roster §4.4](./ship-roster.md) as part of fleet operating costs. Higher-tier and more powerful modules cost more to run.

- Tiered modules: upkeep scales with tier (Mk III costs more to maintain than Mk I)
- Capability modules: flat upkeep proportional to the module's power
- Automation modules: additional per-tick processing cost that scales with strategy complexity (Advanced costs significantly more than Basic). This is the economic limit on automation fleet size — see [Player Progression §5](./player-progression.md)
- Faction modules: moderate upkeep — prestigious but not punishing

### Removal and Reinstallation

- **Removal**: Free at any drydock. The module goes into the player's inventory
- **Reinstallation**: Small fee at any drydock (fraction of purchase price). Covers fitting and calibration. Not tier-gated — any drydock can install any module the player already owns
- **No destruction**: Modules are never consumed or destroyed through normal use. Ship destruction (see [Ship Roster §5.3](./ship-roster.md)) destroys all installed modules along with the ship — this is the risk

### Economic Design Intent

- Early game: players buy one or two Mk I modules for their starter ships. Low cost, noticeable improvement
- Mid game: players outfit a growing fleet. Per-ship upgrade costs add up — choosing which ships get Mk II modules first is a meaningful allocation decision
- Late game: Mk III modules on capital ships are expensive individually but represent fine-tuning rather than transformation. Faction modules are prestige purchases for players committed to a faction
- Upkeep prevents "install and forget" — a fleet of 10 ships all running Mk III modules and Advanced automation has serious ongoing costs. Players balance module power against operating efficiency

---

## 7. Upgrade Interactions with Other Systems

### Danger Pipeline

Modules interact with the arrival danger pipeline at specific stages. No module affects more than two stages — keeps each module's role clear and prevents any single build from trivialising the pipeline.

| Pipeline stage | Relevant modules | Mechanism |
|---|---|---|
| **Stage 1: Hazard Incidents** | Armour Plating, Reinforced Containers | Hull (armour) reduces severity. Containers reduce cargo loss percentage. Both reduce *how much* you lose, not *whether* you lose |
| **Stage 2: Import Duty** | None | Government tax. No module bypasses taxes |
| **Stage 3: Contraband Inspection** | Stealth Coating, Hidden Compartment | Stealth reduces inspection *chance*. Compartment conceals cargo if inspected. Layered defence — stealth avoids the check, compartment survives it |
| **Stage 4: Event-Based Cargo Loss** | Manoeuvring Thrusters, Point Defence Array, Reinforced Containers | Evasion (thrusters) and point defence reduce loss *probability*. Containers reduce loss *severity* if it triggers. Three modules can influence this stage but through different mechanisms |

### Automation

The Automation Module enables the ship automation system described in [Player Progression §5](./player-progression.md). Key interactions:

- **Per-ship**: Each ship needs its own module. No global unlock
- **Strategy gating**: Module tier determines available strategy (Basic/Standard/Advanced)
- **Processing cost**: Advanced automation modules have higher per-tick upkeep, creating the economic limit on automated fleet size
- **Trade-only**: Automation covers trade routes. Missions and war contributions remain manual

### War System

Combat-relevant upgrades factor into the combat power rating used for faction battles ([Ship Roster §1.3](./ship-roster.md)):

- Armour Plating increases hull → higher combat power
- Stealth Coating increases stealth → affects combat survivability
- Point Defence Array → minor combat power bonus
- Faction combat modules (Siege Projector) → direct combat power modifier

Non-combat modules (Expanded Hold, Automation Module, etc.) do not affect combat power.

### Module Independence

Modules do not interact with each other. There are no set bonuses, no synergy effects, and no conflict penalties. Each module's effect is self-contained and stacks additively with ship base stats.

This is a deliberate simplicity decision. The interesting choices come from slot allocation (which module goes in which slot) and fleet composition (which ships get which upgrades), not from memorising combo tables. A player can evaluate each module on its own merits without needing a spreadsheet.

---

## Related Design Docs

- **[Ship Roster](./ship-roster.md)** — base ship stats, size categories, slot counts, combat power, fleet operating costs, ship damage
- **[System Enrichment](./system-enrichment.md)** — drydock facility tiers, facility placement, trait prerequisites
- **[Player Progression](./player-progression.md)** — game arc phases, automation tiers, faction reputation gating
- **[Navigation](../active/navigation.md)** — arrival danger pipeline stages, current implementation
- **[Faction System](./faction-system.md)** — faction identities, reputation tiers (Champion for exclusive modules), war mechanics
