# System Traits

Status: **Active** — shipped (Layer 0 of the migration roadmap).

What makes individual systems unique. Traits are permanent physical properties of a system — its stars, planets, moons, orbital features, resource deposits, and anomalies — that drive economy derivation, production rates, danger baselines, and event flavour.

**Design principle**: Traits are geology; economy is civilisation's interpretation of that geology. Two systems with the same economy type can feel completely different because their underlying traits are different. A top-tier extraction system on a massive asteroid belt is a galactic powerhouse. A marginal extraction system scraping a thin ring system is just getting by.

**Implementation**: Trait catalog in `lib/constants/traits.ts`. Generation pipeline in `lib/engine/trait-gen.ts` and `lib/engine/system-gen.ts`. Trait-driven danger in `lib/engine/danger.ts`.

---

## 1. Trait Model

Traits are permanent physical properties generated at world creation. They do not change (with rare event-driven exceptions).

### Core Properties

| Property | Type | Description |
|---|---|---|
| trait | TraitType | Identifier (e.g. "asteroid_belt", "habitable_world") |
| category | TraitCategory | Planetary, Orbital, Resource, Phenomena, Legacy |
| quality | 1–3 | How good this instance is. Tier 1 = marginal, tier 2 = solid, tier 3 = exceptional |
| economyAffinity | Record<EconomyType, number> | How strongly this trait supports each economy type (0 = irrelevant, 1 = minor, 2 = strong) |
| productionModifier | Record<Good, number> | Per-good production rate bonus from this trait |
| description | string | Flavour text that varies by quality tier |

A system has **2–4 traits**, rolled at generation. More traits = more complex system identity, more potential economy types, more reasons for different parties to value it.

### 1.1 Trait Categories

#### Planetary Bodies

| Trait | Economy Affinity | Description |
|---|---|---|
| Habitable world | Agricultural (2), Core (2) | Atmosphere, water, arable land. Quality tiers: marginal (thin atmosphere, limited water) → garden world (earth-like paradise). Higher tier = more food production, larger population |
| Ocean world | Agricultural (2), Extraction (1) | Mostly water surface. Aquaculture, marine biology, deep-sea mineral extraction |
| Volcanic world | Extraction (2), Refinery (1) | Geothermal energy, minerals pushed to surface, rare earth deposits. Hostile but resource-rich |
| Frozen world | Extraction (1) | Ice mining — water ice, frozen gases, cryogenic compounds. Steady but unglamorous |
| Tidally locked world | Tech (1), Extraction (1) | Permanent day/night hemispheres. Unique research on the terminator line. Rare crystalline formations on the frozen dark side |
| Desert world | Extraction (1), Industrial (1) | Mineral-rich surface, easy open-pit mining. Solar energy abundance. Low habitability but ideal for automated industry |
| Jungle world | Agricultural (1), Tech (1) | Dense biosphere, biodiversity hotspot. Food production plus unique biological compounds |
| Geothermal vents | Refinery (2), Extraction (1) | Subsurface heat drives chemical processing and fuel synthesis |
| Hydrocarbon seas | Refinery (2), Extraction (1) | Liquid methane/ethane/ammonia seas. Rich chemical feedstock for refineries |
| Fertile lowlands | Agricultural (2) | Expansive low-lying terrain with rich soil. Pure farming country |
| Coral archipelago | Agricultural (2), Extraction (1) | Shallow marine ecosystems. Aquaculture, marine biology, seafloor mineral extraction |
| Tectonic forge | Industrial (2), Extraction (1) | Extreme geological forces create natural pressure chambers and mineral concentrations |

#### Orbital Features

| Trait | Economy Affinity | Description |
|---|---|---|
| Asteroid belt | Extraction (2) | Ore, metals, ice. The backbone of extraction economies |
| Gas giant | Extraction (2), Refinery (1) | Hydrogen, helium-3, rare atmospheric gases. Fuel harvesting and chemical feedstock |
| Mineral-rich moons | Extraction (1), Industrial (1) | Low-gravity mining, easy orbital launch. Multiple moons = multiple mining sites |
| Ring system | Extraction (1) | Ice and dust rings — water, silicates, trace metals. Easier to harvest than asteroid belts |
| Binary star | Refinery (2), Tech (1) | Enormous energy output powers industrial refining at scale. Navigation hazard — higher base danger |
| Lagrange stations | Industrial (2), Core (1) | Stable orbital points ideal for large structures. Reduces construction and maintenance costs |
| Captured rogue body | Extraction (1), Tech (1) | Wandering planetoid gravitationally captured. Unusual composition |
| Deep space beacon | Core (2) | Major navigation and communications hub. Draws traffic, commerce, and information exchange |

