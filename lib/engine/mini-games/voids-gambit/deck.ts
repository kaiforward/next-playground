// Void's Gambit — Deck creation and manipulation
// Pure functions, no side effects.

import type { Card, Suit } from "./types";
import { SUITS, VALUES_PER_SUIT, VOID_COUNT, DEMAND_PER_SUIT } from "./constants";

// ── Deck creation ───────────────────────────────────────────────

/** Create the 30-card main deck: 4 suits × 7 values + 2 Voids. */
export function createDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;

  for (const suit of SUITS) {
    for (let value = 1; value <= VALUES_PER_SUIT; value++) {
      cards.push({ id: id++, type: "standard", suit, value });
    }
  }

  for (let i = 0; i < VOID_COUNT; i++) {
    cards.push({ id: id++, type: "void", suit: null, value: 0 });
  }

  return cards;
}

/** Create the 8-card demand deck: 2 of each suit. */
export function createDemandDeck(): Suit[] {
  const deck: Suit[] = [];
  for (const suit of SUITS) {
    for (let i = 0; i < DEMAND_PER_SUIT; i++) {
      deck.push(suit);
    }
  }
  return deck;
}

// ── Shuffle ─────────────────────────────────────────────────────

/** Fisher-Yates shuffle using the provided RNG. */
export function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ── Draw ────────────────────────────────────────────────────────

/** Draw 1 card from the top. Returns [drawnCard, remainingDeck] or null. */
export function drawCard(deck: Card[]): [Card, Card[]] | null {
  if (deck.length === 0) return null;
  return [deck[0], deck.slice(1)];
}
