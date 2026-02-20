import { describe, it, expect } from "vitest";
import { createDeck, createDemandDeck, shuffle, drawCard } from "../deck";
import { SUITS, VALUES_PER_SUIT, VOID_COUNT, DECK_SIZE } from "../constants";

describe("createDeck", () => {
  const deck = createDeck();

  it("creates the correct number of cards", () => {
    expect(deck).toHaveLength(DECK_SIZE);
  });

  it("has unique IDs", () => {
    const ids = deck.map((c) => c.id);
    expect(new Set(ids).size).toBe(DECK_SIZE);
  });

  it("has the right number of standard cards per suit", () => {
    for (const suit of SUITS) {
      const cards = deck.filter((c) => c.type === "standard" && c.suit === suit);
      expect(cards).toHaveLength(VALUES_PER_SUIT);
    }
  });

  it("has standard cards with values 1 through VALUES_PER_SUIT", () => {
    for (const suit of SUITS) {
      const values = deck
        .filter((c) => c.type === "standard" && c.suit === suit)
        .map((c) => c.value)
        .sort((a, b) => a - b);
      expect(values).toEqual(
        Array.from({ length: VALUES_PER_SUIT }, (_, i) => i + 1),
      );
    }
  });

  it("has the correct number of Void cards", () => {
    const voids = deck.filter((c) => c.type === "void");
    expect(voids).toHaveLength(VOID_COUNT);
  });

  it("Void cards have value 0 and null suit", () => {
    const voids = deck.filter((c) => c.type === "void");
    for (const v of voids) {
      expect(v.value).toBe(0);
      expect(v.suit).toBeNull();
    }
  });
});

describe("createDemandDeck", () => {
  const demandDeck = createDemandDeck();

  it("creates 8 demand cards (2 per suit)", () => {
    expect(demandDeck).toHaveLength(8);
  });

  it("has exactly 2 of each suit", () => {
    for (const suit of SUITS) {
      const count = demandDeck.filter((s) => s === suit).length;
      expect(count).toBe(2);
    }
  });
});

describe("shuffle", () => {
  it("returns a new array of the same length", () => {
    const deck = createDeck();
    const rng = () => 0.5;
    const shuffled = shuffle(deck, rng);
    expect(shuffled).toHaveLength(deck.length);
    expect(shuffled).not.toBe(deck); // different reference
  });

  it("contains all original elements", () => {
    const deck = createDeck();
    let seed = 42;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const shuffled = shuffle(deck, rng);
    const originalIds = deck.map((c) => c.id).sort((a, b) => a - b);
    const shuffledIds = shuffled.map((c) => c.id).sort((a, b) => a - b);
    expect(shuffledIds).toEqual(originalIds);
  });

  it("produces different orders with different RNG seeds", () => {
    const deck = createDeck();
    const rng1 = () => 0.3;
    const rng2 = () => 0.7;
    const s1 = shuffle(deck, rng1);
    const s2 = shuffle(deck, rng2);
    // Very unlikely to be identical with different seeds
    const same = s1.every((c, i) => c.id === s2[i].id);
    expect(same).toBe(false);
  });
});

describe("drawCard", () => {
  it("returns the top card and remaining deck", () => {
    const deck = createDeck();
    const result = drawCard(deck);
    expect(result).not.toBeNull();
    const [card, remaining] = result!;
    expect(card.id).toBe(deck[0].id);
    expect(remaining).toHaveLength(deck.length - 1);
  });

  it("returns null for empty deck", () => {
    expect(drawCard([])).toBeNull();
  });

  it("remaining deck does not contain drawn card", () => {
    const deck = createDeck();
    const [card, remaining] = drawCard(deck)!;
    expect(remaining.find((c) => c.id === card.id)).toBeUndefined();
  });
});
