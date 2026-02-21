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

Expands what players do with the systems from Layers 0–2. More mission types, in-system activities, mini-games.

| System | What it does | Depends on |
|---|---|---|
| [Missions](./planned/missions.md) | Operational missions (patrol, escort, intel), faction missions, war contributions | Layers 1–2 (ships, factions, facilities) |
| [In-System Gameplay](./planned/in-system-gameplay.md) | Second gameplay space — story, missions, activities within docked systems. Includes [mini-games](./planned/mini-games.md) (cantina games, push-your-luck, etc.) | Layer 0 (trait-driven flavour), Layer 2 (faction missions) |

**Prototype built**: Void's Gambit (cantina card game) is fully implemented as a client-side prototype at `/cantina` — engine, AI, UI, 4 NPC archetypes. Needs integration into the in-system location framework when that ships.

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

## Stabilization Points

Three natural pause points in the roadmap where extended testing and stabilization should happen before proceeding. Each pause addresses a different type of risk and requires a different testing approach.

### After Layer 0 — Data Validation

**Risk**: Trait generation is the foundation for every later system. Bad distributions, broken affinity scoring, or monotonous regions cascade into factions, facilities, missions, and production. This is the one layer where mistakes are invisible to players but fatal to everything built on top.

**Testing approach**: Primarily simulator-driven. No new gameplay to test in the browser — the player experience should feel similar but richer.

- Run generation experiments across many seeds. Verify trait distributions match the rarity targets (50% tier 1, 35% tier 2, 15% tier 3)
- Verify region coherence guarantees: at least 60% economy type agreement within regions, no monotonous regions, gateways unconstrained
- Verify economy type derivation produces reasonable distributions — no economy type should dominate or be absent globally
- Compare old vs new generation side by side. The new universe should feel more varied and interesting, not just different
- Stress test at target scale (1,000–2,000 systems) even if factions aren't implemented yet — validate that generation time, MST connection building, and map rendering hold up

**Transition**: Clean cut. Old world generation is replaced wholesale by trait-based generation. Reseed the universe. No coexistence period.

**Proceed when**: Trait distributions are validated, economy derivation produces coherent but varied regions, and generation scales to target system count without performance issues.

### After Layers 1+2 — Systems Integration

**Risk**: This is the largest and most complex transition. Two major rewrites ship together: the ship model (2 → 12 classes, new stats, convoys, speed-based travel, danger pipeline overhaul) and the political model (regions → factions, government ownership migration, inter-faction relations, war system with multiple new tick processors). These systems interact heavily — ship stats in war zones, convoys through contested space, contraband across faction borders — and the interactions only exist when both layers are live.

**Testing approach**: Both simulator and browser testing are critical. The simulator validates equilibrium; the browser validates experience.

**Simulator focus:**
- Faction relation drift over thousands of ticks. Verify wars happen at reasonable frequency — not constant, not never
- War duration and exhaustion curves. Wars should last 1–4 weeks real-time depending on scale. Attacker cost asymmetry should make failed offensives genuinely painful
- Battle resolution math — verify that stratagems don't break outcomes, that morale cascades feel dramatic but not random, that conquest limits prevent faction destruction in a single war
- Economy recovery after wars. Markets should spike during conflict and normalize after ceasefire, not stay permanently disrupted
- Multi-front war scenarios. Verify that fighting two wars simultaneously is sustainable but costly — not trivial, not instant death
- Alliance behavior — co-defender joining, exhaustion-based withdrawal, the deterrence effect of allied factions

**Browser focus:**
- Map visualization with faction territories, war zones, contested systems. Does the political landscape read clearly?
- Convoy formation and travel. Does grouping ships feel intuitive? Is the speed trade-off visible and meaningful?
- Contraband and smuggling gameplay loop. Is the risk/reward legible? Do government trade rules create interesting route decisions?
- War UI — battle progress, strength/morale bars, contribution interface. Can players understand what's happening and how to participate?
- Ship purchasing, upgrade installation at drydocks. Does the 12-class roster with stat differences feel distinct, or do ships blur together?

**Transition**: Hardest transition in the roadmap. Government ownership migrates from regions to factions. The 2-ship model is replaced by 12 classes. Almost every existing screen needs updates. Recommend a full reseed — migrating the existing universe to add factions is more complex than generating a new one with factions from the start.

**Proceed when**: Wars run through complete lifecycles (tension → declaration → battles → exhaustion → resolution → recovery) without breaking, faction relations produce realistic political dynamics, and the ship/convoy/danger pipeline feels balanced in both safe and contested space.

### After Layer 3 — Experience Quality

**Risk**: Different from the previous pauses. Layers 0–2 are systems questions ("does the math work?"). Layer 3 is a content and experience question ("is this fun?"). In-system gameplay introduces NPCs, dialogue, story missions, and the Explore tab — the first system where writing quality and UX flow matter as much as mechanics. Operational missions (patrol, intel, diplomacy) interact with faction reputation, ship stats, and facilities simultaneously, creating integration surface area.

**Testing approach**: Primarily browser-based playtesting. This is where setting up the custom API MCP for AI playtesting would add the most value — enough game systems exist to evaluate the experience holistically.

- Play through the in-system experience at different system types. Does a mining outpost feel different from a trade hub? Do NPCs have personality?
- Run through mission flows end to end. Are rewards balanced against trading income? Do timed missions (ship commitment) create meaningful opportunity cost?
- Test Void's Gambit integration in the Explore tab. Does the transition from standalone prototype to embedded cantina game feel natural?
- Evaluate operational mission stat gating. Do ship stat requirements create build diversity, or do they feel like arbitrary gates?
- Content volume check — are there enough mission templates and dialogue variations to avoid repetition in a single play session?

**Transition**: Low risk. Layer 3 is additive — new tabs, new content, new mission types layered on existing screens. No system replacements. The Explore tab appears alongside Market and Missions. Existing gameplay is unaffected.

**Proceed when**: In-system gameplay feels like a worthwhile alternative to trading (not mandatory, not pointless), NPC interactions have personality, and mission rewards sit in the right band relative to trade income.

### Layers 4–5 — Continuous Testing

No formal pause point needed. Layer 4 (facilities, production, automation) and Layer 5 (multiplayer, progression) are additive systems built on stable infrastructure. Each facility type, production chain, and automation tier can be tested as it's built using the simulator for economics and the browser for UX. The pace is steady rather than pause-and-validate.

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
