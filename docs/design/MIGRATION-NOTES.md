# Migration Notes

How the planned systems (`docs/design/planned/`) layer over the active implementation (`docs/design/active/`). SPEC.md describes what exists today. The planned docs describe what's coming. This document is the bridge — it maps the implementation roadmap and tracks what changes in the active systems when each planned system ships.

When a planned system is implemented, its design doc moves from `planned/` to `active/`, SPEC.md is updated to reflect the new system, and the corresponding migration items below are deleted.

---

## Implementation Roadmap

The planned systems form layers. Each layer adds value independently and creates the foundation for the next. Within a layer, systems can often be built in parallel. The layers are ordered by dependency — earlier layers don't reference later ones, but later layers build on earlier ones.

### Layer 0 — World Foundation

Enriches the physical universe that everything else builds on. No new gameplay systems — just richer world generation.

| System | What it does | Stands alone? |
|---|---|---|
| [System Enrichment](./planned/system-enrichment.md) §1–3 | Traits, quality tiers, trait-to-economy derivation, region themes | Yes — replaces current top-down economy assignment with bottom-up trait scoring. Current government/region model stays until factions ship |

**Why first**: Every later system references traits — factions value them, ships dock at facilities built on them, missions are flavoured by them. Without traits, the rest of the planned systems have nothing to hang on.

**What changes**: World generation pipeline. Economy type assignment moves from top-down (region identity) to bottom-up (trait affinity scoring). Active docs affected: universe.md, economy.md (production modifiers gain trait quality multipliers).

### Layer 1 — Fleet Expansion

Expands what players fly and how travel works. Builds on enriched systems (shipyard/drydock tiers are trait-gated) but can be implemented with stub facility data if Layer 0 isn't fully complete.

| System | What it does | Depends on |
|---|---|---|
| [Ship Roster](./planned/ship-roster.md) | 2 → 12 ship classes, 2 → 10 stats, size/role system, combat power | Layer 0 (shipyard tiers) |
| [Ship Upgrades](./planned/ship-upgrades.md) | 12 modules (4 slot types), hybrid tier model, fixed slot layouts per ship class, faction-exclusive modules, cost/upkeep model | Ship Roster |
| [Navigation Changes](./planned/navigation-changes.md) §1–3 | Convoys, speed-based travel, ship stats in danger pipeline | Ship Roster |

**Why second**: Ships are the player's primary asset. Expanding the roster creates the fleet composition decisions that make convoys, automation, and faction-gating meaningful. The danger pipeline gains depth from ship stats without requiring factions.

**What changes**: Navigation.md ship section entirely replaced. Travel time becomes speed-dependent. Danger pipeline gains hull/stealth/evasion modifiers. Constants expand (ship definitions, upgrade definitions).

### Layer 2 — Political Layer

The big structural change. Named factions replace regions as the primary territorial unit. Government type moves from per-region to per-faction. Wars create demand for player activity.

| System | What it does | Depends on |
|---|---|---|
| [Faction System](./planned/faction-system.md) | Factions, territory, reputation, relations, alliances, government migration | Layer 0 (traits define strategic value) |
| [War System](./planned/war-system.md) | Border conflicts (ambient), faction wars (interactive), battles, territory capture | Faction System |
| [Navigation Changes](./planned/navigation-changes.md) §4 | Contraband/goods restrictions by government type, black markets | Faction System (government per faction) |
| [System Enrichment](./planned/system-enrichment.md) §5 | Faction facilities (shipyards, naval bases, etc.), facility tiers, war targets | Faction System + Layer 0 |

**Why third**: Factions are the demand engine — they give players reasons to trade beyond profit. But they're a large structural migration (government ownership, spawn logic, tick processors) so they need the simpler foundation layers stable first.

**What changes**: Government ownership moves from region to faction. Universe.md region model changes significantly. New tick processors for relation drift, war resolution, territory control. Economy processing gains faction-level modifiers. Danger pipeline gains war zone effects. Spawn logic changes (players start in faction space).

### Layer 3 — Content & Missions

Expands what players do with the systems from Layers 0–2. More mission types, in-system activities, deeper economy simulation.

| System | What it does | Depends on |
|---|---|---|
| [Missions](./planned/missions.md) | Operational missions (patrol, escort, intel), faction missions, war contributions | Layers 1–2 (ships, factions, facilities) |
| [In-System Gameplay](./planned/in-system-gameplay.md) | Second gameplay space — story, missions, activities within docked systems | Layer 0 (trait-driven flavour), Layer 2 (faction missions) |
| [Simulation Enhancements](./planned/simulation-enhancements.md) | Supply chains, seasonal cycles, NPC trade pressure, inter-region flows | Layer 0 (traits gate production), can be incremental |

**Why here**: These are content systems that consume the infrastructure built in Layers 0–2. They don't require each other, so they can be built in parallel or prioritised by what adds the most gameplay value.

### Layer 4 — Ownership & Automation

Late-game systems that give players a stake in the world. Require factions (asset risk), traits (build eligibility), and ships (automation modules).

| System | What it does | Depends on |
|---|---|---|
| [Player Facilities](./planned/player-facilities.md), [Production](./planned/production.md), [Production Roster](./planned/production-roster.md) | Player-owned facilities (21 types: 14 production + 7 infrastructure), passive income, asset risk, 26-good economy with production chains | Layers 0–2 (traits, economy types, faction territory) |
| Ship Automation (in [Player Progression](./planned/player-progression.md) §5) | Automated trade execution for player ships, tiered strategies | Layer 1 (ship roster), Layer 2 (faction space) |

