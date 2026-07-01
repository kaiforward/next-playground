/**
 * "What it does" copy for the Industry panel tooltips + tier role labels. Pure data.
 *
 * Production buildings map 1:1 to a good, so their copy is the good's own description
 * (GOODS[id].description) — `describeBuilding` falls back to it rather than duplicating
 * 26 strings here. Only the three non-good buildings (housing + the two academies, the
 * least self-explanatory) carry bespoke role copy.
 */
import type { GoodTier } from "@/lib/types/game";
import { GOODS } from "@/lib/constants/goods";
import { HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE } from "@/lib/constants/industry";

/** Role label per good tier — the building's manufacturing class. */
export const TIER_LABELS: Record<GoodTier, string> = {
  0: "Extraction",
  1: "Basic manufacturing",
  2: "Advanced manufacturing",
};

/** Bespoke copy for the buildings that are not a produced good. */
export const BUILDING_DESCRIPTIONS: Record<string, string> = {
  [HOUSING_TYPE]:
    "Population centres — homes, services, and civic infrastructure. Raise the population ceiling; every resident is a potential worker. Decay toward their occupants: housing left empty is shed, housing overfilled displaces its overflow as migration.",
  [VOCATIONAL_SCHOOL_TYPE]:
    "Vocational school — trains residents for technician-grade (skill-1) work. Licenses a system-wide ceiling on how much basic manufacturing can be staffed; without one, no processed goods can be made here. Draws unskilled labour to run, and decays toward the technician demand it actually serves.",
  [RESEARCH_INSTITUTE_TYPE]:
    "Research institute — certifies residents for engineer-grade (skill-2) work. Licenses a system-wide ceiling on advanced manufacturing; without one, no advanced goods can be made here. Draws unskilled labour to run, and decays toward the engineer demand it actually serves.",
};

/** "What it does" for a building type: bespoke copy, else the produced good's description, else "". */
export function describeBuilding(type: string): string {
  return BUILDING_DESCRIPTIONS[type] ?? GOODS[type]?.description ?? "";
}
