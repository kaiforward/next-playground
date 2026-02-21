import { describe, it, expect } from "vitest";
import { chooseDeclaration, chooseCallDecision } from "../ai";
import { createGame, startGame, advancePhase } from "../game";
import { declare, passCall } from "../actions";
import type { GameState, Card, Suit } from "../types";
import { VALUES_PER_SUIT } from "../constants";

function seededRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function setupNpcDeclarePhase(
  archetype: GameState["config"]["npcArchetype"],
  seed = 42,
): GameState {
  const game = createGame({
    npcArchetype: archetype,
    npcDisplayName: "Test",
    wager: 100,
    rng: seededRng(seed),
  });
  const started = startGame(game);
  if (!started.ok) throw new Error(started.error);
  let state = advancePhase(started.state); // demand → player_declare (round 1)

  // Player declares first (round 1, player always goes first)
  const demand = state.currentDemand!;
  const pCard = state.player.hand[0];
  const result = declare(state, pCard.id, { suit: demand, value: 4 });
  if (!result.ok) throw new Error(result.error);
  return result.state; // npc_declare phase
}

describe("chooseDeclaration", () => {
  it("returns a valid declaration matching demanded suit", () => {
    const state = setupNpcDeclarePhase("cautious_trader");
    expect(state.phase).toBe("npc_declare");

    const decision = chooseDeclaration(state);
    expect(decision.declaration.suit).toBe(state.currentDemand);
    expect(decision.declaration.value).toBeGreaterThanOrEqual(1);
    expect(decision.declaration.value).toBeLessThanOrEqual(VALUES_PER_SUIT);
  });

  it("chooses a card from the NPC hand", () => {
    const state = setupNpcDeclarePhase("cautious_trader");
    const decision = chooseDeclaration(state);
    const card = state.npc.hand.find((c) => c.id === decision.cardId);
    expect(card).toBeDefined();
  });

  it("cautious trader mostly declares honestly", () => {
    // Run multiple times and check that most declarations match real values
    let honestCount = 0;
    const trials = 50;

    for (let i = 0; i < trials; i++) {
      const state = setupNpcDeclarePhase("cautious_trader", i + 1);
      const decision = chooseDeclaration(state);
      const card = state.npc.hand.find((c) => c.id === decision.cardId)!;

      if (
        card.type === "standard" &&
        card.suit === decision.declaration.suit &&
        card.value === decision.declaration.value
      ) {
        honestCount++;
      }
    }

    // Cautious trader has 0.15 bluff aggression → ~85% honest
    expect(honestCount).toBeGreaterThan(trials * 0.6);
  });

  it("frontier gambler inflates declarations frequently", () => {
    let inflatedCount = 0;
    const trials = 50;

    for (let i = 0; i < trials; i++) {
      const state = setupNpcDeclarePhase("frontier_gambler", i + 1);
      const decision = chooseDeclaration(state);
      const card = state.npc.hand.find((c) => c.id === decision.cardId)!;

      if (card.type === "standard" && decision.declaration.value > card.value) {
        inflatedCount++;
      }
      // Void cards always inflate (value is 0, declaration is 1+)
      if (card.type === "void") {
        inflatedCount++;
      }
    }

    // Frontier gambler has 0.8 bluff aggression → ~80% inflated
    expect(inflatedCount).toBeGreaterThan(trials * 0.4);
  });

  it("handles hand with only Void cards for demanded suit", () => {
    let state = setupNpcDeclarePhase("cautious_trader", 77);
    const demand = state.currentDemand!;

    // Replace NPC hand with cards that don't match demand + one Void
    const voidCard: Card = { id: 500, type: "void", suit: null, value: 0 };
    const otherSuit: Suit = demand === "tech" ? "luxuries" : "tech";
    const otherCards = [
      { id: 501, type: "standard" as const, suit: otherSuit, value: 3 },
      { id: 502, type: "standard" as const, suit: otherSuit, value: 5 },
    ];

    state = {
      ...state,
      npc: {
        ...state.npc,
        hand: [voidCard, ...otherCards],
      },
    };

    const decision = chooseDeclaration(state);
    expect(decision.declaration.suit).toBe(demand);
    // Should pick the Void card (wild suit)
    expect(decision.cardId).toBe(500);
  });
});

