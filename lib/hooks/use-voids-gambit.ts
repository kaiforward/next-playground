"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type GameState,
  type GameResult,
  type NpcArchetype,
  type NpcIdentity,
  type Declaration,
  createGame,
  startGame,
  advancePhase,
  declare,
  callOpponent,
  passCall,
  chooseDeclaration,
  chooseCallDecision,
  getDeclaredTotal,
  getRoundEntry,
  NPC_NAMES,
  NPC_FLAVOR,
  NPC_DIFFICULTY,
  NPC_DIALOGUE,
  NPC_DECLARE_DELAY,
  NPC_CALL_DELAY,
  DEMAND_REVEAL_DELAY,
  CARD_REVEAL_DELAY,
} from "@/lib/engine/mini-games/voids-gambit";

// ── Hook return type ─────────────────────────────────────────────

export interface UseVoidsGambit {
  game: GameState | null;
  npcDialogue: string | null;
  npcIdentity: NpcIdentity | null;
  isProcessing: boolean;
  startNewGame: (archetype: NpcArchetype, wager: number) => void;
  declareCard: (cardId: number, declaration: Declaration) => void;
  callOpponentAction: () => void;
  passCallAction: () => void;
  playAgain: () => void;
  returnToLobby: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickDialogue(
  archetype: NpcArchetype,
  key: keyof (typeof NPC_DIALOGUE)[NpcArchetype],
): string {
  return pickRandom(NPC_DIALOGUE[archetype][key]);
}

// ── Hook ─────────────────────────────────────────────────────────

export function useVoidsGambit(): UseVoidsGambit {
  const [game, setGame] = useState<GameState | null>(null);
  const [npcDialogue, setNpcDialogue] = useState<string | null>(null);
  const [npcIdentity, setNpcIdentity] = useState<NpcIdentity | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Actions ──────────────────────────────────────────────────

  const startNewGame = useCallback(
    (archetype: NpcArchetype, wager: number) => {
      const displayName = pickRandom(NPC_NAMES[archetype]);
      const identity: NpcIdentity = {
        archetype,
        displayName,
        difficulty: NPC_DIFFICULTY[archetype],
        flavorText: NPC_FLAVOR[archetype],
      };

      const config = {
        npcArchetype: archetype,
        npcDisplayName: displayName,
        wager,
        rng: Math.random,
      };

      const created = createGame(config);
      const result = startGame(created);
      if (!result.ok) return;

      setNpcIdentity(identity);
      setNpcDialogue(pickDialogue(archetype, "greeting"));
      setGame(result.state);
      setIsProcessing(true);
    },
    [],
  );

  const declareCard = useCallback(
    (cardId: number, declaration: Declaration) => {
      setGame((prev) => {
        if (!prev || prev.phase !== "player_declare") return prev;
        const result = declare(prev, cardId, declaration);
        return result.ok ? result.state : prev;
      });
    },
    [],
  );

  const callOpponentAction = useCallback(() => {
    setGame((prev) => {
      if (!prev || prev.phase !== "player_call") return prev;
      const result = callOpponent(prev);
      if (!result.ok) return prev;

      // NPC reacts to being called
      const lastLog = result.state.log[result.state.log.length - 1];
      const dialogueKey =
        lastLog.type === "call_success" ? "calledAndCaught" : "calledAndHonest";
      setNpcDialogue(pickDialogue(prev.config.npcArchetype, dialogueKey));

      return result.state;
    });
  }, []);

  const passCallAction = useCallback(() => {
    setGame((prev) => {
      if (!prev || prev.phase !== "player_call") return prev;
      const result = passCall(prev);
      return result.ok ? result.state : prev;
    });
  }, []);

  const playAgain = useCallback(() => {
    if (!npcIdentity) return;
    startNewGame(npcIdentity.archetype, game?.config.wager ?? 50);
  }, [npcIdentity, game?.config.wager, startNewGame]);

  const returnToLobby = useCallback(() => {
    setGame(null);
    setNpcDialogue(null);
    setNpcIdentity(null);
    setIsProcessing(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // ── Auto-phase advancement ───────────────────────────────────

  useEffect(() => {
    if (!game) return;

    const phase = game.phase;

    let delay: number | null = null;
    let action: (() => void) | null = null;

    switch (phase) {
      case "demand": {
        delay = DEMAND_REVEAL_DELAY;
        action = () => {
          setGame((prev) => (prev ? advancePhase(prev) : prev));
        };
        break;
      }
      case "draw": {
        delay = CARD_REVEAL_DELAY;
        action = () => {
          setGame((prev) => (prev ? advancePhase(prev) : prev));
        };
        break;
      }
      case "npc_declare": {
        delay = NPC_DECLARE_DELAY;
        action = () => {
          setGame((prev) => {
            if (!prev || prev.phase !== "npc_declare") return prev;
            const ai = chooseDeclaration(prev);
            const result = declare(prev, ai.cardId, ai.declaration);
            if (!result.ok) return prev;

            const key = ai.declaration.value >= 5 ? "declareHigh" : "declare";
            setNpcDialogue(pickDialogue(prev.config.npcArchetype, key));
            return result.state;
          });
        };
        break;
      }
      case "npc_call": {
        delay = NPC_CALL_DELAY;
        action = () => {
          setGame((prev) => {
            if (!prev || prev.phase !== "npc_call") return prev;
            const decision = chooseCallDecision(prev);

            if (decision.shouldCall) {
              const result = callOpponent(prev);
              if (!result.ok) return prev;

              // Pick dialogue based on why the NPC called
              let dialogueKey: keyof typeof NPC_DIALOGUE[typeof prev.config.npcArchetype];
              if (decision.reason === "memory" || decision.reason === "card_counting") {
                dialogueKey = "callMemory";
              } else {
                const lastLog =
                  result.state.log[result.state.log.length - 1];
                dialogueKey =
                  lastLog.type === "call_success" ? "callSuccess" : "callFail";
              }
              setNpcDialogue(pickDialogue(prev.config.npcArchetype, dialogueKey));
              return result.state;
            }

            const result = passCall(prev);
            if (!result.ok) return prev;
            setNpcDialogue(pickDialogue(prev.config.npcArchetype, "pass"));
            return result.state;
          });
        };
        break;
      }
      case "round_end": {
        delay = CARD_REVEAL_DELAY;
        action = () => {
          setGame((prev) => (prev ? advancePhase(prev) : prev));
        };
        break;
      }
      case "final_reveal": {
        delay = 1800;
        action = () => {
          setGame((prev) => {
            if (!prev) return prev;
            const revealed = advancePhase(prev);
            setNpcDialogue(pickDialogue(prev.config.npcArchetype, "reveal"));
            return revealed;
          });
        };
        break;
      }
      case "player_declare":
      case "player_call": {
        setIsProcessing(false);
        return;
      }
      case "complete": {
        setIsProcessing(false);
        if (game.result) {
          const key =
            game.result.winner === "npc"
              ? "winning"
              : game.result.winner === "tie"
                ? "tie"
                : "losing";
          setNpcDialogue(
            pickDialogue(game.config.npcArchetype, key),
          );
        }
        return;
      }
      default:
        return;
    }

    if (delay !== null && action !== null) {
      setIsProcessing(true);
      const fn = action;
      timeoutRef.current = setTimeout(fn, delay);
      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      };
    }
  }, [game?.phase, game?.round]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    game,
    npcDialogue,
    npcIdentity,
    isProcessing,
    startNewGame,
    declareCard,
    callOpponentAction,
    passCallAction,
    playAgain,
    returnToLobby,
  };
}

export { getDeclaredTotal, getRoundEntry };
