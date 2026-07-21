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
 *    — built-and-STAFFED capacity only (pure staffing, not market selling), so an idle or
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
import { habitablePotentialPop, industryPotential } from "@/lib/engine/development";

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

/** Clamp a possibly-degenerate input to a finite, non-negative number. */
function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** The static substrate `developmentPotential` scores at full build-out (see its doc comment). */
export interface DevelopmentPotentialInput {
  /** Habitable land — housed at full occupancy for the ceiling's population term. */
  habitableSpace: number;
  /** Total worked-able deposit slots across all resources (Σ slot caps) — every slot worked at the ceiling. */
  depositSlots: number;
  /** Fungible general space — all given to staffed production at the ceiling. */
  generalSpace: number;
}

/**
 * The dev-points ceiling a system would score at full build-out of its own physical substrate — the
 * SAME units as `developmentPoints`, so a vitals read can compute a linear
 * `pct = developmentPoints / developmentPotential`, where 100% is the system's own natural ceiling (not
 * a universe-wide reference, unlike `systemDevelopment`). Full build-out = full housing (population =
 * `habitablePotentialPop`), every deposit slot worked, all general space given to staffed production,
 * and the one allowed specialisation complex built:
 *
 *  - populationTerm: `habitablePotentialPop(habitableSpace) / POP_CENTRE_DENSITY` — the same
 *    heads-to-level-equivalent conversion `developmentPoints` uses on raw population, base heads only
 *    (no skilled uplift — the simplest defensible ceiling). Population dominates the score for most
 *    systems, so this is the primary driver; the industry term below is second-order.
 *  - industryTerm: `industryPotential(depositSlots, generalSpace)` — every deposit slot worked plus all
 *    general space as factory, in the same space units `industryPotential` already defines — valued at
 *    a single middle tier (`TIER_WEIGHT[1]`, tier-1) rather than guessing a tier-0/1/2 mix; a real
 *    system's mixed build would generally score somewhere under this uniform ceiling.
 *  - complexTerm: one `COMPLEX_POINTS` bump (the industrial pinnacle, cap 1/system), gated on having any
 *    general space to build it on — so a system with literally nothing to build on reads a true 0, not a
 *    phantom complex.
 *
 * Guards: pure, deterministic, always finite and ≥ 0 — degenerate/negative inputs clamp to 0 rather than
 * propagating NaN/Infinity; a system with no habitable land, no deposit slots, and no general space
 * returns exactly 0 (the consumer treats potential 0 ⇒ pct 0).
 *
 * First-draft calibration knob (which tier values general-space production) — tune in visual smoke; only
 * the shape above (a legible ceiling a real system's developmentPoints generally sits under) is fixed.
 */
export function developmentPotential(input: DevelopmentPotentialInput): number {
  const habitableSpace = finiteNonNegative(input.habitableSpace);
  const depositSlots = finiteNonNegative(input.depositSlots);
  const generalSpace = finiteNonNegative(input.generalSpace);

  const populationTerm = habitablePotentialPop(habitableSpace) / POP_CENTRE_DENSITY;
  const industryTerm = industryPotential(depositSlots, generalSpace) * DEVELOPMENT_POINTS.TIER_WEIGHT[1];
  const complexTerm = generalSpace > 0 ? DEVELOPMENT_POINTS.COMPLEX_POINTS : 0;

  return populationTerm + industryTerm + complexTerm;
}
