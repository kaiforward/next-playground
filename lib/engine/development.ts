/**
 * Per-system development stat — a pure 0..1 magnitude of how much a system has actually built and
 * worked. Zero I/O. See docs/planned/economy-colony-bootstrapping.md §7.7b.
 *
 * development = w_pop · popTerm + w_ind · indTerm
 *
 * Both terms are ABSOLUTE magnitudes soft-saturated against a FIXED reference (Victoria-3
 * economy-of-scale / EU4 development style), NOT fill fractions of the system's own potential:
 *  - popTerm = 1 − exp(−population / POP_REF)         — the resident population (used housing).
 *  - indTerm = 1 − exp(−staffedIndustry / INDUSTRY_REF) — STAFFED industry capacity.
 *
 * Measuring against a fixed reference (not the system's own capacity) is the point: a tiny colony
 * that is "full" for its size still has almost nothing in absolute terms, so it reads low and is
 * prioritised for investment; a large capital reads high regardless of how much headroom it has.
 * Soft-saturation is most sensitive at the low end (where colonies live, so it discriminates among
 * them) and compresses the top (capitals sit high but never trivially at 1).
 *
 * Industry counts what is STAFFED, not merely built (idle-because-understaffed capacity is not
 * development), and housing is excluded (population, not built housing, drives popTerm; housing is
 * not industry), so shells built ahead of population never inflate the reading. A barren system (no
 * habitable land) cannot hold population, so its pop term is dropped and industry carries the whole
 * reading.
 */
import { DEVELOPMENT } from "@/lib/constants/development";
import { HOUSING_TYPE, effectiveSpaceCost, BUILDING_TYPES } from "@/lib/constants/industry";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";
import { generalSpaceUsed, labourDemand, labourFulfillment } from "@/lib/engine/industry";

/** The built + physical inputs `systemDevelopment` reads (a structural subset of a build/world system). */
export interface DevelopmentInput {
  /** Built building levels by type (production, extractors, academies, complexes, housing). */
  buildings: Record<string, number>;
  /** Resident population — the "used" housing that drives popTerm and staffs industry. */
  population: number;
  /** Habitable land — a system with none cannot hold population (the pop term is dropped). */
  habitableSpace: number;
}

/** Soft-saturation of an absolute magnitude against a fixed reference → [0,1). 0 at 0, ≈0.63 at ref. */
function softSaturate(value: number, ref: number): number {
  if (ref <= 0) return 0;
  return 1 - Math.exp(-Math.max(0, value) / ref);
}

/** Built tier-0 extractor levels (worked deposit slots) across all resources. */
function extractorLevels(buildings: Record<string, number>): number {
  let count = 0;
  for (const [type, n] of Object.entries(buildings)) {
    if (n > 0 && BUILDING_TYPES[type]?.resource) count += n;
  }
  return count;
}

/**
 * Per-system development in [0,1]. See file header for the formula. Absolute magnitudes are read
 * (population, staffed industry capacity) and soft-saturated against fixed references; non-finite /
 * negative inputs are clamped away so the result is always a finite [0,1).
 */
export function systemDevelopment(input: DevelopmentInput): number {
  const { buildings, population, habitableSpace } = input;

  // Staffed industry (absolute): extraction sits on deposit slots, factories/academies/complexes on
  // general space; both converted to commensurate space units. Housing is netted out (it is not
  // industry). The whole built base is discounted by headcount staffing — idle-because-understaffed
  // capacity is not counted as development (used, not built).
  const extraction = extractorLevels(buildings) * SUBSTRATE_GEN.DEPOSIT_SLOT_FOOTPRINT;
  const housingSpace = (buildings[HOUSING_TYPE] ?? 0) * effectiveSpaceCost(HOUSING_TYPE);
  const factory = Math.max(0, generalSpaceUsed(buildings) - housingSpace);
  const staffing = labourFulfillment(population, labourDemand(buildings));
  const staffedIndustry = (extraction + factory) * staffing;
  const indTerm = softSaturate(staffedIndustry, DEVELOPMENT.INDUSTRY_REF);

  // Barren: no habitable land ⇒ no population possible ⇒ industry is the whole reading.
  if (habitableSpace <= 0) return indTerm;

  const popTerm = softSaturate(population, DEVELOPMENT.POP_REF);
  return DEVELOPMENT.POP_WEIGHT * popTerm + DEVELOPMENT.INDUSTRY_WEIGHT * indTerm;
}
