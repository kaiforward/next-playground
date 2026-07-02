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
 * "Used" depends on the building's role:
 *  - housing            → occupancy: population / POP_CENTRE_DENSITY (units the pop fills).
 *  - vocational_school / research_institute → how much of its OWN licensed skill
 *    capacity the system's skill demand actually draws on: count × min(1, skillDemand/skillCap).
 *    An academy licensing more than the system needs reads as idle and sheds, same
 *    as an over-built factory.
 *  - production (everything else) → staffed AND selling: count × min(effectiveFulfilment, outputUptake),
 *    where effectiveFulfilment is the skill-gated ratio for the good's tier — a
 *    tier-1/2 building that is headcount-full but skill-starved reads as idle too.
 *  - specialisation complex → how much of its rated family coverage the built
 *    factories draw: min(count, familyThroughput/ratedCoverage). Orphaned by a
 *    collapsed family (throughput → 0) → used → 0 → rots away like an idle academy.
 *
 * Decay is downward-only and floored at 0. Growth is deliberately excluded — that
 * is a deliberate, treasury-funded decision and belongs to SP5.
 */
import {
  effectiveFulfilment,
  housingPopCap,
  labourParts,
  labourStateFromParts,
  familyThroughput,
  complexUsed,
} from "@/lib/engine/industry";
import {
  BUILDING_TYPES,
  HOUSING_TYPE,
  POP_CENTRE_DENSITY,
  RESEARCH_INSTITUTE_TYPE,
  VOCATIONAL_SCHOOL_TYPE,
  COMPLEX_BY_TYPE,
  ANCHOR_RATED_COVERAGE,
} from "@/lib/constants/industry";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";

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

/** Housing the current population fills, in building units. */
export function housingUsed(population: number): number {
  return Math.max(0, population) / POP_CENTRE_DENSITY;
}

/** Production capacity that is both staffed and selling. */
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
  // One pass yields the headcount + skill demand/cap totals; reuse them for both the
  // production fulfilment state and the academies' own used-ratio below.
  const parts = labourParts(buildings);
  const state = labourStateFromParts(parts, population);

  const newCounts: Record<string, number> = {};
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    let used: number;
    if (type === HOUSING_TYPE) {
      used = housingUsed(population);
    } else if (type === VOCATIONAL_SCHOOL_TYPE) {
      // Academy's own "used" is the inverse ratio of production fulfilment: how much
      // of ITS licensed capacity the system's skill-1 demand actually draws on.
      used = count * (parts.skill1Cap > 0 ? Math.min(1, parts.skill1Demand / parts.skill1Cap) : 0);
    } else if (type === RESEARCH_INSTITUTE_TYPE) {
      used = count * (parts.skill2Cap > 0 ? Math.min(1, parts.skill2Demand / parts.skill2Cap) : 0);
    } else if (COMPLEX_BY_TYPE[type]) {
      // A complex's used = how much of its rated family coverage the built factories draw.
      // Orphaned (family gone) → used 0 → rots away, freeing the space + the cap slot.
      used = complexUsed(count, familyThroughput(buildings, COMPLEX_BY_TYPE[type]), ANCHOR_RATED_COVERAGE);
    } else {
      const outputGood = BUILDING_TYPES[type]?.outputGood;
      const uptake = outputGood !== undefined ? input.outputUptake(outputGood) : 1;
      const tier = outputGood !== undefined ? (GOOD_TIER_BY_KEY[outputGood] ?? 0) : 0;
      const fulfil = effectiveFulfilment(state, tier);
      used = productionUsed(count, fulfil, uptake);
    }
    const next = decayedCount(count, used, unrest, params);
    if (next < count) newCounts[type] = next;
  }

  // popCap tracks the post-decay housing count (POP_BASELINE_FLOOR stays at 0).
  const decayedBuildings = { ...buildings, ...newCounts };
  const popCap = housingPopCap(decayedBuildings) + SUBSTRATE_GEN.POP_BASELINE_FLOOR;
  return { newCounts, popCap };
}
