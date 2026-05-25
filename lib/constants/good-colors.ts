import { GOODS } from "./goods";

/**
 * Pixi-side tint per good (24-bit RGB integer). Used by the trade-flow Pixi
 * layer (and any future legend UI) so good identity is consistent everywhere
 * volume is visualized.
 *
 * Colours echo the existing `--color-status-*` palette family without binding
 * to the CSS variable system (Pixi needs hex integers, not CSS strings):
 *   green   → agricultural staples (food, water)
 *   amber   → raw extraction (ore, textiles)
 *   sky     → energy (fuel)
 *   slate   → industrial bulk (metals, machinery)
 *   teal    → chemicals
 *   rose    → medicine
 *   cyan    → electronics
 *   red     → weapons
 *   purple  → luxuries
 * Anything not listed falls back to NEUTRAL so unfamiliar goods still render.
 */
export const GOOD_COLOR: Readonly<Record<string, number>> = {
  water:       0x86efac, // green-300
  food:        0x4ade80, // green-400
  ore:         0xfcd34d, // amber-300
  textiles:    0xf59e0b, // amber-500
  fuel:        0x38bdf8, // sky-400
  metals:      0xcbd5e1, // slate-300
  chemicals:   0x2dd4bf, // teal-400
  medicine:    0xfb7185, // rose-400
  electronics: 0x67e8f9, // cyan-300
  machinery:   0x94a3b8, // slate-400
  weapons:     0xef4444, // red-500
  luxuries:    0xc084fc, // purple-400
};

/** Neutral fallback for goods without an explicit colour. */
export const GOOD_COLOR_NEUTRAL = 0x94a3b8; // slate-400

export function getGoodColor(goodId: string): number {
  return GOOD_COLOR[goodId] ?? GOOD_COLOR_NEUTRAL;
}

// Dev-time guard: every catalogued good should have a colour. Loud failure in
// non-production so a new good doesn't silently render as neutral.
if (process.env.NODE_ENV !== "production") {
  for (const goodId of Object.keys(GOODS)) {
    if (!(goodId in GOOD_COLOR)) {
      console.warn(
        `[good-colors] Missing colour for "${goodId}" — falling back to neutral.`,
      );
    }
  }
}
