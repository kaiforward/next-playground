# Player Facilities Design

Player-owned facilities — base building at a galactic scale. A unified build system handles construction, upgrades, operating costs, and asset risk for all facility types. What varies is what each facility *does*, not how it's built or managed.

Two categories of facility share this build system:
- **Production facilities** produce goods that enter the economy. Their mechanics — recipes, inputs, outputs, supply chain integration — are complex enough to warrant a dedicated design doc. See [Production](./production.md).
- **Infrastructure facilities** provide passive benefits to the owning player — better trade spreads, reduced costs, risk mitigation. Their mechanics are defined in this document (§5).

**Design principle**: Facilities are personal investments, not world-state modifications. Multiple players can own facilities in the same system. Player facilities don't affect system-level production data or faction facility behavior — they're private income streams and personal advantages layered on top of the world simulation.

**Depends on**: [Player Progression](./player-progression.md) (mid/late game gating), [System Enrichment](./system-enrichment.md) (system traits, economy types), [Faction System](./faction-system.md) (standing tax, war seizure)

---

## 1. Key Design Rules

- **Economy and trait gated**: Facilities require specific economy types and/or system traits to build. A mining operation needs extraction traits; a trade post needs a trade hub. The system's physical properties determine what's viable.
- **Multiple players per system**: Player facilities are personal. Ten players can each own a mining operation in the same extraction system. They don't compete for slots or affect each other's output.
- **Unified build system**: Construction, upgrades, operating costs, limits, and asset risk work identically for production and infrastructure facilities. The build system doesn't care what the facility does.
- **Linear upgrade path**: Facilities upgrade in-place from minor (mid game) to major (late game). No demolish-and-rebuild — investment compounds over time.
- **Assets at risk**: Facilities are subject to ongoing taxation based on faction reputation, and seizure during wars if the player was directly involved. See §4.

---

## 2. Build System

### 2.1 Construction

Facilities are built over time, not purchased instantly. The process:

1. **Player initiates build** at a system where they're docked, selecting a facility type they meet the requirements for
2. **Full cost paid upfront** — credits are deducted immediately. If the player can't afford it, they can't start
3. **Construction period begins** — the facility exists in a "building" state for N ticks. During this time it provides no benefits and incurs no operating costs
4. **Construction completes** — the facility becomes operational, begins providing benefits, and begins incurring operating costs

Construction time scales with facility tier and category:

| Tier | Approximate construction time | Notes |
|---|---|---|
| Minor | Short (tens of ticks) | Entry-level investment. Quick enough to feel responsive |
| Major (upgrade) | Longer (hundreds of ticks) | Significant commitment. Player should feel the weight of the decision |

Specific tick counts are tuning numbers for implementation. The system should support per-facility-type overrides so construction time can vary by type (an arms foundry takes longer than a fuel depot).

**Cancellation**: A player can cancel construction in progress. Partial refund (e.g. 50–75% of build cost) — the rest is lost. Prevents risk-free speculative building.

### 2.2 Upgrades

Facilities upgrade linearly in-place: minor → major. Upgrades use the same timed construction model:

1. **Player initiates upgrade** at a system where they own the facility and are docked
2. **Upgrade cost paid upfront** — separate from original build cost. Major upgrades are significantly more expensive than the initial minor build
3. **Upgrade period begins** — the facility continues operating at **reduced capacity** (approximately 50% of normal output/benefits) during the upgrade. The player trades short-term performance for long-term improvement
4. **Upgrade completes** — facility operates at its new tier

Upgrade gating:
- **Credits**: Major upgrades are expensive — a meaningful late-game credit sink
- **Faction reputation**: Some upgrades may require a minimum reputation tier with the controlling faction (e.g. Trusted or Champion)
- **Trait quality**: Major-tier facilities may require higher quality traits in the system (e.g. quality 2+ for the relevant trait). A marginal asteroid belt supports a minor mining operation but can't sustain a major one

