# Player Facilities Design

Player-owned facilities — base building at a galactic scale. Covers both production facilities (mining operations, refineries, manufacturing) and infrastructure facilities (trade posts, warehouses, fuel stations). A unified build system handles all facility types regardless of whether they produce goods or provide passive benefits.

**Design principle**: Player facilities are a base-building mechanic on a different scale. The build system is universal — construction, upgrades, operating costs, and asset risk apply equally to all facility types. What varies is what each facility *does*, not how it's built or managed.

**Status**: Stub — needs full design discussion.

**Depends on**: [Player Progression](./player-progression.md) (mid/late game gating), [System Enrichment](./system-enrichment.md) (system traits, economy types), [Faction System](./faction-system.md) (asset seizure in conquered territory)

---

## Key Design Rules

- Economy-tied: facilities must match the system's economy type and traits
- Multiple players per system: player facilities are personal investments, not world-state modifications
- Assets at risk: subject to seizure/taxation when territory changes hands (see [Faction System §4.8](./faction-system.md))
- Tiered: minor facilities (mid game), major facilities (late game)
- Unified build system: all facility types share the same construction, upgrade, and management mechanics

## Facility Categories

| Category | Examples | Purpose |
|---|---|---|
| **Production** | Mining operation, refinery, manufacturing plant, arms foundry | Produce goods — raw materials, processed goods, war materials. Output feeds into the economy and faction war efforts |
| **Infrastructure** | Trade post, warehouse, fuel station, housing complex | Provide player benefits — better market access, storage, reduced costs, passive income. Don't produce tradeable goods |

## Open Questions

- Full facility type roster — what can players build at each economy type?
- Build system mechanics — construction time, resource costs, build queues?
- Output rates and income — how much do production facilities generate per tick? How much do infrastructure facilities save/earn?
- Upgrade paths — can minor facilities be upgraded to major, or are they separate purchases?
- Interaction with system traits — do traits boost player facility output (e.g. tier-3 asteroid belt boosts player mining operation)?
- Facility limits per player per system — how many can one player own in a single system?
- Operating costs — do facilities have upkeep that eats into profits?
- War material production — which production facilities output goods useful for faction war efforts?
- Infrastructure facility effects — how do trade posts, warehouses, and fuel stations mechanically benefit the player?
