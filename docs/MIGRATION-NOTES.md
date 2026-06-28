# Migration Notes

How the planned systems (`docs/planned/`) layer over the active implementation (`docs/active/`). SPEC.md describes what exists today. The planned docs describe what's coming. This document is the bridge — it maps the implementation roadmap and tracks what changes in the active systems when each planned system ships.

When a planned system is implemented, its design doc moves from `planned/` to `active/`, SPEC.md is updated to reflect the new system, and the corresponding migration items below are deleted.

---

## Implementation Roadmap

The planned systems form layers. Each layer adds value independently and creates the foundation for the next. Within a layer, systems can often be built in parallel. The layers are ordered by dependency — earlier layers don't reference later ones, but later layers build on earlier ones.

### Layer 0 — World Foundation

Enriches the physical universe that everything else builds on. No new gameplay systems — just richer world generation.

| System | What it does | Status |
|---|---|---|
| ~~System Traits~~ → [System Substrate & Traits](./active/gameplay/system-traits.md) | The physical + narrative foundation each system is built on | **Rebuilt by Economy Simulation SP1.** The original flat trait model (traits drove economy type via affinity scoring) shipped first, then was replaced by a two-layer model: a **physical substrate** (sun, bodies, resource vectors, richness) that drives economy type and population, and **narrative features** (the surviving traits) that gate missions / exploration / danger but carry no economic role. SP1 is shipped; current rules in [system-traits.md](./active/gameplay/system-traits.md) + [economy.md](./active/gameplay/economy.md). |

**Why first**: Every later system references the substrate or its features — factions value resource-rich territory, missions and exploration sites hang off features, danger reads body composition. Without the foundation, the rest of the planned systems have nothing to hang on.

**What changes**: World generation pipeline. Economy type is no longer assigned top-down (region identity) nor scored from trait affinity — it is derived bottom-up from the physical substrate (bodies → resource-base vectors → derived economy type) via the SP1 shim, with native substrate-driven production and pricing to follow in SP1 Parts 2–3. Active docs affected: system-traits.md, universe.md, economy.md.

### Layer 1 — Fleet Expansion (**Done**)

Expanded what players fly and how travel works.

| System | What it does | Status |
|---|---|---|
| ~~Ship Roster~~ | 2 → 12 ship classes, 2 → 10 stats, size/role system | **Done** — 12 classes with full stat blocks, 3 sizes, 5 roles |
| ~~Ship Upgrades~~ | 12 modules (4 slot types), hybrid tier model, fixed slot layouts | **Done** — tiered + capability modules, install/remove services + UI |
| ~~Navigation Changes §1–3~~ | Convoys, speed-based travel, ship stats in danger pipeline | **Done** — convoy CRUD + navigate + trade + repair, speed formula, danger pipeline with diminishing returns, hull/shield damage |

**What shipped**: Navigation.md fully rewritten. 12 ship types, upgrade modules, convoys (CRUD, navigate, trade, repair), speed-based travel, 5-stage danger pipeline (added hull/shield damage stage), escort protection (all ships contribute firepower), NavigableUnit abstraction for unified ship/convoy navigation UX. Simulator updated. Facility gating and faction-exclusive ships deferred to Layer 2.

### Layer 1.5 — Mission Architecture & Combat Engine (**Done**)

Pulled forward mission infrastructure and a tick-based combat engine before factions. Gives Layer 2 a foundation to build on rather than shipping missions + combat + factions all at once.

| System | What it does | Status |
|---|---|---|
| ~~Operational Missions~~ | Patrol, survey, bounty mission types with stat gating and tick-based generation | **Done** — `Mission` model, `missions` tick processor, generation from danger levels + traits |
| ~~Combat Engine~~ | Tick-based battle system for bounty encounters (ship vs pirates) | **Done** — `Battle` model, `battles` tick processor, round resolution with strength/morale/variance |
| ~~Battle Viewer UI~~ | Live battle display with strength bars, morale, round history | **Done** — battle viewer on ship detail page, operations panel on contracts tab, dashboard integration |

**What shipped**: `Mission` + `Battle` Prisma models. Pure combat engine (`lib/engine/combat.ts`) with round resolution, morale cascades, damage translation. Mission generation engine (`lib/engine/mission-gen.ts`) producing candidates from system danger and traits. Two new tick processors: `missions` (generates/expires/completes operational missions) and `battles` (resolves combat rounds every 6 ticks). Service layer, 5 API routes, client hooks with SSE invalidation. Contracts tab redesigned with "Delivery" and "Operations" sub-tabs. Ship cards show "In Battle" status. Battle viewer on ship detail page. 50 new engine tests.