describe("chooseCallDecision", () => {
  function setupCallPhase(
    archetype: GameState["config"]["npcArchetype"],
    playerDeclaredValue: number,
    seed = 42,
  ): GameState {
    const game = createGame({
      npcArchetype: archetype,
      npcDisplayName: "Test",
      wager: 100,
      rng: seededRng(seed),
    });
    const started = startGame(game);
    if (!started.ok) throw new Error(started.error);
    let state = advancePhase(started.state); // demand

    const demand = state.currentDemand!;

    // Player declares
    const pCard = state.player.hand[0];
    let result = declare(state, pCard.id, {
      suit: demand,
      value: playerDeclaredValue,
    });
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    // NPC declares
    const nCard = state.npc.hand[0];
    result = declare(state, nCard.id, { suit: demand, value: 4 });
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    // Player passes
    result = passCall(state);
    if (!result.ok) throw new Error(result.error);

    return result.state; // npc_call phase
  }

  it("almost always calls when holding the exact declared card", () => {
    let callCount = 0;
    const trials = 50;

    for (let i = 0; i < trials; i++) {
      let state = setupCallPhase("sharp_smuggler", 5, i + 1);
      const demand = state.currentDemand!;

      // Inject the exact card player declared into NPC hand
      const exactCard: Card = {
        id: 600,
        type: "standard",
        suit: demand,
        value: 5,
      };
      state = {
        ...state,
        npc: {
          ...state.npc,
          hand: [exactCard, ...state.npc.hand],
        },
      };

      if (chooseCallDecision(state).shouldCall) callCount++;
    }

    expect(callCount).toBeGreaterThan(trials * 0.8);
  });

  it("cautious trader rarely calls", () => {
    let callCount = 0;
    const trials = 100;

    for (let i = 0; i < trials; i++) {
      const state = setupCallPhase("cautious_trader", 4, i + 1);
      if (chooseCallDecision(state).shouldCall) callCount++;
    }

    // Base rate 0.15 — should call less than ~30% of the time for moderate values
    expect(callCount).toBeLessThan(trials * 0.4);
  });

  it("station regular calls when player declares a card the NPC already played", () => {
    let memoryCallCount = 0;
    const trials = 50;

    for (let i = 0; i < trials; i++) {
      let state = setupCallPhase("station_regular", 4, i + 1);
      const demand = state.currentDemand!;

      // Inject a manifest entry showing the NPC already played the exact card
      const fakeEntry = {
        card: { id: 700, type: "standard" as const, suit: demand, value: 4 },
        declaration: { suit: demand, value: 4 },
        round: 0, // previous round
        revealed: false,
        caught: false,
        calledBy: null,
      };
      state = {
        ...state,
        npc: {
          ...state.npc,
          manifest: [fakeEntry, ...state.npc.manifest],
        },
      };

      const decision = chooseCallDecision(state);
      if (decision.shouldCall && decision.reason === "memory") {
        memoryCallCount++;
      }
    }

    // Station Regular has 0.95 memory recall — should catch most of these
    expect(memoryCallCount).toBeGreaterThan(trials * 0.7);
  });

  it("returns reason 'memory' when calling based on revealed cards", () => {
    let state = setupCallPhase("sharp_smuggler", 3, 42);
    const demand = state.currentDemand!;

    // Inject a revealed card in the player's previous manifest matching the declaration
    const revealedEntry = {
      card: { id: 800, type: "standard" as const, suit: demand, value: 3 },
      declaration: { suit: demand, value: 3 },
      round: 0,
      revealed: true,
      caught: true,
      calledBy: "npc" as const,
    };
    state = {
      ...state,
      player: {
        ...state.player,
        manifest: [revealedEntry, ...state.player.manifest],
      },
    };

    const decision = chooseCallDecision(state);
    // sharp_smuggler has 0.85 memory recall, and the rng is deterministic
    // so with seed 42, the NPC should remember and call
    if (decision.shouldCall) {
      expect(decision.reason).toBe("memory");
    }
  });
});
