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
import {
  HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE,
  HEAVY_INDUSTRY_COMPLEX, CHEMICALS_COMPLEX, ELECTRONICS_COMPLEX, ARMAMENTS_COMPLEX, CONSUMER_COMPLEX,
} from "@/lib/constants/industry";

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
  [HEAVY_INDUSTRY_COMPLEX]:
    "Heavy Industry Complex — an integrated metallurgical anchor. Grants a system-wide yield bonus to the whole heavy chain (metals, alloys, hull plating, components, machinery, ship frames). One complex per system; its large footprint crowds out breadth, so the world specialises and imports the rest. Decays toward the family output it actually buffs.",
  [CHEMICALS_COMPLEX]:
    "Chemical Combine — refineries, reactors, and process plant. Grants a system-wide yield bonus to fuel, chemicals, polymers, and medicine. One complex per system; a large footprint that forces specialisation. Decays toward the chemical output it buffs.",
  [ELECTRONICS_COMPLEX]:
    "Electronics Complex — fabs and clean-room assembly. Grants a system-wide yield bonus to electronics and targeting arrays. One complex per system; a large footprint that forces specialisation. Decays toward the electronics output it buffs.",
  [ARMAMENTS_COMPLEX]:
    "Armaments Complex — ordnance works and weapon-systems integration. Grants a system-wide yield bonus to munitions, weapons, weapons systems, and reactor cores. One complex per system; a large footprint that forces specialisation. Decays toward the armaments output it buffs.",
  [CONSUMER_COMPLEX]:
    "Consumer Works — light manufacturing and finishing. Grants a system-wide yield bonus to consumer goods and luxuries. One complex per system; a large footprint that forces specialisation. Decays toward the consumer output it buffs.",
};

/** "What it does" for a building type: bespoke copy, else the produced good's description, else "". */
export function describeBuilding(type: string): string {
  return BUILDING_DESCRIPTIONS[type] ?? GOODS[type]?.description ?? "";
}
