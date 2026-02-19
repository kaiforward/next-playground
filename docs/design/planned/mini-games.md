# Mini-Games Design

In-universe recreational games available at cantinas and social locations across the galaxy. These are the games spacers play — card games, dice games, betting games that reflect the culture of traders, smugglers, and frontier settlers.

Mini-games are part of the [In-System Gameplay](./in-system-gameplay.md) layer. They're optional content that adds flavor, provides an alternative way to earn credits, and deepens the sense of a lived-in universe. A player should be able to sit down at a cantina table and lose an hour to a card game without touching the trade screen.

**Design principle**: Each mini-game should be genuinely fun to play on its own merits. If a player would seek it out for entertainment and not just rewards, the design is working.

**Design principle**: Thematic resonance. Every game reflects the world it exists in — traders bluff about cargo, miners push their luck, officers play strategy games. The mini-games are a window into the culture.

---

## 1. Void's Gambit

A card game played by traders and smugglers across the galaxy. The most popular game in cantinas from core worlds to frontier outposts.

### 1.1 Lore

"Void's Gambit started in the cantinas of the Free Reaches — frontier spacers with too much downtime and not enough credits. The rules spread along trade routes like cargo, picking up house variants at every station. The name comes from the dreaded Void cards — the empty hold dressed up as a fortune. Every trader knows the feeling: you've declared a full manifest to customs, the inspector is walking over, and half your hold is vacuum. That's Void's Gambit."

### 1.2 Components

**The Deck** — 42 cards total:

4 suits of 10 cards each (values 1–10):
| Suit | Thematic identity | Colour |
|---|---|---|
| Raw Materials | The basics — ore, fuel, food. Honest cargo | Amber/brown |
| Refined Goods | Processed materials — alloys, chemicals, textiles. Solid middle ground | Silver/blue |
| Tech | Electronics, components, instruments. High value, high profile | Green/white |
| Contraband | Weapons, narcotics, restricted goods. The smuggler's suit | Red/black |

2 special cards:
| Card | Value | Effect |
|---|---|---|
| **The Void** | 0 | If in your manifest at final reveal: destroys itself AND your highest-value card. If played face-down and undetected: scores the declared value. The ultimate bluff card |

### 1.3 Setup

1. Shuffle the deck
2. Deal **5 cards** to each player
3. Both players agree on a wager and place it in the pot
4. Remaining deck placed face-down as the draw pile

### 1.4 Round Structure

The game plays over **5 rounds**. Each round follows this sequence:

#### Draw Phase
Both players draw 1 card from the deck simultaneously. (Skip on round 1 — you already have your starting hand.)

This is the first emotional beat of each round. You might draw:
- Exactly the card you bluffed as earlier (relief — you can stop worrying about that inspect)
- A Void card (dread — now you need a plan)
- A high Contraband card (opportunity — the smuggling play is tempting)
- Nothing useful (recalculation — adjust your strategy)

#### Action Phase
Starting with the first player (alternates each round), each player takes **one action**:

**Play a card** — place a card from your hand into your manifest (personal tableau, max 5 cards over the game). Choose how:

- **Face-up (honest)** — the card is visible to both players. Its value is locked in. Safe, but reveals information. Your opponent now knows what you have and can plan around it
- **Face-down (declared)** — the card is placed face-down. You announce what it is: suit and value (e.g. "Tech 8"). The card could be exactly what you declared, or it could be anything else. It stays hidden until inspected or revealed at game end

**Inspect** — challenge one of your opponent's face-down cards. Point to it; they flip it:

- **Bluff caught**: the card doesn't match the declaration (wrong suit, wrong value, or both). The card is discarded from their manifest, and the bluffer takes a **-3 point penalty**. A decisive swing moment
- **Honest declaration**: the card matches. The inspector takes the **-3 point penalty** instead. The card remains, now face-up (confirmed honest). A costly mistake for the challenger

Inspecting costs your action — you don't play a card that round. This is the core opportunity cost: every inspection is a card you didn't add to your manifest. Inspect too aggressively and your manifest is thin. Inspect too little and your opponent's bluffs sail through.

**Discard and draw** — discard a card from your hand face-down to the discard pile and draw a replacement from the deck. You don't play a card to your manifest this round. A tempo loss in exchange for hand improvement. Useful when your hand is genuinely bad, but you're falling behind on manifest size.

### 1.5 Contraband Rules

The Contraband suit has special scoring that mirrors the smuggling dynamic in the actual game:

