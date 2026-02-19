# Faction System Design

Core political and territorial layer for multiplayer gameplay. Factions are named entities that control territory, wage wars, and give players a reason to trade beyond profit.

**Inspiration**: Mount & Blade (territory control, multi-front wars, faction politics), Elite Dangerous (named factions, reputation), Planetside 2 (endless conflict cycle).

**Design principle**: Factions create the *demand* for player activity. Players don't just trade to get rich — they trade to fund wars, shift borders, and reshape the political map.

**Scalability**: The system is designed to support many more factions and systems than the initial launch roster. The faction model, war mechanics, and territory systems must all scale cleanly. The initial 6 major factions and ~1,000-2,000 systems are a starting point — the architecture should support 15+ major factions and 5,000+ systems without redesign.

---

## 1. Faction Model

Factions are hand-crafted named entities with distinct identity and behavior.

### Core Properties

| Property | Type | Description |
|---|---|---|
| name | string | Unique faction name (e.g. "Terran Sovereignty") |
| description | text | Lore, personality, background |
| government | GovernmentType | Economic identity — drives market behavior, internal modifiers |
| doctrine | Doctrine | Political identity — drives foreign policy and war behavior |
| homeworld | system_id | Capital system. Very hard to capture (see war-system.md §5) |
| territory | [system_ids] | Derived from systems that have `factionId` |
| color | string | Map/UI color for territory visualization |

### Faction Status (Derived, Not Stored)

Status is a function of territory size, not a flag. Thresholds with hysteresis to prevent flickering:

| Status | Gain threshold | Lose threshold | Notes |
|---|---|---|---|
| Dominant | 80+ systems | Below 60 | 0-2 at any time. Biggest target, biggest economy |
| Major | 40+ systems | Below 25 | Core powers. Economic/military advantages |
| Regional | 15+ systems | Below 10 | Mid-tier. Can threaten majors if allied |
| Minor | 1+ systems | 0 (destroyed/exiled) | Defensive bonuses. Underdog stories |

Status determines:
- Economic bonuses (larger factions have stronger economies but more to defend)
- Defensive bonuses (minor factions are harder to conquer per-system)
- War capacity (how many fronts a faction can sustain)
- Player mission availability and rewards

### Military Output (Derived)

Military output is the faction's per-tick capacity for projecting military force. It's the resource that the [War System](./war-system.md) consumes for fleet battles, sieges, and multi-front wars. Not stored directly — derived each tick from faction state:

- **Territory size**: More systems = more production capacity. The primary driver.
- **Economic output**: Systems with higher population (see [Production §2](./production.md)) and better production traits contribute more. An industrial hub with tier-3 lagrange stations contributes more military output than a marginal frontier system.
- **Government modifier**: Militarist governments have higher military output per system. Corporate governments have lower (they invest in trade, not fleets).
- **War disruption**: Systems in active war zones have reduced economic output, which reduces their military contribution. Prolonged wars degrade a faction's total military output.
- **Player contributions**: Player-produced tier 3 military assets (see [Production Roster §5](./production-roster.md)) add to faction military output. This is how player production meaningfully affects wars.

The exact formula is an implementation detail, but the principle is: military output scales with territory quality, not just territory size. A faction with 30 well-developed systems can match one with 50 marginal frontier systems.

### Doctrine Types

Doctrine defines how a faction behaves toward other factions. Each faction has one primary doctrine.

**Key design rule**: All factions are warlike. The aggression spread between doctrines is narrow — the difference is what *triggers* conflict and how they fight, not whether they fight. Even the most defensive doctrine will wage war under the right conditions. War exhaustion and attacker cost asymmetry (see war-system.md §3) keep aggressive doctrines from steamrolling reactive ones.

