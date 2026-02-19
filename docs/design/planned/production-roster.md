# Production Roster

The complete catalog of market goods, production facility types, their recipes, and the military production tier. This is the "what exists, what can players build, and what does it make" reference.

For the build system (construction, upgrades, costs, limits, asset risk) see [Player Facilities](./player-facilities.md). For the production architecture (market impact, population, chains, output routing) see [Production](./production.md).

**Depends on**: [Production](./production.md) (architecture), [Economy](../active/economy.md) (existing goods), [System Enrichment](./system-enrichment.md) (traits, economy types), [War System](./war-system.md) (military asset consumption)

---

## 1. Goods Overview

26 market goods across 3 tiers, plus a non-market military production tier. The 3 market tiers participate in the economy simulation — supply, demand, prices, trade. The military tier is produced and consumed outside the market.

- **Tier 0 — Raw Materials** (8 goods): Harvested or extracted from system resources. Minimal processing. Low value, high volume.
- **Tier 1 — Processed Goods** (10 goods): Manufactured from tier 0 inputs (and sometimes other tier 1 goods). Medium value. Mix of civilian and military-tagged goods.
- **Tier 2 — Advanced Goods** (8 goods): Complex products from tier 1 inputs. High value, tight margins. Includes military-tagged goods.
- **Tier 3 — Military Assets** (non-market): Produced from tier 1/2 inputs, donated directly to faction war efforts. Never traded on the market. See §5.

### Military Tag vs Military Tier

An important distinction:

- **Military-tagged goods** (tier 1–2): Normal market goods like Munitions, Hull Plating, Weapons Systems. Freely tradeable. Consumers buy weapons for ship defense against pirates, stations buy hull plating for maintenance. During wartime, NPC demand for these goods spikes near front lines. Donating these to a faction earns reputation but does **not** count as direct war involvement.
- **Military assets** (tier 3): Not market goods. Warships, troop equipment, heavy ordnance. Produced by dedicated late-game facilities, consumed by faction war machines. Producing and donating these **does** count as direct war involvement and triggers asset seizure risk (see [Player Facilities §4.2](./player-facilities.md)).

This creates a clear bright line: selling weapons on the open market makes you a merchant. Building warships for a faction makes you an arms manufacturer. The player always knows which side of that line they're on.

---

## 2. Tier 0 — Raw Materials

Raw materials extracted or harvested from system resources. These are the foundation of all production chains. Tier 0 facilities require minimal or no input goods — they harvest what the system's traits provide.

| Good | Base Price | Volatility | Hazard | Primary sources |
|---|---|---|---|---|
| Water | 25 | 0.5 | none | Ocean worlds, frozen worlds, ice mining |
| Food | 30 | 0.6 | none | Habitable worlds, ocean worlds, jungle worlds |
| Ore | 35 | 0.8 | none | Asteroid belts, mineral-rich moons, volcanic worlds |
| Textiles | 28 | 0.5 | none | Habitable worlds, jungle worlds (natural fibers, silk) |
| Gas | 30 | 0.7 | none | Gas giants, helium-3 reserves, nebula proximity |
| Minerals | 40 | 0.8 | none | Rare earth deposits, crystalline formations |
| Biomass | 32 | 0.6 | none | Jungle worlds, ocean worlds, organic compounds trait |
| Radioactives | 50 | 1.2 | high | Radioactive deposits, volcanic worlds |

**New goods (4)**:

- **Gas**: Hydrogen, helium-3, atmospheric gases. The raw energy feedstock — currently Fuel (tier 1) has no raw material input, which breaks the production chain. Gas fills that gap. Sourced from gas giants and helium-3 reserves.
- **Minerals**: Rare earth elements, crystalline materials, precision-grade ores. Distinct from bulk Ore — Minerals are specialized materials that feed into electronics, chemicals, and advanced manufacturing. Sourced from rare earth deposits and crystalline formations.
- **Biomass**: Organic compounds, biological material, plant matter. The biological feedstock for pharmaceuticals, polymers, and synthetic materials. Sourced from jungle worlds and ocean worlds (different character from Food, which is specifically edible agriculture).
- **Radioactives**: Fissile materials, isotopes, radioactive ores. High value, high hazard. Feeds into energy production and military reactor cores. Contraband in some government types. Sourced from radioactive deposits.

