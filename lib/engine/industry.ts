/**
 * Pure capacity-driven production math — zero DB dependency.
 *
 * Production derives from the built industrial base:
 *   production_g = Σ_{t: outputGood_t = g} count_t × outputPerUnit_t × effectiveFulfilment(tier_g) × yieldMult
 * where yieldMult = yields[resource] for tier-0 goods, 1 for tier-1+.
 * Labour is a system-wide `LabourState` (uniform proportional allocation) split into
 * a headcount gate and two skill-ceiling gates:
 *   labourFulfil = min(1, population / Σ count_t × labourTotal_t)
 *   skill1Fulfil = min(1, skill1Cap / skill1Demand); skill2Fulfil analogous
 * `effectiveFulfilment` picks the pools a good's tier actually draws on (tier-0:
 * labourFulfil only; tier-1: + skill1Fulfil; tier-2: + skill2Fulfil).
 * Input-gating (the recipe `inputs`) is not applied here — that is the
 * supply-chain cascade. The same functions feed the live tick, the simulator,
 * and the substrate read service.
 */
import type { GoodTier, QualityBandId, ResourceType, ResourceVector } from "@/lib/types/game";
import type { CivilianDemandBasis, SubstrateGoodRate } from "@/lib/engine/physical-economy";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { GOOD_CONSUMPTION, GOOD_PRODUCTION, SKILL1_CONSUMPTION, SKILL2_CONSUMPTION } from "@/lib/constants/physical-economy";
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
  INPUT_DEMAND_MULTIPLIER,
  FAMILY_BY_GOOD,
  OUTPUT_PER_UNIT,
  COMPLEX_BY_TYPE,
  ANCHOR_RATED_COVERAGE,
  type LabourVector,
  type SpecialisationFamily,
  type CapacityKind,
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

/** System-wide labour fulfilment, split into the headcount gate and the two skill-ceiling gates. */
export interface LabourState {
  /** min(1, population / Σ labour totals) — the headcount gate (unchanged). */
  labourFulfil: number;
  /** min(1, skill1Cap / skill1Demand) — technician licensing. 1 when nothing demands skill-1. */
  skill1Fulfil: number;
  /** min(1, skill2Cap / skill2Demand) — engineer licensing. 1 when nothing demands skill-2. */
  skill2Fulfil: number;
}

/** Σ count × labour.skill1 across all buildings. */
export function skill1Demand(buildings: Record<string, number>): number {
  let d = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const v = BUILDING_TYPES[type]?.labour;
    if (v) d += count * v.skill1;
  }
  return d;
}
/** Σ count × labour.skill2 across all buildings. */
export function skill2Demand(buildings: Record<string, number>): number {
  let d = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const v = BUILDING_TYPES[type]?.labour;
    if (v) d += count * v.skill2;
  }
  return d;
}
/** Σ vocational_school × SKILL1_PER_SCHOOL (read from skill1Licensed). */
export function skill1Cap(buildings: Record<string, number>): number {
  let c = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    c += count * (BUILDING_TYPES[type]?.skill1Licensed ?? 0);
  }
  return c;
}
/** Σ research_institute × SKILL2_PER_INSTITUTE (read from skill2Licensed). */
export function skill2Cap(buildings: Record<string, number>): number {
  let c = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    c += count * (BUILDING_TYPES[type]?.skill2Licensed ?? 0);
  }
  return c;
}

/** One ratio in [0,1]: cap/demand, or 1 when nothing is demanded. */
function poolFulfil(cap: number, demand: number): number {
  if (demand <= 0) return 1;
  return Math.min(1, Math.max(0, cap) / demand);
}

/** Headcount demand + skill demand/cap totals for one system. */
export interface LabourParts {
  /** Σ count × labourTotal — the headcount demand. */
  demand: number;
  skill1Demand: number;
  skill1Cap: number;
  skill2Demand: number;
  skill2Cap: number;
}

