# War System Design

Wars and territorial conflict between factions. This covers two distinct layers: **ambient border conflicts** (event-system-driven tension at faction borders) and **interactive faction wars** (full wars with player involvement, battle mechanics, and territory capture).

**Replaces**: The random War event in the current event catalog (`lib/constants/events.ts`) will be removed when this system is implemented. Border conflicts absorb its role as the source of war-themed economy/danger modifiers.

**Needs further discussion**: This spec is extracted from the faction system doc and captures the high-level design. Several areas need deeper design work before implementation — battle resolution tuning, player contribution mechanics, tick processor design, and the interaction between war effects and the existing economy/danger pipelines. These are called out inline.

---

## 1. Two Layers of Conflict

The war system has two fundamentally different layers that share thematic space but operate through different mechanics.

### Ambient Layer — Border Conflicts

Small-scale tension at faction borders. These use the **existing event system** — they are events with economy modifiers, danger increases, and phase progressions, just like plagues or pirate raids.

- Trigger when inter-faction relations are in the unfriendly range (-25 to -74)
- Localized to 1-3 border systems
- Disrupt trade, increase danger, apply economy modifiers (similar to current War event phases)
- Accelerate relation deterioration (pushing toward war threshold)
- No formal war exhaustion, no battles, no territory changes
- No direct player involvement beyond being affected by the modifiers
- Resolve on their own if relations improve, or escalate into full wars if they worsen
- Implemented as event definitions in the event system — the faction tick processors spawn them based on relation state, not random rolls

### Interactive Layer — Faction Wars

Full-scale wars between factions. These are **not** events — they operate through dedicated war processors with their own lifecycle, battle mechanics, and player participation systems.

- Triggered by relation thresholds + doctrine/power checks (see §2)
- Affect entire faction territories (attacker mobilization cost, defender border disruption)
- Players actively participate: donating ships, credits, manpower; running war logistics; espionage; sabotage
- Battle mechanics resolve over time in contested systems (see §5)
- Territory changes hands based on battle outcomes (see §5)
- War exhaustion tracks the cost of sustained conflict
- Galaxy-wide visibility — all players see active wars, battle progress, front line shifts

**Key distinction**: Border conflicts are things that happen *to* players (your trade route just got more dangerous). Faction wars are things players participate *in* (you chose to supply the Terran war effort and it tipped a battle).

---

## 2. War Declaration — What Starts Wars

Wars are triggered by a combination of relation thresholds, events, and faction behavior. They don't happen randomly — they build from visible tension that players can see coming.

### Prerequisites for War Declaration
1. **Relations at -75 or below** (hostile threshold)
2. **Power ratio check**: The declaring faction must pass a size-based inhibition check (see below)
3. **No active ceasefire** between the two factions (cooldown period after previous war)
4. **Doctrine modifier**: Expansionist factions declare slightly earlier (at -70), protectionist factions later (at -85)

### Size-Based War Inhibition

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

### Escalation Path
```
Normal relations → Negative drift accumulates → Unfriendly (-25) →
Border conflict events begin → Hostile (-75) → War declaration possible →
Declaration event fires → Active war
```

Players can see this escalation happening and prepare — repositioning ships, stockpiling war goods, choosing which side to support.

---

## 3. Attacker Cost Asymmetry

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

---

## 4. War Lifecycle

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

### Phases

```
Tension → Declaration → Active War → Exhaustion → Resolution → Consequences
```

1. **Tension phase**: Relations deteriorate through accumulated negative drivers (see faction-system.md §2). Border conflict events fire when relations hit -25. Players see increasing tension on the political map and in event feeds. This phase can last days.

2. **Declaration**: When relations hit the hostile threshold and doctrine/power checks pass, a war declaration event fires. This is a galaxy-wide notification — everyone knows war has started. Markets in the region immediately react (price spikes on war-relevant goods).

3. **Active war**: Border systems become contested. War exhaustion climbs per tick for both sides (1.5x for attacker). Contested systems have disrupted markets, increased danger, and war-specific events. Players contribute through tiered involvement system (see §6). Faction economy takes hits proportional to war intensity.

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

### War Duration

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

### Multi-Front Wars

A faction's economic/military output is finite per tick. When fighting multiple wars, this output is divided across all active fronts.

