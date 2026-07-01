/**
 * Pure capacity-driven production math — zero DB dependency.
 *
 * Production derives from the built industrial base:
 *   production_g = Σ_{t: outputGood_t = g} count_t × outputPerUnit_t × labourFulfillment × yieldMult
 * where yieldMult = yields[resource] for tier-0 goods, 1 for tier-1+.
 * Labour is a single system-wide ratio (uniform proportional allocation):
 *   labourFulfillment = min(1, population / Σ count_t × labourTotal_t)
 * Input-gating (the recipe `inputs`) is not applied here — that is the
 * supply-chain cascade. The same functions feed the live tick, the simulator,
 * and the substrate read service.
 */
import type { QualityBandId, ResourceType, ResourceVector } from "@/lib/types/game";
import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";
import { GOOD_CONSUMPTION, GOOD_PRODUCTION } from "@/lib/constants/physical-economy";
import { GOOD_NAMES, GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import {
  BUILDING_TYPES,
  HOUSING_TYPE,
  POP_CENTRE_DENSITY,
  effectiveSpaceCost,
  EXTRACTOR_STORAGE_PER_UNIT,
  PRODUCTION_STORAGE_PER_UNIT,
  POP_CENTRE_STORAGE,
  POP_CENTRE_STORAGE_DEFAULT,
  IDLE_COASTING_FRACTION,
  IDLE_COLLAPSING_FRACTION,
  labourTotal,
} from "@/lib/constants/industry";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";
import { GOOD_RECIPE_CONSUMERS, GOOD_RECIPES } from "@/lib/constants/recipes";
import { inputGate } from "@/lib/engine/supply-chain";
import { outputUptake } from "@/lib/engine/tick";
import { RESOURCE_TYPES, emptyResourceVector } from "@/lib/engine/resources";
import { bandForMultiplier } from "@/lib/engine/substrate-space";

/** Σ count × labourTotal across types that demand labour (production + academies). Housing demands none. */
export function labourDemand(buildings: Record<string, number>): number {
  let demand = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const labour = BUILDING_TYPES[type]?.labour;
    if (labour) demand += count * labourTotal(labour);
  }
  return demand;
}

/** Uniform proportional labour fulfillment in [0, 1]. 1 when nothing demands labour. */
export function labourFulfillment(population: number, demand: number): number {
  if (demand <= 0) return 1;
  return Math.min(1, Math.max(0, population) / demand);
}

/**
 * General-space footprint of the built base — factories + population centres.
 * Tier-0 extractors are excluded: they sit on dedicated deposit slots, not the
 * fungible general space that industry and housing compete for.
 */
