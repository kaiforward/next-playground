// Void's Gambit — Type definitions
// Pure types, no runtime dependencies.

// ── Card types ──────────────────────────────────────────────────

export type Suit = "raw_materials" | "refined_goods" | "tech" | "luxuries";

export interface StandardCard {
  id: number;
  type: "standard";
  suit: Suit;
  value: number; // 1-7
}

export interface VoidCard {
  id: number;
  type: "void";
  suit: null;
  value: 0;
}

export type Card = StandardCard | VoidCard;

// ── Declaration ─────────────────────────────────────────────────

export interface Declaration {
  suit: Suit; // must match the demanded suit
  value: number; // 1-7
}

// ── Manifest ────────────────────────────────────────────────────

export interface ManifestEntry {
  card: Card;
  declaration: Declaration;
  round: number;
  revealed: boolean; // flipped via call or final reveal
  caught: boolean; // true if called and the declaration was a lie
  calledBy: LogActor | null; // who called this card (null if uncalled)
}

// ── Player state ────────────────────────────────────────────────

export interface PlayerState {
  hand: Card[];
  manifest: ManifestEntry[];
  penalties: number; // accumulated penalty points
}

// ── NPC archetypes ──────────────────────────────────────────────

export type NpcArchetype =
  | "cautious_trader"
  | "frontier_gambler"
  | "sharp_smuggler"
  | "station_regular";

export type NpcDifficulty = 1 | 2 | 3;

export interface NpcIdentity {
  archetype: NpcArchetype;
  displayName: string;
  difficulty: NpcDifficulty;
  flavorText: string;
}

// ── Game phases ─────────────────────────────────────────────────

export type GamePhase =
  | "setup"
  | "demand" // demand card being revealed
  | "draw" // both players draw
  | "player_declare" // waiting for player to declare
  | "npc_declare" // NPC is declaring
  | "player_call" // player decides to call or pass
  | "npc_call" // NPC decides to call or pass
  | "round_end" // transition to next round
  | "final_reveal" // all cards revealed
  | "complete"; // game over

// ── Game config ─────────────────────────────────────────────────

export interface GameConfig {
  npcArchetype: NpcArchetype;
  npcDisplayName: string;
  wager: number;
  rng: () => number;
}

// ── Log entries ─────────────────────────────────────────────────

export type LogActor = "player" | "npc";

export type LogEntry =
  | { type: "round_start"; round: number }
  | { type: "demand_reveal"; suit: Suit; round: number }
  | { type: "draw"; actor: LogActor; round: number }
  | {
      type: "declare";
      actor: LogActor;
      declaration: Declaration;
      round: number;
    }
  | {
      type: "call_success";
      caller: LogActor;
      target: LogActor;
      card: Card;
      declaration: Declaration;
      penalty: number;
      round: number;
    }
  | {
      type: "call_fail";
      caller: LogActor;
      target: LogActor;
      card: Card;
      declaration: Declaration;
      round: number;
    }
  | { type: "call_pass"; actor: LogActor; round: number }
  | { type: "final_reveal" };

// ── Scoring ─────────────────────────────────────────────────────

export interface ResolvedCardDetail {
  card: Card;
  declaration: Declaration;
  honest: boolean;
  caught: boolean;
  scoredValue: number;
  round: number;
}

export interface ScoringBreakdown {
  cardValues: number;
  penalties: number;
  total: number;
  cardDetails: ResolvedCardDetail[];
}

export interface GameResult {
  winner: "player" | "npc" | "tie";
  playerScore: ScoringBreakdown;
  npcScore: ScoringBreakdown;
  potWinnings: number;
}

// ── Game state ──────────────────────────────────────────────────

export interface GameState {
  phase: GamePhase;
  config: GameConfig;
  deck: Card[];
  discardPile: Card[];
  demandDeck: Suit[];
  demandHistory: Suit[]; // suits revealed so far
  currentDemand: Suit | null;
  player: PlayerState;
  npc: PlayerState;
  round: number; // 1-7
  firstPlayer: LogActor; // who declares first this round
  log: LogEntry[];
  result: GameResult | null;
}

// ── NPC presentation ────────────────────────────────────────────

export interface WagerLimits {
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface NpcDialogueSet {
  greeting: string[];
  declare: string[];
  declareHigh: string[];
  callSuccess: string[];
  callFail: string[];
  callMemory: string[];
  calledAndCaught: string[];
  calledAndHonest: string[];
  pass: string[];
  winning: string[];
  losing: string[];
  tie: string[];
  reveal: string[];
}

// ── Result type ─────────────────────────────────────────────────

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };
