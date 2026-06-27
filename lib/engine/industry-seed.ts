/**
 * Generation seeding allocator — pure, zero DB dependency.
 *
 * Builds a partial, varied, self-consistent industrial base on a system's
 * finite surface partition (available-space model):
 *   1. tier-0 extractors sit on dedicated deposit slots — the per-resource sum
 *      of extractor counts is capped by slotCap[r]. Goods that share a resource
 *      (food + textiles share arable) share that one cap.
 *   2. tier-1+ factories consume fungible general space — placed input-consistent
 *      (only where every recipe input is locally producible), in two passes so
 *      tier-2 can see tier-1.
 *   3. population centres fully fold population: sized to staff ALL labour, and
 *      bounded by both the habitable subset of space and remaining general space.
 * The effective per-resource yield multiplier `yieldMult[r]` is the mean quality
 * of the FILLED deposit slots for r, allocated best-quality-first across bodies.
 * Coarse by design — share/jitter knobs are the primary simulator-tuned surface.
 * Deterministic given the RNG.
 */
import type { ResourceVector, ResourceType } from "@/lib/types/game";
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
import { labourDemand, housingPopCap } from "@/lib/engine/industry";
import { RESOURCE_TYPES, emptyResourceVector, unitResourceVector } from "@/lib/engine/resources";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";

/** Structural body view — slots + quality per resource (not the full GeneratedBody, to avoid a circular import). */
export interface AllocateBody {
  slots: ResourceVector;
  quality: ResourceVector;
}

export interface AllocateInput {
  /** Per-body deposit slots + quality bands — the source for the yield aggregation. */
  bodies: AllocateBody[];
  /** Σ body slots[r] — the per-resource extractor cap (dedicated deposit space). */
  slotCap: ResourceVector;
  /** Fungible general-purpose surface space — factories + pop-centres draw here. */
  generalSpace: number;
  /** Habitable subset of general space — additionally caps pop-centres. */
  habitableSpace: number;
  /** Development fill fraction in [0, 1] — varied by habitability at the caller. */
  fill: number;
}

export interface AllocateResult {
  /** buildingType → count (fractional allowed). */
  buildings: Record<string, number>;
  /** Full-fold popCap: housing contribution + POP_BASELINE_FLOOR. */
  popCap: number;
  /** Effective per-resource yield multiplier — mean quality of the filled slots; 1.0 where none filled. */
  yieldMult: ResourceVector;
}

/** Fraction of general space the factory pass may claim, leaving room for pop-centres. */
const PRODUCTION_SHARE = 0.5;
/** Per-factory target count before fill scaling (coarse). */
const MANUFACTURER_BASE_COUNT = 2;
/** Per-extractor utilisation jitter band: slotCap × fill × [1 − e, 1 + e]. */
const EXTRACTOR_JITTER = 0.15;

/**
 * Effective yield multiplier for one resource: the mean quality of the filled
 * deposit slots, allocated best-quality-first across bodies.
 *
 * Build the (capacity = body.slots[r], quality = body.quality[r]) list over bodies
 * with slots[r] > 0, sort by quality DESC, then greedily allocate `placed` across
 * capacities (the last slice fractional). yieldMult = Σ(alloc × quality) / Σ alloc.
 * Returns 1.0 when nothing is placed (neutral multiplier).
 */
function effectiveYield(bodies: AllocateBody[], resource: ResourceType, placed: number): number {
  if (placed <= 0) return 1;
  const capacities = bodies
    .filter((b) => b.slots[resource] > 0)
    .map((b) => ({ capacity: b.slots[resource], quality: b.quality[resource] }))
    .sort((a, b) => b.quality - a.quality);

  let remaining = placed;
  let weighted = 0;
  let allocated = 0;
  for (const c of capacities) {
    if (remaining <= 0) break;
    const take = Math.min(c.capacity, remaining);
    weighted += take * c.quality;
    allocated += take;
    remaining -= take;
  }
  return allocated > 0 ? weighted / allocated : 1;
}

