# System Enrichment Design

What makes individual systems unique, valuable, and worth fighting over. System traits are the physical foundation of the universe — they determine what a system is good at, what it produces, and why someone would want to control it.

**Design principle**: Traits are geology; economy is civilisation's interpretation of that geology. Two systems with the same economy type can feel completely different because their underlying traits are different. A top-tier extraction system on a massive asteroid belt is a galactic powerhouse. A marginal extraction system scraping a thin ring system is just getting by.

**Depends on**: [Faction System](./faction-system.md) (territory control, faction bonuses), [Player Progression](./player-progression.md) (player-built facilities)

---

## 1. System Traits

Traits are permanent physical properties of a system — its stars, planets, moons, orbital features, resource deposits, and anomalies. They are generated at world creation and do not change (with rare event-driven exceptions).

### Core Properties

| Property | Type | Description |
|---|---|---|
| trait | TraitType | Identifier (e.g. "asteroid_belt", "habitable_world") |
| category | TraitCategory | Planetary, Orbital, Resource, Phenomena, Legacy |
| quality | 1–3 | How good this instance is. Tier 1 = marginal, tier 2 = solid, tier 3 = exceptional |
| economyAffinity | Record<EconomyType, number> | How strongly this trait supports each economy type (0 = irrelevant, 1 = minor, 2 = strong) |
| productionModifier | Record<Good, number> | Per-good production rate bonus from this trait |
| description | string | Flavour text that varies by quality tier |

A system has **2–4 traits**, rolled at generation. More traits = more complex system identity, more potential economy types, more reasons for different factions to value it.

### 1.1 Trait Categories

#### Planetary Bodies

| Trait | Economy Affinity | Description |
|---|---|---|
| Habitable world | Agricultural (2), Core (2) | Atmosphere, water, arable land. Quality tiers: marginal (thin atmosphere, limited water) → garden world (earth-like paradise). Higher tier = more food production, larger population |
| Ocean world | Agricultural (2), Extraction (1) | Mostly water surface. Aquaculture, marine biology, deep-sea mineral extraction. Different output profile than land-based agriculture — fish, algae, kelp |
| Volcanic world | Extraction (2), Refinery (1) | Geothermal energy, minerals pushed to surface, rare earth deposits. Hostile but resource-rich. Natural energy makes refining cheaper |
| Frozen world | Extraction (1) | Ice mining — water ice, frozen gases, cryogenic compounds. Steady but unglamorous. Future production hooks: coolant, cryogenics |
| Tidally locked world | Tech (1), Extraction (1) | Extreme environment — permanent day/night hemispheres. Unique research on the terminator line. Rare crystalline formations in the frozen dark side |
| Desert world | Extraction (1), Industrial (1) | Mineral-rich surface, easy open-pit mining. Solar energy abundance. Low habitability but ideal for automated industry |
| Jungle world | Agricultural (1), Tech (1) | Dense biosphere, biodiversity hotspot. Food production plus unique biological compounds — pharmaceuticals, bio-engineering feedstock |
| Geothermal vents | Refinery (2), Extraction (1) | Subsurface heat from geological activity. Natural energy drives chemical processing and fuel synthesis. Quality tiers from minor vents to continent-spanning thermal networks |
| Hydrocarbon seas | Refinery (2), Extraction (1) | Liquid methane, ethane, or ammonia seas. Rich chemical feedstock for refineries. Quality tiers from small hydrocarbon lakes to world-spanning seas of industrial chemistry |
| Fertile lowlands | Agricultural (2) | Expansive low-lying terrain with rich soil, reliable rainfall, and ideal growing conditions. Pure farming country. Quality tiers from marginal cropland to breadbasket of the region |
| Coral archipelago | Agricultural (2), Extraction (1) | Shallow marine ecosystems teeming with life. Aquaculture, marine biology, and seafloor mineral extraction. A different agricultural profile from land-based farming |
| Tectonic forge | Industrial (2), Extraction (1) | Extreme geological forces create natural pressure chambers and mineral concentrations. Raw material processing happens underground before human industry even begins |

#### Orbital Features