#### Resource Deposits

| Trait | Economy Affinity | Description |
|---|---|---|
| Rare earth deposits | Extraction (1), Tech (2) | Critical for electronics manufacturing |
| Heavy metal veins | Extraction (1), Industrial (2) | Titanium, tungsten, uranium. Military and industrial applications |
| Organic compounds | Agricultural (1), Refinery (1) | Complex hydrocarbons, pre-biotic chemistry. Pharmaceutical feedstock, synthetic materials |
| Crystalline formations | Tech (2), Extraction (1) | Piezoelectric, optical, data storage. Rare |
| Helium-3 reserves | Extraction (1), Refinery (2) | Fusion fuel. Enormously valuable. Always strategically important |
| Exotic matter traces | Tech (2) | Extremely rare. Anomalous materials outside standard physics |
| Radioactive deposits | Extraction (1), Industrial (1) | Fissile materials, isotopes. Power generation, weapons, medical applications. Increases system danger baseline |
| Superdense core | Extraction (2) | Ultra-dense planetary core with extreme mineral concentrations. Dangerous but enormously productive |
| Glacial aquifer | Extraction (2) | Vast underground frozen water reserves. Industrial-scale water and chemical extraction |

#### Phenomena & Anomalies

| Trait | Economy Affinity | Description |
|---|---|---|
| Nebula proximity | Tech (1), Extraction (1) | Rare gas harvesting from nebula edge. Sensor interference creates natural concealment |
| Solar flare activity | Refinery (1) | Hyperactive star. Massive energy availability but periodic danger spikes |
| Gravitational anomaly | Tech (2) | Unexplained gravitational distortion. Pure research value |
| Dark nebula | — | Blocks sensors and navigation. Higher danger, harder to reach. Frontier/criminal affinity |
| Precursor ruins | Tech (2), Core (1) | Remnants of an ancient civilisation. Archaeological research, recovered technology |
| Subspace rift | Tech (2) | Unstable spacetime anomaly. Extremely rare, 2–3 in the entire galaxy |
| Pulsar proximity | Tech (1), Industrial (1) | Regular electromagnetic pulses. Energy harvesting, unique radiation effects on materials |
| Ion storm corridor | Refinery (2) | Charged particle streams from stellar wind interactions. Dangerous to navigate but enables industrial-scale catalysis |
| Bioluminescent ecosystem | Agricultural (2), Tech (1) | Exotic biological systems. Pharmaceutical research and agricultural applications |

#### Infrastructure & Legacy

| Trait | Economy Affinity | Description |
|---|---|---|
| Ancient trade route | Core (2), Industrial (1) | Historically significant junction. Established commerce, higher baseline trade volume |
| Generation ship wreckage | Industrial (1), Extraction (1) | Massive derelict from the colonisation era. Salvage operations |
| Orbital ring remnant | Industrial (2), Core (1) | Partially intact megastructure. Can be restored or expanded |
| Seed vault | Agricultural (2), Tech (1) | Preserved biological archive. Unique genetic material, crop strains |
| Colonial capital | Core (2), Industrial (1) | Seat of an early colonial administration. Established institutions, population density |
| Free port declaration | Core (2) | Historically declared open-trade zone. Tariff-free commerce attracts merchants |
| Shipbreaking yards | Industrial (2), Extraction (1) | Orbital scrapyards. Recycled metals, salvaged components feed local industry |

### 1.2 Quality Tiers

Every trait instance has a quality tier (1–3) rolled at generation:

| Tier | Label | Production modifier | Rarity |
|---|---|---|---|
| 1 | Marginal | +10–20% | Common (~50% of rolls) |
| 2 | Solid | +30–50% | Uncommon (~35%) |
| 3 | Exceptional | +60–100% | Rare (~15%) |

