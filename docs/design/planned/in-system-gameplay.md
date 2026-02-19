# In-System Gameplay Design

The second major gameplay space alongside the universe map. When docked at a system, players engage with narrative content, NPC interactions, missions, and activities that take place *within* the system — on planets, stations, moons, in asteroid fields, and at anomaly sites. A text-based adventure layer on top of the space trading simulation.

**Design principle**: Worthwhile but not mandatory. Fleet-focused players should never feel forced into in-system content to stay competitive. Adventure-focused players should find enough depth to spend most of their time here. Both paths are viable and rewarding — in-system gameplay is an alternative progression axis, not a prerequisite for the trading game.

**Design principle**: Start simple, grow deep. The framework supports unlimited content expansion, but Phase 1 ships a focused, polished set of content — enough to demonstrate the system and give early players engaging things to do beyond trading.

**Depends on**: [System Enrichment](./system-enrichment.md) (traits generate locations), [Player Progression](./player-progression.md) (progression gating), [Faction System](./faction-system.md) (faction missions, reputation), [Ship Roster](./ship-roster.md) (ship stats gate some activities)

---

## 1. Core Concept

When a player docks at a system, they're not just looking at a market and a mission board — they can *explore* the system. Each system has a set of **locations** generated from its traits. A system with a habitable world has settlements, wilderness, coastlines. One with precursor ruins has excavation sites. An asteroid belt has prospecting fields.

Each location offers:
- **Flavor text** — prose describing where you are, what you see, what the atmosphere feels like
- **NPCs** — characters to talk to, with dialogue and personality
- **Activities** — missions, mini-games, shops, information
- **Events** — content that changes based on active galaxy-level events

The player navigates locations through a text-based interface — reading descriptions, making choices, talking to NPCs. Think of it as a lightweight text adventure embedded in each system. The depth of content scales with the system's traits — a frontier outpost with one trait has a cantina and a landing pad; a core-economy hub with four traits has a sprawling station with districts, planet-side cities, and orbital installations.

### 1.1 Two Speeds of Play

The game deliberately serves two player archetypes:

| Style | Focus | In-system role |
|---|---|---|
| **Fleet manager** | Trade routes, automation, facilities, faction strategy | Quick stop — check missions, grab contracts, move on. In-system is a service menu |
| **Adventurer** | Exploration, stories, NPC relationships, mini-games | Extended stay — explore locations, follow storylines, play games in cantinas, build local reputation |

Both players earn credits and progress. The fleet manager earns through volume and efficiency. The adventurer earns through unique rewards, rare finds, and mission payouts. Neither path is strictly better — they're different gameplay experiences within the same universe.

---

## 2. Location Model

Locations are the building blocks of in-system content. Each location is a visitable place within a system — a planet surface, an orbital station district, an asteroid field, a ruin site.

### 2.1 Location Generation

System traits determine which locations exist. Each trait type maps to one or more location templates:

| Trait | Locations generated |
|---|---|
| Habitable world | Settlement (town/city), wilderness, spaceport |
| Ocean world | Floating platform, underwater facility, coastal port |
| Volcanic world | Thermal vents research station, hardened surface outpost |
| Frozen world | Ice mining station, subsurface habitat |
| Jungle world | Biodiversity research camp, overgrown ruins, canopy station |
| Desert world | Mining town, solar array compound, buried structures |
| Tidally locked world | Terminator-line settlement, dark-side research post |
| Asteroid belt | Prospecting field, hollowed-out asteroid station |
| Gas giant | Upper atmosphere skimmer platform, orbital refinery |
| Mineral-rich moons | Moon-side mining camp, low-gravity processing facility |
| Ring system | Ring harvester station |
| Precursor ruins | Excavation site, artifact vault, sealed chambers |
| Gravitational anomaly | Research observatory, anomaly perimeter station |
| Dark nebula | Hidden outpost, sensor-dead zone |
| Subspace rift | Containment facility, observation platform |
| Generation ship wreckage | Derelict interior, salvage yard |
| Lagrange stations | Main concourse, merchant quarter, cantina district |
| Ancient trade route | Historic waystation, trade museum |

