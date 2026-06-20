# System Substrate & Traits

Status: **Active** — physical substrate + narrative features shipped (Economy Simulation SP1 Part 1); the economy derives production and consumption from the substrate (SP1 Part 2); SP3 Part 2 added the seeded industrial base (`SystemBuilding` + `buildSpace`) that now drives capacity-driven production.

What makes each system unique now has two layers:

1. **Physical substrate** — a system's sun, its bodies, and the resources those bodies hold. This is the economic foundation: it drives economy type, population, and production/consumption directly.
2. **Narrative features** — flavourful, named properties (precursor ruins, pirate strongholds, anomalies, derelict fleets). Features gate missions and exploration sites and adjust danger, but carry **no economic role**.

**Design principle**: geology is the substrate; civilisation interprets it. Two systems with the same economy-type label can feel completely different because their bodies, richness, and features differ.

**Implementation**: substrate generation in `lib/engine/body-gen.ts` + `lib/engine/universe-gen.ts`; sun/archetype/richness constants in `lib/constants/bodies.ts`; the feature catalog in `lib/constants/traits.ts`; danger in `lib/engine/danger.ts`; exploration sites in `lib/constants/locations.ts`. Full design and the SP1 forward plan (Parts 2–3): [economy-simulation-substrate.md](../../planned/economy-simulation-substrate.md).

---

## 1. The physical substrate

Generated bottom-up per system at world creation; persisted as `SystemBody` rows plus denormalized aggregates on `StarSystem` (so the per-tick economy never joins the bodies table).

### 1.1 Sun class

Each system rolls one **sun**, weighted. Its class gates which body archetypes can form and how many bodies the system has (`SUN_CLASSES` in `lib/constants/bodies.ts`):

| Sun class | Character | Favours |
|---|---|---|
| Yellow (sol-like) | Temperate, most permissive | Habitable subtypes, balanced mixes |
| Blue–white (hot) | High-energy inner system | Volcanic, barren rock, asteroid belts |
| Orange dwarf (cool) | Dim, long-lived | Ocean/ice worlds, gas, marginal habitables |
| Red dwarf (cold) | Faint frontier | Frozen worlds, gas giants, belts; sparse population |

### 1.2 Bodies (archetypes)

A system has one sun + 1–N bodies. Each body carries an **archetype**, a **size**, a **base resource vector** over the seven resource types `{ gas, minerals, ore, biomass, arable, water, radioactive }`, and a **population-capacity weight**. Magnitude per type = `archetypeProfile × size × variance (× richness)` — a cap on how much of the corresponding good the body can yield.

| Archetype | Habitable | Resource lean | Pop cap | Notes |
|---|:--:|---|:--:|---|
| Garden world | ✓ | arable, water, biomass | High | The breadbasket |
| Ocean world | ✓ | water, biomass | High | Aquaculture + modest arable |
| Jungle world | ✓ | biomass, arable | Med | Biomass-dominant |
| Arid world | ✓ | minerals, ore | Low | Barely habitable |
| Volcanic world | ✗ | ore, radioactive | V.low | Ore-rich; **adds danger** (0.05 baseline) |
| Frozen world | ✗ | water, gas | V.low | Ice + some gas |
| Barren rock | ✗ | minerals, ore | V.low | Generic mineral/ore |
| Gas giant | ✗ | gas | V.low | Fuel feedstock |
| Asteroid belt | ✗ | minerals, ore | V.low | Mining backbone |

### 1.3 Richness modifiers

The old resource-flavoured traits (heavy-metal veins, helium-3 reserves, rare-earth deposits, glacial aquifer…) are now **richness modifiers**: rare rolls onto a body that multiply one resource magnitude (e.g. heavy metals → ore ×1.6). 13 of them in `RICHNESS_MODIFIERS`. They surface narratively in the body's description and open a mining-outpost exploration site (§4).

### 1.4 Aggregate & population

- **Aggregate resource vector** = element-wise sum of the system's body vectors, denormalized onto `StarSystem` (`aggGas`, `aggOre`, …) for the economy hot path.
- **Population** = `Σ(body pop-cap weight × size) × fill`, an abstract magnitude seeded **partial and varied by habitability** — developed core worlds seed near (but under) capacity; frontier rocks seed near-empty. Population is **dynamic** (Float): it grows, declines, and migrates each tick based on need-satisfaction and unrest (see [economy.md](./economy.md) — population dynamics and migration). Systems are seeded below `popCap`, giving growth headroom from the start.

### 1.5 Build space & industrial base

At world creation each body contributes `BASE_SPACE × size × habitability` build-space units; these are summed into **`StarSystem.buildSpace`** — a denormalized Float column (analogous to `aggOre`, `aggWater`, etc.) so the tick never joins the bodies table. The seeding allocator then distributes this space into an **industrial base**: an abstract per-`(system, buildingType)` **count** stored in `SystemBuilding` rows, seeded-static (never changed at runtime by the current tick processors).

Building types correspond one-to-one with output goods (the building `iron_ore` produces `iron_ore`), plus one singleton `housing` type. Each type carries `outputPerUnit`, `labourPerUnit`, `spaceCost`, and `inputs` (recipe). Key allocator rules:

- **Tier-0 extractors** — count is bounded by the system's resource deposit ∩ remaining build space.
- **Tier-1+ manufacturers** — bounded by remaining build space only (recipe `inputs` are carried but **not yet enforced at runtime**).
- **Housing** — fills remaining space after productive buildings; contributes to `popCap = bodyBaseline + Σ(housing count × popProvided)` rather than to goods production.

`SystemBuilding` rows are the source of the capacity-driven production formula (see [economy.md](./economy.md) §Production & Consumption); `buildSpace` is their physical budget.

---

## 2. Economy type (derived from the substrate)

Economy type is **not assigned** — it is a derived label. `deriveEconomyTypeLabel(aggregate, population)` maps a system's dominant resources plus its population to one of six types:

`agricultural · extraction · refinery · industrial · tech · core`

- arable/biomass-dominant → `agricultural`
- ore/minerals/gas/radioactive-dominant → `extraction`
- high population + balanced mix → `core` / `industrial`
- refinery/tech fall out of the remaining mixes

The label now reflects the system's **build-space allocation** from world-gen: a system whose build space was seeded with heavy extractor capacity reads as `extraction`; one with more manufacturing capacity reads as `industrial`. The mapping still runs through `deriveEconomyTypeLabel` against the substrate, but the industrial base encoded in `SystemBuilding` rows is the real differentiator in practice.

> **Display-only label**: nothing in the economy tick reads economy type. Production derives from the `SystemBuilding` counts and `labourFulfillment` (see [economy.md](./economy.md)); the label drives only UI badges and `Region.dominantEconomy`. See the [substrate spec](../../planned/economy-simulation-substrate.md) §7–§8.1.

---

## 3. Narrative features (the traits)

The 31 surviving traits in `lib/constants/traits.ts`. A system rolls 0–2 features. Each feature has: `id`, `category`, a quality tier (1–3) with per-tier `descriptions`, an optional `dangerModifier`, and an optional `negative` flag. **Features carry no economy role** — no affinity, no production goods; the economic signal comes entirely from bodies.

| Category | Features |
|---|---|
| Planetary | tidally_locked_world, geothermal_vents |
| Orbital | binary_star, lagrange_stations, captured_rogue_body, deep_space_beacon |
| Resource | crystalline_formations, exotic_matter_traces |
| Phenomena | nebula_proximity, solar_flare_activity, gravitational_anomaly, dark_nebula, precursor_ruins, subspace_rift, pulsar_proximity, ion_storm_corridor, bioluminescent_ecosystem, signal_anomaly, xenobiology_preserve, ancient_minefield, pirate_stronghold |
| Legacy | ancient_trade_route, generation_ship_wreckage, orbital_ring_remnant, seed_vault, colonial_capital, free_port_declaration, shipbreaking_yards, derelict_fleet, abandoned_station, smuggler_haven |

### 3.1 Quality tiers

Every feature instance rolls a tier (`QUALITY_TIERS`): 1 Marginal (~50%), 2 Solid (~35%), 3 Exceptional (~15%). Quality selects the flavour description and signals strategic value. It no longer scales production (features have no production role).

### 3.2 Danger-bearing features

Some features raise system danger via `dangerModifier`: dark_nebula (+0.06), subspace_rift (+0.08), pirate_stronghold (+0.08), ancient_minefield (+0.05), ion_storm_corridor (+0.04), binary_star (+0.03), solar_flare_activity (+0.03). lagrange_stations is the lone reducer (−0.03). These tend to cluster in frontier/lawless space — the high-risk-high-reward zones.

---

## 4. Interactions with other systems

### Navigation & danger

`computeSystemDanger` sums four terms, clamped to `[0, 0.5]`: event navigation modifiers + government baseline + **feature danger** (`computeTraitDanger` over `dangerModifier`) + **body danger** (`Σ` archetype danger baselines — volcanic worlds). See [navigation.md](./navigation.md).

### Exploration sites

The explore screen derives sites from the substrate (`deriveSystemLocations`, `lib/constants/locations.ts`): each body archetype opens a site (planet surface / gas platform / asteroid field), any richness modifier opens a mining outpost, and each feature opens its thematic site (research station, ruins expedition, salvage yard, anomaly site, smuggler's den, …).

### Operational missions

Feature traits gate operational mission eligibility (`lib/constants/missions.ts`): **survey** (precursor_ruins, gravitational_anomaly, exotic_matter_traces, …), **salvage** (generation_ship_wreckage, derelict_fleet, …), and **recon** (dark_nebula, pirate_stronghold, ancient_minefield, …).

### Events

Event spawn weighting reads features + government type (not the old economic traits). E.g. pirate raids favour dark_nebula/nebula_proximity (concealment); solar storms favour solar_flare_activity/binary_star.

### Faction system

Rare features (exotic matter, precursor ruins, subspace rift) and high-yield bodies make territory worth fighting over. `[PENDING: faction-system]`

---

## Related Design Docs

- **[Economy Simulation — Substrate (SP1 spec)](../../planned/economy-simulation-substrate.md)** — full design, decisions, and the Part 2–3 forward plan
- **[Universe](./universe.md)** — region/system structure, map rendering, generation pipeline
- **[Economy](./economy.md)** — how the substrate drives production, consumption, and market pricing
- **[Events](./events.md)** — feature-driven event spawning and effects
- **[Facilities (planned)](../../planned/facilities.md)** — faction-owned facilities seeded from the substrate