Quality affects:
- Production rate modifiers for goods associated with the trait
- Flavour description (a tier-1 asteroid belt is "sparse debris field"; tier-3 is "dense, mineral-rich belt stretching across the system")
- Strategic value — tier-3 traits in rare categories are genuine attraction points for player attention

### 1.3 Negative Traits

Some traits have downsides that create risk/reward trade-offs:

| Trait | Downside |
|---|---|
| Volcanic world | Higher base danger, periodic eruption events |
| Binary star | Navigation hazard, increased travel danger |
| Radioactive deposits | Higher base danger, crew health events (future) |
| Solar flare activity | Periodic danger spikes, market disruption |
| Dark nebula | Sensor interference, higher danger, smuggling haven |
| Subspace rift | Unstable, high danger, unpredictable events |
| Ion storm corridor | Periodic charged particle surges disrupt navigation and station operations |

These traits tend to appear in frontier/lawless space, creating the high-risk-high-reward zones that adventurous players seek out.

---

## 2. Trait-to-Economy Derivation

Economy type is not assigned directly — it emerges from a system's traits.

### 2.1 Affinity Scoring

Economy type is derived from a system's traits using **strong affinities only** (value 2). Minor affinities (value 1) represent secondary connections — flavour, production bonuses, future mechanics — but do not influence economy derivation. This keeps the signal clean and avoids noise from traits that have many minor affinities (e.g. extraction).

```
For each economy type:
  affinity score = sum of (strong_affinity × trait quality) for all system traits
  (only traits with affinity value 2 for that economy type are counted)
```

The economy type with the highest affinity score becomes the system's economy. Ties are broken by random selection (seeded).

**Guaranteed strong-affinity roll**: During trait generation, every system's first trait is drawn from the pool of traits that have at least one strong (value 2) affinity. This ensures every system has a clear economy signal — no system falls through to fallback logic. Remaining traits (1–3) are rolled from the full pool using normal weighting.

**Example**: A system with asteroid belt (quality 3) and mineral-rich moons (quality 2):
- Extraction: (2 × 3) = 6 (asteroid belt has strong extraction affinity)
- Industrial: 0 (mineral-rich moons has minor industrial, not counted)
- Everything else: 0

→ Extraction economy. Only the asteroid belt's strong affinity drives the score.

**Example**: A system with lagrange stations (quality 2) and heavy metal veins (quality 2):
- Industrial: (2 × 2) + (2 × 2) = 8 (both have strong industrial affinity)
- Core: (1 × 2) = 0 (lagrange stations has minor core, not counted)

→ Industrial economy. Both traits align strongly.

**Example**: A system with habitable world (quality 2) and rare earth deposits (quality 3):
- Agricultural: (2 × 2) = 4 (habitable world has strong agricultural)
- Tech: (2 × 3) = 6 (rare earth has strong tech)

→ Tech economy. Under a different faction that valued food production, this system could be redeveloped as agricultural. Interesting territory.

### 2.2 Faction Influence on Economy

When a faction controls a system, their government type can nudge the economy derivation. This creates the scenario where a system's economy could change when it changes hands in a war.

- Government type provides a small affinity bonus to its preferred economy types
- This bonus is weaker than trait affinity — traits still dominate, but close calls can flip
- Economy changes when territory changes hands are disruptive — market chaos for several ticks as the system retools

`[PENDING: faction-system]`

### 2.3 Core Economy Exception

Core economies are special — they represent political/trade capitals rather than natural resource exploitation. Core status comes from:

- High trait affinity for core (habitable world + ancient trade route + lagrange stations) — **shipped**
- Faction homeworld designation (always core regardless of traits) — `[PENDING: faction-system]`
- High connectivity in the jump lane graph (trade hub position) — partially shipped via centrality-based starting-system selection

This means core economies can't appear in isolated frontier systems no matter what traits they roll — you need either the right traits, the right political status, or the right location.

---

## 3. Region-System Relationship

### Design Philosophy

