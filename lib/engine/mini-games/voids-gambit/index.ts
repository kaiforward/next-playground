// Void's Gambit — Public API

// Types
export type {
  Suit,
  CardType,
  Card,
  Declaration,
  ManifestEntry,
  PlayerState,
  NpcArchetype,
  NpcDifficulty,
  NpcIdentity,
  GamePhase,
  GameAction,
  GameConfig,
  LogActor,
  LogEntry,
  ResolvedCardDetail,
  ScoringBreakdown,
  GameResult,
  GameState,
  ActionResult,
} from "./types";

// Constants
export {
  SUITS,
  SUIT_LABELS,
  SUIT_COLORS,
  VALUES_PER_SUIT,
  VOID_COUNT,
  DECK_SIZE,
  HAND_SIZE,
  MAX_ROUNDS,
  WRONG_CALL_PENALTY,
  NPC_NAMES,
  NPC_FLAVOR,
  NPC_DIFFICULTY,
  NPC_DIALOGUE,
  NPC_DECLARE_DELAY,
  NPC_CALL_DELAY,
  DEMAND_REVEAL_DELAY,
  CARD_REVEAL_DELAY,
} from "./constants";

// Deck
export { createDeck, createDemandDeck, shuffle, drawCard } from "./deck";

// Game lifecycle
export {
  createGame,
  startGame,
  advancePhase,
  getDeclaredTotal,
  getRoundEntry,
} from "./game";

// Actions
export {
  declare,
  callOpponent,
  passCall,
  isHonestDeclaration,
} from "./actions";

// Scoring
export { calculateScore, determineWinner } from "./scoring";

// AI
export { chooseDeclaration, chooseCallDecision } from "./ai";
export type { AiDeclaration } from "./ai";
