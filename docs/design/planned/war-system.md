# War System Design

Wars and territorial conflict between factions. This covers two distinct layers: **ambient border conflicts** (event-system-driven tension at faction borders) and **interactive faction wars** (full wars with player involvement, battle mechanics, and territory capture).

**Replaces**: The random War event in the current event catalog (`lib/constants/events.ts`) will be removed when this system is implemented. Border conflicts absorb its role as the source of war-themed economy/danger modifiers.

**Depends on**: [Faction System](./faction-system.md) (relations, alliances, doctrine), [Navigation Changes](./navigation-changes.md) (war zone danger values), [Ship Roster](./ship-roster.md) (combat stats for battle resolution)

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

See §10 for the concrete economy modifiers per system state and §11 for how allied factions shift the balance.

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

3. **Active war**: Border systems become contested. War exhaustion climbs per tick for both sides (1.5x for attacker). Contested systems have disrupted markets, increased danger (+0.20–0.25, see [navigation-changes.md §6](./navigation-changes.md)), and war-specific events. Economy effects applied per §10. Players contribute through tiered involvement system (see §8). Faction economy takes hits proportional to war intensity.

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

Conquest uses a **two-stage model**: fleet battles establish space superiority, then sieges capture systems. Fleet battles are common and exciting — they happen at many border systems simultaneously. Sieges are rare and deliberate — limited by assault capacity. This keeps the front line dynamic without too many systems changing hands.

### 5.1 The Front Line

Only **border systems** (systems adjacent to enemy territory) can see fleet battles. Deep strikes into core territory are not possible — you have to push the front line system by system. This means geography matters: chokepoint systems are strategically vital, wide-open borders are hard to defend.

When a war begins, all border systems between the two factions become **contested** — eligible for fleet battles. Not all contested systems will see active battles at any given time; that depends on where each faction commits their military output.

As systems are captured, the front line shifts. Previously safe systems may become border systems and newly eligible for contestation. The front line is always derived from current territory — it's a living boundary, not a fixed line drawn at war start.

### 5.2 Stage 1: Fleet Battles (Space Superiority)

Fleet battles are naval engagements in contested border systems. Winning a fleet battle grants **space superiority** over that system — orbital control — but does not capture the system. The defender still holds the planet/stations below.

Fleet battles use the same mechanics regardless of whether the attacker intends to follow up with a siege. They are the bread-and-butter combat of the war system.

#### Battle State

Each fleet battle tracks per-side state:

| Property | Description |
|---|---|
| **Strength** | Military force committed — troops, ships, resources. Depleted by damage each round. When one side hits 0, they've lost |
| **Morale** | Willingness to keep fighting. Shifts based on round outcomes, casualties, and stratagems. When morale breaks, the side retreats regardless of remaining strength |

Initial strength is derived from the faction's military output committed to this system, plus player contributions (ships, war goods). Larger conflicts with more committed forces produce higher starting strength on both sides — and therefore last longer.

Initial morale starts at a baseline modified by faction status (defenders get a home turf bonus, protectionist doctrine adds more) and recent battle history at this system (a string of losses tanks starting morale).

#### Round Resolution

The battle processor resolves one round every **N ticks** (tuning number, ~6 ticks as a starting point — roughly 1 minute per round at 10s ticks). Between resolution ticks, the battle is "in progress" and visible to players but no outcome is calculated. This pacing gives players time to notice battles, contribute, and feel their involvement matters.

Each round:

1. **Damage calculation** — both sides deal damage to each other's strength, determined by a weighted roll:

| Factor | Effect | Source |
|---|---|---|
| Committed strength | Base damage output — more ships deal more damage | Faction military output + player-contributed combat ships |
| Weapon quality | Modifier to damage dealt | Player-contributed war goods (weapons, munitions, equipment) |
| Defensive bonus | Reduces damage taken for the defending side | Inherent advantage — defending home territory. Stacks with protectionist doctrine |
| Intelligence | Modifier that increases damage dealt | From Tier 2 player espionage (§8). Better intel = better targeting |
| General stratagem | Low chance of massive damage spike (see §5.5) | Generals trained via credit contributions |
| Randomness | Core uncertainty in damage | Every round has a meaningful random element. Even lopsided battles have variance |

