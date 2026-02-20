// Suit → visual mapping utilities for Void's Gambit UI.
// Single source of truth for suit colors across all cantina components.

import type { Suit } from "@/lib/engine/mini-games/voids-gambit";
import { SUIT_COLORS } from "@/lib/engine/mini-games/voids-gambit";

// ── Badge color mapping ──────────────────────────────────────────

type BadgeColor = "amber" | "blue" | "green" | "purple";

const BADGE_COLOR_MAP: Record<string, BadgeColor> = {
  amber: "amber",
  blue: "blue",
  green: "green",
  purple: "purple",
};

/** Map a Suit to the corresponding Badge `color` prop. */
export function getSuitBadgeColor(suit: Suit): BadgeColor {
  return BADGE_COLOR_MAP[SUIT_COLORS[suit]] ?? "amber";
}

// ── Card background + text classes ───────────────────────────────

export const SUIT_BG: Record<string, string> = {
  amber: "bg-amber-500/15 border-amber-500/30",
  blue: "bg-blue-500/15 border-blue-500/30",
  green: "bg-green-500/15 border-green-500/30",
  purple: "bg-purple-500/15 border-purple-500/30",
};

export const SUIT_TEXT: Record<string, string> = {
  amber: "text-amber-300",
  blue: "text-blue-300",
  green: "text-green-300",
  purple: "text-purple-300",
};
