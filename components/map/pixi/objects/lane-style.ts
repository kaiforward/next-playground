import { laneTier } from "@/lib/engine/lanes";
import { LANE_BASE_ALPHA, LANE_BASE_COLOR, LANE_MODE, LANE_WIDTH } from "../theme";
import type { LaneBand } from "./lane-band";

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

export interface LaneModeStyleInput {
  /** The faction holding both endpoints (`ConnectionData.investorFactionId`), or null when unclaimed
   *  or split — the lane carries no investor, so it draws dashed and slate regardless of `factionColor`. */
  investorFactionId: string | null;
  /** The investor's Pixi colour (`PoliticalTerritoryLayer.getFactionColors()`), or null when there is
   *  no investor or its colour hasn't synced yet. Ignored when `investorFactionId` is null. */
  factionColor: number | null;
  /** Invested upgrade level (`WorldLane.level`), ≥ 0. */
  level: number;
  band: LaneBand;
}

export interface LaneModeStyle {
  color: number;
  width: number;
  alpha: number;
  /** True exactly when the lane has no investor — the Lanes mode's only dashed case. */
  dashed: boolean;
}

/**
 * The Lanes map mode's lane style — carries the meaning the base layer (`laneStyle` above)
 * deliberately leaves out: the investor's colour, a stronger level-driven width ramp, and a
 * load-band alpha step. Dashed means "no investor," full stop, independent of the band; a dashed
 * lane can still be busy or congested.
 */
export function laneModeStyle({
  investorFactionId, factionColor, level, band,
}: LaneModeStyleInput): LaneModeStyle {
  const dashed = investorFactionId === null;
  const color = dashed ? LANE_BASE_COLOR : (factionColor ?? LANE_BASE_COLOR);
  const width = LANE_MODE.baseWidth + Math.max(0, level) * LANE_MODE.perLevel;
  const alpha = band === "fine" ? LANE_MODE.fineAlpha : LANE_MODE.busyAlpha;
  return { color, width, alpha, dashed };
}