- **Face-up Contraband**: scores its printed face value normally. Safe, but you've declared your smuggling openly — no bonus for that
- **Face-down Contraband (undetected)**: scores **double** its printed value at final reveal. A Contraband 7 played face-down and surviving to the end is worth 14 points. The smuggling premium
- **Face-down Contraband (inspected)**: if caught during an inspection, the card is **confiscated** — removed from the game entirely (not just discarded from the manifest). The bluffer still takes the -3 penalty. Contraband is the highest-risk, highest-reward play in the game

This creates a persistent tension whenever an opponent plays a face-down card: "Is that Contraband? If I let it go and it's a Contraband 9, that's 18 points. But if I inspect and it's honest, I just lost 3 points and my action..."

### 1.6 The Void

The 2 Void cards are the game's wildcard — the "oh no" draw and the "did they really?" bluff.

**If a Void is in your manifest at final reveal** (round 5):
- The Void itself scores 0
- Your **highest-value card** in the manifest is also destroyed (removed before scoring)
- If you have two Voids in your manifest, each destroys a card — devastating

**If a Void is played face-down and declared as something**:
- It works like any bluff. If undetected, it scores the declared value
- If inspected and caught, normal bluff penalty (-3), and the Void is discarded

**If a Void is inspected and you declared it honestly as "Void"**:
- Why would you? Declaring a card honestly as Void means the inspector catches you being honest, takes the -3 penalty, and your Void is now face-up in your manifest... where it will destroy your highest card at reveal. There is no good way to play a Void honestly. That's the point — drawing a Void forces you into a bluff

**The mind game**: If your opponent knows there are Void cards in the deck, every face-down declaration of a high-value card carries an extra layer of suspicion. "They declared Tech 10... but what if that's a Void? If I don't inspect and it's a Void, they score 10 and I dodged a bullet. But if I don't inspect and it's actually a Tech 10, they score 10 legitimately. Either way it scores 10... unless..." The Void's threat is as much psychological as mechanical.

**Strategic note**: A Void in your hand isn't always bad. If you're behind and need a swing, declaring a Void as a high-value card is a desperation play that could win the game. If you're ahead, a Void is a liability you want to discard. Drawing a Void mid-game is always a dramatic moment.

### 1.7 Final Reveal & Scoring

After round 5, all remaining face-down cards are revealed simultaneously. This is the climax — every surviving bluff and every unchallenged declaration resolves at once.

**Scoring:**

1. **Card values**: Sum all cards in your manifest
   - Face-up cards: printed value
   - Face-down honest cards (survived to reveal): printed value
   - Face-down bluffs (survived to reveal): **declared** value (the bluff paid off)
   - Face-down Contraband (survived to reveal): **double** printed value
   - Void cards revealed: 0, and destroy the player's highest remaining card