### Tier 0 Production by Economy Type

| Economy | Produces | Notes |
|---|---|---|
| Extraction | Ore, Gas, Water, Minerals, Radioactives | Primary raw material source. What they produce depends on system traits |
| Agricultural | Food, Textiles, Biomass | Organic production. Habitable/ocean/jungle traits determine mix |

Other economy types do not produce tier 0 goods — they consume them. This creates the fundamental trade dependency: extraction and agricultural systems supply everyone else.

---

## 3. Tier 1 — Processed Goods

Processed from tier 0 raw materials. Some tier 1 goods also require other tier 1 goods as inputs — these represent more complex processing and create depth within the tier. Mix of civilian and military-tagged goods.

| Good | Base Price | Volatility | Hazard | Military | Key inputs |
|---|---|---|---|---|---|
| Fuel | 45 | 1.0 | low | — | Gas |
| Metals | 50 | 0.8 | none | — | Ore |
| Chemicals | 55 | 1.2 | low | — | Gas, Minerals |
| Medicine | 65 | 1.5 | none | — | Biomass, Chemicals |
| Alloys | 60 | 0.8 | none | — | Metals, Minerals |
| Polymers | 48 | 0.7 | none | — | Gas, Biomass |
| Components | 70 | 0.9 | none | — | Minerals, Metals |
| Consumer Goods | 55 | 0.6 | none | — | Textiles, Polymers |
| Munitions | 75 | 1.3 | low | Yes | Metals, Chemicals |
| Hull Plating | 70 | 0.9 | none | Yes | Metals, Alloys |

**New goods (6)**:

- **Alloys**: High-strength composite metals — titanium alloys, durasteel, armored composites. Distinct from basic Metals. Used in advanced construction: ship frames, hull plating, reactor housings. Refinery product requiring both bulk metal and precision minerals.
- **Polymers**: Plastics, synthetic materials, carbon fiber, biocomposites. The synthetic counterpart to natural Textiles. Feeds into consumer goods, medical equipment, and advanced manufacturing. Made from gas (petrochemicals) and biomass (bioprocessing).
- **Components**: Precision-manufactured parts — circuit boards, actuators, optical elements, micro-assemblies. The universal intermediate for advanced manufacturing. A **bottleneck good** — feeds into Electronics, Machinery, Targeting Arrays, Reactor Cores, and Ship Frames. Systems that produce components are strategically important.
- **Consumer Goods**: Everyday manufactured products — clothing, tools, furniture, personal devices. Bridges the gap between raw textiles and luxury goods. Without this, Luxuries appear from nowhere at Core economies. Made from Textiles (materials) and Polymers (synthetics).
- **Munitions** (military-tagged): Ammunition, explosives, propellant charges, warheads. Basic military consumable — used in battles, consumed quickly. The first military good in the chain. Made from Metals (casings) and Chemicals (propellant/explosives).
- **Hull Plating** (military-tagged): Armor plates, structural panels, reactive shielding. Military-grade structural material. Used in ship construction, station defense, military vehicle armor. Made from Metals (base material) and Alloys (reinforcement).

### Tier 1 Production by Economy Type

| Economy | Produces | Notes |
|---|---|---|
| Refinery | Fuel, Metals, Chemicals, Alloys, Polymers | Primary processing hub. Converts raw materials into usable materials |
| Agricultural | Consumer Goods | Food processing, textile manufacturing — agricultural economies make the everyday goods |
| Industrial | Components, Munitions, Hull Plating | Precision manufacturing and military production |

**Input complexity within tier 1**: Some tier 1 goods require other tier 1 goods as inputs:
- Medicine needs Chemicals (tier 1)
- Alloys needs Metals (tier 1)
- Hull Plating needs Alloys (tier 1)

This means not all tier 1 goods are equal in production complexity. A facility producing Fuel (just needs Gas) is simpler to operate than one producing Hull Plating (needs Metals AND Alloys). The tier reflects market position and pricing, not strict chain depth.

---

## 4. Tier 2 — Advanced Goods

