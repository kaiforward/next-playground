# Layer 2 — Political Layer Roadmap

Layer 2 introduces the political and territorial dimension to the game: named factions replace regions as the primary territorial unit, government type moves from per-region to per-faction, contraband rules become government-specific, faction-owned facilities give systems strategic identity, and wars create the demand engine that makes player activity meaningful beyond profit.

This is the largest layer in the roadmap and the highest-risk transition since the prior universe-wide reseed in Layer 0. Rather than ship it as a single monolithic effort, it is decomposed into four sub-projects sequenced by dependency. Each sub-project gets its own implementation plan and ships before the next begins.

**Source design docs**:
- [planned/faction-system.md](../planned/faction-system.md)
- [planned/war-system.md](../planned/war-system.md)
- [planned/navigation-changes.md](../planned/navigation-changes.md) §4–6
- [planned/facilities.md](../planned/facilities.md)

**Prerequisite layers** (all done): Layer 0 (system traits), Layer 1 (ship roster, upgrades, convoys), Layer 1.5 (mission architecture, combat engine).

**Stabilization checkpoint**: [MIGRATION-NOTES §After Layers 1+2](../MIGRATION-NOTES.md) — full reseed recommended, simulator + browser validation before proceeding to Layer 3.

---

## 1. Sub-Project Overview

Four sub-projects, executed in order. Each has a detailed implementation plan written before code begins.

