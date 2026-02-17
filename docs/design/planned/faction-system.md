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
| homeworld | system_id | Capital system. Very hard to capture (see §5) |
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

### Doctrine Types

Doctrine defines how a faction behaves toward other factions. Each faction has one primary doctrine.

**Key design rule**: All factions are warlike. The aggression spread between doctrines is narrow — the difference is what *triggers* conflict and how they fight, not whether they fight. Even the most defensive doctrine will wage war under the right conditions. War exhaustion and attacker cost asymmetry (see §4) keep aggressive doctrines from steamrolling reactive ones.

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

Specific economic modifiers per type (volatility, production rates, equilibrium targets, danger) to be defined during implementation. Current modifiers for federation/corporate/authoritarian/frontier are a starting point.

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
- Mutual defense: if one ally is attacked, the other is expected to join (or break the alliance at reputation cost)
- Shared trade bonuses between allied faction territories
- Positive relation drift while alliance is active
- Coordinated war efforts: allied factions share war exhaustion burden

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

---

## 4. War System

Wars are the primary driver of political change. Multiple simultaneous wars are possible. The system is designed so wars are common but costly — always happening somewhere in the galaxy, creating persistent demand for player involvement.

### War Model

| Property | Type | Description |
|---|---|---|
| attacker | faction_id | Faction that declared war |
| defender | faction_id | Faction being attacked |
| attackerExhaustion | 0-100 | War weariness of attacking side |
| defenderExhaustion | 0-100 | War weariness of defending side |
| status | enum | active / ceasefire / resolved |
| contested | [system_ids] | Systems actively being fought over |
| playerContributions | per-player totals | Track who supported which side |

### 4.1 War Declaration — What Starts Wars

Wars are triggered by a combination of relation thresholds, events, and faction behavior. They don't happen randomly — they build from visible tension that players can see coming.

#### Prerequisites for War Declaration
1. **Relations at -75 or below** (hostile threshold)
2. **Power ratio check**: The declaring faction must pass a size-based inhibition check (see below)
3. **No active ceasefire** between the two factions (cooldown period after previous war)
4. **Doctrine modifier**: Expansionist factions declare slightly earlier (at -70), protectionist factions later (at -85)

#### Size-Based War Inhibition

Factions assess relative power before declaring war. This prevents suicidal declarations by small factions and creates space for alliances to matter.

| Power ratio (declarer vs target) | Declaration likelihood |
|---|---|
| 3:1+ disadvantage | Will not declare under any circumstances |
| 2:1 disadvantage | Extremely unlikely. Only at rock-bottom relations AND with allied support |
| Roughly equal (0.5:1 to 2:1) | Normal probability based on relations + doctrine |
| 2:1 advantage | More likely, especially for expansionist/hegemonic doctrines |
| 3:1+ advantage | Very likely if relations are hostile. The larger faction barely notices the cost |

**Important**: This only gates *offensive* declarations. A faction of any size always defends itself. Allied factions called into a defensive war ignore the power ratio — they honor the pact regardless.

**Effective power includes allies**: A minor faction with two minor allies may collectively match a major power, making the effective ratio closer to equal. This makes alliances a genuine deterrent.

#### Escalation Path
```
Normal relations → Negative drift accumulates → Unfriendly (-25) →
Border skirmish events begin → Hostile (-75) → War declaration possible →
Declaration event fires → Active war
```

Players can see this escalation happening and prepare — repositioning ships, stockpiling war goods, choosing which side to support.

### 4.2 Attacker Cost Asymmetry

Declaring war is a calculated gamble. The aggressor pays more across every dimension, making failed offensives pure loss and deterring frivolous declarations.

| Mechanic | Attacker | Defender |
|---|---|---|
| War exhaustion rate | **1.5x** base rate | 1.0x base rate |
| Economy penalty | Production penalty across **ALL** systems (mobilization cost) | Only border/contested systems disrupted |
| Resource drain | Continuous credit drain per tick to maintain offensive operations | Minimal — defending home territory is cheaper |
| Failed war consequence | If attacker exhaustion hits 100 first: forced ceasefire, **no territorial gains**, all costs wasted | "Winning" by not losing. Territory intact, economy recovers |
| Market disruption | Moderate disruption in all systems (war footing) | Disruption only in contested/border systems |

