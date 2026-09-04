import { DEFAULT_SYSTEM_COUNT, genConfigForSystemCount } from "@/lib/constants/universe-gen";
import { LANE_LOAD_COLOR, LANE_WIDTH } from "../theme";

/**
 * Pure lane visual style, derived from a lane's fuel cost, invested level, load, and blocked state —
 * no Pixi import, so it's `.test.ts`-able from node.
 *
 * Three fuel bands rather than a single threshold. Fuel is priced as
 * (distance ÷ average intra-region hop) × `INTRA_REGION_BASE_FUEL`, times `CROSSING_FUEL_MULTIPLIER`
 * for a corridor's crossing-style lane, so an ordinary lane at typical spacing sits at the base fuel:
 * "notable" catches a lane pricier than 1.5 typical hops, "major" one priced at or beyond a crossing
 * at typical spacing. Neither fuel constant varies with system count, so the default config's values
 * are the values.
 *
 * Width grows with invested `level` from the fuel tier's base width (a heavier corridor reads
 * thicker regardless of how it was priced). Colour reads load, not fuel: grey at ~0 booked load,
 * warming toward amber as `bookedLoad / capacity` rises toward 1 — RED only when `blockedVolume > 0`
 * this run (congestion that turned volume away, i.e. "invest here"), never merely "nearly full".
 */

export type LaneTier = "ordinary" | "notable" | "major";

const { INTRA_REGION_BASE_FUEL, CROSSING_FUEL_MULTIPLIER } = genConfigForSystemCount(DEFAULT_SYSTEM_COUNT);
const NOTABLE_FUEL_THRESHOLD = INTRA_REGION_BASE_FUEL * 1.5;
const MAJOR_FUEL_THRESHOLD = INTRA_REGION_BASE_FUEL * CROSSING_FUEL_MULTIPLIER;

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

function tierFor(fuelCost: number): { tier: LaneTier; baseWidth: number; alpha: number } {
  if (fuelCost >= MAJOR_FUEL_THRESHOLD) return { tier: "major", baseWidth: LANE_WIDTH.major, alpha: 0.85 };
  if (fuelCost >= NOTABLE_FUEL_THRESHOLD) return { tier: "notable", baseWidth: LANE_WIDTH.notable, alpha: 0.6 };
  return { tier: "ordinary", baseWidth: LANE_WIDTH.ordinary, alpha: 0.4 };
}

/** The fuel-only half of `laneStyle` — a lane's tier from its fuel cost alone, for callers (the
 *  lane card's subtitle) that need the tier label without a level/load/blocked reading. */
export function laneTier(fuelCost: number): LaneTier {
  return tierFor(fuelCost).tier;
}

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
  const { baseWidth, alpha } = tierFor(fuelCost);
  const tier = laneTier(fuelCost);
  const width = baseWidth + Math.max(0, level) * LANE_WIDTH.perLevel;
  const t = Math.max(0, Math.min(1, load));
  const color = blocked ? LANE_LOAD_COLOR.blocked : lerpColor(LANE_LOAD_COLOR.idle, LANE_LOAD_COLOR.loaded, t);
  return { tier, width, alpha, color };
}