| Trait | Economy Affinity | Description |
|---|---|---|
| Asteroid belt | Extraction (2) | Ore, metals, ice. Quality tiers from sparse debris field to dense, mineral-rich belt. The backbone of extraction economies |
| Gas giant | Extraction (2), Refinery (1) | Hydrogen, helium-3, rare atmospheric gases. Fuel harvesting and chemical feedstock. Large gas giant with good composition is enormously valuable |
| Mineral-rich moons | Extraction (1), Industrial (1) | Low-gravity mining, easy orbital launch. Multiple moons = multiple mining sites. Could specialise different moons for different materials |
| Ring system | Extraction (1) | Ice and dust rings — water, silicates, trace metals. Less concentrated than asteroid belt but easier to harvest |
| Binary star | Refinery (2), Tech (1) | Enormous energy output powers industrial refining at scale. Creates unique gravitational/electromagnetic phenomena for research. Navigation hazard — higher base danger |
| Lagrange stations | Industrial (2), Core (1) | Stable orbital points ideal for large structures. Reduces construction and maintenance costs for stations and orbital industry |
| Captured rogue body | Extraction (1), Tech (1) | Wandering planetoid gravitationally captured. Unusual composition — materials not found in native system bodies. Rare, with research value plus exotic minerals |
| Deep space beacon | Core (2) | Major navigation and communications hub anchored at a stable orbital point. Draws traffic, commerce, and information exchange. The systems around it benefit from being well-connected |

#### Resource Deposits

| Trait | Economy Affinity | Description |
|---|---|---|
| Rare earth deposits | Extraction (1), Tech (2) | Critical for electronics manufacturing. Future production hooks: advanced components, precision instruments |
| Heavy metal veins | Extraction (1), Industrial (2) | Dense metals — titanium, tungsten, uranium. Military and industrial applications. Ship parts, weapons, armour plating |
| Organic compounds | Agricultural (1), Refinery (1) | Complex hydrocarbons, pre-biotic chemistry. Pharmaceutical feedstock, synthetic materials. A refinery with this produces luxury goods more efficiently |
| Crystalline formations | Tech (2), Extraction (1) | Naturally occurring crystal structures — piezoelectric, optical, data storage. Rare. Future production hooks: advanced optics, quantum components |
| Helium-3 reserves | Extraction (1), Refinery (2) | Fusion fuel. Enormously valuable for energy production. Found in gas giant atmospheres or lunar regolith. Always strategically important — everyone needs fuel |
| Exotic matter traces | Tech (2) | Extremely rare. Anomalous materials outside standard physics. Pure research value, massive tech economy bonus. Conflict magnet for technocratic factions |
| Radioactive deposits | Extraction (1), Industrial (1) | Fissile materials, isotopes. Power generation, weapons, medical applications. High value but high hazard — increases system danger baseline |
| Superdense core | Extraction (2) | Ultra-dense planetary core with extreme mineral concentrations. Deep mining yields rare ores and heavy metals in quantities impossible on lighter bodies. Dangerous but enormously productive |
| Glacial aquifer | Extraction (2) | Vast underground frozen water reserves locked in ancient geological formations. Industrial-scale water and chemical extraction. A critical resource for systems without surface water |

#### Phenomena & Anomalies

| Trait | Economy Affinity | Description |
|---|---|---|
| Nebula proximity | Tech (1), Extraction (1) | Rare gas harvesting from nebula edge. Sensor interference creates natural concealment — smuggler's paradise. Navigation hazard but unique resources |
| Solar flare activity | Refinery (1) | Hyperactive star. Massive energy availability but periodic danger spikes. Boom/bust cycles tied to stellar activity |
| Gravitational anomaly | Tech (2) | Unexplained gravitational distortion. Pure research value. Could be precursor technology or natural phenomenon. Very rare, very valuable |
| Dark nebula | — | Blocks sensors and navigation. Higher danger, harder to reach. But systems hidden within are perfect for black markets, pirate havens, or secret installations. Frontier/criminal affinity |
| Precursor ruins | Tech (2), Core (1) | Remnants of an ancient civilisation. Archaeological research, recovered technology, cultural significance. Major conflict magnet — every faction wants access |
| Subspace rift | Tech (2) | Unstable spacetime anomaly. Dangerous but scientifically invaluable. Could enable future mechanics — faster travel, unique goods. Extremely rare, 2–3 in the entire galaxy |
| Pulsar proximity | Tech (1), Industrial (1) | Regular electromagnetic pulses. Energy harvesting, unique radiation effects on materials. Dangerous but useful for hardened electronics manufacturing |
| Ion storm corridor | Refinery (2) | Charged particle streams from stellar wind interactions. Dangerous to navigate but the intense energy enables industrial-scale catalysis and chemical synthesis. Periodic storm surges disrupt operations |
| Bioluminescent ecosystem | Agricultural (2), Tech (1) | Exotic biological systems producing light, complex organic compounds, and unique biochemistry. Pharmaceutical research and agricultural applications. Scientifically fascinating, commercially valuable |