**Strategic implication**: Declaring war costs you even if you win. You'd better gain enough territory to offset the economic damage. This naturally limits war frequency — even expansionist factions need recovery periods between wars.

**Doctrine interaction**: Protectionist factions make this asymmetry worse for attackers. Their defensive bonuses mean the attacker's exhaustion climbs even faster, and contested systems are harder to flip. Attacking a protectionist faction is expensive; attacking a protectionist faction and failing is devastating.

### 4.3 War Duration

Wars are persistent features of the game landscape, not quick skirmishes. Players engage with them over multiple play sessions.

| War type | Approximate real-time duration | Scope |
|---|---|---|
| Border skirmish (pre-war) | 1-3 days | 1-3 border systems. No formal war, just localized events and tension |
| Small war | 1-2 weeks | A few systems contested. Limited stakes, between smaller factions or limited objectives |
| Major war | 2-4 weeks | Significant territory at stake. Multiple contested systems, full economic mobilization |
| Existential war (homeworld threatened) | 1 month+ | Highest stakes. Both sides fully committed. Only happens when a faction is already weakened |

Duration is driven by war exhaustion accumulation rate, which scales with:
- War intensity (how many systems are contested)
- Economic cost (larger factions can sustain longer wars)
- Multi-front penalty (fighting on two fronts = both wars last longer but drain more)
- Attacker/defender asymmetry (attackers exhaust faster)

**Note**: These durations assume production tick rates. Development tick rates are much faster — wars will appear shorter during testing.

### 4.4 War Lifecycle

```
Tension → Declaration → Active War → Exhaustion → Resolution → Consequences
```

1. **Tension phase**: Relations deteriorate through accumulated negative drivers (see §2). Border skirmish events fire when relations hit -25. Players see increasing tension on the political map and in event feeds. This phase can last days.

2. **Declaration**: When relations hit the hostile threshold and doctrine/power checks pass, a war declaration event fires. This is a galaxy-wide notification — everyone knows war has started. Markets in the region immediately react (price spikes on war-relevant goods).

3. **Active war**: Border systems become contested. War exhaustion climbs per tick for both sides (1.5x for attacker). Contested systems have disrupted markets, increased danger, and war-specific events. Players contribute through tiered involvement system (see §4.7). Faction economy takes hits proportional to war intensity.

4. **Exhaustion climax**: As exhaustion climbs past 75, the losing side starts seeking peace. Events signal war weariness. If one side hits 100 exhaustion, the war ends automatically.

5. **Resolution**: War ends via exhaustion cap or mutual ceasefire. Outcomes:
   - **Attacker wins** (defender exhaustion hits 100 first): Attacker gains contested systems. Defender's economy takes a significant hit.
   - **Defender wins** (attacker exhaustion hits 100 first): No territory changes. Attacker wasted resources.
   - **Mutual ceasefire** (negotiated before either hits 100): Partial territory transfer possible, or status quo ante.

6. **Consequences**:
   - Territory transfers executed
   - Relations reset to -50 (unfriendly, not hostile — cooling off period)
   - Ceasefire period: no new war between these factions for a set duration
   - Historical grievance modifier added (losing side remembers)
   - Players who contributed to winning side get large reputation and credit rewards
   - Players who contributed to losing side get smaller consolation rewards (effort acknowledged)

### 4.5 Multi-Front Wars

A faction's economic/military output is finite per tick. When fighting multiple wars, this output is divided across all active fronts.

- Each individual war progresses more slowly (less resources committed per front)
- War exhaustion still climbs in each war independently
- The faction is economically strained across all territories (not just border systems)
- Creates strategic opportunities: opportunistic factions can declare war on a faction already fighting elsewhere, knowing they're stretched thin
- Allied factions sharing a war effort partially offset this penalty (shared exhaustion burden)

