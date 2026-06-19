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
}

export interface AttractivenessWeights {
  /** Weight on contentment (1 − unrest) — "how happy is the destination". */
  contentment: number;
  /** Weight on relative headroom ((popCap − pop)/popCap) — "is there room". */
  headroom: number;
}

/**
 * Migration appeal of a system — a weighted sum of contentment (1 − unrest) and
 * relative headroom. The extension slot for future appeal terms.
 */
export function migrationAttractiveness(node: MigrationNode, weights: AttractivenessWeights): number {
  const contentment = 1 - clamp(node.unrest, 0, 1);
  const headroom = node.popCap > 0 ? clamp((node.popCap - node.population) / node.popCap, 0, 1) : 0;
  return weights.contentment * contentment + weights.headroom * headroom;
}

export interface MigrationFlowParams {
  weights: AttractivenessWeights;
  /** Max fraction of the source population that may leave per run. */
  maxOutflowFraction: number;
  /** Appeal-gradient threshold below which no one moves. */
  gradientThreshold: number;
  /** Distance attenuation: factor = 1/(1 + distanceDecay·fuelCost). */
  distanceDecay: number;
}

/**
 * Population moved across one edge this run (≥ 0), from the less-attractive
 * endpoint toward the more-attractive one. Conserved; capped by the source
 * outflow fraction and the destination's headroom; distance-attenuated. The
 * caller resolves from/to from `fromIsA` and applies ±quantity.
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
  const quantity = Math.max(0, Math.min(outflow, source.population, destHeadroom));
  return { fromIsA, quantity };
}
