import { describe, it, expect } from "vitest";
import { declare, callOpponent, passCall, isHonestDeclaration } from "../actions";
import { createGame, startGame, advancePhase } from "../game";
import type { GameState, ManifestEntry, Card } from "../types";
import { WRONG_CALL_PENALTY } from "../constants";

function seededRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function setupGame(seed = 42): GameState {
  const game = createGame({
    npcArchetype: "cautious_trader",
    npcDisplayName: "Test NPC",
    wager: 100,
    rng: seededRng(seed),
  });
  // Start → demand phase
  const result = startGame(game);
  if (!result.ok) throw new Error(result.error);
  let state = result.state;
  // Advance demand → draw/first declare
  state = advancePhase(state);
  // If round 1, demand goes straight to first declare (skip draw)
  // If not, advance draw too
  if (state.phase === "draw") {
    state = advancePhase(state);
  }
  return state;
}

describe("declare", () => {
  it("allows player to declare with demanded suit", () => {
    const state = setupGame();
    // Ensure it's player's declare phase
    expect(state.phase).toBe("player_declare");
    const demand = state.currentDemand!;
    const card = state.player.hand[0];

    const result = declare(state, card.id, { suit: demand, value: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.player.hand).toHaveLength(4);
    expect(result.state.player.manifest).toHaveLength(1);
    expect(result.state.player.manifest[0].declaration.value).toBe(5);
    expect(result.state.player.manifest[0].round).toBe(1);
  });

  it("rejects declaration with wrong suit", () => {
    const state = setupGame();
    const card = state.player.hand[0];
    const wrongSuit = state.currentDemand === "tech" ? "luxuries" : "tech";

    const result = declare(state, card.id, { suit: wrongSuit, value: 3 });
    expect(result.ok).toBe(false);
  });

  it("rejects declaration with value outside 1-7", () => {
    const state = setupGame();
    const card = state.player.hand[0];
    const demand = state.currentDemand!;

    expect(declare(state, card.id, { suit: demand, value: 0 }).ok).toBe(false);
    expect(declare(state, card.id, { suit: demand, value: 8 }).ok).toBe(false);
    expect(declare(state, card.id, { suit: demand, value: -1 }).ok).toBe(false);
  });

  it("rejects card not in hand", () => {
    const state = setupGame();
    const demand = state.currentDemand!;

    const result = declare(state, 999, { suit: demand, value: 3 });
    expect(result.ok).toBe(false);
  });

  it("advances to NPC declare phase when player goes first", () => {
    const state = setupGame();
    expect(state.firstPlayer).toBe("player");
    const card = state.player.hand[0];
    const demand = state.currentDemand!;

    const result = declare(state, card.id, { suit: demand, value: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe("npc_declare");
    }
  });

  it("advances to player_call after both declare", () => {
    let state = setupGame();
    const demand = state.currentDemand!;

    // Player declares
    const pCard = state.player.hand[0];
    let result = declare(state, pCard.id, { suit: demand, value: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    expect(state.phase).toBe("npc_declare");

    // NPC declares
    const nCard = state.npc.hand[0];
    result = declare(state, nCard.id, { suit: demand, value: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.phase).toBe("player_call");
  });

  it("allows Void card to be declared with any demanded suit", () => {
    // Create a game and manually inject a Void into the player's hand
    let state = setupGame();
    const demand = state.currentDemand!;
    const voidCard: Card = { id: 100, type: "void", suit: null, value: 0 };
    state = {
      ...state,
      player: {
        ...state.player,
        hand: [voidCard, ...state.player.hand.slice(1)],
      },
    };

    const result = declare(state, 100, { suit: demand, value: 5 });
    expect(result.ok).toBe(true);
  });
});

describe("callOpponent", () => {
  it("catches a lie — card marked caught and liar penalized", () => {
    // NPC plays Raw 2 but declares it as demanded suit value 7
    let state = setupGame(123);
    const demand = state.currentDemand!;
    const npcCard: Card = { id: 200, type: "standard", suit: "raw_materials", value: 2 };

    state = {
      ...state,
      npc: { ...state.npc, hand: [npcCard, ...state.npc.hand.slice(1)] },
    };

    // Player declares honestly
    const pCard = state.player.hand[0];
    let result = declare(state, pCard.id, { suit: demand, value: 3 });
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    // NPC declares a lie
    result = declare(state, npcCard.id, { suit: demand, value: 7 });
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    expect(state.phase).toBe("player_call");

    // Player calls
    const callResult = callOpponent(state);
    expect(callResult.ok).toBe(true);
    if (!callResult.ok) return;

    // NPC's card should be caught
    const npcEntry = callResult.state.npc.manifest.find((e) => e.round === 1);
    expect(npcEntry?.caught).toBe(true);
    expect(npcEntry?.revealed).toBe(true);

    // NPC penalty = declared value (7)
    expect(callResult.state.npc.penalties).toBe(7);
  });

  it("wrong call — honest card revealed, caller penalized", () => {
    let state = setupGame(123);
    const demand = state.currentDemand!;

    // Find an NPC card that matches the demand
    const npcMatchingCard = state.npc.hand.find(
      (c) => c.type === "standard" && c.suit === demand,
    );

    if (!npcMatchingCard) {
      // If NPC doesn't have a matching card, create one
      const customCard: Card = { id: 300, type: "standard", suit: demand, value: 5 };
      state = {
        ...state,
        npc: { ...state.npc, hand: [customCard, ...state.npc.hand.slice(1)] },
      };

      const pCard = state.player.hand[0];
      let result = declare(state, pCard.id, { suit: demand, value: 3 });
      if (!result.ok) throw new Error(result.error);
      state = result.state;

      result = declare(state, customCard.id, { suit: demand, value: 5 });
      if (!result.ok) throw new Error(result.error);
      state = result.state;
    } else {
      const pCard = state.player.hand[0];
      let result = declare(state, pCard.id, { suit: demand, value: 3 });
      if (!result.ok) throw new Error(result.error);
      state = result.state;

      result = declare(state, npcMatchingCard.id, {
        suit: demand,
        value: npcMatchingCard.value,
      });
      if (!result.ok) throw new Error(result.error);
      state = result.state;
    }

    expect(state.phase).toBe("player_call");
    const callResult = callOpponent(state);
    expect(callResult.ok).toBe(true);
    if (!callResult.ok) return;

    // NPC's card should NOT be caught
    const npcEntry = callResult.state.npc.manifest.find((e) => e.round === 1);
    expect(npcEntry?.caught).toBe(false);
    expect(npcEntry?.revealed).toBe(true);

    // Player takes -3 penalty
    expect(callResult.state.player.penalties).toBe(WRONG_CALL_PENALTY);
  });

  it("rejects call outside call phase", () => {
    const state = setupGame();
    expect(state.phase).toBe("player_declare");
    const result = callOpponent(state);
    expect(result.ok).toBe(false);
  });
});

describe("passCall", () => {
  it("advances from player_call to npc_call", () => {
    let state = setupGame();
    const demand = state.currentDemand!;

    // Both declare
    const pCard = state.player.hand[0];
    let result = declare(state, pCard.id, { suit: demand, value: 3 });
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    const nCard = state.npc.hand[0];
    result = declare(state, nCard.id, { suit: demand, value: 4 });
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    expect(state.phase).toBe("player_call");
    const passResult = passCall(state);
    expect(passResult.ok).toBe(true);
    if (passResult.ok) {
      expect(passResult.state.phase).toBe("npc_call");
    }
  });

  it("advances from npc_call to round_end", () => {
    let state = setupGame();
    const demand = state.currentDemand!;

    const pCard = state.player.hand[0];
    let result = declare(state, pCard.id, { suit: demand, value: 3 });
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    const nCard = state.npc.hand[0];
    result = declare(state, nCard.id, { suit: demand, value: 4 });
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    // Player passes
    const passResult1 = passCall(state);
    if (!passResult1.ok) throw new Error(passResult1.error);

    // NPC passes
    const passResult2 = passCall(passResult1.state);
    expect(passResult2.ok).toBe(true);
    if (passResult2.ok) {
      expect(passResult2.state.phase).toBe("round_end");
    }
  });
});

describe("isHonestDeclaration", () => {
  it("returns true for matching suit and value", () => {
    const entry: ManifestEntry = {
      card: { id: 0, type: "standard", suit: "tech", value: 5 },
      declaration: { suit: "tech", value: 5 },
      round: 1,
      revealed: false,
      caught: false,
      calledBy: null,
    };
    expect(isHonestDeclaration(entry)).toBe(true);
  });

  it("returns false for wrong value", () => {
    const entry: ManifestEntry = {
      card: { id: 0, type: "standard", suit: "tech", value: 3 },
      declaration: { suit: "tech", value: 5 },
      round: 1,
      revealed: false,
      caught: false,
      calledBy: null,
    };
    expect(isHonestDeclaration(entry)).toBe(false);
  });

  it("returns false for wrong suit", () => {
    const entry: ManifestEntry = {
      card: { id: 0, type: "standard", suit: "raw_materials", value: 5 },
      declaration: { suit: "tech", value: 5 },
      round: 1,
      revealed: false,
      caught: false,
      calledBy: null,
    };
    expect(isHonestDeclaration(entry)).toBe(false);
  });

  it("returns false for Void cards (always dishonest)", () => {
    const entry: ManifestEntry = {
      card: { id: 0, type: "void", suit: null, value: 0 },
      declaration: { suit: "tech", value: 5 },
      round: 1,
      revealed: false,
      caught: false,
      calledBy: null,
    };
    expect(isHonestDeclaration(entry)).toBe(false);
  });
});
