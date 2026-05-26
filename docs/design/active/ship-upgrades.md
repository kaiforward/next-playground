# Ship Upgrades

Status: **Active** — shipped (core upgrade system).

Modular upgrade system for ships. Typed slots, module catalog, and how upgrades feed into the danger pipeline and ship stats.

**Design principle**: Upgrades are how players personalise their ships and unlock new capabilities. The base ship defines the role; upgrades let you specialise within that role. A bulk freighter with reinforced containers is a hardened hauler. The same freighter with a hidden compartment is a smuggler's hauler. Same ship, different build, different gameplay.

**Implementation**: Module catalog in `lib/constants/modules.ts`. Pure bonus aggregation in `lib/engine/upgrades.ts`. Slot validation in the same file.

---

## 1. Design Rules

- **Slot-based**: Each ship has 2–5 typed upgrade slots depending on size class. Slot layout is fixed per ship class (see [ship-roster.md §3](./ship-roster.md) for layouts)
- **Typed slots**: Slots are typed (engine, cargo, defence, systems) — prevents role-breaking builds. A freighter can't stack four defence modules because it doesn't have four defence slots
- **One module per slot**: Choices are mutually exclusive within a slot. The trade-off is opportunity cost — fitting a hidden compartment means you can't fit an expanded hold in the same cargo slot
- **Hybrid tier model**: Stat-boost modules come in three tiers (Mk I / Mk II / Mk III). Capability modules are flat unlocks
- **No module interactions**: Modules do not synergise or conflict with each other. Each module's effect is self-contained and stacks additively or multiplicatively with ship base stats. Keeps the system simple, predictable, and balanceable
- **Removable and reinstallable**: Modules are assets, not consumables. They can be removed at any drydock service and stored or moved to another ship

---

## 2. Slot Types

Four slot types govern different aspects of ship performance.

| Slot | Governs | Danger pipeline interaction |
|---|---|---|
| **Engine** | Speed, fuel efficiency, evasion | Stage 4 — manoeuvring thrusters add to evasion-based event cargo-loss reduction |
| **Cargo** | Cargo capacity, cargo protection, contraband concealment | Stage 1 — reinforced containers reduce hazard loss severity. Stage 3 — hidden compartment conceals cargo from inspection. Stage 4 — reinforced containers also reduce event cargo-loss severity |
| **Defence** | Hull, shield, point defence | Stage 1 — armour plating raises hull, reducing hazard loss severity. Stage 5 — armour and shield boost hull/shield damage absorption. Stage 4 — point defence array reduces event cargo-loss probability |
| **Systems** | Sensors, automation, hull repair | Stage 3 indirectly via sensors-on-trade-mission contexts; otherwise no direct pipeline interaction |

The danger pipeline stages reference [Navigation](./navigation.md) and the ship-stat pipeline in [Ship Roster §4.3](./ship-roster.md).

---

## 3. Module Catalog

Twelve modules — three per slot type. Each module is either **tiered** (Mk I/II/III stat boosts) or **capability** (flat unlock).

### Engine Modules

| Module | Type | Effect |
|---|---|---|
| **Fuel Optimiser** | Tiered (Mk I/II/III) | Fractional reduction to fuel consumed per hop. Stacks multiplicatively across multiple optimisers |
| **Thruster Upgrade** | Tiered (Mk I/II/III) | Additive `speedBonus` — fewer ticks per hop |
| **Manoeuvring Thrusters** | Capability | Additive `evasionBonus` applied in the event cargo-loss stage. Lets trade ships dodge event hazards without combat-spec hulls |

### Cargo Modules

| Module | Type | Effect |
|---|---|---|
| **Expanded Hold** | Tiered (Mk I/II/III) | Additive cargo capacity bonus. The bread-and-butter trade upgrade |
| **Reinforced Containers** | Tiered (Mk I/II/III) | Multiplicatively stacking reduction to cargo loss *severity* in both hazard incidents (Stage 1) and event-based cargo loss (Stage 4). Doesn't prevent incidents — contains the damage when they happen |
| **Hidden Compartment** | Capability | Conceals a fixed fraction of cargo (currently 30%) from contraband inspection. Capped at 90% even if multiple are somehow installed |

### Defence Modules

| Module | Type | Effect |
|---|---|---|
| **Armour Plating** | Tiered (Mk I/II/III) | Additive hull bonus. Raises both hazard-stage severity reduction and Stage 5 damage capacity |
| **Shield Booster** | Tiered (Mk I/II/III) | Additive shield capacity bonus. Improves Stage 5 damage absorption and combat shield pool |
| **Point Defence Array** | Capability | Multiplicatively stacking reduction to event cargo-loss *probability*. Distinct from evasion — point defence destroys incoming threats rather than dodging them |

### Systems Modules