| Doctrine | War trigger | Strengths | Deterrent |
|---|---|---|---|
| Expansionist | "Give us any reason." Most likely to declare war (by a small margin). Looks for justifications to push borders | Fast system capture, strong offense | "Hit us and we'll hit you twice as hard" |
| Protectionist | Rarely starts wars, but responds with overwhelming force. Aggressive reclamation of lost territory | Very strong defense, reclamation bonuses | "Take our systems and you'll never stop fighting to hold them" |
| Mercantile | Fights when trade is threatened. Uses economic warfare as primary tool, military as backup | Trade embargoes, funds allied wars, strong economy | "Attack us and we'll bankrupt you and fund your enemies" |
| Hegemonic | Pressures weaker neighbors into submission. Avoids wars with equal powers, bullies smaller ones | Strong vs minor factions, vassal mechanics | "Submit or be conquered. Challenge us at your peril" |
| Opportunistic | Strikes when others are distracted or weakened. Targets factions already at war | Bonuses when attacking war-weakened factions | "Show weakness and we'll be there" |

Doctrine influences:
- War declaration probability and target selection
- Alliance preferences
- Event responses (some escalate, some negotiate, some exploit)
- Tension accumulation rates at borders

### Government Types

Government type is strictly an **economic/internal** axis. It defines how a faction runs its own territory — market behavior, production modifiers, trade regulations, internal stability. It says nothing about foreign policy (that's doctrine's job).

Two factions can share a government type and still be bitter enemies. A federation and another federation may both be democratic internally but have completely opposing doctrines and interests.

**Design rule**: Every government type has trade-offs — buffs balanced by debuffs. No type is strictly better or worse, just different. Players should want to trade at different government types depending on their cargo, risk tolerance, and strategy.

8 government types (expanded from original 4):

| Government | Economic identity | Player trade-off | Restrictions |
|---|---|---|---|
| Federation | Balanced, regulated, stable | Reliable profits, no surprises. The safe middle ground | Moderate — some contraband enforced |
| Corporate | Pro-trade, low regulation, profit-maximizing | Best margins but volatile. Boom or bust cycles | Very few — almost anything profitable goes |
| Authoritarian | State-controlled, price-fixed, rigid | Safest space, predictable demand. But most restricted — government controls what flows in and out | Heavy — strategic goods controlled, narrow allowed list |
| Frontier | Lawless, unregulated, dangerous | Highest potential profit, highest risk. Wild price swings, smuggler's paradise | None — no one's enforcing anything |
| Cooperative | Worker-owned, egalitarian, community-focused | Rock-solid consistency, never go broke. But low margins, luxury goods undervalued | Moderate — luxury goods taxed/restricted |
| Technocratic | Innovation-driven, high-tier specialization | Premium prices on advanced goods. Bad market for raw materials | Low — open to most trade, basics undervalued |
| Militarist | War economy, resource-hungry, mobilized | Starving for raw materials and weapons. Great during wartime, mediocre during peace | Moderate — strategic goods controlled |
| Theocratic | Ideological, community-driven, insular | Pays premium for basic/cheap goods. But heavy restrictions on "immoral" goods — limited selection | Heavy — narcotics, weapons, luxury goods banned |

Economic modifiers per government type. The first four are implemented (see [Economy](../active/economy.md) for exact values). The last four use the same modifier axes — specific numbers to be defined during implementation.

| Government | Volatility | Eq. Spread | Danger | Contraband | Consumption bias | Design intent |
|---|---|---|---|---|---|---|
| Federation | 0.8x (stable) | -10% (tight) | None | Weapons | Balanced across goods | Safe, regulated, reliable profits |
| Corporate | 0.9x | -5% | 0.02 | None | Slight luxury/trade bias | Best margins, slightly volatile |
| Authoritarian | 0.7x (very stable) | -15% (very tight) | None | Weapons, Chemicals | State-directed, controlled | Safest, most restricted, predictable demand |
| Frontier | 1.5x (chaotic) | +20% (wide) | 0.10 | None | Uneven, erratic | Highest profit, highest risk, no rules |
| Cooperative | 0.7x (stable) | -10% (tight) | Low | Luxury goods | Even across goods, luxury depressed | Stable, predictable, low-margin — the boring safe option |
| Technocratic | 1.0x | Wide for tier 2, narrow for tier 0 | Low | None | High tech/electronics, low raw materials | Premium advanced goods market, poor basics market |
| Militarist | 1.3x (volatile) | +10% (wide) | 0.05 | Strategic goods (context-dependent) | High military-tagged + raw materials | Hungry war economy — volatile, resource-starved, great for arms dealers |
| Theocratic | 0.8x (stable) | Narrow for basics, wide for restricted | 0.03 | Weapons, Luxuries, Chemicals | High basic goods (food, textiles, medicine), low luxury/restricted | Pays premium for necessities, vice banned |