#### Infrastructure & Legacy

| Trait | Economy Affinity | Description |
|---|---|---|
| Ancient trade route | Core (2), Industrial (1) | Historically significant junction. Established commerce, higher baseline trade volume. Merchants have always come here |
| Generation ship wreckage | Industrial (1), Extraction (1) | Massive derelict from the colonisation era. Salvage operations — pre-built materials, rare alloys, historical artifacts |
| Orbital ring remnant | Industrial (2), Core (1) | Partially intact megastructure. Can be restored or expanded. Reduces facility construction costs — a head start on industrialisation |
| Seed vault | Agricultural (2), Tech (1) | Preserved biological archive from colonisation era. Unique genetic material, crop strains, biological data. Boosts agricultural diversity and pharmaceutical research |
| Colonial capital | Core (2), Industrial (1) | Seat of an early colonial administration, now a bustling hub of governance and trade. Established institutions, population density, and bureaucratic infrastructure. The kind of place that becomes important simply because it always has been |
| Free port declaration | Core (2) | Historically declared open-trade zone. Tariff-free commerce attracts merchants, luxury goods, and cultural exchange. Quality tiers from minor trade concession to galactic free trade landmark |
| Shipbreaking yards | Industrial (2), Extraction (1) | Massive orbital scrapyards where decommissioned vessels are stripped for materials. Recycled metals, salvaged components, and recovered alloys feed local industry. Dangerous work, enormous output |

### 1.2 Quality Tiers

Every trait instance has a quality tier (1–3) rolled at generation:

| Tier | Label | Production modifier | Rarity |
|---|---|---|---|
| 1 | Marginal | Small bonus (+10–20%) | Common (~50% of rolls) |
| 2 | Solid | Moderate bonus (+30–50%) | Uncommon (~35%) |
| 3 | Exceptional | Large bonus (+60–100%) | Rare (~15%) |

Quality affects:
- Production rate modifiers for goods associated with the trait
- Flavour description (a tier-1 asteroid belt is "sparse debris field"; tier-3 is "dense, mineral-rich belt stretching across the system")
- Strategic value — tier-3 traits in rare categories are genuine conflict magnets

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

Economy type is not assigned directly — it emerges from a system's traits. This replaces the current system where economy is assigned first and traits are flavour.

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
- A militarist faction might tip a borderline system toward industrial (weapons production). A technocratic faction tips the same system toward tech (research)
- Economy changes when territory changes hands are disruptive — market chaos for several ticks as the system retools. This is a real cost of conquest, not just a label swap

### 2.3 Core Economy Exception

Core economies are special — they represent political/trade capitals rather than natural resource exploitation. Core status comes from:
- High trait affinity for core (habitable world + ancient trade route + lagrange stations)
- OR faction homeworld designation (always core regardless of traits)
- OR sufficiently high connectivity in the jump lane graph (trade hub position)

This means core economies can't appear in isolated frontier systems no matter what traits they roll — you need either the right traits, the right political status, or the right location.

---

## 3. Region-System Relationship

### Design Philosophy

Regions provide **spatial organisation**, not economic identity. All regions use a neutral palette and generic space names. Economy types emerge purely from traits — no region biases economy distribution. This ensures faction fairness: no faction gets an unfair advantage or disadvantage based on where they spawn.

Strategic interest comes from **trait quality and scarcity** (rare tier-3 traits, unique phenomena), not from economy clustering. Later layers add unique resources, faction bonuses, and facilities that create regional differentiation organically.

> **Note**: An earlier design used 8 "region themes" (garden heartland, mineral frontier, etc.) that lightly weighted trait selection. This was removed because: (1) themes created weak economy clustering that didn't add meaningful variety, (2) faction fairness is better served by uniform randomness, and (3) 24 regions with uniform generation produce more natural variety than 8 themed regions.

#### Generation Pipeline

1. **Place regions**: 24 regions placed via Poisson-disc sampling with 800 minimum distance on a 7000×7000 map. Names picked sequentially from a flat pool of 28 generic space names.

2. **Assign government**: Uniform 25% distribution across federation, corporate, authoritarian, frontier. Coverage guarantee ensures all 4 types appear.

