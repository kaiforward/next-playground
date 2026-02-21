// Void's Gambit — NPC AI
// Chooses declarations and call decisions based on archetype weights,
// card counting, and game state.

import type {
  GameState,
  Card,
  Declaration,
  Suit,
  NpcArchetype,
  ManifestEntry,
} from "./types";
import {
  VALUES_PER_SUIT,
  BLUFF_AGGRESSION,
  CALL_RATE,
  MAX_INFLATION,
  REGULAR_CALL_ADAPT,
  MEMORY_RECALL,
  CARD_COUNTING_CERTAINTY,
  VALUE_SUSPICION_RATE,
  SUIT_SCARCITY_THRESHOLD,
  SUIT_SCARCITY_BONUS,
  MAX_CALL_PROBABILITY,
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

/** Pick a random card from a list. */
function pickCard(cards: Card[], rng: () => number): Card {
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
    default: {
      const _exhaustive: never = archetype;
      throw new Error(`Unknown archetype: ${_exhaustive}`);
    }
  }
}

// ── Call decision ───────────────────────────────────────────────

export type CallReason = "pass" | "hunch" | "card_counting" | "memory";

export interface CallDecision {
  shouldCall: boolean;
  reason: CallReason;
}

/** Decide whether the NPC should call the player's declaration this round. */
export function chooseCallDecision(state: GameState): CallDecision {
  const { config, player, npc } = state;
  const { rng, npcArchetype } = config;

  // Find player's card this round
  const playerEntry = player.manifest.find(
    (e) => e.round === state.round && !e.caught,
  );
  if (!playerEntry) return { shouldCall: false, reason: "pass" };

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
    if (rng() < CARD_COUNTING_CERTAINTY) return { shouldCall: true, reason: "card_counting" };
  }

  // Memory check: does the NPC recall a duplicate from played/revealed cards?
  // Gated by MEMORY_RECALL — harder NPCs check more reliably.
  const memoryChance = MEMORY_RECALL[npcArchetype];
  if (memoryChance > 0 && rng() < memoryChance) {
    const isDuplicate = isKnownDuplicate(state, declaredSuit, declaredValue);
    if (isDuplicate) {
      // NPC remembers seeing this card — certain call
      return { shouldCall: true, reason: "memory" };
    }
  }

  // Base call rate from archetype
  let callProbability = CALL_RATE[npcArchetype];

  // Higher declarations are more suspicious
  callProbability += (declaredValue - 4) * VALUE_SUSPICION_RATE;

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
  if (npcSuitCount + knownSuitCards >= SUIT_SCARCITY_THRESHOLD) {
    callProbability += SUIT_SCARCITY_BONUS;
  }

  const calls = rng() < Math.max(0, Math.min(callProbability, MAX_CALL_PROBABILITY));
  return { shouldCall: calls, reason: calls ? "hunch" : "pass" };
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Check if the declared card is provably a duplicate.
 * The NPC "knows" about:
 * 1. Their own manifest — they remember what cards they actually played.
 * 2. Revealed cards — cards exposed through successful calls are public info.
 *
 * Note: only checks the *actual* card (entry.card), not the declaration,
 * since the NPC doesn't know the truth behind unrevealed opponent cards.
 */
function isKnownDuplicate(
  state: GameState,
  suit: Suit,
  value: number,
): boolean {
  // NPC's own played cards (they always know their own real cards)
  for (const entry of state.npc.manifest) {
    if (
      entry.card.type === "standard" &&
      entry.card.suit === suit &&
      entry.card.value === value
    ) {
      return true;
    }
  }

  // Revealed cards from either manifest (public knowledge from calls)
  for (const entry of state.player.manifest) {
    if (
      entry.revealed &&
      entry.card.type === "standard" &&
      entry.card.suit === suit &&
      entry.card.value === value
    ) {
      return true;
    }
  }
  // NPC manifest revealed cards are also public, but we already
  // checked all NPC manifest cards above (NPC knows their own).

  return false;
}

/** Count how many times a player's lies have been caught. */
function countCaughtLies(manifest: ManifestEntry[]): number {
  return manifest.filter((e) => e.caught).length;
}

/** Count cards of a suit visible in public information (revealed cards + discard). */
function countKnownSuitCards(state: GameState, suit: Suit): number {
  let count = 0;

  // Revealed-but-not-caught cards in manifests (from failed calls — card stays in play).
  // Caught cards are already in the discard pile, so skip them to avoid double-counting.
  for (const entry of state.player.manifest) {
    if (entry.revealed && !entry.caught && entry.card.suit === suit) count++;
  }
  for (const entry of state.npc.manifest) {
    if (entry.revealed && !entry.caught && entry.card.suit === suit) count++;
  }

  // Discard pile
  for (const card of state.discardPile) {
    if (card.suit === suit) count++;
  }

  return count;
}
