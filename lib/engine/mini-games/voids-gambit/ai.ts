// Void's Gambit — NPC AI
// Chooses declarations and call decisions based on archetype weights,
// card counting, and game state.

import type {
  GameState,
  Card,
  Declaration,
  NpcArchetype,
  ManifestEntry,
} from "./types";
import {
  VALUES_PER_SUIT,
  BLUFF_AGGRESSION,
  CALL_RATE,
  MAX_INFLATION,
  REGULAR_CALL_ADAPT,
} from "./constants";

// ── Declaration ─────────────────────────────────────────────────

export interface AiDeclaration {
  cardId: number;
  declaration: Declaration;
}

/** Choose a card from hand and a declaration for this round. */
export function chooseDeclaration(state: GameState): AiDeclaration {
  const { npc, currentDemand, config } = state;
  const { rng, npcArchetype } = config;

  if (!currentDemand) throw new Error("No demand set");

  const hand = npc.hand;
  const matchingCards = hand.filter(
    (c) => c.type === "standard" && c.suit === currentDemand,
  );
  const voidCards = hand.filter((c) => c.type === "void");
  const otherCards = hand.filter(
    (c) => c.type === "standard" && c.suit !== currentDemand,
  );

  let chosenCard: Card;
  let declaredValue: number;

  if (matchingCards.length > 0) {
    // Has the right suit — pick a card and decide whether to inflate
    chosenCard = pickCard(matchingCards, rng);
    declaredValue = chooseValue(
      chosenCard.value,
      npcArchetype,
      rng,
    );
  } else if (voidCards.length > 0) {
    // Use a Void (wild suit, must lie about value)
    chosenCard = voidCards[0];
    declaredValue = chooseVoidValue(npcArchetype, rng);
  } else {
    // No matching suit and no Voids — must lie about suit
    chosenCard = pickCard(otherCards, rng);
    declaredValue = chooseValue(
      chosenCard.value,
      npcArchetype,
      rng,
    );
  }

  return {
    cardId: chosenCard.id,
    declaration: { suit: currentDemand, value: declaredValue },
  };
}

/** Pick a card from a list. Prefers higher values for aggressive archetypes. */
function pickCard(cards: Card[], rng: () => number): Card {
  // Simple random selection — card choice strategy can be refined later
  return cards[Math.floor(rng() * cards.length)];
}

/**
 * Choose the declared value for a standard card.
 * May inflate based on archetype aggression.
 */
function chooseValue(
  realValue: number,
  archetype: NpcArchetype,
  rng: () => number,
): number {
  const aggression = BLUFF_AGGRESSION[archetype];

  if (rng() >= aggression) {
    // Honest declaration
    return realValue;
  }

  // Inflate value
  const maxInfl = MAX_INFLATION[archetype];
  const inflation = Math.ceil(rng() * maxInfl);
  return Math.min(realValue + inflation, VALUES_PER_SUIT);
}

/** Choose a declared value for a Void card (always a lie). */
function chooseVoidValue(
  archetype: NpcArchetype,
  rng: () => number,
): number {
  // Cautious: low values (2-4), Aggressive: high values (4-7)
  switch (archetype) {
    case "cautious_trader":
      return Math.floor(rng() * 3) + 2; // 2-4
    case "frontier_gambler":
      return Math.floor(rng() * 4) + 4; // 4-7
    case "sharp_smuggler":
      return Math.floor(rng() * 3) + 3; // 3-5
    case "station_regular":
      return Math.floor(rng() * 4) + 3; // 3-6
  }
}

// ── Call decision ───────────────────────────────────────────────

/** Decide whether the NPC should call the player's declaration this round. */
export function chooseCallDecision(state: GameState): boolean {
  const { config, player, npc } = state;
  const { rng, npcArchetype } = config;

  // Find player's card this round
  const playerEntry = player.manifest.find(
    (e) => e.round === state.round && !e.caught,
  );
  if (!playerEntry) return false;

  const declaredValue = playerEntry.declaration.value;
  const declaredSuit = playerEntry.declaration.suit;

  // Card counting: does NPC hold the exact card the player declared?
  const holdsExactCard = npc.hand.some(
    (c) =>
      c.type === "standard" &&
      c.suit === declaredSuit &&
      c.value === declaredValue,
  );

  if (holdsExactCard) {
    // NPC knows for certain this is a lie — almost always call
    return rng() < 0.95;
  }

  // Base call rate from archetype
  let callProbability = CALL_RATE[npcArchetype];

  // Higher declarations are more suspicious
  callProbability += (declaredValue - 4) * 0.04;

  // Station Regular adapts: increase call rate if player has been caught lying
  if (npcArchetype === "station_regular") {
    const playerLiesCaught = countCaughtLies(player.manifest);
    callProbability += playerLiesCaught * REGULAR_CALL_ADAPT;
  }

  // Card counting: how many of the demanded suit does the NPC hold?
  // More cards of that suit = higher chance player is lying about suit
  const npcSuitCount = npc.hand.filter(
    (c) => c.type === "standard" && c.suit === declaredSuit,
  ).length;
  const knownSuitCards = countKnownSuitCards(state, declaredSuit);
  // If many cards of the suit are accounted for, player is less likely to have it
  if (npcSuitCount + knownSuitCards >= 5) {
    callProbability += 0.15;
  }

  return rng() < Math.max(0, Math.min(callProbability, 0.9));
}

// ── Helpers ─────────────────────────────────────────────────────

/** Count how many times a player's lies have been caught. */
function countCaughtLies(manifest: ManifestEntry[]): number {
  return manifest.filter((e) => e.caught).length;
}

/** Count cards of a suit visible in public information (revealed cards + discard). */
function countKnownSuitCards(state: GameState, suit: string): number {
  let count = 0;

  // Revealed cards in both manifests
  for (const entry of state.player.manifest) {
    if (entry.revealed && entry.card.suit === suit) count++;
  }
  for (const entry of state.npc.manifest) {
    if (entry.revealed && entry.card.suit === suit) count++;
  }

  // Discard pile
  for (const card of state.discardPile) {
    if (card.suit === suit) count++;
  }

  return count;
}
