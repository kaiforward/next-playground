/**
 * Pure capacity-driven production math — zero DB dependency.
 *
 * Production derives from the built industrial base:
 *   production_g = Σ_{t: outputGood_t = g} count_t × outputPerUnit_t × labourFulfillment × yieldMult
 * where yieldMult = yields[resource] for tier-0 goods, 1 for tier-1+.
 * Labour is a single system-wide ratio (uniform proportional allocation):
 *   labourFulfillment = min(1, population / Σ count_t × labourPerUnit_t)
 * Input-gating (the recipe `inputs`) is not applied here — that is the
 * supply-chain cascade. The same functions feed the live tick, the simulator,
 * and the substrate read service.
 */
import type { ResourceVector } from "@/lib/types/game";
import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";
import { GOOD_CONSUMPTION, GOOD_PRODUCTION } from "@/lib/constants/physical-economy";
import { GOOD_NAMES, GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import {
  BUILDING_TYPES,
  HOUSING_TYPE,
  effectiveSpaceCost,
} from "@/lib/constants/industry";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";
import { GOOD_RECIPE_CONSUMERS, GOOD_RECIPES } from "@/lib/constants/recipes";
import { inputGate } from "@/lib/engine/supply-chain";

/**
 * Available space a single body contributes: SPACE_PER_SIZE × size.
 * Size-only — habitability is the habitable fraction of space, not a total multiplier.
 */
export function bodyAvailableSpace(size: number): number {
  return SUBSTRATE_GEN.SPACE_PER_SIZE * Math.max(0, size);
}

/** Σ count × labourPerUnit across production types. Housing demands no labour. */
export function labourDemand(buildings: Record<string, number>): number {
  let demand = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const labour = BUILDING_TYPES[type]?.labourPerUnit;
    if (labour) demand += count * labour;
  }
  return demand;
}

/** Uniform proportional labour fulfillment in [0, 1]. 1 when nothing demands labour. */
export function labourFulfillment(population: number, demand: number): number {
  if (demand <= 0) return 1;
  return Math.min(1, Math.max(0, population) / demand);
}

/** Σ count × effectiveSpaceCost across all building types (incl. housing). */
export function buildSpaceUsed(buildings: Record<string, number>): number {
  let used = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    used += count * effectiveSpaceCost(type);
  }
  return used;
}

/** popCap contribution from housing: count × popProvided. */
export function housingPopCap(buildings: Record<string, number>): number {
  const count = buildings[HOUSING_TYPE] ?? 0;
  const provided = BUILDING_TYPES[HOUSING_TYPE]?.popProvided ?? 0;
  return count * provided;
}

/**
 * Capacity-driven production rate for one good. Sums every production type
 * whose outputGood matches (1:1 today, many-to-one ready).
 * Tier-0 goods are multiplied by `yields[resource]`; tier-1+ goods use ×1.
 */
export function buildingProduction(
  buildings: Record<string, number>,
  goodId: string,
  fulfillment: number,
  yields: ResourceVector,
): number {
  let rate = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const def = BUILDING_TYPES[type];
    if (def?.outputGood !== goodId) continue;
    rate += count * (def.outputPerUnit ?? 0) * fulfillment;
  }
  // Tier-0 yield term: multiply by the per-resource yield multiplier.
  // `resource !== undefined` already implies tier-0 (only tier-0 goods set GOOD_PRODUCTION[g].resource);
  // the `GOOD_TIER_BY_KEY[goodId] === 0` check is a safety belt against future schema drift.
  const resource = GOOD_PRODUCTION[goodId]?.resource;
  const yieldMult = (resource !== undefined && GOOD_TIER_BY_KEY[goodId] === 0) ? yields[resource] : 1;
  return rate * yieldMult;
}

/**
 * Per-good production + consumption for one system from its industrial base.
 * The read-service shape (one `SubstrateGoodRate` per good), capacity-driven on
 * the production axis; consumption stays perCapitaNeed × population.
 * Tier-0 production is multiplied by `yields[resource]`.
 */
export function capacityGoodRates(
  buildings: Record<string, number>,
  population: number,
  yields: ResourceVector,
): SubstrateGoodRate[] {
  const fulfillment = labourFulfillment(population, labourDemand(buildings));
  const pop = Math.max(0, population);
  return GOOD_NAMES.map((goodId) => ({
    goodId,
    production: buildingProduction(buildings, goodId, fulfillment, yields),
    consumption: (GOOD_CONSUMPTION[goodId] ?? 0) * pop,
  }));
}

