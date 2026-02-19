# Ship Roster Design

Ship classes, roles, stats, and how ships evolve across the progression arc. Ships are the player's primary asset — their capabilities define what a player can do in the game at any given moment.

**Design principle**: Size is the foundation. A ship's size category determines its baseline stat profile — small ships are fast, evasive, and stealthy but carry little; large ships haul massive cargo and absorb damage but can't hide or dodge. Individual ship classes specialise within their size category by role.

**Depends on**: [Player Progression](./player-progression.md) (game arc phases), [Faction System](./faction-system.md) (reputation-gated access), [System Enrichment](./system-enrichment.md) (shipyard/drydock tiers), [Ship Upgrades](./ship-upgrades.md) (modular customisation)

---

## 1. Ship Stats

### 1.1 Core Stats

Every ship has these stats. Values are set by the ship class and modified by upgrades.

| Stat | Description | Favours |
|---|---|---|
| **Size** | Physical scale of the ship. Foundation stat — influences baseline evasion, stealth, cargo, and hull. Not directly modifiable by upgrades | Small ships: evasion/stealth. Large ships: cargo/hull |
| **Cargo capacity** | Volume of goods the ship can carry | Trade, missions, war supply runs |
| **Fuel range** | Maximum fuel capacity — determines how many hops before refuelling | Exploration, long-range trade, operating in regions without fuel depots |
| **Speed** | Ticks per hop. Lower is faster | Travel time, time-sensitive missions, escape from danger |
| **Hull** | Structural integrity — damage resistance and total hit points | Surviving danger pipeline, combat durability, operating in hazardous systems |
| **Firepower** | Offensive combat capability — weapons, targeting systems | Combat encounters, escort protection, war contributions |
| **Evasion** | Ability to avoid hits and escape threats. Baseline set by size — small ships start high, large ships start low | Danger pipeline survival, smuggling escape, combat defence |
| **Stealth** | How difficult the ship is to detect. Baseline set by size — small ships are naturally harder to spot, large ships are visible from across a system | Smuggling, contraband running, espionage missions, avoiding pirate attention |
| **Sensors** | Detection and scanning range — ability to gather information | Exploration, intelligence missions, detecting hidden threats, smuggling detection (for enforcement) |
| **Crew capacity** | How many crew the ship can support. Some upgrades and activities require minimum crew | Future crew mechanics, some upgrade prerequisites |
| **Upgrade slots** | Number of modular upgrade slots available. Scales with size — small ships have fewer, capital ships have more | Customisation depth, build variety |

### 1.2 Size Categories

Size is the foundational stat. It sets the baseline profile that individual ship classes then specialise within.

| Size | Evasion baseline | Stealth baseline | Cargo baseline | Hull baseline | Upgrade slots | Progression phase |
|---|---|---|---|---|---|---|
| **Small** | High | High | Low | Low | 2 | Early game |
| **Medium** | Moderate | Moderate | Moderate | Moderate | 3–4 | Mid game |
| **Large** | Low | Low | High | High | 4–5 | Late game |

A huge capital ship has terrible stealth simply because it's enormous — no amount of technology can hide something that big. A tiny shuttle is naturally hard to detect and can dodge threats, but one solid hit could destroy it. This creates intuitive trade-offs that players understand immediately.

### 1.3 Derived Combat Power

For large-scale faction battles (see [War System §5.2](./war-system.md)), individual ship stats are aggregated into a single **combat power** rating. This keeps battles manageable when hundreds or thousands of ships are involved.

Combat power is derived from the ship's combat-relevant stats: firepower, hull, evasion, and any upgrade bonuses. The exact formula is an implementation detail, but the principle is: a frigate contributes significantly more combat power than a shuttle, but five shuttles collectively contribute meaningful power too.

Individual stats still matter for personal gameplay — missions, pirate encounters, danger pipeline, escort duty. Combat power is only used for the faction battle aggregation system.

---

## 2. Ship Roles

Ships are designed around distinct roles. Each role prioritises different stats and serves a different gameplay purpose. A well-composed fleet has ships filling multiple roles.

