/**
 * Home-system prefab — the self-sufficient industrial base a faction capital starts with.
 *
 * A faction homeworld is not seeded by the fractional substrate allocator (whose scale-down + whole-level
 * floor wiped small manufacturing counts, leaving the galaxy extraction-only). Instead it is stamped with
 * this deterministic prefab: whole-integer building counts sized so local production meets its residents'
 * full civilian consumption — the per-capita baseline plus the technician/engineer skilled baskets — plus
 * the recipe draw of its own factories: a real tier-0 → tier-2 economy, computed from the economy
 * constants (no per-system rounding, no guessing). Civilian demand is population-proportional, so one
 * prefab serves every government.
 *
 * Counts are ECONOMY_SCALE-invariant: OUTPUT_PER_UNIT and GOOD_CONSUMPTION carry the same scale factor,
 * so the production ≥ consumption balance holds at any scale. The prefab is stamped onto a guaranteed
 * garden body sized to fit it (see world-gen), so nothing is ever floored or scaled down.
 */
import { GOOD_PRODUCTION } from "@/lib/constants/physical-economy";
import {
  OUTPUT_PER_UNIT,
  POP_CENTRE_DENSITY,
  HOUSING_TYPE,
  VOCATIONAL_SCHOOL_TYPE,
  RESEARCH_INSTITUTE_TYPE,
  SKILL1_PER_SCHOOL,
  SKILL2_PER_INSTITUTE,
  effectiveSpaceCost,
} from "@/lib/constants/industry";
import { GOOD_RECIPES, PRODUCTION_GOOD_ORDER } from "@/lib/constants/recipes";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { labourDemand, skill1Demand, skill2Demand } from "@/lib/engine/industry";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { RESOURCE_TYPES, emptyResourceVector } from "@/lib/engine/resources";
import type { GeneratedBody } from "@/lib/engine/body-gen";

/** Resident population of a faction capital — a large established core (~5 B people at 1 pop = 1 M). */
export const HOME_SYSTEM_POP = 5000;

/** Civilian tier-2 goods the capital manufactures. Military tier-2 is left to the war system. */
const COVERED_TIER2 = new Set(["electronics", "machinery", "luxuries"]);

/**
 * Whether the capital manufactures a good: every tier-0 and tier-1 good, plus the civilian tier-2 goods.
 * Everything else (military tier-2) is deliberately imported — the war system's concern, not the prefab's.
 */
export function isCovered(goodId: string): boolean {
  return (GOOD_TIER_BY_KEY[goodId] ?? 0) <= 1 || COVERED_TIER2.has(goodId);
}

/**
 * Whole-integer building counts for a capital of `pop` residents. Each covered good is sized to meet its
 * full civilian consumption — the per-capita baseline PLUS the skilled-worker baskets that technicians and
 * engineers consume on top of it (the exact live `consumptionRate`) — plus the recipe draw of its
 * downstream producers (walked in reverse topological order so a producer's input demand is counted before
 * its inputs are sized), academies to license the skilled work the factories draw, and housing to hold the
 * population.
 *
 * The skilled baskets depend on the technician/engineer headcount, which itself depends on the buildings
 * being sized, so the sizing iterates to a fixed point. It converges in a few passes because the basket
 * draw per skilled head is tiny relative to the base demand. A fully-staffed capital works exactly its
 * licensed skilled demand (academies license it, housing covers it), so technicians = `skill1Demand` and
 * engineers = `skill2Demand` of the base being built.
 */
export function computeHomeworldBuildings(pop: number): Record<string, number> {
  let buildings: Record<string, number> = {};
  let technicians = 0;
  let engineers = 0;
  for (let pass = 0; pass < 8; pass++) {
    const next = sizeCapitalBuildings(pop, technicians, engineers);
    if (sameBuildings(next, buildings)) break;
    buildings = next;
    technicians = skill1Demand(buildings);
    engineers = skill2Demand(buildings);
  }
  return buildings;
}

/**
 * One sizing pass for the given skilled headcount: size every covered good to its baseline + basket +
 * recipe demand, add academies to license the skilled draw, then housing to hold the residents and staff
 * the base. `technicians`/`engineers` carry the skilled-basket demand from the previous fixed-point pass.
 */
function sizeCapitalBuildings(
  pop: number,
  technicians: number,
  engineers: number,
): Record<string, number> {
  const basis = { population: pop, technicians, engineers };
  const demand: Record<string, number> = {};
  for (const g of Object.keys(OUTPUT_PER_UNIT)) {
    demand[g] = consumptionRate(g, basis);
  }

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

/** Whole-count equality over two building maps — the fixed-point convergence check. */
function sameBuildings(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

/** The stamp every faction capital receives: the baseline building counts + resident population. */
export const HOME_SYSTEM_PREFAB: { buildings: Record<string, number>; population: number } = {
  buildings: computeHomeworldBuildings(HOME_SYSTEM_POP),
  population: HOME_SYSTEM_POP,
};

/** Headroom factor over the prefab's exact footprint — the capital always fits with room to grow into. */
const GARDEN_MARGIN = 1.5;
/** Deposit quality of the capital's garden world — a good, all-round field. */
const GARDEN_QUALITY = 1.3;
/** Display flavour only — the garden body's authored budgets, not its cosmetic size, are what fit the prefab. */
const GARDEN_DISPLAY_SIZE = 1.0;

/**
 * The guaranteed garden world a faction capital sits on: one deterministic body authoring people
 * land and a spread of deposit counts all sized `GARDEN_MARGIN`× the prefab's exact footprint, so
 * the whole prefab (housing + extractors) always fits with headroom — no flooring, ever. Factories
 * and academies bill no land, so only housing and extractors size this body. Prepended to the
 * homeworld's procedural bodies (which stay as varied scenery + extra deposits). Temperate class,
 * score 1.0 — authored directly, never back-solved from buildings.
 */
export function homeworldGardenBody(): GeneratedBody {
  const b = computeHomeworldBuildings(HOME_SYSTEM_POP);
  const counts = emptyResourceVector();
  let housingPeopleLand = 0;
  for (const [type, count] of Object.entries(b)) {
    if (GOOD_TIER_BY_KEY[type] === 0) {
      const r = GOOD_PRODUCTION[type]?.resource; // tier-0 extractors sit on deposit counts for their resource
      if (r) counts[r] += count;
    } else if (type === HOUSING_TYPE) {
      housingPeopleLand += count * effectiveSpaceCost(HOUSING_TYPE); // housing draws people land only
    }
  }
  for (const r of RESOURCE_TYPES) counts[r] = Math.ceil(counts[r] * GARDEN_MARGIN);

  const peopleLand = housingPeopleLand * GARDEN_MARGIN;
  const quality = emptyResourceVector();
  for (const r of RESOURCE_TYPES) if (counts[r] > 0) quality[r] = GARDEN_QUALITY;

  return {
    bodyType: "temperate_world",
    size: GARDEN_DISPLAY_SIZE,
    peopleLand,
    counts,
    quality,
  };
}
