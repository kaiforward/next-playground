# System Substrate & Traits

Status: **Active** — physical substrate + narrative features shipped. The substrate uses the **available-space model** (Economy Substrate v2): each body has a finite *available space* partitioned into per-resource **deposit slots** (each carrying a **quality band**) and **general space** (a **habitable fraction** of which caps population). A seeded industrial base (`SystemBuilding` counts) is built onto that space and drives capacity-driven, input-gated production. Full substrate detail: [the available-space model](./economy-substrate-v2-available-space.md).

What makes each system unique now has two layers:

1. **Physical substrate** — a system's sun, its bodies, and the resources those bodies hold. This is the economic foundation: it drives economy type, population, and production/consumption directly.
2. **Narrative features** — flavourful, named properties (precursor ruins, pirate strongholds, anomalies, derelict fleets). Features gate missions and exploration sites and adjust danger, but carry **no economic role**.

**Design principle**: geology is the substrate; civilisation interprets it. Two systems with the same economy-type label can feel completely different because their bodies, deposit quality, and features differ.

**Implementation**: pure space partition + quality roll in `lib/engine/substrate-space.ts`; substrate generation in `lib/engine/body-gen.ts` + `lib/engine/universe-gen.ts`; seeded build-out in `lib/engine/industry-seed.ts`; sun/archetype/space/quality constants in `lib/constants/bodies.ts` + `lib/constants/substrate-gen.ts`; the feature catalog in `lib/constants/traits.ts`; danger in `lib/engine/danger.ts`; exploration sites in `lib/constants/locations.ts`. Full substrate detail: [the available-space model](./economy-substrate-v2-available-space.md).

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

A system has one sun + 1–N bodies. Each body carries an **archetype**, a **size**, a **weight vector** over the seven resource types `{ gas, minerals, ore, biomass, arable, water, radioactive }` **plus a `general` weight**, and a **habitable fraction**. Size alone sets the body's total available space (`SPACE_PER_SIZE × size`); the weight vector then partitions that space — in a single normalised pass, no ordering bias — into per-resource **deposit slots** and fungible **general space**. The **habitable fraction** is how much of the general space can host population (the housing-per-space efficiency knob). So an archetype no longer yields an absolute resource magnitude; it shapes *how a body's finite space divides* among mining, habitation, and production.

| Archetype | Habitable | Resource lean | Habitability (`habitableFraction`) | Notes |
|---|:--:|---|:--:|---|
| Garden world | ✓ | arable, water, biomass | High (0.7) | The breadbasket |
| Ocean world | ✓ | water, biomass | Good (0.45) | Aquaculture + modest arable |
| Jungle world | ✓ | biomass, arable | Good (0.5) | Biomass-dominant |
| Arid world | ✓ | minerals, ore | Low (0.22) | Barely habitable |
| Volcanic world | ✗ | ore, radioactive | Minimal (0.02) | Ore-rich; **adds danger** (0.05 baseline) |
| Frozen world | ✗ | water, gas | Minimal (0.03) | Ice + some gas |
| Barren rock | ✗ | minerals, ore | Minimal (0.03) | Generic mineral/ore |
| Gas giant | ✗ | gas | **None (0)** | Fuel feedstock; no surface → **truly dead** |
| Asteroid belt | ✗ | minerals, ore | Minimal (0.02) | Mining backbone |

Each deposit slot independently rolls a **quality band** (poor / average / good / rich) that multiplies its yield, so a small body of *rich* ore slots can out-produce a big body of *average* ones. A rare **volatility** roll spikes one resource's weight before normalising (the occasional 90%-radioactive moon). Tunable surface: the archetype weight vectors + quality-band odds + volatility odds, all in `lib/constants/bodies.ts` / `substrate-gen.ts` and simulator-swept.

### 1.3 Deposit quality (richness retired)

The v1 richness modifiers (heavy-metal veins, helium-3 reserves, glacial aquifer…) are **retired**. Richness now lives in the per-slot **quality band** (§1.2): each deposit rolls poor / average / good / rich, and a deposit's display name is **generated from its band × resource** ("rich ore body", "marginal water-ice reserve") rather than drawn from a curated proper-noun catalog. Generic descriptors scale to every band × resource pair and read less repetitively than a small recurring set; rare volatility extremes may carry a generic special label.

### 1.4 Per-system aggregates & population

Per-body slots, qualities, and spaces are **collapsed to per-system aggregates** denormalised onto `StarSystem`, so the per-tick economy never joins the bodies table:

- **Deposit-slot caps** (`slotGas`, `slotOre`, …) — the per-resource extractor-count ceiling = Σ of the bodies' slots for that resource.
- **Yield multipliers** (`yieldGas`, `yieldOre`, …) — the effective quality of a resource = mean quality of the system's *filled* slots (best-quality-first), `1.0` when none are filled. Goods sharing a resource (food/textiles ← arable) share its slot cap and yield.
- **Spaces** — `availableSpace` (`SPACE_PER_SIZE × Σ size`), `generalSpace`, and `habitableSpace` (Σ of each body's `habitableFraction × general space`).

**Population** is **dynamic** (a Float magnitude — continuous, never rounded, so a tiny outpost is `pop 0.3` not a false 0). It is sourced **entirely from built population centres** on habitable land — `popCap = Σ(pop-centre count × POP_CENTRE_DENSITY)`, with no body baseline (the v1 `bodyBaselinePopCap` is retired; a `POP_BASELINE_FLOOR` escape hatch ships wired but `0`). It grows, declines, and migrates each tick based on need-satisfaction and unrest (see [economy.md](./economy.md)). Seeding places systems below `popCap`, giving growth headroom from the start.

### 1.5 Build-out & industrial base

The seeding allocator builds an **industrial base** onto a system's available space — abstract per-`(system, buildingType)` **counts** in `SystemBuilding` rows, seeded at world-gen and **downward-mutable** at runtime — the infrastructure-decay processor shrinks a count toward what is actively *used* (see [economy.md](./economy.md#infrastructure-decay)), but never *raises* one; runtime construction (growth) is the SP5 agency layer. Building types correspond one-to-one with output goods, plus one singleton `housing` (population-centre) type. Each carries `outputPerUnit`, `labourPerUnit`, `spaceCost`, and `inputs` (recipe). Allocator rules:

- **Tier-0 extractors** — sit on **dedicated deposit slots**; count is bounded by the resource's `slotCap`, and runtime output is multiplied by its `yieldMult`.
- **Tier-1+ manufacturers** — sit on fungible **general space**, bounded by it; input-gated at runtime (each draws its recipe inputs from local stock and throttles on the scarcest — the SP3 cascade; see [economy.md](./economy.md) §Supply Chain & Input-Gating).
- **Population centres** — sit on **habitable space**, sized to staff the system's labour demand. Industry is **gated on habitability**: a system with no habitable land builds **nothing** — it stays a pristine undeveloped deposit field for SP5 to colonise — so only habitable systems develop.

**Built ≤ available** everywhere — seeding fills well below the slot/space ceilings, leaving visible headroom for SP5 faction build-out. `SystemBuilding` rows are the source of the capacity-driven production formula (see [economy.md](./economy.md) §Production & Consumption).

---

## 2. Economy type (derived from the substrate)

Economy type is **not assigned** — it is a derived label. `deriveEconomyTypeLabel(slotCap, yieldMult, population)` reads a system's **effective deposit potential** (`slotCap × yieldMult` per resource) plus its population and maps it to one of six types:

`agricultural · extraction · refinery · industrial · tech · core`

- arable/biomass-dominant deposits → `agricultural`
- ore/minerals/gas/radioactive-dominant deposits → `extraction`
- high population + balanced mix → `core` / `industrial`
- refinery/tech fall out of the remaining mixes

Because raw building blocks are needed in huge volume and most bodies carry *some* extractable deposit, the galaxy is **extraction-dominant by design** — a large majority of systems read `extraction`. This is the intended barren-but-alive shape, not a generation flaw; finer labelling ("ore extraction" vs "gas extraction") is a presentation concern (P7), not a distribution to fake.

> **Display-only label**: nothing in the economy tick reads economy type. Production derives from the `SystemBuilding` counts, `labourFulfillment`, and per-resource `yieldMult` (see [economy.md](./economy.md)); the label drives only UI badges and `Region.dominantEconomy`. See [the available-space substrate model](./economy-substrate-v2-available-space.md).

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

The explore screen derives sites from the substrate (`deriveSystemLocations`, `lib/constants/locations.ts`): each body archetype opens a site (planet surface / gas platform / asteroid field), resource-bearing features (geothermal vents, crystalline formations) open a mining outpost, and each feature opens its thematic site (research station, ruins expedition, salvage yard, anomaly site, smuggler's den, …).

### Operational missions

Feature traits gate operational mission eligibility (`lib/constants/missions.ts`): **survey** (precursor_ruins, gravitational_anomaly, exotic_matter_traces, …), **salvage** (generation_ship_wreckage, derelict_fleet, …), and **recon** (dark_nebula, pirate_stronghold, ancient_minefield, …).

### Events

Event spawn weighting reads features + government type (not the old economic traits). E.g. pirate raids favour dark_nebula/nebula_proximity (concealment); solar storms favour solar_flare_activity/binary_star.

### Faction system

Rare features (exotic matter, precursor ruins, subspace rift) and high-yield bodies make territory worth fighting over. `[PENDING: faction-system]`

---

## Related Design Docs

- **[The Available-Space Substrate Model](./economy-substrate-v2-available-space.md)** — full substrate detail: space partition, deposit slots × quality, population full-fold, per-system aggregates
- **[Universe](./universe.md)** — region/system structure, map rendering, generation pipeline
- **[Economy](./economy.md)** — how the substrate drives production, consumption, and market pricing
- **[Events](./events.md)** — feature-driven event spawning and effects
- **[Facilities (planned)](../../planned/facilities.md)** — faction-owned facilities seeded from the substrate