2. **Strength reduction** — subtract damage dealt from each side's remaining strength
3. **Morale update** — morale shifts based on the round's outcome:
   - Side that dealt more damage: morale holds steady or increases slightly
   - Side that took more damage: morale drops proportional to the casualty ratio
   - Lopsided rounds (one side takes heavy losses): large morale swing — cascading routs are possible
   - Stratagems (§5.5): a brilliant manoeuvre deals extra damage *and* tanks enemy morale — the psychological impact of an unexpected reversal

4. **End check** — the battle ends when either side's strength hits 0 (destroyed) or morale breaks below a threshold (retreat)

#### Battle Duration

Battle length emerges naturally from the committed forces:

| Conflict scale | Approx. strength | Approx. rounds | Approx. real time |
|---|---|---|---|
| Minor skirmish (small factions) | Low | 5–8 rounds | ~5–8 minutes |
| Standard engagement (regional vs regional) | Moderate | 10–15 rounds | ~10–15 minutes |
| Major clash (major vs major) | High | 15–25 rounds | ~15–25 minutes |
| Decisive battle (dominant vs major, heavy investment) | Very high | 20–30+ rounds | ~20–30+ minutes |

These are approximate — the actual length depends on damage rates, morale swings, and randomness. A lucky stratagem could end a major clash early via morale collapse, while a grinding stalemate between evenly matched forces could drag on.

#### Fleet Battle Outcomes

- **Attacker wins**: Attacker gains space superiority over the system. Can now choose to commit to a siege (Stage 2) or hold orbital control without sieging
- **Defender wins**: Defender retains full control. If the attacker held space superiority from a previous battle, they lose it

**Decisiveness** is derived from how the battle ended:

| End condition | Decisiveness | Siege progress modifier |
|---|---|---|
| Enemy strength destroyed, winner has >60% strength remaining | **Rout** — dominant victory | Fastest siege progress |
| Enemy morale broke with >40% strength remaining | **Morale collapse** — convincing victory | Fast siege progress |
| Enemy strength destroyed, winner has <30% remaining | **Pyrrhic victory** — won but battered | Slow siege progress |
| Enemy morale broke with <20% strength remaining | **Narrow retreat** — barely won | Slowest siege progress |

Decisiveness affects siege progress rate if a siege follows (see §5.3), but space superiority is binary — you have it or you don't.

#### Fleet Battles Without Siege

An attacker may win fleet battles at border systems without committing to a siege. This is still valuable:

- **Ties down defender resources** — the defender must commit military output to contest these systems or lose orbital control
- **Increases danger** — systems under hostile space superiority have elevated danger for trade ships (see [navigation-changes.md §6](./navigation-changes.md))
- **Strategic pressure** — forces the defender to spread thin, weakening their defence at the systems the attacker actually wants to siege
- **Feints** — the attacker can threaten a siege to draw defender forces, then commit elsewhere

#### Reinforcements

Player contributions during an active battle (war goods, credits, ships) can reinforce the strength pool mid-battle. This is what makes the multi-tick pacing essential — players see a battle going badly, rush supplies to the front, and the tide shifts. Reinforcements add to strength and provide a morale boost (the faction sees support arriving).

Reinforcements are subject to the same diminishing returns as all player contributions (§5.6).

#### Viewable Battle State

Battles are visible to all players on an info screen:

- Strength bars for both sides (percentage remaining, not absolute numbers)
- Morale indicators (high / steady / shaken / breaking)
- Round-by-round history (who dealt more damage, any stratagems triggered)
- Resources committed by each side (aggregate, not individual player contributions)
- Space superiority status for the system

This creates spectator drama — players check in to see how the front line is shifting, whether their contributions are making a difference, and whether an underdog is pulling off an upset.

### 5.3 Stage 2: Sieges (System Capture)

A siege is the deliberate, resource-intensive process of capturing a system after the attacker has established space superiority through a fleet battle. Sieges are the only way systems change hands.

#### Siege Prerequisites

