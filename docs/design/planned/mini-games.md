# Mini-Games Design

In-universe recreational games available at cantinas and social locations across the galaxy. These are the games spacers play — card games, dice games, betting games that reflect the culture of traders, smugglers, and frontier settlers.

Mini-games are part of the [In-System Gameplay](./in-system-gameplay.md) layer. They're optional content that adds flavor, provides an alternative way to earn credits, and deepens the sense of a lived-in universe. A player should be able to sit down at a cantina table and lose an hour to a card game without touching the trade screen.

**Design principle**: Each mini-game should be genuinely fun to play on its own merits. If a player would seek it out for entertainment and not just rewards, the design is working.

**Design principle**: Thematic resonance. Every game reflects the world it exists in — traders bluff about cargo, miners push their luck, officers play strategy games. The mini-games are a window into the culture.

---

## 1. Void's Gambit

A card game played by traders and smugglers across the galaxy. The most popular game in cantinas from core worlds to frontier outposts.

### 1.1 Lore

"Void's Gambit started in the cantinas of the Free Reaches — frontier spacers with too much downtime and not enough credits. The rules spread along trade routes like cargo, picking up house variants at every station. The name comes from the dreaded Void cards — empty holds declared as full cargo. Every trader knows the feeling: customs is calling for manifests, you've got nothing in your hold, and you need to make it sound like something. That's Void's Gambit — declare your cargo, hope nobody checks, and pray you read the room better than they read you."

### 1.2 Components

**The Deck** — 30 cards total:

4 suits of 7 cards each (values 1–7):
| Suit | Thematic identity | Colour |
|---|---|---|
| Raw Materials | The basics — ore, fuel, food. Honest cargo | Amber/brown |
| Refined Goods | Processed materials — alloys, chemicals, textiles. Solid middle ground | Silver/blue |
| Tech | Electronics, components, instruments. High value, high profile | Green/white |
| Luxuries | Fine wines, art, rare materials, cultural artifacts. Premium cargo | Purple/gold |

2 special cards:
| Card | Value | Effect |
|---|---|---|
| **The Void** | 0 | Wild — satisfies any suit constraint. Must lie about value (declarations require 1–7, Void is always 0). The empty hold dressed up as cargo |

**The Demand Deck** — 8 cards, 2 per suit. Shuffled at game start. One card is flipped each round to determine the demanded suit. 7 of 8 cards are used (one remains face-down), guaranteeing every suit appears at least once across the game.

### 1.3 Setup

1. Shuffle the main deck
2. Deal **5 cards** to each player
3. Both players agree on a wager and place it in the pot
4. Shuffle the demand deck and place it face-down
5. Remaining main deck placed face-down as the draw pile

### 1.4 Round Structure

The game plays over **7 rounds**. Each round follows this sequence:

#### Demand Phase
Flip the top card of the demand deck. This reveals the **demanded suit** for the round — both players must declare their card as this suit.

The demand sequence is unknown at game start. Players discover each round's suit as it's revealed. The demand deck contains 2 of each suit (8 cards), and 7 are drawn — so three suits appear exactly twice, and one suit appears only once. By round 7, attentive players can deduce the final suit by elimination. This creates a natural climax: both players know what's coming and can plan their endgame.

#### Draw Phase
Both players draw 1 card from the main deck simultaneously. (Skip on round 1 — you already have your starting hand.)

#### Declaration Phase
Starting with the first player (alternates each round), each player takes their turn:

1. Choose a card from your hand
2. Place it face-down in your manifest
3. **Declare** it: announce the demanded suit and a value from 1–7 (e.g., "Tech 5")