**What's deferred to Layer 2**: Faction-sourced missions (intelligence, diplomacy), facility-gated generation (naval base, embassy, research station), reputation gating, war logistics, escort missions. The combat engine is designed to extend to fleet battles and faction wars.

### Layer 2 — Political Layer

The big structural change. Named factions replace regions as the primary territorial unit. Government type moves from per-region to per-faction. Wars create demand for player activity.

| System | What it does | Depends on |
|---|---|---|
| [Faction System](./active/gameplay/faction-system.md) | Factions, territory, reputation, relations, alliances, government migration | Layer 0 (traits define strategic value) |
| [War System](./planned/war-system.md) | Border conflicts (ambient), faction wars (interactive), battles, territory capture | Faction System |
| [Navigation Changes](./planned/navigation-changes.md) §4 | Contraband/goods restrictions by government type, black markets | Faction System (government per faction) |
| [Facilities](./planned/facilities.md) | Faction facilities (shipyards, naval bases, etc.), facility tiers, war targets. Split out of `system-enrichment.md` during doc cleanup — the trait portion (§1–4) shipped and lives in [active/system-traits.md](./active/gameplay/system-traits.md) | Faction System + Layer 0 |

**Why third**: Factions are the demand engine — they give players reasons to trade beyond profit. But they're a large structural migration (government ownership, spawn logic, tick processors) so they need the simpler foundation layers stable first.

**What changes**: Government ownership moves from region to faction. Universe.md region model changes significantly. New tick processors for relation drift, war resolution, territory control. Economy processing gains faction-level modifiers. Danger pipeline gains war zone effects. Spawn logic changes (players start in faction space).

### Layer 3 — Content & Missions

Expands what players do with the systems from Layers 0–2. More mission types, in-system activities, mini-games.

| System | What it does | Depends on |
|---|---|---|
| [Missions](./planned/missions.md) | Faction-gated missions (intelligence, diplomacy), war contributions, escort. Non-faction patrol/survey/bounty already shipped in Layer 1.5 | Layer 1.5 (combat engine), Layer 2 (factions, facilities) |
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

**Status**: SP1 Part 1 (the physical substrate) is shipped and validated on the `feat/economy-simulation` branch — the `simulate` calibration gate stays healthy on the substrate-derived economy. The checks below are the validation bar that applies (and that a reseed should re-clear); they now target the substrate, not the retired trait-affinity model.

**Risk**: Substrate generation is the foundation for every later system. Bad resource-base distributions, a broken economy-type shim, or monotonous worlds cascade into factions, facilities, missions, and production. This is the one layer where mistakes are invisible to players but fatal to everything built on top.

**Testing approach**: Primarily simulator-driven. No new gameplay to test in the browser — the player experience should feel similar but richer.

- Run generation experiments across many seeds. Verify body-archetype and feature quality-tier distributions match their rarity targets (features: 50% Marginal, 35% Solid, 15% Exceptional)
- Verify the substrate-derived economy type produces reasonable distributions — no economy type should dominate or be absent globally. Target: each type within 10–20% share (ideal 16.7% for 6 types)
- Verify every system's substrate maps cleanly to a derived economy type (no system falls through the shim) and yields a coherent resource base
- Compare old vs new generation side by side. The new universe should feel more varied and interesting, not just different
- Stress test at target scale (1,000–2,000 systems) even if factions aren't implemented yet — validate that generation time, MST connection building, and map rendering hold up
- Validate the substrate-derived economy keeps the 500-tick simulation healthy — run the `simulate` gate across strategies and confirm price distributions stay in band

**Note**: Region economy coherence is NOT validated. An earlier design enforced 60% economy type agreement within regions but this was removed — uniform substrate generation with varied resource bases produces naturally varied regions without enforcement, and factions (Layer 2) need resource diversity across territory for fairness.

**Transition**: Clean cut. Old world generation is replaced wholesale by substrate-based generation. Reseed the universe. No coexistence period.

**Proceed when**: Substrate and feature distributions are validated, the substrate-derived economy type produces an even spread across seeds, and generation scales to target system count without performance issues.

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

