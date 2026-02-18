# Production System Design

Production facilities and the mechanics of player-driven goods production. Covers what production facilities create, input requirements, how output enters the economy, supply chain integration, and war material flow.

**Design principle**: Production facilities use the universal build system from [Player Facilities](./player-facilities.md) — construction, upgrades, operating costs, limits, and asset risk are inherited. This document only defines what makes production facilities unique: what they produce and how that production interacts with the game world.

**Status**: Stub — needs full design discussion.

**Depends on**: [Player Facilities](./player-facilities.md) (build system), [Economy](../active/economy.md) (market integration), [System Enrichment](./system-enrichment.md) (traits, economy types), [Simulation Enhancements](./simulation-enhancements.md) (supply chain dependencies)

---

## Open Questions

- **Production facility roster**: What can players build at each economy type? How do facilities map to goods?
- **Output model**: Do produced goods enter the system's market (affecting supply/demand), or go to a player inventory for manual sale? Or both?
- **Input requirements**: Do production facilities consume input goods (supply chain recipes), or produce from nothing?
- **Trait quality multipliers**: How do system trait quality tiers affect production rates?
- **War material production**: Which facilities produce goods useful for faction war efforts? How does that contribution flow?
- **Warehouse integration**: How do warehouses buffer production output? What happens when storage is full?
- **New goods**: Does the production system introduce new goods beyond the current 12, or work within the existing roster?
- **Economy processor interaction**: Does player production feed into the existing economy tick processor, or run in its own processor?
- **Passive selling**: How do produced goods become credits? Automatic sale at market price? Player must manually sell? Automated sell orders?

---

## Related Design Docs

- **[Player Facilities](./player-facilities.md)** — universal build system (construction, upgrades, costs, limits, asset risk)
- **[Economy](../active/economy.md)** — market simulation, supply/demand, production/consumption rates
- **[System Enrichment](./system-enrichment.md)** — system traits, economy types, trait quality tiers
- **[Simulation Enhancements](./simulation-enhancements.md)** — supply chain dependencies, production recipes
- **[Faction System](./faction-system.md)** — war material demand, faction economy effects
- **[Player Progression](./player-progression.md)** — production facilities as mid/late game content