/** One supply-vs-demand labour pool for the Industry panel's Labour card. */
export interface LabourPool {
  /** Supply: population for workforce, licensed cap for skill pools. */
  have: number;
  /** Demand: Σ head count for workforce, Σ skill-grade demand for skill pools. */
  need: number;
  /** min(1, have / need) — 1 when nothing is demanded. */
  fulfil: number;
}

/** The three system-wide labour pools, supply vs demand. */
export interface SystemLabour {
  workforce: LabourPool;
  skill1: LabourPool;
  skill2: LabourPool;
}

/**
 * Every labour demand/cap total for a system in ONE pass over its buildings. The
 * per-total helpers (labourDemand, skill1Demand, …) remain for callers that need a
 * single figure; this is the batched path for the hot callers that need all of them
 * at once (computeLabourState, computeSystemDecay).
 */
export function labourParts(buildings: Record<string, number>): LabourParts {
  let demand = 0;
  let s1d = 0;
  let s1c = 0;
  let s2d = 0;
  let s2c = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const def = BUILDING_TYPES[type];
    const v = def?.labour;
    if (v) {
      demand += count * labourTotal(v);
      s1d += count * v.skill1;
      s2d += count * v.skill2;
    }
    s1c += count * (def?.skill1Licensed ?? 0);
    s2c += count * (def?.skill2Licensed ?? 0);
  }
  return { demand, skill1Demand: s1d, skill1Cap: s1c, skill2Demand: s2d, skill2Cap: s2c };
}

/** Derive the three-part labour state from precomputed parts. */
export function labourStateFromParts(parts: LabourParts, population: number): LabourState {
  return {
    labourFulfil: labourFulfillment(population, parts.demand),
    skill1Fulfil: poolFulfil(parts.skill1Cap, parts.skill1Demand),
    skill2Fulfil: poolFulfil(parts.skill2Cap, parts.skill2Demand),
  };
}

/** Compute the three-part labour state for one system once; reuse across its goods. */
export function computeLabourState(buildings: Record<string, number>, population: number): LabourState {
  return labourStateFromParts(labourParts(buildings), population);
}

/**
 * Population decomposed into what it is actually doing — the Labour card's primary view.
 * Disjoint role buckets plus unemployed, summing exactly to `population`. Population is a single
 * undifferentiated pool (one person fills one head), so this is a display-layer allocation of that
 * pool against built jobs and academy licences; it changes no economy behaviour. Scarce population
 * is allocated skilled-first (those roles are the academy-gated, harder-to-fill ones); with a labour
 * surplus the skilled buckets fill to their jobs and the remainder is unemployed — the honest slack
 * the panel now shows explicitly instead of hiding inside a grand-total "workforce" figure.
 */
export interface LabourAllocation {
  population: number;
  /** People working unskilled heads. */
  unskilled: number;
  /** People working skill-1 (technician) heads — bounded by the vocational-school licence. */
  technicians: number;
  /** People working skill-2 (engineer) heads — bounded by the research-institute licence. */
  engineers: number;
  /** population − Σ working — fed and housed but jobless (or unstaffable given the licence walls). */
  unemployed: number;
}

/**
 * Allocate a system's population across role buckets for the Labour card. Skilled heads fill first
 * (each bounded by both its jobs and its academy licence ceiling), then unskilled jobs, then the
 * remainder is unemployed. Total heads = `parts.demand`, so unskilled jobs are the remainder after
 * the two skill demands. No bucket exceeds its jobs or its licence, and the four fields always sum
 * to max(0, population).
 */
export function computeLabourAllocation(parts: LabourParts, population: number): LabourAllocation {
  let pool = Math.max(0, population);
  const engineers = Math.min(parts.skill2Demand, parts.skill2Cap, pool);
  pool -= engineers;
  const technicians = Math.min(parts.skill1Demand, parts.skill1Cap, pool);
  pool -= technicians;
  const unskilledJobs = Math.max(0, parts.demand - parts.skill1Demand - parts.skill2Demand);
  const unskilled = Math.min(unskilledJobs, pool);
  pool -= unskilled;
  return { population: Math.max(0, population), unskilled, technicians, engineers, unemployed: pool };
}

