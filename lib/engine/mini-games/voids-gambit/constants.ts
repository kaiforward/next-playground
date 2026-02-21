// Void's Gambit — Game constants, NPC profiles, AI weights, dialogue

import type {
  Suit,
  NpcArchetype,
  NpcDifficulty,
  WagerLimits,
  NpcDialogueSet,
} from "./types";

// ── Deck configuration ──────────────────────────────────────────

export const SUITS: readonly Suit[] = [
  "raw_materials",
  "refined_goods",
  "tech",
  "luxuries",
];

export const SUIT_LABELS: Record<Suit, string> = {
  raw_materials: "Raw Materials",
  refined_goods: "Refined Goods",
  tech: "Tech",
  luxuries: "Luxuries",
};

export const SUIT_COLORS: Record<Suit, string> = {
  raw_materials: "amber",
  refined_goods: "blue",
  tech: "green",
  luxuries: "purple",
};

export const VALUES_PER_SUIT = 7; // 1-7
export const VOID_COUNT = 2;
export const DECK_SIZE = SUITS.length * VALUES_PER_SUIT + VOID_COUNT; // 30
export const DEMAND_PER_SUIT = 2;
export const DEMAND_DECK_SIZE = SUITS.length * DEMAND_PER_SUIT; // 8

// ── Game rules ──────────────────────────────────────────────────

export const HAND_SIZE = 5;
export const MAX_ROUNDS = 7;
export const WRONG_CALL_PENALTY = 3;

// ── AI weights ──────────────────────────────────────────────────

// How often the NPC inflates their declaration value (0 = always honest, 1 = always lies)
export const BLUFF_AGGRESSION: Record<NpcArchetype, number> = {
  cautious_trader: 0.15,
  frontier_gambler: 0.8,
  sharp_smuggler: 0.4,
  station_regular: 0.35,
};

// Base probability of calling the player's declaration
export const CALL_RATE: Record<NpcArchetype, number> = {
  cautious_trader: 0.15,
  frontier_gambler: 0.1,
  sharp_smuggler: 0.35,
  station_regular: 0.25,
};

// Max value inflation when bluffing (added to real value)
export const MAX_INFLATION: Record<NpcArchetype, number> = {
  cautious_trader: 1,
  frontier_gambler: 4,
  sharp_smuggler: 2,
  station_regular: 3,
};

// Station Regular adaptation: how much to increase call rate
// per detected player lie (within the current game).
export const REGULAR_CALL_ADAPT = 0.1;

// Card counting: probability of calling when NPC holds the exact declared card.
export const CARD_COUNTING_CERTAINTY = 0.95;

// Per-value-above-4 increase to call probability (e.g. declaring 7 adds +0.12).
export const VALUE_SUSPICION_RATE = 0.04;

// Number of known cards of a suit that triggers the scarcity bonus.
export const SUIT_SCARCITY_THRESHOLD = 5;

// Call probability bonus when suit scarcity is detected.
export const SUIT_SCARCITY_BONUS = 0.15;

// Upper cap on hunch-based call probability (prevents guaranteed calls).
export const MAX_CALL_PROBABILITY = 0.9;

// NPC memory: probability of checking manifest/revealed cards for duplicates.
// When triggered, the NPC catches provable lies (duplicate cards) with certainty.
// Cautious trader doesn't think to check. Others scale with experience.
export const MEMORY_RECALL: Record<NpcArchetype, number> = {
  cautious_trader: 0,
  frontier_gambler: 0.5,
  sharp_smuggler: 0.85,
  station_regular: 0.95,
};

// ── NPC identity ────────────────────────────────────────────────