3. **Roll traits per system**: Each system rolls 2–4 traits uniformly. The **first trait** is guaranteed to have at least one strong (value 2) economy affinity (see §2.1). Remaining traits are drawn from the full pool with equal weights.

4. **Derive economy per system**: Score strong affinities per §2.1, assign economy type.

5. **Derive region economy label**: The region's displayed economy type = the most common economy type among its systems, stored as `dominantEconomy` on the Region model. Computed at seed time. Re-derived when system economies change (e.g., faction conquest in Layer 2 — tracked in `MIGRATION-NOTES.md` §1).

6. **Select starting system**: Centrality-based — find region closest to map center, then pick core economy system closest to that region's center.

#### No Coherence Enforcement

There is **no minimum percentage** for economy type distribution within a region. The generation relies on the balanced strong affinity pool (§2.1) and guaranteed strong-affinity first roll to produce naturally varied regions. With uniform trait weights and 45 traits balanced across 6 economy types (5–6 strong affinities each), economy spread is naturally even (~16% each ±3%).

- Gateway systems can have any economy — their value is strategic position, not production
- Faction homeworld systems are always core economy (enforced when factions ship in Layer 2 — not relevant to initial generation, where the player starting system is selected *after* generation from existing core systems)

---

## 4. Trait Interactions with Existing Systems

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

### Faction System

Traits define what makes territory worth fighting over:
- **Rare traits** (exotic matter, precursor ruins, subspace rift) are natural war objectives — factions want to control unique resources
- **Quality tier-3 traits** make systems economically valuable enough to justify a war's cost
- **Trait diversity** within a faction's territory determines economic resilience — a faction with only extraction systems is vulnerable to mining-related events
- When systems change hands, the conquering faction's government may shift the economy type (§2.2), creating a tangible consequence of territorial change

### Trading & Future Production Lines

Traits lay the groundwork for supply chain mechanics (see [Simulation Enhancements](../archive/simulation-enhancements.md)):
- Some goods may only be producible at systems with specific traits (crystalline formations → advanced optics, organic compounds → pharmaceuticals)
- Rare traits could gate access to rare goods, creating natural trade routes between systems that have what others need
- Quality tier affects production efficiency — a tier-3 rare earth deposit produces advanced components cheaper than a tier-1

---

## 5. Facilities

Built structures that provide services, bonuses, and gameplay to systems. Facilities are **faction-owned strategic infrastructure** — they belong to whoever controls the system, they're war targets, and they shape what players can do in a system.

**Player-owned facilities** (mining operations, trade posts, personal warehouses) are a separate system entirely. They are personal investments and progression milestones that don't affect system-level data. See [Player Progression](./player-progression.md) for player facility design.

### 5.1 Core Properties

| Property | Type | Description |
|---|---|---|
| type | FacilityType | Identifier (e.g. "shipyard", "naval_base") |
| tier | 1–3 | Capability level. Derived from the quality of the system's prerequisite traits |
| traitPrerequisites | TraitType[] | Which system traits must be present for this facility to exist here |
| category | Category | Ship & Fleet, Trade & Economy, Military & Defence, Research & Production, Social & Governance |

### 5.2 Facility Placement

Facilities are seeded at world generation, not built dynamically by faction AI. The generation pipeline:

1. **Identify eligible systems**: For each facility type, find systems with the required prerequisite traits
2. **Assign tier**: Facility tier = highest quality tier among the system's prerequisite traits for that facility
3. **Faction seeding**: Each faction places facilities at its best eligible systems, prioritising higher trait quality
4. **Minimum guarantees**: Every faction must have at least one shipyard and one fuel depot in its territory. If trait generation didn't produce eligible systems (unlikely with proper trait diversity per §3), the generation retries or forces a minimum trait

Facilities can change through wars:
- **Captured**: When a system changes hands, its facilities transfer to the new owner intact
- **Damaged**: Prolonged warfare in a contested system can degrade facility tier (tier 3 → tier 2 → tier 1 → destroyed). Rebuilding takes time and investment
- **Rebuilt**: A faction can rebuild a destroyed facility at an eligible system, but it starts at tier 1 and upgrades slowly

### 5.3 Facility Catalog

#### Ship & Fleet