| Role | Primary stats | Gameplay purpose |
|---|---|---|
| **Trade** | Cargo, fuel range, speed | Hauling goods between systems. The money-making backbone. Optimise for volume and efficiency |
| **Combat** | Firepower, hull, evasion | Escort duty, war contributions, combat missions, pirate defence. Protecting trade ships and projecting force |
| **Scout** | Speed, sensors, fuel range | Exploration, intelligence gathering, surveying new systems. Finding opportunities before others |
| **Stealth** | Stealth, evasion, moderate cargo | Smuggling, contraband running, blockade penetration, espionage. High-risk, high-reward operations |
| **Support** | Hull, crew capacity, sensors | Fleet coordination, crew transport, repair operations. Force multiplier for other ships |

Not every ship class maps perfectly to one role — some are versatile generalists (especially early game ships), while late-game ships tend toward sharp specialisation.

---

## 3. Ship Roster

### 3.1 Small Ships — Early Game

Available at tier-1 shipyards. Affordable, limited, but capable in their niche. These are the ships players learn the game with.

| Class | Role | Size | Key strengths | Key weaknesses | Identity |
|---|---|---|---|---|---|
| **Shuttle** | Generalist | Small | Balanced stats, cheap to buy and operate. Good fuel range for its size | Low cargo, low combat capability. Master of nothing | The starter ship. Every player begins here. Reliable but outgrown quickly |
| **Light Freighter** | Trade | Small | Better cargo than shuttle, decent speed | Low evasion, low combat stats. Vulnerable without escort | First trade upgrade. The "I want to haul more" choice |
| **Interceptor** | Combat | Small | High speed, good firepower and evasion for its size | Very low cargo. Can't trade effectively | Fast attack ship. Escort duty, early combat missions, pirate hunting |
| **Scout Skiff** | Scout | Small | Excellent speed and sensors, good fuel range | Minimal cargo, fragile hull. Runs rather than fights | Exploration ship. Fast, far-ranging, sees everything. Gets out before trouble arrives |

### 3.2 Medium Ships — Mid Game

Available at tier-2 shipyards. Significant investment. Role specialisation becomes pronounced — medium ships are good at their job and mediocre at everything else.

| Class | Role | Size | Key strengths | Key weaknesses | Identity |
|---|---|---|---|---|---|
| **Bulk Freighter** | Trade | Medium | Large cargo capacity, efficient fuel use | Slow, low evasion, very low stealth. Needs escorts in dangerous space | The workhorse. Serious trading volume. A fleet of these is a trade empire's backbone |
| **Corvette** | Combat | Medium | Strong firepower, solid hull, decent speed | Low cargo. Expensive to operate | Medium warship. Escort convoys, combat missions, meaningful war contributions |
| **Blockade Runner** | Stealth | Medium | High stealth, high evasion, moderate cargo | Lower hull, moderate firepower. Can't slug it out in a straight fight | The smuggler's ship. Fast, sneaky, carries enough to be profitable. Contraband specialist |
| **Survey Vessel** | Scout | Medium | Excellent sensors, great fuel range, good crew capacity | Slow for its size, low combat stats | Deep exploration and intelligence. Maps systems, gathers data, supports fleet operations at range |

### 3.3 Large Ships — Late Game

Available at tier-3 shipyards. Very expensive. Faction reputation required for purchase — these are the ships that mark a player as a serious power in the galaxy.

| Class | Role | Size | Key strengths | Key weaknesses | Identity |
|---|---|---|---|---|---|
| **Heavy Freighter** | Trade | Large | Massive cargo capacity. Dwarfs anything else in raw hauling power | Very slow, terrible evasion and stealth. A sitting target without escort. Expensive to fuel and maintain | The trade titan. One run in this ship equals five in a bulk freighter. But losing one hurts |
| **Frigate** | Combat | Large | Powerful weapons, thick hull, strong combat power rating | Minimal cargo, expensive to maintain, slow. Pure warship | The faction's fist. War effort contributions, system defence, fleet flagship for combat operations |
| **Stealth Transport** | Stealth | Large | Unusually high stealth and evasion for its size, large cargo bay | Lower hull than other large ships, moderate firepower. Stealth tech is expensive to maintain | The ultimate smuggler. Moves serious cargo through dangerous space unseen. Rare, expensive, faction-gated |
| **Command Vessel** | Support | Large | High crew capacity, excellent sensors, fleet coordination bonuses. Boosts nearby ships' effectiveness | Low firepower for its size, depends on escort | Fleet brain. Provides combat power bonuses to allied ships in the same system. Late-game force multiplier for coordinated fleets |

