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

/** Build a full vector from a partial, filling unspecified types with zero. */
export function makeResourceVector(partial: Partial<ResourceVector>): ResourceVector {
  const v = emptyResourceVector();
  for (const type of RESOURCE_TYPES) {
    const supplied = partial[type];
    if (supplied !== undefined) v[type] = supplied;
  }
  return v;
}

/** Spread a vector onto the StarSystem aggregate columns (agg*). */
export function aggregateColumns(v: ResourceVector): {
  aggGas: number; aggMinerals: number; aggOre: number; aggBiomass: number;
  aggArable: number; aggWater: number; aggRadioactive: number;
} {
  return {
    aggGas: v.gas, aggMinerals: v.minerals, aggOre: v.ore, aggBiomass: v.biomass,
    aggArable: v.arable, aggWater: v.water, aggRadioactive: v.radioactive,
  };
}

/** Spread a vector onto the SystemBody resource columns (res*). */
export function bodyResourceColumns(v: ResourceVector): {
  resGas: number; resMinerals: number; resOre: number; resBiomass: number;
  resArable: number; resWater: number; resRadioactive: number;
} {
  return {
    resGas: v.gas, resMinerals: v.minerals, resOre: v.ore, resBiomass: v.biomass,
    resArable: v.arable, resWater: v.water, resRadioactive: v.radioactive,
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
 * Inverse of aggregateColumns / bodyResourceColumns: read a flat column bag
 * back into a ResourceVector. prefix "agg" reads aggGas…aggRadioactive;
 * prefix "res" reads resGas…resRadioactive. Missing columns default to 0.
 */
export function resourceVectorFromColumns(
  source: Record<string, number>,
  prefix: "agg" | "res",
): ResourceVector {
  const v = emptyResourceVector();
  for (const type of RESOURCE_TYPES) {
    const key = `${prefix}${type.charAt(0).toUpperCase()}${type.slice(1)}`;
    v[type] = source[key] ?? 0;
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
