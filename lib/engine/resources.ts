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