export function generalSpaceUsed(buildings: Record<string, number>): number {
  let used = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    if (BUILDING_TYPES[type]?.resource) continue; // tier-0 extractor → deposit land
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

/**
 * Same production-input demand as `inputDemandForGood`, but reading each consumer good's
 * production from a precomputed per-good map instead of recomputing `buildingProduction`.
 * Use when the production rates are already in hand (e.g. from `capacityGoodRates`): a consumer's
 * production from that map is identical to `buildingProduction(...)` at the same fulfillment/yields.
 */
export function inputDemandFromProduction(
  goodId: string,
  productionByGood: ReadonlyMap<string, number>,
): number {
  let demand = 0;
  for (const consumer of GOOD_RECIPE_CONSUMERS[goodId] ?? []) {
    demand += (productionByGood.get(consumer.goodId) ?? 0) * consumer.perOutput;
  }
  return demand;
}

/** Why a building's `used` sits below its `count` — the binding constraint for the idle caption. */
export type IdleReason = "occupancy" | "labour" | "selling";

/** Snapshot of one system's industrial base and supply-chain state. */
export interface SystemIndustryReadout {
  /** Labour supply ratio in [0, 1]. 1 = fully staffed. */
  labourFulfillment: number;
  /**
   * One entry per building type with count > 0, sorted by tier ascending then buildingType.
   * `used` is the decay-relevant "in use" amount — occupancy for housing, staffed-and-selling
   * for producers (≤ count, except housing overshoot). `idleReason` names the binding constraint.
   */
  buildings: Array<{ buildingType: string; outputGood?: string; tier: number; count: number; used: number; idleReason?: IdleReason }>;
  /** Produced goods that have a recipe. Sorted by inputGate ascending (most-throttled first). */
  supplyChain: Array<{ goodId: string; inputGate: number; throttledBy: string[] }>;
}

/** Coarse industry health read, derived from the decay-loop quantities. */
export type IndustryHealth = "thriving" | "coasting" | "declining";

export interface IndustryHealthInput {
  /** System-wide labour ratio in [0,1]. */
  labourFulfillment: number;
  /** Stored unrest integral 0…1. */
  unrest: number;
  /** Σ idle capacity (built − staffed) ÷ Σ built across the base, in [0,1]. */
  idleFraction: number;
  /** θ_decay — unrest at/above this means active unrest-teardown (the snowball). */
  unrestDecayThreshold: number;
}

/**
 * Coarse "thriving / coasting / falling apart" read for the Industry panel, grounded
 * in the same quantities the decay loop runs on:
 *  - declining: unrest at/above the decay threshold (capacity is actively torn down),
 *  - coasting: meaningful idle capacity that disuse decay will slowly shed,
 *  - thriving: built ≈ used and calm.
 */
export function industryHealth(input: IndustryHealthInput): IndustryHealth {
  if (input.unrest >= input.unrestDecayThreshold) return "declining";
  if (input.idleFraction >= IDLE_COASTING_FRACTION) return "coasting";
  return "thriving";
}

export interface BuildingHealthInput {
  /** In-use amount for this building (occupancy for housing, staffed-and-selling for producers). */
  used: number;
  /** Built count. */
  built: number;
  /** Stored unrest integral 0…1. */
  unrest: number;
  /** θ_decay — unrest at/above this means active unrest-teardown. */
  unrestDecayThreshold: number;
}

/**
 * Per-building health for the Industry panel's row colour, grounded in the decay
 * loop: declining when capacity is torn down fast (unrest teardown, housing
 * overshoot, or severe idle ≥ IDLE_COLLAPSING_FRACTION), coasting when disuse decay
 * nibbles past the slack deadband (≥ IDLE_COASTING_FRACTION), thriving when in use
 * within the deadband and calm.
 */
export function buildingHealth(input: BuildingHealthInput): IndustryHealth {
  const { used, built, unrest, unrestDecayThreshold } = input;
  if (built <= 0) return "thriving";
  if (used > built) return "declining"; // over capacity (overshoot death-sink)
  if (unrest >= unrestDecayThreshold) return "declining"; // unrest teardown
  const idle = Math.max(0, Math.min(1, 1 - used / built));
  if (idle >= IDLE_COLLAPSING_FRACTION) return "declining";
  if (idle >= IDLE_COASTING_FRACTION) return "coasting";
  return "thriving";
}

/**
 * Builds an industry readout for one system from its current industrial base and
 * market stock. Pure — no DB dependency. Reuses the existing helpers for all
 * derived quantities. (Space-partition headroom is assembled separately via
 * summariseSpace; this readout covers labour, the building roster, and the
 * supply chain.)
 *
 * - labourFulfillment: population vs total labour demand.
 * - buildings: one entry per building type with count > 0 (housing gets tier -1).
 * - supplyChain: tier-1+ produced goods whose recipe inputs may be short.
 *   inputGate < 1 means the good is throttled by at least one short input.
 *   throttledBy lists the inputs where drawable stock < desired draw.
 *
 * `marketStock` and `minStockOf` are keyed by good KEY (not the DB good id);
 * the caller maps the market rows through GOOD_NAME_TO_KEY. `minStockOf` returns
 * each good's per-market reserve floor — only stock above it is drawable, so the
 * throttle reflects the real per-market band (not a flat global floor).
 *
 * `yields` threads through to `buildingProduction` but is inert for this readout:
 * supplyChain covers only tier-1+ goods, whose production is yield-independent.
 */
export function buildIndustryReadout(
  buildings: Record<string, number>,
  population: number,
  marketStock: Record<string, number>,
  minStockOf: (goodId: string) => number,
  yields: ResourceVector,
  maxStockOf?: (goodId: string) => number | undefined,
): SystemIndustryReadout {
  const demand = labourDemand(buildings);
  const fulfillment = labourFulfillment(population, demand);
  const stockOf = (g: string): number => marketStock[g] ?? minStockOf(g);

  // Per-building "in use" — the decay-relevant quantity (mirrors computeSystemDecay):
  //  - housing: occupancy = population / POP_CENTRE_DENSITY,
  //  - producers: count × min(labourFulfillment, outputUptake) (staffed AND selling).
  // idleReason names the binding constraint so the panel can caption an idle row.
  // outputUptake needs the maxStock band; without it (legacy callers) output sells
  // freely (uptake 1) so `used` falls back to the labour-only figure.
  const buildingEntries: SystemIndustryReadout["buildings"] = [];
  for (const [buildingType, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    if (buildingType === HOUSING_TYPE) {
      const used = Math.max(0, population) / POP_CENTRE_DENSITY;
      buildingEntries.push({ buildingType, tier: -1, count, used, idleReason: used < count ? "occupancy" : undefined });
      continue;
    }
    const def = BUILDING_TYPES[buildingType];
    const outputGood = def?.outputGood;
    const tier: number = outputGood !== undefined ? (GOOD_TIER_BY_KEY[outputGood] ?? 0) : 0;
    // Output uptake needs the market band; a good with no band (no market row, or a
    // legacy caller without maxStockOf) sells freely (uptake 1) → labour-only `used`.
    let uptake = 1;
    if (outputGood !== undefined && maxStockOf !== undefined) {
      const maxStock = maxStockOf(outputGood);
      if (maxStock !== undefined) {
        uptake = outputUptake(stockOf(outputGood), minStockOf(outputGood), maxStock);
      }
    }
    const used = count * Math.min(fulfillment, uptake);
    const idleReason: IdleReason | undefined =
      used < count ? (uptake < fulfillment ? "selling" : "labour") : undefined;
    buildingEntries.push({ buildingType, outputGood, tier, count, used, idleReason });
  }
  buildingEntries.sort((a, b) => a.tier - b.tier || a.buildingType.localeCompare(b.buildingType));

  // Supply chain — only produced goods with a recipe (tier-1+).
  const supplyChainEntries: SystemIndustryReadout["supplyChain"] = [];

  for (const [buildingType, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const def = BUILDING_TYPES[buildingType];
    const goodId = def?.outputGood;
    if (!goodId) continue;
    const recipe = GOOD_RECIPES[goodId];
    if (!recipe) continue; // tier-0 — always gated at 1, no signal

    const effectiveProduction = buildingProduction(buildings, goodId, fulfillment, yields);
    const gate = inputGate(goodId, effectiveProduction, stockOf, minStockOf);

    const throttledBy: string[] = [];
    for (const [input, perOutput] of Object.entries(recipe)) {
      const desired = effectiveProduction * perOutput;
      if (desired <= 0) continue;
      const drawable = Math.max(0, stockOf(input) - minStockOf(input));
      if (drawable < desired) throttledBy.push(input);
    }

    supplyChainEntries.push({ goodId, inputGate: gate, throttledBy });
  }
  supplyChainEntries.sort((a, b) => a.inputGate - b.inputGate);

  return {
    labourFulfillment: fulfillment,
    buildings: buildingEntries,
    supplyChain: supplyChainEntries,
  };
}

/**
 * Storage capacity the system's built buildings provide for one good — the
 * infrastructure term of maxStock. Extractors/factories store what they handle;
 * population centres hold nominal retail stock (generous on consumer goods).
 * See docs/planned/economy-relative-stock-band.md.
 */
export function facilityStorageForGood(buildings: Record<string, number>, goodId: string): number {
  let storage = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    if (type === HOUSING_TYPE) {
      const per = POP_CENTRE_STORAGE[goodId] ?? ((GOOD_CONSUMPTION[goodId] ?? 0) > 0 ? POP_CENTRE_STORAGE_DEFAULT : 0);
      storage += count * per;
      continue;
    }
    const def = BUILDING_TYPES[type];
    if (def?.outputGood === goodId) {
      storage += count * (def.resource ? EXTRACTOR_STORAGE_PER_UNIT : PRODUCTION_STORAGE_PER_UNIT);
    }
  }
  return storage;
}

// ── Substrate display summaries (system-panel view helpers) ──────────────────
// The space partition the seeder built against (industry-seed.ts): tier-0
// extractors sit on dedicated deposit slots; tier-1+ factories and population
// centres share fungible general space; pop-centres are additionally bounded by
// the habitable subset. These pure helpers turn the denormalised substrate
// columns + built base into the shapes the system panels render.

/**
 * Tier-0 extractor count per resource from the built base — the worked deposit
 * slots. Goods sharing a resource (food + textiles → arable) sum onto that
 * resource. Factories and population centres carry no `resource` and are skipped.
 */
export function extractorsByResource(buildings: Record<string, number>): ResourceVector {
  const v = emptyResourceVector();
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const resource = BUILDING_TYPES[type]?.resource;
    if (resource) v[resource] += count;
  }
  return v;
}

/** Per-resource deposit-fill summary — the functional extraction view for one system. */
export interface SystemDepositSummary {
  resource: ResourceType;
  /** Total extractor slots across all bodies (slotCap). */
  slotCap: number;
  /** Slots worked by seeded extractors. */
  worked: number;
  /** Effective yield multiplier the worked slots deliver. 1.0 when none worked. */
  yieldMult: number;
  /** Quality band of the effective yield — drives the row's colour/label. */
  band: QualityBandId;
}

/**
 * One fill row per resource that has any deposit slots, richest cap first.
 * The extraction view: worked vs available slots and the effective yield the
 * worked slots deliver. (Intrinsic deposit grade — the static "what is in the
 * ground" — is surfaced as per-body flavour on the astrography panel, not here.)
 */
export function summariseDeposits(
  slotCap: ResourceVector,
  worked: ResourceVector,
  yields: ResourceVector,
): SystemDepositSummary[] {
  return RESOURCE_TYPES.filter((r) => slotCap[r] > 0)
    .map((r) => ({
      resource: r,
      slotCap: slotCap[r],
      worked: worked[r],
      yieldMult: yields[r],
      band: bandForMultiplier(yields[r]),
    }))
    .sort((a, b) => b.slotCap - a.slotCap);
}

/** A system's finite surface partition and how much of each part is built out. */
export interface SubstrateSpace {
  /** Total available space (SPACE_PER_SIZE × Σ size). */
  available: number;
  /** Dedicated extractor land (available − general). */
  deposit: number;
  /** Fungible factory + population-centre land. */
  general: number;
  /** Habitable subset of general space — caps population centres. */
  habitable: number;
  /** Deposit land worked by extractors. */
  depositWorked: number;
  /** General land consumed by factories + population centres. */
  generalUsed: number;
  /** General land consumed by population centres alone (a subset of generalUsed, drawn from habitable). */
  habitableUsed: number;
}

/**
 * Partition a system's available space into deposit / general / habitable and
 * tally the built land in each. Extractors are billed to deposit land (one slot
 * footprint each); factories and population centres to general; population
 * centres additionally to habitable.
 */
export function summariseSpace(
  available: number,
  general: number,
  habitable: number,
  buildings: Record<string, number>,
): SubstrateSpace {
  let habitableUsed = 0;
  let depositWorked = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    if (BUILDING_TYPES[type]?.resource) {
      depositWorked += count * SUBSTRATE_GEN.DEPOSIT_SLOT_FOOTPRINT;
      continue;
    }
    if (type === HOUSING_TYPE) habitableUsed += count * effectiveSpaceCost(type);
  }
  return {
    available,
    deposit: Math.max(0, available - general),
    general,
    habitable,
    depositWorked,
    generalUsed: generalSpaceUsed(buildings),
    habitableUsed,
  };
}
