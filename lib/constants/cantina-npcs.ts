import type { NpcArchetype } from "@/lib/engine/mini-games/voids-gambit";
import type { EventTypeId } from "@/lib/constants/events";

// ── NPC type union ──────────────────────────────────────────────

export type CantinaNpcType = "bartender" | NpcArchetype;

// ── Greeting templates (indexed by visit bucket) ────────────────

export interface GreetingSet {
  /** First visit (visits === 0 before increment) */
  first: readonly string[];
  /** 1–4 visits */
  returning: readonly string[];
  /** 5+ visits */
  regular: readonly string[];
}

export const BARTENDER_GREETINGS: GreetingSet = {
  first: [
    "A new face. What can I get you?",
    "Haven't seen you before. Welcome to the station.",
    "First time? The drinks are strong and the rumors are free.",
  ],
  returning: [
    "Back again? The usual?",
    "Good to see a familiar face. What'll it be?",
    "You're becoming a regular. Pull up a stool.",
  ],
  regular: [
    "Your stool's been waiting for you.",
    "I was just telling someone about you. The usual?",
    "Right on time. I already started pouring.",
  ],
};

export const PATRON_GREETINGS: Record<NpcArchetype, GreetingSet> = {
  cautious_trader: {
    first: [
      "You look like someone who plays it safe. Interested in a friendly game?",
      "Care for a hand? I don't play for much — just enough to keep it interesting.",
    ],
    returning: [
      "Back for another round? I've been practicing.",
      "Ah, my favorite sparring partner. Same stakes?",
    ],
    regular: [
      "I was hoping you'd show up. Nobody else plays as cleanly as you.",
      "Our table, our stakes. Shall we?",
    ],
  },
  frontier_gambler: {
    first: [
      "Hey stranger! Want to test your luck? The cards are hot tonight.",
      "You look like you could use some excitement. I'm dealing.",
    ],
    returning: [
      "Ready to lose again? Just kidding — mostly.",
      "The gambler returns! Higher stakes this time?",
    ],
    regular: [
      "There's my lucky charm! Or is it unlucky? I can never tell.",
      "The cards have been calling your name all day.",
    ],
  },
  sharp_smuggler: {
    first: [
      "You've got sharp eyes. Think you can read me across the table?",
      "A new mark — I mean, player. Care for a game?",
    ],
    returning: [
      "You came back. Either brave or foolish. Let's find out which.",
      "Thought I scared you off. Guess you've got more nerve than I thought.",
    ],
    regular: [
      "The only one worth playing against in this dump. Sit.",
      "I save my best games for you. Don't disappoint me.",
    ],
  },
  station_regular: {
    first: [
      "New around here? I play every night. Pull up a chair if you dare.",
      "Another challenger? Good. I was getting bored.",
    ],
    returning: [
      "You again? Good. I owe you a rematch.",
      "Couldn't stay away, huh? Me neither.",
    ],
    regular: [
      "Our nightly game. Wouldn't miss it.",
      "Same time, same table. This is tradition now.",
    ],
  },
};

// ── Tip message templates ───────────────────────────────────────

export const LOCAL_TIP_TEMPLATES = [
  "I heard {good} is going for a steal at the market right now.",
  "Word is the market's got {good} at rock-bottom prices.",
  "If you've got cargo space, {good} is practically being given away here.",
] as const;

export const NEIGHBOR_TIP_TEMPLATES = [
  "A trader from {system} mentioned {good} is fetching a premium there.",
  "Ships heading to {system} are stocking up on {good}. Must be money in it.",
  "Between you and me, {good} prices at {system} are through the roof.",
] as const;

export const NO_TIPS_LINES = [
  "Market's been quiet. Nothing worth reporting.",
  "No big deals right now. Check back after the next supply run.",
  "Prices are flat across the board. Boring times for traders.",
] as const;

// ── Rumor message templates ─────────────────────────────────────

export const RUMOR_TEMPLATES: Partial<Record<EventTypeId, readonly string[]>> = {
  inner_system_conflict: [
    "There's fighting at {system}. Conflict's bad for business, but good for arms dealers.",
    "Heard shots fired near {system}. People are getting nervous.",
  ],
  plague: [
    "Something nasty going around {system}. Medicine prices are sky-high.",
    "A sickness hit {system}. Ships are avoiding the area.",
  ],
  trade_festival: [
    "Big trade festival at {system}! Merchants from all over heading that way.",
    "Market's buzzing about a festival near {system}. Could be profitable.",
  ],
  conflict_spillover: [
    "Conflict's spreading from {system}. Trade routes are getting dicey.",
    "Trouble's leaking out of {system}. Watch your back on those lanes.",
  ],
  plague_risk: [
    "There's talk of contamination near {system}. Could be nothing... or not.",
    "Medical supplies are being hoarded near {system}. Just a precaution, they say.",
  ],
  mining_boom: [
    "Miners at {system} struck something big. Ore's flowing like water.",
    "There's a rush at {system}. Every prospector in the sector's heading there.",
  ],
  ore_glut: [
    "Too much ore on the market near {system}. Prices are crashing.",
    "Ore market's flooded around {system}. Sellers are desperate.",
  ],
  supply_shortage: [
    "Supply lines near {system} are strained. Prices are climbing.",
    "Goods are scarce around {system}. If you've got stock, now's the time.",
  ],
  pirate_raid: [
    "Pirates hit a convoy near {system}. Traders are spooked.",
    "Watch the lanes around {system}. Pirates have been active.",
  ],
  solar_storm: [
    "Solar storm disrupted operations at {system}. Navigation's a mess.",
    "Bad solar weather near {system}. Ships are waiting it out.",
  ],
};

// ── Archetype display config ────────────────────────────────────

/** Canonical list for iteration — matches the NpcArchetype union. */
export const NPC_ARCHETYPES: readonly NpcArchetype[] = [
  "cautious_trader",
  "frontier_gambler",
  "sharp_smuggler",
  "station_regular",
];

export const ARCHETYPE_DISPLAY: Record<
  NpcArchetype,
  { label: string; icon: string; badgeColor: "green" | "amber" | "purple" | "red" }
> = {
  cautious_trader: { label: "Cautious Trader", icon: "\uD83E\uDDD1\u200D\uD83D\uDCBC", badgeColor: "green" },
  frontier_gambler: { label: "Frontier Gambler", icon: "\uD83C\uDFB2", badgeColor: "amber" },
  sharp_smuggler: { label: "Sharp Smuggler", icon: "\uD83D\uDD75\uFE0F", badgeColor: "purple" },
  station_regular: { label: "Station Regular", icon: "\uD83C\uDF7A", badgeColor: "red" },
};

// ── No-content fallback lines ───────────────────────────────────

export const NO_RUMORS_LINES = [
  "Quiet out there lately. Almost too quiet.",
  "Haven't heard anything interesting. Maybe that's a good thing.",
  "No news is good news, I suppose. Or maybe I just need better sources.",
] as const;
