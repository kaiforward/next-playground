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
/** Build-space granted by a habitable body of size 1. */
export const BASE_SPACE = 40;
/** Habitable worlds host industry; belts / gas giants barely. */
export const HABITABILITY_FACTOR = { habitable: 1.0, uninhabitable: 0.15 } as const;
/** Default build-space footprint of one building. */
export const DEFAULT_SPACE_COST = 1.0;
/** Default population to fully staff one production building. */
export const DEFAULT_LABOUR_PER_UNIT = 25;
/** popCap one housing building provides. Below labourPerUnit by design — housing alone can't staff the industry it enables, forcing a mixed build-out. */
export const HOUSING_POP_PROVIDED = 20;

/**
 * Per-good per-building output at full labour. First-draft = the
 * physical-economy production coefficient, so a fully built-out, deposit-rich
 * world roughly reproduces the substrate layer's output. Independent of that
 * table going forward — simulator-calibrated; only relative shape matters.
 */
export const OUTPUT_PER_UNIT: Record<string, number> = Object.fromEntries(
  GOOD_NAMES.map((g) => [g, GOOD_PRODUCTION[g]?.coeff ?? 1]),
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
  [HOUSING_TYPE]: { spaceCost: DEFAULT_SPACE_COST, popProvided: HOUSING_POP_PROVIDED },
};

/** The 26 production building type ids (good ids), in canonical good order. */
export const PRODUCTION_BUILDING_TYPES: string[] = [...GOOD_NAMES];

export function sizeFactor(size: number): number {
  return Math.max(0, size);
}

export function habitabilityFactor(habitable: boolean): number {
  return habitable ? HABITABILITY_FACTOR.habitable : HABITABILITY_FACTOR.uninhabitable;
}

/**
 * Build-space footprint of one building of `buildingType`. A modifier hook —
 * global upgrades (a denser type, a tech) multiply here without touching call
 * sites. Identity over the catalog cost in this model.
 */
export function effectiveSpaceCost(buildingType: string): number {
  return BUILDING_TYPES[buildingType]?.spaceCost ?? DEFAULT_SPACE_COST;
}
