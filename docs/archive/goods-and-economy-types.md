# Goods & Economy Types — Design

Foundational decisions for the trading economy. Every other balance lever (price clamps, equilibrium targets, events) depends on what goods exist, how they're differentiated, and how economy types interact with them.

## Decision: 12 Goods

Expand from the original 6 goods to 12, organized into 3 tiers.

### Why 12

- **Research validated 10-15 as the sweet spot** for trading games without production chains. Space Trader (10 goods, no chains) proved this creates engaging decisions. Games with 30+ goods (Pardus, Prosperous Universe) all rely on deep production chains to create mandatory demand — without chains, extra goods are just "more things with different prices."
- **12 fits our performance budget.** The economy processor updates every `StationMarket` row (system x good) per tick via round-robin regions. At 12 goods x ~200 systems = 2,400 rows total, ~240 updates per tick per region. Well within SQLite/better-sqlite3 capacity.
- **12 supports 6-7 distinct economy types** with 2-3 signature produces/consumes each, avoiding the current problem where 2 goods (ship_parts, electronics) account for 95-100% of profit.
- **Market table stays scannable** — players can read 12 rows at a glance.

### Future: Production Chains

The 12 goods are organized into 3 tiers that form an implicit production DAG. Tiers are **cosmetic for now** — the game doesn't enforce production relationships. When production is added later, the tier structure becomes functional (refineries convert tier 0 ore into tier 1 metals, etc.). The goods were chosen so this transition is natural, not a retrofit.

The goods count can expand beyond 12 when production chains create mandatory demand for new intermediates. This will likely coincide with a PostgreSQL migration that enables batch SQL updates for the economy processor.

---

## Good Properties

Each good has 8 properties. Some are functional now, others are data-only until supporting systems are built.

### `name` (string)
Display name shown in market tables, cargo manifests, and trade UIs. e.g. "Electronics", "Weapons".

### `description` (string)
Flavor text for the market UI. Gives players thematic context. e.g. "Refined alloys and composite materials used in construction and manufacturing."

### `basePrice` (number)
Anchor value for the pricing formula: `price = basePrice * (demand / supply)`, clamped to a configurable range. Higher base price means higher absolute profit per unit at the same supply/demand ratio. Range across all goods: 10 (Water) to 150 (Luxuries), a 15:1 ratio.

**Status:** Functional now.

### `tier` (0 | 1 | 2)
Conceptual production tier. Tier 0 goods are raw materials (extracted/harvested). Tier 1 goods are processed (refined from raws). Tier 2 goods are advanced (complex manufacturing). Currently cosmetic — used only for display grouping and to inform balance decisions (e.g. per-tier price clamp ranges). Becomes functional when production chains are added.

- **Tier 0 (Raw):** Water, Food, Ore, Textiles — base prices 10-25
- **Tier 1 (Processed):** Fuel, Metals, Chemicals, Medicine — base prices 35-65
- **Tier 2 (Advanced):** Electronics, Machinery, Weapons, Luxuries — base prices 80-150

**Status:** Data only. Functional with production system (future).

### `volume` (number)
Cargo slots consumed per unit. Most goods are volume 1 (one unit = one cargo slot). Bulky goods (Water, Ore, Machinery) are volume 2 — they take twice the cargo space, so players must evaluate **profit per slot**, not just profit per unit. This creates a meaningful distinction between compact high-value goods and bulky low-value goods without changing the cargo system's fundamentals.

A ship with 30 cargo slots can carry 30 Electronics (vol 1) or 15 Ore (vol 2). If Ore pays 40cr profit per unit and Electronics pays 60cr, the naive choice is Electronics — but if Ore's margins are wider at a nearby system and fuel is cheap, 15 Ore at 40cr (600cr total, low fuel cost) might beat 30 Electronics at 20cr (600cr total, high fuel cost for a distant route).

**Status:** Requires minor cargo capacity check changes. Intended for the goods expansion implementation.

### `mass` (number)
Fuel cost multiplier for transporting this good. Standard mass is 1.0. Heavy goods (Ore at 2.5, Machinery at 2.5) cost more fuel to haul, making them profitable only on short routes. Light goods (Textiles at 0.5, Electronics at 0.5) are fuel-efficient, making them viable on long-distance routes even at thin margins.

This creates **geographic differentiation**: heavy goods favor local trade loops, light goods favor exploration and long hauls. A player choosing between a 2-hop Ore run and a 5-hop Textiles run is making a genuine strategic decision based on their ship's fuel capacity and cargo size.

Implementation: multiply the base fuel cost of a route by the average mass of carried cargo. A ship carrying 20 Ore (mass 2.5) on a 10-fuel hop spends 25 fuel instead of 10. A ship carrying 20 Textiles (mass 0.5) on the same hop spends 5 fuel.

**Status:** Requires fuel cost calculation changes. Intended for the goods expansion implementation.

### `volatility` (number)
Multiplier on the price noise amplitude in the economy processor. Standard volatility is 1.0. Low-volatility goods (Water at 0.5) have stable, predictable prices — safe trades with narrow margins. High-volatility goods (Weapons at 2.0, Luxuries at 1.8) have dramatic price swings — huge potential profits but also risk of prices crashing while you're in transit.

This creates a **risk/reward spectrum**. Conservative players stick to stable goods (Water, Food, Ore). Aggressive players chase volatile goods (Weapons, Medicine, Luxuries) and time their trades around events. Medicine at volatility 1.5 is normally boring but explodes in value during plague events — a player who monitors events and reacts quickly is rewarded.

