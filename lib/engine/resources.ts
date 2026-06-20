/**
 * Pure resource-vector helpers — zero DB dependency.
 * A ResourceVector is a magnitude per tier-0 resource type.
 */
import type { ResourceType, ResourceVector } from "@/lib/types/game";

/** The seven locked tier-0 resource types, in canonical order. */
export const RESOURCE_TYPES: readonly ResourceType[] = [
  "gas", "minerals", "ore", "biomass", "arable", "water", "radioactive",
] as const;

/** A fresh vector with every resource at zero. */
export function emptyResourceVector(): ResourceVector {
  return { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 0, radioactive: 0 };
}

/** A fresh vector with every resource at one (multiplicative identity; use as a yields placeholder). */
export function unitResourceVector(): ResourceVector {
  return { gas: 1, minerals: 1, ore: 1, biomass: 1, arable: 1, water: 1, radioactive: 1 };
}

/** Build a full vector from a partial, filling unspecified types with zero. */
export function makeResourceVector(partial: Partial<ResourceVector>): ResourceVector {
  const v = emptyResourceVector();
  for (const type of RESOURCE_TYPES) {
    const supplied = partial[type];
    if (supplied !== undefined) v[type] = supplied;
  }
  return v;
}

/** Spread a vector onto the SystemBody deposit-slot columns (slot*). */
export function slotColumns(v: ResourceVector): {
  slotGas: number; slotMinerals: number; slotOre: number; slotBiomass: number;
  slotArable: number; slotWater: number; slotRadioactive: number;
} {
  return {
    slotGas: v.gas, slotMinerals: v.minerals, slotOre: v.ore, slotBiomass: v.biomass,
    slotArable: v.arable, slotWater: v.water, slotRadioactive: v.radioactive,
  };
}

/** Spread a vector onto the SystemBody quality-band columns (qual*). */
export function qualColumns(v: ResourceVector): {
  qualGas: number; qualMinerals: number; qualOre: number; qualBiomass: number;
  qualArable: number; qualWater: number; qualRadioactive: number;
} {
  return {
    qualGas: v.gas, qualMinerals: v.minerals, qualOre: v.ore, qualBiomass: v.biomass,
    qualArable: v.arable, qualWater: v.water, qualRadioactive: v.radioactive,
  };
}

/** Spread a vector onto the SystemBody per-resource yield-multiplier columns (yield*). */
export function yieldColumns(v: ResourceVector): {
  yieldGas: number; yieldMinerals: number; yieldOre: number; yieldBiomass: number;
  yieldArable: number; yieldWater: number; yieldRadioactive: number;
} {
  return {
    yieldGas: v.gas, yieldMinerals: v.minerals, yieldOre: v.ore, yieldBiomass: v.biomass,
    yieldArable: v.arable, yieldWater: v.water, yieldRadioactive: v.radioactive,
  };
}

/** Element-wise sum of resource vectors (the system aggregate from its bodies). */
export function sumResourceVectors(vectors: ResourceVector[]): ResourceVector {
  const acc = emptyResourceVector();
  for (const v of vectors) {
    for (const type of RESOURCE_TYPES) acc[type] += v[type];
  }
  return acc;
}

/** A single resource's bar: raw value + its fraction of the vector's max (0–1). */
export interface ResourceBarEntry {
  type: ResourceType;
  value: number;
  fraction: number;
}

/** Prepared bars for one vector: rendered entries plus collapsed trace types. */
export interface ResourceBars {
  entries: ResourceBarEntry[];
  trace: ResourceType[];
}

/** Resources below this fraction of the vector max collapse into "trace". */
const TRACE_FRACTION = 0.05;

/**
 * Inverse of the column-spreader functions: read a flat column bag back into a
 * ResourceVector.
 *
 * Supported prefixes:
 *   "slot"  — reads slotGas…slotRadioactive (deposit-slot counts)
 *   "qual"  — reads qualGas…qualRadioactive (quality-band values)
 *   "yield" — reads yieldGas…yieldRadioactive (yield multipliers)
 *
 * Missing columns default to 0 for all prefixes EXCEPT "yield", where the
 * schema default is @default(1) and an absent multiplier means a neutral ×1.
 */
export function resourceVectorFromColumns(
  source: Record<string, number>,
  prefix: "slot" | "qual" | "yield",
): ResourceVector {
  const fallback = prefix === "yield" ? 1 : 0;
  const v = emptyResourceVector();
  for (const type of RESOURCE_TYPES) {
    const key = `${prefix}${type.charAt(0).toUpperCase()}${type.slice(1)}`;
    v[type] = source[key] ?? fallback;
  }
  return v;
}

/**
 * Turn a ResourceVector into renderable bars. Bars normalize to the vector's
 * own max (so the dominant resource reads full-width); the raw value is kept
 * for display. With `sort`, entries read rich-first. With `collapseTrace`,
 * zero / near-zero resources move into `trace` instead of rendering a bar.
 */
export function prepareResourceBars(
  vector: ResourceVector,
  opts: { sort?: boolean; collapseTrace?: boolean } = {},
): ResourceBars {
  const { sort = false, collapseTrace = false } = opts;
  const types = [...RESOURCE_TYPES];
  if (sort) types.sort((a, b) => vector[b] - vector[a]);
  const max = Math.max(0, ...types.map((t) => vector[t]));

  const entries: ResourceBarEntry[] = [];
  const trace: ResourceType[] = [];
  for (const type of types) {
    const value = vector[type];
    // value <= 0 catches exact zeros; the relative clause needs max > 0 to
    // avoid 0/0, so an all-zero vector collapses entirely via the first clause.
    const isTrace =
      collapseTrace && (value <= 0 || (max > 0 && value / max < TRACE_FRACTION));
    if (isTrace) {
      trace.push(type);
    } else {
      entries.push({ type, value, fraction: max > 0 ? value / max : 0 });
    }
  }
  return { entries, trace };
}
