/**
 * Pure infrastructure-decay math — zero DB dependency.
 *
 * One rule: infrastructure decays toward what is actively USED. The gap between
 * built (`count`) and used is what rots. Two channels:
 *  - disuse (gentle): built capacity above its used level rots toward it. A small
 *    `disuseRate` is itself the hysteresis — one idle tick removes only a sliver,
 *    only a sustained gap compounds down (mirrors how strikeMultiplier derives its
 *    regime from the unrest integral without its own stored state).
 *  - unrest (catastrophic): above a threshold, capacity is torn down even while in
 *    use — the infrastructure mirror of the population decline term, the snowball.
 *
 * "Used" is a building's utilization in absolute units, resolved uniformly by
 * `buildingUsed` (dispatched on the building's typed output): housing occupancy, an
 * academy's skill-licence draw, a complex's family coverage, or a producer's
 * staffed-and-selling capacity — all through one function, no per-type branch here.
 *
 * Decay is downward-only and floored at 0. Growth is excluded — it is the
 * directed-build processor's job.
 */
import {
  buildingUsed,
  housingPopCap,
  labourParts,
  labourStateFromParts,
  type UtilizationContext,
} from "@/lib/engine/industry";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";

/** The housing-occupancy primitive lives in industry.ts; re-exported here for callers/tests that read it directly. */
export { housingUsed } from "@/lib/engine/industry";

export interface DecayParams {
  /** Fraction of idle capacity (count − used) that rots per run. Small → sticky. */
  disuseRate: number;
  /** Unrest-driven teardown coefficient (per run, per unit count, per unit excess unrest). */
  unrestRate: number;
  /** θ_decay: unrest at or below this triggers no unrest teardown. */
  unrestThreshold: number;
}

export interface SystemDecayInput {
  /** buildingType → count. */
  buildings: Record<string, number>;
  population: number;
  /** Stored unrest integral 0…1. */
  unrest: number;
  /** Per produced-good output uptake ∈ [0,1] (seller-side signal); missing ⇒ 1. */
  outputUptake: (goodId: string) => number;
}

export interface SystemDecayResult {
  /** buildingType → new (strictly lower) count. Only entries that actually decayed. */
  newCounts: Record<string, number>;
  /** popCap recomputed from the post-decay housing count. */
  popCap: number;
}

/** Production capacity that is both staffed and selling. The market_good branch of `buildingUsed`. */
export function productionUsed(count: number, labourFulfillment: number, outputUptake: number): number {
  return count * Math.min(labourFulfillment, outputUptake);
}

/** Gentle disuse decay amount: the idle gap above `used`, scaled by the rate. */
export function disuseDecay(count: number, used: number, rate: number): number {
  return rate * Math.max(0, count - used);
}

/** Catastrophic unrest decay amount: working capacity torn down above the threshold. */
export function unrestDecay(count: number, unrest: number, rate: number, threshold: number): number {
  return rate * count * Math.max(0, unrest - threshold);
}

/** New count after both decay channels, floored at 0 (downward-only). */
export function decayedCount(count: number, used: number, unrest: number, params: DecayParams): number {
  const next = count - disuseDecay(count, used, params.disuseRate)
    - unrestDecay(count, unrest, params.unrestRate, params.unrestThreshold);
  return Math.max(0, next);
}

/**
 * Decay one system's whole built base. Returns only the building types whose count
 * actually fell (so writes stay minimal) plus the recomputed popCap. Labour state is
 * computed once and reused across every building (the headcount gate + two skill-ceiling
 * gates); uptake is per produced good (1 when not staffed/produced).
 */
export function computeSystemDecay(input: SystemDecayInput, params: DecayParams): SystemDecayResult {
  const { buildings, population, unrest } = input;
  // One labourParts pass feeds every building's utilization (the headcount gate, both skill
  // ceilings, and the academies' own licence-draw ratios) via one shared context.
  const parts = labourParts(buildings);
  const state = labourStateFromParts(parts, population);
  const ctx: UtilizationContext = { buildings, population, parts, state, outputUptake: input.outputUptake };

  const newCounts: Record<string, number> = {};
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const used = buildingUsed(type, count, ctx);
    const next = decayedCount(count, used, unrest, params);
    if (next < count) newCounts[type] = next;
  }

  // popCap tracks the post-decay housing count (POP_BASELINE_FLOOR stays at 0).
  const decayedBuildings = { ...buildings, ...newCounts };
  const popCap = housingPopCap(decayedBuildings) + SUBSTRATE_GEN.POP_BASELINE_FLOOR;
  return { newCounts, popCap };
}