export const NPC_NAMES: Record<NpcArchetype, string[]> = {
  cautious_trader: [
    "Hal Mercer",
    "Jessa Bright",
    "Tomás Kale",
    "Ren Astley",
    "Sera Finn",
  ],
  frontier_gambler: [
    "Dax Riven",
    "Mira Colt",
    "Zeke Thorn",
    "Lena Cross",
    "Ace Harlow",
  ],
  station_regular: ["Kaz"],
  sharp_smuggler: [
    "Voss",
    "Nika Strand",
    "Cole Ashwick",
    "Pax Duval",
    "Yara Sable",
  ],
};

export const NPC_FLAVOR: Record<NpcArchetype, string> = {
  cautious_trader: "Prefers a quiet game. Doesn't like surprises.",
  frontier_gambler: "Sits down with a grin and orders another drink.",
  station_regular:
    "Kaz has been here longer than the station. Watches everything.",
  sharp_smuggler: "Quiet. Calculating. Watches your hands, not your face.",
};

export const NPC_DIFFICULTY: Record<NpcArchetype, NpcDifficulty> = {
  cautious_trader: 1,
  frontier_gambler: 2,
  station_regular: 3,
  sharp_smuggler: 2,
};

export const NPC_WAGER_LIMITS: Record<NpcArchetype, WagerLimits> = {
  cautious_trader:  { min: 10,  max: 200,  step: 10, default: 50 },
  sharp_smuggler:   { min: 25,  max: 500,  step: 25, default: 100 },
  station_regular:  { min: 50,  max: 1000, step: 50, default: 200 },
  frontier_gambler: { min: 10,  max: 750,  step: 25, default: 100 },
};

// ── NPC dialogue ────────────────────────────────────────────────

