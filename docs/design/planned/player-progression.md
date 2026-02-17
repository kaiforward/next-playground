# Player Progression Design

The player's journey from new trader to galactic power broker. Defines the three-phase game arc, what's available at each stage, and how systems unlock over time. The core progression transforms gameplay itself — from manual piloting to fleet management to faction strategy.

**Design principle**: Progression changes *what you do*, not just *how big the numbers are*. Early game is hands-on trading and exploration. Mid game introduces fleet management and facility investment. Late game shifts to strategic oversight — automated fleets, production empires, and faction power politics.

**Depends on**: [Faction System](./faction-system.md) (reputation, war contributions), [System Enrichment](./system-enrichment.md) (facilities, traits), [Ship Roster](./ship-roster.md) (ship classes, upgrades), [Player Facilities](./player-facilities.md) (player-built facilities), [In-System Gameplay](./in-system-gameplay.md) (missions, story content)

---

## 1. Game Arc Overview

Three phases defined by what the player *does*, not arbitrary level thresholds. Players transition naturally as they accumulate credits, ships, reputation, and knowledge.

| Phase | Focus | Gameplay feel |
|---|---|---|
| **Early game** | Exploration, learning, manual trading | Hands-on pilot. "I fly my ship and make trades" |
| **Mid game** | Fleet expansion, facility investment, faction alignment | Fleet captain. "I manage several ships and have investments" |
| **Late game** | Automation, production empire, faction power broker | Strategic commander. "I direct an operation and shape galactic politics" |

The transitions are gradual — there's no hard gate between phases. A player might automate their first trade ship while still manually running missions on another. The phases describe where the *centre of gravity* of gameplay sits.

---

## 2. Early Game — Explorer & Trader

The player starts with a single starter ship (Shuttle) docked at a core-economy system in a trade hub region. Credits are tight, the map is unknown, and survival comes from smart trades and taking available work.

### Available from the start

- **Manual trading**: Buy low, sell high. The core loop. Players learn which economy types produce/consume which goods, spot price trends, and build intuition for trade routes
- **In-system missions**: Story-driven and procedural missions available at any system. Flavour tied to system traits — a mission at a system with precursor ruins feels different from one at a mining outpost. See [In-System Gameplay](./in-system-gameplay.md)
- **Trade missions**: Auto-generated delivery contracts from market conditions and events (existing system)
- **Exploration**: Visiting new systems and regions, discovering traits, learning faction territories and identities
- **Minor faction missions**: Small jobs for local factions — courier runs, data delivery, survey missions. Builds reputation slowly

### Early game progression

- Learn the map, economy types, and faction territories
- Build credits through manual trades and missions
- Purchase a second ship — first fleet expansion decision (another shuttle for range, or a freighter for cargo?)
- Begin building reputation with one or more factions through trade and missions
- Discover system traits and learn which systems are valuable and why

### Early game constraints

- Limited to small ships — shuttles and basic freighters
- No automation — every trade and mission is manual
- No facility ownership — the player is a trader, not an investor
- Faction reputation is low — basic missions and standard prices only
- War contributions are not available (or too expensive to be practical)

---

## 3. Mid Game — Fleet Captain

The player has enough credits and experience to start thinking beyond individual trades. Multiple ships, first facilities, and deepening faction relationships open up new gameplay.

### Unlocks

- **Fleet expansion**: Purchase additional ships across expanding ship classes. More specialisation becomes available — dedicated trade ships, scout/exploration ships, ships suited to different cargo types. See [Ship Roster](./ship-roster.md)
- **Minor player facilities**: First facility purchases. Mining operations, trade posts, small warehouses. These are personal investments tied to system economy — a mining operation in an extraction system, a trade post in a core system. Passive income that supplements active trading. See [Player Facilities](./player-facilities.md)
- **Faction reputation tiers**: Reaching Trusted (+25) and eventually Champion (+75) with chosen factions unlocks:
  - Better prices at faction systems
  - Higher-paying, more complex missions
  - Access to specialised ship classes at faction shipyards (reputation-gated)
  - More influence and rewards from war contributions
- **War contributions (Tier 1)**: Economic support for faction war efforts — supplying war goods, donating credits, war logistics missions. Expensive but meaningful. Players choose which faction to back, with real reputation consequences (see [Faction System §4.7](./faction-system.md))
- **Early automation**: First automation upgrades for ships. Assign a ship to a region with basic trade behaviour — the ship executes trades using simple strategies (greedy, nearest). Frees the player to focus on other ships or missions while automated ships generate background income