| Module | Type | Effect |
|---|---|---|
| **Scanner Array** | Tiered (Mk I/II/III) | Additive sensors bonus. Feeds into survey-mission stat gates and detection mechanics |
| **Automation Module** | Capability *(placeholder — no behavior yet)* | Reserved slot/cost for future automated trade-route execution. The flag exists on the bonus bundle but no processor reads it yet. `[PENDING: automation]` |
| **Repair Bay** | Capability *(placeholder — no behavior yet)* | Hull regen rate is computed but no tick processor currently applies it. Hull repair today is manual at shipyards. `[PENDING: hull-regen-processor]` |

### Module Design Notes

- **3 modules per slot** keeps choices meaningful. With one slot, three options is enough variety for distinct builds without analysis paralysis
- **Tiered modules** provide incremental power progression
- **Capability modules** are build-defining choices. Hidden Compartment commits a cargo slot to smuggling instead of hauling capacity. Manoeuvring Thrusters sacrifices speed or fuel efficiency for survivability
- **Stacking rules** are explicit per stat in `computeUpgradeBonuses()` — fuel cost, loss severity, and cargo-loss probability stack multiplicatively (`1 - (1 - a)(1 - b)`); everything else stacks additively

---

## 4. Slot Layouts Per Ship Class

See [Ship Roster §3](./ship-roster.md) for the slot layout of each of the 12 classes. Small ships have 2 slots, medium have 3–4, large have 4–5. Layouts reinforce role identity — a Blockade Runner has the three slot types a smuggler needs; a Frigate has three defence slots for deep combat customisation.

---

## 5. Installation, Removal, Cost

- **Installation**: Modules are purchased and fitted at any system's drydock service. There is no facility-tier gating today. `[PENDING: facilities]`
- **Purchase cost**: One-time credit cost set per module tier in `MODULES`. Mk III modules are an order of magnitude more expensive than Mk I
- **Removal**: Free; the module goes back to the player's inventory and can be installed on another ship
- **Loss**: Ship destruction would destroy installed modules along with the ship, but the destruction path is not yet wired up — ships currently disable at hull 0 rather than destruct (see [Ship Roster §5.3](./ship-roster.md)). `[PENDING: combat-destruction]`

---

## 6. Upgrade Interactions with Other Systems

### Danger Pipeline

Modules interact with the arrival danger pipeline at specific stages. No module affects more than two stages — keeps each module's role clear and prevents any single build from trivialising the pipeline.

| Pipeline stage | Relevant modules | Mechanism |
|---|---|---|
| **Stage 1: Hazard Incidents** | Armour Plating, Reinforced Containers | Hull (armour) reduces severity. Containers reduce cargo loss percentage. Both reduce *how much* you lose, not *whether* you lose |
| **Stage 2: Import Duty** | None | Government tax. No module bypasses taxes |
| **Stage 3: Contraband Inspection** | Hidden Compartment (+ base stealth stat) | Stealth (base stat, no current boost module) reduces inspection chance. Compartment conceals a fraction of cargo if inspection happens |
| **Stage 4: Event-Based Cargo Loss** | Manoeuvring Thrusters, Point Defence Array, Reinforced Containers | Manoeuvring (evasion bonus) and point defence reduce loss probability. Containers reduce loss severity if it triggers |
| **Stage 5: Hull/Shield Damage** | Armour Plating, Shield Booster | Increased hull and shield capacity directly raise the buffer absorbed before any damage applies. Escort firepower (not a module) further reduces damage chance and severity |

### Automation (Future)

The Automation Module is currently a placeholder. The bonus bundle exposes `hasAutomation: boolean` but no processor consumes it. When automated trading ships, it will likely become a per-ship enabler with tiered behaviour gated on module tier. See `docs/design/planned/player-progression.md` for the design intent. `[PENDING: automation]`

### Module Independence

Modules do not interact with each other. There are no set bonuses, no synergy effects, and no conflict penalties. Each module's effect is self-contained.

This is a deliberate simplicity decision. The interesting choices come from slot allocation (which module goes in which slot) and fleet composition (which ships get which upgrades), not from memorising combo tables.

---

## 7. Future Extensions

Tagged with `[PENDING: <system>]` so they're greppable. Run `grep -r "\[PENDING:" docs/design/active/` to find all deferred work across active specs.

- **Faction-exclusive modules** — six factions each offer a unique capability module at homeworld drydocks, gated by Champion reputation. `[PENDING: faction-system]`
- **Drydock facility tiers** — restricting which tier of module a drydock can install. `[PENDING: facilities]`
- **Module upkeep costs** — per-tick operating cost while installed. Designed as the economic governor on automation fleet size. `[PENDING: automation]`
- **Automation strategy tiers** — Basic/Standard/Advanced strategy variants. The single capability flag exists today; the strategy fanout arrives with the automation processor. `[PENDING: automation]`
- **Passive hull regen via Repair Bay** — the stat is computed but no processor applies it between voyages yet. `[PENDING: hull-regen-processor]`

---

## Related Design Docs

- **[Ship Roster](./ship-roster.md)** — base ship stats, size categories, slot layouts, danger pipeline ship-stat integration
- **[Navigation](./navigation.md)** — arrival danger pipeline stages
- **[Combat](./combat.md)** — combat damage interactions (relevant to armour/shield modules)