Complex manufactured products requiring tier 1 inputs (and sometimes multiple tier 1 goods). High value, tight margins, significant facility investment. Includes both civilian and military-tagged goods.

| Good | Base Price | Volatility | Hazard | Military | Key inputs |
|---|---|---|---|---|---|
| Electronics | 80 | 0.8 | none | — | Components, Chemicals |
| Machinery | 100 | 1.0 | none | — | Metals, Components |
| Weapons | 120 | 2.0 | high | Yes | Metals, Chemicals, Munitions |
| Luxuries | 150 | 1.5 | none | — | Consumer Goods, Electronics |
| Weapons Systems | 160 | 1.5 | high | Yes | Electronics, Munitions, Hull Plating |
| Targeting Arrays | 140 | 1.0 | none | Yes | Electronics, Components |
| Reactor Cores | 170 | 1.2 | high | Yes | Radioactives, Alloys, Components |
| Ship Frames | 180 | 1.0 | none | Yes | Hull Plating, Alloys, Components |

**New goods (4)**:

- **Weapons Systems** (military-tagged): Ship-mounted weapons platforms — turret assemblies, missile launchers, beam arrays. Distinct from Weapons (personal arms, small arms for ship defense). These are large-scale integrated weapon systems for military vessels. Made from Electronics (targeting integration), Munitions (ammunition), and Hull Plating (weapon housings).
- **Targeting Arrays** (military-tagged): Fire control systems, long-range sensors, tactical computers. The precision military technology that makes weapons accurate. Made from Electronics (processing power) and Components (optical/sensor elements). Lower hazard than weapons — these are defensive/intelligence technology as much as offensive.
- **Reactor Cores** (military-tagged): Military-grade power generation systems — fusion reactors, antimatter containment, high-output power plants. The energy heart of capital ships and military stations. Made from Radioactives (fuel), Alloys (containment housing), and Components (control systems). High hazard due to radioactive materials.
- **Ship Frames** (military-tagged): Assembled structural hull sections — spaceframes, bulkheads, internal structure. The skeleton of a ship before systems are installed. The most expensive market good — reflects the sheer material cost of building large vessels. Made from Hull Plating (armor), Alloys (structural members), and Components (integration points).

### Tier 2 Production by Economy Type

| Economy | Produces | Notes |
|---|---|---|
| Industrial | Machinery, Weapons, Weapons Systems, Ship Frames | Heavy manufacturing. The military-industrial complex |
| Tech | Electronics, Medicine (complex formulations), Targeting Arrays, Reactor Cores | High-tech manufacturing. Precision and innovation |
| Core | Luxuries | Cultural production — art, fashion, entertainment, premium consumer goods |

**Weapons distinction**: The existing "Weapons" good (120 CR, high hazard) represents personal arms, ship-mounted defense weapons, and general armaments. These are consumer goods — every trader wants weapons for pirate defense. "Weapons Systems" (160 CR) represents large-scale military weapon platforms. Both are military-tagged, but Weapons is tier 2 consumer-military while Weapons Systems is tier 2 strategic-military.

---

## 5. Tier 3 — Military Assets (Non-Market)

Military assets are produced by dedicated late-game facilities and donated directly to faction war efforts. They never enter the market — no supply, no demand, no market price. They represent actual military capability: ships, troops, and equipment that factions use in wars.

**Key design rules**:
- Produced from tier 1/2 market goods as inputs
- Donated directly to the controlling faction — no trading, no stockpiling for sale
- Production counts as **direct war involvement** (see [Player Facilities §4.2](./player-facilities.md)) — asset seizure risk applies
- Facilities are major-tier only, faction-reputation-gated (Champion or Trusted)
- This is the ultimate late-game production investment

### 5.1 Military Asset Categories

Military assets are not individual goods with prices — they're categories of contribution that translate into faction military power. The specific assets and how they map to the war system's military mechanics are defined during war system implementation.

**Planned categories**:

| Category | Likely inputs | War system effect |
|---|---|---|
| Warships | Ship Frames, Reactor Cores, Weapons Systems | Faction fleet strength — more/better ships in battles |
| Troop Equipment | Munitions, Hull Plating, Medicine | Ground/boarding capability — needed for system sieges |
| Support Vehicles | Machinery, Hull Plating, Targeting Arrays | Logistics and support — faster fleet movement, better intelligence |
| Ordnance | Munitions, Weapons, Chemicals | Consumable battle resources — used up in engagements |

