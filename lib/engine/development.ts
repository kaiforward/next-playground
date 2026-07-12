/**
 * Per-system development stat — a pure 0..1 magnitude of how far a system has
 * grown toward its own physical potential. Zero I/O.
 * See docs/planned/economy-colony-bootstrapping.md §7.7b.
 *
 * development = w_pop · popFill + w_ind · industryFill
 *
 * Both terms measure what is USED against the system's geography-fixed ceiling
 * (used ÷ potential), NOT what is built ÷ potential:
 *  - popFill: population (housing in use) ÷ habitable-potential pop.
 *  - industryFill: STAFFED industry capacity ÷ total industry potential — so a
 *    colony that over-builds extractors its population cannot staff reads low
 *    (idle capacity is not development), and one that fills its slots and staffs
 *    them reads high.
 *
 * Housing is excluded from both terms (population, not built housing, drives
 * popFill; housing is not industry), so shells built ahead of population never
 * inflate the reading. Each term is dropped and the blend renormalised when its
 * potential is zero (a barren world reads on industry alone; a spaceless one on
 * population alone), guarding against 0/0.
 */
import type { ResourceVector } from "@/lib/types/game";
import { DEVELOPMENT } from "@/lib/constants/development";
import { HOUSING_TYPE, POP_CENTRE_DENSITY, effectiveSpaceCost, BUILDING_TYPES } from "@/lib/constants/industry";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";
import { RESOURCE_TYPES } from "@/lib/engine/resources";
import { generalSpaceUsed, labourDemand, labourFulfillment } from "@/lib/engine/industry";
import { clamp } from "@/lib/utils/math";

/** The physical + built inputs `systemDevelopment` reads (a structural subset of a build/world system). */
export interface DevelopmentInput {
  /** Built building levels by type (production, extractors, academies, complexes, housing). */
  buildings: Record<string, number>;
  /** Resident population — the "used" housing that drives popFill and staffs industry. */
  population: number;
  /** Per-resource deposit-slot cap — the extraction potential. */
  slotCap: ResourceVector;
  /** Fungible general space — the tier-1+ factory potential (shared with housing). */
  generalSpace: number;
  /** Habitable subset of space — the population ceiling. */
  habitableSpace: number;
}

/** Geography-fixed population ceiling: habitable land ÷ housing footprint × pop density. */
function habitablePotentialPop(habitableSpace: number): number {
  const cost = effectiveSpaceCost(HOUSING_TYPE);
  if (cost <= 0) return 0;
  return (Math.max(0, habitableSpace) / cost) * POP_CENTRE_DENSITY;
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
 * Per-system development in [0,1]. See file header for the formula. `population`
 * and each `slotCap` component are read as magnitudes; non-finite / negative
 * inputs are clamped away so the result is always a finite [0,1].
 */
export function systemDevelopment(input: DevelopmentInput): number {
  const { buildings, population, slotCap, generalSpace, habitableSpace } = input;

  // ── Population term: people (used housing) against the habitable ceiling. ──
  const potentialPop = habitablePotentialPop(habitableSpace);
  const popFill = clamp(Math.max(0, population) / potentialPop, 0, 1); // potentialPop 0 → Infinity/NaN, dropped below

  // ── Industry term: staffed capacity against total industry potential. ──
  // Extraction sits on deposit slots; factories/academies/complexes on general space. Both are
  // converted to commensurate space units so they pool into one fill fraction. Housing is netted
  // out of the built factory land (it is not industry) but still consumes general potential.
  const footprint = SUBSTRATE_GEN.DEPOSIT_SLOT_FOOTPRINT;
  let slotTotal = 0;
  for (const r of RESOURCE_TYPES) slotTotal += Math.max(0, slotCap[r]);
  const extractionPotential = slotTotal * footprint;
  const extractionBuilt = extractorLevels(buildings) * footprint;

  const housingSpace = (buildings[HOUSING_TYPE] ?? 0) * effectiveSpaceCost(HOUSING_TYPE);
  const factoryPotential = Math.max(0, generalSpace);
  const factoryBuilt = Math.max(0, generalSpaceUsed(buildings) - housingSpace);

  const industryPotential = extractionPotential + factoryPotential;
  // Staffing discount: the resident population's headcount fulfilment of the whole labour draw.
  // Idle-because-understaffed capacity is not counted as development (used, not built).
  const staffing = labourFulfillment(population, labourDemand(buildings));
  const industryUsed = (extractionBuilt + factoryBuilt) * staffing;
  const industryFill = clamp(industryUsed / industryPotential, 0, 1); // 0 potential → NaN, dropped below

  // ── Blend, dropping (and renormalising) any term whose potential is zero. ──
  let weighted = 0;
  let weight = 0;
  if (potentialPop > 0) {
    weighted += DEVELOPMENT.POP_WEIGHT * popFill;
    weight += DEVELOPMENT.POP_WEIGHT;
  }
  if (industryPotential > 0) {
    weighted += DEVELOPMENT.INDUSTRY_WEIGHT * industryFill;
    weight += DEVELOPMENT.INDUSTRY_WEIGHT;
  }
  return weight > 0 ? weighted / weight : 0;
}
