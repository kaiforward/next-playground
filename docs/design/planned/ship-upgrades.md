# Ship Upgrades Design

Modular upgrade system for ships. Typed upgrade slots, module catalog, drydock tier requirements, and how upgrades gate gameplay mechanics like automation, smuggling, and enhanced combat.

**Design principle**: Upgrades are how players personalise their ships and unlock new capabilities. The base ship defines the role; upgrades let you specialise within that role. A bulk freighter with an automation module is a hands-off income generator. The same freighter with a hidden compartment is a smuggler's hauler. Same ship, different build, different gameplay.

**Status**: Stub — needs full design discussion.

**Depends on**: [Ship Roster](./ship-roster.md) (base ship stats, slot counts), [System Enrichment](./system-enrichment.md) (drydock tiers), [Player Progression](./player-progression.md) (progression gating)

---

## Key Design Rules

- Slot-based: each ship has 2–5 typed upgrade slots depending on size
- Slots are typed (engine, cargo, defence, systems) — prevents role-breaking builds
- One module per slot — choices are mutually exclusive within a slot
- Modules purchased and installed at drydocks — higher-tier drydocks offer better modules
- Some modules gate gameplay mechanics (automation, smuggling compartments, scanner arrays)
- Modules can be removed and reinstalled — not permanently consumed

## Slot Types

| Slot | Governs | Example modules |
|---|---|---|
| **Engine** | Speed, fuel efficiency, evasion | Fuel optimiser, afterburner, manoeuvring thrusters |
| **Cargo** | Cargo capacity, cargo protection, special storage | Expanded hold, hidden compartment (smuggling), refrigerated bay, reinforced containers |
| **Defence** | Hull, shields, stealth, countermeasures | Armour plating, stealth coating, point defence, ECM suite |
| **Systems** | Sensors, automation, crew support, special abilities | Automation module (per tier), advanced scanner, crew quarters, communication array |

## Open Questions

- Full module catalog — what modules exist for each slot type?
- Module tiers — do modules have quality tiers like traits, or is it a flat catalog?
- Drydock tier requirements — which modules require tier-2 or tier-3 drydocks?
- Faction-exclusive modules — do factions offer unique upgrade modules at their drydocks?
- Module costs — purchase price, installation cost, removal cost?
- Interaction between modules — do any modules have synergies or conflicts?
- Ship class restrictions — can all ships equip all module types, or do some classes restrict certain modules?