Implementation: multiply `NOISE_AMPLITUDE` by the good's volatility when computing the per-tick supply/demand noise for that good's market entries.

**Status:** Requires minor economy processor changes. Intended for the goods expansion implementation.

### `hazard` ("none" | "low" | "high")
How physically dangerous the good is to transport. Hazardous cargo increases risk during transit — ties into the existing danger system. Fuel is mildly hazardous (combustible). Chemicals are mildly hazardous (reactive, corrosive). Weapons are highly hazardous (explosive, attracts pirates).

Possible future effects: increased danger roll modifiers when carrying hazardous cargo, chance of cargo self-damage during transit, special ship modules required for safe transport (insulated holds, weapons lockers), visual warnings in the cargo UI.

This is a **physical property of the good**, not a policy decision. Chemicals are inherently dangerous to carry regardless of local laws. This distinguishes hazard from trade restrictions (see Trade Restrictions below).

**Status:** Data only. Functional when danger system is expanded (future).

---

## Trade Restrictions

Trade restrictions are **not a property of goods**. They are a policy enforced at the system, region, or government-type level. A region or system holds a list of restricted good IDs (e.g. `restrictedGoods: ["weapons"]`). The good itself has no knowledge of whether it's restricted anywhere.

This separation means:
- Any good can be restricted anywhere without changing the good definition
- Different regions/systems can have different restriction policies
- Government types or economy types can define default restriction lists
- The restriction system is fully extensible without touching the goods constants

Likely first candidates for restriction: Weapons (military/security concerns), Chemicals (dual-use precursor materials). But the system is designed so even Water could be restricted in a specific region if the game fiction demands it.

**Status:** Not implemented. Requires region/system policy model (future).

---

## The 12 Goods

### Tier 0 — Raw

Extracted or harvested directly from natural sources. Cheap per unit, high natural supply at producing systems. These are the economy's foundation — every settlement needs them.

#### 1. Water
| Property | Value |
|----------|-------|
| Base Price | 10 |
| Tier | 0 |
| Volume | 2 |
| Mass | 2.0 |
| Volatility | 0.5 |
| Hazard | none |

The most basic resource. Every settlement needs water, creating universal demand. Extremely bulky and heavy — only profitable on short hops with large cargo holds. Very stable prices make it the safest, most predictable trade in the game. The "bulk hauler's bread and butter" — boring but reliable.

#### 2. Food
| Property | Value |
|----------|-------|
| Base Price | 15 |
| Tier | 0 |
| Volume | 1 |
| Mass | 1.0 |
| Volatility | 0.7 |
| Hazard | none |

Agricultural produce, livestock, organics. Standard size and weight with broad cross-cutting demand — mining colonies, military stations, and core worlds all need food. Slightly more volatile than water (crop yields vary), providing marginally better margins for slightly more risk. The reliable staple trade.

#### 3. Ore
| Property | Value |
|----------|-------|
| Base Price | 20 |
| Tier | 0 |
| Volume | 2 |
| Mass | 2.5 |
| Volatility | 0.6 |
| Hazard | none |

Raw minerals and unrefined metals extracted from asteroids and planetary mines. The bulkiest AND heaviest good in the game — fuel costs severely punish long routes. But refineries and industrial systems have strong, consistent demand. The quintessential short-haul bulk commodity. Future production input for Metals.

#### 4. Textiles
| Property | Value |
|----------|-------|
| Base Price | 25 |
| Tier | 0 |
| Volume | 1 |
| Mass | 0.5 |
| Volatility | 0.8 |
| Hazard | none |

Fibers, fabrics, and synthetic materials. The deliberate outlier in tier 0: cheap but **light and compact**. Where Water and Ore demand large holds and short routes, Textiles reward long-distance hauling — thin margins per unit but minimal fuel cost. Gives agricultural systems a second export with completely different trading characteristics from Food.

### Tier 1 — Processed

Refined or manufactured from raw materials. Mid-range prices, moderate physical properties. These goods represent the first stage of industrial transformation.

#### 5. Fuel
| Property | Value |
|----------|-------|
| Base Price | 35 |
| Tier | 1 |
| Volume | 1 |
| Mass | 1.5 |
| Volatility | 1.0 |
| Hazard | low |

Refined hydrogen, fusion cells, and propellant. Universal need — every ship burns it, every station stocks it. The baseline-volatility good (1.0) against which all others are measured. Slightly hazardous (combustible propellant) and moderately heavy. Fuel is the economy's connective tissue — always tradeable, always in demand, never spectacular.

#### 6. Metals
| Property | Value |
|----------|-------|
| Base Price | 45 |
| Tier | 1 |
| Volume | 1 |
| Mass | 2.0 |
| Volatility | 0.8 |
| Hazard | none |

Refined alloys and composite materials. Heavy (mass 2.0) but significantly more valuable per unit than raw Ore. The classic value-add trade: buy Ore cheap at mining systems, sell Metals from refinery systems to industrial/tech economies. Short-route good due to weight. Future production: Ore → Metals pipeline.

#### 7. Chemicals
| Property | Value |
|----------|-------|
| Base Price | 55 |
| Tier | 1 |
| Volume | 1 |
| Mass | 1.0 |
| Volatility | 1.2 |
| Hazard | low |