export const NPC_DIALOGUE: Record<NpcArchetype, NpcDialogueSet> = {
  cautious_trader: {
    greeting: [
      "A friendly game? Sure, I'll play it straight.",
      "Don't expect any tricks from me.",
    ],
    declare: [
      "Straight and simple.",
      "Nothing fancy here.",
      "That's what I've got.",
    ],
    declareHigh: [
      "I'll... keep this one quiet.",
      "Don't read into it.",
    ],
    callSuccess: [
      "I knew something wasn't right!",
      "Caught you.",
    ],
    callFail: [
      "Well... my mistake. Sorry about that.",
      "I should have trusted you.",
    ],
    callMemory: [
      "Wait... didn't I see that card already?",
    ],
    calledAndCaught: [
      "Fair enough. You got me.",
      "I shouldn't have tried that.",
    ],
    calledAndHonest: [
      "See? Honest goods, honestly played.",
      "I told you it was real.",
    ],
    pass: [
      "I'll trust you on that one.",
      "Looks fine to me.",
    ],
    winning: [
      "Looks like honest play pays off.",
      "Steady wins the race.",
    ],
    losing: [
      "Well played. Maybe I should take more risks.",
      "Can't win them all playing it safe.",
    ],
    tie: [
      "A fair game. Even split.",
      "Can't complain about an honest draw.",
    ],
    reveal: [
      "Let's see what we've got.",
      "Moment of truth.",
    ],
  },

  frontier_gambler: {
    greeting: [
      "Ready to lose some credits?",
      "Pull up a chair. Let's make this interesting.",
    ],
    declare: [
      "Yeah, you heard me.",
      "Wouldn't you like to know what that really is.",
      "Go ahead. Call it. I dare you.",
    ],
    declareHigh: [
      "That's a big one. Trust me.",
      "Top shelf cargo right there.",
      "Read it and weep.",
    ],
    callSuccess: [
      "Ha! Even I check sometimes.",
      "Thought you could sneak that past me?",
    ],
    callFail: [
      "Worth a shot.",
      "Eh, cost of doing business.",
    ],
    callMemory: [
      "Hold on... I've seen that card before.",
      "That card's already on the table, friend.",
    ],
    calledAndCaught: [
      "You win some, you lose some.",
      "Can't blame me for trying.",
    ],
    calledAndHonest: [
      "See? Not always bluffing.",
      "Surprise. That one was real.",
    ],
    pass: [
      "Nah, I've got my own game to play.",
      "Call? Where's the fun in that?",
    ],
    winning: [
      "That's how it's done on the frontier.",
      "Fortune favors the bold, friend.",
    ],
    losing: [
      "The cards will turn. They always do.",
      "Next game. Double or nothing?",
    ],
    tie: [
      "A draw? Where's the fun in that?",
      "Even money. Boring. Let's go again.",
    ],
    reveal: [
      "Here we go — moment of truth!",
      "Flip 'em!",
    ],
  },

  station_regular: {
    greeting: [
      "Ah, a new face. Let's see what you've got.",
      "I've been watching you play. Interesting style.",
    ],
    declare: [
      "Make of it what you will.",
      "Interesting choice, wouldn't you say?",
      "Read into that however you like.",
    ],
    declareHigh: [
      "I'll keep this one close.",
      "Something to think about.",
    ],
    callSuccess: [
      "Predictable. You'll need to mix it up.",
      "I had a feeling about that one.",
    ],
    callFail: [
      "Hmm. Adjusting my read on you.",
      "Well played. You're less predictable than I thought.",
    ],
    callMemory: [
      "I remember that card. You played it rounds ago.",
      "I've been keeping track. That one's already been played.",
      "Nice try, but I don't forget a card.",
    ],
    calledAndCaught: [
      "You're sharp. I'll adapt.",
      "Noted. Won't make that mistake twice.",
    ],
    calledAndHonest: [
      "I play honest more than you think.",
      "Not everything is a bluff.",
    ],
    pass: [
      "I'll let that slide. For now.",
      "Interesting. I'll remember that.",
    ],
    winning: [
      "Experience counts.",
      "Reading people is half the game.",
    ],
    losing: [
      "You've got a good poker face. I'll remember that.",
      "Alright, you got me. This time.",
    ],
    tie: [
      "Even. That doesn't happen often.",
      "A draw. I'll take it as a learning experience.",
    ],
    reveal: [
      "Let's see who read whom.",
      "The reveal. My favorite part.",
    ],
  },

  sharp_smuggler: {
    greeting: [
      "A game, then. Don't waste my time.",
      "Sit. Play. We'll see who's sharper.",
    ],
    declare: [
      "Take it or leave it.",
      "Mind your own manifest.",
      "That's my declaration.",
    ],
    declareHigh: [
      "You don't need to see this one.",
      "Some things are better left unchecked.",
    ],
    callSuccess: [
      "Thought so.",
      "Sloppy. I expected better.",
    ],
    callFail: [
      "Hmm. You're more careful than I thought.",
      "Fair enough. Won't happen again.",
    ],
    callMemory: [
      "That card's been played. I count every one.",
      "I remember exactly what's hit this table. That's a duplicate.",
    ],
    calledAndCaught: [
      "Calculated risk. Didn't pay off this time.",
      "Sharp eye. I'll give you that.",
    ],
    calledAndHonest: [
      "I move real cargo. Check all you want.",
      "Not everything I carry is fake.",
    ],
    pass: [
      "I'll let that one go.",
      "Doesn't concern me.",
    ],
    winning: [
      "Sharper hand wins. Simple as that.",
      "Don't feel bad. Most people lose to me.",
    ],
    losing: [
      "Well played. I underestimated you.",
      "Next time, I won't hold back.",
    ],
    tie: [
      "Dead even. I'll take the rematch.",
      "A draw. Sharper next time.",
    ],
    reveal: [
      "Let's see what you were hiding.",
      "Cards on the table. Literally.",
    ],
  },
};

// ── Timing (UI delays in ms) ────────────────────────────────────

export const NPC_DECLARE_DELAY = 1200;
export const NPC_CALL_DELAY = 1000;
export const DEMAND_REVEAL_DELAY = 800;
export const CARD_REVEAL_DELAY = 600;
