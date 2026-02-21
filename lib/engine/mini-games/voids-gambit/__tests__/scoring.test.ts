import { describe, it, expect } from "vitest";
import { calculateScore, determineWinner } from "../scoring";
import type { ManifestEntry, Card, Suit, GameState } from "../types";

function makeCard(id: number, suit: Suit, value: number): Card;
function makeCard(id: number, suit: null, value: 0, type: "void"): Card;
function makeCard(
  id: number,
  suit: Suit | null,
  value: number,
  _type?: "standard" | "void",
): Card {
  if (suit === null) return { id, type: "void", suit: null, value: 0 };
  return { id, type: "standard", suit, value };
}

function makeEntry(
  card: Card,
  declaredSuit: Suit,
  declaredValue: number,
  opts: Partial<ManifestEntry> = {},
): ManifestEntry {
  return {
    card,
    declaration: { suit: declaredSuit, value: declaredValue },
    round: 1,
    revealed: false,
    caught: false,
    calledBy: null,
    ...opts,
  };
}

describe("calculateScore", () => {
  it("scores honest declarations at printed value", () => {
    const manifest: ManifestEntry[] = [
      makeEntry(makeCard(0, "tech", 5), "tech", 5),
      makeEntry(makeCard(1, "raw_materials", 3), "raw_materials", 3),
    ];

    const score = calculateScore(manifest, 0);
    expect(score.cardValues).toBe(8);
    expect(score.total).toBe(8);
    expect(score.cardDetails[0].honest).toBe(true);
    expect(score.cardDetails[1].honest).toBe(true);
  });

  it("scores surviving lies at declared value", () => {
    // Card is Raw 2, declared as Tech 6
    const manifest: ManifestEntry[] = [
      makeEntry(makeCard(0, "raw_materials", 2), "tech", 6),
    ];

    const score = calculateScore(manifest, 0);
    expect(score.cardValues).toBe(6); // declared value
    expect(score.cardDetails[0].honest).toBe(false);
    expect(score.cardDetails[0].scoredValue).toBe(6);
  });

  it("scores value-inflated lies at declared value", () => {
    // Card is Tech 3, declared as Tech 6 (right suit, wrong value)
    const manifest: ManifestEntry[] = [
      makeEntry(makeCard(0, "tech", 3), "tech", 6),
    ];

    const score = calculateScore(manifest, 0);
    expect(score.cardValues).toBe(6);
    expect(score.cardDetails[0].honest).toBe(false);
  });

  it("scores caught cards at 0", () => {
    const manifest: ManifestEntry[] = [
      makeEntry(makeCard(0, "raw_materials", 2), "tech", 7, { caught: true }),
    ];

    const score = calculateScore(manifest, 0);
    expect(score.cardValues).toBe(0);
    expect(score.cardDetails[0].caught).toBe(true);
    expect(score.cardDetails[0].scoredValue).toBe(0);
  });

  it("Void cards are never honest", () => {
    // Void declared as Tech 5
    const manifest: ManifestEntry[] = [
      makeEntry(makeCard(0, null, 0, "void"), "tech", 5),
    ];

    const score = calculateScore(manifest, 0);
    expect(score.cardDetails[0].honest).toBe(false);
    // Surviving Void lie scores declared value
    expect(score.cardValues).toBe(5);
  });

  it("subtracts penalties from total", () => {
    const manifest: ManifestEntry[] = [
      makeEntry(makeCard(0, "tech", 7), "tech", 7),
    ];

    const score = calculateScore(manifest, 6);
    expect(score.cardValues).toBe(7);
    expect(score.penalties).toBe(6);
    expect(score.total).toBe(1);
  });

  it("handles empty manifest", () => {
    const score = calculateScore([], 3);
    expect(score.cardValues).toBe(0);
    expect(score.total).toBe(-3);
    expect(score.cardDetails).toHaveLength(0);
  });

  it("handles mix of honest, lies, and caught cards", () => {
    const manifest: ManifestEntry[] = [
      makeEntry(makeCard(0, "tech", 5), "tech", 5), // honest: 5
      makeEntry(makeCard(1, "raw_materials", 2), "tech", 6), // lie: 6
      makeEntry(makeCard(2, "luxuries", 3), "tech", 7, { caught: true }), // caught: 0
    ];

    const score = calculateScore(manifest, 10); // 10 penalty (7 for caught + 3 wrong call)
    expect(score.cardValues).toBe(11); // 5 + 6 + 0
    expect(score.total).toBe(1); // 11 - 10
  });
});

describe("determineWinner", () => {
  function makeGameState(
    playerManifest: ManifestEntry[],
    playerPenalties: number,
    npcManifest: ManifestEntry[],
    npcPenalties: number,
  ): GameState {
    return {
      phase: "complete",
      config: {
        npcArchetype: "cautious_trader",
        npcDisplayName: "Test",
        wager: 100,
        rng: Math.random,
      },
      deck: [],
      discardPile: [],
      demandDeck: [],
      demandHistory: [],
      currentDemand: null,
      player: { hand: [], manifest: playerManifest, penalties: playerPenalties },
      npc: { hand: [], manifest: npcManifest, penalties: npcPenalties },
      round: 7,
      firstPlayer: "player",
      log: [],
      result: null,
    };
  }

  it("player wins with higher total", () => {
    const state = makeGameState(
      [makeEntry(makeCard(0, "tech", 7), "tech", 7)],
      0,
      [makeEntry(makeCard(1, "tech", 3), "tech", 3)],
      0,
    );

    const result = determineWinner(state);
    expect(result.winner).toBe("player");
    expect(result.playerScore.total).toBe(7);
    expect(result.npcScore.total).toBe(3);
    expect(result.potWinnings).toBe(200);
  });

  it("npc wins with higher total", () => {
    const state = makeGameState(
      [makeEntry(makeCard(0, "tech", 2), "tech", 2)],
      0,
      [makeEntry(makeCard(1, "tech", 6), "tech", 6)],
      0,
    );

    const result = determineWinner(state);
    expect(result.winner).toBe("npc");
  });

  it("ties split the pot", () => {
    const state = makeGameState(
      [makeEntry(makeCard(0, "tech", 5), "tech", 5)],
      0,
      [makeEntry(makeCard(1, "luxuries", 5), "luxuries", 5)],
      0,
    );

    const result = determineWinner(state);
    expect(result.winner).toBe("tie");
    expect(result.potWinnings).toBe(100); // wager returned
  });

  it("penalties affect winner determination", () => {
    const state = makeGameState(
      [makeEntry(makeCard(0, "tech", 7), "tech", 7)],
      6, // 7 - 6 = 1
      [makeEntry(makeCard(1, "tech", 3), "tech", 3)],
      0, // 3 - 0 = 3
    );

    const result = determineWinner(state);
    expect(result.winner).toBe("npc"); // npc has 3 vs player's 1
  });
});