These categories are provisional. The exact roster, input recipes, and war system integration are deferred to war system implementation. The production architecture supports any number of military asset types — each just needs an input recipe and a mapping to war mechanics.

### 5.2 Why Non-Market?

Military assets are kept off the market for several reasons:
- **Clear involvement line**: Producing military assets is an unambiguous act of faction support. No grey area about "I was just selling weapons on the open market."
- **No economy balancing needed**: Military assets don't need supply/demand curves, price simulation, or absorption capacity. They're produced and consumed, full stop.
- **Real-world logic**: Warships and troop equipment aren't consumer goods. They're built to order for a specific military. The regular market handles everything civilians trade — weapons for pirate defense, hull plating for ship maintenance. Military assets are a different class entirely.
- **Late-game exclusivity**: By keeping military production separate, it becomes a clear progression milestone. Building your first military facility is a commitment — you're choosing a side.

---

## 6. Production Chains — Visual Reference

### Complete Chain Map

```
TIER 0 (Raw)          TIER 1 (Processed)         TIER 2 (Advanced)         TIER 3 (Military Assets)
─────────────         ──────────────────         ──────────────────        ────────────────────────
                      ┌─→ Fuel
Gas ─────────────────┤
                      ├─→ Chemicals ──┬──→ Electronics ──┬──→ Luxuries
                      │               │                  │
Minerals ──┬─────────┤               │                  ├──→ Targeting Arrays ──→ [Support Vehicles]
           │         │               │                  │
           │         ├─→ Polymers    ├──→ Medicine       ├──→ Reactor Cores ─────→ [Warships]
           │         │               │                  │
Biomass ───┴─────────┘               └──→ Munitions ──┬─┼──→ Weapons Systems ──→ [Warships]
                                          │           │ │                        [Ordnance]
Ore ──────────→ Metals ──┬──→ Alloys ──┬──┘           │ │
                         │             │              │ ├──→ Weapons
                         │             ├──→ Hull ─────┼─┼──→ Ship Frames ───────→ [Warships]
                         │             │   Plating    │ │                         [Troop Equipment]
                         │             │              │ │
                         ├─→ Components┴──────────────┘ ├──→ Machinery
                         │                              │
Textiles ────────────────┴──→ Consumer Goods ───────────┘
                                                        └──→ Luxuries
Food ──────────── (consumed, not processed)
Water ─────────── (consumed, not processed)
Radioactives ──────────────────────────────────→ Reactor Cores ─────→ [Warships]
```

### Key Chain Summaries

**Metals chain** (construction and military):
```
Ore → Metals → Alloys → Hull Plating → Ship Frames → [Warships]
                     └→ Machinery
```

**Energy chain** (fuel and power):
```
Gas → Fuel (universal consumption)
Radioactives + Alloys + Components → Reactor Cores → [Warships]
```

**Chemical chain** (pharma and munitions):
```
Gas + Minerals → Chemicals → Medicine
                          → Munitions → Weapons / Weapons Systems → [Warships/Ordnance]
```

**Electronics chain** (technology and targeting):
```
Minerals + Metals → Components → Electronics → Targeting Arrays → [Support Vehicles]
                                            → Luxuries
```

**Consumer chain** (textiles to luxury):
```
Textiles + Polymers → Consumer Goods → Luxuries
Biomass + Gas → Polymers
```

### Bottleneck Goods

Some goods appear as inputs across many recipes, making them strategically important:

| Good | Used by | Strategic importance |
|---|---|---|
| Components | Electronics, Machinery, Targeting Arrays, Reactor Cores, Ship Frames | Most-connected intermediate. Systems producing Components are high-value targets |
| Metals | Alloys, Components, Munitions, Hull Plating, Machinery, Weapons | Universal industrial input. Disrupting Metals cascades everywhere |
| Alloys | Hull Plating, Reactor Cores, Ship Frames | Military chain bottleneck. Needed for nearly all military construction |
| Electronics | Luxuries, Weapons Systems, Targeting Arrays | Advanced manufacturing input. Tech economy's key export |