| Facility | Player use | Strategic value | Prerequisites |
|---|---|---|---|
| **Shipyard** | Buy and repair ships. Tier determines available ship classes — tier 1 sells shuttles and basic freighters, tier 2 adds specialised vessels, tier 3 sells faction capital ships | Loss cripples fleet growth. Highest-priority war target. Players travel across regions for tier-3 shipyards | Lagrange stations, orbital ring remnant |
| **Fuel depot** | Refuel at reduced cost, extends effective travel range. Higher tier = bigger discount | Controls logistics — a region without depots is expensive to operate in. Affects war sustainability, supply lines | Gas giant, helium-3 reserves |
| **Drydock** | Ship upgrades and modifications — add modules, improve stats. The progression facility where credits become ship power. Unique faction-specific upgrades at homeworld drydocks | Pilgrimage destination. Players seek out high-tier drydocks for the best upgrades. Faction identity expressed through exclusive mods | Lagrange stations, heavy metal veins |

#### Trade & Economy

| Facility | Player use | Strategic value | Prerequisites |
|---|---|---|---|
| **Trade exchange** | Better buy/sell spreads, more goods listed, higher trade volume. The civilised marketplace — best place to trade legitimately | Attracts players, generates tax revenue and trade mission activity. Economic engine for the faction | Ancient trade route, habitable world, lagrange stations |
| **Warehouse** | Faction-level storage that buffers supply/demand. Smooths price volatility — less extreme spikes and crashes at this system | Stabilises faction economy. Destruction causes supply shock — prices go haywire, creating opportunities for traders | Any industrial or core affinity trait |
| **Black market** | Buy/sell contraband, smuggling missions, government-banned goods available. Higher danger, higher margins | Creates the smuggler gameplay loop. Frontier factions tolerate these, authoritarian factions hunt them. Players choose risk/reward | Dark nebula, nebula proximity. Also appears in frontier government systems regardless |
| **Customs house** | Not a player service — enforcement facility. Increases contraband inspection rates, collects import duties at this system | Generates faction revenue, controls illegal goods flow. Destruction opens smuggling routes — indirect benefit to criminal players | Habitable world, lagrange stations |

#### Military & Defence

| Facility | Player use | Strategic value | Prerequisites |
|---|---|---|---|
| **Naval base** | Military missions — war contributions, patrols, escort duty. Staging point for war logistics missions | Defensive bonus in battles (see [Faction System §6.2](./faction-system.md)). Reduces system danger. Military projection for the faction | Lagrange stations, heavy metal veins |
| **Defence platform** | Not directly used by players — orbital weapons that affect war battles | Makes system harder to conquer — attacker needs more battle wins to shift control score. Passive deterrent that raises the cost of attack | Any orbital feature trait |
| **Intelligence outpost** | Tier 2 war contribution missions — espionage, intelligence gathering, information about nearby enemy systems | Provides the intelligence battle modifier (see [Faction System §6.2](./faction-system.md)). Better intel = better battle rolls. Covert, hard to detect | Nebula proximity, dark nebula. Also placed at border systems |

#### Research & Production

| Facility | Player use | Strategic value | Prerequisites |
|---|---|---|---|
| **Research station** | Tech-related missions, data trading. Future hook: unlocks advanced production recipes at the system | Drives tech economy output. Factions with more research stations have stronger tech sectors | Precursor ruins, gravitational anomaly, exotic matter, crystalline formations |
| **Refinery complex** | Not directly player-facing — boosts system's refinery production rates. Processed goods output increases | Economic output. A well-placed refinery on a system with strong traits is a money machine for the faction | Volcanic world, binary star, helium-3 reserves |
| **Mining rig** | Not directly player-facing — boosts extraction production rates. Raw material output increases | Resource output. Stacks with extraction traits — high-quality asteroid belt + mining rig = major ore producer | Asteroid belt, mineral-rich moons, gas giant |
| **Academy** | Crew training (future mechanic), ship performance improvements. Future hook: general training for the stratagem mechanic (see [Faction System §6.3](./faction-system.md)) | Trains generals — higher quality = higher stratagem chance in battles. Long-term military investment that pays off in wars | Habitable world, lagrange stations |

#### Social & Governance

| Facility | Player use | Strategic value | Prerequisites |
|---|---|---|---|
| **Planetary administration** | Faction reputation missions, political influence. Where players interact with faction leadership and governance | Seat of local governance. Tax collection, stability. Loss causes temporary governance chaos — lawlessness spike, market disruption | Habitable world |
| **Embassy** | Diplomatic missions between factions. Generates positive relation drift between the host faction and the guest faction | A tool for peace — factions invest in embassies to maintain alliances. Destroying an embassy is an act of aggression that tanks relations | Habitable world, ancient trade route |
| **Communication relay** | Extends information range — market data and event alerts from further systems. Future hook: fog of war mechanic | Information control. Good relay coverage means seeing threats coming. Loss creates blind spots in faction awareness | Any orbital feature trait |

