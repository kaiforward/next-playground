"use client";

import type { Suit } from "@/lib/engine/mini-games/voids-gambit";
import { SUIT_LABELS } from "@/lib/engine/mini-games/voids-gambit";
import { Badge } from "@/components/ui/badge";

// ── Color mapping ────────────────────────────────────────────────

type BadgeColor = "amber" | "blue" | "green" | "purple";

const SUIT_BADGE_COLORS: Record<Suit, BadgeColor> = {
  raw_materials: "amber",
  refined_goods: "blue",
  tech: "green",
  luxuries: "purple",
};

// ── Component ────────────────────────────────────────────────────

interface SuitBadgeProps {
  suit: Suit;
  className?: string;
}

/** Badge showing a suit's label in its theme color. */
export function SuitBadge({ suit, className }: SuitBadgeProps) {
  return (
    <Badge color={SUIT_BADGE_COLORS[suit]} className={className}>
      {SUIT_LABELS[suit]}
    </Badge>
  );
}