---

## 7. Goods Availability by Economy Type

Every good is available at every market. There is no exclusion matrix — availability is driven entirely by NPC production/consumption rate differentials and government restrictions.

### 7.1 Rate-Driven Availability

Every economy type has at least an incidental rate (0.1–0.5 units/tick) for every good. The economy communicates "don't trade this here" through price, not through hard walls. A mining outpost with 0.1 Luxuries consumption offers terrible prices and tiny volume — functionally discouraging the trade without preventing it. A desperate player can always dump cargo, just at a loss.

| Rate Level | Units/tick | Meaning |
|---|---|---|
| Primary | 3–5 | The economy's identity. Major supply or demand |
| Secondary | 1–2 | Meaningful but not dominant |
| Incidental | 0.1–0.5 | "This exists here, barely." Background demand from the population's basic needs |

Trade routes emerge naturally from rate gaps — not from binary availability. The player who learns that Industrial systems consume Metals at 4/tick while Agricultural systems consume at 0.2/tick has discovered a profitable route without needing to memorise an availability chart.

### 7.2 Government Restrictions

The only hard exclusion. Military-tagged goods can be restricted by government type — not because there's no demand, but because the government controls access. This is a political wall, not an economic one.

Restriction rules are defined in [Navigation Changes §4](./navigation-changes.md). Restricted goods are removed from regular markets in those systems and only available at black markets. Frontier governments restrict nothing; authoritarian governments restrict the most.

---

## 8. NPC Production and Consumption

The existing economy simulation handles NPC production and consumption per economy type. The production roster expands this with new goods — each new good needs NPC production/consumption rates so the market functions without players.

**Status**: NPC rates for 14 new goods to be defined during implementation. These extend the existing rate tables in [Economy](../active/economy.md). Key principles:

- Every good must have at least one NPC producer and one NPC consumer economy type
- Production/consumption rates scale with population (see [Production §2](./production.md))
- Rates must create natural price gradients — goods are cheap where produced, expensive where consumed
- The economy must be self-sustaining without player production — players add to the economy, they don't replace NPC activity

---

## 9. Production Facility Roster

14 production facility types across 4 tiers. Each facility produces a fixed set of goods — output is not configurable. Facilities can be split into more specialized types in future expansions if gameplay demands it.

All production facilities use the universal build system from [Player Facilities](./player-facilities.md) — construction, upgrades, operating costs, limits, and asset risk are inherited. Specific construction times, operating costs, and output rates per tick are tuning numbers for implementation.

### 9.1 Tier 0 — Extraction Facilities

Raw material extraction. No input goods required — these facilities harvest what the system's traits provide. Available at mid-game progression.

#### Mining Operation

| Property | Value |
|---|---|
| Placement | Extraction economy. Requires: asteroid belt, mineral-rich moons, volcanic world, or desert world trait |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Output | Ore, Minerals |
| Inputs | None |
| Trait bonuses | Asteroid belt, mineral-rich moons, heavy metal veins, volcanic world |

The workhorse of raw material production. Ore feeds into Metals (universal industrial input), Minerals feed into Components and Chemicals. Systems with both asteroid belt and heavy metal veins are premium mining locations. Major tier doubles throughput — worth the upgrade at high-quality trait systems.

#### Gas Harvester

| Property | Value |
|---|---|
| Placement | Extraction economy. Requires: gas giant, helium-3 reserves, frozen world, or ring system trait |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Output | Gas, Water |
| Inputs | None |
| Trait bonuses | Gas giant, helium-3 reserves, nebula proximity, frozen world |

Atmospheric and ice extraction. Gas is the raw input for Fuel (universal consumption), Chemicals, and Polymers — three different tier 1 chains start here. Water is a universal consumption good with steady demand. Helium-3 reserves systems are the best locations — they boost both Gas output and make the system strategically valuable for fuel production.

#### Homestead

| Property | Value |
|---|---|
| Placement | Agricultural economy. Requires: habitable world, ocean world, or jungle world trait |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Output | Food, Textiles, Biomass |
| Inputs | None |
| Trait bonuses | Habitable world, ocean world, jungle world, seed vault |