### 5.4 Facility Tiers

Facility tier is derived from the quality of the system's prerequisite traits:

| Tier | Trait quality needed | Capability |
|---|---|---|
| 1 | Any quality prerequisite (1+) | Basic services. Functional but limited — starter ships, basic upgrades, small trade volume |
| 2 | At least one quality 2+ prerequisite | Full services. Most ship classes available, good upgrades, solid trade volume |
| 3 | At least one quality 3 prerequisite | Premium services. Faction flagships, exclusive upgrades, best trade spreads. Rare — only a handful per faction |

Tier determines the *quality* of what the facility offers, not whether it exists. A tier-1 shipyard and a tier-3 shipyard both sell ships — but the tier-3 one sells better ships, repairs faster, and may offer faction-exclusive vessels.

### 5.5 Facilities and War

Facilities are high-value targets in wars. Their presence affects battle mechanics and their loss has real consequences.

**During war:**
- Naval bases and defence platforms provide direct battle modifiers for the defending faction
- Intelligence outposts provide the intelligence modifier
- Facilities in contested systems can be damaged by prolonged fighting — each battle in the system has a chance of degrading a facility's tier (per-battle roll, probability scales with battle intensity)
- Tier degradation is stepwise: tier 3 → tier 2 → tier 1 → destroyed. Each step is a separate roll — a single battle rarely destroys a facility outright, but prolonged sieges grind them down
- Damaged facilities provide reduced bonuses at the degraded tier level (a tier 2 → tier 1 shipyard still functions, but sells fewer ship classes and repairs more slowly)

**After conquest:**
- Intact facilities transfer to the conquering faction immediately
- Damaged facilities need rebuilding (time + faction resources to restore tier). Rebuilding time and cost scale with tier gap — restoring a destroyed facility to tier 3 takes much longer than repairing tier 2 → tier 3
- The conquering faction's government type may change which facilities are *active* — an authoritarian faction capturing a system with a black market might shut it down; a frontier faction might embrace it

**Strategic implications:**
- Quick, decisive wars preserve infrastructure — long sieges degrade it. Factions have incentive to win fast
- A faction might deliberately target an enemy's tier-3 shipyard to cripple fleet production, even if they can't hold the system permanently
- Rebuilding damaged facilities is a post-war credit sink that delays economic recovery of conquered territory
- Combined with population decline during prolonged war (see [Production §2.4](./production.md)), extended conflicts genuinely degrade a region's economic value — winning a ruined territory may not be worth the cost

---

## 6. Strategic Value

Strategic value is not a stored property — it emerges naturally from the systems described above. No system needs an explicit "value" score; it becomes important through what it has and where it sits.

**Value dimensions** (each independently makes a system worth controlling or contesting):

| Dimension | What creates it | Example |
|---|---|---|
| **Economic output** | High-quality production traits, rare resources | Tier-3 asteroid belt = massive ore production. Radioactive deposits = bottleneck for reactor cores |
| **Infrastructure** | High-tier faction facilities (shipyards, naval bases) | Tier-3 shipyard = capital ship access. Only a handful exist per faction |
| **Population** | High population from habitable/established traits | High population = deep market, high consumption, strong absorption capacity (see [Production §2](./production.md)) |
| **Location** | Chokepoint position, border system, trade route junction | Gateway between two faction territories. Single-connection bottleneck on a major trade route |
| **Unique traits** | Rare phenomena (exotic matter, precursor ruins, subspace rift) | Only 2–3 subspace rifts in the galaxy. Precursor ruins attract research and cultural value |

The faction system's war mechanics operate on this emergent worth — the war AI evaluates potential targets by aggregating these dimensions (trait quality, facility tiers, connection count, population) without the player or the design needing to assign explicit scores. A system with tier-3 extraction traits, a shipyard, and a gateway position is worth fighting over because every dimension says so.

---

## Related Design Docs

- **[Faction System](./faction-system.md)** — territory control, war mechanics, government bonuses that influence economy derivation
- **[Missions](./missions.md)** — mission types generated by facilities (naval base, embassy, black market, etc.)
- **[Player Progression](./player-progression.md)** — how players interact with facilities, unlock access to trait-gated content
- **[Simulation Enhancements](../archive/simulation-enhancements.md)** — supply chain dependencies, production lines that leverage trait-gated resources