2. **Set bonuses** (based on suits in your manifest after Void destruction):
   - **3 cards of one suit**: +5
   - **4 cards of one suit**: +15
   - **One of each suit** (4 different suits): +8
   - Only the best applicable bonus counts (they don't stack)

3. **Penalties**: Subtract any accumulated inspection penalties (-3 per failed inspect or caught bluff)

4. **Winner**: Highest total score wins the pot

**Tiebreaker**: If scores are equal, the player with more face-up cards in their manifest wins (the "honest trader" tiebreak). If still tied, split the pot.

### 1.8 Tension & Relief Map

The full arc of a game, beat by beat:

| Game moment | Emotion | Intensity | Design mechanism |
|---|---|---|---|
| Dealt opening hand | Assessment, scheming | Low | "What's my strategy? Do I have bluff material?" |
| Rounds 1–2 draws | Anticipation → assessment | Low–Medium | New cards enter. Opportunity or problem? |
| First face-down play | Commitment, nervousness | Medium | "I'm exposed now. Will they call it?" |
| Opponent's face-down play | Suspicion, calculation | Medium | "What are they hiding? Is it worth inspecting?" |
| Drawing a Void | Dread → scheming | High spike | "This is terrible... unless I can sell it as a Tech 9" |
| Inspect decision | Agonizing trade-off | High | "I could play my best card, or I could challenge their suspicious declaration..." |
| Successful inspection (caught a bluff) | Triumph, momentum | High relief | "I KNEW that wasn't a Tech 8!" |
| Failed inspection (they were honest) | Regret, penalty sting | Medium–High | "Wasted my action AND lost 3 points" |
| Mid-game reassessment (round 3) | Strategic recalculation | Medium | Suit bonus viability, bluff count, opponent reads |
| Opponent plays Contraband face-down | Heightened alarm | High | "That could be double value. Can I afford to ignore it?" |
| Round 5 (final actions) | Peak tension | Highest | Last chance to inspect or lock in a risky play |
| Final reveal — bluff survives | Smug satisfaction | High relief | "Got away with it" |
| Final reveal — bluff exposed | Mild sting (no inspect penalty, just loses declared value) | Medium | Unrevealed bluffs score their real value, not declared — the bluff just didn't earn its premium |
| Final reveal — Void exposed | Shock, drama | Highest spike | Someone's best card just got destroyed. The table erupts |
| Final scoring & winner | Resolution | Satisfaction/disappointment | Clear outcome, desire for rematch |

**Key design insight**: The draw mechanic creates *repeated* tension beats (every round has a "what did I get?" moment). The Void creates *dramatic* tension beats (rare but game-defining). Contraband creates *persistent* tension (every opponent face-down card could be a double-value smuggle). These three layers overlap to prevent flat stretches.

### 1.9 Strategic Depth

#### The Core Mind Game — Honest Traps vs. Bluffs

The game shares DNA with Cheat (also known as BS/Bullshit) — but instead of getting rid of cards, you're collecting them into a manifest. The key insight from Cheat that makes this game work: **playing honestly face-down is a weapon, not a waste**.

If you play a Tech 8 face-down and declare "Tech 8" truthfully, you're *baiting* an inspection. If your opponent bites, they lose 3 points and waste their action — you've weaponized their suspicion. This means your opponent can never be sure if a face-down card is:
- An honest trap (punishes inspection)
- A modest bluff (small upside, low suspicion)
- A bold bluff (big upside, high suspicion)
- A Void disguised as something valuable (the ultimate gamble)

The meta-game builds across multiple games against the same opponent. Bluff heavily early to build a reputation, then start playing honest face-downs to punish inspections. Once they stop inspecting, go back to bluffing. This cycle of reputation, expectation, and subversion is what gives the game legs beyond a single session.

#### Emergent Strategies

**The Honest Trader**: Play mostly face-up. Sprinkle in occasional honest face-down cards to bait inspections and punish suspicious opponents. Win on card quality and tiebreaker advantage (more face-up cards). Low variance, consistent. Best when your hand is genuinely strong.

*Weakness*: Predictable. Opponent knows your exact score from face-up cards and can calibrate their own risk precisely. No upside surprise.

**The Smuggler**: Lean into Contraband face-down plays. If even one Contraband card survives undetected, the double value is a massive swing. Accept that some will get inspected — the ones that survive more than compensate.

*Weakness*: Inspections are devastating for Contraband (confiscated entirely). A sharp opponent who inspects your Contraband declarations specifically can gut your score.

**The Bluffer**: Play multiple face-down cards with inflated declarations. Force your opponent into a dilemma: spend all their actions inspecting (leaving their own manifest thin) or let some bluffs through. Win on volume — not every bluff needs to work, just enough.

*Weakness*: If opponent ignores your bluffs and builds a strong honest manifest, your real card values (revealed at end) might not be enough. Requires the *threat* of your bluffs to alter opponent behavior.

**The Inspector**: Aggressive inspection strategy. Keep your opponent's bluffs in check while playing your own cards honestly. Win by denying your opponent's upside while building a clean manifest.

*Weakness*: Every inspection is an action you didn't use to build your own manifest. If opponent is playing honest traps, you're handing them free penalty points. The Inspector gets punished hardest by the Cheat dynamic.

**The Reputation Player**: The meta-strategy. Across multiple games, deliberately establish a pattern — then break it. Bluff three games in a row, then play the fourth game completely honestly face-down. Your opponent, conditioned to inspect everything, racks up penalties. This is the long game, and it's what makes the Station Regular NPC (who tracks player history) the most interesting opponent.

**The Void Gambler**: Drew a Void? Declare it as a high card and pray. This isn't a consistent strategy — it's a desperation play. But when it works, it's the most dramatic moment in the game. And the beauty is: your opponent doesn't know if you're playing a Void or an honest trap. The Void's existence poisons every high-value face-down declaration with doubt.

### 1.10 NPC Opponents

NPC opponents have distinct playstyles, providing variety and escalating challenge. Playstyle is expressed through action weights — how likely the NPC is to choose each action given the game state.

| Archetype | Playstyle | Inspect tendency | Bluff frequency | Found at |
|---|---|---|---|---|
| **Cautious Trader** | Plays most cards face-up. Rarely bluffs. Inspects only obvious lies (declared values far above average). The beginner opponent | Low | Very low | Core/federation cantinas |
| **Frontier Gambler** | Heavy bluffer. Plays most cards face-down with bold declarations. Rarely inspects — too busy building their own manifest. Volatile — easy to beat if you inspect well, dangerous if you don't | Very low | Very high | Frontier cantinas |
| **Sharp Smuggler** | Strategic Contraband focus. Subtle declarations (close to real values). Inspects when Contraband is likely. Reads the player's face-up cards to calculate odds. The first genuinely challenging opponent | Medium | Medium (targeted) | Black market locations |
| **Station Regular** | Balanced. Adapts to the player's behavior over repeated games (tracks player's bluff frequency across sessions). Plays the meta | Medium | Medium (adaptive) | Any cantina — recurring NPC |
| **The Shark** | High-stakes exclusive. Reads probability deeply — tracks which cards have appeared and calculates what's likely face-down. Uses Void offensively (declares it as whatever they calculate the player expects). The hardest NPC opponent | High (precise) | Medium (calculated) | High-stakes back rooms |