Organic production — farming, ranching, fibre harvesting, and biological material collection. Three outputs feeding three different chains: Food (universal consumption), Textiles (Consumer Goods), Biomass (Medicine, Polymers). The broadest output of any tier 0 facility. Seed vault trait is a rare but significant bonus — preserved genetic material improves crop yields and biomass diversity.

#### Isotope Extractor

| Property | Value |
|---|---|
| Placement | Extraction economy. Requires: radioactive deposits trait |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Output | Radioactives |
| Inputs | None |
| Trait bonuses | Radioactive deposits, volcanic world |

Specialized nuclear extraction. Single-output facility, but Radioactives are high value (50 CR base, highest tier 0) and the sole raw input for Reactor Cores — a critical tier 2 military good. The radioactive deposits trait is the hard requirement, and it's uncommon. Players who secure a major Isotope Extractor at a tier-3 radioactive deposits system control a supply bottleneck that every military production chain depends on.

### 9.2 Tier 1 — Processing Facilities

Intermediate processing. Consumes tier 0 raw materials and produces processed goods. Some tier 1 facilities also consume other tier 1 goods for more complex outputs. Available at mid-game progression.

#### Refinery

| Property | Value |
|---|---|
| Placement | Refinery economy |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Output | Fuel, Metals, Chemicals |
| Inputs | Gas, Ore, Minerals |
| Trait bonuses | Binary star, volcanic world, helium-3 reserves |

The primary processing hub. Three tier 0 inputs, three tier 1 outputs — bulk industrial processing. Fuel is consumed everywhere (universal demand), Metals feed into nearly every higher-tier chain, Chemicals feed into Medicine, Munitions, and Electronics. A vertically integrated player pairing a Mining Operation + Gas Harvester with a Refinery at a nearby system creates a self-sustaining supply chain. Binary star systems are ideal — enormous energy output powers refining at scale.

#### Materials Lab

| Property | Value |
|---|---|
| Placement | Refinery economy |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Output | Alloys, Polymers |
| Inputs | Metals, Minerals, Gas, Biomass |
| Trait bonuses | Binary star, crystalline formations |

Advanced materials processing — taking basic processed goods and tier 0 inputs to create specialized materials. Alloys are the military chain bottleneck (needed for Hull Plating, Reactor Cores, Ship Frames). Polymers feed into Consumer Goods and are a lighter industrial product. Requires a wider variety of inputs than the Refinery — either sourced from linked facilities, local market, or warehouse. A Materials Lab at a Refinery economy alongside a basic Refinery creates a deep processing cluster.

#### Factory

| Property | Value |
|---|---|
| Placement | Industrial economy |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Output | Components, Munitions, Hull Plating |
| Inputs | Minerals, Metals, Chemicals, Alloys |
| Trait bonuses | Lagrange stations, orbital ring remnant, heavy metal veins |

Precision manufacturing and military-grade production. Components are the most-connected bottleneck good in the entire chain — they feed into 5 tier 2 recipes. Munitions and Hull Plating are military-tagged tier 1 goods with wartime demand spikes. The Factory is the gateway to both civilian advanced manufacturing and military production. Lagrange stations reduce manufacturing costs; orbital ring remnants provide existing infrastructure to build on.

#### Bioprocessor

| Property | Value |
|---|---|
| Placement | Agricultural or Tech economy |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Output | Medicine, Consumer Goods |
| Inputs | Biomass, Chemicals, Textiles, Polymers |
| Trait bonuses | Organic compounds, jungle world, seed vault |

Biological and organic processing — pharmaceuticals and everyday manufactured goods. Medicine (Biomass + Chemicals) is high-value with steady universal demand. Consumer Goods (Textiles + Polymers) bridge the gap between raw fibre and Luxuries. Placeable at either Agricultural or Tech economies — agricultural systems process raw biological inputs, tech systems apply advanced formulation methods. The organic compounds trait boosts pharmaceutical yield.

### 9.3 Tier 2 — Manufacturing Facilities

Advanced manufacturing. Consumes tier 1 processed goods (and occasionally tier 0) to produce high-value finished products. The most complex supply chains and highest profit potential. Available at late-mid to late-game progression.

#### Shipyard