### ~~1. Government Ownership: Region → Faction~~ — **Resolved (Layer 2 foundation)**

Implemented. Government type now lives on the faction and is sourced per-system via `StarSystem.factionId`; `Region.governmentType` was dropped entirely. Government modifiers (volatility, equilibrium spread, tax, danger, contraband) resolve per-system from the owning faction, and a region's displayed "dominant government" is derived from its most prevalent owning faction. universe.md and faction-system.md reflect this.

*(Still to come with War: re-deriving `Region.dominantEconomy` when conquest changes a system's economy via the government affinity nudge — folded into the future war/territory-change processor.)*

---

### ~~3. Ship Types: 2 → 12, Stats: 2 → 10~~ — **Resolved (Layer 1)**

Implemented. 12 ship classes with 10 stats, upgrade modules, convoys, speed-based travel, ship stats in danger pipeline. navigation.md fully rewritten.

---

### ~~5. Universe Scale: 200 → 1,000-2,000 Systems~~ — **Resolved**

Implemented and exceeded. `UNIVERSE_SCALE` env var supports `"default"` (600 systems, 7K map) and `"10k"` (10,000 systems, 25K map). Tick engine, map rendering, and MST generation hold up at 10K scale. PostgreSQL migration unlocked the throughput needed.

---

### 6. Goods Expansion: 12 → 26 + Supply-Chain Production — **Shipped**

The 26-good roster and a physical, input-gated production chain **shipped** via the Economy Simulation track (SP1 substrate → SP2 living world → SP3 production + industrial base + supply-chain cascade). The model that landed is **not** the pre-pivot one this item originally tracked (per-economy-type rate tables, supply/demand scaled to thousands, bundled player facilities): production is capacity-driven from a seeded industrial base (`SystemBuilding` + `StarSystem.buildSpace`), input-gated by recipes, over a single-stock `[5, 200]` market — see [economy.md](./active/gameplay/economy.md). The pre-pivot [production-roster.md](./planned/production-roster.md) / [production.md](./planned/production.md) goods catalog carried forward; their bundled-facility and economy-type framing is superseded.

**Still deferred** (to the faction-agency / player-facilities layer): runtime construction (nothing decides what to build at runtime — the industrial base is seeded-static), player-owned production facilities (operating costs, construction/upgrade timers, output routing), and the strategic war-demand channel for the military-tagged goods. Government restrictions on military-tagged goods (navigation-changes.md §4) remain the only planned hard market exclusion.

---

### 7. Tick Engine Expansion

The `relations` processor (inter-faction relation drift; border-conflict / pact / dissolution events) **shipped** with the Layer-2 foundation and is documented in the active tick-engine doc. Further processors are still planned:

**War system**: war exhaustion, battle resolution, territory control, faction economy effects.

**Ship automation**: Automated trade execution for player ships.

**Player facilities**: Facility production output.

To be designed during implementation of each respective system.

---

### 8. Economy Foundation: Trait-Affinity → Physical Substrate (Economy Simulation SP1)

**Active** (on `main`; economy.md, universe.md): economy type and production are driven by system traits — trait-affinity scoring assigns economy type, trait quality multiplies production, and population is trait-derived.

**Rebuilt** (on `feat/economy-simulation`; system-traits.md): a **physical substrate** (sun, bodies, resource-base vectors, richness, population) drives economy type and population; traits survive only as narrative **features** with no economic role. Danger and exploration sites derive from bodies + features.

**Key deltas**:
- Economy type is derived from the substrate by a display-only classifier (`lib/engine/economy-type.ts`), not trait-affinity scoring; production and consumption derive from the substrate directly (resources + population). The trait production bonus is removed.
- Population is generated from the substrate (habitable bodies' capacity), not from traits.
- Danger sums a body-derived `StarSystem.bodyDanger` term; exploration sites come from `deriveSystemLocations(bodies, features)`.
- `TraitId` is narrowed 52 → 31 (features only); the trait-migration scaffolding is removed.

**Status**: SP1 Parts 1–2 shipped (on branch): the substrate drives production/consumption directly and economy type is a display-only label. Part 3 (emergent days-of-supply pricing) has since shipped — current rules in [economy.md](./active/gameplay/economy.md). Delete this item once SP1 fully lands on `main` and the active docs reflect the final model.

---

