// Void's Gambit — Game lifecycle and phase management
// Creates games, manages automatic phase transitions, advances rounds.

import type {
  GameState,
  GameConfig,
  GamePhase,
  LogActor,
  ManifestEntry,
} from "./types";
import { createDeck, createDemandDeck, shuffle, drawCard } from "./deck";
import { HAND_SIZE, MAX_ROUNDS } from "./constants";
import { determineWinner } from "./scoring";

// ── Game creation ───────────────────────────────────────────────

export function createGame(config: GameConfig): GameState {
  return {
    phase: "setup",
    config,
    deck: [],
    discardPile: [],
    demandDeck: [],
    demandHistory: [],
    currentDemand: null,
    player: { hand: [], manifest: [], penalties: 0 },
    npc: { hand: [], manifest: [], penalties: 0 },
    round: 0,
    firstPlayer: "player",
    log: [],
    result: null,
  };
}

// ── Start game ──────────────────────────────────────────────────

/** Shuffle decks, deal hands, advance to round 1 demand phase. */
export function startGame(state: GameState): GameState {
  if (state.phase !== "setup") {
    throw new Error("Game already started");
  }

  const { rng } = state.config;
  const deck = shuffle(createDeck(), rng);
  const demandDeck = shuffle(createDemandDeck(), rng);

  const playerHand = deck.slice(0, HAND_SIZE);
  const npcHand = deck.slice(HAND_SIZE, HAND_SIZE * 2);
  const remainingDeck = deck.slice(HAND_SIZE * 2);

  return {
    ...state,
    phase: "demand",
    deck: remainingDeck,
    demandDeck,
    player: { ...state.player, hand: playerHand },
    npc: { ...state.npc, hand: npcHand },
    round: 1,
    firstPlayer: "player",
    log: [{ type: "round_start", round: 1 }],
  };
}

// ── Automatic phase advancement ─────────────────────────────────

/**
 * Advance through automatic (non-interactive) phases.
 * Call this for phases that don't require player/NPC input:
 * demand, draw, round_end, final_reveal.
 */
export function advancePhase(state: GameState): GameState {
  switch (state.phase) {
    case "demand":
      return advanceDemand(state);
    case "draw":
      return advanceDraw(state);
    case "round_end":
      return advanceRoundEnd(state);
    case "final_reveal":
      return advanceFinalReveal(state);
    default:
      return state;
  }
}

// ── Phase handlers ──────────────────────────────────────────────

function advanceDemand(state: GameState): GameState {
  const [suit, ...remaining] = state.demandDeck;

  const newState: GameState = {
    ...state,
    demandDeck: remaining,
    demandHistory: [...state.demandHistory, suit],
    currentDemand: suit,
    log: [
      ...state.log,
      { type: "demand_reveal", suit, round: state.round },
    ],
  };

  // Round 1: skip draw, go straight to first declaration
  if (state.round === 1) {
    return {
      ...newState,
      phase: getFirstDeclarePhase(state.firstPlayer),
    };
  }

  return { ...newState, phase: "draw" };
}

function advanceDraw(state: GameState): GameState {
  let deck = state.deck;
  let playerHand = state.player.hand;
  let npcHand = state.npc.hand;
  const newLog = [...state.log];

  const playerDraw = drawCard(deck);
  if (playerDraw) {
    playerHand = [...playerHand, playerDraw[0]];
    deck = playerDraw[1];
    newLog.push({ type: "draw", actor: "player", round: state.round });
  }

  const npcDraw = drawCard(deck);
  if (npcDraw) {
    npcHand = [...npcHand, npcDraw[0]];
    deck = npcDraw[1];
    newLog.push({ type: "draw", actor: "npc", round: state.round });
  }

  return {
    ...state,
    phase: getFirstDeclarePhase(state.firstPlayer),
    deck,
    player: { ...state.player, hand: playerHand },
    npc: { ...state.npc, hand: npcHand },
    log: newLog,
  };
}

function advanceRoundEnd(state: GameState): GameState {
  if (state.round >= MAX_ROUNDS) {
    return { ...state, phase: "final_reveal" };
  }

  const nextRound = state.round + 1;
  const nextFirstPlayer: LogActor =
    state.firstPlayer === "player" ? "npc" : "player";

  return {
    ...state,
    phase: "demand",
    round: nextRound,
    firstPlayer: nextFirstPlayer,
    currentDemand: null,
    log: [...state.log, { type: "round_start", round: nextRound }],
  };
}

function advanceFinalReveal(state: GameState): GameState {
  const revealManifest = (manifest: ManifestEntry[]) =>
    manifest.map((e) => (e.revealed ? e : { ...e, revealed: true }));

  const revealed: GameState = {
    ...state,
    player: {
      ...state.player,
      manifest: revealManifest(state.player.manifest),
    },
    npc: { ...state.npc, manifest: revealManifest(state.npc.manifest) },
    log: [...state.log, { type: "final_reveal" }],
  };

  const result = determineWinner(revealed);

  return { ...revealed, phase: "complete", result };
}

// ── Helpers ─────────────────────────────────────────────────────

function getFirstDeclarePhase(firstPlayer: LogActor): GamePhase {
  return firstPlayer === "player" ? "player_declare" : "npc_declare";
}

// ── Query helpers ───────────────────────────────────────────────

/** Get the declared running total for a player (sum of all declarations). */
export function getDeclaredTotal(state: GameState, actor: LogActor): number {
  const manifest =
    actor === "player" ? state.player.manifest : state.npc.manifest;
  return manifest
    .filter((e) => !e.caught)
    .reduce((sum, e) => sum + e.declaration.value, 0);
}

/** Get a player's manifest entry for a specific round (if any). */
export function getRoundEntry(
  state: GameState,
  actor: LogActor,
  round: number,
): ManifestEntry | undefined {
  const manifest =
    actor === "player" ? state.player.manifest : state.npc.manifest;
  return manifest.find((e) => e.round === round);
}