**Example**: The Kessari Dominion declares war on the Terran Sovereignty. While engaged, the Free Reaches (opportunistic doctrine) sees the Kessari fighting on one front and declares war on their exposed southern border. Now the Kessari are fighting two wars with the same economic output — each front gets half the resources, exhaustion climbs in both, and they're vulnerable to collapse on either front. This is exactly the kind of emergent strategic drama the system should produce.

### 4.6 Border Conflicts (Ambient)

Smaller than full wars. These are the background texture of faction politics — always simmering at borders, occasionally flaring up.

- Trigger when relations are in the unfriendly range (-25 to -74)
- Localized to 1-3 border systems
- Disrupt trade, create danger events, increase navigation risk
- Can accelerate relation deterioration (pushing toward war threshold)
- Don't involve formal war exhaustion tracking
- Tie directly into existing event system
- Resolve on their own if relations improve, or escalate into full wars if they worsen

### 4.7 War Contributions (Player-Facing)

Players choose how involved they get in wars. The system is tiered — consequences scale with involvement. A trader quietly selling goods to their faction's war depot is fundamentally different from a saboteur behind enemy lines.

**Design principle**: Reputation loss with the enemy faction only comes from direct hostile actions. Routine economic support is "doing what's expected" and doesn't mark you as a target. This mirrors Mount & Blade where fighting in battles is normal but raiding villages is a choice with consequences.

#### Tier 1 — Economic Support (Safe)

Standard trade activity directed toward the war effort. Low risk, moderate reward.

- **Supply war goods**: Deliver weapons, materials, fuel, food to faction war depots at contested or staging systems
- **Donate credits**: Direct credit contribution to the faction war fund
- **War logistics missions**: Supply run missions to contested systems (similar to existing trade missions, but war-themed with bonus rewards)
- **Enemy reputation impact**: **None.** You're a trader doing trade. The enemy faction doesn't know or care that your grain fed soldiers. No tracking, no consequences.
- **Rewards**: Moderate faction reputation gains. Credit bonuses on war logistics missions. Contribution tracked for end-of-war rewards.

#### Tier 2 — Strategic Support (Moderate Risk)

Activities that push beyond normal trade. There's a chance of detection and consequences.

- **Blockade running**: Smuggle supplies through contested space to besieged systems. Higher danger, better pay.
- **Intelligence gathering**: Trade at enemy systems and report back (prices, supply levels, fleet movements). Information gives your faction strategic advantages.
- **Supply line disruption**: Redirect trade away from enemy systems, creating artificial shortages.
- **Enemy reputation impact**: **Small penalty if discovered.** Each action has a percentage chance of detection. If caught, you're flagged as a hostile agent — reputation hit with enemy faction. Discovery chance increases with frequency.
- **Rewards**: Good faction reputation gains. Premium credit rewards. Strategic impact on the war (your intelligence could shift contested system outcomes).

#### Tier 3 — Direct Action (High Risk, High Reward)

Overt hostile actions against the enemy faction. Guaranteed consequences, biggest payoffs.

- **Sabotage missions**: Disrupt enemy infrastructure — disable a refinery, damage supply depots, degrade system defenses.
- **Espionage**: Steal strategic information that gives your faction a measurable combat advantage in contested systems.
- **Resistance support**: Smuggle weapons to resistance movements in enemy-occupied territory (especially recently conquered systems).
- **Enemy reputation impact**: **Guaranteed and significant.** You are actively harming them. They know. They won't forget. Large reputation penalty per action.
- **Rewards**: Major faction reputation gains. Large credit rewards. Significant strategic impact on war outcomes. End-of-war bonus rewards for top contributors.

#### War Profiteering

Players *can* supply war goods to both sides of a conflict (Tier 1 only). This is a valid but risky playstyle.