Industrial compounds, reagents, solvents, and polymers. Standard weight but slightly hazardous (reactive, corrosive) and **more volatile** than other tier 1 goods. Prices swing with events — wars need explosives, plagues need disinfectant, industrial booms need feedstock. A secondary candidate for system-level trade restrictions (dual-use precursor materials). Consumed across multiple economy types, creating broad demand.

#### 8. Medicine
| Property | Value |
|----------|-------|
| Base Price | 65 |
| Tier | 1 |
| Volume | 1 |
| Mass | 0.5 |
| Volatility | 1.5 |
| Hazard | none |

Pharmaceuticals, medical equipment, and biotech supplies. Light and compact but **highly volatile** — the event trader's dream. During peacetime, Medicine is a decent mid-tier trade. During plague events, demand explodes and prices spike dramatically. Players who monitor events and react quickly are rewarded with the best margins in tier 1. Ties directly into the existing plague event system.

### Tier 2 — Advanced

Complex manufactured goods requiring sophisticated industrial capacity. Expensive, with diverse physical and risk profiles. These are the economy's high-value targets.

#### 9. Electronics
| Property | Value |
|----------|-------|
| Base Price | 80 |
| Tier | 2 |
| Volume | 1 |
| Mass | 0.5 |
| Volatility | 1.0 |
| Hazard | none |

Components, processors, computing hardware, and sensor arrays. Light and compact — the premium long-distance trade good. Moderate volatility, no special handling requirements. Electronics are the reliable workhorse of tier 2: consistently profitable without dramatic risk. The "steady high-value trader's" choice.

#### 10. Machinery
| Property | Value |
|----------|-------|
| Base Price | 100 |
| Tier | 2 |
| Volume | 2 |
| Mass | 2.5 |
| Volatility | 0.8 |
| Hazard | none |

Industrial equipment, construction systems, mining rigs, and agricultural harvesters. The counterpoint to "expensive goods are always small" — Machinery is high-value, bulky, AND heavy. Same physical profile as Ore but 5x the base price. Rewards large cargo ships on short routes to systems that need industrial equipment. Creates a distinct "heavy premium hauler" playstyle separate from the light-and-fast Electronics trader.

#### 11. Weapons
| Property | Value |
|----------|-------|
| Base Price | 120 |
| Tier | 2 |
| Volume | 1 |
| Mass | 1.5 |
| Volatility | 2.0 |
| Hazard | high |

Arms, ordnance, defensive systems, and military hardware. The **highest volatility** good in the game — prices explode during war events and crash during peacetime. High hazard level (explosive cargo attracts pirates, increases danger rolls). The primary candidate for regional trade restrictions. The smuggler's choice: enormous potential profit if you can sell in the right place at the right time, but carrying Weapons is dangerous and some regions won't let you trade them at all.

#### 12. Luxuries
| Property | Value |
|----------|-------|
| Base Price | 150 |
| Tier | 2 |
| Volume | 1 |
| Mass | 0.5 |
| Volatility | 1.8 |
| Hazard | none |

Art, rare materials, exotic goods, and prestige items. The most expensive good with very high volatility. Light and compact — easy to carry but hard to predict. No hazard, no restrictions — the risk is purely economic. Prices can spike to extraordinary levels or crash while you're in transit. The gambler's trade: highest ceiling, highest variance.

---

## Trading Archetypes

The property combinations naturally create distinct playstyles:

| Archetype | Typical Goods | Ship Preference | Route Style |
|-----------|--------------|-----------------|-------------|
| **Bulk hauler** | Water, Ore, Machinery | Large cargo | Short hops, high volume per run |
| **Long-distance runner** | Textiles, Electronics, Luxuries | Fuel-efficient | Far routes, light cargo, fuel savings |
| **Steady trader** | Food, Fuel, Metals | Balanced | Medium routes, reliable margins |
| **Event chaser** | Medicine, Chemicals, Weapons | Fast | Wherever crisis events spike demand |

These aren't rigid classes — a player hauling Machinery locally might switch to Luxuries for a cross-region opportunity. The archetypes emerge from the economics, not from game rules.

---

## Implicit Production DAG

When production chains are added, the tier structure maps to this directed acyclic graph:

```
Tier 0 (Raw)           Tier 1 (Processed)        Tier 2 (Advanced)
─────────────           ──────────────────        ─────────────────
Water ──────────┐
                ├──────→ Chemicals ──────────────→ Electronics
Ore ────────────┤                                      │
                ├──────→ Metals ─────────────────→ Machinery
Food ───────────┤                  │
                ├──────→ Medicine   ├─────────────→ Weapons
Textiles ───────┘                  │
                                   └──→ Fuel      → Luxuries
                                                    (multi-input)
```

This is illustrative, not final — exact recipes will be designed when production is implemented. The point is that the 12 goods were chosen so the production relationships are intuitive, not forced.

---

## Summary Table