NPC dialogue during play adds personality:
- Cautious Trader: "I'll play it straight. Raw Materials 6." / "Hmm, I'll trust you on that one."
- Frontier Gambler: "Tech 10. Yeah, you heard me." / "Inspect? Nah, I've got cards to play."
- Sharp Smuggler: "...interesting choice. I'll let that slide. For now."
- Station Regular: "You bluffed the last three games. I'm watching every face-down card this time."
- The Shark: (silence) / "You hesitated before declaring that. Inspect."

### 1.11 Stakes & Play Locations

| Tier | Buy-in | Where | Opponents available | Notes |
|---|---|---|---|---|
| **Casual** | 10–50 CR | Any cantina | Cautious Trader, Frontier Gambler | Relaxed atmosphere. Good for learning. The default experience |
| **Standard** | 100–500 CR | Trade hub cantinas, busier stations | All archetypes up to Station Regular | More competitive. Stakes matter but won't break the bank |
| **High stakes** | 1,000–5,000 CR | Specific locations, back rooms accessed through NPC dialogue (reputation-gated) | The Shark + special NPCs | Invitation-only. Atmosphere shifts — quieter, more intense. Unique card variant prizes in addition to credits |

Stakes are always opt-in. No mission or progression element requires playing Void's Gambit. It's pure optional entertainment with an earning potential.

### 1.12 Future Expansion Hooks

These are NOT Phase 1 features. They're design space we're preserving for later development.

**Card variants** — rare cards with modified rules found as mission loot, purchased from specialty merchants, or won in high-stakes games:
- "Precursor Artifact" — wild card, can be declared as any suit. Found at archaeological excavation sites
- "Customs Raid" — play from hand to force opponent to flip one face-down card of your choice (doesn't use your action). Found at authoritarian stations
- "Insurance Policy" — protects one face-down card from inspection for the rest of the game. Found at corporate stations
- "Ghost Manifest" — when inspected, this card vanishes from your manifest but you take no penalty. Found at dark nebula locations

Card variants are collected and form a personal deck. Before a game, the player selects which variants to include (limited slots). This adds deck-building strategy on top of the game itself.

**House rules** — different systems/factions play with variant rules:
- Free Reaches: "Gambler's Round" — an extra 6th round where all cards must be played face-down
- Authoritarian space: Contraband suit is removed from the deck (banned). Smaller deck, different math
- Corporate space: "Leverage" — winner of the previous game gets to look at one card in their next opponent's hand before play begins
- Frontier space: "Dead Man's Draw" — if you draw two Voids in one game, you can reveal them both to instantly win (extremely rare, extremely dramatic)

**Tournament events** — periodic NPC tournaments at major stations. Entry fee, bracket format (win-and-advance), unique cosmetic or gameplay prizes. Multi-game format rewards consistency, not single-game luck.

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
- 3 NPC opponent archetypes: Cautious Trader, Frontier Gambler, Station Regular
- Casual and Standard stake tiers
- NPC dialogue during play (personality-driven commentary)
- Basic win/loss tracking per NPC

Phase 1 does NOT include:
- High-stakes tier or The Shark NPC
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