- Selling to both sides is profitable — war goods are in high demand everywhere during conflict
- If a faction discovers you're supplying their enemy, **large reputation hit with both sides** — neither trusts a double-dealer
- Discovery chance increases with the volume sold to both sides
- Creates the "arms dealer" archetype: high profit, high risk of being blacklisted by everyone
- Tier 2 and Tier 3 actions for both sides simultaneously would be extremely risky — discovery on either side reveals you as a double agent

#### End-of-War Rewards

When a war resolves, players who contributed receive rewards based on their total contribution and which side won:

- **Winning side contributors**: Large reputation bonus with the winning faction. Credit payout proportional to contribution. Access to exclusive post-war missions/contracts. Priority access to facilities in newly conquered territory.
- **Losing side contributors**: Smaller consolation reputation bonus (effort acknowledged — the faction remembers who stood with them). Reduced credit payout. No territory benefits.
- **Contribution ranking**: Top contributors on the winning side could receive special recognition — titles, exclusive faction access, named in the war's history.

### 4.8 Player Assets in Conquered Territory

When a system changes faction control, player-owned assets in that system (mining colonies, trade posts, facilities — future mechanics) are handled based on the player's reputation with the conquering faction.

**Design principle**: Players shouldn't needlessly lose assets because of events outside their control. Consequences are proportional to involvement — a neutral trader keeps their business; an active saboteur gets seized.

| Player's rep with conqueror | Consequence |
|---|---|
| Positive (+1 and above) | **Assets safe.** Transition tax (small one-time fee). Business as usual under new management |
| Neutral (0 to -24) | **Assets safe with fine.** Moderate one-time fine to retain ownership. Pay or lose |
| Unfriendly (-25 to -74) | **Assets at risk.** Significant fine to keep them. Failure to pay = seizure |
| Hostile (-75 to -100) | **Assets seized.** No option to pay. You chose a side and lost |
| Active enemy support (Tier 3 actions during the war) | **Assets seized regardless of reputation score.** You were a combatant, not a bystander |

