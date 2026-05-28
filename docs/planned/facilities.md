# Faction Facilities

Status: **Planned** — depends on Faction System.

Built structures that provide services, bonuses, and gameplay to systems. Facilities are **faction-owned strategic infrastructure** — they belong to whoever controls the system, they're war targets, and they shape what players can do in a system.

**Player-owned facilities** (mining operations, trade posts, personal warehouses) are a separate system entirely. They are personal investments and progression milestones that don't affect system-level data. See [Player Facilities](./player-facilities.md) for that design.

**Depends on**: [Faction System](../active/gameplay/faction-system.md) (territory control, faction bonuses), [System Traits](../active/gameplay/system-traits.md) (placement prerequisites, tier derivation)

---

## 1. Core Properties

| Property | Type | Description |
|---|---|---|
| type | FacilityType | Identifier (e.g. "shipyard", "naval_base") |
| tier | 1–3 | Capability level. Derived from the quality of the system's prerequisite traits |
| traitPrerequisites | TraitType[] | Which system traits must be present for this facility to exist here |
| category | Category | Ship & Fleet, Trade & Economy, Military & Defence, Research & Production, Social & Governance |

---

## 2. Facility Placement

Facilities are seeded at world generation, not built dynamically by faction AI. The generation pipeline:

1. **Identify eligible systems**: For each facility type, find systems with the required prerequisite traits
2. **Assign tier**: Facility tier = highest quality tier among the system's prerequisite traits for that facility
3. **Faction seeding**: Each faction places facilities at its best eligible systems, prioritising higher trait quality
4. **Minimum guarantees**: Every faction must have at least one shipyard and one fuel depot in its territory. If trait generation didn't produce eligible systems, the generation retries or forces a minimum trait

Facilities can change through wars:

- **Captured**: When a system changes hands, its facilities transfer to the new owner intact
- **Damaged**: Prolonged warfare in a contested system can degrade facility tier (tier 3 → tier 2 → tier 1 → destroyed). Rebuilding takes time and investment
- **Rebuilt**: A faction can rebuild a destroyed facility at an eligible system, but it starts at tier 1 and upgrades slowly

---

## 3. Facility Catalog

### Ship & Fleet

| Facility | Player use | Strategic value | Prerequisites |
|---|---|---|---|
| **Shipyard** | Buy and repair ships. Tier determines available ship classes — tier 1 sells shuttles and basic freighters, tier 2 adds specialised vessels, tier 3 sells faction capital ships | Loss cripples fleet growth. Highest-priority war target. Players travel across regions for tier-3 shipyards | Lagrange stations, orbital ring remnant |
| **Fuel depot** | Refuel at reduced cost, extends effective travel range. Higher tier = bigger discount | Controls logistics — a region without depots is expensive to operate in. Affects war sustainability, supply lines | Gas giant, helium-3 reserves |
| **Drydock** | Ship upgrades and modifications — add modules, improve stats. The progression facility where credits become ship power. Unique faction-specific upgrades at homeworld drydocks | Pilgrimage destination. Players seek out high-tier drydocks for the best upgrades. Faction identity expressed through exclusive mods | Lagrange stations, heavy metal veins |

### Trade & Economy

| Facility | Player use | Strategic value | Prerequisites |
|---|---|---|---|
| **Trade exchange** | Better buy/sell spreads, more goods listed, higher trade volume. The civilised marketplace — best place to trade legitimately | Attracts players, generates tax revenue and trade mission activity. Economic engine for the faction | Ancient trade route, habitable world, lagrange stations |
| **Warehouse** | Faction-level storage that buffers supply/demand. Smooths price volatility — less extreme spikes and crashes at this system | Stabilises faction economy. Destruction causes supply shock — prices go haywire, creating opportunities for traders | Any industrial or core affinity trait |
| **Black market** | Buy/sell contraband, smuggling missions, government-banned goods available. Higher danger, higher margins | Creates the smuggler gameplay loop. Frontier factions tolerate these, authoritarian factions hunt them. Players choose risk/reward | Dark nebula, nebula proximity. Also appears in frontier government systems regardless |
| **Customs house** | Not a player service — enforcement facility. Increases contraband inspection rates, collects import duties at this system | Generates faction revenue, controls illegal goods flow. Destruction opens smuggling routes — indirect benefit to criminal players | Habitable world, lagrange stations |

### Military & Defence

| Facility | Player use | Strategic value | Prerequisites |
|---|---|---|---|
| **Naval base** | Military missions — war contributions, patrols, escort duty. Staging point for war logistics missions | Defensive bonus in battles. Reduces system danger. Military projection for the faction | Lagrange stations, heavy metal veins |
| **Defence platform** | Not directly used by players — orbital weapons that affect war battles | Makes system harder to conquer — attacker needs more battle wins to shift control score. Passive deterrent that raises the cost of attack | Any orbital feature trait |
| **Intelligence outpost** | Tier 2 war contribution missions — espionage, intelligence gathering, information about nearby enemy systems | Provides the intelligence battle modifier. Better intel = better battle rolls. Covert, hard to detect | Nebula proximity, dark nebula. Also placed at border systems |

### Research & Production

