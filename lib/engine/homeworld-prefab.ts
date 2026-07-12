/**
 * Home-system prefab — the identical, self-sufficient industrial base every faction capital starts with.
 *
 * A faction homeworld is not seeded by the fractional substrate allocator (whose scale-down + whole-level
 * floor wiped small manufacturing counts, leaving the galaxy extraction-only). Instead it is stamped with
 * this deterministic prefab: whole-integer building counts sized so local production meets the resident
 * population's consumption plus the recipe draw of its own factories — a real tier-0 → tier-2 economy, the
 * same for every faction, computed once from the economy constants (no per-system rounding, no guessing).
 *
 * Counts are ECONOMY_SCALE-invariant: OUTPUT_PER_UNIT and GOOD_CONSUMPTION carry the same scale factor, so
 * the production ≥ consumption balance holds at any scale. The prefab is stamped onto a guaranteed garden
 * body sized to fit it (see world-gen), so nothing is ever floored or scaled down.
 */
import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";
import {
  OUTPUT_PER_UNIT,
  POP_CENTRE_DENSITY,
  HOUSING_TYPE,
  VOCATIONAL_SCHOOL_TYPE,
  RESEARCH_INSTITUTE_TYPE,
  SKILL1_PER_SCHOOL,
  SKILL2_PER_INSTITUTE,
} from "@/lib/constants/industry";
import { GOOD_RECIPES, PRODUCTION_GOOD_ORDER } from "@/lib/constants/recipes";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { labourDemand, skill1Demand, skill2Demand } from "@/lib/engine/industry";
import { effectiveSpaceCost, HOUSING_TYPE as HOUSING } from "@/lib/constants/industry";
import { GOOD_PRODUCTION } from "@/lib/constants/physical-economy";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";
import { RESOURCE_TYPES, emptyResourceVector } from "@/lib/engine/resources";
import type { GeneratedBody } from "@/lib/engine/body-gen";

/** Resident population of a faction capital — a large established core (~5 B people at 1 pop = 1 M). */
export const HOME_SYSTEM_POP = 5000;

/** Civilian tier-2 goods the capital manufactures. Military tier-2 is left to the war system. */
const COVERED_TIER2 = new Set(["electronics", "machinery", "luxuries"]);

/** The capital produces every tier-0 and tier-1 good, plus the civilian tier-2 goods. */
function isCovered(goodId: string): boolean {
  return (GOOD_TIER_BY_KEY[goodId] ?? 0) <= 1 || COVERED_TIER2.has(goodId);
}

/**
 * Whole-integer building counts for a capital of `pop` residents: each covered good sized to cover its
 * civilian consumption plus the recipe draw of its downstream producers (walked in reverse topological
 * order so a producer's input demand is counted before its inputs are sized), academies to license the
 * skilled work the factories draw, and housing to hold the population.
 */
export function computeHomeworldBuildings(pop: number): Record<string, number> {
  const demand: Record<string, number> = {};
  for (const g of Object.keys(OUTPUT_PER_UNIT)) demand[g] = (GOOD_CONSUMPTION[g] ?? 0) * pop;

  const buildings: Record<string, number> = {};
  for (const g of [...PRODUCTION_GOOD_ORDER].reverse()) {
    if (!isCovered(g)) continue;
    const out = OUTPUT_PER_UNIT[g] ?? 0;
    if (out <= 0) continue;
    const count = Math.max(1, Math.ceil((demand[g] ?? 0) / out)); // whole levels; a covered good is always present
    buildings[g] = count;
    const produced = count * out;
    for (const [input, per] of Object.entries(GOOD_RECIPES[g] ?? {})) {
      demand[input] = (demand[input] ?? 0) + per * produced;
    }
  }

  const schools = Math.ceil(skill1Demand(buildings) / SKILL1_PER_SCHOOL);
  const institutes = Math.ceil(skill2Demand(buildings) / SKILL2_PER_INSTITUTE);
  if (schools > 0) buildings[VOCATIONAL_SCHOOL_TYPE] = schools;
  if (institutes > 0) buildings[RESEARCH_INSTITUTE_TYPE] = institutes;

  // Housing holds the residents and staffs the base — popCap ≥ max(residents, the industry's labour draw).
  const need = Math.max(pop, labourDemand(buildings));
  buildings[HOUSING_TYPE] = Math.ceil(need / POP_CENTRE_DENSITY);
  return buildings;
}

/** The stamp: identical building counts + resident population for every faction capital. */
export const HOME_SYSTEM_PREFAB: { buildings: Record<string, number>; population: number } = {
  buildings: computeHomeworldBuildings(HOME_SYSTEM_POP),
  population: HOME_SYSTEM_POP,
};

/** Headroom factor over the prefab's exact footprint — the capital always fits with room to grow into. */
const GARDEN_MARGIN = 1.5;
/** Deposit quality of the capital's garden world — a good, all-round field. */
const GARDEN_QUALITY = 1.3;

/**
 * The guaranteed garden world every faction capital sits on: one deterministic body with a habitable
 * span, general space, and a spread of deposit slots all sized `GARDEN_MARGIN`× the prefab's footprint,
 * so the whole prefab (housing + factories + extractors) always fits with headroom — no flooring, ever.
 * Prepended to the homeworld's procedural bodies (which stay as varied scenery + extra deposits).
 */
export function homeworldGardenBody(): GeneratedBody {
  const b = HOME_SYSTEM_PREFAB.buildings;
  const slots = emptyResourceVector();
  let housingHabitable = 0;
  let factoryGeneral = 0;
  for (const [type, count] of Object.entries(b)) {
    if (GOOD_TIER_BY_KEY[type] === 0) {
      const r = GOOD_PRODUCTION[type]?.resource; // tier-0 extractors sit on deposit slots for their resource
      if (r) slots[r] += count;
    } else if (type === HOUSING) {
      housingHabitable += count * effectiveSpaceCost(HOUSING); // housing draws habitable space
    } else {
      factoryGeneral += count * effectiveSpaceCost(type); // factories + academies draw general space
    }
  }
  for (const r of RESOURCE_TYPES) slots[r] = Math.ceil(slots[r] * GARDEN_MARGIN);

  const habitableSpace = housingHabitable * GARDEN_MARGIN;
  const generalSpace = (housingHabitable + factoryGeneral) * GARDEN_MARGIN; // habitable ⊆ general
  const quality = emptyResourceVector();
  for (const r of RESOURCE_TYPES) if (slots[r] > 0) quality[r] = GARDEN_QUALITY;

  // Keep availableSpace (SPACE_PER_SIZE × size) consistent with the body's slots + general footprint.
  const slotsFootprint = RESOURCE_TYPES.reduce((s, r) => s + slots[r], 0) * SUBSTRATE_GEN.DEPOSIT_SLOT_FOOTPRINT;
  const size = (slotsFootprint + generalSpace) / SUBSTRATE_GEN.SPACE_PER_SIZE;

  return { bodyType: "garden_world", habitable: true, size, slots, quality, generalSpace, habitableSpace };
}
