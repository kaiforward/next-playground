import { pixiHexToCss } from "@/lib/constants/good-colors";
import { LANE_BAND_COLOR, LANE_BUSY_LOAD_FRACTION } from "../theme";

/**
 * One band definition shared by lane brightness, convoy particle density and the Lanes-mode cell
 * choropleth (docs/active/engineering/map-rendering.md → Lane layer) — a single rule so the three presentations never
 * drift apart. No Pixi import, so it's `.test.ts`-able from node.
 *
 * `congested` beats `busy` beats `fine`: a lane that turned volume away this run
 * (`blockedVolume > 0`) is congested regardless of how loaded it is; short of that, load at or
 * above `LANE_BUSY_LOAD_FRACTION` (unclamped — a lane can run past 1.0) is busy; everything else is
 * fine.
 */

export type LaneBand = "fine" | "busy" | "congested";

/** Worst-last order — also the choropleth's severity ranking. */
export const LANE_BANDS: readonly LaneBand[] = ["fine", "busy", "congested"];

export interface LaneBandInput {
  /** `bookedLoad / capacity`, unclamped — can exceed 1. */
  load: number;
  /** This run's `blockedVolume > 0` — congestion turned volume away. */
  blocked: boolean;
}

export function laneBand({ load, blocked }: LaneBandInput): LaneBand {
  if (blocked) return "congested";
  if (load >= LANE_BUSY_LOAD_FRACTION) return "busy";
  return "fine";
}

/** The worst band among an iterable of bands, or null for an empty input. */
export function worstLaneBand(bands: Iterable<LaneBand>): LaneBand | null {
  let worst: LaneBand | null = null;
  for (const band of bands) {
    if (worst === null || laneBandIndex(band) > laneBandIndex(worst)) {
      worst = band;
    }
  }
  return worst;
}

/** 0 fine, 1 busy, 2 congested — the severity index the Lanes-mode choropleth colours by. */
export function laneBandIndex(band: LaneBand): number {
  return LANE_BANDS.indexOf(band);
}

/** CSS colour for the legend, from the same status hexes the map draws with. */
export function laneBandCss(band: LaneBand): string {
  return pixiHexToCss(LANE_BAND_COLOR[band]);
}
