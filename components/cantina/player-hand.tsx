"use client";

import { useEffect, useState } from "react";
import { tv } from "tailwind-variants";
import type { Card, Declaration, Suit } from "@/lib/engine/mini-games/voids-gambit";
import { VALUES_PER_SUIT } from "@/lib/engine/mini-games/voids-gambit";
import { Button } from "@/components/ui/button";
import { SuitBadge } from "./suit-badge";
import { GameCard } from "./game-card";

// ── Variants ──────────────────────────────────────────────────────

const valuePillVariants = tv({
  base: "w-10 h-10 rounded-full text-sm font-bold transition-colors",
  variants: {
    selected: {
      true: "bg-cyan-500 text-white",
      false: "bg-white/10 text-white/60 hover:bg-white/20",
    },
  },
  defaultVariants: { selected: false },
});

// ── Props ─────────────────────────────────────────────────────────

interface PlayerHandProps {
  hand: Card[];
  currentDemand: Suit | null;
  isActive: boolean;
  onDeclare: (cardId: number, declaration: Declaration) => void;
}

// ── Component ─────────────────────────────────────────────────────

export function PlayerHand({
  hand,
  currentDemand,
  isActive,
  onDeclare,
}: PlayerHandProps) {
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [selectedValue, setSelectedValue] = useState<number | null>(null);

  // Reset selection on phase transitions
  useEffect(() => {
    setSelectedCardId(null);
    setSelectedValue(null);
  }, [isActive]);

  const handleCardClick = (cardId: number) => {
    if (!isActive) return;
    setSelectedCardId(cardId === selectedCardId ? null : cardId);
    setSelectedValue(null);
  };

  const handleDeclare = () => {
    if (selectedCardId === null || selectedValue === null || !currentDemand) return;
    onDeclare(selectedCardId, { suit: currentDemand, value: selectedValue });
    setSelectedCardId(null);
    setSelectedValue(null);
  };

  return (
    <div className="space-y-4">
      {/* Hand cards */}
      <div className="flex gap-3 justify-center flex-wrap">
        {hand.map((card) => (
          <GameCard
            key={card.id}
            card={card}
            face="up"
            size="md"
            isSelectable={isActive}
            isSelected={card.id === selectedCardId}
            onClick={() => handleCardClick(card.id)}
          />
        ))}
      </div>

      {/* Declaration form — shown when a card is selected */}
      {isActive && selectedCardId !== null && currentDemand && (
        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="flex items-center gap-2 text-sm text-white/50">
            <span>Declare as</span>
            <SuitBadge suit={currentDemand} />
          </div>

          {/* Value picker */}
          <div className="flex gap-2">
            {Array.from({ length: VALUES_PER_SUIT }, (_, i) => i + 1).map(
              (v) => (
                <button
                  key={v}
                  onClick={() => setSelectedValue(v)}
                  className={valuePillVariants({ selected: v === selectedValue })}
                >
                  {v}
                </button>
              ),
            )}
          </div>

          <Button
            variant="action"
            color="green"
            size="lg"
            disabled={selectedValue === null}
            onClick={handleDeclare}
          >
            Declare
          </Button>
        </div>
      )}
    </div>
  );
}
