"use client";

import { tv } from "tailwind-variants";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type {
  GameResult,
  NpcIdentity,
  ResolvedCardDetail,
} from "@/lib/engine/mini-games/voids-gambit";
import { SuitBadge } from "./suit-badge";

// ── Variants ──────────────────────────────────────────────────────

const winnerHeadingVariants = tv({
  base: "text-2xl font-bold",
  variants: {
    outcome: {
      player: "text-green-400",
      npc: "text-red-400",
      tie: "text-amber-400",
    },
  },
});

const columnHeadingVariants = tv({
  base: "text-base font-semibold text-center",
  variants: {
    winner: {
      true: "text-green-400",
      false: "text-white",
    },
  },
  defaultVariants: { winner: false },
});

const cardRowVariants = tv({
  base: "flex items-center gap-2 text-xs px-2 py-1 rounded",
  variants: {
    caught: {
      true: "bg-red-500/10",
      false: "bg-white/5",
    },
  },
  defaultVariants: { caught: false },
});

const cardValueVariants = tv({
  base: "font-mono",
  variants: {
    caught: {
      true: "line-through text-red-400",
      false: "text-white",
    },
  },
  defaultVariants: { caught: false },
});

const scoredValueVariants = tv({
  base: "font-mono w-5 text-right",
  variants: {
    caught: {
      true: "text-red-400",
      false: "text-white/70",
    },
  },
  defaultVariants: { caught: false },
});

// ── Props ────────────────────────────────────────────────────────

interface ScoringDialogProps {
  open: boolean;
  onClose: () => void;
  result: GameResult;
  npcIdentity: NpcIdentity;
  npcDialogue: string | null;
  onPlayAgain: () => void;
  onReturnToLobby: () => void;
}

// ── Component ────────────────────────────────────────────────────

export function ScoringDialog({
  open,
  onClose,
  result,
  npcIdentity,
  npcDialogue,
  onPlayAgain,
  onReturnToLobby,
}: ScoringDialogProps) {
  const { winner, playerScore, npcScore, potWinnings } = result;

  const winnerLabel =
    winner === "player"
      ? "You win!"
      : winner === "npc"
        ? `${npcIdentity.displayName} wins`
        : "Tie game";

  const wagerText =
    winner === "player"
      ? `+${potWinnings} CR`
      : winner === "npc"
        ? `-${potWinnings} CR`
        : `${potWinnings} CR returned`;

  return (
    <Dialog open={open} onClose={onClose} modal>
      <div className="bg-slate-900 border border-white/10 rounded-xl p-10 w-[min(92vw,52rem)] max-h-[85vh] overflow-y-auto space-y-7">
        {/* Header */}
        <div className="text-center space-y-2">
          <h2 className={winnerHeadingVariants({ outcome: winner === "tie" ? "tie" : winner })}>
            {winnerLabel}
          </h2>
          <p className="text-base text-white/50">{wagerText}</p>
        </div>

        {/* NPC dialogue */}
        {npcDialogue && (
          <p className="text-sm text-white/40 italic text-center">
            {npcIdentity.displayName}: &ldquo;{npcDialogue}&rdquo;
          </p>
        )}

        {/* Score comparison */}
        <div className="grid grid-cols-2 gap-6">
          <ScoreColumn
            label="You"
            breakdown={playerScore}
            isWinner={winner === "player"}
          />
          <ScoreColumn
            label={npcIdentity.displayName}
            breakdown={npcScore}
            isWinner={winner === "npc"}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-4 justify-center pt-3">
          <Button variant="action" color="green" size="lg" onClick={onPlayAgain}>
            Play Again
          </Button>
          <Button variant="ghost" size="lg" onClick={onReturnToLobby}>
            Leave Table
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Score column ─────────────────────────────────────────────────

function ScoreColumn({
  label,
  breakdown,
  isWinner,
}: {
  label: string;
  breakdown: GameResult["playerScore"];
  isWinner: boolean;
}) {
  return (
    <div className="space-y-3">
      <h3 className={columnHeadingVariants({ winner: isWinner })}>
        {label}
      </h3>

      {/* Card breakdown table */}
      <div className="space-y-1.5">
        {breakdown.cardDetails.map((detail) => (
          <CardRow key={detail.round} detail={detail} />
        ))}
      </div>

      {/* Totals */}
      <div className="border-t border-white/10 pt-2 space-y-1">
        <div className="flex justify-between text-sm text-white/60">
          <span>Card values</span>
          <span>{breakdown.cardValues}</span>
        </div>
        {breakdown.penalties > 0 && (
          <div className="flex justify-between text-sm text-red-400">
            <span>Penalties</span>
            <span>-{breakdown.penalties}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-bold text-white">
          <span>Total</span>
          <span>{breakdown.total}</span>
        </div>
      </div>
    </div>
  );
}

// ── Single card row ──────────────────────────────────────────────

function CardRow({ detail }: { detail: ResolvedCardDetail }) {
  const { declaration, honest, caught, scoredValue, round } = detail;

  return (
    <div className={cardRowVariants({ caught })}>
      <span className="text-white/30 w-5 text-center">{round}</span>
      <SuitBadge suit={declaration.suit} className="text-[10px] px-1.5 py-0" />
      <span className={cardValueVariants({ caught })}>
        {declaration.value}
      </span>
      <span className="ml-auto text-white/30 text-[11px]">
        {caught ? "caught" : honest ? "honest" : "bluff"}
      </span>
      <span className={scoredValueVariants({ caught })}>
        {scoredValue}
      </span>
    </div>
  );
}
