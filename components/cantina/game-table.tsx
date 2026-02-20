"use client";

import { useEffect } from "react";
import { tv } from "tailwind-variants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDialog } from "@/components/ui/dialog";
import {
  SUIT_LABELS,
  MAX_ROUNDS,
  getRoundEntry,
  getDeclaredTotal,
} from "@/lib/engine/mini-games/voids-gambit";
import type { UseVoidsGambit } from "@/lib/hooks/use-voids-gambit";
import { getSuitBadgeColor } from "./suit-styles";
import { DifficultyDots } from "./difficulty-dots";
import { ManifestRow } from "./manifest-row";
import { PlayerHand } from "./player-hand";
import { ScoringDialog } from "./scoring-dialog";

// ── Variants ────────────────────────────────────────────────────

const phaseStatusVariants = tv({
  base: "text-sm",
  variants: {
    processing: {
      true: "text-cyan-300 animate-pulse",
      false: "text-white/50",
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
  vg: UseVoidsGambit;
}

export function GameTable({ vg }: GameTableProps) {
  const { game, npcDialogue, npcIdentity, isProcessing } = vg;
  const scoringDialog = useDialog(false);

  // Auto-open scoring dialog when game completes
  useEffect(() => {
    if (game?.phase === "complete") {
      scoringDialog.onOpen();
    }
  }, [game?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!game || !npcIdentity) return null;

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
      <div className="rounded-xl bg-white/5 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-white">
              {npcIdentity.displayName}
            </h2>
            <DifficultyDots level={npcIdentity.difficulty} />
          </div>
          <Badge color="slate">
            {npcIdentity.archetype.replace(/_/g, " ")}
          </Badge>
        </div>

        {npcDialogue && (
          <p className="text-base text-white/50 italic">
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
      <div className="rounded-xl bg-white/5 p-6 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-base font-medium text-white">
            Round {round}/{MAX_ROUNDS}
          </span>
          {currentDemand && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/40">Demand:</span>
              <Badge color={getSuitBadgeColor(currentDemand)}>
                {SUIT_LABELS[currentDemand]}
              </Badge>
            </div>
          )}
        </div>

        {/* Demand history */}
        {demandHistory.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-white/30 uppercase tracking-wider">
              History:
            </span>
            {demandHistory.map((suit, i) => (
              <Badge
                key={i}
                color={getSuitBadgeColor(suit)}
              >
                {SUIT_LABELS[suit]}
              </Badge>
            ))}
          </div>
        )}

        {/* Phase status */}
        <p className={phaseStatusVariants({ processing: isProcessing })}>
          {getPhaseText(phase, isProcessing)}
        </p>
      </div>

      {/* ── Player area ─────────────────────────────────────── */}
      <div className="rounded-xl bg-white/5 p-6 space-y-5">
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
          onDeclare={vg.declareCard}
        />

        {/* Call/pass action area */}
        {phase === "player_call" && !isProcessing && (
          <div className="flex flex-col items-center gap-4 pt-3">
            {npcRoundEntry && (
              <p className="text-sm text-white/50">
                Opponent declared{" "}
                <span className="font-semibold text-white">
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
                onClick={vg.callOpponentAction}
              >
                Call Bluff
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={vg.passCallAction}
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
            vg.playAgain();
          }}
          onReturnToLobby={() => {
            scoringDialog.onClose();
            vg.returnToLobby();
          }}
        />
      )}
    </div>
  );
}