export function allocateIndustry(input: AllocateInput, rng: RNG): AllocateResult {
  const { bodies, slotCap, generalSpace, habitableSpace } = input;
  const fill = Math.max(0, Math.min(1, input.fill));
  const buildings: Record<string, number> = {};

  // ── 1) Tier-0 extractors — on dedicated deposit slots. ──
  // Goods sharing a resource (food + textiles → arable) share one slotCap[r]:
  // track placed-per-resource and clamp each good's count to the remaining cap.
  const extractorByResource = emptyResourceVector();
  for (const goodId of PRODUCTION_BUILDING_TYPES) {
    if (GOOD_TIER_BY_KEY[goodId] !== 0) continue;
    const resource = BUILDING_TYPES[goodId]?.resource;
    if (!resource) continue;
    const cap = slotCap[resource];
    if (cap <= 0) continue;
    const remaining = cap - extractorByResource[resource];
    if (remaining <= 0) continue;
    // fill-scaled utilisation with deterministic jitter, clamped to remaining cap.
    const jitter = 1 + (rng() - 0.5) * 2 * EXTRACTOR_JITTER;
    const wanted = cap * fill * jitter;
    const count = Math.max(0, Math.min(wanted, remaining));
    if (count > 0) {
      buildings[goodId] = count;
      extractorByResource[resource] += count;
    }
  }

  // ── 2) Tier-1+ factories — on fungible general space. ──
  // Input-consistent: only where every recipe input is locally producible (a
  // tier-0 extractor, or a tier-1 factory placed in an earlier pass). Two passes
  // so tier-2 sees tier-1. Bounded by a production share of general space.
  const factoryBudget = generalSpace * PRODUCTION_SHARE * fill;
  let factoryUsed = 0;
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
      const affordable = (factoryBudget - factoryUsed) / cost;
      const count = Math.max(0, Math.min(wanted, affordable));
      if (count > 0) {
        buildings[goodId] = count;
        factoryUsed += count * cost;
      }
    }
  }

  // ── 3) Population centres — full-fold, sized to staff ALL labour. ──
  // No body baseline: wanted = labourDemand / POP_CENTRE_DENSITY. Bounded by a seeded
  // fraction (SEED_HOUSING_FRACTION) of the habitable subset of space — so systems start
  // below their habitable potential, leaving headroom the autonomic build climbs into —
  // and by the general space the factories left behind.
  const wantedPopCentres = labourDemand(buildings) / POP_CENTRE_DENSITY;
  const popCost = effectiveSpaceCost(HOUSING_TYPE);
  const habitableAffordable = (habitableSpace * SUBSTRATE_GEN.SEED_HOUSING_FRACTION) / popCost;
  const generalRemainingAffordable = (generalSpace - factoryUsed) / popCost;
  const popCentreCount = Math.max(
    0,
    Math.min(wantedPopCentres, habitableAffordable, generalRemainingAffordable),
  );
  if (popCentreCount > 0) buildings[HOUSING_TYPE] = popCentreCount;

  // ── 3b) Staffing self-consistency — never seed more industry than the population can staff. ──
  // The fraction-clamped housing fixes the labour budget (popCap = housing × POP_CENTRE_DENSITY).
  // Scale every production building down proportionally so labourDemand ≤ popCap: a freshly seeded
  // system is then fully staffable as its population matures, instead of carrying idle capacity that
  // autonomic decay would immediately liquidate. The freed deposit/general space stays as headroom
  // for later (SP5) faction build-out. Worlds with no habitable land (popCap 0) seed zero industry —
  // extraction still needs a workforce housed locally. yieldMult below is left on the unscaled
  // placement on purpose: it measures the worked deposit grade (a property of the ground), so the
  // economy-type label stays independent of how much labour is available to staff the slots.
  const staffBudget = housingPopCap(buildings) + SUBSTRATE_GEN.POP_BASELINE_FLOOR;
  const seededLabour = labourDemand(buildings);
  if (seededLabour > staffBudget) {
    const staffScale = staffBudget / seededLabour;
    for (const goodId of PRODUCTION_BUILDING_TYPES) {
      const count = buildings[goodId];
      if (count === undefined || count <= 0) continue;
      const scaled = count * staffScale;
      if (scaled > 0) buildings[goodId] = scaled;
      else delete buildings[goodId];
    }
  }

  // ── 4) popCap (full-fold) + per-resource effective yield. ──
  const popCap = housingPopCap(buildings) + SUBSTRATE_GEN.POP_BASELINE_FLOOR;
  const yieldMult = unitResourceVector();
  for (const resource of RESOURCE_TYPES) {
    yieldMult[resource] = effectiveYield(bodies, resource, extractorByResource[resource]);
  }

  return { buildings, popCap, yieldMult };
}