| # | Key | Name | Price | Tier | Vol | Mass | Volatility | Hazard |
|---|-----|------|-------|------|-----|------|-----------|--------|
| 1 | water | Water | 10 | 0 | 2 | 2.0 | 0.5 | none |
| 2 | food | Food | 15 | 0 | 1 | 1.0 | 0.7 | none |
| 3 | ore | Ore | 20 | 0 | 2 | 2.5 | 0.6 | none |
| 4 | textiles | Textiles | 25 | 0 | 1 | 0.5 | 0.8 | none |
| 5 | fuel | Fuel | 35 | 1 | 1 | 1.5 | 1.0 | low |
| 6 | metals | Metals | 45 | 1 | 1 | 2.0 | 0.8 | none |
| 7 | chemicals | Chemicals | 55 | 1 | 1 | 1.0 | 1.2 | low |
| 8 | medicine | Medicine | 65 | 1 | 1 | 0.5 | 1.5 | none |
| 9 | electronics | Electronics | 80 | 2 | 1 | 0.5 | 1.0 | none |
| 10 | machinery | Machinery | 100 | 2 | 2 | 2.5 | 0.8 | none |
| 11 | weapons | Weapons | 120 | 2 | 1 | 1.5 | 2.0 | high |
| 12 | luxuries | Luxuries | 150 | 2 | 1 | 0.5 | 1.8 | none |

---

## Three-Level Architecture

Market behavior at any station is the composition of three independent layers. Each layer controls different mechanics, and the layers are orthogonal — any combination of good + economy type + government type produces coherent behavior.

