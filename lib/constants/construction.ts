import {
  HOUSING_TYPE,
  VOCATIONAL_SCHOOL_TYPE,
  RESEARCH_INSTITUTE_TYPE,
  COMPLEX_TYPES,
} from "@/lib/constants/industry";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";

/**
 * Committed-construction tuning. First-draft, simulator-calibrated in PR4 — only the relative shape
 * matters here (build times span months; wealth buys parallel fronts, not instant builds).
 *
 * A per-faction throughput pool (`Σ pop × THROUGHPUT_PER_POP`) funds a queue of construction projects.
 * Each active build absorbs at most `PER_BUILD_ABSORPTION_CAP` construction points per pulse, so a
 * level's minimum build time is `workCostPerLevel ÷ cap` pulses — a floor wealth cannot buy past. A
 * larger pool spreads across more builds (parallel fronts ≈ pool ÷ cap), never finishing one faster.
 */
export const CONSTRUCTION = {
  /** Construction points a faction's pool gains per unit population per pulse (matches the old build scale). */
  THROUGHPUT_PER_POP: 0.05,
  /** Most points one build can absorb per pulse — sets the minimum build time (work ÷ cap) and the front count. */
  PER_BUILD_ABSORPTION_CAP: 4,
  /** Fallback per-level work cost for a building type with no explicit override (tier-derived below). */
  DEFAULT_WORK_PER_LEVEL: 20,
  /**
   * Pool fairness floor (docs/planned/economy-colony-bootstrapping.md §3.4 / §7.9). The front-first pool
   * otherwise lets a homeworld's larger builds monopolise it, so a young colony's valid first build never
   * funds. Reserve a guaranteed minimum slice per young colony, self-weaning with development:
   * POOL_FLOOR_BASE construction points at development 0, fading to nothing at FLOOR_DEV_KNEE. A minimum,
   * never a max-spend cap — the homeworld still drains the remainder by value. Coarse first-cut; PR4 tunes.
   */
  POOL_FLOOR_BASE: 4,
  /** Development at which a colony has weaned fully off the pool floor (self-weaning training wheels). */
  FLOOR_DEV_KNEE: 0.3,
} as const;

/** Explicit per-level work costs for the non-production building types (housing, academies, complexes). */
const WORK_PER_LEVEL_OVERRIDE: Record<string, number> = {
  [HOUSING_TYPE]: 8,
  [VOCATIONAL_SCHOOL_TYPE]: 15,
  [RESEARCH_INSTITUTE_TYPE]: 15,
  ...Object.fromEntries(COMPLEX_TYPES.map((t) => [t, 40])),
};

/**
 * Construction work to build one whole level of `buildingType`. Housing is cheap; a specialisation
 * complex is the most work; production factories scale with their tier (a tier-2 line is more work
 * than a tier-0 extractor). Coarse first-cut — PR4 calibrates the magnitudes.
 */
export function workCostPerLevel(buildingType: string): number {
  const override = WORK_PER_LEVEL_OVERRIDE[buildingType];
  if (override !== undefined) return override;
  const tier = GOOD_TIER_BY_KEY[buildingType];
  if (tier === 0) return 12; // extractor
  if (tier === 1) return 20; // tier-1 factory
  if (tier === 2) return 30; // tier-2 factory
  return CONSTRUCTION.DEFAULT_WORK_PER_LEVEL;
}