### Mid game progression

- Build a fleet of 3–6 ships across different roles
- Establish first player facilities in systems with good traits
- Commit to one or two faction alignments — reputation unlocks compound
- Begin participating in faction wars through economic support
- Start automating routine trade runs to free up time for higher-value activities

---

## 4. Late Game — Power Broker

The player commands a trade empire. Multiple automated fleets, production facilities feeding faction war efforts, and deep faction influence. Gameplay shifts from piloting to strategic oversight.

### Unlocks

- **Major player facilities**: Larger, more expensive facilities — refineries, manufacturing plants, logistics hubs. These produce goods at scale, including war materials. Output feeds directly into faction war efforts and the broader economy. See [Player Facilities](./player-facilities.md)
- **Advanced automation**: Upgraded AI behaviours for automated ships. Optimal routing (computationally expensive — see §5). Players manage fleet strategy rather than individual ships — assign trade regions, specify resource types, let ships execute
- **Capital ships**: Large, expensive, specialised vessels gated by faction reputation (Champion tier) and high-tier shipyard access. See [Ship Roster](./ship-roster.md)
- **War contributions (Tier 2 & 3)**: Strategic and direct action missions — blockade running, intelligence gathering, sabotage. High risk, high reward, significant reputation consequences with enemy factions
- **Faction influence**: Top contributors shape faction behaviour — not through direct control, but through weight of contribution. A player who funds a faction's war effort and supplies their shipyards has *influence*, even if the faction AI makes its own decisions

### Late game progression

- Expand facility network across multiple systems and regions
- Automate most trading — player focuses on which regions and goods to target, not individual trades
- Heavy faction investment — supplying wars, funding generals (academy contributions), building production for war materials
- Manage assets across faction borders — hedging risk with neutral reputation in some factions while going all-in on others
- React to political shifts — wars, territory changes, faction collapses — by repositioning facilities and fleets

---

## 5. Ship Automation

Automation transforms gameplay from manual piloting to fleet management. It reuses existing NPC trade logic, giving players access to the same strategies the simulation uses.

### Automation Tiers

| Tier | Strategy | Cost | Behaviour |
|---|---|---|---|
| **Basic** | Greedy | Moderate | Ship trades the most profitable good at each system. Simple, decent returns. No route planning |
| **Standard** | Nearest | Expensive | Ship finds profitable trades at nearby systems. Better route efficiency than greedy. Considers fuel costs |
| **Advanced** | Optimal | Very expensive | Ship calculates best multi-hop routes across a region. Best returns but computationally intensive — processing cost limits how many ships can run this simultaneously |

### Design Constraints

- **Processing cost is real**: Each automated ship consumes server processing per tick. Optimal strategy costs more than greedy. This creates a natural limit — players can't run 50 ships on optimal without paying for it (in credits as ongoing upkeep)
- **Per-player ship limits**: Hard cap on total automated ships, scaling with progression. Early automation might allow 1–2 ships. Late game might allow 8–12. Prevents any single player from dominating server resources
- **Player direction, not full autopilot**: Players specify the region, preferred goods/resource types, and risk tolerance. The ship executes within those parameters. The player is the strategist, the ship is the operator
- **Not available for all activities**: Automation covers trade routes only. Missions, war contributions, and in-system gameplay remain manual — these are the activities that keep late-game players actively engaged

### Automation Upgrades

Purchased at drydocks (see [System Enrichment §5.3](./system-enrichment.md)). Each ship needs its own automation module — it's a per-ship upgrade, not a global unlock. Higher-tier drydocks offer higher-tier automation modules.

---

## 6. Player Facilities

Player-owned facilities are personal investments — separate from faction facilities (see [System Enrichment §5](./system-enrichment.md)). They generate passive income, produce goods, and represent the player's economic footprint in the galaxy.

### Key Design Rules

- **Economy-tied**: Players can only build facilities that match the system's economy type. No extraction operations in agricultural systems. The system's traits determine what's viable
- **Multiple players per system**: Many players can own facilities in the same system. Player facilities don't affect system-level production data — they're personal income streams, not world-state modifications
- **Assets at risk**: Player facilities are the "assets" referenced in [Faction System §4.8](./faction-system.md). When territory changes hands, facilities may be taxed, fined, or seized based on the player's reputation with the conquering faction
- **Progression-gated**: Minor facilities available mid game, major facilities late game. Gated by credits, faction reputation, and possibly facility-specific prerequisites