```
┌──────────────────────────────────────────────────────────────┐
│ REGION                                                       │
│ ┌──────────────────┐  ┌──────────────────────────────────┐  │
│ │ Region Identity   │  │ Government Type                  │  │
│ │ (economic char.)  │  │ (political char.)                │  │
│ │ Influences        │  │ Modifies trade restrictions,     │  │
│ │ economy type      │  │ danger, volatility, equilibrium  │  │
│ │ distribution      │  │ spreads, event weights,          │  │
│ │                   │  │ consumption boosts               │  │
│ └──────────────────┘  └──────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ SYSTEM                                                 │  │
│  │ Economy Type → what goods are produced/consumed,       │  │
│  │                at what rates, equilibrium targets       │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │ GOOD (intrinsic)                                 │  │  │
│  │  │ basePrice, tier, volume, mass, volatility, hazard│  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Which Mechanics Operate At Which Level

| Mechanic | Level | Why it belongs there |
|----------|-------|---------------------|
| Base price, tier, volume, mass, hazard | **Good** | Intrinsic physical/economic properties of the commodity |
| Volatility (base) | **Good** | How inherently volatile the commodity's price is |
| Production goods & rates | **Economy Type** (system) | What the system's economy produces and how fast |
| Consumption goods & rates | **Economy Type** (system) | What the system's economy needs and how fast |
| Equilibrium targets | **Economy Type** (system) | Supply/demand balance point per good per economy |
| Economy type distribution | **Region Identity** (region) | Which economy types are common in this region |
| Trade restrictions | **Government Type** (region) | Political decision — which goods are banned/controlled |
| Volatility modifier | **Government Type** (region) | Political stability affects price swings region-wide |
| Danger baseline | **Government Type** (region) | Security level of the region |
| Equilibrium spread modifier | **Government Type** (region) | Regulated vs free markets affect margin width |
| Event weights | **Government Type** (region) | Political climate drives which events occur |
| Consumption boosts | **Government Type** (region) | Government-driven demand (military procurement, etc.) |

---

## Economy Types

Expanded from 5 to **6 types** by splitting out Refinery from Industrial. Each type has a clear, non-overlapping role in the production/consumption web.

### Why 6 Types

The original 5 types had Industrial doing double duty — processing raw materials (ore → fuel, ship_parts) AND complex manufacturing. With 12 goods, this creates the same concentration problem: one type dominates because it produces too many valuable goods. Splitting Refinery out creates a natural two-hop chain (Extraction → Refinery → Industrial) that generates more trade routes and makes more systems worth visiting.

A military type was considered but rejected. Military demand (weapons, fuel, food) is better handled at the **region level** via government type consumption boosts. This is cleaner because military presence is a political reality that varies by region, not an economic specialization. It also avoids a consumer-only type with no clear production output (which is what Core already provides).

More economy types (6+) can be added later for specialized niches (research stations, resort worlds, prison colonies) without disrupting the core 6. The system is designed so new types are additive — they just define their own production/consumption lists.

### Type Definitions

#### Agricultural
**Role:** Farming, ranching, plantations. The food basket of the galaxy.

| | Goods | Rates |
|---|---|---|
| **Produces** | Food, Textiles | food: 5, textiles: 4 |
| **Consumes** | Water, Machinery, Chemicals, Medicine | water: 4, machinery: 1, chemicals: 3, medicine: 1 |

Agricultural systems produce cheap, high-turnover goods. Their fast production rates mean markets replenish quickly — a trader can buy Food here repeatedly. They consume Water (irrigation), Machinery (harvesters, processors), Chemicals (fertilizers, pesticides), and Medicine (rural healthcare). This makes them a destination for 4 different goods from 3 different economy types, solving the old problem of agricultural systems being ignored.

#### Extraction
**Role:** Mining, ice harvesting, asteroid drilling. Raw material source.

| | Goods | Rates |
|---|---|---|
| **Produces** | Ore, Water | ore: 4, water: 5 |
| **Consumes** | Food, Fuel, Machinery, Textiles | food: 3, fuel: 3, machinery: 1, textiles: 2 |

Extraction systems sit at the bottom of the supply chain — everything starts here. They produce bulky, heavy raw materials at high rates. They consume Food (worker sustenance), Fuel (mining operations), Machinery (equipment), and Textiles (worker supplies). Like Agricultural, they're both a source AND a destination for multiple goods.

#### Refinery
**Role:** Smelting, chemical processing, fuel synthesis. The tier 0 → tier 1 converter.

| | Goods | Rates |
|---|---|---|
| **Produces** | Fuel, Metals, Chemicals | fuel: 3, metals: 3, chemicals: 2 |
| **Consumes** | Ore, Water | ore: 4, water: 3 |

The critical missing link in the original economy. Refineries take raw materials (Ore, Water) and output processed goods (Fuel, Metals, Chemicals). They're the highest-output type (3 goods produced) but with moderate rates and only 2 consumption inputs. This creates a natural bottleneck: Refinery systems are always hungry for Ore and Water, making Extraction → Refinery the most consistent short-haul route in the game.

#### Industrial
**Role:** Factories, shipyards, arms manufacturing. Complex assembly.

| | Goods | Rates |
|---|---|---|
| **Produces** | Machinery, Weapons | machinery: 2, weapons: 1 |
| **Consumes** | Metals, Electronics, Chemicals, Fuel | metals: 3, electronics: 2, chemicals: 2, fuel: 2 |

Industrial systems build the most complex (and valuable) physical goods. Slow production rates mean markets deplete quickly — a big Machinery purchase takes many ticks to replenish, forcing traders to rotate between sources. They consume from Refinery (Metals, Chemicals, Fuel) and High-Tech (Electronics), creating multi-directional trade dependencies.

Weapons at rate 1 are the scarcest produced good. This is intentional — combined with Weapons' high volatility (2.0), it means supply is always tight and prices swing dramatically.

#### High-Tech
**Role:** Research labs, medical facilities, advanced computing. Knowledge economy.

| | Goods | Rates |
|---|---|---|
| **Produces** | Electronics, Medicine | electronics: 2, medicine: 2 |
| **Consumes** | Metals, Chemicals, Luxuries | metals: 2, chemicals: 2, luxuries: 1 |

High-Tech systems produce the most valuable lightweight goods. Electronics is the workhorse high-value trade; Medicine is the volatile event-driven opportunity. They consume refined materials (Metals, Chemicals) and Luxuries (research grants, institutional prestige, talent attraction). The Luxuries consumption is important — it creates demand for Core system exports, making Core a viable trade *source*.

#### Core
**Role:** Capital worlds, cultural centers, administrative hubs. The galaxy's demand engine.

| | Goods | Rates |
|---|---|---|
| **Produces** | Luxuries | luxuries: 1 |
| **Consumes** | Food, Textiles, Electronics, Medicine, Weapons | food: 3, textiles: 2, electronics: 2, medicine: 2, weapons: 1 |

Core systems are consumer-heavy: they produce only Luxuries (at the slowest rate in the game) but consume 5 different goods. This makes them a universal destination — there's almost always something profitable to sell at a Core system. Weapons consumption (at rate 1) represents police/defense needs. Combined with government type consumption boosts (see below), Core systems in Authoritarian regions consume weapons even faster.

Core's Luxuries production at rate 1 means supply is always scarce. Combined with Luxuries' high volatility (1.8) and only one consumer type (High-Tech), Luxuries trading is high-risk, high-reward: enormous potential margins but an unpredictable market.

### Production/Consumption Web

Visual overview of all trade flows. Arrows point from producer to consumer.

```
                    AGRICULTURAL              EXTRACTION
                   ┌─────────────┐          ┌────────────┐
                   │ Produces:   │          │ Produces:  │
                   │  Food ──────┼─────────→│  Ore ──────┼──────┐
                   │  Textiles ──┼─────┐───→│  Water ────┼───┐  │
                   │             │     │    │            │   │  │
                   │ Consumes:   │     │    │ Consumes:  │   │  │
               ┌──→│  Water      │     │  ┌→│  Food      │   │  │
               │ ┌→│  Machinery  │     │  │ │  Fuel      │←┐ │  │
               │ │ │  Chemicals  │←┐   │  │ │  Machinery │←┼─┼──┼─┐
               │ │ │  Medicine   │←┼─┐ │  │ │  Textiles  │ │ │  │ │
               │ │ └─────────────┘ │ │ │  │ └────────────┘ │ │  │ │
               │ │                 │ │ │  │                │ │  │ │
               │ │    REFINERY     │ │ │  │   INDUSTRIAL   │ │  │ │
               │ │ ┌─────────────┐ │ │ │  │ ┌────────────┐ │ │  │ │
               │ │ │ Produces:   │ │ │ │  │ │ Produces:  │ │ │  │ │
               │ │ │  Fuel ──────┼─┼─┼─┼──┘ │  Machinery─┼─┘ │  │ │
               │ │ │  Metals ────┼─┼─┼─┼────→│  Weapons ──┼───┼──┼─┼──┐
               │ │ │  Chemicals ─┼─┘ │ │    │            │   │  │ │  │
               │ │ │             │   │ │    │ Consumes:  │   │  │ │  │
               │ │ │ Consumes:   │   │ │    │  Metals    │←──┼──┘ │  │
               │ └─┼──Ore        │   │ │    │  Electronics│←─┼────┼──┼─┐
               └───┼──Water      │   │ │    │  Chemicals │←──┼────┘  │ │
                   └─────────────┘   │ │    │  Fuel      │←──┼───────┘ │
                                     │ │    └────────────┘   │         │
                      HIGH-TECH      │ │       CORE          │         │
                   ┌─────────────┐   │ │    ┌────────────┐   │         │
                   │ Produces:   │   │ │    │ Produces:  │   │         │
                   │  Electronics┼───┼─┼───→│  Luxuries ─┼───┘         │
                   │  Medicine ──┼───┘ │    │            │             │
                   │             │     │    │ Consumes:  │             │
                   │ Consumes:   │     │    │  Food      │←────────────┤
                   │  Metals     │←────┤    │  Textiles  │←────────────┤
                   │  Chemicals  │←────┤    │  Electronics│←───────────┤
                   │  Luxuries   │←────┘    │  Medicine  │←────────────┤
                   └─────────────┘          │  Weapons   │←────────────┘
                                            └────────────┘