| Property | Value |
|---|---|
| Placement | Industrial economy. Requires: lagrange stations or orbital ring remnant trait |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Output | Ship Frames, Weapons Systems |
| Inputs | Hull Plating, Alloys, Components, Electronics, Munitions |
| Trait bonuses | Lagrange stations, orbital ring remnant |

Large-scale military-industrial manufacturing — building the structural bones of warships and the integrated weapon platforms they carry. The most input-hungry facility in the game: 5 different tier 1/2 inputs spanning multiple processing chains. A functioning Shipyard requires either extensive vertical integration or a well-supplied market. Ship Frames (180 CR) are the most valuable market good. Lagrange stations are essential — stable orbital points for large structure assembly.

#### Arms Factory

| Property | Value |
|---|---|
| Placement | Industrial economy |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Output | Weapons, Machinery |
| Inputs | Metals, Chemicals, Munitions, Components |
| Trait bonuses | Lagrange stations, heavy metal veins, orbital ring remnant |

Dual-purpose manufacturing — civilian Machinery (universal industrial demand) and military Weapons (personal arms, ship defense systems). Simpler input requirements than the Shipyard, making it the more accessible tier 2 Industrial facility. Machinery has broad NPC consumption (every economy type needs industrial equipment), creating reliable passive income. Weapons are high-value with high volatility — wartime demand spikes create profit windows.

#### Tech Lab

| Property | Value |
|---|---|
| Placement | Tech economy |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Output | Electronics, Targeting Arrays, Reactor Cores |
| Inputs | Components, Chemicals, Radioactives, Alloys |
| Trait bonuses | Crystalline formations, exotic matter traces, precursor ruins |

High-technology manufacturing — the precision and innovation end of production. Three outputs spanning civilian (Electronics), military-intelligence (Targeting Arrays), and military-strategic (Reactor Cores). Electronics feed into Luxuries and Weapons Systems, making this a key node in multiple downstream chains. Reactor Cores require Radioactives — one of the few tier 2 goods with a tier 0 input dependency, creating a long supply chain. Exotic matter traces and precursor ruins are rare traits that provide significant tech bonuses.

#### Artisan Workshop

| Property | Value |
|---|---|
| Placement | Core economy. Requires: habitable world or ancient trade route trait |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Output | Luxuries |
| Inputs | Consumer Goods, Electronics |
| Trait bonuses | Ancient trade route, habitable world, precursor ruins |

Cultural production — art, fashion, entertainment, premium consumer goods. Single output, but Luxuries are the most valuable civilian good (150 CR base) with broad Core economy consumption. Requires Consumer Goods (the everyday version) and Electronics (technology) as inputs. Placement at Core economies with the ancient trade route trait reflects established cultural centres where luxury goods have historical markets. A niche investment — low throughput, high margins, stable demand.

### 9.4 Tier 3 — Military Production Facilities

Non-market military asset production. Major-tier only, faction-reputation-gated (Trusted or Champion standing required). Producing and donating military assets counts as **direct war involvement** — asset seizure risk applies (see [Player Facilities §4.2](./player-facilities.md)). The ultimate late-game production investment.

#### Naval Foundry

| Property | Value |
|---|---|
| Placement | Industrial economy. Requires: lagrange stations or orbital ring remnant trait |
| Tier | Major only |
| Per-system limit | 1 |
| Output | Warships, Ordnance (military assets — see §5) |
| Inputs | Ship Frames, Reactor Cores, Weapons Systems, Munitions |
| Trait bonuses | Lagrange stations, orbital ring remnant |
| Reputation gate | Trusted or Champion with controlling faction |

The pinnacle of military production. Assembles completed warships from market-tier components and produces ordnance for faction fleets. The deepest supply chain in the game — Ship Frames, Reactor Cores, and Weapons Systems are all tier 2 goods, each with their own multi-tier input chains. A player operating a Naval Foundry needs either a massive vertical production network or deep pockets to buy inputs at market. Building warships is choosing a side — this facility crosses the bright line into direct war involvement.

#### Military Fabricator