### Facility Tiers

| Tier | Phase | Examples | Purpose |
|---|---|---|---|
| **Minor** | Mid game | Mining operation, trade post, small warehouse | Entry-level investment. Low cost, low passive income. Learn the system |
| **Major** | Late game | Refinery, manufacturing plant, logistics hub | Significant investment. Higher output, produces goods that feed into faction war efforts and the wider economy |

Detailed facility types, costs, output rates, and upgrade paths are defined in [Player Facilities](./player-facilities.md).

---

## 7. Faction Reputation as Progression

Faction reputation (see [Faction System §3](./faction-system.md)) is a primary progression axis. It gates access to content and creates meaningful alignment choices — players can't be champions of everyone.

### What Reputation Unlocks

| Tier | Standing | Unlocks |
|---|---|---|
| Neutral (0 to +24) | Starting state | Standard prices, basic trade missions, basic in-system missions |
| Trusted (+25 to +74) | Mid game target | Better prices, faction-specific missions, access to specialised ship classes at tier-2 shipyards, war contribution eligibility (Tier 1) |
| Champion (+75 to +100) | Late game achievement | Best prices, exclusive high-paying missions, capital ship access at tier-3 shipyards, war contribution access (Tier 2 & 3), faction influence, exclusive drydock upgrades |

### Reputation Trade-offs

- Supporting one faction in a war costs reputation with their enemy. Players must choose sides
- A **neutral trader** path is viable — tolerated everywhere, welcomed nowhere. Stable income but no access to the best content
- **Multi-faction alignment** is possible if the factions aren't at war with each other, but alliance shifts and new wars can force difficult choices
- Reputation loss from enemy factions scales with involvement tier — Tier 1 war contributions are invisible, Tier 3 guarantees hostility (see [Faction System §4.7](./faction-system.md))

---

## 8. Credit Sinks

Every phase needs meaningful ways to spend credits. Without sinks, experienced players accumulate infinite wealth and the economy stagnates.

| Phase | Sinks | Scale |
|---|---|---|
| **Early** | Ships (second ship purchase), fuel, trade mission deposits, basic ship repairs | Hundreds to low thousands |
| **Mid** | Fleet expansion (3–6 ships), ship upgrades at drydocks, minor player facilities, automation modules (per-ship), Tier 1 war contributions | Thousands to tens of thousands |
| **Late** | Capital ships, major player facilities, advanced automation modules, Tier 2/3 war contributions, faction general training (academy), facility upgrades and expansion | Tens of thousands to hundreds of thousands |

The key is that each phase's sinks are *investments* — they generate returns (better ships earn more, facilities produce income, automation frees time). Spending feels good because it makes the player more capable, not just poorer.

---

## 9. In-System Gameplay

A separate gameplay layer from the universe map. When docked at a system, players can engage with story content, missions, and activities that take place *within* the system — on planets, stations, in asteroid fields, etc.

### Role in Progression

- Available from the start — gives new players immediate engaging content beyond pure trading
- Mission flavour and availability tied to system traits (precursor ruins → archaeology missions, jungle world → biological survey, volcanic world → hazardous extraction)
- Faction reputation unlocks higher-tier in-system missions
- Some missions are multiplayer — coordination with other players for larger objectives

### Scope

In-system gameplay is a major system that requires its own detailed design. This section establishes where it fits in the progression arc. Full mechanics, mission types, narrative structure, and in-system UI are defined in [In-System Gameplay](./in-system-gameplay.md).

---

## Related Design Docs

- **[Faction System](./faction-system.md)** — reputation tiers, war contributions, player assets in conquered territory
- **[Missions](./missions.md)** — universe/region-level mission framework (trade, operational, war contributions)
- **[System Enrichment](./system-enrichment.md)** — faction facilities (shipyards, drydocks, academies), system traits
- **[Ship Roster](./ship-roster.md)** — ship classes, roles, upgrade paths, faction-exclusive vessels
- **[Player Facilities](./player-facilities.md)** — player facility types, output rates, upgrade paths, war material production
- **[In-System Gameplay](./in-system-gameplay.md)** — in-system missions, story content, trait-driven gameplay
