import { laneTier, type LaneTier } from "@/lib/engine/lanes";
import { LANE_LOAD_COLOR, LANE_WIDTH } from "../theme";

/**
 * Pure lane visual style, derived from a lane's fuel cost, invested level, load, and blocked state —
 * no Pixi import, so it's `.test.ts`-able from node.
 *
 * The fuel-cost tier itself (`laneTier`, `lib/engine/lanes.ts`) is the lane engine's, not this
 * layer's: the lane card names the same band this file draws from. What lives here is only what the
 * tier LOOKS like — its base line weight and alpha.
 *
 * Width grows with invested `level` from the fuel tier's base width (a heavier corridor reads
 * thicker regardless of how it was priced). Colour reads load, not fuel: grey at ~0 booked load,
 * warming toward amber as `bookedLoad / capacity` rises toward 1 — RED only when `blockedVolume > 0`
 * this run (congestion that turned volume away, i.e. "invest here"), never merely "nearly full".
 */

export interface LaneStyleInput {
  fuelCost: number;
  /** Invested upgrade level (`WorldLane.level`), ≥ 0. */
  level: number;
  /** `bookedLoad / capacity`, unclamped at the call site — this helper clamps to [0, 1] for colour. */
  load: number;
  /** This run's `blockedVolume > 0` — congestion turned volume away. */
  blocked: boolean;
}

export interface LaneStyle {
  tier: LaneTier;
  width: number;
  alpha: number;
  /** Pixi 0xRRGGBB. */
  color: number;
}

/** What each fuel-cost tier looks like before the invested level widens it. */
const TIER_STYLE: Record<LaneTier, { baseWidth: number; alpha: number }> = {
  major: { baseWidth: LANE_WIDTH.major, alpha: 0.85 },
  notable: { baseWidth: LANE_WIDTH.notable, alpha: 0.6 },
  ordinary: { baseWidth: LANE_WIDTH.ordinary, alpha: 0.4 },
};

/** Linear-interpolate two 0xRRGGBB colours by `t` ∈ [0, 1]. */
function lerpColor(from: number, to: number, t: number): number {
  const fr = (from >> 16) & 0xff, fg = (from >> 8) & 0xff, fb = from & 0xff;
  const tr = (to >> 16) & 0xff, tg = (to >> 8) & 0xff, tb = to & 0xff;
  const r = Math.round(fr + (tr - fr) * t);
  const g = Math.round(fg + (tg - fg) * t);
  const b = Math.round(fb + (tb - fb) * t);
  return (r << 16) | (g << 8) | b;
}

export function laneStyle({ fuelCost, level, load, blocked }: LaneStyleInput): LaneStyle {
  const tier = laneTier(fuelCost);
  const { baseWidth, alpha } = TIER_STYLE[tier];
  const width = baseWidth + Math.max(0, level) * LANE_WIDTH.perLevel;
  const t = Math.max(0, Math.min(1, load));
  const color = blocked ? LANE_LOAD_COLOR.blocked : lerpColor(LANE_LOAD_COLOR.idle, LANE_LOAD_COLOR.loaded, t);
  return { tier, width, alpha, color };
}