- Attacker holds **space superiority** over the system (won the most recent fleet battle)
- Attacker has **available assault capacity** (see §5.4)
- System is not the defender's **homeworld** (see Conquest Limits below)

#### Siege Mechanics

- **Control score**: Range 0–100. Starts at 0 when siege begins. At 100, the system is captured
- **Progress per tick**: Control score advances each tick based on the attacker's committed siege strength, modified by the decisiveness of the fleet battle that established superiority (a rout gives faster siege progress than a pyrrhic victory — see §5.2 decisiveness table)
- **Defender disruption**: The defender can launch fleet battles to contest space superiority. If the defender wins a fleet battle while a siege is active, the siege is **suspended** — progress freezes but is not lost. The attacker must win another fleet battle to resume
- **Siege attrition**: Active sieges drain attacker resources per tick (credits, military output). This is part of what makes sieges expensive and limits how many can run simultaneously
- **If the war ends** (ceasefire/exhaustion) with a siege in progress at any score below 100: the siege fails, the system remains with the defender. Partial progress is lost — you either take a system or you don't

#### Siege vs Fleet Battle Identity

| Aspect | Fleet Battle | Siege |
|---|---|---|
| **Frequency** | Common — many border systems | Rare — limited by assault capacity |
| **Duration** | Minutes to tens of minutes (scales with committed forces) | Many ticks (dozens) for full capture |
| **Player experience** | Dramatic, round-by-round attrition with morale swings | Slow burn, progress bar |
| **Resources** | Part of normal military output | Additional dedicated siege resources |
| **Outcome** | Space superiority (binary) | Territory capture (permanent) |

### 5.4 Assault Capacity

A faction can only run a limited number of **simultaneous sieges**, determined by their assault capacity. This is the primary throttle on how fast territory changes hands.

- **Base assault capacity**: Derived from faction military output and territory size. Typical values: Minor faction = 1, Regional = 1–2, Major = 2–3, Dominant = 3–4
- **Multi-front penalty**: Assault capacity is shared across all active wars. A faction fighting two wars splits their capacity between them
- **Player contribution**: Player-supplied war goods and credits can temporarily increase assault capacity (through diminishing returns — see §5.6)

The attacker must choose which systems to siege. Winning fleet battles at 8 border systems but only being able to siege 2–3 at a time creates the core strategic decision: which systems are worth the commitment?

### 5.5 Generals and the Stratagem Mechanic

Generals don't just provide a flat tactical bonus — they introduce a **low-probability, high-impact "brilliant stratagem"** that can swing individual fleet battle rounds.

#### How It Works

- Each round, there is a small percentage chance that a side's general executes a brilliant stratagem
- If triggered: **massive damage spike** to the enemy plus a **large morale penalty** — the psychological impact of an unexpected reversal is as damaging as the casualties
- The stratagem chance is **weighted by power disparity**: the more outnumbered a faction is, the higher the chance

#### Why Asymmetric Weighting Works

| Scenario | Stratagem impact |
|---|---|
| Dominant faction gets stratagem | Marginal — they were already winning. The extra damage shortens the battle but doesn't change the outcome |
| Underdog faction gets stratagem | Potentially decisive — massive morale hit can trigger a cascade where a winning army suddenly breaks and retreats. Turns a losing battle into a pyrrhic victory for the enemy, or even a full reversal |

**Design rationale**: This is the "cornered animal" effect expressed mechanically. A 3-system faction fighting for survival isn't just fighting harder — they're **thinking harder**. Desperation breeds tactical innovation. A sprawling empire has bureaucracy, complacency, and internal politics diluting their focus. The underdog has nothing to lose and every reason to try something bold.

#### Weighting Factors

- **Power disparity**: The larger the size difference between factions, the higher the stratagem chance for the smaller side. A minor faction fighting a dominant power has the highest chance of tactical brilliance.
- **General quality**: Better generals (funded by more credit contributions) have a higher base stratagem chance regardless of faction size.
- **Faction status**: Minor factions get an inherent stratagem bonus (part of their defensive advantages from faction-system.md §1).

