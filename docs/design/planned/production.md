# Production System Design

Production facilities and the mechanics of player-driven goods production. Covers what production facilities create, input requirements, how output enters the economy, supply chain integration, and war material flow.

**Design principle**: Production facilities use the universal build system from [Player Facilities](./player-facilities.md) — construction, upgrades, operating costs, limits, and asset risk are inherited. This document only defines what makes production facilities unique: what they produce and how that production interacts with the game world.

**Depends on**: [Player Facilities](./player-facilities.md) (build system), [Economy](../active/economy.md) (market integration), [System Enrichment](./system-enrichment.md) (traits, economy types, population), [Faction System](./faction-system.md) (war material demand)

---

## 1. Architecture Overview

Player production exists within the existing economy simulation, not alongside it. The economy engine already models system-level production and consumption — NPC-driven supply and demand that keeps markets functional regardless of player activity. Player production facilities add a bounded additional input on top of this baseline, affecting real market prices in a controlled way.

This is a **hybrid model** (similar to Elite Dangerous's Background Simulation): the NPC economy provides the foundation that guarantees markets always function, and player production layers on top, creating meaningful but bounded market impact.

### 1.1 Why Hybrid?

A fully player-driven economy (like Prosperous Universe) is fragile — it requires high player density to function and suffers liquidity crises when players leave. A pure NPC economy with no player impact makes production feel disconnected — "you produce ore but the market doesn't notice."

The hybrid approach gives us:
- **Robustness**: Markets function with zero players. The NPC simulation is the floor.
- **Meaningful player impact**: Production facilities genuinely affect local supply, creating real economic consequences — but bounded ones.
- **Scalability**: The same architecture works whether a server has 10 players or 1,000. The tuning changes, not the system.

### 1.2 Market Impact Model

Player production output feeds into the system's supply, affecting prices through the existing supply/demand ratio formula. However, this impact is bounded by the system's **absorption capacity** — how much additional supply the market can absorb before prices shift significantly.

**Absorption capacity** scales with two factors:

- **Population**: Higher population systems have deeper markets. A trade hub with millions of people absorbs player production without blinking. A frontier outpost with a few thousand inhabitants feels every unit. See §2 for population as a system stat.
- **Trait quality**: Systems with higher-quality economy-relevant traits have larger baseline production. A tier-3 asteroid belt system already produces enormous amounts of ore — player mining adds a small percentage. A tier-1 system produces little, so the same player output is proportionally larger.

The formula (conceptual):
```
effective_market_impact = player_output × (1 / absorption_capacity)
```

Where `absorption_capacity` is derived from population and trait quality. The exact formula and scaling constants are tuning numbers determined through simulation testing at various player counts.

**Natural diminishing returns**: The absorption capacity model provides built-in diminishing returns. As more player facilities stack at one system, total supply increases, prices drop, and each facility's output sells for less. A frontier system with low absorption capacity gets price-crashed by a handful of facilities — the crash itself is the disincentive. High-population systems absorb more before prices shift, but even they have limits. Players naturally spread out to protect their margins. If simulation testing shows stacking is still too attractive at high-population systems, an explicit inverse scaling multiplier can be added as an additional lever — but the market may do the work on its own.

### 1.3 Supply/Demand Scale

The current economy simulation uses a supply/demand range of 5–200. This range will need to increase significantly (likely to thousands) to provide the granularity needed for player production to be a meaningful but bounded fraction of total economic activity. If the range stays at 200 and a player facility adds 5 units/tick, that's 2.5% — already significant. At a range of 2,000, the same 5 units is 0.25% — much more manageable, and 20 players each adding 5 units only shifts the market by 5%.

The exact scale increase is a tuning decision for implementation, validated through the existing simulator at various player counts.

### 1.4 Design for Testability

All production parameters must be configurable so the simulator can validate balance:

- Per-facility output rates (units per tick, per tier)
- Absorption capacity formula (population weight, trait quality weight)
- Diminishing returns curve for multiple facilities
- Supply/demand range scaling
- Player count scenarios (10, 50, 100, 500 players per server)

The existing simulation infrastructure (`npm run simulate`) should be extended to model player facility clusters and their market impact across different scenarios.

---

## 2. Population

Population is a new system-level stat that represents how many people live and work in a system. It serves as the primary scaling factor for market absorption capacity, consumption demand, and several other systems.

### 2.1 Core Properties

| Property | Type | Description |
|---|---|---|
| population | number | Approximate population level. Not an exact headcount — a scaled value representing relative size |
| populationGrowth | number | Per-tick drift toward a target determined by system conditions. Very slow — population changes over hundreds/thousands of ticks |

### 2.2 Derivation from Traits

Population is derived at world generation from system traits, not assigned independently. This keeps it consistent with the bottom-up trait system from [System Enrichment](./system-enrichment.md).

**High population traits**: Habitable world (strongest contributor), lagrange stations, orbital ring remnant, ancient trade route, seed vault. These traits imply infrastructure, liveable conditions, and established civilisation.

**Moderate population traits**: Gas giant (orbital stations), mineral-rich moons (mining colonies), ocean world (aquatic settlements). Industrial activity brings workers.

**Low population traits**: Frozen world, volcanic world, dark nebula, subspace rift. Hostile environments support only small specialist populations.

**Quality multiplier**: Higher trait quality → more population. A tier-3 habitable world (garden paradise) supports far more people than a tier-1 (marginal atmosphere).

**Economy type bonus**: Core economies get a population bonus (they're political/trade capitals). Frontier/extraction economies get a penalty (remote, harsh).

### 2.3 What Population Affects

| System | How population is used |
|---|---|
| **Market absorption** | Higher population = deeper market = more supply/demand before prices shift. The primary use case for this stat |
| **Consumption demand** | More people consume more food, textiles, medicine, luxuries. Scales base consumption rates |
| **Facility income** | Infrastructure facilities (trade posts, etc.) earn more at high-population systems — more customers |
| **Event impact** | Plague events hit harder at high-pop systems. Famine is more devastating. Already noted in [System Enrichment §4](./system-enrichment.md) |
| **Danger baseline** | Higher population generally means better infrastructure, rescue capability, law enforcement. Reduces base danger slightly |
| **Faction value** | High-population systems are more valuable territory — more tax revenue, more economic output, worth fighting over |

### 2.4 Population Changes Over Time

Population drifts slowly based on system conditions. This is not a demographic simulation — it's a slow-moving stat that reflects long-term consequences:

- **Positive drift**: Stable faction control, active trade, no active events, high-quality traits
- **Negative drift**: War (especially prolonged sieges), plague events, famine, loss of faction control
- **Conquest shock**: When a system changes hands in a war, population drops sharply (refugees, disruption) and recovers slowly under the new faction

Population changes are slow enough that they don't affect minute-to-minute gameplay, but over the course of a long war, a contested region's population (and therefore market depth and consumption) genuinely degrades. This creates real long-term economic consequences for conflict.

---

## 3. Production Chains

Production follows a tiered chain model. Lower-tier goods are inputs for higher-tier production. Each tier up the chain adds value but requires more investment and infrastructure.

### 3.1 Chain Structure

```
Tier 0 (Raw Materials) → Tier 1 (Processed Goods) → Tier 2 (Advanced Goods)
```

- **Tier 0 extraction**: Produces raw materials from system resources. Minimal or no input goods required — these facilities harvest what the system's traits provide. Economy type: Extraction, Agricultural.
- **Tier 1 processing**: Consumes tier 0 goods and produces processed goods. Requires input supply — either from the player's own tier 0 facilities, purchased from the market, or shipped in from elsewhere. Economy type: Refinery, Agricultural (for food processing).
- **Tier 2 manufacturing**: Consumes tier 1 (and sometimes tier 0) goods and produces advanced goods. The most valuable output but the most complex supply chain. Economy type: Industrial, Tech.

A fully vertically integrated player would need facilities across multiple systems with different economy types and traits — extraction systems for raw materials, refinery systems for processing, industrial systems for manufacturing. This encourages geographic spread and trade route planning.

### 3.2 Input Sourcing

Production facilities that require inputs can source them in three ways:

1. **Linked facility**: If the player owns a facility producing the required input at the same system, output can be routed directly as input. No market transaction, no transport needed. Efficient but limits where you can build.
2. **Local market**: The facility purchases input goods from the system's market at current prices. Automatic — the facility buys what it needs each tick. This creates real demand and costs the player credits, but requires no manual intervention.
3. **Warehouse**: The player pre-stocks input goods in their warehouse at the system (shipped in via trade ships). The facility draws from the warehouse before buying from the market. This lets players optimise input costs by buying cheap elsewhere and shipping in bulk.

If no input is available from any source, the facility **idles** for that tick — no output, but operating costs still apply (see [Player Facilities §2.4](./player-facilities.md)). This creates pressure to maintain supply chains.

**Cross-system supply chains**: Inter-system transport is always player-driven — manual shipping now, automated trade routes when ship automation ships (see [Player Progression §5](./player-progression.md)). Facilities self-sustain via local market purchasing at reduced margins, so cross-system supply chains are a profitability optimisation, not a requirement. A Refinery can buy Ore from the local market and function fine — the player who ships in cheap Ore from an Extraction system earns better margins but puts in more effort.

### 3.3 Output Routing

When a production facility produces goods, the player controls where they go:

| Destination | Mechanic | Use case |
|---|---|---|
| **Warehouse** | Stored at the system for later use. Default if no other destination is set | Stockpiling, timing market sales, buffering for transport |
| **Linked facility** | Fed directly into another player facility at the same system as input | Vertical integration — mining op feeds refinery |
| **Market (auto-sell)** | Sold immediately at current market price. Credits deposited automatically | Passive income — set and forget |
| **Market (threshold)** | Sold only when market price exceeds a player-set threshold. Otherwise stored in warehouse | Price optimisation — wait for good prices |
| **Faction contribution** | Donated to the controlling faction's war effort or economy. No credits, but reputation reward | War support, reputation building |

The default for a new facility is **warehouse**. Players opt into auto-sell or other routing. This ensures new players don't accidentally dump production into a bad market.

**Warehouse overflow**: If the warehouse is full and output can't be routed elsewhere, the facility pauses production. Goods are not lost — the player needs to either sell, ship out, or expand warehouse capacity. This makes warehouses (see [Player Facilities §5.1](./player-facilities.md)) essential infrastructure for production operations.

---

## 4. Trait Quality and Production Rates

System traits directly affect production facility output. Higher quality traits mean better production rates — a tier-3 asteroid belt supports more efficient mining than a tier-1 debris field.

### 4.1 Quality Multiplier

Each production facility type has prerequisite traits (defined in the facility roster, §6). The quality tier of the relevant trait multiplies the facility's base output rate:

| Trait Quality | Output Multiplier | Notes |
|---|---|---|
| Tier 1 (Marginal) | 1.0x | Baseline. The facility works but nothing special |
| Tier 2 (Solid) | 1.3–1.5x | Meaningful improvement. Worth seeking out |
| Tier 3 (Exceptional) | 1.6–2.0x | Significant advantage. These systems are premium real estate for production |

Exact multipliers are per-facility tuning numbers. The range should feel meaningful enough to drive location decisions — players should actively seek tier-3 trait systems for their production facilities.

### 4.2 Multiple Trait Bonuses

Some facilities benefit from multiple traits. A refinery at a system with both volcanic world (geothermal energy) and helium-3 reserves (fuel feedstock) gets bonuses from both. The bonuses stack additively, not multiplicatively, to prevent extreme outliers.

### 4.3 Upgrade Interaction

Major-tier facilities (upgraded from minor via [Player Facilities §2.2](./player-facilities.md)) have higher base output rates. The trait quality multiplier applies on top of the upgraded base — so a major mining operation at a tier-3 asteroid belt system is significantly more productive than a minor one at a tier-1 system. This reinforces the progression: invest in upgrades AND choose good locations.

---

## 5. War Contributions and Military Production

The production system connects to the war system at two levels: market goods that factions consume more of during wartime, and non-market military assets that players produce directly for faction war efforts.

### 5.1 Market Goods in Wartime

During wars, factions consume more of many market goods — not just military-tagged ones. An army needs food, fuel, metals, and medicine as much as it needs munitions. Wartime demand spikes apply across a broad range of goods near the front lines.

**Any market good can be donated** to a faction via the faction contribution output routing (§3.3). Donating food to a war effort earns reputation — less per credit value than donating munitions, but it still counts as support. This means early/mid game players producing tier 0 and tier 1 civilian goods can meaningfully participate in wars through their production.

**Key rule**: Donating market goods (any tier, any type) does **not** count as direct war involvement for the asset seizure mechanic (see [Player Facilities §4.2](./player-facilities.md)). You're a civilian supplier — contributing to the war economy, but not an arms manufacturer. This protects trade-focused players who want to support a faction without risking their facilities.

Military-tagged market goods (Munitions, Hull Plating, Weapons, Weapons Systems, Targeting Arrays, Reactor Cores, Ship Frames) earn more reputation per credit value when donated, and are prioritised by faction demand during wars. But they're still normal market goods — freely tradeable, with civilian use cases (ship defense, station maintenance, power generation).

### 5.2 Military Assets (Tier 3 — Non-Market)

Military assets are a separate production tier that exists outside the market entirely. These are actual military capability — warships, troop equipment, heavy ordnance — produced by dedicated late-game facilities and donated directly to faction war efforts. They never enter the market.

**Key rule**: Producing and donating military assets **does** count as direct war involvement. This is the bright line — building warships for a faction makes you an arms manufacturer. Asset seizure risk applies (see [Player Facilities §4.2](./player-facilities.md)).

Full details on military asset categories, inputs, and war system integration are in [Production Roster §5](./production-roster.md).

### 5.3 The Bright Line

| Action | War involvement? | Asset seizure risk? |
|---|---|---|
| Selling goods on the market (even military-tagged) | No | No |
| Donating market goods to a faction (food, fuel, munitions, anything) | No | No |
| Producing tier 3 military assets for a faction | **Yes** | **Yes** |

This creates a clear, player-visible distinction. The player always knows which side of the line they're on. Selling weapons on the open market is commerce. Building warships for a specific faction is choosing a side.

---

## 6. Production Facility Roster

The full catalog of production facility types, their recipes, and any new goods introduced by the production system is defined in a separate document.

See [Production Roster](./production-roster.md) for:
- Complete goods list (26 market goods across 3 tiers + tier 3 military assets)
- New goods introduced by the production system (14 new market goods)
- Production chain visualization and bottleneck analysis
- Goods availability by economy type
- NPC production/consumption rates for new goods
- Production facility types with placement requirements (to be designed)
- Tier 3 military asset categories and inputs

---

## 7. Tick Processing

Production facilities require tick processing for:

- **Production cycle**: Each operational facility runs its recipe — consume inputs (if required), produce output goods, route to destination (warehouse, market, linked facility, faction)
- **Input purchasing**: Facilities set to buy inputs from the local market execute purchases at current prices
- **Market impact**: Player production output that enters the market adjusts supply values, bounded by the system's absorption capacity

This processing is handled by the player facilities tick processor defined in [Player Facilities §7](./player-facilities.md). Production-specific logic (recipe execution, input sourcing, output routing) runs as part of the same processor, after operating costs are deducted and before market impact is applied.

**Processing order matters**: Production facilities that feed into other facilities (via linked facility routing) must process in dependency order — tier 0 facilities first, then tier 1, then tier 2. This ensures input goods are available in the same tick they're produced.

---

## 8. Income Hierarchy

Production income must fit within the broader economy. The guiding principle: **active play should always beat passive income.** A player who logs in and trades should earn more than one who set up facilities and walked away. But facilities should feel worthwhile — they're expensive to build and risky to own.

### 8.1 Income Sources, Ranked

From least to most profitable per unit of player effort:

| Rank | Source | Type | Description |
|---|---|---|---|
| 1 | Auto-sell production | Passive | Facility output sold at current market price automatically. Covers operating costs plus modest profit. The "I'm offline" income stream |
| 2 | Trade missions | Semi-passive | Accept contract, fly cargo, deliver. Accessible mid-game income. Predictable but capped by mission availability |
| 3 | Manual trading | Active | Buy low, sell high across systems. Route knowledge and timing rewarded. The core game loop |
| 4 | Production + manual trading | Active + passive | Produce goods at your facilities, ship them yourself to high-demand systems instead of auto-selling. Better margins than either activity alone |
| 5 | Vertical integration | Active + heavy investment | Own the input chain — extract raw materials, process them, manufacture finished goods, sell at the end. Highest complexity, highest investment, highest return |

### 8.2 Design Guardrails

These are the principles that tuning numbers must satisfy. If simulation testing produces results that violate these, the numbers are wrong:

- **Auto-sell should not be competitive with active trading.** A player running three facilities on auto-sell should earn less per tick than a player actively trading the same goods manually. Passive income is a floor, not a ceiling.
- **Operating costs should be meaningful.** Facility upkeep should consume 40–60% of gross auto-sell income at neutral reputation. This ensures facilities are profitable but not a money printer. Standing tax at hostile reputation can push this above 100%, making the facility a net loss — pressure to maintain faction relations.
- **Manual trading should beat auto-sell by a significant margin.** A player who collects their production output and sells it at the best available market should earn 2–3x what auto-sell would have given them. This rewards engagement without making auto-sell pointless.
- **Vertical integration should be the most profitable per-good strategy.** A player who mines Ore, refines it into Metals, manufactures Components, and sells Components should earn more total profit than a player who buys Metals at market and manufactures Components. The margin advantage compensates for the complexity and capital investment.
- **Missions should complement, not compete with, production.** Trade missions offer predictable income with lower variance than trading. A player running missions while their facilities auto-sell should feel productive — the two income streams don't cannibalize each other.
- **No single income source should dominate.** A well-played late game involves all sources working together — production feeds trading routes, missions fill downtime, vertical integration maximises margins on key goods. Tuning should discourage mono-strategies.

### 8.3 Progression Curve

Income hierarchy also maps to game progression:

| Phase | Primary income | Facility role |
|---|---|---|
| Early game | Manual trading, basic missions | No facilities — not yet unlocked |
| Mid game | Trading + missions | First minor facilities. Auto-sell supplements active income. Learning what to build and where |
| Late game | Trading + production + missions | Major facilities, multi-system production chains. Vertical integration becomes viable. Facility income is a significant but not dominant share of total income |

Specific income targets per phase (credits per tick, facility output rates, operating cost percentages) are tuning numbers for implementation, validated through the simulator. The hierarchy and guardrails above are the constraints those numbers must satisfy.

---

## 9. Open Questions — Deferred to Implementation

All remaining open questions are tuning numbers that require simulation testing. The design decisions are made — these are the knobs to turn during implementation.

**Economy scaling** (validated via simulator):
- **Supply/demand range increase**: From current 5–200 to what range? Must provide granularity for player production as a small fraction of total activity.
- **Absorption capacity formula**: Exact relationship between population, trait quality, and market absorption.

**Population** (validated via world generation testing):
- **Population derivation formula**: Exact mapping from traits to population value at generation.
- **Population drift rates**: How fast does population change in response to wars, events, prosperity?

**Production rates** (validated via simulator + income hierarchy guardrails from §8):
- **Facility output rates**: Units produced per tick per facility type and tier. Must satisfy the income hierarchy — auto-sell covers costs plus modest profit, manual trading beats auto-sell by 2–3x.
- **Input/output ratios**: How many units of input consumed per unit of output. Determines vertical integration profitability.
- **Operating cost percentages**: 40–60% of gross auto-sell income at neutral reputation (§8.2 guardrail).

See also [Production Roster §10](./production-roster.md) for per-good tuning (prices, volatility, NPC rates).

---

## Related Design Docs

- **[Player Facilities](./player-facilities.md)** — universal build system (construction, upgrades, costs, limits, asset risk)
- **[Economy](../active/economy.md)** — market simulation, supply/demand, production/consumption rates
- **[System Enrichment](./system-enrichment.md)** — system traits, economy types, trait quality tiers, faction facilities
- **[Simulation Enhancements](../archive/simulation-enhancements.md)** — supply chain dependencies, NPC trade pressure (archived — supply chain mechanics now covered in this doc)
- **[Faction System](./faction-system.md)** — war material demand, faction economy effects, reputation
- **[War System](./war-system.md)** — war material consumption, front-line demand spikes
- **[Player Progression](./player-progression.md)** — production facilities as mid/late game content, ship automation
- **[Navigation](../active/navigation.md)** — transport of goods between systems
