/**
 * Pure migration functions — zero DB dependency. Population flows down-unrest /
 * up-headroom along the unified intra-faction topology (the same open edges as
 * goods diffusion, §8), distance-attenuated. Conserved: migration relocates,
 * never creates/destroys (that is growth/decline). Attractiveness is a data-driven
 * weighted sum, so future appeal terms (amenities, gateway bias, destination
 * prosperity) are additive entries — the §4 taxonomy, applied to migration.
 */

import { clamp } from "@/lib/utils/math";

export interface MigrationNode {
  unrest: number;       // 0…1
  population: number;
  popCap: number;
  /** Heads the built base wants (Σ labour totals; housing demands none). Open jobs = labourDemand − population. */
  labourDemand: number;
}

export interface AttractivenessWeights {
  /** Weight on contentment (1 − unrest) — "how happy is the destination". */
  contentment: number;
  /** Weight on relative headroom ((popCap − pop)/popCap) — "is there room". */
  headroom: number;
  /** Weight on the jobs gradient ((labourDemand − pop)/max(labourDemand, pop)) — "are there jobs". */
  jobs: number;
}

/**
 * Migration appeal of a system — a weighted sum of contentment (1 − unrest),
 * relative headroom, and the jobs gradient (open jobs pull, unemployment pushes).
 * The extension slot for future appeal terms.
 *
 * Headroom is clamped to [-1, 1]: a system at capacity scores 0; an overshot system
 * (population > popCap) scores negative, making it actively repulsive and driving
 * conserved outward migration via the existing gradient/flow machinery. At 2× capacity
 * the term floors at −1 (mirror of an empty system's +1). The destination-headroom
 * cap in migrationFlow (`destHeadroom = Math.max(0, ...)`) is intentionally left
 * clamped at 0 so population cannot migrate INTO an overshot system.
 */
export function migrationAttractiveness(node: MigrationNode, weights: AttractivenessWeights): number {
  const contentment = 1 - clamp(node.unrest, 0, 1);
  const headroom = node.popCap > 0 ? clamp((node.popCap - node.population) / node.popCap, -1, 1) : 0;
  // Jobs gradient in [-1, 1] by construction (|numerator| ≤ denominator): open jobs pull
  // (positive), full staffing is neutral (0), unemployment pushes (negative). Both zero → 0.
  const jobScale = Math.max(node.labourDemand, node.population);
  const jobs = jobScale > 0 ? (node.labourDemand - node.population) / jobScale : 0;
  return weights.contentment * contentment + weights.headroom * headroom + weights.jobs * jobs;
}

export interface MigrationFlowParams {
  weights: AttractivenessWeights;
  /** Max fraction of the source population that may leave per run. */
  maxOutflowFraction: number;
  /** Appeal-gradient threshold below which no one moves. */
  gradientThreshold: number;
  /** Distance attenuation: factor = 1/(1 + distanceDecay·fuelCost). */
  distanceDecay: number;
  /**
   * Appeal-gap bar above which a source releases *all* its staffed workers (not just the small
   * always-on leak below). The default sits above any achievable |gradient|, so above the leak
   * staffed migration is off by default; the future player "speed-dial" lowers this per chosen
   * system, at a cost, to fully coax staffed workers toward a force-grown frontier.
   */
  employedGradientThreshold: number;
  /**
   * Fraction of a source's STAFFED workers that stays drawable even below `employedGradientThreshold`
   * — a small always-on leak so a saturated core (spare labour ≈ 0) still feeds a strongly-attractive
   * (job-rich) colony a steady trickle. This is the mechanism that makes colonisation work once the
   * home worlds fill up: without it, migration to colonies stalls the moment the source has no idle
   * labour. Small by design (the core keeps almost all its workers). PR4-calibrated.
   */
  employedLeakFraction: number;
}

/**
 * Population moved across one edge this run (≥ 0), from the less-attractive
 * endpoint toward the more-attractive one. Conserved; distance-attenuated; and
 * capped at both endpoints by jobs — the destination's open jobs (absorptive
 * throttle) and the source's drawable labour (spare always, staffed only above
 * employedGradientThreshold) — as well as by housing headroom and the source
 * outflow fraction. The caller resolves from/to from `fromIsA` and applies ±quantity.
 */
export function migrationFlow(
  a: MigrationNode, b: MigrationNode, fuelCost: number, params: MigrationFlowParams,
): { fromIsA: boolean; quantity: number } {
  const gradient = migrationAttractiveness(b, params.weights) - migrationAttractiveness(a, params.weights);
  if (Math.abs(gradient) < params.gradientThreshold) return { fromIsA: true, quantity: 0 };

  const fromIsA = gradient > 0; // flow toward the more attractive endpoint
  const source = fromIsA ? a : b;
  const dest = fromIsA ? b : a;

  const distanceFactor = 1 / (1 + params.distanceDecay * fuelCost);
  const outflow = source.population * params.maxOutflowFraction * Math.abs(gradient) * distanceFactor;
  const destHeadroom = Math.max(0, dest.popCap - dest.population);

  // Destination absorptive throttle: a colony fills to its own open jobs at its own pace.
  // Usually tighter than housing headroom; a fully-staffed destination absorbs nobody.
  const absorptiveCapacity = Math.max(0, dest.labourDemand - dest.population);

  // Source draw: idle labour is always fully drawable; a small always-on fraction of STAFFED workers
  // (employedLeakFraction) also leaks toward a strongly-attractive destination, so a saturated core
  // still feeds job-rich colonies; above employedGradientThreshold the whole staffed pool unlocks.
  const sourceSpare = Math.max(0, source.population - source.labourDemand);
  const employed = Math.min(Math.max(0, source.population), Math.max(0, source.labourDemand));
  const employedEligible =
    Math.abs(gradient) > params.employedGradientThreshold ? employed : params.employedLeakFraction * employed;
  const sourceDrawable = sourceSpare + employedEligible;

  const quantity = Math.max(0, Math.min(outflow, sourceDrawable, source.population, destHeadroom, absorptiveCapacity));
  return { fromIsA, quantity };
}