**Not all facilities upgrade**: Some facility types are minor-only by design (Fuel Depot, Smuggler's Den). These are simple investments that don't scale — their value is utility, not growth.

### 2.3 Demolition

A player can voluntarily demolish a facility they own. Demolition is instant — the facility is removed and the player receives a partial refund of the original build cost (e.g. 25–50%). The refund is deliberately low — facilities are long-term investments, not liquid assets.

Demolition frees up the player's facility slots (per-system and global limits) for new construction elsewhere. This supports repositioning when trade routes shift, wars redraw borders, or the player's strategy changes.

A facility under construction can be cancelled (§2.1) for a better refund than demolishing a completed facility — the player hasn't yet benefited from the investment.

### 2.4 Operating Costs

Every operational facility has a per-tick upkeep cost in credits. Operating costs scale with the facility's tier and capacity — a major refinery costs more to run than a minor fuel depot.

**Cost model**:
- Base upkeep is defined per facility type and tier
- Upkeep is charged per tick while the facility is operational
- Upkeep is NOT charged during construction or when paused

**Insufficient funds**: If a player cannot afford their total facility upkeep on a given tick, facilities **pause** rather than accumulate debt. A paused facility:
- Produces nothing (production facilities)
- Provides no benefits (infrastructure facilities)
- Incurs no operating costs
- Resumes automatically when the player has sufficient credits

This prevents death spirals — a player who logs off for a week doesn't come back bankrupt. The worst case is idle facilities, not negative balance.

**Disruption pressure**: Events and wars can reduce facility effectiveness — lower production output, weaker infrastructure benefits — while upkeep continues at the normal rate. This squeezes margins during bad times and creates real incentive to care about the political stability of systems where you've invested. However, since facilities pause on insufficient funds, disruption can make a facility temporarily unprofitable but never actively destructive to the player's finances.

---

## 3. Facility Limits

Limits are configurable at three levels to allow tuning without architectural changes:

### 3.1 Per-Type Limits

Some facility types are naturally limited to one per player per system. It doesn't make sense to own three repair bays in the same system. Per-type limits are defined in the facility roster — each type specifies its per-system cap.

### 3.2 Per-System Limits

A cap on total facilities (across all types) that one player can own in a single system. Keeps players investing across the galaxy rather than stacking everything in one place.

### 3.3 Global Limit

A cap on total facilities one player can own across all systems. Acts as a server-resource backstop and a soft progression gate — early-game players can't over-expand even if they find the credits.

### Limit Philosophy

Specific numbers are deferred until the full roster (including production facilities) is defined. The architecture should support easy tuning of all three limit levels. The expectation is:

- Per-type limits are mostly 1 (one of each type per system)
- Per-system limits are small (1–3, enough for a production + infrastructure combo)
- Global limits scale with progression (more slots available as the player advances)

Operating costs provide a soft economic cap on top of the hard limits — even if a player could own 20 facilities, the upkeep makes the last few unprofitable unless the player's trade income scales to match.

---

## 4. Asset Risk

Player facilities are investments in someone else's territory. The controlling faction's attitude toward the player — and the player's wartime actions — determine the cost of doing business.

### 4.1 Standing Tax (Always Active)

All player facilities are subject to a standing tax based on the player's reputation with the faction that controls the system. This applies at all times, not just during wars. It modifies the facility's effective operating costs or output.

| Reputation | Tax Effect | Rationale |
|---|---|---|
| Champion | Tax relief — reduced operating costs | The faction rewards its champions. Your facilities run cheaper here |
| Trusted | Minor tax relief | Good standing has modest benefits |
| Neutral | No modifier | Standard terms. The baseline for everyone |
| Distrusted | Tax penalty — increased operating costs | The faction doesn't trust you. Extra regulatory burden, inspections, fees |
| Hostile | Heavy tax penalty — significantly increased operating costs | Near-punitive taxation. The faction wants you gone but won't seize without cause |

**Key design rule**: Even hostile reputation does not cause facility seizure on its own. A player can maintain facilities in hostile territory — it's just expensive. This protects neutral/trade-focused players who end up on the wrong side of faction politics without actively participating.

Standing tax creates a constant incentive to maintain good relations with factions where you have facilities. A player diversified across multiple faction territories needs to balance their reputation carefully — going all-in on one faction improves margins there but worsens them everywhere else.

### 4.2 War Consequences (Conquest + Direct Involvement)

When territory changes hands in a war, additional consequences apply to player facilities — but **only if the player actively contributed to the war effort on the losing side**. Direct involvement means:
- Completing war contribution missions for the defeated faction during this specific war
- Supplying war materials (weapons, strategic goods) to the defeated faction's war effort
- Other direct military support as defined by the war system

**If the player was directly involved**:

| Consequence | When |
|---|---|
| Facility seizure | Conquering faction takes ownership. The player loses the facility entirely |
| Facility damage | Prolonged fighting may degrade facility tier before seizure (major → minor → destroyed) |

**If the player was NOT directly involved** (even if hostile to the conqueror):

No additional consequences beyond the standing tax from §4.1. The player keeps their facilities. They'll face heavy taxation under a hostile faction, but their assets are intact.

**Why this distinction matters**: It creates a genuine strategic choice when war breaks out. A player with facilities in threatened territory can:
- **Stay neutral**: Accept the tax hit if the wrong side wins, but keep all assets. The safe path.
- **Support the defender**: Risk total loss in conquered systems, but earn reputation rewards and potentially better terms if the defender holds. The committed path.
- **Hedge**: Invest in reputation with the potential conqueror as insurance, even while operating in the defender's territory. The diplomatic path.

Passive hostility (being disliked by a faction without actively opposing them in a specific war) should never cost a player their facilities. This protects trade-focused players whose reputation drifted negative through faction politics rather than deliberate action.

---

## 5. Infrastructure Facilities

Infrastructure facilities provide passive benefits to the owning player. They don't produce tradeable goods — they modify existing game mechanics in the player's favor at the system where they're built.

### 5.1 Roster

#### Trade Post

| Property | Value |
|---|---|
| Placement | Core economy, or system with ancient trade route trait |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Benefit | Better buy/sell spreads for the owning player at this system |

The player's personal trading advantage. Minor tier provides a small spread improvement; major tier provides a larger one. Stacks with faction reputation price modifiers as a separate layer — reputation affects the transaction multiplier, the trade post affects the spread.

Best placed at high-volume trade systems where the player trades frequently. A trade post at a system you visit once is wasted; a trade post at the hub of your trade network pays for itself quickly.

#### Fuel Depot

| Property | Value |
|---|---|
| Placement | System with gas giant or helium-3 reserves trait |
| Tier | Minor only |
| Per-system limit | 1 |
| Benefit | Reduced refuelling costs for the owner's ships at this system |

A simple utility investment. Placed along frequently traveled routes to reduce the ongoing cost of fuel. Minor-only because fuel discount doesn't benefit from scaling — you either have cheap fuel here or you don't.

Best placed at junction systems that the player's ships pass through regularly, especially if running automated trade routes (see [Player Progression §5](./player-progression.md)).

#### Repair Bay

| Property | Value |
|---|---|
| Placement | System with lagrange stations or orbital ring remnant trait |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Benefit | Ship repair at this system — cheaper than faction shipyards, available without shipyard access |

Personal ship maintenance. Minor tier handles basic repairs; major tier handles full hull restoration and may reduce repair time. Ties into the ship roster's hull and damage system — ships that take damage from the danger pipeline or war events need somewhere to repair.

Gives the player an alternative to faction shipyards for maintenance. Particularly valuable in frontier or contested space where faction shipyard access may be limited or reputation-gated.

#### Warehouse

| Property | Value |
|---|---|
| Placement | Any economy type |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Benefit | Goods storage buffer at this system |

Storage infrastructure for the player's goods. Exact mechanics depend on the production system — warehouses will likely serve as the buffer between production facility output and the player selling or shipping goods. Without production facilities, a warehouse could still serve as a cargo staging point for trade operations.

No economy or trait restriction — storage is universally useful infrastructure. Minor tier provides limited storage; major tier provides significantly more.

Full warehouse mechanics (capacity, interaction with production output, spoilage if any) are defined in [Production](./production.md).

#### Customs Brokerage

| Property | Value |
|---|---|
| Placement | Core economy, or system with habitable world trait |
| Tier | Minor only |
| Per-system limit | 1 |
| Benefit | Reduced import duty on the owner's cargo arriving at this system |

Directly modifies the danger pipeline's import duty stage. The player's established relationships with local customs officials reduce the tax bite on incoming cargo. Minor-only because the benefit is a flat modifier — either you have connections or you don't.

Most valuable in high-tax government systems (authoritarian, federation) where import duty is a significant cost. Pointless in frontier space where no duty is collected.

#### Security Office

| Property | Value |
|---|---|
| Placement | System with habitable world or lagrange stations trait |
| Tier | Minor → Major |
| Per-system limit | 1 |
| Benefit | Reduced danger for the owner's ships arriving at this system |

Personal security infrastructure that modifies the danger pipeline's hazard incident and event-based cargo loss stages. The player's private security detail monitors threats and protects incoming shipments.

Minor tier provides a small danger reduction; major tier provides a larger one. Most valuable at high-danger systems (frontier government, active events, war zones) where cargo loss is a real cost.

#### Smuggler's Den

| Property | Value |
|---|---|
| Placement | System with dark nebula or nebula proximity trait. Cannot be built in frontier government systems |
| Tier | Minor only |
| Per-system limit | 1 |
| Benefit | Reduced contraband inspection chance for the owner at this system |

The criminal infrastructure option. Only useful where contraband is actually enforced — federation, authoritarian, and other restrictive governments. Building this in frontier space would be pointless since nothing is restricted there.

Minor-only because it's a covert operation, not a scalable business. High asset risk — when war seizure conditions from §4.2 are met, the Smuggler's Den is the first facility targeted. It's the most politically damaging facility to be caught owning.

**Placement restriction**: Explicitly blocked in frontier government systems. The trait requirement (dark nebula, nebula proximity) provides concealment; the government restriction ensures there's actually something to smuggle past.

### 5.2 Future Infrastructure Types

The infrastructure roster is deliberately incomplete. Additional types will be designed as their dependent systems solidify:

- **War-related infrastructure** (training facilities, barracks): Depends on war contribution mechanics being finalized. Could generate passive war contribution or boost war mission rewards.
- **Social/population infrastructure** (housing, entertainment): Depends on in-system gameplay design. Could generate passive income from system population/traffic.
- **Logistics infrastructure** (courier office, trade relay): Depends on ship automation and trade route design. Could boost automated ship efficiency.

These are natural extension points. The build system is designed to accommodate new facility types without architectural changes — each new type just needs its placement rules, tier range, per-system limit, and benefit definition.

---

## 6. Production Facilities

Production facilities use the same build system described in §2–4 but their core mechanics — what they produce, input requirements, how output enters the economy, supply chain integration, and war material flow — are defined in a separate design doc.

See [Production](./production.md) for:
- Full production facility roster and economy type mapping
- Production recipes (inputs → outputs)
- Output mechanics (where produced goods go, how they become credits)
- Supply chain integration with the economy processor
- War material production and faction war effort contribution
- Interaction with system traits (quality multipliers on production rates)
- Warehouse interaction (storage buffer between production and sale)

Production facilities follow all the same rules as infrastructure: timed construction, linear upgrades with reduced output during upgrade, scaling operating costs with pause on insufficient funds, standing tax, and war seizure rules. The production doc only needs to define what makes production facilities unique — everything else is inherited from this document.

---

## 7. Tick Processing

Player facilities require a tick processor to handle:

- **Operating cost deduction**: Charge upkeep per tick for all operational facilities. Pause facilities when the player's credits are insufficient.
- **Construction progress**: Advance construction timers. Complete facilities when their timer expires.
- **Upgrade progress**: Advance upgrade timers. Complete upgrades when their timer expires.
- **Standing tax application**: Calculate tax modifiers based on player-faction reputation and apply to operating costs.

This processor runs per-player and depends on the faction system (for reputation lookups) and economy processor (for market state if production facilities interact with it). Dependency ordering within the tick pipeline to be determined during implementation.

Infrastructure facility benefits (spread bonuses, danger reduction, duty reduction) are applied at **action time**, not during tick processing — they modify the relevant calculation (trade execution, danger pipeline, refuelling) when the player performs that action at the system. No per-tick work needed for infrastructure effects.

---

## 8. Open Questions

- **Specific construction times**: Exact tick counts per facility type and tier. Tuning numbers for implementation.
- **Specific operating costs**: Credit amounts per facility type and tier. Need to balance against expected player income at each progression phase.
- **Specific tax rates**: Percentage modifiers for each reputation tier. Need to feel meaningful without being punitive.
- **Specific trade post spread bonuses**: How much better are the player's buy/sell spreads? Must not overshadow faction reputation bonuses.
- **Specific danger reduction values**: How much does a Security Office reduce danger? Must not trivialize the danger pipeline.
- **Global facility limit scaling**: How many total facilities can a player own at each progression stage? Depends on the full roster including production facilities.
- **Per-system limit**: How many total facilities per system? Depends on production roster.
- **Repair Bay mechanics**: Full repair system depends on ship roster's hull/damage model. Repair Bay benefits defined once that system exists.
- **Build queue**: Can a player have multiple facilities under construction simultaneously, or one at a time? Server resource consideration.
- **Facility discovery**: How does a player know what they can build at a system? UI consideration — probably a "build" panel showing eligible types based on system traits/economy.

---

## Related Design Docs

- **[Production](./production.md)** — production facility mechanics, recipes, output, supply chain integration
- **[Player Progression](./player-progression.md)** — progression gating (minor = mid game, major = late game), credit sinks
- **[System Enrichment](./system-enrichment.md)** — system traits (placement requirements), faction facilities (separate from player facilities)
- **[Faction System](./faction-system.md)** — reputation (standing tax), war mechanics (seizure conditions)
- **[War System](./war-system.md)** — territory conquest, direct involvement tracking
- **[Navigation](../active/navigation.md)** — danger pipeline (modified by Security Office, Customs Brokerage, Smuggler's Den)
- **[Economy](../active/economy.md)** — market mechanics (modified by Trade Post spreads)