### Layer 5 — Social & Polish

Multiplayer interaction and the overarching progression framework.

| System | What it does | Depends on |
|---|---|---|
| [Multiplayer Infrastructure](./planned/multiplayer-infrastructure.md) | Player trading, alliances, communication, coordination | Layers 2–3 (factions, reputation, missions) |
| [Player Progression](./planned/player-progression.md) | Three-phase game arc tying all systems into early→mid→late structure | All layers (defines unlock gates across systems) |

**Note on Player Progression**: This is a design framework more than a single implementation. Its unlock gates are implemented alongside the systems they gate — ship reputation requirements ship with ship roster, facility prerequisites ship with player facilities, etc. The doc is the reference for *when* things unlock, not a standalone system to build.

---

## Architectural Deltas

Specific items where a planned system replaces or modifies an active implementation. Each item tracks the active state, planned state, and what changes during migration. Delete each item once the migration is complete and the active docs are updated.

### 1. Government Ownership: Region → Faction

**Active** (universe.md, economy.md): Government type is assigned per *region* at seed time. All systems in a region share the same government.

**Planned** (faction-system.md §1): Government type belongs to the *faction*. Systems inherit their controlling faction's government type. When territory changes hands in a war, the system's government changes.

**Key deltas**: Government modifiers (volatility, equilibrium spread, tax, danger, contraband) move from per-region to per-system based on owning faction. Affects economy processing, danger pipeline, contraband inspection, and tax collection.

---

### 2. Economy Type Assignment: Top-Down → Trait-Derived

**Active** (universe.md): Economy type is assigned per system, weighted by region identity. Top-down assignment at seed time.

**Planned** (system-enrichment.md §2–3): Economy type is *derived* from system trait affinity scoring. Bottom-up derivation. Region themes weight trait generation but don't dictate economy. System enrichment §3 acknowledges this ("Current Model (Being Replaced)").

**Key deltas**: Entire world generation pipeline changes. Region identity no longer determines system economies — traits do.

---

### 3. Ship Types: 2 → 12, Stats: 2 → 10

**Active** (navigation.md): 2 ship types (Shuttle, Freighter) with 2 stats (fuel capacity, cargo capacity).

**Planned** (ship-roster.md): 12 ship classes with 10 stats. Ship stats modify the danger pipeline (ship-roster.md §4.3). Convoy mechanics added (navigation-changes.md §1). Speed stat replaces fixed travel time formula (navigation-changes.md §2).

**Key deltas**: Navigation.md ship section entirely replaced. Danger pipeline gains ship stat modifiers. Travel time becomes speed-dependent. Convoy grouping added.

---

### 5. Universe Scale: 200 → 1,000-2,000 Systems

**Active** (universe.md): 200 systems, 8 regions, 25 per region.

**Planned** (faction-system.md §7): 1,000-2,000 systems across faction territories.

**Key deltas**: Region count increases significantly. Cascading impacts on tick engine (round-robin processing frequency), map rendering (60+ regions), connection generation (scaling MST), and seed generation time.

---

### 6. Goods Expansion: 12 → 26, Production System

**Active** (economy.md): 12 goods across 3 tiers. NPC production/consumption rates defined per economy type. Supply/demand range 5–200.

**Planned** (production-roster.md, production.md): 26 market goods across 3 tiers + non-market tier 3 military assets. 14 new goods with production chains, NPC rates, and player production facilities. Supply/demand range increases to thousands. Population added as a system stat derived from traits.

**Key deltas**:
- Economy type rate tables expand from 12 to 26 goods. Every good needs at least an incidental rate at every economy type — no exclusion matrix, availability is rate-driven.
- Supply/demand range increases significantly (5–200 → thousands) to provide granularity for player production as a bounded fraction of total activity.
- Population becomes a new system-level stat, derived from traits at world generation. Affects market absorption capacity, consumption scaling, and several other systems.
- New tick processors: player facility operating costs, construction/upgrade timers, production cycle (recipe execution, input sourcing, output routing, market impact). See [Production §7](./planned/production.md) and [Player Facilities §7](./planned/player-facilities.md).
- Government restrictions on military-tagged goods (from navigation-changes.md §4) become the only hard market exclusion.

---

### 7. Tick Engine Expansion

New tick processors needed for planned systems. None are described in the active tick engine doc yet. Processor dependency order not yet considered.

**Faction system**: Relation drift, war exhaustion, battle resolution, territory control, faction economy effects.

**Ship automation**: Automated trade execution for player ships.

**Player facilities**: Facility production output.

To be designed during implementation of each respective system.

---

### 12. Region Identity Lists

**Active** (universe.md): 5 region identities (Trade Hub, Resource Rich, Industrial, Tech, Agricultural).

**Planned** (system-enrichment.md §3): 8 region themes (Garden heartland, Mineral frontier, Industrial corridor, Research cluster, Energy belt, Trade nexus, Contested frontier, Frontier wilds).

**Confirmed**: The new 8-theme list replaces the old 5-identity list. This is intentional — system enrichment explicitly notes the current model is being replaced.
