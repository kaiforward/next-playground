"use client";

import { useEffect } from "react";
import { tv } from "tailwind-variants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDialog } from "@/components/ui/dialog";
import type {
  GameState,
  NpcIdentity,
  Declaration,
} from "@/lib/engine/mini-games/voids-gambit";
import {
  SUIT_LABELS,
  MAX_ROUNDS,
  getRoundEntry,
  getDeclaredTotal,
} from "@/lib/engine/mini-games/voids-gambit";
import { SuitBadge } from "@/components/ui/suit-badge";
import { DifficultyDots } from "@/components/ui/difficulty-dots";
import { ManifestRow } from "./manifest-row";
import { PlayerHand } from "./player-hand";
import { ScoringDialog } from "./scoring-dialog";

// ── Variants ────────────────────────────────────────────────────

const phaseStatusVariants = tv({
  base: "text-sm",
  variants: {
    processing: {
      true: "text-cyan-300 animate-pulse",
      false: "text-text-tertiary",
    },
  },
  defaultVariants: { processing: false },
});

// ── Phase status text ───────────────────────────────────────────

function getPhaseText(phase: string, isProcessing: boolean): string {
  switch (phase) {
    case "demand":
      return "Revealing demand...";
    case "draw":
      return "Drawing cards...";
    case "npc_declare":
      return "Opponent is declaring...";
    case "npc_call":
      return "Opponent is deciding...";
    case "player_declare":
      return "Select a card and declare its value";
    case "player_call":
      return "Call the opponent's bluff or pass";
    case "round_end":
      return "Round complete";
    case "final_reveal":
      return "Revealing all cards...";
    case "complete":
      return "Game over";
    default:
      return isProcessing ? "Processing..." : "";
  }
}

// ── Component ───────────────────────────────────────────────────

interface GameTableProps {
  game: GameState;
  npcIdentity: NpcIdentity;
  npcDialogue: string | null;
  isProcessing: boolean;
  onDeclare: (cardId: number, declaration: Declaration) => void;
  onCall: () => void;
  onPass: () => void;
  onPlayAgain: () => void;
  onReturnToLobby: () => void;
}

export function GameTable({
  game,
  npcIdentity,
  npcDialogue,
  isProcessing,
  onDeclare,
  onCall,
  onPass,
  onPlayAgain,
  onReturnToLobby,
}: GameTableProps) {
  const scoringDialog = useDialog(false);

  // Auto-open scoring dialog when game completes
  useEffect(() => {
    if (game.phase === "complete") {
      scoringDialog.onOpen();
    }
  }, [game.phase, scoringDialog.onOpen]);

  const {
    phase,
    round,
    currentDemand,
    demandHistory,
    player,
    npc,
  } = game;

  const playerTotal = getDeclaredTotal(game, "player");
  const npcTotal = getDeclaredTotal(game, "npc");
  const npcRoundEntry = getRoundEntry(game, "npc", round);

  return (
    <div className="space-y-5">
      {/* ── NPC area ────────────────────────────────────────── */}
      <div className="rounded-xl bg-surface p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-text-primary">
              {npcIdentity.displayName}
            </h2>
            <DifficultyDots level={npcIdentity.difficulty} />
          </div>
          <Badge color="slate">
            {npcIdentity.archetype.replace(/_/g, " ")}
          </Badge>
        </div>

        {npcDialogue && (
          <p className="text-base text-text-tertiary italic">
            &ldquo;{npcDialogue}&rdquo;
          </p>
        )}

        <ManifestRow
          manifest={npc.manifest}
          currentRound={round}
          label="pts"
          declaredTotal={npcTotal}
        />
      </div>

      {/* ── Round info ──────────────────────────────────────── */}
      <div className="rounded-xl bg-surface p-6 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-base font-medium text-text-primary">
            Round {round}/{MAX_ROUNDS}
          </span>
          {currentDemand && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted">Demand:</span>
              <SuitBadge suit={currentDemand} />
            </div>
          )}
        </div>

        {/* Demand history */}
        {demandHistory.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-faint uppercase tracking-wider">
              History:
            </span>
            {demandHistory.map((suit, i) => (
              <SuitBadge key={`demand-${i}`} suit={suit} />
            ))}
          </div>
        )}

        {/* Phase status */}
        <p className={phaseStatusVariants({ processing: isProcessing })}>
          {getPhaseText(phase, isProcessing)}
        </p>
      </div>

      {/* ── Player area ─────────────────────────────────────── */}
      <div className="rounded-xl bg-surface p-6 space-y-5">
        <ManifestRow
          manifest={player.manifest}
          currentRound={round}
          label="pts"
          declaredTotal={playerTotal}
          isOwner
        />

        {/* Player hand */}
        <PlayerHand
          hand={player.hand}
          currentDemand={currentDemand}
          isActive={phase === "player_declare" && !isProcessing}
          onDeclare={onDeclare}
        />

        {/* Call/pass action area */}
        {phase === "player_call" && !isProcessing && (
          <div className="flex flex-col items-center gap-4 pt-3">
            {npcRoundEntry && (
              <p className="text-sm text-text-tertiary">
                Opponent declared{" "}
                <span className="font-semibold text-text-primary">
                  {SUIT_LABELS[npcRoundEntry.declaration.suit]}{" "}
                  {npcRoundEntry.declaration.value}
                </span>
              </p>
            )}
            <div className="flex gap-4">
              <Button
                variant="action"
                color="red"
                size="lg"
                onClick={onCall}
              >
                Call Bluff
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={onPass}
              >
                Pass
              </Button>
            </div>
          </div>
        )}

        {/* Complete state — view results */}
        {phase === "complete" && (
          <div className="flex justify-center pt-3">
            <Button
              variant="primary"
              size="lg"
              onClick={scoringDialog.onOpen}
            >
              View Results
            </Button>
          </div>
        )}
      </div>

      {/* ── Scoring dialog ──────────────────────────────────── */}
      {game.result && (
        <ScoringDialog
          open={scoringDialog.open}
          onClose={scoringDialog.onClose}
          result={game.result}
          npcIdentity={npcIdentity}
          npcDialogue={npcDialogue}
          onPlayAgain={() => {
            scoringDialog.onClose();
            onPlayAgain();
          }}
          onReturnToLobby={() => {
            scoringDialog.onClose();
            onReturnToLobby();
          }}
        />
      )}
    </div>
  );
}