---

## 2. Inter-Faction Relations

Numeric score between each pair of factions. Relations are the engine that drives the political simulation — they determine when wars start, when alliances form, and how factions behave toward each other.

**Core design rule**: Relations tend to drift negative over time. Conflict is the default state; peace requires active maintenance. This ensures the game always has wars happening somewhere, creating demand for player involvement.

### Relations Score

- **Range**: -100 (hostile) to +100 (allied)
- Stored per faction pair
- Drifts per tick based on accumulated positive and negative modifiers

### Negative Relation Drivers

These push factions toward conflict. Most are persistent and cumulative — they stack and compound. A single driver drifts relations slowly; multiple drivers together accelerate toward war.

| Driver | Strength | Mechanic |
|---|---|---|
| Border friction | Scaling | Proportional to shared border length. Largest factions with the most neighbors naturally accumulate the most friction |
| Resource envy | Medium | Faction with weaker economy resents richer neighbor. Driven by GDP/production gap |
| Territory envy | Medium | Smaller faction looking at larger neighbor's territory. Scales with size disparity |
| Doctrine incompatibility | Persistent, low | Some doctrines inherently clash: expansionist vs protectionist, hegemonic vs anyone smaller. Constant background friction |
| Government opposition | Persistent, very low | Ideological friction between government types: federation vs authoritarian, cooperative vs corporate. Subtle but permanent |
| Historical grievance | Decaying | Lost territory in a previous war. Starts strong after a war ends, slowly fades over time but never fully disappears |
| Alliance with enemy | Reactive | "My enemy's friend is my enemy." Worsens automatically when a faction allies with your rival. Strength proportional to how hostile you are toward the rival |
| Player actions (hostile) | Aggregate | Mass smuggling in faction space, players supporting their enemies, hostile player activity. Aggregate of all player behavior |
| Trade competition | Situational | Two mercantile-doctrine factions competing for the same trade routes. Only applies to factions with overlapping economic interests |

**Example compound scenario**: The Kessari Dominion (expansionist, authoritarian) shares a long border with the Terran Sovereignty (protectionist, federation). They have: border friction (large shared border), doctrine incompatibility (expansionist vs protectionist), government opposition (authoritarian vs federation), and historical grievance (Kessari took 3 systems last war). Combined drift: heavily negative. War is coming fast.

### Positive Relation Drivers

These push factions toward cooperation. Generally weaker than negative drivers — peace takes more effort than conflict.

| Driver | Strength | Mechanic |
|---|---|---|
| Common enemy | Strong, reactive | "My enemy's enemy is my friend." Having a shared rival builds bonds fast. Strength proportional to how hostile both factions are toward the common enemy |
| Trade volume | Medium, cumulative | Factions that trade heavily with each other build mutual economic dependence. Disrupting trade hurts both sides, incentivizing peace |
| Distance | Passive | Factions far apart with no shared borders have little reason to fight. Relations drift toward neutral, not hostile |
| Doctrine compatibility | Persistent, low | Some doctrines align: mercantile factions understand each other, protectionist factions respect each other's borders |
| Active alliance | Maintenance | Formal alliance generates steady positive drift. But alliances cost something to maintain — see §2.1 |
| Post-war recovery | Slow | After a war ends, relations slowly crawl back from -100. Very slow — takes many real-time days to reach "unfriendly" |
| Player actions (friendly) | Aggregate | Players trading peacefully, completing cooperative missions, contributing to faction prosperity |

