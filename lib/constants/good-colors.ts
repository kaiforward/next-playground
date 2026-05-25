import type { GoodTier } from "@/lib/types/game";
import { GOOD_TIER_BY_KEY } from "./goods";

/**
 * Pixi-side tint per good *tier*. Used by the trade-flow Pixi layer (and
 * any future overlay/legend) so good identity reads at a glance without
 * the player needing to memorize twelve-plus distinct colors.
 *
 * Tier progression reads as a tech ladder:
 *   T0 raw       → green   (agricultural / extractive bulk)
 *   T1 processed → amber   (refined industrial — also echoes Foundry accent)
 *   T2 advanced  → cyan    (high-tech precision goods)
 *
 * Specific good identity (which T0 good is moving here? food vs ore?) comes
 * from the system detail panel (PR3) and the future hover-tooltip iteration.
 * The map overlay's job is "where is trade happening, and roughly of what
 * kind" — not full composition disclosure.
 */
export const TIER_COLOR: Readonly<Record<GoodTier, number>> = {
  0: 0x4ade80, // green-400 — raw
  1: 0xf59e0b, // amber-500 — processed (Foundry accent family)
  2: 0x22d3ee, // cyan-400  — advanced
};

/** Player-facing label for each tier — shared with the map legend. */
export const TIER_LABEL: Readonly<Record<GoodTier, string>> = {
  0: "Raw",
  1: "Processed",
  2: "Advanced",
};

/** Fallback when a goodId isn't in the tier map (shouldn't happen in practice). */
export const GOOD_COLOR_NEUTRAL = 0x94a3b8; // slate-400

export function getGoodColor(goodId: string): number {
  const tier = GOOD_TIER_BY_KEY[goodId];
  if (tier === undefined) return GOOD_COLOR_NEUTRAL;
  return TIER_COLOR[tier];
}

/** Convert a Pixi hex int (0xRRGGBB) to a CSS color (#rrggbb). */
export function pixiHexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}
