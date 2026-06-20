/**
 * Generation seeding allocator — pure, zero DB dependency.
 *
 * Distributes a system's build-space budget across extractors, manufacturers,
 * and housing into a partial, varied, self-consistent industrial base:
 *   1. tier-0 extractors up to min(deposit, space share)
 *   2. tier-1+ manufacturers only where their direct inputs are locally
 *      producible (input-consistent — no Smelters without an Ore path)
 *   3. housing sized so popCap can staff the production labour demanded
 *   4. everything scaled by a development-fill fraction, capped at buildSpace
 * Coarse by design — the four triangle knobs and this heuristic are the
 * primary simulator-tuned surface. Deterministic given the RNG.
 */
import type { ResourceVector } from "@/lib/types/game";
import type { RNG } from "@/lib/engine/universe-gen";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import {
  BUILDING_TYPES,
  HOUSING_TYPE,
  PRODUCTION_BUILDING_TYPES,
  effectiveSpaceCost,
  POP_CENTRE_DENSITY,
} from "@/lib/constants/industry";
import { labourDemand, housingPopCap, buildSpaceUsed } from "@/lib/engine/industry";

export interface AllocateInput {
  /** System aggregate resource vector (tier-0 deposit caps). */
  aggregate: ResourceVector;
  /** Total build-space budget (Σ body BASE_SPACE × size × habitability). */
  buildSpace: number;
  /** popCap derived from bodies, before housing adds to it. */
  bodyBaselinePopCap: number;
  /** Development fill fraction in [0, 1] — varied by habitability at the caller. */
  fill: number;
}

export interface AllocateResult {
  buildings: Record<string, number>;
  buildSpace: number;
  popCap: number;
}

/** Fraction of the budget reserved for production vs housing before fill scaling. */
const PRODUCTION_SHARE = 0.6;
/** Per-manufacturer target count before fill scaling (coarse). */
const MANUFACTURER_BASE_COUNT = 2;

export function allocateIndustry(input: AllocateInput, rng: RNG): AllocateResult {
  const { aggregate, buildSpace, bodyBaselinePopCap } = input;
  const fill = Math.max(0, Math.min(1, input.fill));
  const buildings: Record<string, number> = {};

  // Budget split: most of the space goes to production, the rest to housing.
  const productionBudget = buildSpace * PRODUCTION_SHARE * fill;
  let productionUsed = 0;

  // 1) Tier-0 extractors — capped by deposit ∩ a per-resource space share.
  //    Light per-build jitter (deterministic via rng) varies the galaxy.
  for (const goodId of PRODUCTION_BUILDING_TYPES) {
    const def = BUILDING_TYPES[goodId];
    if (GOOD_TIER_BY_KEY[goodId] !== 0 || !def.resource) continue;
    const deposit = aggregate[def.resource] ?? 0;
    if (deposit <= 0) continue;
    // Jitter varies utilisation; hard cap at the deposit magnitude.
    const jitter = 0.85 + rng() * 0.3;
    const wanted = Math.min(deposit, deposit * jitter);
    const cost = effectiveSpaceCost(goodId);
    const affordable = (productionBudget - productionUsed) / cost;
    const count = Math.max(0, Math.min(wanted, affordable));
    if (count > 0) {
      buildings[goodId] = count;
      productionUsed += count * cost;
    }
  }

  // 2) Tier-1+ manufacturers — only where every recipe input is locally
  //    producible (a tier-0 deposit, or a tier-1 input we just placed).
  //    Two passes so tier-2 can see tier-1 placements.
  for (let pass = 1; pass <= 2; pass++) {
    for (const goodId of PRODUCTION_BUILDING_TYPES) {
      const tier = GOOD_TIER_BY_KEY[goodId];
      if (tier === 0 || tier !== pass) continue;
      if ((buildings[goodId] ?? 0) > 0) continue;
      const recipe = GOOD_RECIPES[goodId] ?? {};
      const inputsLocal = Object.keys(recipe).every((inp) => (buildings[inp] ?? 0) > 0);
      if (!inputsLocal) continue;
      const jitter = 0.6 + rng() * 0.8;
      const wanted = MANUFACTURER_BASE_COUNT * jitter;
      const cost = effectiveSpaceCost(goodId);
      const affordable = (productionBudget - productionUsed) / cost;
      const count = Math.max(0, Math.min(wanted, affordable));
      if (count > 0) {
        buildings[goodId] = count;
        productionUsed += count * cost;
      }
    }
  }

  // 3) Housing — enough to staff the production labour demanded, within the
  //    remaining budget. popProvided < labourPerUnit forces a mixed build-out.
  const demand = labourDemand(buildings);
  const labourCovered = Math.min(bodyBaselinePopCap, demand);
  const labourShortfall = Math.max(0, demand - labourCovered);
  const housingWanted = labourShortfall / POP_CENTRE_DENSITY;
  const housingCost = effectiveSpaceCost(HOUSING_TYPE);
  const housingAffordable = (buildSpace - buildSpaceUsed(buildings)) / housingCost;
  const housingCount = Math.max(0, Math.min(housingWanted, housingAffordable));
  if (housingCount > 0) buildings[HOUSING_TYPE] = housingCount;

  const popCap = bodyBaselinePopCap + housingPopCap(buildings);
  return { buildings, buildSpace, popCap };
}
