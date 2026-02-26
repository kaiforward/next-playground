"use client";

import { tv } from "tailwind-variants";
import type { ManifestEntry } from "@/lib/engine/mini-games/voids-gambit";
import { MAX_ROUNDS } from "@/lib/engine/mini-games/voids-gambit";
import { GameCard } from "./game-card";

// ── Variants ──────────────────────────────────────────────────────

const emptySlotVariants = tv({
  base: "w-32 h-[10.5rem] rounded-lg border border-dashed flex items-center justify-center text-base",
  variants: {
    current: {
      true: "border-border-strong text-text-faint",
      false: "border-border text-text-faint/40",
    },
  },
  defaultVariants: { current: false },
});

// ── Props ─────────────────────────────────────────────────────────

interface ManifestRowProps {
  manifest: ManifestEntry[];
  currentRound: number;
  label: string;
  declaredTotal: number;
  /** If true, cards are always shown face-up (player knows their own cards). */
  isOwner?: boolean;
}

// ── Component ─────────────────────────────────────────────────────

export function ManifestRow({
  manifest,
  currentRound,
  label,
  declaredTotal,
  isOwner = false,
}: ManifestRowProps) {
  const slots = Array.from({ length: MAX_ROUNDS }, (_, i) => {
    const round = i + 1;
    return manifest.find((e) => e.round === round) ?? null;
  });

  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1.5">
        {slots.map((entry, i) => {
          const round = i + 1;

          // Empty slot
          if (!entry) {
            return (
              <div
                key={round}
                className={emptySlotVariants({ current: round === currentRound })}
              >
                {round}
              </div>
            );
          }

          // Owner always sees their actual card; opponent only when revealed
          const showFaceUp = isOwner || entry.revealed;

          return (
            <div key={round} className="relative pb-4">
              <GameCard
                card={showFaceUp ? entry.card : undefined}
                face={showFaceUp ? "up" : "down"}
                declaration={entry.declaration}
                size="md"
                isCaught={entry.caught}
              />
            </div>
          );
        })}
      </div>
      <div className="text-right min-w-[4rem]">
        <div className="text-sm text-text-muted">{label}</div>
        <div className="text-lg font-bold text-text-primary">{declaredTotal}</div>
      </div>
    </div>
  );
}