**Example compound scenario**: Two minor factions (Cluster archetype) are neighbors with no shared border with each other's enemies. They have: distance (no friction), doctrine compatibility (both protectionist), common enemy (both threatened by the Ashvari Hegemony), and high trade volume. Combined drift: strongly positive. Natural alliance candidates.

### Relations Thresholds

| Range | Status | Effects |
|---|---|---|
| +75 to +100 | Allied | Formal alliance active. Mutual defense pacts, shared trade bonuses, coordinate in wars |
| +25 to +74 | Friendly | Trade bonuses, no border tension, alliance possible |
| -24 to +24 | Neutral | Normal trade, slow background border tension from proximity |
| -74 to -25 | Unfriendly | Trade penalties, border skirmish events begin, tension escalates |
| -100 to -75 | Hostile | War declaration likely, trade embargoes, active border conflicts. War threshold |

### 2.1 Alliance Mechanics

Alliances are formal mutual defense pacts between factions. They provide real benefits but have constraints that prevent them from breaking the game.

#### Alliance Capacity (Inversely Scales with Size)

| Faction Status | Alliance Slots | Rationale |
|---|---|---|
| Minor | 3 | Survival through coalition. Multiple small factions can collectively resist a major power |
| Regional | 2 | Strategic partnerships. Room for meaningful choices about who to ally with |
| Major | 1 | One ally maximum. Must choose carefully — allying with one power alienates others |
| Dominant | 0 | Too large to formally ally. Lonely at the top. Must rely on own strength |

This creates natural balancing pressure: as a faction grows, it loses allies. Success makes you powerful but isolated. A cluster of allied minor factions can collectively match a major power, enabling the David vs Goliath stories.

#### Alliance Effects
- Mutual defense: if one ally is attacked, the other is expected to join as a co-defender (or break the alliance at reputation cost). See [war-system.md §11](./war-system.md) for co-defender contributions, exhaustion rates, and withdrawal conditions
- Shared trade bonuses between allied faction territories
- Positive relation drift while alliance is active

#### Alliance Conditions
- Alliances are not permanent. They can break if:
  - One ally attacks a faction the other is friendly with (forced choice: honor alliance or break it)
  - Relations between allies drop below +50 (alliance dissolves)
  - One ally refuses a mutual defense call (alliance dissolves, reputation penalty)
- Alliance formation requires relations at +60 or above

---

## 3. Player-Faction Reputation

Per-player, per-faction reputation score.

### Reputation Score

- **Range**: -100 to +100
- Earned through:
  - Trading at faction systems (small, passive)
  - Completing faction missions (medium)
  - Contributing to war efforts (large)
- Lost through:
  - Supporting enemy factions in wars
  - Trading contraband in faction space
  - Attacking faction ships (future tactical layer)

### Forced trade-offs

Supporting faction A in a war against faction B costs reputation with B. Players cannot be friends with everyone — they must pick sides. This creates factional identity and player communities.

A **neutral trader** path is viable but limited: tolerated everywhere, welcomed nowhere. No access to the best prices, exclusive missions, or faction facilities.

### Reputation Effects

| Range | Standing | Effects |
|---|---|---|
| +75 to +100 | Champion | Best prices, exclusive missions, political influence |
| +25 to +74 | Trusted | Good prices, faction missions available |
| -24 to +24 | Neutral | Standard prices, basic missions only |
| -74 to -25 | Distrusted | Price penalties, limited services |
| -100 to -75 | Hostile | Denied docking (future), actively hunted |

### Price Modifier Mechanism

Reputation affects trade prices as a **transaction multiplier** — it modifies what the player pays/receives, not the displayed market price. Market prices remain universal (driven by supply/demand), so all players see the same price information. Reputation is your personal competitive edge.

- **Buying**: `market_price × buy_modifier` — higher reputation = lower modifier = cheaper purchases
- **Selling**: `market_price × sell_modifier` — higher reputation = higher modifier = more profit

