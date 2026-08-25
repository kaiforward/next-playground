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

/** Total magnitude across all resource types (Σ of the seven components). */
export function sumResourceVector(v: ResourceVector): number {
  let total = 0;
  for (const type of RESOURCE_TYPES) total += v[type];
  return total;
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

/**
 * The three flat column bags a resource-bearing row (a system, a body) spreads a ResourceVector
 * across — one column per member of `RESOURCE_TYPES`. They are the parameter types of the readers
 * below, so a row that is missing a column is a type error rather than a silent zero.
 *
 * Declared as type aliases, not interfaces: the readers hand them to `resourceVectorFromColumns`,
 * whose `Record<string, number>` parameter only accepts a type with an index signature (implicit
 * for an alias, absent for an interface).
 */
export type CountColumns = {
  countGas: number; countMinerals: number; countOre: number; countBiomass: number;
  countArable: number; countWater: number; countRadioactive: number;
};

export type QualColumns = {
  qualGas: number; qualMinerals: number; qualOre: number; qualBiomass: number;
  qualArable: number; qualWater: number; qualRadioactive: number;
};

export type YieldColumns = {
  yieldGas: number; yieldMinerals: number; yieldOre: number; yieldBiomass: number;
  yieldArable: number; yieldWater: number; yieldRadioactive: number;
};

/**
 * A system's per-resource extraction-work efficiency — the worked-prefix mean of the hosting
 * bodies' `extractionModifier`, kept as its OWN aggregate never folded into the yield columns
 * (see `lib/constants/bodies.ts` and `lib/engine/worked-deposits.ts`; the all-bodies pool
 * lives on as `substrateAggregates`' `potentialExtractionEfficiency`).
 */
export type EffColumns = {
  effGas: number; effMinerals: number; effOre: number; effBiomass: number;
  effArable: number; effWater: number; effRadioactive: number;
};

/** Spread a vector onto the SystemBody deposit-slot columns (count*). */
export function countColumns(v: ResourceVector): CountColumns {
  return {
    countGas: v.gas, countMinerals: v.minerals, countOre: v.ore, countBiomass: v.biomass,
    countArable: v.arable, countWater: v.water, countRadioactive: v.radioactive,
  };
}

/** Spread a vector onto the SystemBody quality-band columns (qual*). */
export function qualColumns(v: ResourceVector): QualColumns {
  return {
    qualGas: v.gas, qualMinerals: v.minerals, qualOre: v.ore, qualBiomass: v.biomass,
    qualArable: v.arable, qualWater: v.water, qualRadioactive: v.radioactive,
  };
}

/** Spread a vector onto the SystemBody per-resource yield-multiplier columns (yield*). */
export function yieldColumns(v: ResourceVector): YieldColumns {
  return {
    yieldGas: v.gas, yieldMinerals: v.minerals, yieldOre: v.ore, yieldBiomass: v.biomass,
    yieldArable: v.arable, yieldWater: v.water, yieldRadioactive: v.radioactive,
  };
}

/** Spread a vector onto the WorldSystem per-resource extraction-efficiency columns (eff*). */
export function effColumns(v: ResourceVector): EffColumns {
  return {
    effGas: v.gas, effMinerals: v.minerals, effOre: v.ore, effBiomass: v.biomass,
    effArable: v.arable, effWater: v.water, effRadioactive: v.radioactive,
  };
}

/**
 * Count-weighted mean of `valueOf(body)` over `bodies`, weighted by `countOf(body)` —
 * Σ(count·value) / Σ count, skipping any body whose count is non-positive. Returns 1 (a neutral
 * multiplier) when the total count is 0 — the shared "nothing here, read neutral" convention every
 * per-resource deposit/extraction-quality reader shares (`depositGradeVector`,
 * `extractionEfficiencyVector`). The value accessor is what lets one fold serve both: a per-body
 * quality band keyed by resource (deposit grade) and a per-body constant keyed only by archetype
 * (extraction efficiency) are the same shape of aggregate with different `valueOf`s.
 */
export function countWeightedMean<T>(
  bodies: T[],
  countOf: (body: T) => number,
  valueOf: (body: T) => number,
): number {
  let weighted = 0;
  let total = 0;
  for (const b of bodies) {
    const c = countOf(b);
    if (c <= 0) continue;
    weighted += c * valueOf(b);
    total += c;
  }
  return total > 0 ? weighted / total : 1;
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
 *   "count" — reads countGas…countRadioactive (deposit-slot counts)
 *   "qual"  — reads qualGas…qualRadioactive (quality-band values)
 *   "yield" — reads yieldGas…yieldRadioactive (yield multipliers)
 *   "eff"   — reads effGas…effRadioactive (extraction-efficiency multipliers)
 *
 * Missing columns default to 0 for all prefixes EXCEPT "yield" and "eff", where the schema
 * default is @default(1) and an absent multiplier means a neutral ×1.
 */
export function resourceVectorFromColumns(
  source: Record<string, number>,
  prefix: "count" | "qual" | "yield" | "eff",
): ResourceVector {
  const fallback = prefix === "yield" || prefix === "eff" ? 1 : 0;
  const v = emptyResourceVector();
  for (const type of RESOURCE_TYPES) {
    const key = `${prefix}${type.charAt(0).toUpperCase()}${type.slice(1)}`;
    v[type] = source[key] ?? fallback;
  }
  return v;
}

/**
 * Read a row's deposit-slot columns as a ResourceVector — the extractor-slot cap per resource.
 *
 * These four readers are the only supported way to get a vector off a row's columns. Writing the
 * column bag out by hand at the call site is how a resource type added to `RESOURCE_TYPES` reads as
 * an empty deposit (or a neutral ×1 yield) forever: the reader iterates the types, so it would pick
 * the new one up, but a hand-written bag never carries its column and nothing errors.
 */
export function depositCountsOf(row: CountColumns): ResourceVector {
  return resourceVectorFromColumns(row, "count");
}

/** Read a row's quality-band columns as a ResourceVector. */
export function qualityOf(row: QualColumns): ResourceVector {
  return resourceVectorFromColumns(row, "qual");
}

/** Read a row's per-resource yield-multiplier columns as a ResourceVector. */
export function yieldsOf(row: YieldColumns): ResourceVector {
  return resourceVectorFromColumns(row, "yield");
}

/** Read a row's per-resource extraction-efficiency columns as a ResourceVector. */
export function effOf(row: EffColumns): ResourceVector {
  return resourceVectorFromColumns(row, "eff");
}

/**
 * Turn a ResourceVector into renderable bars. Bars normalise to the vector's
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
