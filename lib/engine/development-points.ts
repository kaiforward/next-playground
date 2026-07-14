/**
 * Map-only "development points" — a raw, tier-weighted score of what a system has actually built and
 * staffed. Unlike `systemDevelopment` (the build planner's soft-saturated measure vs the galaxy's
 * biggest natural potential, `lib/engine/development.ts` — used by directed-build/construction), this
 * is a raw sum with no reference: the choropleth's value-ramp layer normalises it against the scope max,
 * exactly like population. Zero I/O.
 *
 * developmentPoints = populationTerm + industryTerm + complexTerm
 *  - populationTerm: every resident counts one level-equivalent unit (population / POP_CENTRE_DENSITY),
 *    plus a skilled uplift for filled skill-1/skill-2 jobs (`computeLabourAllocation`'s technicians/
 *    engineers). Skilled jobs only exist where an academy licenses them, so this rides along without a
 *    separate academy line or a double-count.
 *  - industryTerm: Σ over market-good producers of count × effectiveFulfilment(tier) × TIER_WEIGHT[tier]
 *    — built-and-STAFFED capacity only (pure staffing, not market uptake/selling), so an idle or
 *    unlicensed shell scores ~0.
 *  - complexTerm: one specialisation complex (cap 1/system) is worth a fixed bump — the industrial
 *    pinnacle. Housing and academies score nothing directly here (housing feeds the population term;
 *    academies feed the skilled jobs they license).
 *
 * All magnitudes are first-draft calibration knobs (`DEVELOPMENT_POINTS`) — only the relative shape
 * (advanced/skilled/staffed scores higher than raw/basic/idle of the same size) is meaningful
 * pre-tuning; magnitudes are tuned in visual smoke.
 */
import type { GoodTier } from "@/lib/types/game";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { BUILDING_TYPES, COMPLEX_BY_TYPE, POP_CENTRE_DENSITY } from "@/lib/constants/industry";
import { computeSystemLabourSnapshot, effectiveFulfilment } from "@/lib/engine/industry";

/** Points per staffed production level, by good tier. */
const TIER_WEIGHT: Record<GoodTier, number> = { 0: 1, 1: 2, 2: 4 };

/** First-draft calibration knobs for `developmentPoints` — tune in visual smoke, not here. */
export const DEVELOPMENT_POINTS = {
  /** Population-term uplift per filled skill-1 (technician) head, on top of the base 1/head. */
  SKILL1_WEIGHT: 1.5,
  /** Population-term uplift per filled skill-2 (engineer) head, on top of the base 1/head. */
  SKILL2_WEIGHT: 3,
  /** Points per staffed production level, by good tier. */
  TIER_WEIGHT,
  /** Points for one specialisation complex (cap 1/system — the industrial pinnacle). */
  COMPLEX_POINTS: 20,
};

/** The built + resident-population inputs `developmentPoints` reads. */
export interface DevelopmentPointsInput {
  /** Built building levels by type (production, extractors, academies, complexes, housing). */
  buildings: Record<string, number>;
  /** Resident population — the population term's base and the pool `computeLabourAllocation` splits. */
  population: number;
}

/**
 * Map-only raw development score for one system. See file header for the formula. Non-finite/negative
 * population is clamped so the result is always finite and ≥ 0.
 */
export function developmentPoints(input: DevelopmentPointsInput): number {
  const { buildings, population } = input;
  const pop = Math.max(0, population);
  const { state, basis: alloc } = computeSystemLabourSnapshot(buildings, pop);

  const populationTerm =
    (pop + alloc.technicians * DEVELOPMENT_POINTS.SKILL1_WEIGHT + alloc.engineers * DEVELOPMENT_POINTS.SKILL2_WEIGHT) /
    POP_CENTRE_DENSITY;

  let industryTerm = 0;
  let complexCount = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    if (COMPLEX_BY_TYPE[type]) {
      complexCount += count;
      continue;
    }
    const outputGood = BUILDING_TYPES[type]?.outputGood;
    if (outputGood === undefined) continue;
    const tier: GoodTier = GOOD_TIER_BY_KEY[outputGood] ?? 0;
    industryTerm += count * effectiveFulfilment(state, tier) * DEVELOPMENT_POINTS.TIER_WEIGHT[tier];
  }
  const complexTerm = Math.min(1, complexCount) * DEVELOPMENT_POINTS.COMPLEX_POINTS;

  return populationTerm + industryTerm + complexTerm;
}
