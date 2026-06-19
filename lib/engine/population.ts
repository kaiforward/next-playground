/**
 * Pure population-dynamics functions — zero DB dependency.
 *
 * The consequence spine: measure → accumulate → threshold → effect.
 *  - measure:    dissatisfaction() folds per-good satisfaction into one convex,
 *                demand-weighted number D for a system this tick.
 *  - accumulate: accumulateUnrest() integrates D into the stored unrest property.
 *  - threshold:  strikeMultiplier() derives the production-suppression regime from
 *                unrest — a smooth ramp, not a binary halt. Unrest's own integral
 *                is the hysteresis, so no separate stored strike flag is needed.
 *  - effect:     populationDelta() is the logistic growth/decline term.
 *
 * Each is a small, total function so additions to the spine are new terms, not
 * new branches.
 */

import { clamp } from "@/lib/utils/math";

/** One consumed good's signal for a system this tick. */
export interface GoodSatisfaction {
  /** delivered / demanded in [0,1]; 1 = well-fed, 0 = floor-pinned. */
  satisfaction: number;
  /** demanded_g = perCapitaNeed × population — the demand-share weight. */
  demanded: number;
}

/**
 * Convex, demand-weighted dissatisfaction D in [0,1] for one system:
 *   D = sum_g demandShare_g * (1 - satisfaction_g)^2,  demandShare_g = demanded_g / sum(demanded)
 * Importance comes from demand magnitude (people need ~8x more food than luxuries),
 * not a separate field; convexity makes a deep shortage dominate many shallow ones.
 * Returns 0 when nothing is demanded.
 */
export function dissatisfaction(goods: GoodSatisfaction[]): number {
  let totalDemand = 0;
  for (const g of goods) totalDemand += Math.max(0, g.demanded);
  if (totalDemand <= 0) return 0;
  let d = 0;
  for (const g of goods) {
    const share = Math.max(0, g.demanded) / totalDemand;
    const gap = 1 - clamp(g.satisfaction, 0, 1);
    d += share * gap * gap;
  }
  return d;
}

export interface UnrestParams {
  /** How much one tick of full dissatisfaction adds to unrest. */
  gain: number;
  /** Fraction of unrest shed per tick when satisfied. */
  decay: number;
}

/**
 * Integrates dissatisfaction into unrest (the slow-moving stored property):
 *   unrest <- clamp(unrest + gain*D - decay*unrest, 0, 1)
 * Catastrophe lives in the integral — one bad tick is harmless, chronic shortage
 * climbs toward 1 over many ticks; relief decays it back toward 0.
 */
export function accumulateUnrest(unrest: number, d: number, params: UnrestParams): number {
  return clamp(unrest + params.gain * clamp(d, 0, 1) - params.decay * unrest, 0, 1);
}

export interface StrikeParams {
  /** Unrest below this threshold produces no suppression (multiplier 1). */
  threshold: number;
  /** Production multiplier at unrest = 1 (deepest strike); e.g. 0.25 = 75% cut. */
  floorMultiplier: number;
}

/**
 * Production-suppression multiplier derived from unrest, in [floorMultiplier, 1].
 * Returns 1 below threshold, then ramps linearly to floorMultiplier at unrest = 1.
 * A smooth ramp (markets drift, never teleport). Consumption is never suppressed —
 * people still eat regardless of labor action.
 */
export function strikeMultiplier(unrest: number, params: StrikeParams): number {
  if (unrest <= params.threshold) return 1;
  if (params.threshold >= 1) return 1;
  const t = clamp((unrest - params.threshold) / (1 - params.threshold), 0, 1);
  return 1 - t * (1 - params.floorMultiplier);
}

export interface PopulationParams {
  /** Logistic growth rate toward popCap when fully satisfied and calm. */
  growthRate: number;
  /** Decline rate scaled by unrest. */
  declineRate: number;
}

/**
 * Logistic population change for one tick:
 *   delta = growthRate * pop * (1 - pop/popCap) * (1 - D)  -  declineRate * pop * unrest
 * Fed and calm: grows toward popCap then asymptotes (no runaway).
 * Starved or unstable: net-declines. popCap = 0 suppresses the growth term entirely.
 */
export function populationDelta(
  population: number,
  popCap: number,
  d: number,
  unrest: number,
  params: PopulationParams,
): number {
  const headroom = popCap > 0 ? Math.max(0, 1 - population / popCap) : 0;
  const satisfactionFactor = clamp(1 - d, 0, 1);
  const growth = params.growthRate * population * headroom * satisfactionFactor;
  const decline = params.declineRate * population * clamp(unrest, 0, 1);
  return growth - decline;
}
