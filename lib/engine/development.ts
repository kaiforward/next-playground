/**
 * Per-system development stat — a pure 0..1 magnitude of how much a system has actually built and
 * worked, measured against the galaxy's biggest natural potential. Zero I/O. See
 * docs/build-plans/colony-bootstrapping.md §1.
 *
 * development = w_pop · popTerm + w_ind · indTerm
 *
 * Both terms are ABSOLUTE magnitudes soft-saturated against a UNIVERSE-WIDE reference — the largest
 * natural potential any single system in the galaxy has — NOT fill fractions of the system's own
 * potential:
 *  - popTerm = 1 − exp(−population / popRef)          — resident population vs the biggest habitable
 *    land in the galaxy (`popRef` = max system's `habitablePotentialPop`).
 *  - indTerm = 1 − exp(−staffedIndustry / industryRef) — STAFFED industry vs the biggest industrial
 *    footprint in the galaxy (`industryRef` = max system's `industryPotential`).
 *
 * Measuring against the universe-wide ceiling (not the system's own capacity) is the point: a system
 * that is "full" for its OWN size still has almost nothing measured against the galaxy's biggest world,
 * so most systems read near the bottom of the board even at max housing — realising your own potential
 * is not high development, only realising the universe's max potential is. That top is reserved: even
 * the biggest natural system, fully built, sits at the soft-saturation knee (~0.63 per term), never at
 * 1 — reaching the top means exceeding natural potential (later: robots + special housing), and that is
 * meant to take a long time. Soft-saturation is most sensitive at the low end (where colonies live, so
 * it discriminates among them) and compresses the top.
 *
 * Industry counts what is STAFFED, not merely built (idle-because-understaffed capacity is not
 * development), and housing is excluded (population, not built housing, drives popTerm; housing is
 * not industry), so shells built ahead of population never inflate the reading. A barren system (no
 * habitable land) cannot hold population, so its pop term is dropped and industry carries the whole
 * reading.
 */
import { DEVELOPMENT } from "@/lib/constants/development";
import { HOUSING_TYPE, POP_CENTRE_DENSITY, effectiveSpaceCost, BUILDING_TYPES } from "@/lib/constants/industry";
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

/**
 * The universe-wide reference maxima `systemDevelopment` soft-saturates against — the largest natural
 * potential any single system in the galaxy has. Derived once from static substrate (via
 * `developmentRefs`), so it never changes during play; both the dev-map and the build planner pass the
 * same values so a system reads one development everywhere.
 */
export interface DevelopmentRefs {
  /** Max `habitablePotentialPop` across the galaxy — the popTerm reference. */
  popRef: number;
  /** Max `industryPotential` across the galaxy — the indTerm reference. */
  industryRef: number;
}

/** The static substrate a system contributes to the universe-wide reference maxima. */
export interface DevelopmentRefSystem {
  /** Habitable land — drives the system's pop potential. */
  habitableSpace: number;
  /** Fungible general space — factory land (and, netted, housing land). */
  generalSpace: number;
  /** Total worked-able deposit slots across all resources (Σ slot caps). */
  depositSlots: number;
}

/** Soft-saturation of an absolute magnitude against a reference → [0,1). 0 at 0, ≈0.63 at ref. */
function softSaturate(value: number, ref: number): number {
  if (ref <= 0) return 0;
  return 1 - Math.exp(-Math.max(0, value) / ref);
}

/**
 * The population a system's habitable land could ever house — its habitable space packed with housing
 * at full occupancy. The absolute pop ceiling the universe-wide `popRef` is a max over.
 */
export function habitablePotentialPop(habitableSpace: number): number {
  const per = effectiveSpaceCost(HOUSING_TYPE);
  if (per <= 0) return 0;
  return (Math.max(0, habitableSpace) / per) * POP_CENTRE_DENSITY;
}

/**
 * The staffed-industry footprint a system could ever host — every deposit slot worked plus all general
 * space given to factories, in the same space units `systemDevelopment` measures `staffedIndustry` in.
 * The absolute industry ceiling the universe-wide `industryRef` is a max over.
 */
export function industryPotential(depositSlots: number, generalSpace: number): number {
  return Math.max(0, depositSlots) * SUBSTRATE_GEN.DEPOSIT_SLOT_FOOTPRINT + Math.max(0, generalSpace);
}

/**
 * Reduce the whole galaxy to its biggest pop and industry potential — the shared reference every
 * `systemDevelopment` call soft-saturates against. Pure over static substrate, so callers compute it
 * once (per map read / per build pulse) from the full system set. An empty galaxy yields zero refs, and
 * `softSaturate` reads 0 against a zero ref.
 */
export function developmentRefs(systems: DevelopmentRefSystem[]): DevelopmentRefs {
  let popRef = 0;
  let industryRef = 0;
  for (const s of systems) {
    popRef = Math.max(popRef, habitablePotentialPop(s.habitableSpace));
    industryRef = Math.max(industryRef, industryPotential(s.depositSlots, s.generalSpace));
  }
  return { popRef, industryRef };
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
 * (population, staffed industry capacity) and soft-saturated against the universe-wide `refs`;
 * non-finite / negative inputs are clamped away so the result is always a finite [0,1).
 */
export function systemDevelopment(input: DevelopmentInput, refs: DevelopmentRefs): number {
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
  const indTerm = softSaturate(staffedIndustry, refs.industryRef);

  // Barren: no habitable land ⇒ no population possible ⇒ industry is the whole reading.
  if (habitableSpace <= 0) return indTerm;

  const popTerm = softSaturate(population, refs.popRef);
  return DEVELOPMENT.POP_WEIGHT * popTerm + DEVELOPMENT.INDUSTRY_WEIGHT * indTerm;
}