/**
 * Production-input demand on `goodId` from the local industrial base: the total
 * desired (uncapped) draw of `goodId` across every building type that consumes
 * it. Capacity-based — the stable pricing-reference term folded into demandRate.
 * `fulfillment` is the system-wide labour ratio
 * (`labourFulfillment(population, labourDemand(buildings))`).
 */
export function inputDemandForGood(
  buildings: Record<string, number>,
  goodId: string,
  fulfillment: number,
  yields: ResourceVector,
): number {
  let demand = 0;
  for (const consumer of GOOD_RECIPE_CONSUMERS[goodId] ?? []) {
    demand += buildingProduction(buildings, consumer.goodId, fulfillment, yields) * consumer.perOutput;
  }
  return demand;
}

/** Snapshot of one system's industrial base and supply-chain state. */
export interface SystemIndustryReadout {
  buildSpace: { used: number; total: number };
  /** Labour supply ratio in [0, 1]. 1 = fully staffed. */
  labourFulfillment: number;
  /** One entry per building type with count > 0, sorted by tier ascending then buildingType. */
  buildings: Array<{ buildingType: string; outputGood?: string; tier: number; count: number }>;
  /** Produced goods that have a recipe. Sorted by inputGate ascending (most-throttled first). */
  supplyChain: Array<{ goodId: string; inputGate: number; throttledBy: string[] }>;
}

/**
 * Builds an industry readout for one system from its current industrial base and
 * market stock. Pure — no DB dependency. Reuses the existing helpers for all
 * derived quantities.
 *
 * - buildSpace: total capacity from bodies (size-only via bodyAvailableSpace); used from building counts.
 * - labourFulfillment: population vs total labour demand.
 * - buildings: one entry per building type with count > 0 (housing gets tier -1).
 * - supplyChain: tier-1+ produced goods whose recipe inputs may be short.
 *   inputGate < 1 means the good is throttled by at least one short input.
 *   throttledBy lists the inputs where drawable stock < desired draw.
 */
export function buildIndustryReadout(
  buildings: Record<string, number>,
  bodies: Array<{ size: number }>,
  population: number,
  marketStock: Record<string, number>,
  minLevel: number,
  yields: ResourceVector,
): SystemIndustryReadout {
  const totalSpace = bodies.reduce((s, b) => s + bodyAvailableSpace(b.size), 0);
  const usedSpace = buildSpaceUsed(buildings);
  const demand = labourDemand(buildings);
  const fulfillment = labourFulfillment(population, demand);

  // Buildings array — one entry per type with count > 0.
  const buildingEntries: SystemIndustryReadout["buildings"] = [];
  for (const [buildingType, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    if (buildingType === HOUSING_TYPE) {
      buildingEntries.push({ buildingType, tier: -1, count });
    } else {
      const def = BUILDING_TYPES[buildingType];
      const outputGood = def?.outputGood;
      const tier: number = outputGood !== undefined ? (GOOD_TIER_BY_KEY[outputGood] ?? 0) : 0;
      buildingEntries.push({ buildingType, outputGood, tier, count });
    }
  }
  buildingEntries.sort((a, b) => a.tier - b.tier || a.buildingType.localeCompare(b.buildingType));

  // Supply chain — only produced goods with a recipe (tier-1+).
  const stockOf = (g: string): number => marketStock[g] ?? minLevel;
  const supplyChainEntries: SystemIndustryReadout["supplyChain"] = [];

  for (const [buildingType, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const def = BUILDING_TYPES[buildingType];
    const goodId = def?.outputGood;
    if (!goodId) continue;
    const recipe = GOOD_RECIPES[goodId];
    if (!recipe) continue; // tier-0 — always gated at 1, no signal

    const effectiveProduction = buildingProduction(buildings, goodId, fulfillment, yields);
    const gate = inputGate(goodId, effectiveProduction, stockOf, minLevel);

    const throttledBy: string[] = [];
    for (const [input, perOutput] of Object.entries(recipe)) {
      const desired = effectiveProduction * perOutput;
      if (desired <= 0) continue;
      const drawable = Math.max(0, stockOf(input) - minLevel);
      if (drawable < desired) throttledBy.push(input);
    }

    supplyChainEntries.push({ goodId, inputGate: gate, throttledBy });
  }
  supplyChainEntries.sort((a, b) => a.inputGate - b.inputGate);

  return {
    buildSpace: { used: usedSpace, total: totalSpace },
    labourFulfillment: fulfillment,
    buildings: buildingEntries,
    supplyChain: supplyChainEntries,
  };
}