/**
 * Per-system labour snapshot shared across all of a system's goods: the
 * production fulfilment gates plus the civilian demand basis, derived from one
 * labourParts pass. Cache one per system and reuse across its goods — the
 * pattern every tick adapter and the seed path follow.
 */
export interface SystemLabourSnapshot {
  state: LabourState;
  basis: CivilianDemandBasis;
}

export function computeSystemLabourSnapshot(
  buildings: Record<string, number>,
  population: number,
): SystemLabourSnapshot {
  const parts = labourParts(buildings);
  return {
    state: labourStateFromParts(parts, population),
    basis: computeLabourAllocation(parts, population),
  };
}

/** One skilled grade's academy-licensing state for the Labour card — working vs licensed seats vs jobs. */
export interface SkillLicensing {
  /** Skill-grade jobs the built base demands. */
  jobs: number;
  /** Academy-licensed ceiling (vocational-school / research-institute seats). */
  licensed: number;
  /** Filled seats = min(licensed, jobs) — a seat counts only with both a licence and a job behind it. */
  working: number;
  /** licensed − jobs when positive — idle training capacity (over-provisioned, sheds slowly). */
  idleSeats: number;
  /** jobs − licensed when positive — jobs no academy can license (the wall; build an academy). */
  unlicensedJobs: number;
  /** max(licensed, jobs) — the bar's full width, so both over- and under-provision read honestly. */
  full: number;
}

/** Derive one skilled grade's licensing view from its licence ceiling and its jobs. */
export function skillLicensing(licensed: number, jobs: number): SkillLicensing {
  return {
    jobs,
    licensed,
    working: Math.min(licensed, jobs),
    idleSeats: Math.max(0, licensed - jobs),
    unlicensedJobs: Math.max(0, jobs - licensed),
    full: Math.max(licensed, jobs),
  };
}

/** Effective staffing ratio for a good of `tier`: each tier min()s only the pools it draws on. */
export function effectiveFulfilment(state: LabourState, tier: GoodTier): number {
  if (tier <= 0) return state.labourFulfil;
  if (tier === 1) return Math.min(state.labourFulfil, state.skill1Fulfil);
  return Math.min(state.labourFulfil, state.skill1Fulfil, state.skill2Fulfil);
}

/** One grade's staffing for a building: how many workers it needs, how many are filled, and whether it is the wall. */
export interface GradeStaffing {
  grade: "unskilled" | "skill1" | "skill2";
  /** built × the grade's share of the labour vector. */
  needed: number;
  /** needed × the grade's system-wide fulfilment. */
  filled: number;
  /** The grade's system-wide fulfilment ratio in [0,1]. */
  fulfil: number;
  /** True on the binding grade (the min fulfil among the grades the tier draws on). */
  wall: boolean;
}

/**
 * Per-grade staffing for one building type, derived from its static labour vector, its built
 * count and the system labour state. Emits only the grades the good's tier draws on
 * (tier-0 → unskilled; tier-1 → +skill1; tier-2 → +skill2). Pure — the same values feed the
 * Detailed micro-bars and the tooltip. `wall` marks the grade whose fulfil is the effective min.
 */