This means generals are always valuable, but they're *disproportionately* valuable for smaller factions. A minor faction that invests heavily in generals can punch well above their weight in individual battles, even if they lose the war overall through attrition.

### 5.6 Contribution and Diminishing Returns

Player contributions to war efforts use **diminishing returns** rather than hard caps. This rewards coalition play over individual wealth.

- First N credits/goods of contribution have **full impact** on battle modifiers
- Beyond that threshold, each additional unit has **progressively less effect**
- A player contributing 10x what a regular player does gets roughly 3-4x the impact, not 10x
- **Five regular players coordinating** outperform one whale at the same total spend

This achieves two goals:
1. **Whales can still make a difference** — their extra contribution matters, it's just not linear. The risk of overcommitting is real (lose big if your side loses).
2. **Coordination is king** — the optimal strategy is many players contributing moderate amounts. This drives the multiplayer cooperation that makes the game social.

### 5.7 Conquest Limits

Three layered limits prevent any single war from destroying a faction.

#### Capture Exhaustion

Each successful system capture adds a **flat exhaustion penalty** to the attacker (~10–15 per capture, tuning number). This makes conquest self-limiting:

| Captures | Cumulative exhaustion cost | Effect |
|---|---|---|
| 1st system | ~12 | Affordable. Standard cost of doing business |
| 2nd system | ~24 total | Noticeable. Attacker feeling the strain |
| 3rd system | ~36 total | Significant. Combined with per-tick exhaustion, the war is getting expensive |
| 4th+ system | ~48+ total | Dangerous. Attacker is likely approaching the exhaustion cap and risking forced ceasefire with no further gains |

This is the organic, soft limit. Most wars naturally end after 2–3 captures because the attacker can't sustain the exhaustion cost.

#### Territory Percentage Cap

Hard backstop: an attacker cannot capture more than **~25% of the defender's pre-war territory** in a single war. Even a total military victory leaves the losing faction with 75% of their systems. This prevents edge cases where a huge faction steamrolls a small one.

- Calculated from the defender's territory size at war declaration (not current size — prevents the cap from shrinking as systems are lost)
- Minimum of 1 system (even the smallest faction can lose something)
- Maximum is a tuning number — 25% is the starting point, may adjust based on simulation

#### Homeworld Immunity

A faction's homeworld **cannot be sieged** unless the faction has already been reduced below Minor status (fewer than 10 systems). This ensures:

- Factions always survive a single war — their capital and core territory are protected
- Destroying a faction requires sustained pressure across multiple wars over a long period
- Homeworlds are safe havens for players aligned with that faction, even during the worst defeats
- The only way to truly eliminate a faction is through a prolonged campaign that whittles them down across multiple conflicts

### 5.8 System Capture and Aftermath

When a siege's control score reaches 100:

1. **Ownership transfers** to the attacking faction immediately
2. **Capture exhaustion**: Attacker receives flat exhaustion penalty (see §5.7)
3. **Market disruption**: Prices spike, supply/demand is chaotic for several ticks as the new faction's economy type takes effect
4. **Player assets**: Handled per §9 (reputation-based consequences)
5. **New border**: The front line shifts. Previously safe systems may now be border systems and eligible for future contestation
6. **Historical record**: The system's capture is logged. If the original faction reclaims it later, the "liberation" event generates positive reputation with that faction
7. **Post-capture instability**: Elevated danger in the captured system that decays over ~50 ticks as the new faction establishes control (see [navigation-changes.md §6](./navigation-changes.md))

---

## 6. War Processor

Strategic-level war management. Handles the political lifecycle — relations, declarations, exhaustion, ceasefire. Runs at a **slow cadence** (every ~10 ticks) since these are gradual processes that don't need per-tick resolution.

### Step 1: Relation Scan

Scan all faction pairs for threshold crossings:

- **Relations cross -25 (unfriendly)**: Spawn border conflict events via the event system. These are standard events with economy/danger modifiers — the event processor handles their lifecycle, not the war processor
- **Relations cross -75 (hostile)**: Mark the pair as war-eligible. No immediate action — the declaration roll handles timing

Relations themselves are updated by a separate faction relations processor (see [faction-system.md §2](./faction-system.md)). The war processor only reads the current value and reacts to thresholds.