```

### Good Coverage Summary

Every good is produced by exactly 1 economy type and consumed by 2-4 types:

| Good | Produced by | Consumed by | Consumers |
|------|------------|-------------|-----------|
| Water | Extraction | Agricultural, Refinery | 2 |
| Food | Agricultural | Extraction, Refinery, Core | 3 |
| Ore | Extraction | Refinery | 1 (high volume) |
| Textiles | Agricultural | Extraction, Core | 2 |
| Fuel | Refinery | Extraction, Industrial | 2 |
| Metals | Refinery | Industrial, High-Tech | 2 |
| Chemicals | Refinery | Agricultural, Industrial, High-Tech | 3 |
| Medicine | High-Tech | Agricultural, Core | 2 |
| Electronics | High-Tech | Industrial, Core | 2 |
| Machinery | Industrial | Agricultural, Extraction | 2 |
| Weapons | Industrial | Core | 1 (+ government boosts) |
| Luxuries | Core | High-Tech | 1 (+ government boosts) |

Ore has only 1 consumer type (Refinery) because only refineries process raw minerals — this is intentional and thematically correct. The high consumption rate (4) ensures strong demand despite having a single consumer type.

Weapons and Luxuries have only 1 base consumer type each but get additional demand through **government type consumption boosts** (see below). Authoritarian regions add weapons demand at all systems; Corporate regions add luxuries demand. This means their effective consumer count varies by region, creating geographic pockets of opportunity.

### Production Rate Philosophy

Rates follow a clear pattern: **raw goods produce fast, advanced goods produce slow.**

| Tier | Production rates | Market behavior |
|------|-----------------|-----------------|
| Tier 0 (Raw) | 4-5 per tick | Fast turnover. Markets replenish quickly. Traders can revisit the same source repeatedly. Volume play. |
| Tier 1 (Processed) | 2-3 per tick | Moderate turnover. Markets recover between trades but can be depleted by heavy traffic. |
| Tier 2 (Advanced) | 1-2 per tick | Slow turnover. One big trade depletes the market for many ticks. Forces traders to rotate between sources. Breaks the "same loop forever" pattern. |

This creates a natural tradeoff: cheap goods are always available but low-margin; expensive goods are high-margin but scarce. A player who buys all the Weapons at an Industrial system (rate 1) won't find more for many ticks. A player buying Food at an Agricultural system (rate 5) can come back almost immediately.

Consumption rates follow the same tier pattern but are generally slightly lower than production rates for the same good, ensuring that production systems maintain a supply surplus over time (the surplus IS what traders buy and move to consumer systems).

---

## Government Types

Government type is a **region-level** property that applies political/cultural modifiers across all systems in the region. It operates independently from Region Identity (economic character) and Economy Type (system-level production/consumption).

### Why Government Types

Economy types alone create a deterministic economy — every Agricultural system in the game behaves identically. Government types break this by adding a second axis of variation. An Agricultural system in a Frontier region has wider price spreads and higher danger than the same Agricultural system in a Federation region. This multiplies variety without adding economy types.

Government types also solve the trade restriction problem cleanly. Instead of flagging goods as "restricted," regions define restriction policies based on their political character. Weapons are restricted in Federation space (civilian governance) but freely traded in Frontier space (no laws).

### The 4 Government Types

#### Federation
**Character:** Democratic, regulated, stable. Rule of law, consumer protections, standardized trade practices.

| Modifier | Value | Effect |
|----------|-------|--------|
| Trade restrictions | `["weapons"]` | Weapons cannot be freely traded — must use black market or licensed dealers |
| Volatility modifier | 0.8x | Regulated markets dampen price swings |
| Danger baseline | +0.0 | Safe, well-policed space |
| Equilibrium spread | -10% | Tighter margins — regulation keeps prices closer to equilibrium |
| Event weights | +trade_festival | More likely to host trade events |
| Consumption boosts | +medicine (all systems) | Public healthcare creates universal medicine demand |

Federation regions are the "safe" choice. Predictable markets, low danger, but thinner margins. Good for new players and steady traders. The weapons restriction creates a smuggling opportunity for risk-takers — Weapons bought in Frontier space sell at a premium on the Federation black market (future mechanic).

#### Corporate
**Character:** Profit-driven, competitive, efficient. Megacorp governance, minimal regulation, market-first policy.

| Modifier | Value | Effect |
|----------|-------|--------|
| Trade restrictions | `[]` | No restrictions — everything trades freely |
| Volatility modifier | 0.9x | Slightly dampened — corporate markets are efficient |
| Danger baseline | +0.02 | Low but nonzero — corporate security is selective |
| Equilibrium spread | -5% | Efficient markets, slightly tighter than baseline |
| Event weights | +trade_festival, -war | Commercial stability, occasional booms |
| Consumption boosts | +luxuries (all systems) | Corporate culture drives luxury demand everywhere |

Corporate regions offer the most liquid markets and the broadest trade freedom. No restrictions means any good can be traded anywhere. The luxuries consumption boost makes Corporate regions the best destination for Luxuries — even Extraction systems in Corporate space want luxury goods (executive housing, corporate retreats). Margins are tighter than Frontier but wider than Federation.

#### Authoritarian
**Character:** Military governance, controlled markets, strong security. Centralized authority, strategic resource management.

| Modifier | Value | Effect |
|----------|-------|--------|
| Trade restrictions | `["weapons", "chemicals"]` | Weapons AND Chemicals restricted — military controls both |
| Volatility modifier | 0.7x | Heavily dampened — price controls suppress swings |
| Danger baseline | +0.0 | Very safe — strong military presence |
| Equilibrium spread | -15% | Tightest margins — price controls and rationing |
| Event weights | +war, -plague | Military readiness, good sanitation infrastructure |
| Consumption boosts | +weapons, +fuel (all systems) | Military procurement creates universal demand |

Authoritarian regions are the most restricted but safest. Two goods are restricted (weapons AND chemicals as dual-use precursors). Price controls keep margins tight, but the consumption boosts create strong demand for weapons and fuel at every system — including economy types that wouldn't normally consume them. This makes Authoritarian regions excellent destinations for weapons (high demand) but dangerous to trade them there (restricted). The tension between restriction and demand is the gameplay hook: high reward for smuggling, but high risk if caught.

#### Frontier
**Character:** Lawless, dangerous, unregulated. No central authority, might-makes-right, opportunity and peril.

| Modifier | Value | Effect |
|----------|-------|--------|
| Trade restrictions | `[]` | No restrictions — anything goes |
| Volatility modifier | 1.5x | Wild price swings — no market regulation |
| Danger baseline | +0.10 | Dangerous space — pirates, unpatrolled routes |
| Equilibrium spread | +20% | Widest margins — inefficient, under-served markets |
| Event weights | +war, +plague, -trade_festival | Instability breeds conflict and disease |
| Consumption boosts | None | No centralized demand drivers |

Frontier regions are the high-risk, high-reward choice. No restrictions, widest margins, most volatile prices — but the most dangerous transit. Every good's volatility is amplified by 1.5x (so Weapons at 2.0 × 1.5 = effective 3.0 volatility in Frontier space). Equilibrium spreads are 20% wider, meaning better base margins even before volatility kicks in. But the +0.10 danger baseline means cargo loss is a real threat on every hop.

Frontier is where event chasers thrive — higher event probability for wars and plagues means Medicine and Weapons opportunities are frequent, and the amplified volatility makes the payoffs enormous.

### Government Type Summary

| | Federation | Corporate | Authoritarian | Frontier |
|---|---|---|---|---|
| **Restrictions** | weapons | none | weapons, chemicals | none |
| **Volatility** | 0.8x | 0.9x | 0.7x | 1.5x |
| **Danger** | +0.0 | +0.02 | +0.0 | +0.10 |
| **Spreads** | -10% | -5% | -15% | +20% |
| **Extra demand** | medicine | luxuries | weapons, fuel | — |
| **Event bias** | festivals | festivals | war | war, plague |

### How Government Composes With Economy Type

The same economy type behaves differently across government types. Examples:

**Industrial system in Frontier region:**
- Produces Machinery (rate 2), Weapons (rate 1)
- No trade restrictions — Weapons trade freely
- Weapons effective volatility: 2.0 × 1.5 = 3.0 (extreme swings)
- Equilibrium spreads +20% wider — better margins on everything
- But +0.10 danger baseline — real risk of cargo loss en route
- More war events → more Weapons demand spikes → enormous profit potential

**Industrial system in Authoritarian region:**
- Same production (Machinery, Weapons)
- Weapons AND Chemicals restricted — can't sell them on the open market
- Weapons effective volatility: 2.0 × 0.7 = 1.4 (dampened)
- Equilibrium spreads -15% — thin margins
- But universal weapons + fuel consumption boost → strong demand at every system
- Tension: high demand for weapons, but selling them is restricted

**Agricultural system in Corporate region:**
- Produces Food (rate 5), Textiles (rate 4)
- No restrictions — everything trades
- Added luxuries consumption boost → this farm world also wants luxuries (corporate agribusiness executives)
- Slightly tighter margins than baseline, but very liquid markets

### Region Identity + Government Type

Regions have **two independent properties**:

1. **Region Identity** (existing): economic character that influences the distribution of economy types within the region. A "resource_rich" region has more Extraction/Mining systems; a "tech" region has more High-Tech systems.

2. **Government Type** (new): political character that applies modifiers across all systems in the region. A "Frontier" government means no restrictions, high danger, and wide spreads regardless of which economy types are present.

The combination of 5 region identities × 4 government types = 20 possible region configurations. Each produces coherent, distinct gameplay:

| Example Region | Identity | Government | Character |
|---|---|---|---|
| Mining boomtown | resource_rich | Frontier | Dangerous but lucrative ore/water exports, no rules |
| Tech megacorp hub | tech | Corporate | Efficient electronics/medicine trade, luxury consumption |
| Breadbasket federation | agricultural | Federation | Safe food/textile supply, regulated but reliable |
| Military-industrial zone | industrial | Authoritarian | Restricted weapons trade, strong controlled demand |
| Free-trade crossroads | trade_hub | Corporate | Diverse economy types, open markets, thin margins |
| Frontier trading post | trade_hub | Frontier | High-risk hub, volatile prices, anything goes |

Not all 20 combinations need to appear in every generated universe — the generator selects from this space based on seed and configuration. The system is designed so any combination works without special-casing.

---

## Still To Decide

- **Economy balance proposals** — The proposals in [economy-balance.md](./economy-balance.md) (price clamps, equilibrium differentiation, production rates) need updating to reference the new 12-good set, 6 economy types, and new properties (volume, mass, volatility). The core ideas (widen price clamps for cheap goods, differentiated equilibrium, per-good rates) still apply but the specific numbers will change.
- **Event integration** — How events interact with good properties and government types. War events should spike Weapons demand (especially in Authoritarian regions). Plague events should spike Medicine demand (especially in Frontier regions with poor healthcare). The event system already supports supply/demand modifiers — the new goods and government modifiers just need event definitions that reference them.
- **Restriction enforcement** — The exact mechanic for how trade restrictions work in-game. Options: flat ban (can't trade at all), black market (can trade but at a penalty/risk), licensed dealers (can trade if you have a permit). This is a future implementation detail.
- **Government type assignment** — How government types are distributed during universe generation. Could be random, weighted by region identity, or configured per-seed. Need to decide distribution strategy.
- **Consumption boost implementation** — How government-driven consumption (e.g. Authoritarian +weapons at all systems) interacts with the economy processor. Likely implemented as additional equilibrium target modifiers applied at the region level.

## Research Context

This design was informed by analysis of comparable games:

| Game | Goods | Supply Chains | What Makes It Work |
|------|-------|--------------|-------------------|
| Space Trader | 10 | None | Events + tech-level gradient |
| Elite Dangerous | ~253 | Implicit (economy types) | Daily tick, % storage, hybrid NPC/player |
| Pardus | ~31 | 4-5 tiers | Tiered production + building upkeep |
| SpaceTraders | ~50-60 | Shallow | Export/import + market discovery |
| Sim Companies | ~145 | Deep (5-6) | Retail demand + quality + research |
| Prosperous Universe | ~550 | Very deep | Player-only production, no NPC simulation |

Key insight: without production chains, ~10-15 goods is the practical ceiling. Games with 30+ goods all rely on chains where higher-tier goods consume lower-tier inputs. Production chains are on our roadmap but not near-term — the 12 goods are designed to work well as flat trading goods now and slot into a production system later.

Elite Dangerous validated that implicit production chains (via economy-type supply/demand matrices) create natural trade routes without explicit crafting. Their main criticism — that commodities "do nothing" and feel like pure arbitrage tokens — reinforces the case for adding explicit production eventually.

## Technical Notes

### Goods changes
- `lib/constants/goods.ts` — Replace 6 goods with 12. `GoodDefinition` gains `description`, `tier`, `volume`, `mass`, `volatility`, `hazard` fields.
- `lib/types/game.ts` — `GoodCategory` type replaced by numeric `tier` (0 | 1 | 2). `GoodInfo` interface updated. New `GovernmentType` type.
- `prisma/schema.prisma` — `Good` model gains: `tier Int`, `volume Int`, `mass Float`, `volatility Float`, `hazard String`.
- `prisma/seed.ts` — Seed all 12 goods, generate market entries for new goods at all stations.
- `lib/engine/pricing.ts` — Accept per-good or per-tier price clamp ranges.
- `lib/engine/simulator/world.ts` — Sim world creation picks up new goods and economy types.

### Economy type changes
- `lib/types/game.ts` — `EconomyType` union gains `"extraction"` and `"refinery"`, removes `"mining"` (renamed to extraction).
- `lib/constants/universe.ts` — `ECONOMY_PRODUCTION` and `ECONOMY_CONSUMPTION` rewritten for 6 types × 12 goods with per-good rates.
- `lib/constants/economy.ts` — `EQUILIBRIUM_TARGETS` becomes per-(economy type, good) pair instead of flat produces/consumes/neutral.
- `lib/constants/universe-gen.ts` — `ECONOMY_TYPE_WEIGHTS` updated for 6 types. Region identity weights rebalanced.
- `lib/tick/processors/economy.ts` — Per-good production/consumption rates, volatility-scaled noise.

### Government type changes (new)
- `lib/types/game.ts` — New `GovernmentType` type: `"federation" | "corporate" | "authoritarian" | "frontier"`.
- `lib/constants/government.ts` (new) — Government type definitions: restrictions, volatility modifier, danger baseline, spread modifier, event weights, consumption boosts.
- `prisma/schema.prisma` — `Region` model gains `governmentType String`.
- `lib/engine/universe-gen.ts` — `GeneratedRegion` gains `governmentType`. Assignment strategy during generation.
- `lib/tick/processors/economy.ts` — Apply region-level volatility modifiers and consumption boosts.
- `lib/engine/danger.ts` — Government danger baselines composed with existing event-based danger.

### Performance
- 12 goods × ~200 systems = 2,400 market rows total.
- Round-robin regions (~8-10): ~240-300 updates per tick. Well within SQLite capacity.
- Government modifiers are read-only lookups during tick processing — zero additional DB writes.
- The simulator can validate any proposed configuration before touching the real game.
