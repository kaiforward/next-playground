// Void's Gambit — Action handlers
// Each action: validate preconditions → produce new state → return discriminated union.

import type {
  GameState,
  ActionResult,
  Declaration,
  Suit,
  LogActor,
  ManifestEntry,
  GamePhase,
} from "./types";
import { SUITS, VALUES_PER_SUIT, WRONG_CALL_PENALTY } from "./constants";

// ── Helpers ─────────────────────────────────────────────────────

function isValidDeclaration(
  decl: Declaration,
  demandedSuit: Suit,
): boolean {
  return (
    decl.suit === demandedSuit &&
    SUITS.includes(decl.suit) &&
    Number.isInteger(decl.value) &&
    decl.value >= 1 &&
    decl.value <= VALUES_PER_SUIT
  );
}

/** Check if a manifest entry's declaration honestly matches the card. */
export function isHonestDeclaration(entry: ManifestEntry): boolean {
  if (entry.card.type === "void") return false; // Voids are always a lie (value 0 ≠ 1-7)
  return (
    entry.card.suit === entry.declaration.suit &&
    entry.card.value === entry.declaration.value
  );
}

function getNextPhaseAfterDeclare(
  state: GameState,
  actor: LogActor,
): GamePhase {
  // After first declaration → other player declares.
  // After second declaration → first player's call window (mirrors declaration order).
  if (state.firstPlayer === "player") {
    return actor === "player" ? "npc_declare" : "player_call";
  }
  return actor === "npc" ? "player_declare" : "npc_call";
}

function getNextPhaseAfterCall(state: GameState): GamePhase {
  // After first caller → other player's call window.
  // After second caller → round end.
  if (state.firstPlayer === "player") {
    return state.phase === "player_call" ? "npc_call" : "round_end";
  }
  return state.phase === "npc_call" ? "player_call" : "round_end";
}

// ── Declare ─────────────────────────────────────────────────────

/** Play a card face-down from hand into the manifest with a declaration. */
export function declare(
  state: GameState,
  cardId: number,
  declaration: Declaration,
): ActionResult {
  const isPlayerPhase = state.phase === "player_declare";
  const isNpcPhase = state.phase === "npc_declare";

  if (!isPlayerPhase && !isNpcPhase) {
    return { ok: false, error: "Not a declaration phase" };
  }

  if (!state.currentDemand) {
    return { ok: false, error: "No demand set for this round" };
  }

  if (!isValidDeclaration(declaration, state.currentDemand)) {
    return {
      ok: false,
      error: `Declaration must be ${state.currentDemand} with value 1-${VALUES_PER_SUIT}`,
    };
  }

  const actor: LogActor = isPlayerPhase ? "player" : "npc";
  const actorState = actor === "player" ? state.player : state.npc;

  const cardIndex = actorState.hand.findIndex((c) => c.id === cardId);
  if (cardIndex === -1) {
    return { ok: false, error: "Card not in hand" };
  }

  const card = actorState.hand[cardIndex];
  const newHand = actorState.hand.filter((_, i) => i !== cardIndex);

  const entry: ManifestEntry = {
    card,
    declaration,
    round: state.round,
    revealed: false,
    caught: false,
    calledBy: null,
  };

  const newManifest = [...actorState.manifest, entry];
  const updatedActorState = {
    ...actorState,
    hand: newHand,
    manifest: newManifest,
  };

  const nextPhase = getNextPhaseAfterDeclare(state, actor);

  return {
    ok: true,
    state: {
      ...state,
      phase: nextPhase,
      [actor]: updatedActorState,
      log: [
        ...state.log,
        {
          type: "declare" as const,
          actor,
          declaration,
          round: state.round,
        },
      ],
    },
  };
}

// ── Call ─────────────────────────────────────────────────────────

/** Challenge the opponent's card played this round. */
export function callOpponent(state: GameState): ActionResult {
  const isPlayerPhase = state.phase === "player_call";
  const isNpcPhase = state.phase === "npc_call";

  if (!isPlayerPhase && !isNpcPhase) {
    return { ok: false, error: "Not a call phase" };
  }

  const caller: LogActor = isPlayerPhase ? "player" : "npc";
  const target: LogActor = caller === "player" ? "npc" : "player";
  const callerState = caller === "player" ? state.player : state.npc;
  const targetState = target === "player" ? state.player : state.npc;

  // Find the target's card from this round
  const entryIndex = targetState.manifest.findIndex(
    (e) => e.round === state.round && !e.caught,
  );
  if (entryIndex === -1) {
    return { ok: false, error: "No card to call this round" };
  }

  const entry = targetState.manifest[entryIndex];
  const honest = isHonestDeclaration(entry);
  const nextPhase = getNextPhaseAfterCall(state);

  if (honest) {
    // Wrong call: card stays and is revealed, caller takes -3
    const newManifest = targetState.manifest.map((e, i) =>
      i === entryIndex
        ? { ...e, revealed: true, calledBy: caller }
        : e,
    );

    return {
      ok: true,
      state: {
        ...state,
        phase: nextPhase,
        [target]: { ...targetState, manifest: newManifest },
        [caller]: {
          ...callerState,
          penalties: callerState.penalties + WRONG_CALL_PENALTY,
        },
        log: [
          ...state.log,
          {
            type: "call_fail" as const,
            caller,
            target,
            card: entry.card,
            declaration: entry.declaration,
            round: state.round,
          },
        ],
      },
    };
  }

  // Correct call: card is caught, liar takes penalty = declared value
  const penalty = entry.declaration.value;
  const newManifest = targetState.manifest.map((e, i) =>
    i === entryIndex
      ? { ...e, revealed: true, caught: true, calledBy: caller }
      : e,
  );

  return {
    ok: true,
    state: {
      ...state,
      phase: nextPhase,
      [target]: {
        ...targetState,
        manifest: newManifest,
        penalties: targetState.penalties + penalty,
      },
      discardPile: [...state.discardPile, entry.card],
      log: [
        ...state.log,
        {
          type: "call_success" as const,
          caller,
          target,
          card: entry.card,
          declaration: entry.declaration,
          penalty,
          round: state.round,
        },
      ],
    },
  };
}

// ── Pass ────────────────────────────────────────────────────────

/** Decline to call the opponent's card this round. */
export function passCall(state: GameState): ActionResult {
  const isPlayerPhase = state.phase === "player_call";
  const isNpcPhase = state.phase === "npc_call";

  if (!isPlayerPhase && !isNpcPhase) {
    return { ok: false, error: "Not a call phase" };
  }

  const actor: LogActor = isPlayerPhase ? "player" : "npc";
  const nextPhase = getNextPhaseAfterCall(state);

  return {
    ok: true,
    state: {
      ...state,
      phase: nextPhase,
      log: [
        ...state.log,
        { type: "call_pass" as const, actor, round: state.round },
      ],
    },
  };
}