### Step 2: Declaration Roll

For each war-eligible faction pair (relations ≤ -75, no active war, no ceasefire cooldown):

- Per-check probability roll, modified by doctrine (expansionist = higher chance, protectionist = lower) and power ratio
- The slow cadence (every ~10 ticks) plus the probability roll creates a natural buildup of several checks before a declaration fires — players see escalating tension events during this window
- If the roll succeeds: create War record, determine initial contested systems (all border systems between the two factions), fire galaxy-wide declaration notification
- Markets react immediately — price spikes on war-relevant goods (weapons, fuel, food) in the region

### Step 3: Exhaustion Accumulation

For each active war, accumulate exhaustion for both sides:

```
attackerExhaustion += baseRate × 1.5 × intensityFactor × multiFrontPenalty
defenderExhaustion += baseRate × 1.0 × doctrineModifier
```

- **baseRate**: Tuning constant. Sets the overall pace of wars — higher rate = shorter wars. Target: a "small war" should last ~1–2 weeks real time
- **intensityFactor**: Scales with the number of active sieges. More sieges = faster exhaustion. Fleet battles without sieges contribute a smaller amount (the attacker is projecting force but not committing to costly ground operations)
- **multiFrontPenalty**: 1.0 for one war, ~1.3 for two, ~1.6 for three. Fighting on multiple fronts drains faster
- **doctrineModifier**: Protectionist defenders exhaust at ~0.8× (they're built for sustained defence). Expansionist attackers may get a small discount (~0.9×) reflecting war readiness

Capture exhaustion (§5.7) is separate — it's a one-time penalty applied at capture, not part of the per-tick accumulation.

### Step 4: Ceasefire Check

Evaluate whether an active war ends:

- **Forced end**: If either side hits 100 exhaustion, the war ends immediately. The side that hit 100 loses (attacker = no gains, defender = territory loss). See §4 phase 5–6 for resolution outcomes
- **Mutual ceasefire**: When both sides are above 75 exhaustion, a per-check probability of ceasefire begins. Probability increases as both sides climb higher — at 75/75 it's low, at 90/90 it's very likely. This creates a "both sides are exhausted" negotiation window
- **Unilateral seeking**: When only one side is above 75, no ceasefire — the stronger side presses their advantage. The exhausted side must fight on or hope the other side exhausts too
- **Ceasefire cooldown**: After a war ends (any outcome), a cooldown period prevents re-declaration between the same factions. Duration scales with war intensity — longer wars produce longer cooldowns

When a war ends, the war processor cleans up: resolves all active sieges (partial progress lost), clears contested status from all systems, applies resolution consequences (§4 phase 6), and records the war in history.

---

## 7. Battle Processor

Tactical-level combat resolution. Handles fleet battles and siege progression. Runs **every tick** since battles and sieges need smooth, visible progression — but individual rounds only resolve on specific ticks (multi-tick rounds).

### Fleet Battle Resolution

For each contested system with an active fleet battle:

1. **Check if this tick is a round resolution tick** — rounds resolve every N ticks (tuning number, ~6 ticks as a starting point). On non-resolution ticks, the battle is "in progress" and visible to players but no outcome is calculated
2. **Resolve the round** — calculate damage dealt by both sides using the factors in §5.2. Apply strength reduction and morale update
3. **Apply reinforcements** — if players contributed resources since last round, add to strength pool and apply morale boost
4. **Check for battle end** — if either side's strength hits 0 (destroyed) or morale breaks below threshold (retreat): determine decisiveness, apply outcome (space superiority granted or lost), start cooldown timer
5. **Cooldown management** — if a battle ended previously, decrement cooldown. When cooldown expires and both sides have military presence in the system, start a new battle

Fleet battle rounds are the player-visible heartbeat of the war. Players see strength bars and morale shifting in real time on the war info screen, check between play sessions to see how battles progressed, and time their contributions to reinforce a struggling front.

### Siege Progression

For each active siege:

1. **Check space superiority** — if the defender won a fleet battle since last tick, suspend the siege (progress frozen, not lost)
2. **Advance control score** — increment based on attacker's committed siege strength, modified by fleet battle decisiveness (§5.3). Siege progression is per-tick (smooth advancement), unlike fleet battles which resolve on specific ticks
3. **Check for capture** — if control score reaches 100, execute the capture inline: transfer system ownership, apply capture exhaustion, update front line, fire capture event. No separate check step needed — capture is the natural conclusion of a completed siege

### Processor Design Rationale

Splitting war and battle into separate processors follows the same separation of concerns as the rest of the tick pipeline:

- **Different cadences**: War processor runs every ~10 ticks (strategic decisions are slow). Battle processor runs every tick (combat needs smooth progression). Coupling them would mean either running strategy checks too often or resolving battles too slowly
- **Different data**: War processor reads faction relations and war records. Battle processor reads contested system state and military output. Minimal overlap
- **Independent failure**: A bug in battle resolution doesn't break war declarations or exhaustion. A bug in ceasefire logic doesn't freeze active battles
- **Testability**: Each processor can be unit tested with its own fixtures. War processor tests focus on declaration triggers and exhaustion curves. Battle processor tests focus on attrition math, morale curves, and siege progression

---

## 8. Player Involvement

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

## 9. Player Assets in Conquered Territory

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

## 10. Economy Effects

How wars affect the economy. War modifiers are **read by the existing economy processor** alongside government modifiers and event modifiers — no new economic mechanism is needed. The war processor (§6) and battle processor (§7) set war state; the economy processor reads that state and applies the appropriate modifiers each tick.

### Modifier Layers

War economic effects are applied per-system based on the system's war state. These stack additively with government and event modifiers already in the economy pipeline.

| System state | Production | Consumption | Volatility | Danger | Applies to |
|---|---|---|---|---|---|
| **Attacker rear territory** | -10–15% all goods | Boost: weapons, fuel, food, machinery | +10% | No change | All attacker systems not on the border. The mobilisation cost — the whole economy shifts to a war footing |
| **Defender rear territory** | No change | Minor boost: weapons, fuel | No change | No change | Defender systems away from the front. War hasn't reached them yet |
| **Staging (border, no active battle)** | -5–10% all goods | Boost: weapons, fuel, food | +20% | +0.10–0.15 | Border systems adjacent to contested zones. Military buildup disrupts normal commerce |
| **Contested (active fleet battle)** | -20–30% all goods | Large boost: weapons, fuel, food, machinery | +40–50% | +0.20–0.25 | Systems with active fleet battles. Trade is chaotic, supply lines disrupted |
| **Under siege** | -30–40% all goods | Very large boost: weapons, fuel, food | +50–60% | +0.25 (danger cap applies) | Systems under active siege. Economy nearly collapsed, desperate demand for war supplies |
| **Recently captured** | -20% decaying over ~50 ticks | Boost: food, machinery (rebuilding) | +30% decaying | +0.15 decaying | Post-capture instability. New faction establishing control |

Danger values align with [navigation-changes.md §6](./navigation-changes.md) which defines the navigation-side effects of war zone danger.

### War Goods Demand

Wars create faction-wide consumption boosts on war-relevant goods:

- **Weapons**: Primary war consumable. Highest demand boost
- **Fuel**: Military operations burn fuel. Strong demand boost
- **Food**: Troops need feeding. Moderate demand boost
- **Machinery**: Equipment, fortifications, repairs. Moderate demand boost in contested/sieged systems

These boosts create the price spikes that make war logistics profitable for players (§8 Tier 1 — Economic Support). The further from the front you source goods, the bigger the arbitrage opportunity. Players running supply convoys from peaceful rear systems to contested front-line systems are the economic backbone of the war effort.

### Economy Recovery

When a war ends:

- **Attacker modifiers** lift immediately across all rear systems. Contested/staging modifiers decay over ~20 ticks as military forces stand down
- **Defender modifiers** lift from rear systems immediately. Border systems recover over ~10 ticks
- **Market overcorrection**: War goods that were in massive demand suddenly aren't. Prices on weapons, fuel, and food drop sharply post-war as supply catches up to reduced demand. Savvy traders sell war stockpiles before the ceasefire, not after

### Interaction with §3 Attacker Cost Asymmetry

The economy table above is the concrete implementation of the asymmetry described in §3:

- Attacker pays a production penalty across **all** systems (rear + border + contested). Defender only pays on border and contested systems. This is why attacking is expensive — your entire economy takes a hit, not just the front line
- Both sides see war goods demand spikes, but the attacker's are larger (offensive operations consume more resources than defensive ones)
- This asymmetry means a failed war is economically devastating for the attacker — they took an economy-wide hit and gained nothing

---

## 11. Alliance Behavior in War

How allied factions participate when their ally is attacked. Alliance **formation** (pacts, relation thresholds, conditions) is defined in [faction-system.md](./faction-system.md). This section covers wartime behavior only.

### Joining a Defensive War

When a faction is attacked, allied factions may join as **co-defenders**:

- **Eligibility**: Relations > +50 with the defender, and an active alliance pact exists (faction-system.md)
- **Joining is not automatic** — the allied faction evaluates the commitment against their own interests. Factors: alliance strength (how close the relations are), the ally's own military commitments (are they already in a war?), and the attacker's power (is this a fight they can win?)
- **Joining triggers**: The co-defender enters the war on the defender's side. This is a galaxy-wide notification — players see a new faction entering the conflict
- **Timing**: Allies typically join within the first few war processor cycles after declaration. They don't join instantly — there's a deliberation period that creates dramatic tension

### Co-Defender Contributions

| Aspect | Co-Defender behavior |
|---|---|
| **Military output** | Commits a fraction (~30–50%) of their military output to the ally's battle strength. They're helping, not going all-in |
| **Fleet battles** | Co-defender's committed strength is added to the defender's side in fleet battles at contested systems |
| **Sieges** | Co-defender strength helps resist sieges (higher defender strength = slower siege progress) |
| **Economy** | Co-defender's own economy is *not* disrupted — they don't take the production penalties that primary combatants take. They pay only the military output commitment |
| **Player contributions** | Players allied with the co-defender faction can contribute to the war effort through the same tier system (§8), earning reputation with both the co-defender and the primary defender |

### Co-Defender Exhaustion

Co-defenders accumulate exhaustion at a **reduced rate (~0.5×)** — it's not their existential fight, so the political/economic strain is lower:

- At ~60 exhaustion, the co-defender begins evaluating withdrawal
- Withdrawal probability increases as exhaustion climbs — at 60 it's low, at 80 it's very likely
- When a co-defender withdraws: their military contribution is removed from the defender's battle strength, galaxy-wide notification fires. This can be a turning point in the war — suddenly the defender loses a chunk of their combat power
- A co-defender that withdraws does **not** become a target of the attacker. They stepped back, not switched sides. Relations with the attacker take a minor hit but no new war is declared

### Strategic Implications

- **Deterrence**: The threat of allied intervention makes attacking a well-allied faction riskier. The attacker must account for 1–2 co-defenders potentially joining, which changes the effective power ratio
- **Alliance strain**: Long wars drain co-defenders. An attacker can try to outlast the alliance — keep fighting until co-defenders withdraw, then press the advantage against the isolated defender
- **Opportunistic exploitation**: When a co-defender commits forces to an ally's war, their own borders are weaker. Opportunistic factions (see faction-system.md doctrine) may seize the moment to attack the co-defender's undefended territory
- **Player diplomacy**: Players can influence alliance behavior through reputation. High reputation with a potential co-defender makes them more likely to join. Players invested in multiple factions have a personal stake in alliance decisions

---

## Related Design Docs

- **[Faction System](./faction-system.md)** — faction model, inter-faction relations, player reputation, homeworlds, roster
- **[Navigation Changes](./navigation-changes.md)** — war zone danger values (§6), convoy escort mechanics in contested space
- **[Missions](./missions.md)** — war logistics, intelligence, sabotage as mission types
- **[Ship Roster](./ship-roster.md)** — combat ship stats that feed into battle resolution (future interaction)
- **[Player Progression](./player-progression.md)** — war contributions as a progression path