| Standing | Buy | Sell | Net effect |
|---|---|---|---|
| Champion | Discount | Premium | Best margins |
| Trusted | Small discount | Small premium | Good margins |
| Neutral | 1.0x | 1.0x | Standard |
| Distrusted | Penalty | Penalty | Worse margins |
| Hostile | Denied | Denied | Cannot trade |

Specific percentage values per tier are tuning numbers for implementation.

**Stacking with government modifiers**: Government modifiers (volatility, equilibrium, production rates) shape the *market itself* — what the price is. Reputation modifies the *transaction* — what you pay for that price. Different layers, naturally stack without conflict. A Champion trader at a Corporate system gets both the Corporate market characteristics and their personal reputation discount.

---

## 4. War and Conflict

Full war and conflict mechanics are covered in the dedicated **[War System](./war-system.md)** spec. Brief summary:

- **Border conflicts** (ambient): Event-system-driven tension at faction borders when relations are unfriendly (-25 to -74). Localized danger/trade disruption, no battles or player involvement. Accelerate relation deterioration toward war.
- **Faction wars** (interactive): Full wars with two dedicated processors — war processor (strategic: declarations, exhaustion, ceasefire) and battle processor (tactical: fleet battles, sieges). Two-stage conquest model: fleet battles establish space superiority, sieges capture systems. Assault capacity limits simultaneous sieges. Conquest limits prevent faction destruction in a single war.
- **Economy effects**: War modifiers feed into the existing economy processor — production penalties, war goods demand spikes, volatility increases. Attacker pays economy-wide; defender only on the front line.
- **Alliance in war**: Co-defenders contribute military output at reduced exhaustion cost. Can withdraw if overextended. See alliance mechanics §2.1 and [war-system.md §11](./war-system.md).

**Replaces**: The random War event in the current event catalog will be removed when the faction/war system is implemented. Border conflicts absorb its role as the source of war-themed economy/danger modifiers.

Relations (§2) drive both layers — negative drift pushes factions through border conflicts into full wars. Doctrine (§1) influences declaration thresholds and war behavior.

---

## 5. Homeworlds

Every faction has a homeworld — their capital system.

### Homeworld Properties

- **Heavily defended**: Requires sustained, overwhelming campaign to capture (not a single war)
- **Economic hub**: Production/trade bonuses for the faction
- **Unique facilities**: Faction-specific services only available at homeworld

### Homeworld Conquest

- Homeworld can only become contested after the faction has lost significant territory (e.g. below 50% of peak)
- Capturing a homeworld requires winning a war decisively, not just border skirmishes
- If homeworld falls:
  - Faction does NOT die
  - Drops to minor status ("faction in exile")
  - Picks new capital from remaining territory
  - Gains significant defensive bonuses (cornered animal effect)
  - Can attempt to reclaim homeworld in future wars
- A faction is only truly destroyed if it loses ALL territory
  - Even then, rebel events could attempt to resurrect it (future expansion)

### Starting Position