| Property | Value |
|---|---|
| Placement | Industrial or Tech economy. Requires: lagrange stations, orbital ring remnant, or heavy metal veins trait |
| Tier | Major only |
| Per-system limit | 1 |
| Output | Troop Equipment, Support Vehicles (military assets — see §5) |
| Inputs | Munitions, Hull Plating, Machinery, Targeting Arrays |
| Trait bonuses | Lagrange stations, heavy metal veins |
| Reputation gate | Trusted or Champion with controlling faction |

Ground forces and logistics equipment. Simpler input requirements than the Naval Foundry — mostly tier 1 goods plus Machinery and Targeting Arrays (tier 2). More accessible entry point into military production, but still major-only and reputation-gated. Troop Equipment is essential for system sieges; Support Vehicles improve fleet logistics. A player who can't supply a full Naval Foundry can still meaningfully contribute to faction wars through this facility.

### 9.5 Roster Summary

| Tier | Facility | Economy | Output | Upgradeable |
|---|---|---|---|---|
| 0 | Mining Operation | Extraction | Ore, Minerals | Minor → Major |
| 0 | Gas Harvester | Extraction | Gas, Water | Minor → Major |
| 0 | Homestead | Agricultural | Food, Textiles, Biomass | Minor → Major |
| 0 | Isotope Extractor | Extraction | Radioactives | Minor → Major |
| 1 | Refinery | Refinery | Fuel, Metals, Chemicals | Minor → Major |
| 1 | Materials Lab | Refinery | Alloys, Polymers | Minor → Major |
| 1 | Factory | Industrial | Components, Munitions, Hull Plating | Minor → Major |
| 1 | Bioprocessor | Agricultural / Tech | Medicine, Consumer Goods | Minor → Major |
| 2 | Shipyard | Industrial | Ship Frames, Weapons Systems | Minor → Major |
| 2 | Arms Factory | Industrial | Weapons, Machinery | Minor → Major |
| 2 | Tech Lab | Tech | Electronics, Targeting Arrays, Reactor Cores | Minor → Major |
| 2 | Artisan Workshop | Core | Luxuries | Minor → Major |
| 3 | Naval Foundry | Industrial | Warships, Ordnance | Major only |
| 3 | Military Fabricator | Industrial / Tech | Troop Equipment, Support Vehicles | Major only |

14 production facilities + 7 infrastructure facilities (see [Player Facilities §5](./player-facilities.md)) = **21 total player facility types**.

---

## 10. Open Questions — Deferred to Implementation

All remaining open questions are tuning numbers that require simulation testing. The goods catalog, production chains, and facility roster are designed — these are the values to calibrate during implementation.

**Per-good tuning** (validated via simulator):
- **NPC production/consumption rates**: Per-good rates for 14 new goods across 6 economy types. Every good needs at least an incidental rate (0.1–0.5) at every economy type (§7.1).
- **Base price tuning**: Prices for new goods are approximate. Need simulation testing to validate price gradients and trade profitability across the chain.
- **Volatility tuning**: Volatility values for new goods are estimates. Need testing to ensure market dynamics feel right.
- **Existing good adjustments**: Do any existing 12 goods need price/volatility/hazard changes to fit the expanded 26-good roster?

**Per-facility tuning** (validated via simulator + income hierarchy guardrails from [Production §8](./production.md)):
- **Specific recipes**: Exact input/output quantities per facility type and tier.
- **Recipe balancing**: Input ratios determine profitability of vertical integration vs. market purchasing. Must satisfy the income hierarchy — vertical integration beats market-buying inputs.

**Deferred to other systems**:
- **Military asset specifics**: Exact tier 3 categories, input recipes, and war system integration. Designed alongside [War System](./war-system.md) implementation.

---

## Related Design Docs

- **[Production](./production.md)** — production architecture (market impact, population, chains, output routing, trait quality)
- **[Player Facilities](./player-facilities.md)** — universal build system (construction, upgrades, costs, limits, asset risk)
- **[Economy](../active/economy.md)** — market simulation, NPC production/consumption rates
- **[System Enrichment](./system-enrichment.md)** — system traits, economy types, trait quality tiers
- **[Faction System](./faction-system.md)** — war material demand, reputation
- **[War System](./war-system.md)** — military asset consumption, front-line demand
- **[Player Progression](./player-progression.md)** — production as mid/late game content