All cards are played face-down. There is no face-up option. Your declaration must claim the demanded suit, but the value is your choice. Your card might be:
- The demanded suit at the declared value (**honest** — safe if called)
- The demanded suit at a different value (**value inflation** — boosting your score)
- A completely different suit (**suit lie** — you don't have the demanded suit)
- A Void card (**the gambit** — wild for suit, but value is always a lie)

The second player sees the first player's declaration before making their own. This gives the second player information — and pressure. If the first player declared Tech 7, do you also declare high and risk looking suspicious? Or play conservative and fall behind?

#### Call Phase
After both players have declared, there is a **call window**. The first player (who declared first this round) calls first, then the other player. Call order mirrors declaration order and alternates each round.

- **Calls target only the card played this round** — previous rounds' cards are locked in and cannot be challenged. If you don't call it now, it's safe forever. This creates the urgency of the call window
- Each player may call the other once per round
- Both players can call each other in the same round (mutual exposure — dramatic and allowed)
- A called card is immediately revealed and checked against its declaration
- See §1.5 for full calling rules and consequences

#### End of Round
Uncalled cards remain face-down in the manifest. First player alternates. Next round begins.

### 1.5 Calling

Calling is the game's core decision point. When you call your opponent's card:

**If you're right (declaration doesn't match):**
- The card is removed from their manifest and placed in the discard pile (face-up — now public information for card counting)
- The liar takes a **penalty equal to their declared value**. A caught "Tech 7" costs 7 points. A caught "Raw 2" costs only 2
- The caught player scores nothing for that round — the card is gone

**If you're wrong (declaration is honest):**
- The card remains in their manifest, now turned face-up (confirmed honest — also public information)
- You take a **-3 point penalty**
- You've given your opponent free information advantage

**A declaration must match BOTH suit AND value to be honest.** Matching suit but wrong value is still a lie. This creates two layers of deception:
- **Forced lies**: you don't have the demanded suit, so you must lie about suit (and likely value too)
- **Optional lies**: you have the demanded suit but inflate the value for extra points

**Information from calls**: Whether a call succeeds or fails, the revealed card becomes public knowledge. Even a "wrong" call (-3 penalty) shows you your opponent's real card, removing it from the unknown pool. Sometimes paying 3 points for information is worth it — especially if it confirms a pattern or eliminates possibilities for later rounds.

#### The Calling Calculus

The scaled penalty creates a natural risk curve. Higher declarations are easier to call profitably:

| Declaration | Liar's penalty | Caller confidence needed to break even |
|---|---|---|
| 7 | -7 | ~30% — barely a hunch |
| 6 | -6 | ~33% |
| 5 | -5 | ~38% |
| 4 | -4 | ~43% |
| 3 | -3 | ~50% — coin flip |
| 2 | -2 | ~60% — need to be fairly sure |
| 1 | -1 | ~75% — almost never worth it |