| # | Sub-project | Status | Detailed plan | Source design |
|---|---|---|---|---|
| 1 | [Faction Foundation](#3-sub-project-1--faction-foundation) | Not started | `layer-2-faction-foundation.md` (TBD) | faction-system.md, navigation-changes.md §6 (border-conflict danger only) |
| 2 | [Faction Facilities](#4-sub-project-2--faction-facilities) | Not started | `layer-2-facilities.md` (TBD) | facilities.md |
| 3 | [Goods & Government Restrictions](#5-sub-project-3--goods--government-restrictions) | Not started | `layer-2-contraband.md` (TBD) | navigation-changes.md §4 |
| 4 | [War & Battle Engine](#6-sub-project-4--war--battle-engine) | Not started | `layer-2-war.md` (TBD) | war-system.md, navigation-changes.md §6 (war-zone danger) |

### Why this order

- **Foundation first**: every other sub-project consumes `factionId` on systems, government-per-faction, the relations table, or player reputation. Foundation also carries the largest single delta — the regions → factions ownership migration — and absorbing that early de-risks everything that follows. Foundation includes border-conflict *events* (which only need the relations processor and the existing event system) so the world shows visible political behaviour the moment Foundation ships.
- **Facilities before Contraband**: Facilities is high player value, has no war dependencies, and gives systems strategic identity. The Customs House facility is what Contraband's per-system inspection bonus hooks into, so shipping Facilities first means Contraband can wire that bonus directly rather than back-filling later.
- **Contraband next**: small (mostly a data table and a hook into the existing import-duty / contraband-inspection stages from Layer 1). Could be parallelised with Facilities but cleaner sequentially.
- **War last**: largest and most complex. Needs Foundation, benefits from Facilities (naval base / defence platform / intelligence outpost battle modifiers) and Contraband (war-zone smuggling). Worth its own multi-PR rollout: strategic layer → tactical layer → player participation.

### Dependency graph

```
Foundation ──┬── Facilities ──┐
             │                ├── War & Battle Engine
             └── Contraband ──┘
```

Foundation is the hard prerequisite. Facilities and Contraband can swap order or be parallelised. War depends on all three.

---

## 2. Cross-Cutting Decisions

These decisions affect more than one sub-project and are settled here so each detailed plan can lean on them.

| Decision | Choice | Rationale |
|---|---|---|
| Universe transition | Full reseed at start of Foundation | Migrating existing regions/governments into a faction model is more complex than generating a faction-aware universe from scratch. MIGRATION-NOTES already recommends this. |
| Region model | Kept as visual/spatial grouping, ownership moves to faction | Regions are still the rendering and naming layer. `governmentType` moves off Region; `factionId` on systems is the new source of ownership. `Region.dominantEconomy` (Layer 0) stays and is re-derived on conquest. |
| Government type count | Expand 4 → 8 in Foundation | Faction roster has one major per government, so all 8 must exist before factions are seeded. Shipping 4-then-4 would mean re-seeding the universe twice. |
| Border conflicts | Ship with Foundation as event definitions | They are events spawned by the relations processor — no war infrastructure needed. Foundation gains immediately visible political gameplay. |
| Random "War" event | Removed in Foundation | The current event catalog War event is supplanted by border conflicts. Delete on Foundation ship. |
| Combat engine reuse | Battle processor extends Layer 1.5 combat engine | Pure round-resolution logic from `lib/engine/combat.ts` (ship-vs-pirates) is the kernel for fleet battles. War sub-project builds the fleet/siege wrapper on top, doesn't reinvent it. |
| Faction-exclusive ships/modules | Wired in Foundation | Ship-roster planned 6 faction variants; gated on faction membership. Stub the gating hook in Foundation, populate variants progressively. |
| Mission architecture extension | War sub-project adds intelligence/diplomacy/escort mission types | Layer 1.5 shipped patrol/survey/bounty. Faction-gated mission types layer on the existing `Mission` model and `missions` processor — no new infrastructure. |

---

## 3. Sub-Project 1 — Faction Foundation

The structural backbone. Every later sub-project depends on this.

### In scope

- `Faction` Prisma model: name, description, government, doctrine, homeworld, color
- 8 government types (expand from current 4) with full economic modifier coverage in `ECONOMY_*` constants
- 5 doctrine types (Expansionist, Protectionist, Mercantile, Hegemonic, Opportunistic)
- 8 major factions + 12–18 minor factions seeded at world gen (archetype placement rules: buffer / frontier / enclave / cluster)
- `factionId` on `StarSystem`, replacing per-region government as the source of government modifiers
- Region model: drop `governmentType`, keep `dominantEconomy` re-derivation hook
- Inter-faction relations: per-pair score (-100 to +100), relations processor with the full set of drivers from faction-system.md §2 (border friction, doctrine compatibility, government opposition, trade volume, historical grievance, etc.)
- Alliance mechanics: formation/dissolution rules, capacity per faction status, alliance pact records
- Player-faction reputation: per-player per-faction score, earned/lost from trade, missions, future combat. Reputation modifiers applied as transaction multipliers on buy/sell (separate from market price)
- Homeworld definition: per-faction capital system, special status (sieged only when faction reduced below Minor — full enforcement deferred to War)
- Border conflicts as event definitions in the event catalog, spawned by the relations processor when a pair crosses into the unfriendly band
- Removal of the random `War` event from the event catalog (border conflicts replace it)
- Faction-aware starting spawn: new players spawn in faction space; small initial reputation with local faction
- Faction overview UI: galaxy political map (territory colours, relations matrix), faction detail page (lore, doctrine, government, relations), player reputation panel
- Full reseed and universe regeneration at ship time

### Out of scope (deferred to later sub-projects)

- Facility placement and ownership (Facilities sub-project)
- Government-specific contraband and import duties (Contraband sub-project)
- War declarations, exhaustion, battles, sieges (War sub-project)
- War-zone danger values in navigation pipeline (War sub-project)
- Mission types gated on faction reputation beyond Layer 1.5's existing types (War sub-project)

### Source design docs

- [faction-system.md](../planned/faction-system.md) — all sections except §4 (war summary)
- [navigation-changes.md](../planned/navigation-changes.md) §6 — only the border-system tier 0 danger value (war-zone danger lands with War)
- [MIGRATION-NOTES §1](../MIGRATION-NOTES.md) — government ownership migration

### Approximate PR shape

| PR | Focus |
|---|---|
| 1 | Faction model + 8 government types + economic modifier constants + types/guards. No seeding behaviour yet — pure data-model groundwork |
| 2 | World-gen rewrite: faction seeding (8 majors + minors with archetype placement), `factionId` on systems, full reseed, drop `Region.governmentType` |
| 3 | Relations processor + alliance model + border-conflict events + random War event removal |
| 4 | Player-faction reputation: schema, transaction-multiplier integration in trade service, reputation UI panel, initial-rep on spawn |
| (optional 5) | Faction overview UI: political map view, faction detail page, relations matrix |

### Done when

- Reseed produces a universe owned by 8 majors + 12–18 minors with archetype-respecting placement
- Relations drift across thousands of ticks produces a believable political landscape (no single faction dominates; conflicts emerge organically)
- Border conflict events fire at unfriendly faction pairs and apply danger / economy modifiers via the existing event pipeline
- Players can see faction territory on the map, view their reputation with each faction, and feel reputation in buy/sell prices
- All Layer 1 tests still pass; existing tick processors run unchanged against the new ownership model

### Open questions for the detailed brainstorm

- 8-government economic modifier values: 4 are tuned, 4 are sketched. Need concrete numbers before world-gen depends on them.
- Faction selection on player spawn: assigned by region? Player choice at signup? Random with re-roll?
- Alliance formation: fully automatic via relations score, or does it require an event/notification phase that players can see coming?
- Reputation transaction-multiplier values per standing tier: Champion / Trusted / Distrusted / Hostile percentages.
- Minor faction count: 12 vs. 18 changes archetype distribution density. Should be a YAML/seed knob, not hard-coded.

---

## 4. Sub-Project 2 — Faction Facilities

Strategic infrastructure layered onto systems. Lower complexity than Foundation, high player value.

### In scope

- `Facility` Prisma model: type, tier, systemId, factionId (derived from system owner)
- 14 facility type definitions across 5 categories per facilities.md §3
- Trait-prerequisite-based placement at world-gen: each facility lists required traits; placement assigns to faction-owned systems satisfying prerequisites
- Tier derivation from prerequisite trait quality (tier = best prerequisite trait quality)
- Per-faction minimum guarantees: every faction has at least one shipyard and one fuel depot
- Faction ownership: facilities transfer intact when the owning system changes hands (the conquest hook itself lands in War; Facilities exposes the transfer function)
- Facility-driven services on existing systems:
  - Shipyard: tier-gated ship class availability (extends the Layer 1 shipyard service)
  - Drydock: tier-gated module availability (extends the Layer 1 upgrades service)
  - Fuel Depot: discount on refuel cost
  - Trade Exchange: improved buy/sell spread
  - Customs House: stores the per-system inspection bonus *value* (Contraband sub-project wires it into the pipeline)
  - Warehouse: market volatility dampening
  - Naval Base / Defence Platform / Intelligence Outpost: stub-only, exposes the data; War sub-project consumes it
  - Academy: stub-only, general-quality hook for stratagems (War sub-project consumes)
- System detail UI: facilities section showing type, tier, services
- Map tooltip / overlay: facility presence indicators on high-value systems

### Out of scope

- Facility damage and tier degradation during war (War sub-project)
- Per-faction unique facility variants (e.g. faction-flagship shipyards at homeworlds) — stretch, can ship in War or later
- Player-owned facilities (separate planned doc, Layer 4)

### Source design docs

- [facilities.md](../planned/facilities.md) — all sections
- [navigation-changes.md](../planned/navigation-changes.md) §5 (fuel depot)

### Approximate PR shape

| PR | Focus |
|---|---|
| 1 | Facility model + 14 type definitions + trait-prerequisite placement at world-gen + tier derivation + reseed with facilities |
| 2 | Facility-aware services: shipyard/drydock gating, fuel depot discount, trade exchange spread, warehouse volatility, customs house data |
| 3 | UI: system detail facility section + map overlay + facility detail dialog |

### Done when

- Every seeded faction has at least one shipyard and one fuel depot in its territory
- Facility tier distribution matches design intent (tier 3 facilities are rare, tier 1 ubiquitous)
- Ship and module purchase availability narrows at low-tier shipyards/drydocks
- Refuel discounts apply at fuel depots; trade spreads improve at exchanges
- Customs House data is exposed for the Contraband sub-project to consume

### Open questions for the detailed brainstorm

- Conquest transfer semantics: do facilities automatically retain tier across faction handover, or are some facilities (e.g. ideologically-specific like black markets) downgraded/disabled when government type changes?
- Tier-3 facility scarcity: hard cap per faction or purely emergent from trait quality?
- UI density at high-facility systems: do we need facility category icons or just count badges to avoid clutter?

---

## 5. Sub-Project 3 — Goods & Government Restrictions

Smallest sub-project. Data + a hook into the existing Layer 1 contraband-inspection / import-duty stages.

### In scope

- Government-specific contraband lists (per navigation-changes.md §4 table)
- Government-specific tax tables (which goods are taxed, at what rate)
- Government-specific inspection modifiers (multiplier applied to the 25% base inspection chance from Layer 1)
- Wiring: contraband-inspection stage reads owning-faction government instead of regional government; import-duty stage reads same
- Customs House facility bonus: per-system inspection bonus stacked on top of government inspection modifier (uses the data Facilities ships)
- Black market access at frontier-government systems (no separate facility needed; frontier government = black market access by default)
- UI: market screen indicates restricted/taxed goods per system; system detail page shows trade-rule summary

### Out of scope

- Black market facility behaviour beyond access (deeper smuggling missions land in War or later content)
- Smuggling missions as a mission type (touched in War, full mission catalog later)

### Source design docs

- [navigation-changes.md](../planned/navigation-changes.md) §4

### Approximate PR shape

| PR | Focus |
|---|---|
| 1 | Government rules data (contraband, tax, inspection mod) + pipeline integration + customs house bonus consumption + UI surfaces |

### Done when

- Every government type enforces its design-doc rules at runtime: contraband can't be bought/sold at restricted markets, taxes are collected on import, inspection chance varies per government and per-system (with Customs House bonuses)
- Black markets appear at frontier government systems (and at any Black Market facility from sub-project 2)
- Players can see at a glance which goods are restricted or taxed in a given system

### Open questions for the detailed brainstorm

- Tax collection mechanics: subtracted at sale and reported, or shown as a price reduction up-front?
- Inspection penalty severity: confiscation only, or fines and reputation hits too?
- Should certain restrictions hide market entries entirely vs. show them flagged as illegal?

---

## 6. Sub-Project 4 — War & Battle Engine

The biggest sub-project. War and battle processors, two-stage conquest, player participation, war economy effects. Splits into three internal phases that may ship as separate PRs but stay within one sub-project for coherence.

### In scope

**Strategic layer** (war processor):
- `War` Prisma model: attacker, defender, exhaustion per side, status, contested systems, player contributions
- War processor (slow cadence, ~10 ticks): relation-threshold scan, declaration roll (with size-based inhibition), exhaustion accumulation (with attacker asymmetry and multi-front penalty), ceasefire check, war resolution
- Ceasefire cooldown between same-faction-pair wars
- Doctrine modifiers on declaration and exhaustion (Expansionist declares earlier; Protectionist defends cheaper)
- War-zone danger values in the navigation pipeline (per navigation-changes.md §6) — staging / contested / recently-captured tiers

**Tactical layer** (battle processor):
- `Battle` extension on the Layer 1.5 combat engine for fleet battles (strength + morale, round resolution every ~6 ticks)
- Siege model: control-score progression, attacker assault capacity, suspension when defender wins fleet battle
- Decisiveness derivation from battle outcome → siege progress rate
- General / stratagem mechanic with asymmetric weighting (underdog bonus)
- Conquest limits: capture exhaustion penalty, 25% territory cap per war, homeworld immunity until faction reduced below Minor
- Facility damage on prolonged battles (consumes the facility tier-degradation hook from sub-project 2)
- System ownership transfer on siege completion + post-capture instability (consumes the facility ownership-transfer hook)
- Re-derivation of `Region.dominantEconomy` after ownership change (MIGRATION-NOTES §1)

**Player participation layer**:
- Tier 1 contributions: war goods supply + credit donation (no enemy-rep impact)
- Tier 2 contributions: blockade running, intelligence gathering, supply-line disruption (chance-based detection, moderate rep impact)
- Tier 3 contributions: sabotage, espionage, resistance support (guaranteed rep impact, biggest rewards)
- Diminishing-returns formula on player contributions (coalition > whales)
- Co-defender mechanics: allied factions joining defensive wars, reduced exhaustion rate, withdrawal logic
- War-goods consumption boosts in the economy processor (weapons / fuel / food / machinery spikes per war state)
- End-of-war reward distribution: scaled by contribution and winning/losing side
- Player asset handling in conquered systems (rep-tiered consequences per war-system.md §9)
- War overview UI: active wars, battle viewer (extending Layer 1.5 battle viewer), contribution panel, war history

### Out of scope

- Full smuggling-mission system (post-Layer 2 content work)
- Player-led wars (Layer 5 multiplayer)
- Faction resurrection / rebel events (faction-system.md §7.1 spawn triggers — later)

### Source design docs

- [war-system.md](../planned/war-system.md) — all sections
- [navigation-changes.md](../planned/navigation-changes.md) §6
- [faction-system.md](../planned/faction-system.md) §2.1 (alliance mechanics — wartime behaviour)

### Approximate PR shape

| PR | Focus |
|---|---|
| 1 | War processor: model, declarations, exhaustion accumulation, ceasefire, war-zone danger pipeline integration. No battles yet — wars exist but resolve only on exhaustion |
| 2 | Battle processor: fleet battles (extending Layer 1.5 combat engine), siege model, assault capacity, generals/stratagems, conquest limits, ownership transfer, facility damage |
| 3 | Player participation: contribution tiers, war goods economy boosts, co-defender mechanics, end-of-war rewards, asset-handling on conquest |
| 4 | War UI: war overview, battle viewer extensions, contribution panel, war history, faction war markers on map |

### Done when

- Wars run through complete lifecycles (tension → declaration → battles → exhaustion → resolution → recovery) across thousands of ticks without breaking
- Battle math feels right in simulation: stratagems swing close fights, morale cascades trigger believable routs, evenly matched battles don't drag forever
- Faction relations recover after wars; ceasefire cooldowns prevent immediate re-declaration
- Players can supply war goods to a contested system, watch the battle viewer update, and feel their contributions affect outcomes
- Territory changes hands on siege completion with appropriate economy disruption and recovery
- Facility damage during long sieges produces realistic post-war reconstruction periods
- Multi-front wars sustain without breaking processors

### Open questions for the detailed brainstorm

- Concrete tuning numbers across the board: exhaustion base rate, round cadence, capture exhaustion penalty, war-zone danger values, contribution diminishing-returns curve.
- Player-rep impact on enemy faction for Tier 2 actions: probability table or deterministic per action type?
- Co-defender join timing: random delay across N war processor cycles, or relation-score-driven?
- Asset-seizure consequence visibility: do conquered players get a notification stream listing what they lost?
- Battle viewer scaling: Layer 1.5 viewer handles 1-on-1 ship-vs-pirate. Fleet battles aggregate many participants — does the viewer need a different visual model, or just adapted text?

---

## 7. Stabilization Checkpoint (Layer 2 Complete)

After sub-project 4 ships, Layer 2 is done. The [MIGRATION-NOTES post-Layer-1+2 checkpoint](../MIGRATION-NOTES.md) applies in full:

- Simulator validation: thousand-tick faction-relation runs, war duration curves, battle resolution math, economy recovery after wars, multi-front sustainability, alliance behaviour
- Browser validation: political map readability, convoy gameplay in contested space, contraband-and-smuggling loop, war UI clarity
- A full reseed already happened at the start of Foundation; no further reseed needed unless tuning surfaces a generation issue

Once stable, Layer 3 (faction-gated missions, in-system gameplay) can begin.

---

## 8. Document Index

| Document | Purpose | Status |
|---|---|---|
| `layer-2.md` (this file) | Roadmap, sub-project decomposition, cross-cutting decisions | Active |
| `layer-2-faction-foundation.md` | Detailed plan for sub-project 1 | To be written before Foundation begins |
| `layer-2-facilities.md` | Detailed plan for sub-project 2 | To be written before Facilities begins |
| `layer-2-contraband.md` | Detailed plan for sub-project 3 | To be written before Contraband begins |
| `layer-2-war.md` | Detailed plan for sub-project 4 | To be written before War begins |

Each sub-project plan is brainstormed and committed before any code for that sub-project lands. Plans follow the depth pattern of `layer-1.md`: phase breakdown, file change summary, test/validation strategy, branch strategy.