### 3.4 Faction-Exclusive Ships

Each major faction offers exclusive ship variants at their tier-3 shipyards, gated by Champion reputation (+75). These are not entirely new classes — they're enhanced versions of base classes with faction-specific stat profiles and unique upgrade slot configurations.

**Design rule**: Faction ships are *different*, not strictly *better*. A Kessari Dominion combat ship hits harder but has less evasion than the base corvette. A Meridian Compact trade ship has the best cargo efficiency but poor combat stats. Players choose faction ships for playstyle fit, not just raw power.

| Faction | Likely specialisation | Rationale |
|---|---|---|
| Terran Sovereignty | Defensive combat variants — high hull, high evasion, strong escort capability | Protectionist doctrine, federation government. They build ships to protect, not attack |
| Kessari Dominion | Offensive combat variants — maximum firepower, aggressive stat profiles | Expansionist doctrine, authoritarian government. Their ships are built to conquer |
| Meridian Compact | Trade optimised variants — best cargo efficiency, trade bonuses, economic warfare tools | Mercantile doctrine, corporate government. Their ships are built to profit |
| Ashvari Hegemony | Imposing capital ships — oversized for their class, intimidation factor, hull-heavy | Hegemonic doctrine, authoritarian government. Their ships are built to dominate through presence |
| Free Reaches | Stealth and speed variants — high evasion, good stealth, hit-and-run profiles | Opportunistic doctrine, frontier government. Their ships are built to strike and vanish |
| Solari Collective | Balanced variants — well-rounded, good sensors, crew-focused, support bonuses | Expansionist doctrine, federation government. Their ships are built for sustained campaigns and fleet cooperation |

Detailed faction ship stats are defined during implementation when base class values are finalised.

---

## 4. Fleet Composition

Players build fleets across multiple roles. A well-composed fleet outperforms an equal-cost fleet of identical ships.

### 4.1 Fleet Size by Phase

| Phase | Typical fleet size | Composition |
|---|---|---|
| Early game | 1–2 ships | Starter shuttle, maybe a light freighter or interceptor |
| Mid game | 3–6 ships | Mix of trade ships, a combat escort, possibly a scout or blockade runner |
| Late game | 6–12+ ships | Multiple trade ships (some automated), combat escorts, specialised ships for specific tasks |

### 4.2 Escort Mechanics

Combat ships protect trade ships travelling in the same convoy. Convoys are explicit player-formed groups — ships docked at the same system are grouped and sent on the same route together, travelling at the speed of the slowest ship. See [navigation-changes.md](./navigation-changes.md) for full convoy mechanics.

- A trade ship travelling with a combat escort has reduced danger pipeline risk — the escort absorbs or deters threats
- Escort effectiveness scales with the combat ship's firepower and hull relative to the danger level
- Multiple escorts stack with diminishing returns — two corvettes are better than one, but not twice as good
- Large ships without escorts in dangerous space are high-risk — the danger pipeline hits them harder because they can't evade

This creates natural fleet composition decisions: do you send the heavy freighter alone on a safe route, or pair it with a corvette through contested space? The speed trade-off adds another dimension — a frigate escort is the safest option but slows the whole convoy to a crawl.

### 4.3 Ship Stats in the Danger Pipeline

The current arrival danger pipeline (see [navigation.md](../active/navigation.md)) operates purely on cargo with no concept of ship capability. With expanded ship stats, three of the four pipeline stages are modified by ship stats. Escort mechanics (§4.2) stack on top of these — a trade ship's own stats are its baseline survivability, escorts improve it further.

**Replaces**: The danger pipeline stages in navigation.md will be updated to incorporate ship stats when the ship roster is implemented.