Quality tier affects location flavor text and available content depth — a tier-1 asteroid belt produces a "sparse debris field with a cramped mining shack"; tier-3 produces a "dense, mineral-rich belt with a sprawling excavation complex and multiple docking bays."

### 2.2 Universal Locations

Every system gets these regardless of traits:

- **Docking bay** — where you arrive. Basic services, ship status, departure
- **Station cantina** — social hub. NPCs, rumors, mini-games, job board postings. The default "hang out" location. Present even at the smallest outpost — spacers always find somewhere to drink
- **Market terminal** — the existing trade UI, framed as a location. Fleet managers can go straight here and ignore the rest

These ensure every system has a minimum viable in-system experience, even a one-trait frontier outpost.

### 2.3 Location State

Locations can have persistent state that changes over time:

- **Discovery state** — some sub-areas within a location are hidden until the player explores or meets conditions (sensor stat reveals a hidden chamber in the ruins, reputation unlocks the back room of the cantina)
- **Event overlays** — active galaxy events modify location descriptions and available content (plague → settlement has quarantine zones and medical tents; war → station has refugee camps and military checkpoints)
- **Mission progress markers** — multi-step missions mark locations as "investigated" or "completed" for that player

---

## 3. NPC Framework

NPCs give in-system gameplay its personality. They're the characters you talk to, take jobs from, and build familiarity with.

### 3.1 NPC Types

| Type | Role | Persistence | Examples |
|---|---|---|---|
| **Fixture** | Permanent resident of a location. Always there | Per-system, permanent | Station bartender, dockmaster, market clerk, mining foreman |
| **Faction representative** | Official faction presence. Dialogue gated by reputation | Per-system, permanent | Governor's aide, military liaison, trade commissioner |
| **Specialist** | Expert tied to a trait-specific location | Per-system, permanent | Archaeologist at ruins, biologist at jungle camp, engineer at refinery |
| **Wanderer** | Appears at different systems over time. Recurring personality | Galaxy-wide, mobile | Traveling merchant with rare goods, roaming journalist, retired pilot with stories |
| **Visitor** | Temporary NPC spawned by events or missions | Temporary | Refugee seeking passage, stranded pilot, bounty hunter tracking a mark |

### 3.2 NPC Interaction

NPCs use a **branching dialogue** system. Each NPC has:

