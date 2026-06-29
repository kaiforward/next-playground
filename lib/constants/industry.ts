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
import type { ResourceType } from "@/lib/types/game";
import { GOOD_NAMES } from "@/lib/constants/goods";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { GOOD_PRODUCTION } from "@/lib/constants/physical-economy";
import { scaleValue, scaleRecord } from "@/lib/constants/economy-scale";

export const HOUSING_TYPE = "housing";

export interface BuildingTypeDef {
  /** Good this type produces (=== type id in this model). Undefined for housing. */
  outputGood?: string;
  /** Recipe: input good → units per output. Tier-1+ only; inert until input-gating. */
  inputs?: Record<string, number>;
  /** Tier-0 deposit resource that caps this extractor's seeded count. Tier-0 only. */
  resource?: ResourceType;
  /** Build-space units one building occupies. */
  spaceCost: number;
  /** Population needed to fully staff one building. Production types only. */
  labourPerUnit?: number;
  /** Output units one building yields at full labour (and inputs). Production types only. */
  outputPerUnit?: number;
  /** popCap added per building. Housing only. */
  popProvided?: number;
}

// ── Build-space knobs (first-draft; simulator-calibrated) ──
/** Default build-space footprint of one building. */
export const DEFAULT_SPACE_COST = 1.0;
/** Default population to fully staff one production building. */
export const DEFAULT_LABOUR_PER_UNIT = 25;
/** popCap one population-centre building provides. Below labourPerUnit by design — pop-centres alone can't staff the industry they enable, forcing a mixed build-out. */
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

function buildProductionTypes(): Record<string, BuildingTypeDef> {
  const out: Record<string, BuildingTypeDef> = {};
  for (const goodId of GOOD_NAMES) {
    const recipe = GOOD_RECIPES[goodId];
    const resource = GOOD_PRODUCTION[goodId]?.resource;
    out[goodId] = {
      outputGood: goodId,
      ...(recipe ? { inputs: recipe } : {}),
      ...(resource ? { resource } : {}),
      spaceCost: DEFAULT_SPACE_COST,
      labourPerUnit: DEFAULT_LABOUR_PER_UNIT,
      outputPerUnit: OUTPUT_PER_UNIT[goodId],
    };
  }
  return out;
}

export const BUILDING_TYPES: Record<string, BuildingTypeDef> = {
  ...buildProductionTypes(),
  [HOUSING_TYPE]: { spaceCost: DEFAULT_SPACE_COST, popProvided: POP_CENTRE_DENSITY },
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

/** Idle fraction (Σ(count − used) / Σ count) at/above which a system is "coasting". */
export const IDLE_COASTING_FRACTION = 0.15;

/**
 * Per-building idle fraction (1 − used/built) at/above which a building reads as
 * "declining" rather than merely "idle". A display classification band (how the
 * Industry panel colours a row), not an economy rule — a producer running below
 * half capacity is effectively failing, not just slack.
 */
export const IDLE_COLLAPSING_FRACTION = 0.5;

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