With factions controlling all territory, new players spawn in faction space. The specifics (whether players choose a starting faction, start neutral in a default faction's territory, or are assigned randomly) are implementation decisions. Starting location may grant a small initial reputation bonus with the local faction.

**Replaces**: Current spawn at core-economy system in trade hub region (universe.md).

---

## 6. Initial Faction Roster

Starting roster of 6 major factions. This is the launch set — the system is built to support many more factions added over time. Minor factions TBD (see §Open Questions).

| Faction | Government | Doctrine | Personality |
|---|---|---|---|
| Terran Sovereignty | Federation | Protectionist | Democratic superpower. Strong economy, overwhelming defensive response. "Don't tread on us" |
| Kessari Dominion | Authoritarian | Expansionist | Military empire. Always pushing borders, always looking for a reason. Aggressive but overextends |
| Meridian Compact | Corporate | Mercantile | Trade confederation. Richest faction. Fights with economics first, military second. Funds proxy wars |
| Ashvari Hegemony | Authoritarian | Hegemonic | Ancient empire. Demands tribute and submission from smaller neighbors. Leaves equals alone — unless provoked |
| Free Reaches | Frontier | Opportunistic | Loose alliance of frontier systems. Strikes when others are distracted. Unpredictable and hard to pin down |
| Solari Collective | Federation | Expansionist | Idealist democracy that believes in "liberating" other systems. Good intentions, aggressive methods. Creates interesting moral tension |

### Natural Rivalries (Starting Relations)

These emerge from doctrine + geography. Not exhaustive — just the obvious conflicts at game start:

- **Kessari Dominion vs Terran Sovereignty**: The classic axis. Expansionist vs protectionist, authoritarian vs democratic. Guaranteed early conflict.
- **Ashvari Hegemony vs minor factions**: The hegemony pressures smaller neighbors. Players aligned with minor factions naturally oppose them.
- **Solari Collective vs Ashvari Hegemony**: Two expansionist-adjacent factions with opposing ideologies (liberation vs subjugation).
- **Free Reaches vs everyone**: Opportunistic doctrine means they have no permanent allies, just targets of convenience.
- **Meridian Compact**: The wildcard. They trade with everyone and fund whoever serves their interests. Kingmaker faction.

All factions, rivalries, lore, and names are provisional. The roster will grow as the game scales.

### 7.1 Minor Factions

12–18 minor factions at game start. They use the same doctrine pool as major factions — doctrine behavior scales with territory size, not faction category. An expansionist minor is a regional nuisance; an expansionist major is a galactic threat.

**Starting size**: 5–30 systems each. No minor starts below 5 (enough to survive one bad war).

#### Placement Archetypes

Minor factions are distributed across four archetypes based on their position relative to major factions. The map seed must enforce these constraints.

| Archetype | Count | Position | Gameplay role |
|---|---|---|---|
| Buffer state | 4–6 | Between exactly 2 major factions | Politically interesting. Courted or threatened by both neighbors. Survives by playing sides |
| Frontier independent | 4–6 | Map edges, beyond major faction reach | Growth story. Unclaimed space to expand into. Safe but isolated early on |
| Enclave | 2–4 | Within/adjacent to a single major faction | At risk of absorption. Hegemonic factions pressure these first |
| Cluster | 2–3 near each other | Shared region, collectively resistant | Weak individually, strong together. Natural target for player-driven alliances |

**Seed constraints**:
- No minor faction borders more than 2 major factions
- Every minor has systems not directly adjacent to a major faction's border
- Frontier minors have unclaimed space on at least one side

#### Faction Spawning (Rare Events)

New factions can emerge from events during gameplay. Very rare — most games will see only a handful of new factions over their lifetime.

**Hard cap**: ~30–40 total factions. Once reached, no new factions spawn.

**Spawn triggers** (all event-driven):
- **Secession**: A major faction that overextends or loses badly — outlying systems break away
- **Rebellion**: Systems under hostile occupation (recently conquered) revolt and form a new faction
- **Colonial independence**: Frontier systems settled by a major faction drift away culturally

New factions always spawn as minor. They inherit some traits from their parent faction but develop their own doctrine and identity.

---

## 7. System Scale

### Target: 1,000-2,000 systems

Based on faction count and territory needs:
- 6-8 major factions × 80-150 systems each
- 15-20 minor factions × 5-30 systems each
- Neutral/contested border zones
- Unclaimed frontier space

### Map Structure

- Region-based map rendering (never show all systems at once)
- Region map as default view, click into region for system-level view
- Regions may align with faction territories or cross borders (border regions are the interesting ones)

---

## Related Design Docs

These topics are large enough to warrant their own design documents:
- **[War System](./war-system.md)** — border conflicts, faction wars, battles, territory control, player involvement
- **[Player Progression](./player-progression.md)** — ship upgrades, region unlocking, credit sinks, early/mid/late game arc
- **[System Enrichment](./system-enrichment.md)** — facilities, system traits, strategic value
- **[Multiplayer Infrastructure](./multiplayer-infrastructure.md)** — player trading, alliances, communication, coordination