This self-balances the game. Declaring 7 is enormously tempting (+7 points!) but your opponent needs only vague suspicion to profitably call. Declaring 3–4 is safer (opponents won't bother calling without strong evidence) but the gain is modest. **The sweet spot for lies naturally falls in the 4–5 range** — enough upside to matter, not so high that it screams "call me."

### 1.6 The Void

The 2 Void cards are the game's namesake — the empty cargo hold declared as a fortune.

**Wild suit**: A Void satisfies any suit constraint. When the demand is Tech and you have no Tech cards, a Void lets you play without lying about suit.

**Zero value**: Voids are always worth 0. Since declarations require values 1–7, **playing a Void always means lying about value**. A Void can never be fully honest — it's always vulnerable to a call.

**Three outcomes:**

1. **Survives uncalled** → Scores its declared value at game end. A Void declared as "Tech 6" that nobody calls is worth 6 points from nothing. Pure profit from an empty hold. This is the gambit that gives the game its name.

2. **Gets called** → Revealed as a Void. The liar takes a penalty equal to the declared value, and the card is removed. A Void declared as "Tech 7" that gets called costs -7 points. The bigger the declaration, the harder the fall.

3. **Held in hand (never played)** → Scores nothing, costs nothing. Sometimes the safest play is to sit on the Void and never commit it.

**The mind game**: Drawing a Void is always a dramatic moment. It solves your suit problem (wild — you can play it on any demanded suit) but creates a value problem (always a lie, always vulnerable). The core decision is **bluff sizing**: declare it as a modest 3 (low reward, but opponents rarely call 3s) or a bold 7 (massive reward, but easy to call profitably)? Your opponent can't see that it's a Void — they just see a face-down card with a declaration. But if they happen to hold the card you declared it as, they know instantly.

**Strategic note**: A Void is most dangerous when you're behind. Falling behind on points forces aggressive declarations anyway — a Void declared as 6 or 7 is a desperation play that either closes the gap or buries you further. When you're ahead, a Void declared as 2 or 3 is a quiet way to extract a few points without inviting scrutiny. The game state determines the gambit's size.

### 1.7 Final Reveal & Scoring

After round 7, all remaining face-down cards in both manifests are revealed simultaneously. This is the climax — every uncalled declaration is laid bare.

**Scoring per card:**
- **Honest declarations** (suit and value match): printed value
- **Surviving lies** (uncalled, suit or value didn't match): **declared** value — the lie paid off
- **Caught cards**: already removed during the game (scored nothing, penalty already applied)

**Penalties**: Subtract all accumulated penalties from the card value total. Penalties come from two sources:
- Caught lying: penalty equal to the declared value of the caught card
- Wrong calls: -3 per incorrect call

**Winner**: Highest total score wins the pot.

**Tiebreaker**: If scores are equal, split the pot.

**The reveal moment**: Scores are already determined by declarations and penalties — the reveal doesn't change them. But the reveal is the emotional payoff. Every surviving lie is exposed: "Your Tech 7 in round 2 was a Raw Materials 1 the entire time?!" Every honest declaration is confirmed: "You really DID have all those Tech cards." The reveal is where stories are made and rematches are demanded.

### 1.8 Tension & Relief Map

The full arc of a game, beat by beat:

| Game moment | Emotion | Intensity | Design mechanism |
|---|---|---|---|
| Dealt opening hand | Assessment, scheming | Low | "Which suits am I strong in? Where will I be forced to lie?" |
| Demand reveal (each round) | Anticipation → relief/dread | Medium | "Tech again? I used my only Tech card last round..." |
| Drawing a Void | Mixed dread and opportunity | High spike | "This solves my suit problem but I'll have to lie about value" |
| First player's declaration | Commitment, tone-setting | Medium | "They declared 6. Do I match that aggression or play safe?" |
| Deciding your own declaration | Risk calibration | Medium–High | "I have a 3, but I need points. Do I declare 5? 6?" |
| Opponent declares high | Suspicion, calculation | High | "They declared Tech 7. I'm holding Tech 5 and 7. That's impossible." |
| Deciding whether to call | Agonizing risk assessment | Highest | "If I'm right, they lose 7 points. If I'm wrong, I lose 3. Is it worth it?" |
| Successful call — caught a liar | Triumph, vindication | High relief | "I KNEW that wasn't a Tech 7!" |
| Failed call — they were honest | Regret, penalty sting | Medium–High | "They really had it. -3 for me." |
| Being called and caught | Dread, exposure | High | "My whole lead just evaporated." |
| Being called and honest | Smug satisfaction | High relief | "Go ahead, check. That costs you 3." |
| Repeated suit round | Escalating certainty | High | "Third time Raw Materials comes up. I know exactly what they've played." |
| Round 7 — deduced final suit | Peak strategic tension | Highest | Both players know the suit, both plan their endgame play. Showdown. |
| Final reveal — lies exposed | Drama, laughter, disbelief | High | "Your Refined 6 was a VOID?!" |
| Final scoring & winner | Resolution | Satisfaction/desire for rematch | Clear outcome, stories to tell |

**Key design insight**: Three tension layers overlap to prevent flat stretches:
- **The demand deck** creates *structural* tension (will the next suit match my hand?)
- **The declaration** creates *personal* tension (how much do I dare inflate?)
- **The call window** creates *interpersonal* tension (do I trust them? do they trust me?)

### 1.9 Strategic Depth

#### The Core Loop — Forced Deception Through Constraints

The game shares DNA with Cheat (also known as BS/Bullshit). The key insight borrowed from Cheat: **the rules create situations where lying is unavoidable**. In Cheat, you must play the next number in sequence — if you don't have it, you must lie. In Void's Gambit, you must play the demanded suit — if you don't have it, you must lie.

This forced deception is what makes the game work. A player doesn't choose to lie for bonus points — they lie because the rules leave them no choice. And once some lies are forced, *every* declaration becomes suspect. Even honest players look suspicious because the opponent can't distinguish a forced lie from an honest play.

The second half of the engine is **card counting** — the same mechanic that makes Cheat's calling decisions informed rather than random. Over 7 rounds, careful players track which cards have been revealed (through calls, both successful and failed). If you hold Tech 5 and Tech 7, and your opponent declares "Tech 7" — you know they're lying. That certainty is the most satisfying moment in the game.

#### Emergent Strategies

**The Conservative**: Declares honestly whenever possible. When forced to lie (wrong suit), keeps the declared value modest (3–4 range). Rarely calls unless card counting provides high confidence. Wins by accumulating steady points with zero penalty risk. Low variance — unlikely to win big, unlikely to lose big.

*Weakness*: Predictable. The opponent learns to never call your declarations (saving themselves -3 penalties), and can focus entirely on their own inflation.

**The Inflator**: Consistently adds +2 to +3 to every declaration. Never honest, but never outrageously high. Hard to catch because each individual lie looks plausible. Over 7 rounds, the cumulative inflation adds 14–21 phantom points.

*Weakness*: A single successful call erases several rounds of inflation (losing a declared 6 costs -6 plus the card). And a card-counting opponent will eventually spot the pattern.

**The Gambler**: Makes bold declarations (6–7) regardless of the real card. High variance — if three survive, the point total is enormous. If caught twice, the game is over. Lives or dies by the opponent's willingness to call.

*Weakness*: The calling calculus means opponents only need ~30% confidence to profitably call a 7. Bold declarations invite calls.

**The Detective**: Focuses on calling. Counts cards meticulously and calls whenever the math favours it. Accepts the occasional -3 wrong call as the cost of gathering information and suppressing opponent inflation.

*Weakness*: Each wrong call is -3 and a free information gift to the opponent. Against an honest player, the Detective bleeds penalty points for nothing.

**The Reputation Player**: The meta-strategy across multiple games. Inflate aggressively in games 1–3, building a reputation as a liar. In game 4, play completely honestly — the opponent, conditioned to call everything, racks up -3 penalties calling your truthful declarations. Then switch back. This reputation cycle is what makes the Station Regular NPC (who adapts within and across games) the most interesting opponent.

### 1.10 NPC Opponents

NPC opponents have distinct playstyles, providing variety and escalating challenge. Playstyle is expressed through declaration tendencies, calling thresholds, and card-counting ability.

| Archetype | Playstyle | Call tendency | Lie frequency | Found at |
|---|---|---|---|---|
| **Cautious Trader** | Declares honestly. Low-value inflation at most. Only calls obviously suspicious declarations (7s when they hold high cards of that suit). The beginner opponent | Low | Very low | Core/federation cantinas |
| **Frontier Gambler** | Inflates aggressively — declares 5–7 regardless of real card. Rarely calls — too confident in their own bluffs to worry about yours. Volatile — easy to beat with smart calling, dangerous if left unchecked | Very low | Very high | Frontier cantinas |
| **Sharp Smuggler** | Moderate inflation with strategic calling. Counts cards and calls when the math is good. Subtle — lies close to the truth (real 3 declared as 5, not 7). Hard to read because declarations are always plausible | Medium (calculated) | Medium (subtle) | Black market locations |
| **Station Regular** | Balanced. Adapts to the player's behaviour within a game — increases calling when the player is caught lying. Cross-game adaptation (tracking patterns across multiple games) is a future enhancement. The meta opponent | Adaptive | Adaptive | Any cantina — recurring NPC |

NPC dialogue during play adds personality:
- Cautious Trader: "Raw Materials 4. Straight and honest." / "Hmm... I'll let that one go."
- Frontier Gambler: "Tech 7. Yeah, you heard me." / "Call me if you dare."
- Sharp Smuggler: "...that's the third time you've declared 6 on a repeated suit. Let me see that." / "Refined 5. Take it or leave it."
- Station Regular: "You lied twice last game. I'm watching this time." / "Interesting. You've been honest all game. Which means this one might not be."

### 1.11 Stakes & Play Locations

Wager limits are set per opponent archetype, reflecting their personality and risk tolerance:

| Opponent | Wager range | Default | Step | Notes |
|---|---|---|---|---|
| **Cautious Trader** | 10–200 CR | 50 CR | 10 | Low stakes. Good for learning |
| **Frontier Gambler** | 10–750 CR | 100 CR | 25 | Wide range — casual or aggressive |
| **Sharp Smuggler** | 25–500 CR | 100 CR | 25 | Moderate stakes, calculated play |
| **Station Regular** | 50–1,000 CR | 200 CR | 50 | Higher floor — Kaz doesn't play cheap |

Future location-based gating (e.g., high-stakes back rooms, reputation requirements) will layer on top of per-opponent limits when the in-system location system ships.

Stakes are always opt-in. No mission or progression element requires playing Void's Gambit. It's pure optional entertainment with an earning potential.

### 1.12 Future Expansion Hooks

These are NOT Phase 1 features. They're design space we're preserving for later development.

**The Shark NPC** — High-stakes exclusive. Tracks every card revealed across the game with near-perfect recall. Calculates the probability of each declaration being honest based on remaining cards. Calls with surgical precision. Uses Voids offensively — declares them as whatever card they calculate the player is least likely to hold. The hardest NPC opponent. Only found in high-stakes back rooms.

**Additional special cards** — New rare card types (1–2 copies each) with unique risk/reward profiles that complement the Void. Design space for cards that interact with the call mechanic in different ways — defensive traps, information tools, scoring wildcards.

**Card variants** — rare cards with modified rules found as mission loot, purchased from specialty merchants, or won in high-stakes games:
- "Customs Override" — play from hand to force opponent to reveal one card in their manifest (doesn't replace your declaration). Found at authoritarian stations
- "Insurance Policy" — attach to a face-down card in your manifest; if called, the caller sees "Insured" and cannot inspect. One use. Found at corporate stations
- "Ghost Manifest" — when called, this card vanishes from your manifest but you take no penalty. Wastes the caller's suspicion. Found at dark nebula locations
- "Double Down" — after both players declare, you may reveal this card from your hand to double the stakes for this round only. Both players' cards for this round score (or lose) 2× value. Found at frontier cantinas

Card variants are collected and form a personal loadout. Before a game, the player selects which variants to bring (limited slots). This adds deck-building strategy on top of the core game.

**House rules** — different systems/factions play with variant rules:
- Free Reaches: "Blind Round" — one randomly chosen round has no demand card. Both players can declare any suit. Maximum chaos
- Authoritarian space: "Customs Crackdown" — the demand deck has 3 of one random suit (9 cards). That suit comes up more often, making card counting in that suit critical
- Corporate space: "Leverage" — winner of the previous game gets to see one card in their next opponent's hand before play begins
- Frontier space: "Dead Man's Draw" — if you play both Voids in one game and both survive uncalled, instant win (extremely rare, extremely dramatic)

**Tournament events** — periodic NPC tournaments at major stations. Entry fee, bracket format (win-and-advance), unique cosmetic or gameplay prizes. Multi-game format rewards consistency and reputation play, not single-game luck.

**Player vs Player** — two docked players can challenge each other. Same rules, but now you're reading a real person instead of NPC weights. The social layer that elevates the game.

---

## 2. Future Mini-Games

Planned mini-games for later phases. Brief concepts only — full design when they enter active development.

### 2.1 Drift

A push-your-luck dice game popular among miners and frontier workers. Quick, tense, and mostly luck with a critical stop/go decision.

**Core concept**: You're navigating through a hazard field. Roll dice, accumulate "distance" points. After each roll, choose: bank your accumulated points (safe), or roll again for more (greedy). Rolling a "Drift" face loses all unbanked points for that turn. Play alternates until a target score is reached.

**Thematic flavor**: Represents the recklessness of space travel — pushing through an asteroid field, skimming too close to a star, diving deeper into an atmosphere.

**Location**: Extraction and frontier cantinas. Miners play this.

**Design space**: Variant dice at different locations (volcanic world adds an extra hazard face, safe stations remove one). Side bets on specific outcomes.

### 2.2 Alignment

A two-player strategy board game played by officers and academics. Place tiles to control territory on a small hex grid. Deeper, slower, more cerebral than the other games.

**Core concept**: Each player places faction-colored tiles on a shared hex grid, claiming territory. Surrounding an opponent's tile flips it to your color. The player controlling more hexes when the grid is full wins.

**Thematic flavor**: Represents the political maneuvering of faction leaders — territorial control, flanking, encirclement. The "officer's game."

**Location**: Core, tech, and military cantinas. Navy officers and academics play this.

**Design space**: Different board sizes, asymmetric starting positions, special tiles with unique placement rules.

### 2.3 Cargo Roulette

A fast, light gambling game. A sealed cargo container is revealed and players bet on its contents based on limited clues.

**Core concept**: The house presents a sealed container with partial information visible (weight, origin system, container markings, hazard labels). Players place bets on what category of goods is inside. Container is opened, bets resolved. Quick rounds, fast turnover.

**Thematic flavor**: The gamble of buying cargo sight-unseen — a real practice among frontier traders buying salvage lots. Knowledge of trade routes and economy types gives an edge.

**Location**: Any cantina. The casual, quick game everyone knows.

**Design space**: Player knowledge of the game world (economy types, trade routes) provides a genuine edge. Experienced players are better at Cargo Roulette because they understand the universe. Ties the mini-game to the core trading knowledge.

---

## 3. Integration with In-System Gameplay

### 3.1 Location Placement

Mini-games are available at **cantina** locations (universal — every system has one). The cantina is the social hub where mini-games, NPC interactions, and rumors converge.

Specific mini-games may also appear at trait-specific locations:
- Drift at mining camps and extraction facilities
- Alignment at naval bases and research stations
- Cargo Roulette at trade exchanges and salvage yards

### 3.2 NPC Relationships

Mini-game NPCs are a subset of the NPC framework defined in [in-system-gameplay.md §3](./in-system-gameplay.md). They:
- Have persistent memory of games played against the player (win/loss record)
- Adjust dialogue based on history ("Back for another round? You still owe me from last time")
- May offer missions or information to players who've built familiarity through repeated play ("You're alright. Listen, I heard something you might want to know...")
- Can serve as gatekeepers — beating the Station Regular at Void's Gambit might be how you get introduced to the back-room high-stakes game

### 3.3 Rewards

Mini-game rewards are primarily credits (wagered in the game), but extended engagement unlocks additional value:

| Reward type | Source | Notes |
|---|---|---|
| Credits | Winning the pot | Direct and immediate. Scale with stakes tier |
| NPC familiarity | Repeated play with same NPC | Unlocks dialogue, missions, information |
| Card variants | High-stakes prizes, tournament rewards | Rare, collectible, enhance the game itself |
| Lore | NPC dialogue during/after games | Stories, rumors, world-building. NPCs are chatty at the table |
| Reputation | Indirect — NPC connections lead to faction contacts | Mini-game NPCs can introduce you to people |

### 3.4 Phase 1 Scope

Phase 1 ships Void's Gambit only:
- Core rules (§1.2 through §1.7)
- 4 NPC opponent archetypes: Cautious Trader, Frontier Gambler, Sharp Smuggler, Station Regular
- Per-opponent wager limits (see §1.11)
- NPC dialogue during play (personality-driven commentary)
- Basic win/loss tracking per NPC

Phase 1 does NOT include:
- Location-gated stakes or The Shark NPC
- Contraband special mechanics
- Card variants or deck customization
- Tournament events
- Player vs player
- House rules variants
- Other mini-games (Drift, Alignment, Cargo Roulette)

---

## Related Design Docs

- **[In-System Gameplay](./in-system-gameplay.md)** — the parent system. Mini-games are one activity type within in-system content
- **[System Enrichment](./system-enrichment.md)** — traits determine which locations exist, which affects mini-game availability
- **[Player Progression](./player-progression.md)** — stakes tiers align with progression phases
- **[Multiplayer Infrastructure](./multiplayer-infrastructure.md)** — PvP mini-games as a future social feature
