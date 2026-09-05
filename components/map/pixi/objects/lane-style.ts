import { laneTier } from "@/lib/engine/lanes";
import { LANE_BASE_ALPHA, LANE_WIDTH } from "../theme";

/**
 * Pure base-lane visual style, derived from a lane's fuel cost and invested level only — no Pixi
 * import, so it's `.test.ts`-able from node.
 *
 * This is the always-on base layer: it says only *where the lanes are*, at one uniform width and
 * alpha. Width grows a little with invested `level` (the one thing the player did to the lane) and
 * a bit more for a major (crossing-priced) fuel tier — every other tier is proportional to its
 * drawn length and needs no extra mark. Load, blocked and investor meaning belong to the Lanes map
 * mode, not here.
 */

export interface LaneStyleInput {
  fuelCost: number;
  /** Invested upgrade level (`WorldLane.level`), ≥ 0. */
  level: number;
}

export interface LaneStyle {
  width: number;
  alpha: number;
}

export function laneStyle({ fuelCost, level }: LaneStyleInput): LaneStyle {
  const majorExtra = laneTier(fuelCost) === "major" ? LANE_WIDTH.majorExtra : 0;
  const width = LANE_WIDTH.base + Math.max(0, level) * LANE_WIDTH.perLevel + majorExtra;
  return { width, alpha: LANE_BASE_ALPHA };
}