| Pipeline Stage | Ship Stat | Effect |
|---|---|---|
| **Stage 1: Hazard Incidents** | **Hull** | Higher hull reduces loss *severity* — a sturdier ship contains hazardous cargo better (smaller percentage lost per incident). Does not reduce incident *chance*, which is driven by the cargo's hazard level and system danger |
| **Stage 2: Import Duty** | None | Government tax rate. Ship stats irrelevant |
| **Stage 3: Contraband Inspection** | **Stealth** | Higher stealth reduces *inspection chance*. A stealthy ship is harder to scan. Makes stealth-role ships (Blockade Runner, Stealth Transport) the natural smuggling choice |
| **Stage 4: Event-Based Cargo Loss** | **Evasion** | Higher evasion reduces *loss probability*. An agile ship dodges debris, pirate attacks, and event-driven hazards. Small ships are naturally better at this due to size-based evasion baselines |

**Design rationale**: Each stat maps to a different kind of threat — hull absorbs physical damage from unstable cargo, stealth avoids detection by authorities, evasion dodges environmental hazards. This means no single stat dominates the pipeline, and different ship roles have different pipeline profiles:

- **Trade ships** (low evasion, low stealth, moderate hull): Vulnerable across the board. Rely on safe routes and escorts.
- **Stealth ships** (high stealth, high evasion, lower hull): Sail through inspections and dodge event hazards, but hazardous cargo incidents hit harder.
- **Combat ships** (high hull, moderate evasion, low stealth): Shrug off hazard incidents but get inspected every time. Not built for smuggling.

### 4.4 Fleet Operating Costs

Every ship has ongoing costs that scale with size and capability:

| Cost | Scales with | Purpose |
|---|---|---|
| **Fuel** | Fuel range consumed per hop, fuel price at system | Core travel cost. Fuel depots reduce this |
| **Maintenance** | Ship size, hull damage taken | Wear and tear. Larger and combat-damaged ships cost more to maintain |
| **Crew wages** | Crew capacity (future) | Ongoing personnel cost. Capital ships are expensive to crew |
| **Upgrade upkeep** | Number and tier of installed upgrades | Advanced modules need maintenance. Automation modules have per-tick processing costs |

Operating costs ensure that fleet expansion is a genuine investment decision, not just "buy more ships". A fleet of 10 ships with high operating costs might earn less net profit than a lean fleet of 5 well-optimised ships. Players must balance fleet size against operating efficiency.

### Fleet Size Limits

There is **no hard cap** on fleet size. Fleet size is soft-capped by operating costs — each additional ship adds ongoing fuel, maintenance, crew, and upgrade costs that eat into profit margins. A lean, well-optimised fleet outperforms a bloated one. The natural progression (1-2 early, 3-6 mid, 6-12+ late) emerges from economics, not artificial slot limits.

---

## 5. Ship Lifecycle

### 5.1 Acquisition

- **Purchase**: Buy at shipyards. Tier-1 shipyards sell small ships, tier-2 sell medium, tier-3 sell large. Faction ships require Champion reputation
- **Availability**: Not every shipyard stocks every class. Larger shipyards have wider selection. Players may need to travel to find specific classes

### 5.2 Upgrades

Ships are customised through modular upgrades installed at drydocks. See [Ship Upgrades](./ship-upgrades.md) for the full upgrade system — slot types, module catalog, and drydock tier requirements.

### 5.3 Damage and Repair

- Ships take damage from the danger pipeline (hazard incidents, combat, events) and combat encounters
- Damaged ships have reduced stats until repaired — a hull at 50% means reduced cargo capacity, slower speed
- Repairs at shipyards — cost scales with damage and ship size
- Destroyed ships are lost permanently with all cargo and installed upgrades. This is the ultimate risk — capital ships represent enormous investment

### 5.4 Selling and Decommissioning

- Ships can be sold at shipyards for a fraction of purchase price
- Installed upgrades can be removed before selling (at a drydock) or sold with the ship
- Selling a ship frees up fleet capacity for new acquisitions

---

## Related Design Docs

- **[Player Progression](./player-progression.md)** — game arc phases, fleet size by phase, automation unlocks
- **[Faction System](./faction-system.md)** — reputation-gated ship access, combat power in faction battles, war contributions
- **[System Enrichment](./system-enrichment.md)** — shipyard and drydock tiers, facility availability
- **[Ship Upgrades](./ship-upgrades.md)** — modular upgrade system, slot types, module catalog