- **Greeting** — initial text when you approach. Varies by visit count ("Welcome, stranger" → "Back again? Pull up a chair")
- **Dialogue tree** — branching options. Some branches are always available, others gated by:
  - Faction reputation (faction reps won't share sensitive info with outsiders)
  - Previous interactions (an NPC remembers if you helped or slighted them)
  - Ship stats (a mining foreman only respects you if your ship can handle the work)
  - Active events (NPCs comment on current galaxy events — "Did you hear about the plague at Arcturus?")
  - Mission state (NPCs relevant to active missions have specific dialogue)
- **Personality** — each NPC has a tone/personality reflected in their dialogue. The grizzled dockmaster is terse. The cantina owner is chatty. The faction official is formal. This is flavor, not a mechanical system — it's in the writing

### 3.3 NPC Functions

Beyond dialogue, NPCs serve mechanical purposes:

| Function | Description | Example |
|---|---|---|
| **Mission giver** | Offers in-system missions. Dialogue leads to mission acceptance | Archaeologist: "We've found something in the lower chambers. I need someone with a good sensor suite to map it" |
| **Information broker** | Sells or trades intel about other systems — trait data, event warnings, trade opportunities | "I've heard the refineries at Vega are running dry. Someone with fuel could make a fortune..." |
| **Specialty merchant** | Sells rare goods or items not available on the regular market. Limited stock, irregular availability | A wanderer selling recovered precursor artifacts, or a cantina owner with a case of rare vintage from a destroyed system |
| **Mini-game opponent** | Plays mini-games against the player. Different NPCs have different skill levels and playstyles | The cantina regular who plays it safe vs. the smuggler who bluffs every hand |
| **Lore source** | Shares world-building, history, faction background through dialogue. No mechanical reward, pure narrative | The retired pilot telling stories about the last Kessari-Terran war |
| **Reputation contact** | Relationship with the player tracks across visits. Higher familiarity unlocks better missions, prices, or information | A bartender who initially gives you rumors, then tips, then introduces you to the local underworld |

---

## 4. In-System Missions

Smaller-scale, more personal missions that take place within a system's locations. Distinct from universe-level missions (see [missions.md](./missions.md)) — these don't require traveling between systems. The player explores locations, interacts with NPCs, makes choices, and resolves outcomes within the system they're docked at.

### 4.1 Mission Structure

In-system missions follow a common structure:

1. **Discovery** — player finds the mission (NPC dialogue, location exploration, job board posting, event trigger)
2. **Briefing** — text description of the task, requirements, and expected reward. Player accepts or declines
3. **Stages** — one or more steps, each involving visiting a location, making a choice, or committing time. Multi-stage missions have branching paths based on player decisions
4. **Resolution** — outcome determined by player choices, ship stats, and (for some missions) dice/RNG. Text describes what happened
5. **Reward** — credits, reputation, items, information, or narrative progression

### 4.2 Time Commitment

Some missions are instant (a dialogue choice), others commit the player's ship for a number of ticks (similar to travel). This creates resource allocation tension — the ship is unavailable for trading while committed to an in-system activity.

| Duration | Examples |
|---|---|
| **Instant** | Dialogue missions, information gathering, social encounters |
| **Short (1–5 ticks)** | Surface surveys, quick salvage runs, cantina mini-game tournaments |
| **Medium (5–15 ticks)** | Excavation digs, deep asteroid prospecting, biological specimen collection |
| **Long (15–30 ticks)** | Major archaeological expeditions, deep-atmosphere gas giant dives, derelict exploration |

Longer missions generally offer better rewards. The player decides whether the time investment is worth pulling a ship off trade duty.

### 4.3 Mission Categories

#### Exploration & Survey

Mapping unknown areas, cataloging resources, and discovering points of interest.

- Survey a planet's surface for resource deposits (feeds into trait discovery for future players)
- Map an uncharted section of an asteroid belt
- Catalog biological specimens in a jungle biome
- Scout a dark nebula's interior for navigable routes

**Trait affinity**: Any planetary or orbital trait. Wilderness and frontier locations.
**Stat relevance**: Sensors (detection quality), Speed (coverage rate)

#### Archaeology & Research

Studying precursor artifacts, decoding ancient technology, piecing together galactic history.

- Excavate a sealed precursor chamber (multi-stage: clear entrance → map interior → recover artifacts)
- Decode an artifact found at a previous excavation
- Cross-reference findings across multiple systems (multi-system breadcrumb trail)
- Study gravitational anomaly readings over time

**Trait affinity**: Precursor ruins, gravitational anomaly, exotic matter, generation ship wreckage
**Stat relevance**: Sensors (analysis quality). Some stages time-gated (excavation takes ticks)

#### Salvage & Recovery

Recovering valuable materials from wrecks, derelicts, and hazardous environments.

- Board a derelict vessel and recover cargo (risk: structural collapse, hazards)
- Salvage components from generation ship wreckage
- Recover a lost probe from a gas giant's upper atmosphere
- Extract rare minerals from a volcanic vent (hazardous, time-limited)

**Trait affinity**: Generation ship wreckage, asteroid belt, volcanic world, gas giant
**Stat relevance**: Hull (survival in hazardous environments), Sensors (locating salvage)

#### Social & Diplomatic

Navigating NPC relationships, resolving disputes, brokering deals.

- Mediate a dispute between rival mining crews
- Negotiate trade terms between a settlement and a faction representative
- Convince a reluctant NPC to share information about a smuggling ring
- Build trust with a suspicious frontier community

**Trait affinity**: Habitable world, lagrange stations, ancient trade route. Social missions appear wherever there are people
**Stat relevance**: None (ship stats don't help with diplomacy). Gated by faction reputation and NPC familiarity

#### Investigation & Mystery

Solving crimes, tracking leads, uncovering plots. The detective missions.

- Track down the source of counterfeit goods flooding a market
- Investigate disappearances at a remote mining outpost
- Uncover a smuggling operation running through customs
- Piece together what happened at an abandoned research station

**Trait affinity**: Any — mysteries can happen anywhere. Dark nebula and frontier locations skew toward criminal plots; core and habitable locations toward political intrigue
**Stat relevance**: Sensors (finding clues), Stealth (covert investigation)

#### Hazardous Operations

Entering dangerous environments for valuable rewards. High risk, high reward.

- Navigate a volcanic surface to reach a mineral deposit (hull damage risk)
- Dive into a gas giant's lower atmosphere for rare gases (time pressure, ship stress)
- Enter a subspace rift perimeter to collect exotic readings (unpredictable hazards)
- Prospect a radioactive asteroid for fissile materials (crew exposure risk)

**Trait affinity**: Volcanic world, gas giant, subspace rift, radioactive deposits, solar flare activity
**Stat relevance**: Hull (survival), Evasion (avoiding hazards). These missions can damage the player's ship — a real cost that balances the rewards

### 4.4 Multi-System Storylines

Some narratives span multiple systems, giving exploration-focused players long-term goals:

- **Precursor trail** — archaeological clues at one ruin point to another system. Following the breadcrumbs across 4–6 systems reveals a larger story and a significant reward at the end
- **Wanderer questlines** — a recurring NPC (wanderer type) has a personal story that unfolds across encounters at different systems. Each meeting advances their arc
- **Faction intrigue** — a faction representative asks you to investigate something that leads across faction borders. Political consequences at the end
- **Mystery chains** — a crime or conspiracy that spans multiple systems. Each system reveals a piece of the puzzle

Multi-system storylines are mid-to-late game content. Early game focuses on self-contained single-system missions.

---

## 5. Mini-Games

Recreational activities available at cantinas and social locations. These are the in-universe games that spacers play — the Gwent of Stellar Trader. Mini-games are optional content that adds flavor, provides an alternative way to earn credits, and deepens the sense of a lived-in universe.

Phase 1 ships **Void's Gambit**, a bluffing card game played in cantinas. Future phases add additional games (Drift, Alignment, Cargo Roulette).

Full mini-game designs, rules, NPC opponents, stakes, tension analysis, and expansion hooks are in the dedicated **[Mini-Games](./mini-games.md)** design doc

---

## 6. Rewards

In-system activities offer rewards that complement but don't replace trading income. The goal is unique value — things you *can't* get from the trade loop.

### 6.1 Reward Types

| Reward | Source | Value proposition |
|---|---|---|
| **Credits** | Mission payouts, mini-game winnings, salvage sales | Direct income. Modest compared to good trade runs — in-system missions aren't meant to be the most efficient credit source |
| **Faction reputation** | Faction-sourced missions, diplomatic activities | Same reputation as universe-level missions. In-system missions offer more reputation per time spent than trading (smaller increments but more frequent) |
| **NPC familiarity** | Repeated interactions with the same NPCs | Unlocks better missions, information, dialogue. Per-NPC, per-player tracking |
| **Rare goods** | Archaeology finds, salvage recovery, specialist merchants | Small quantities of unique or high-value items. Can be sold at enormous markup or kept for collection/crafting |
| **Intel** | Information brokers, survey missions, investigation outcomes | Knowledge about other systems — trait data, event warnings, trade opportunities. Actionable information that improves trading decisions |
| **Lore fragments** | Archaeology, exploration, NPC stories | Collectible narrative content. No mechanical benefit, but satisfying for completionists. Could unlock cosmetic rewards or achievements |
| **Blueprints & discounts** | Major mission rewards, multi-system storyline conclusions | Facility cost reductions, ship upgrade unlocks, access to items not otherwise available. The big-ticket rewards for significant in-system investment |

### 6.2 Reward Philosophy

- **Active play beats passive** — in-system missions reward time and attention. They don't generate income while you're away
- **Unique, not superior** — in-system rewards complement trading, they don't obsolete it. A rare artifact is worth a lot, but you find one per expedition, not one per tick
- **Choice, not grind** — rewards come from decisions (which missions, which dialogue options, when to take risks), not repetitive farming. Repeatable missions exist but with diminishing returns or rotating content

---

## 7. Integration with Other Systems

### 7.1 Events

Active galaxy events modify in-system content:

| Event type | In-system effect |
|---|---|
| Plague | Medical relief missions at settlements. Quarantine zones restrict location access. NPCs discuss the crisis |
| War | Military checkpoints at stations. Refugee NPCs. Evacuation and resistance missions |
| Mining boom | New prospecting sites. Optimistic NPC dialogue. Temporary specialist merchants |
| Pirate activity | Security lockdowns. Investigation missions. NPCs offer tips for avoiding danger |
| Trade embargo | Smuggling opportunities. Faction tensions in dialogue. Black market activity increases |

Events create *temporal variety* — the same system feels different during a plague than during peacetime. This is a major replayability driver.

### 7.2 Faction System

- Faction reputation gates NPC interactions and mission availability (see [faction-system.md §3](./faction-system.md))
- Faction representatives at stations offer faction-specific missions and dialogue
- In-system missions can grant or cost faction reputation based on choices
- Government type affects location flavor — an authoritarian station has security checkpoints and propaganda; a frontier station has graffiti and unlicensed merchants

### 7.3 Player Progression

- Early game: simple missions at any system. Introduction to the in-system experience
- Mid game: deeper missions requiring better ships/stats. Multi-stage storylines. Mini-game access at higher stakes
- Late game: multi-system storylines, rare archaeological expeditions, high-stakes cantina games, mentor/patron NPC relationships

### 7.4 Ship Stats

Ship stats gate some in-system activities, creating build diversity:

| Stat | Gated content |
|---|---|
| Sensors | Hidden location discovery, archaeology analysis quality, investigation clues |
| Hull | Hazardous environment survival, salvage operations in dangerous wrecks |
| Stealth | Covert investigation, smuggling-adjacent missions |
| Evasion | Escaping hazardous situations, reducing damage from risky operations |
| Speed | Survey coverage rate (affects time commitment, not availability) |
| Cargo | Salvage capacity, specimen collection quantity |

This means a sensor-heavy exploration ship and a hull-heavy freighter have different in-system experiences at the same location. Ship choice matters beyond cargo capacity.

---

## 8. Phase 1 Scope

Phase 1 delivers a focused, polished slice of in-system gameplay. Enough to demonstrate the system, engage early players, and establish the framework for expansion.

### 8.1 What Ships in Phase 1

**Locations:**
- Universal locations at every system (docking bay, cantina, market terminal)
- 3–4 trait-generated location types (habitable world settlements, asteroid belt prospecting fields, precursor ruin excavation sites, lagrange station concourses)

**NPCs:**
- 2–3 fixture NPCs per universal location (bartender, dockmaster, job board clerk)
- 1 specialist NPC per trait-generated location (archaeologist, mining foreman, station administrator)
- 1 wanderer NPC who appears at random systems (the seed for multi-system storylines)
- Branching dialogue with flavor text. NPC greeting varies by visit count (first visit, repeat, frequent)

**Missions:**
- 5–8 mission templates per trait-generated location type, drawn from the categories in §4.3
- Mix of instant and short-duration (1–5 tick) missions
- Self-contained, single-system missions only (no multi-system storylines yet)
- Missions sourced from NPC dialogue and the job board

**Mini-game:**
- Void's Gambit at cantinas (see [Mini-Games §1](./mini-games.md))
- 2–3 NPC opponent archetypes with distinct playstyles
- Casual and standard stake tiers

**Rewards:**
- Credits and faction reputation from missions
- Mini-game credit winnings
- Intel rewards (flavor text with trade tips — "I heard ore prices are spiking at Vega")

### 8.2 What Doesn't Ship in Phase 1

- Multi-system storylines (Phase 2 — depends on having enough location variety)
- Medium and long-duration missions (Phase 2 — needs ship commitment UI)
- Rare goods and blueprint rewards (Phase 2 — needs inventory/collection system)
- Wanderer questlines (Phase 2 — needs NPC state tracking across systems)
- NPC familiarity tracking (Phase 2 — simple visit-count greetings in Phase 1, deeper relationship tracking later)
- High-stakes mini-game tier and card variants (Phase 2)
- Additional mini-games (Drift, Alignment, Cargo Roulette — Phase 3+)
- Event-driven location overlays (Phase 2 — needs event system integration)
- Ship stat gating on missions (Phase 2 — Phase 1 missions have no stat requirements)

### 8.3 Content Architecture

Locations, NPCs, and missions are **data-driven** — defined in constant files (like goods and events today), not hardcoded in components. New content is added by writing data, not code.

**Locations** define a name, description (varying by trait quality tier), trait requirement (or none for universal locations), and which NPCs are present.

**NPCs** define a name, title, personality descriptor (guides writing tone), type (fixture/specialist/wanderer/visitor), visit-count-aware greetings, and a dialogue tree of branching nodes. Each dialogue node has text and a set of player response options, some gated by reputation, previous interactions, or other conditions.

**In-system missions** define a title, description, category, source location and NPC, tick duration (zero for instant missions), a sequence of stages with branching player choices, and rewards (credits, reputation, items).

This mirrors how goods, events, and economy types are defined today — a constants file that the engine reads. Adding a new mission or NPC is a content task, not an engineering task.

---

## 9. UI Model

### 9.1 System Page Integration

The existing system page (market, missions, ship management) gains a new **Explore** tab or panel. This is the entry point to in-system content.

The explore view shows:
- **Available locations** — list/grid of locations the player can visit, with brief descriptions and activity indicators (new missions available, NPC wants to talk, mini-game table open)
- **Current location** — when visiting a location, the view shifts to show:
  - Location description (flavor text)
  - Present NPCs (clickable for dialogue)
  - Available activities (missions, mini-game, shop)
  - Navigation back to other locations

### 9.2 Dialogue UI

When talking to an NPC:
- NPC portrait/icon and name displayed
- Dialogue text in a readable format (narrative prose, not bullet points)
- Player response options as clickable choices
- Clear indication when a choice is gated (locked with reason: "Requires Trusted standing with Terran Sovereignty")

### 9.3 Mission UI

Mission flow within the in-system interface:
- Mission briefing as a dialogue/text panel with accept/decline
- Active mission stages shown as narrative text with choices
- Duration-based missions show a progress indicator (similar to ship travel)
- Completion screen with rewards summary

### 9.4 Mini-Game UI

Void's Gambit needs its own game board interface:
- Card display (player hand, player manifest, opponent manifest)
- Clear indication of face-up vs face-down cards
- Turn actions (play face-up, play face-down + declare, inspect)
- Score tracking and pot display
- NPC opponent dialogue during play (trash talk, reactions to good/bad plays)

---

## 10. Content Expansion Path

The framework is built so content scales without architecture changes. Adding content means adding data, not systems.

| Phase | Content added |
|---|---|
| **Phase 1** | Core framework. Universal locations, 3–4 trait locations, fixture NPCs, single-system missions, Void's Gambit |
| **Phase 2** | Multi-system storylines, wanderer questlines, NPC familiarity, ship stat gating, event overlays, rare goods rewards, high-stakes mini-games, medium/long missions |
| **Phase 3** | Additional mini-games (Drift, Alignment), deeper NPC relationships, faction-specific storylines, combat encounter system, cooperative missions |
| **Phase 4+** | Player-created content hooks, seasonal event storylines, mini-game tournaments, PvP mini-games, full multi-system narrative arcs |

Each phase adds content to the existing framework. No architecture changes needed after Phase 1 — just more locations, NPCs, missions, and mini-games defined in data files.

---

## Related Design Docs

- **[System Enrichment](./system-enrichment.md)** — traits that generate locations, trait quality tiers
- **[Missions](./missions.md)** — universe-level missions (separate system, complements in-system missions)
- **[Player Progression](./player-progression.md)** — game phases, progression gating, in-system content per phase
- **[Faction System](./faction-system.md)** — reputation gating for NPC dialogue and missions
- **[Ship Roster](./ship-roster.md)** — ship stats that gate in-system activities
- **[Mini-Games](./mini-games.md)** — Void's Gambit rules, future mini-games (Drift, Alignment, Cargo Roulette)
- **[Multiplayer Infrastructure](./multiplayer-infrastructure.md)** — eventual PvP mini-games, cooperative missions