Regions provide **spatial organisation**, not economic identity. All regions use a neutral palette and generic space names. Economy types emerge purely from traits — no region biases economy distribution. This ensures fairness once factions ship: no faction gets an unfair advantage or disadvantage based on where they spawn.

Strategic interest comes from **trait quality and scarcity** (rare tier-3 traits, unique phenomena), not from economy clustering.

> **Note**: An earlier design used 8 "region themes" (garden heartland, mineral frontier, etc.) that lightly weighted trait selection. This was removed because: (1) themes created weak economy clustering that didn't add meaningful variety, (2) faction fairness is better served by uniform randomness, and (3) more regions with uniform generation produce more natural variety than 8 themed regions.

### Generation Pipeline

1. **Place regions**: Regions placed via Poisson-disc sampling on the map. Names picked sequentially from a flat pool of generic space names.
2. **Assign government**: Uniform distribution across government types. Coverage guarantee ensures all types appear.
3. **Roll traits per system**: Each system rolls 2–4 traits uniformly. The **first trait** is guaranteed to have at least one strong (value 2) economy affinity (see §2.1). Remaining traits are drawn from the full pool with equal weights.
4. **Derive economy per system**: Score strong affinities per §2.1, assign economy type.
5. **Derive region economy label**: The region's displayed economy type = the most common economy type among its systems, stored as `dominantEconomy` on the Region model. Computed at seed time. Re-derived when system economies change (e.g., faction conquest in Layer 2 — tracked in `MIGRATION-NOTES.md` §1). `[PENDING: faction-system]` for the re-derivation hook
6. **Select starting system**: Centrality-based — find region closest to map center, then pick core economy system closest to that region's center.

### No Coherence Enforcement

There is **no minimum percentage** for economy type distribution within a region. The generation relies on the balanced strong affinity pool (§2.1) and guaranteed strong-affinity first roll to produce naturally varied regions. With uniform trait weights and traits balanced across 6 economy types (5–6 strong affinities each), economy spread is naturally even (~16% each ±3%).

---

## 4. Trait Interactions with Other Systems

### Events

System traits influence event spawning and effects:
- **Mining boom** events are more impactful at systems with extraction traits (higher quality = bigger boom)
- **Solar storm** events are more likely at systems with solar flare activity or binary star traits
- **Plague** events hit harder at systems with habitable world traits (larger population)
- **Pirate raid** events are more likely at systems with dark nebula or nebula proximity (concealment)
- Future event types could be trait-gated — a "precursor awakening" event can only spawn at systems with precursor ruins

### Navigation & Danger

Some traits modify the base danger of a system:
- Binary star, radioactive deposits, solar flare activity, dark nebula, subspace rift all increase base danger
- Habitable world, lagrange stations decrease base danger (established infrastructure, better rescue capability)
- These stack with government and event danger modifiers

### Operational Missions

- **Survey missions** are generated from trait-rich systems. Survey-eligible traits (precursor_ruins, gravitational_anomaly, exotic_matter_traces, etc.) seed survey opportunities for scout-role ships

### Faction System

Traits define what makes territory worth fighting over. **`[PENDING: faction-system]`** for everything in this sub-section:

- **Rare traits** (exotic matter, precursor ruins, subspace rift) are natural war objectives
- **Quality tier-3 traits** make systems economically valuable enough to justify a war's cost
- **Trait diversity** within a faction's territory determines economic resilience
- When systems change hands, the conquering faction's government may shift the economy type (§2.2)

### Trading & Future Production Lines

Traits lay the groundwork for supply chain mechanics:

- Trait production modifiers scale per-good rates today (shipped)
- Some goods may only be producible at systems with specific traits (crystalline formations → advanced optics, organic compounds → pharmaceuticals) — `[PENDING: production-system]`
- Rare traits could gate access to rare goods — `[PENDING: production-system]`

---

## Related Design Docs

- **[Universe](./universe.md)** — region/system structure, map rendering, generation pipeline
- **[Economy](./economy.md)** — how trait production modifiers feed into market simulation
- **[Events](./events.md)** — trait-driven event spawning and effects
- **[Facilities (planned)](../../planned/facilities.md)** — faction-owned facilities seeded from traits; depends on Faction System