- Each individual war progresses more slowly (less resources committed per front)
- War exhaustion still climbs in each war independently
- The faction is economically strained across all territories (not just border systems)
- Creates strategic opportunities: opportunistic factions can declare war on a faction already fighting elsewhere, knowing they're stretched thin
- Allied factions sharing a war effort partially offset this penalty (shared exhaustion burden)

**Example**: The Kessari Dominion declares war on the Terran Sovereignty. While engaged, the Free Reaches (opportunistic doctrine) sees the Kessari fighting on one front and declares war on their exposed southern border. Now the Kessari are fighting two wars with the same economic output — each front gets half the resources, exhaustion climbs in both, and they're vulnerable to collapse on either front. This is exactly the kind of emergent strategic drama the system should produce.

---

## 5. Territory and Battles

How systems change hands during wars. Territory control is the tangible outcome of the war system — the thing that reshapes the map and gives wars lasting consequences.

### 5.1 System Control Score

Each contested system has a control score representing the ongoing struggle for dominance.

- **Range**: 0 to 100 (0 = fully defender-held, 100 = captured by attacker)
- Starts at 0 when a system becomes contested at the start of a war
- Shifts based on **battle outcomes** over time
- At 100: system ownership transfers to the attacker
- If a war ends (ceasefire/exhaustion) with score between 0-99: system remains with the defender. Partial progress is lost — you either take a system or you don't.

Only border systems (systems adjacent to enemy territory) can become contested. Deep strikes into core territory are not possible — you have to push the front line system by system. This means geography matters: chokepoint systems are strategically vital, wide-open borders are hard to defend.

### 5.2 Battle System

Battles are the mechanism that shifts control scores. They happen inside contested systems and play out over multiple ticks as a sequence of rounds.

> **Needs further discussion**: Battle resolution mechanics (round structure, factor weighting, randomness tuning) need detailed design and simulation before implementation. The structure below is directional.

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
| Intelligence | Modifier that shifts odds | From Tier 2 player espionage (§6). Better intel = better positioning |
| General stratagem | Low chance of very high buff (see §5.3) | Generals trained via credit contributions |
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

### 5.3 Generals and the Stratagem Mechanic

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
- **Faction status**: Minor factions get an inherent stratagem bonus (part of their defensive advantages from faction-system.md §1).

This means generals are always valuable, but they're *disproportionately* valuable for smaller factions. A minor faction that invests heavily in generals can punch well above their weight in individual battles, even if they lose the war overall through attrition.

### 5.4 Contribution and Diminishing Returns

Player contributions to war efforts use **diminishing returns** rather than hard caps. This rewards coalition play over individual wealth.

- First N credits/goods of contribution have **full impact** on battle modifiers
- Beyond that threshold, each additional unit has **progressively less effect**
- A player contributing 10x what a regular player does gets roughly 3-4x the impact, not 10x
- **Five regular players coordinating** outperform one whale at the same total spend

This achieves two goals:
1. **Whales can still make a difference** — their extra contribution matters, it's just not linear. The risk of overcommitting is real (lose big if your side loses).
2. **Coordination is king** — the optimal strategy is many players contributing moderate amounts. This drives the multiplayer cooperation that makes the game social.

### 5.5 System Capture and Aftermath

When a system's control score reaches 100:

1. **Ownership transfers** to the attacking faction immediately
2. **Market disruption**: Prices spike, supply/demand is chaotic for several ticks as the new faction's economy type takes effect
3. **Player assets**: Handled per §7 (reputation-based consequences)
4. **New border**: The front line shifts. Previously safe systems may now be border systems and eligible for future contestation
5. **Historical record**: The system's capture is logged. If the original faction reclaims it later, the "liberation" event generates positive reputation with that faction
6. **Defensive transition**: Newly captured systems are harder for the original owner to retake immediately (the new occupier has had time to establish control) — but historical grievance ensures they'll try eventually

---

## 6. Player Involvement

> **Needs further discussion**: The tier system below is directional. Specific mechanics for ship donation, manpower contribution, and how player actions translate to battle modifiers need detailed design. War-related mission types (logistics, intelligence, sabotage) are defined in [missions.md](./missions.md).