**Strategic implications**:
- Players with assets in border regions have a personal stake in the outcome of nearby wars
- Maintaining neutral reputation with multiple factions protects your assets but limits your war rewards
- Going all-in on Tier 3 support is a gamble — huge payoff if your side wins, lose everything in that territory if they don't
- Players can hedge by keeping high rep with potential conquerors (trade at their systems, complete their missions) even while supporting the other side through Tier 1 (which doesn't impact enemy rep)

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

---

## 6. Territory Mechanics

How systems change hands during wars. Territory control is the tangible outcome of the war system — the thing that reshapes the map and gives wars lasting consequences.

### 6.1 System Control Score

Each contested system has a control score representing the ongoing struggle for dominance.

- **Range**: 0 to 100 (0 = fully defender-held, 100 = captured by attacker)
- Starts at 0 when a system becomes contested at the start of a war
- Shifts based on **battle outcomes** over time
- At 100: system ownership transfers to the attacker
- If a war ends (ceasefire/exhaustion) with score between 0-99: system remains with the defender. Partial progress is lost — you either take a system or you don't.

Only border systems (systems adjacent to enemy territory) can become contested. Deep strikes into core territory are not possible — you have to push the front line system by system. This means geography matters: chokepoint systems are strategically vital, wide-open borders are hard to defend.

### 6.2 Battle System

Battles are the mechanism that shifts control scores. They happen inside contested systems and play out over multiple ticks as a sequence of rounds.

#### Battle Structure

- A battle consists of **7 rounds** (first to 4 wins)
- Each round resolves over **1 tick**
- So a battle takes ~7 ticks minimum (4-0 sweep) to ~7 ticks maximum
- After a battle resolves, a **cooldown of a few ticks** before the next battle starts in that system
- Multiple contested systems can have battles running simultaneously, but each system only runs one battle at a time

#### Round Resolution

Each round is a **weighted random roll** for both sides. The side with the higher roll wins the round.

| Factor | Effect | Source |
|---|---|---|
| Fleet strength | Base combat power for the roll | Faction military output per tick + player-contributed combat ships (future) |
| Weapon quality | Modifier to combat effectiveness | Player-contributed war goods (weapons, munitions, special equipment) |
| Defensive bonus | Flat bonus for the defending side | Inherent advantage — defending home territory is always easier. Stacks with protectionist doctrine bonus |
| Intelligence | Modifier that shifts odds | From Tier 2 player espionage (§4.7). Better intel = better positioning |
| General stratagem | Low chance of very high buff (see §6.3) | Generals trained via credit contributions |
| Randomness | Core uncertainty factor | Every round has a meaningful random element. Even 70/30 odds can go either way |

#### Battle Outcome → Control Score

- **Battle win**: Control score shifts toward the winner (attacker wins → score increases, defender wins → score decreases back toward 0)
- **Decisive victory** (4-0, 4-1): Larger control score shift
- **Close victory** (4-3): Smaller control score shift
- This means a string of close wins moves the needle slowly, while dominant victories accelerate capture

#### Viewable Battle State

Battles are visible to all players on an info screen:
- Current round number and score (e.g. "Round 5 of 7 — Attacker leads 3-1")
- Resources committed by each side (aggregate, not individual player contributions)
- Control score progress for the system
- Recent battle history for the system

This creates spectator drama — players check in to see how the front line is shifting, whether their contributions are making a difference, and whether an underdog is pulling off an upset.

### 6.3 Generals and the Stratagem Mechanic

Generals don't just provide a flat tactical bonus — they introduce a **low-probability, high-impact "brilliant stratagem"** that can swing individual rounds.

#### How It Works

- Each round, there is a small percentage chance that a side's general executes a brilliant stratagem
- If triggered: **large one-time bonus** to that round's roll, potentially flipping a round the side would otherwise lose
- The stratagem chance is **weighted by power disparity**: the more outnumbered a faction is, the higher the chance

#### Why Asymmetric Weighting Works

| Scenario | Stratagem impact |
|---|---|
| Dominant faction gets stratagem | Marginal — they were already likely to win the round. Overkill |
| Underdog faction gets stratagem | Potentially decisive — flips a round they'd otherwise lose. Could turn a 1-4 into a 4-3 |

**Design rationale**: This is the "cornered animal" effect expressed mechanically. A 3-system faction fighting for survival isn't just fighting harder — they're **thinking harder**. Desperation breeds tactical innovation. A sprawling empire has bureaucracy, complacency, and internal politics diluting their focus. The underdog has nothing to lose and every reason to try something bold.

#### Weighting Factors

- **Power disparity**: The larger the size difference between factions, the higher the stratagem chance for the smaller side. A minor faction fighting a dominant power has the highest chance of tactical brilliance.
- **General quality**: Better generals (funded by more credit contributions) have a higher base stratagem chance regardless of faction size.
- **Faction status**: Minor factions get an inherent stratagem bonus (part of their defensive advantages from §1).

This means generals are always valuable, but they're *disproportionately* valuable for smaller factions. A minor faction that invests heavily in generals can punch well above their weight in individual battles, even if they lose the war overall through attrition.

### 6.4 Contribution and Diminishing Returns

Player contributions to war efforts use **diminishing returns** rather than hard caps. This rewards coalition play over individual wealth.

- First N credits/goods of contribution have **full impact** on battle modifiers
- Beyond that threshold, each additional unit has **progressively less effect**
- A player contributing 10x what a regular player does gets roughly 3-4x the impact, not 10x
- **Five regular players coordinating** outperform one whale at the same total spend

This achieves two goals:
1. **Whales can still make a difference** — their extra contribution matters, it's just not linear. The risk of overcommitting is real (lose big if your side loses).
2. **Coordination is king** — the optimal strategy is many players contributing moderate amounts. This drives the multiplayer cooperation that makes the game social.

### 6.5 System Capture and Aftermath

When a system's control score reaches 100:

1. **Ownership transfers** to the attacking faction immediately
2. **Market disruption**: Prices spike, supply/demand is chaotic for several ticks as the new faction's economy type takes effect
3. **Player assets**: Handled per §4.8 (reputation-based consequences)
4. **New border**: The front line shifts. Previously safe systems may now be border systems and eligible for future contestation
5. **Historical record**: The system's capture is logged. If the original faction reclaims it later, the "liberation" event generates positive reputation with that faction
6. **Defensive transition**: Newly captured systems are harder for the original owner to retake immediately (the new occupier has had time to establish control) — but historical grievance ensures they'll try eventually

---

## 7. Initial Faction Roster

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

## 8. System Scale

### Target: 1,000-2,000 systems

Based on faction count and territory needs:
- 6-8 major factions × 80-150 systems each
- 15-20 minor factions × 5-30 systems each
- Neutral/contested border zones
- Unclaimed frontier space

### Map Structure

- Region-based map rendering (never show all systems at once)
- Region map as default view, click into region for system-level view
- React Flow handles region-level and system-level views separately
- Regions may align with faction territories or cross borders (border regions are the interesting ones)

---

## Open Questions

These need to be resolved before implementation. Working through them in discussion.

### Resolved
- **Major/minor status**: Derived from territory count, not a stored flag. Tiered with hysteresis (see §1).
- **Faction identity**: Named, hand-crafted entities. Government = economic axis, doctrine = political axis. Fully independent.
- **Aggression balance**: All factions are warlike. Narrow spread between most and least aggressive. War exhaustion + attacker cost asymmetry prevents steamrolling.
- **Initial roster**: 6 major factions (see §6). System built to scale to 15+.
- **System count**: 1,000–2,000 at launch, architecture supports 5,000+.
- **Homeworlds**: Hard to take, faction survives as exile if lost, only truly destroyed at 0 territory.

- **Minor factions**: 12–18 at start, same doctrine pool as majors, distributed across placement archetypes (see §7.1). Spawning via rare events, hard cap ~30–40 total factions.
- **Government types**: Expanded from 4 to 8 (see §1). Strictly economic/internal. Every type has trade-offs — buffs balanced by debuffs. Specific modifiers defined during implementation.
- **War lifecycle**: Threshold + event driven. Relations drift negative → border skirmishes at -25 → war declaration at -75 (doctrine-adjusted). Size-based inhibition prevents suicidal declarations. Attacker asymmetry: 1.5x exhaustion rate, economy-wide penalty, resource drain. Duration: days to weeks depending on scale. Full details in §4.
- **Alliance mechanics**: Capacity inversely scales with faction size (minor=3, dominant=0). Mutual defense pacts, shared trade bonuses, alliance conditions and dissolution rules. See §2.1.
- **Relation drivers**: Comprehensive positive/negative driver system with stacking and compound effects. Conflict is the default; peace requires active maintenance. See §2.
- **War contributions**: Three-tiered involvement system (economic/strategic/direct action). Reputation consequences scale with involvement — Tier 1 is invisible to the enemy, Tier 3 guarantees hostility. War profiteering possible but risky. See §4.7.
- **Player assets in conquered territory**: Consequences scale with reputation toward conqueror. Neutral/positive = safe (small tax). Hostile or active combatant = seized. See §4.8.
- **Territory mechanics**: Control score (0-100) per contested system, shifted by multi-round battles. Best-of-7 rounds over ticks with weighted random rolls. Generals provide asymmetric "stratagem" crits favoring underdogs. Diminishing returns on contributions reward coordination over whale spending. Border-only contestation — must push the front line system by system. See §6.

### Separate Design Docs
These topics are large enough to warrant their own design documents:
- **[Player Progression](./player-progression.md)** — ship upgrades, region unlocking, credit sinks, early/mid/late game arc
- **[System Enrichment](./system-enrichment.md)** — facilities, system traits, strategic value
- **[Multiplayer Infrastructure](./multiplayer-infrastructure.md)** — player trading, alliances, communication, coordination