| Facility | Player use | Strategic value | Prerequisites |
|---|---|---|---|
| **Research station** | Tech-related missions, data trading. Future hook: unlocks advanced production recipes at the system | Drives tech economy output. Factions with more research stations have stronger tech sectors | Precursor ruins, gravitational anomaly, exotic matter, crystalline formations |
| **Refinery complex** | Not directly player-facing — boosts system's refinery production rates. Processed goods output increases | Economic output. A well-placed refinery on a system with strong traits is a money machine for the faction | Volcanic world, binary star, helium-3 reserves |
| **Mining rig** | Not directly player-facing — boosts extraction production rates. Raw material output increases | Resource output. Stacks with extraction traits — high-quality asteroid belt + mining rig = major ore producer | Asteroid belt, mineral-rich moons, gas giant |
| **Academy** | Crew training (future mechanic), ship performance improvements. Future hook: general training for the stratagem mechanic | Trains generals — higher quality = higher stratagem chance in battles. Long-term military investment that pays off in wars | Habitable world, lagrange stations |

### Social & Governance

| Facility | Player use | Strategic value | Prerequisites |
|---|---|---|---|
| **Planetary administration** | Faction reputation missions, political influence. Where players interact with faction leadership and governance | Seat of local governance. Tax collection, stability. Loss causes temporary governance chaos | Habitable world |
| **Embassy** | Diplomatic missions between factions. Generates positive relation drift between the host faction and the guest faction | A tool for peace — factions invest in embassies to maintain alliances. Destroying an embassy is an act of aggression that tanks relations | Habitable world, ancient trade route |
| **Communication relay** | Extends information range — market data and event alerts from further systems. Future hook: fog of war mechanic | Information control. Good relay coverage means seeing threats coming. Loss creates blind spots in faction awareness | Any orbital feature trait |

---

## 4. Facility Tiers

Facility tier is derived from the quality of the system's prerequisite traits:

| Tier | Trait quality needed | Capability |
|---|---|---|
| 1 | Any quality prerequisite (1+) | Basic services. Functional but limited — starter ships, basic upgrades, small trade volume |
| 2 | At least one quality 2+ prerequisite | Full services. Most ship classes available, good upgrades, solid trade volume |
| 3 | At least one quality 3 prerequisite | Premium services. Faction flagships, exclusive upgrades, best trade spreads. Rare — only a handful per faction |

Tier determines the *quality* of what the facility offers, not whether it exists. A tier-1 shipyard and a tier-3 shipyard both sell ships — but the tier-3 one sells better ships, repairs faster, and may offer faction-exclusive vessels.

---

## 5. Facilities and War

Facilities are high-value targets in wars. Their presence affects battle mechanics and their loss has real consequences.

**During war:**

- Naval bases and defence platforms provide direct battle modifiers for the defending faction
- Intelligence outposts provide the intelligence modifier
- Facilities in contested systems can be damaged by prolonged fighting — each battle in the system has a chance of degrading a facility's tier (per-battle roll, probability scales with battle intensity)
- Tier degradation is stepwise: tier 3 → tier 2 → tier 1 → destroyed. Each step is a separate roll — a single battle rarely destroys a facility outright, but prolonged sieges grind them down
- Damaged facilities provide reduced bonuses at the degraded tier level

**After conquest:**

- Intact facilities transfer to the conquering faction immediately
- Damaged facilities need rebuilding (time + faction resources to restore tier). Rebuilding time and cost scale with tier gap
- The conquering faction's government type may change which facilities are *active* — an authoritarian faction capturing a system with a black market might shut it down; a frontier faction might embrace it

**Strategic implications:**

- Quick, decisive wars preserve infrastructure — long sieges degrade it. Factions have incentive to win fast
- A faction might deliberately target an enemy's tier-3 shipyard to cripple fleet production, even if they can't hold the system permanently
- Rebuilding damaged facilities is a post-war credit sink that delays economic recovery of conquered territory

---

## 6. Strategic Value (Emergent)

Strategic value is not a stored property — it emerges naturally from facilities, traits, and topology. No system needs an explicit "value" score; it becomes important through what it has and where it sits.

**Value dimensions** (each independently makes a system worth controlling or contesting):

| Dimension | What creates it | Example |
|---|---|---|
| **Economic output** | High-quality production traits, rare resources (shipped — see [System Traits](../active/gameplay/system-traits.md)) | Tier-3 asteroid belt = massive ore production |
| **Infrastructure** | High-tier facilities (shipyards, naval bases) | Tier-3 shipyard = capital ship access. Only a handful exist per faction |
| **Population** | High population from habitable/established traits | High population = deep market, high consumption, strong absorption capacity |
| **Location** | Chokepoint position, border system, trade route junction (shipped — see [Universe](../active/gameplay/universe.md)) | Gateway between two faction territories |
| **Unique traits** | Rare phenomena (exotic matter, precursor ruins, subspace rift) (shipped) | Only 2–3 subspace rifts in the galaxy |

The faction system's war mechanics operate on this emergent worth — the war AI evaluates potential targets by aggregating these dimensions (trait quality, facility tiers, connection count, population) without the player or the design needing to assign explicit scores.

---

## Related Design Docs

- **[System Traits (active)](../active/gameplay/system-traits.md)** — placement prerequisites, tier derivation, the geological foundation
- **[Faction System](../active/gameplay/faction-system.md)** — territory control, war mechanics, government bonuses
- **[Missions](./missions.md)** — mission types generated by facilities (naval base, embassy, black market, etc.)
- **[Player Progression](./player-progression.md)** — how players interact with facilities, unlock access to trait-gated content
- **[Navigation Changes](./navigation-changes.md)** — customs house, fuel depot, drydock, black market interactions