Players choose how involved they get in wars. The system is tiered — consequences scale with involvement. A trader quietly selling goods to their faction's war depot is fundamentally different from a saboteur behind enemy lines.

**Design principle**: Reputation loss with the enemy faction only comes from direct hostile actions. Routine economic support is "doing what's expected" and doesn't mark you as a target. This mirrors Mount & Blade where fighting in battles is normal but raiding villages is a choice with consequences.

### Tier 1 — Economic Support (Safe)

Standard trade activity directed toward the war effort. Low risk, moderate reward.

- **Supply war goods**: Deliver weapons, materials, fuel, food to faction war depots at contested or staging systems
- **Donate credits**: Direct credit contribution to the faction war fund
- **War logistics missions**: Supply run missions to contested systems (similar to existing trade missions, but war-themed with bonus rewards)
- **Enemy reputation impact**: **None.** You're a trader doing trade. The enemy faction doesn't know or care that your grain fed soldiers. No tracking, no consequences.
- **Rewards**: Moderate faction reputation gains. Credit bonuses on war logistics missions. Contribution tracked for end-of-war rewards.

### Tier 2 — Strategic Support (Moderate Risk)

Activities that push beyond normal trade. There's a chance of detection and consequences.

- **Blockade running**: Smuggle supplies through contested space to besieged systems. Higher danger, better pay.
- **Intelligence gathering**: Trade at enemy systems and report back (prices, supply levels, fleet movements). Information gives your faction strategic advantages.
- **Supply line disruption**: Redirect trade away from enemy systems, creating artificial shortages.
- **Enemy reputation impact**: **Small penalty if discovered.** Each action has a percentage chance of detection. If caught, you're flagged as a hostile agent — reputation hit with enemy faction. Discovery chance increases with frequency.
- **Rewards**: Good faction reputation gains. Premium credit rewards. Strategic impact on the war (your intelligence could shift contested system outcomes).

### Tier 3 — Direct Action (High Risk, High Reward)

Overt hostile actions against the enemy faction. Guaranteed consequences, biggest payoffs.

- **Sabotage missions**: Disrupt enemy infrastructure — disable a refinery, damage supply depots, degrade system defenses.
- **Espionage**: Steal strategic information that gives your faction a measurable combat advantage in contested systems.
- **Resistance support**: Smuggle weapons to resistance movements in enemy-occupied territory (especially recently conquered systems).
- **Enemy reputation impact**: **Guaranteed and significant.** You are actively harming them. They know. They won't forget. Large reputation penalty per action.
- **Rewards**: Major faction reputation gains. Large credit rewards. Significant strategic impact on war outcomes. End-of-war bonus rewards for top contributors.

### War Profiteering

Players *can* supply war goods to both sides of a conflict (Tier 1 only). This is a valid but risky playstyle.

- Selling to both sides is profitable — war goods are in high demand everywhere during conflict
- If a faction discovers you're supplying their enemy, **large reputation hit with both sides** — neither trusts a double-dealer
- Discovery chance increases with the volume sold to both sides
- Creates the "arms dealer" archetype: high profit, high risk of being blacklisted by everyone
- Tier 2 and Tier 3 actions for both sides simultaneously would be extremely risky — discovery on either side reveals you as a double agent

### End-of-War Rewards

When a war resolves, players who contributed receive rewards based on their total contribution and which side won:

- **Winning side contributors**: Large reputation bonus with the winning faction. Credit payout proportional to contribution. Access to exclusive post-war missions/contracts. Priority access to facilities in newly conquered territory.
- **Losing side contributors**: Smaller consolation reputation bonus (effort acknowledged — the faction remembers who stood with them). Reduced credit payout. No territory benefits.
- **Contribution ranking**: Top contributors on the winning side could receive special recognition — titles, exclusive faction access, named in the war's history.

---

## 7. Player Assets in Conquered Territory

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

## Related Design Docs

- **[Faction System](./faction-system.md)** — faction model, inter-faction relations, player reputation, homeworlds, roster
- **[Missions](./missions.md)** — war logistics, intelligence, sabotage as mission types
- **[Ship Roster](./ship-roster.md)** — combat ship stats that feed into battle resolution (future interaction)
- **[Player Progression](./player-progression.md)** — war contributions as a progression path