export function perGradeStaffing(
  labour: LabourVector,
  built: number,
  tier: GoodTier,
  state: LabourState,
): GradeStaffing[] {
  const rows: GradeStaffing[] = [
    { grade: "unskilled", needed: built * labour.unskilled, fulfil: state.labourFulfil, filled: 0, wall: false },
  ];
  if (tier >= 1) rows.push({ grade: "skill1", needed: built * labour.skill1, fulfil: state.skill1Fulfil, filled: 0, wall: false });
  if (tier >= 2) rows.push({ grade: "skill2", needed: built * labour.skill2, fulfil: state.skill2Fulfil, filled: 0, wall: false });
  for (const r of rows) r.filled = r.needed * r.fulfil;
  let wall = rows[0];
  for (const r of rows) if (r.fulfil < wall.fulfil) wall = r;
  wall.wall = true;
  return rows;
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
 * Yield multiplier a system's specialisation complex grants to `goodId`. 1 for un-familied
 * (tier-0) goods and for families whose complex is absent. Scales linearly with the complex's
 * count in [0,1], reaching the family's full multiplier at count = 1 (the cap) — never beyond.
 * Derived from `buildings`, so it needs no new production-signature.
 */
export function familyAnchorBuff(buildings: Record<string, number>, goodId: string): number {
  const family = FAMILY_BY_GOOD[goodId];
  if (!family) return 1;
  const count = buildings[family.complexType] ?? 0;
  if (count <= 0) return 1;
  return 1 + (family.buffMult - 1) * Math.min(1, count);
}

/**
 * The unbuffed output capacity a system's built factories give a family — Σ over the family's
 * goods of count × outputPerUnit. The stable, built-base-driven "demand" a complex is measured
 * against (mirrors an academy's skill demand); independent of staffing/selling swings.
 */
export function familyThroughput(buildings: Record<string, number>, family: SpecialisationFamily): number {
  let t = 0;
  for (const g of family.goods) t += (buildings[g] ?? 0) * (OUTPUT_PER_UNIT[g] ?? 0);
  return t;
}

/**
 * A specialisation complex's in-use units = min(count, throughput / rated) — how much of its rated
 * family coverage the built factories actually draw. Thriving family → used ≈ count (holds at cap);
 * orphaned family (throughput → 0) → used → 0 (rots away). The complex analogue of an academy's
 * count × min(1, demand/cap).
 */
export function complexUsed(count: number, throughput: number, rated: number): number {
  if (count <= 0) return 0;
  return Math.min(count, rated > 0 ? throughput / rated : 0);
}

/** Housing the current population fills, in building units. May exceed the housing count (overshoot). */
export function housingUsed(population: number): number {
  return Math.max(0, population) / POP_CENTRE_DENSITY;
}

/**
 * Everything a per-`output.kind` utilization needs, computed once per system by the caller. Both the
 * decay engine and the industry read service already have every field in hand (a single labourParts
 * pass + the population + a seller-side uptake signal), so this just names the bundle.
 */
export interface UtilizationContext {
  /** The whole built base — needed for a modifier's family throughput. */
  buildings: Record<string, number>;
  population: number;
  /** Headcount + skill demand/cap totals (one labourParts pass). */
  parts: LabourParts;
  /** The three fulfilment ratios. */
  state: LabourState;
  /** Seller-side output uptake ∈ [0,1] for a produced good; missing ⇒ 1 (sells freely). */
  outputUptake: (goodId: string) => number;
}

/** An abstract-capacity building's licence draw ÷ licence supply, in building units. */
function capacityUsed(kind: CapacityKind, count: number, ctx: UtilizationContext): number {
  switch (kind) {
    case "pop_cap":
      return housingUsed(ctx.population);
    case "skill1_licence":
      return count * (ctx.parts.skill1Cap > 0 ? Math.min(1, ctx.parts.skill1Demand / ctx.parts.skill1Cap) : 0);
    case "skill2_licence":
      return count * (ctx.parts.skill2Cap > 0 ? Math.min(1, ctx.parts.skill2Demand / ctx.parts.skill2Cap) : 0);
  }
}

/**
 * Absolute in-use amount for one building, dispatched on its typed output — the single source of the
 * "used" quantity the decay engine and the industry readout both consume, replacing the per-type
 * branches each carried:
 *  - market_good → staffed AND selling: count × min(effectiveFulfilment(tier), uptake).
 *  - capacity/pop_cap → occupancy: population / POP_CENTRE_DENSITY (may exceed count → overshoot).
 *  - capacity/skill{1,2}_licence → licence draw: count × min(1, skillDemand / skillCap).
 *  - modifier → family coverage the built factories draw: complexUsed(count, familyThroughput, rated).
 *  - none → staffing only (no current type; employment/holding fallback).
 */
export function buildingUsed(buildingType: string, count: number, ctx: UtilizationContext): number {
  const output = BUILDING_TYPES[buildingType]?.output ?? { kind: "none" as const };
  switch (output.kind) {
    case "market_good": {
      const tier = GOOD_TIER_BY_KEY[output.goodId] ?? 0;
      return count * Math.min(effectiveFulfilment(ctx.state, tier), ctx.outputUptake(output.goodId));
    }
    case "capacity":
      return capacityUsed(output.capacity, count, ctx);
    case "modifier": {
      const family = COMPLEX_BY_TYPE[output.family];
      return family ? complexUsed(count, familyThroughput(ctx.buildings, family), ANCHOR_RATED_COVERAGE) : 0;
    }
    case "none":
      return count * ctx.state.labourFulfil;
  }
}

/**
 * Utilization u ∈ [0,1] = min(1, buildingUsed / count); 0 at non-positive count. The clamped ratio
 * PR3's whole-level decay reads (an over-occupied housing level reads as fully utilised, not >1).
 */
export function computeUtilization(buildingType: string, count: number, ctx: UtilizationContext): number {
  if (count <= 0) return 0;
  return Math.min(1, buildingUsed(buildingType, count, ctx) / count);
}

/**
 * Capacity-driven production rate for one good. Sums every production type
 * whose outputGood matches (1:1 today, many-to-one ready).
 * Tier-0 goods are multiplied by `yields[resource]`; tier-1+ goods use ×1.
 */
export function buildingProduction(
  buildings: Record<string, number>,
  goodId: string,
  state: LabourState,
  yields: ResourceVector,
): number {
  const fulfillment = effectiveFulfilment(state, GOOD_TIER_BY_KEY[goodId] ?? 0);
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
  return rate * yieldMult * familyAnchorBuff(buildings, goodId);
}

/**
 * Per-good production + consumption for one system from its industrial base.
 * The read-service shape (one `SubstrateGoodRate` per good), capacity-driven on
 * the production axis; consumption is the civilian demand basis (per-capita
 * baseline + per-grade skilled baskets — see consumptionRate).
 * Tier-0 production is multiplied by `yields[resource]`.
 */
export function capacityGoodRates(
  buildings: Record<string, number>,
  population: number,
  yields: ResourceVector,
): SubstrateGoodRate[] {
  const snap = computeSystemLabourSnapshot(buildings, population);
  return GOOD_NAMES.map((goodId) => ({
    goodId,
    production: buildingProduction(buildings, goodId, snap.state, yields),
    consumption: consumptionRate(goodId, snap.basis),
  }));
}

/**
 * Production-input demand on `goodId` from the local industrial base: the total
 * desired (uncapped) draw of `goodId` across every building type that consumes
 * it. Capacity-based — the stable pricing-reference term folded into demandRate.
 * `state` is the system-wide labour state (`computeLabourState(buildings, population)`).
 */
export function inputDemandForGood(
  buildings: Record<string, number>,
  goodId: string,
  state: LabourState,
  yields: ResourceVector,
): number {
  let demand = 0;
  for (const consumer of GOOD_RECIPE_CONSUMERS[goodId] ?? []) {
    demand += buildingProduction(buildings, consumer.goodId, state, yields) * consumer.perOutput;
  }
  return demand * INPUT_DEMAND_MULTIPLIER;
}

/**
 * Same production-input demand as `inputDemandForGood`, but reading each consumer good's
 * production from a precomputed per-good map instead of recomputing `buildingProduction`.
 * Use when the production rates are already in hand (e.g. from `capacityGoodRates`): a consumer's
 * production from that map is identical to `buildingProduction(...)` at the same state/yields.
 */
export function inputDemandFromProduction(
  goodId: string,
  productionByGood: ReadonlyMap<string, number>,
): number {
  let demand = 0;
  for (const consumer of GOOD_RECIPE_CONSUMERS[goodId] ?? []) {
    demand += (productionByGood.get(consumer.goodId) ?? 0) * consumer.perOutput;
  }
  return demand * INPUT_DEMAND_MULTIPLIER;
}

/**
 * Why a building's `used` sits below its `count` — the binding constraint for the idle caption.
 * "skill1" names the vocational school (technicians), "skill2" the research institute (engineers).
 */
export type IdleReason = "occupancy" | "labour" | "skill1" | "skill2" | "selling";

/** One per-head basket entry — a good a skilled grade consumes on top of the base need. */
export interface SkillBasketEntry {
  goodId: string;
  perHead: number;
}

/** Snapshot of one system's industrial base and supply-chain state. */
export interface SystemIndustryReadout {
  /** Labour supply ratio in [0, 1]. 1 = fully staffed. */
  labourFulfillment: number;
  /** The three system-wide labour pools (workforce/technician/engineer), supply vs demand. */
  labour: SystemLabour;
  /** Population decomposed into disjoint role buckets + unemployed (sums to population). */
  labourAllocation: LabourAllocation;
  /**
   * One entry per building type with count > 0, sorted by tier ascending then buildingType.
   * `used` is the decay-relevant "in use" amount — occupancy for housing, staffed-and-selling
   * for producers (≤ count, except housing overshoot). `idleReason` names the binding constraint.
   */
  buildings: Array<{
    buildingType: string;
    outputGood?: string;
    /** Good tier for producers/extractors; -1 sentinel for housing (population centres). */
    tier: GoodTier | -1;
    count: number;
    used: number;
    /** Pure-staffing ratio the panel bar shows: effectiveFulfilment(tier) for producers, occupancy for housing. */
    staffedFraction: number;
    /** Real production rate this cycle (buildingProduction × inputGate). Producers/extractors only. */
    output?: number;
    idleReason?: IdleReason;
  }>;
  /** Produced goods that have a recipe. Sorted by inputGate ascending (most-throttled first). */
  supplyChain: Array<{ goodId: string; inputGate: number; throttledBy: string[] }>;
  /**
   * SKILL1_CONSUMPTION/SKILL2_CONSUMPTION as display-ready entries, each sorted by
   * perHead descending. The same catalogue for every system (skilled-grade baskets
   * don't vary by system) — served here so the client never imports the scaled
   * constants directly (they're server-only, see ECONOMY_SCALE).
   */
  skillBaskets: { technicians: SkillBasketEntry[]; engineers: SkillBasketEntry[] };
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

/** Turn a per-head consumption constant into display-ready basket entries, richest first. */
function skillBasketEntries(consumption: Record<string, number>): SkillBasketEntry[] {
  return Object.entries(consumption)
    .map(([goodId, perHead]) => ({ goodId, perHead }))
    .sort((a, b) => b.perHead - a.perHead);
}

/** The per-grade basket catalogues are argument-independent — computed once, shared by every readout. */
const TECHNICIAN_BASKET: SkillBasketEntry[] = skillBasketEntries(SKILL1_CONSUMPTION);
const ENGINEER_BASKET: SkillBasketEntry[] = skillBasketEntries(SKILL2_CONSUMPTION);

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
  const parts = labourParts(buildings);
  const state = labourStateFromParts(parts, population);
  const pop = Math.max(0, population);
  const labour: SystemLabour = {
    workforce: { have: pop, need: parts.demand, fulfil: state.labourFulfil },
    skill1: { have: parts.skill1Cap, need: parts.skill1Demand, fulfil: state.skill1Fulfil },
    skill2: { have: parts.skill2Cap, need: parts.skill2Demand, fulfil: state.skill2Fulfil },
  };
  const stockOf = (g: string): number => marketStock[g] ?? minStockOf(g);
  // Seller-side uptake for a produced good ∈ [0,1]; a good with no market band (no row, or a legacy
  // caller without maxStockOf) sells freely (1). Shared by buildingUsed and the producer idleReason.
  const uptakeOf = (g: string): number => {
    if (maxStockOf === undefined) return 1;
    const maxStock = maxStockOf(g);
    return maxStock !== undefined ? outputUptake(stockOf(g), minStockOf(g), maxStock) : 1;
  };
  const ctx: UtilizationContext = { buildings, population, parts, state, outputUptake: uptakeOf };

  // Per-building "in use" — the decay-relevant quantity, resolved by the one shared buildingUsed
  // dispatch (the same values computeSystemDecay sees): housing occupancy, an academy's licence draw,
  // a complex's family coverage, or a producer's staffed-and-selling capacity. staffedFraction is the
  // panel's utilisation bar — used/count for the capacity/modifier rows, the pure staffing ratio for
  // producers (so a fully-staffed-but-not-selling producer still reads 100% staffed). idleReason
  // captions an idle producer row: "labour" (headcount short), "skill1"/"skill2" (a skill ceiling
  // drags fulfilment below the headcount gate), or "selling" (output can't move).
  const buildingEntries: SystemIndustryReadout["buildings"] = [];
  for (const [buildingType, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    if (buildingType === HOUSING_TYPE) {
      const used = buildingUsed(HOUSING_TYPE, count, ctx);
      const staffedFraction = count > 0 ? used / count : 0;
      buildingEntries.push({ buildingType, tier: -1, count, used, staffedFraction, idleReason: used < count ? "occupancy" : undefined });
      continue;
    }
    if (COMPLEX_BY_TYPE[buildingType]) {
      // A complex produces no good of its own — its "used" is family-utilisation
      // (built factories vs rated coverage), not labour/selling like a producer.
      const used = buildingUsed(buildingType, count, ctx);
      const staffedFraction = count > 0 ? used / count : 0;
      buildingEntries.push({ buildingType, tier: 0, count, used, staffedFraction });
      continue;
    }
    const def = BUILDING_TYPES[buildingType];
    if (def?.output.kind === "capacity") {
      // Academy (housing handled above) — a capacity building whose utilisation is its licence draw
      // (skill demand vs the licensed ceiling). Displayed like a complex (staffedFraction = used/count,
      // no market output), so an over-licensed academy reads as idle exactly as decay measures it.
      const used = buildingUsed(buildingType, count, ctx);
      const staffedFraction = count > 0 ? used / count : 0;
      buildingEntries.push({ buildingType, tier: 0, count, used, staffedFraction });
      continue;
    }
    const outputGood = def?.outputGood;
    const tier: GoodTier = outputGood !== undefined ? (GOOD_TIER_BY_KEY[outputGood] ?? 0) : 0;
    const fulfil = effectiveFulfilment(state, tier);
    const used = buildingUsed(buildingType, count, ctx);
    // output = the real production rate this cycle: buildingProduction × inputGate (uptake is a
    // selling/decay signal, not a production multiplier — see lib/tick/processors/economy.ts).
    let output: number | undefined;
    if (outputGood !== undefined) {
      const production = buildingProduction(buildings, outputGood, state, yields);
      const gate = GOOD_RECIPES[outputGood] ? inputGate(outputGood, production, stockOf, minStockOf) : 1;
      output = production * gate;
    }
    let idleReason: IdleReason | undefined;
    if (used < count) {
      // uptake is only read here to name the binding constraint; derive it lazily so a fully-used
      // producer skips the lookup buildingUsed already made for `used`.
      const uptake = outputGood !== undefined ? uptakeOf(outputGood) : 1;
      if (uptake < fulfil) idleReason = "selling";
      else if (fulfil < state.labourFulfil) {
        // A skill ceiling binds. Name the pool that is actually the min the tier draws on;
        // on a tier-2 tie (neither academy) the lower grade (skill1) wins — it is the prerequisite.
        idleReason = tier >= 2 && state.skill2Fulfil < state.skill1Fulfil ? "skill2" : "skill1";
      } else idleReason = "labour";
    }
    buildingEntries.push({ buildingType, outputGood, tier, count, used, staffedFraction: fulfil, output, idleReason });
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

    const effectiveProduction = buildingProduction(buildings, goodId, state, yields);
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
    labourFulfillment: state.labourFulfil,
    labour,
    labourAllocation: computeLabourAllocation(parts, population),
    buildings: buildingEntries,
    supplyChain: supplyChainEntries,
    skillBaskets: {
      technicians: TECHNICIAN_BASKET,
      engineers: ENGINEER_BASKET,
    },
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
// The space partition industry is built against: tier-0 extractors sit on dedicated deposit slots;
// tier-1+ factories and population centres share fungible general space; pop-centres are additionally
// bounded by the habitable subset. These pure helpers turn the denormalised substrate columns + built
// base into the shapes the system panels render.

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
