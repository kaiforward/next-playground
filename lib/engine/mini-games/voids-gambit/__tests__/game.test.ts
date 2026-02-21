import { describe, it, expect } from "vitest";
import { createGame, startGame, advancePhase, getDeclaredTotal } from "../game";
import { declare, passCall } from "../actions";
import { chooseDeclaration, chooseCallDecision } from "../ai";
import type { GameState } from "../types";
import { MAX_ROUNDS, HAND_SIZE } from "../constants";

function seededRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function makeGame(seed = 42): GameState {
  return createGame({
    npcArchetype: "cautious_trader",
    npcDisplayName: "Test NPC",
    wager: 100,
    rng: seededRng(seed),
  });
}

/** Start a game, unwrapping the ActionResult (throws on failure). */
function start(seed = 42): GameState {
  const result = startGame(makeGame(seed));
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("createGame", () => {
  it("creates a game in setup phase", () => {
    const state = makeGame();
    expect(state.phase).toBe("setup");
    expect(state.round).toBe(0);
    expect(state.player.hand).toHaveLength(0);
    expect(state.npc.hand).toHaveLength(0);
  });
});

describe("startGame", () => {
  it("deals hands and enters demand phase", () => {
    const state = start();
    expect(state.phase).toBe("demand");
    expect(state.round).toBe(1);
    expect(state.player.hand).toHaveLength(HAND_SIZE);
    expect(state.npc.hand).toHaveLength(HAND_SIZE);
    expect(state.deck.length).toBeGreaterThan(0);
    expect(state.demandDeck).toHaveLength(8); // demand deck untouched yet
  });

  it("returns error if game already started", () => {
    const state = start();
    const result = startGame(state);
    expect(result.ok).toBe(false);
  });
});

describe("advancePhase", () => {
  it("demand phase reveals suit and advances to first declare on round 1", () => {
    const state = start();
    expect(state.phase).toBe("demand");

    const advanced = advancePhase(state);
    expect(advanced.currentDemand).not.toBeNull();
    expect(advanced.demandHistory).toHaveLength(1);
    expect(advanced.demandDeck).toHaveLength(7);
    // Round 1 skips draw
    expect(advanced.phase).toBe("player_declare");
  });

  it("round 2+ demand phase goes to draw first", () => {
    // Simulate getting to round 2
    let state = start();
    state = advancePhase(state); // demand → first declare

    // Play through round 1
    const demand = state.currentDemand!;
    const pCard = state.player.hand[0];
    let result = declare(state, pCard.id, { suit: demand, value: 3 });
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    const nCard = state.npc.hand[0];
    result = declare(state, nCard.id, { suit: demand, value: 4 });
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    result = passCall(state);
    if (!result.ok) throw new Error(result.error);
    result = passCall(result.state);
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    expect(state.phase).toBe("round_end");

    // Advance to round 2
    state = advancePhase(state); // round_end → demand
    expect(state.phase).toBe("demand");
    expect(state.round).toBe(2);

    state = advancePhase(state); // demand → draw
    expect(state.phase).toBe("draw");

    state = advancePhase(state); // draw → first declare
    // Round 2: NPC goes first (alternating)
    expect(state.phase).toBe("npc_declare");
  });

  it("first player alternates each round", () => {
    let state = start();
    expect(state.firstPlayer).toBe("player");

    // Advance to round_end and then round 2
    state = advancePhase(state); // demand
    const demand = state.currentDemand!;
    const pCard = state.player.hand[0];
    let result = declare(state, pCard.id, { suit: demand, value: 3 });
    if (!result.ok) throw new Error(result.error);
    state = result.state;
    const nCard = state.npc.hand[0];
    result = declare(state, nCard.id, { suit: demand, value: 4 });
    if (!result.ok) throw new Error(result.error);
    state = result.state;
    result = passCall(state);
    if (!result.ok) throw new Error(result.error);
    result = passCall(result.state);
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    state = advancePhase(state); // round_end → demand (round 2)
    expect(state.firstPlayer).toBe("npc");
  });
});

describe("full game flow", () => {
  it("plays through 7 rounds and reaches completion", () => {
    let state = start(99);

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      // Demand
      state = advancePhase(state);
      expect(state.currentDemand).not.toBeNull();

      // Draw (skip round 1)
      if (state.phase === "draw") {
        state = advancePhase(state);
      }

      const demand = state.currentDemand!;

      // First declaration
      if (state.phase === "player_declare") {
        const card = state.player.hand[0];
        const result = declare(state, card.id, { suit: demand, value: 4 });
        if (!result.ok) throw new Error(`R${round} player declare: ${result.error}`);
        state = result.state;
      }

      if (state.phase === "npc_declare") {
        const aiDecl = chooseDeclaration(state);
        const result = declare(state, aiDecl.cardId, aiDecl.declaration);
        if (!result.ok) throw new Error(`R${round} npc declare: ${result.error}`);
        state = result.state;
      }

      // Second declaration
      if (state.phase === "player_declare") {
        const card = state.player.hand[0];
        const result = declare(state, card.id, { suit: demand, value: 4 });
        if (!result.ok) throw new Error(`R${round} player declare 2: ${result.error}`);
        state = result.state;
      }

      if (state.phase === "npc_declare") {
        const aiDecl = chooseDeclaration(state);
        const result = declare(state, aiDecl.cardId, aiDecl.declaration);
        if (!result.ok) throw new Error(`R${round} npc declare 2: ${result.error}`);
        state = result.state;
      }

      // Call window — both pass (call order mirrors declaration order)
      const firstCall = state.firstPlayer === "player" ? "player_call" : "npc_call";
      const secondCall = state.firstPlayer === "player" ? "npc_call" : "player_call";

      expect(state.phase).toBe(firstCall);
      let passResult = passCall(state);
      if (!passResult.ok) throw new Error(passResult.error);
      state = passResult.state;

      expect(state.phase).toBe(secondCall);
      passResult = passCall(state);
      if (!passResult.ok) throw new Error(passResult.error);
      state = passResult.state;

      expect(state.phase).toBe("round_end");

      if (round < MAX_ROUNDS) {
        state = advancePhase(state);
        expect(state.round).toBe(round + 1);
      }
    }

    // Final reveal
    state = advancePhase(state); // round_end → final_reveal
    expect(state.phase).toBe("final_reveal");

    state = advancePhase(state); // final_reveal → complete
    expect(state.phase).toBe("complete");
    expect(state.result).not.toBeNull();
    expect(["player", "npc", "tie"]).toContain(state.result!.winner);
  });
});

describe("getDeclaredTotal", () => {
  it("sums declared values of uncaught cards", () => {
    let state = start();
    state = advancePhase(state);
    const demand = state.currentDemand!;

    const card = state.player.hand[0];
    const result = declare(state, card.id, { suit: demand, value: 5 });
    if (!result.ok) throw new Error(result.error);

    expect(getDeclaredTotal(result.state, "player")).toBe(5);
  });
});
