/**
 * Building-type catalog — the generic one-good industrial base.
 *
 * Each building type carries static, hard-coded properties: what it produces,
 * its recipe inputs, build-space footprint, labour to staff, and per-building
 * output. The catalog is data, not branches — a denser or upgraded type is a
 * new entry. In this model a production building type's id equals its output
 * good id (1:1); `buildingType → outputGood` is many-to-one so `*_mk2` types
 * are a pure data addition. The lone non-production type is `housing`, which
 * raises popCap and produces nothing.
 *
 * Magnitudes are first-draft and simulator-calibrated; only relative shape
 * matters (deposit caps tier-0 extractor count; manufacturers are space/labour
 * bound). Recipe `inputs` are inert here — input-gating arrives with the
 * supply-chain cascade.
 */
import type { ResourceType, GoodTier } from "@/lib/types/game";
import { GOOD_NAMES, GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { GOOD_PRODUCTION } from "@/lib/constants/physical-economy";
import { scaleValue, scaleRecord } from "@/lib/constants/economy-scale";

export const HOUSING_TYPE = "housing";
export const VOCATIONAL_SCHOOL_TYPE = "vocational_school";
export const RESEARCH_INSTITUTE_TYPE = "research_institute";
export const CONSTRUCTION_CENTRE_TYPE = "construction_centre";
/** The two academy building type ids, in grade order. */
export const ACADEMY_TYPES: string[] = [VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE];

// ── Academy licensing (coarse first-cut; tune against sim equilibrium) ──
// One academy licenses this much skilled-grade work system-wide; large enough that one
// academy serves several factories, so academies are lumpy/concentrated, not per-factory.
export const SKILL1_PER_SCHOOL = 150;
export const SKILL2_PER_INSTITUTE = 90;

// ── Specialisation complexes (family production anchors) ──
export const HEAVY_INDUSTRY_COMPLEX = "heavy_industry_complex";
export const CHEMICALS_COMPLEX = "chemicals_complex";
export const ELECTRONICS_COMPLEX = "electronics_complex";
export const ARMAMENTS_COMPLEX = "armaments_complex";
export const CONSUMER_COMPLEX = "consumer_complex";

/** A production family and the anchor complex that buffs it. */
export interface SpecialisationFamily {
  /** Complex building-type id for this family. */
  complexType: string;
  /** Display name of the complex. */
  label: string;
  /** Tier-1+ goods this complex buffs (a partition — each good in exactly one family). */
  goods: string[];
  /** Full yield multiplier at complex count = 1 (per-family weighted so families balance). */
  buffMult: number;
}

/** The five vertical production families. Buff multipliers are lighter on the heavyweight families. */
export const SPECIALISATION_FAMILIES: SpecialisationFamily[] = [
  { complexType: HEAVY_INDUSTRY_COMPLEX, label: "Heavy Industry Complex", buffMult: 1.4,
    goods: ["metals", "alloys", "hull_plating", "components", "machinery", "ship_frames"] },
  { complexType: CHEMICALS_COMPLEX, label: "Chemical Combine", buffMult: 1.5,
    goods: ["fuel", "chemicals", "polymers", "medicine"] },
  { complexType: ELECTRONICS_COMPLEX, label: "Electronics Complex", buffMult: 1.5,
    goods: ["electronics", "targeting_arrays"] },
  { complexType: ARMAMENTS_COMPLEX, label: "Armaments Complex", buffMult: 1.4,
    goods: ["munitions", "weapons", "weapons_systems", "reactor_cores"] },
  { complexType: CONSUMER_COMPLEX, label: "Consumer Works", buffMult: 1.5,
    goods: ["consumer_goods", "luxuries"] },
];

/** good id → its family. Un-familied (tier-0) goods return undefined. */
export const FAMILY_BY_GOOD: Record<string, SpecialisationFamily> = (() => {
  const out: Record<string, SpecialisationFamily> = {};
  for (const f of SPECIALISATION_FAMILIES) for (const g of f.goods) out[g] = f;
  return out;
})();

/** complex building-type id → its family. */
export const COMPLEX_BY_TYPE: Record<string, SpecialisationFamily> = (() => {
  const out: Record<string, SpecialisationFamily> = {};
  for (const f of SPECIALISATION_FAMILIES) out[f.complexType] = f;
  return out;
})();

/** The five complex building type ids. */
export const COMPLEX_TYPES: string[] = SPECIALISATION_FAMILIES.map((f) => f.complexType);

// ── Anchor knobs (coarse first-cut; tune against sim equilibrium) ──
/** General-space footprint of one full complex (count = 1) — the largest building type; a shipyard is 4.0. */
export const ANCHOR_FOOTPRINT = 8;
/** Modest unskilled head count one full complex draws to run (like an academy). */
export const ANCHOR_UNSKILLED_LABOUR = 12;
/** Max complexes per system, total across all families ("one industrial identity"). */
export const ANCHOR_CAP = 1;
/** Family output throughput one full complex is rated to buff — sets decay `used` + the planner's amortisation. */
export const ANCHOR_RATED_COVERAGE = scaleValue(20);
/** Seed/build a complex only where projected family throughput reaches this floor (amortisation). */
export const ANCHOR_MIN_THROUGHPUT = scaleValue(10);

/** Magnitude knob on recipe input-demand draws; neutral (1.0) until calibrated against sim equilibrium. */
export const INPUT_DEMAND_MULTIPLIER = 1.0;

/** Per-good labour requirement, partitioned across skill grades. The three shares SUM to the head count. */
export interface LabourVector {
  /** Tier-0-grade workers — no academy gate. */
  unskilled: number;
  /** Technician-grade work, licensed by vocational schools. */
  skill1: number;
  /** Engineer-grade work, licensed by research institutes. */
  skill2: number;
}

/** Total head count one building of this good demands (the partition's sum). */
export function labourTotal(v: LabourVector): number {
  return v.unskilled + v.skill1 + v.skill2;
}

// ── Labour vectors (coarse first-cut; tune against sim equilibrium) ──
// Per-tier default partition; advanced manufacturing is both labour- and skill-heavier.
const LABOUR_BY_TIER: Record<GoodTier, LabourVector> = {
  0: { unskilled: 10, skill1: 0, skill2: 0 },
  1: { unskilled: 18, skill1: 7, skill2: 0 },
  2: { unskilled: 30, skill1: 20, skill2: 10 },
};
// Per-good overrides where the partition reads differently (only a few; rest = tier default).
const LABOUR_OVERRIDES: Record<string, LabourVector> = {
  // Most-integrated tier-2 — engineer- and labour-heavy.
  ship_frames: { unskilled: 35, skill1: 25, skill2: 20 },
  reactor_cores: { unskilled: 30, skill1: 22, skill2: 18 },
  weapons_systems: { unskilled: 30, skill1: 22, skill2: 16 },
  // Labour-heavy, low-skill tier-1.
  consumer_goods: { unskilled: 28, skill1: 8, skill2: 0 },
};

function labourFor(goodId: string): LabourVector {
  return LABOUR_OVERRIDES[goodId] ?? LABOUR_BY_TIER[GOOD_TIER_BY_KEY[goodId] ?? 0];
}

/** The abstract (un-priced) capacities a building can supply. */
export type CapacityKind = "pop_cap" | "skill1_licence" | "skill2_licence";

/**
 * What a building produces — one uniform skeleton, typed output. A `market_good` is priced and sold
 * (extractors, factories); a `capacity` is an un-priced running balance (housing pop-cap, an academy
 * skill licence); a `modifier` is a %-buff (a specialisation complex, keyed by its complex-type id);
 * `none` is employment/holding only. The utilization dispatch (`buildingUsed`) keys off `kind`.
 */
export type BuildingOutput =
  | { kind: "market_good"; goodId: string }
  | { kind: "capacity"; capacity: CapacityKind }
  | { kind: "modifier"; family: string }
  | { kind: "none" };

export interface BuildingTypeDef {
  /** Typed output — the discriminant every utilization/decay/read path dispatches on. */
  output: BuildingOutput;
  /** Good this type produces (=== type id in this model). Undefined for housing. */
  outputGood?: string;
  /** Recipe: input good → units per output. Tier-1+ only; inert until input-gating. */
  inputs?: Record<string, number>;
  /** Tier-0 deposit resource that caps this extractor's seeded count. Tier-0 only. */
  resource?: ResourceType;
  /** Build-space units one building occupies. */
  spaceCost: number;
  /** Skill-partitioned population to fully staff one building. Production types + academies. */
  labour?: LabourVector;
  /** Output units one building yields at full labour (and inputs). Production types only. */
  outputPerUnit?: number;
  /** popCap added per building. Housing only. */
  popProvided?: number;
  /** skill-1 work this building licenses system-wide. Vocational school only. */
  skill1Licensed?: number;
  /** skill-2 work this building licenses system-wide. Research institute only. */
  skill2Licensed?: number;
}

// ── Build-space knobs (first-draft; simulator-calibrated) ──
/** Default build-space footprint of one building. */
export const DEFAULT_SPACE_COST = 1.0;
/** popCap one population-centre building provides. Below a building's labour total by design — pop-centres alone can't staff the industry they enable, forcing a mixed build-out. */
export const POP_CENTRE_DENSITY = 20;

/**
 * Per-good per-building output at full labour. Base = the physical-economy
 * production coefficient, so a fully built-out, deposit-rich world roughly
 * reproduces the substrate layer's output. Independent of that table going
 * forward — simulator-calibrated; only relative shape matters.
 *
 * Tier-0 extractors carry output overrides where demand outruns the base
 * coefficient. Two pressures stack: a high per-capita need (consumption =
 * need × population) for the staples food/water/gas, and recipe draw — a tier-0
 * good consumed as a production input (ore→metals; minerals and biomass into
 * the tier-1 chain) has its civilian demand compounded by every downstream
 * producer that draws it. Extractor count is deposit-capped, so the override
 * lifts per-extractor yield to track total demand without disturbing the
 * balanced higher tiers. Gas runs highest: its deposit is the rarest (the
 * fewest systems can host an extractor) and it feeds fuel, chemicals, and
 * polymers on top of civilian use.
 */
const OUTPUT_OVERRIDES: Record<string, number> = {
  food: 3.5,
  water: 2.0,
  gas: 8.0,
  textiles: 1.4,
  minerals: 4.0,
  ore: 4.0,
  biomass: 2.2,
};

export const OUTPUT_PER_UNIT: Record<string, number> = scaleRecord(
  Object.fromEntries(GOOD_NAMES.map((g) => [g, OUTPUT_OVERRIDES[g] ?? GOOD_PRODUCTION[g]?.coeff ?? 1])),
);

// ── Per-good general-space footprint (coarse first-cut; tune against sim equilibrium) ──
// Differentiates tier-1/2 factory footprints; default 1.0. Tier-0 extractor footprint stays
// on the deposit-slot model (DEPOSIT_SLOT_FOOTPRINT), not spaceCost — extractor count is
// capped by deposits, not general build-space.
const SPACE_OVERRIDES: Record<string, number> = {
  ship_frames: 4.0,
  reactor_cores: 3.0,
  machinery: 2.5,
  weapons_systems: 2.5,
};

function buildProductionTypes(): Record<string, BuildingTypeDef> {
  const out: Record<string, BuildingTypeDef> = {};
  for (const goodId of GOOD_NAMES) {
    const recipe = GOOD_RECIPES[goodId];
    const resource = GOOD_PRODUCTION[goodId]?.resource;
    out[goodId] = {
      output: { kind: "market_good", goodId },
      outputGood: goodId,
      ...(recipe ? { inputs: recipe } : {}),
      ...(resource ? { resource } : {}),
      spaceCost: SPACE_OVERRIDES[goodId] ?? DEFAULT_SPACE_COST,
      labour: labourFor(goodId),
      outputPerUnit: OUTPUT_PER_UNIT[goodId],
    };
  }
  return out;
}

function buildComplexTypes(): Record<string, BuildingTypeDef> {
  const out: Record<string, BuildingTypeDef> = {};
  for (const f of SPECIALISATION_FAMILIES) {
    out[f.complexType] = {
      output: { kind: "modifier", family: f.complexType },
      spaceCost: ANCHOR_FOOTPRINT,
      labour: { unskilled: ANCHOR_UNSKILLED_LABOUR, skill1: 0, skill2: 0 },
    };
  }
  return out;
}

export const BUILDING_TYPES: Record<string, BuildingTypeDef> = {
  ...buildProductionTypes(),
  ...buildComplexTypes(),
  [HOUSING_TYPE]: {
    output: { kind: "capacity", capacity: "pop_cap" },
    spaceCost: DEFAULT_SPACE_COST,
    popProvided: POP_CENTRE_DENSITY,
  },
  [VOCATIONAL_SCHOOL_TYPE]: {
    output: { kind: "capacity", capacity: "skill1_licence" },
    spaceCost: 1.5,
    labour: { unskilled: 15, skill1: 0, skill2: 0 },
    skill1Licensed: SKILL1_PER_SCHOOL,
  },
  [RESEARCH_INSTITUTE_TYPE]: {
    output: { kind: "capacity", capacity: "skill2_licence" },
    spaceCost: 2.0,
    labour: { unskilled: 20, skill1: 0, skill2: 0 },
    skill2Licensed: SKILL2_PER_INSTITUTE,
  },
  [CONSTRUCTION_CENTRE_TYPE]: {
    output: { kind: "none" },
    spaceCost: DEFAULT_SPACE_COST,
    labour: { unskilled: 18, skill1: 7, skill2: 0 },
  },
};

/** The 26 production building type ids (good ids), in canonical good order. */
export const PRODUCTION_BUILDING_TYPES: string[] = [...GOOD_NAMES];

/** Storage one tier-0 extractor adds for its own resource's good (mined on-site, held for shipment). First-draft; subject to calibration. */
export const EXTRACTOR_STORAGE_PER_UNIT = scaleValue(40);
/** Storage one tier-1+ factory adds for its output good (output buffer). */
export const PRODUCTION_STORAGE_PER_UNIT = scaleValue(15);
/** Nominal storage a population centre adds per good it consumes (retail/utility/government holdings). */
export const POP_CENTRE_STORAGE_DEFAULT = scaleValue(2);
/** Pop-centre storage overrides for consumer-facing goods — people keep more of what they buy. */
export const POP_CENTRE_STORAGE: Record<string, number> = scaleRecord({
  consumer_goods: 12, food: 8, water: 8, medicine: 6, luxuries: 6, textiles: 5,
});


export function sizeFactor(size: number): number {
  return Math.max(0, size);
}

/**
 * Build-space footprint of one building of `buildingType`. A modifier hook —
 * global upgrades (a denser type, a tech) multiply here without touching call
 * sites. Identity over the catalog cost in this model.
 */
export function effectiveSpaceCost(buildingType: string): number {
  return BUILDING_TYPES[buildingType]?.spaceCost ?? DEFAULT_SPACE_COST;
}
