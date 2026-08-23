/**
 * Pure per-type build feasibility for ONE system — the single computation behind the player's
 * quick-add states, the new-industry dialog readout, and the order services' validation.
 *
 * Hard ceilings only (space, deposit slots): a zero `maxLevels` carries its `blocked` reason. The
 * labour picture is DATA, never a block — `labourAdded` + `estStaffing` feed the warning surface;
 * the player may overbuild what their pops can staff and staffing dilution + idle-decay punish it.
 */
import type { ResourceVector } from "@/lib/types/game";
import type { WorldSystem } from "@/lib/world/types";
import {
  BUILDING_TYPES, HOUSING_TYPE, effectiveSpaceCost,
} from "@/lib/constants/industry";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { workCostPerLevel } from "@/lib/constants/construction";
import { extractorsOnResource } from "@/lib/engine/directed-build";
import { industryLandUsed, labourParts, labourStateFromParts } from "@/lib/engine/industry";
import { slotCapOf } from "@/lib/engine/resources";

export interface BuildOptionSystem {
  population: number;
  buildings: Record<string, number>;
  slotCap: ResourceVector;
  generalSpace: number;
  habitableSpace: number;
}

/**
 * The one adapter from a world system row to this function's input. Both the planner read and the
 * order verbs go through it, so the ceilings the UI quotes and the ceilings the mutation enforces
 * cannot be assembled from different fields. `buildings` is passed in because its owner is the
 * shared per-version index, not the system row.
 */
export function buildSiteFromSystem(
  system: WorldSystem,
  buildings: Record<string, number>,
): BuildOptionSystem {
  return {
    population: system.population,
    buildings,
    slotCap: slotCapOf(system),
    generalSpace: system.generalSpace,
    habitableSpace: system.habitableSpace,
  };
}

export type BuildOptionBlockReason = "no_space" | "no_deposit_slots";

export interface BuildOption {
  buildingType: string;
  /** Whole levels physically addable now, net of built + committed (in-flight) levels. */
  maxLevels: number;
  /** Non-null = hard-blocked (maxLevels 0). */
  blocked: BuildOptionBlockReason | null;
  workPerLevel: number;
  /** Heads one level adds, by grade. */
  labourAdded: { unskilled: number; skill1: number; skill2: number };
  /** Estimated staffing once one more level lands (min over drawn grades, on built + committed + 1);
   *  1 for types that draw no labour. */
  estStaffing: number;
}

/** Buildings + committed folded into one effective count map (what the world will hold once the queue lands). */
function effectiveCounts(buildings: Record<string, number>, committed: Record<string, number>): Record<string, number> {
  const out = { ...buildings };
  for (const [type, levels] of Object.entries(committed)) {
    if (levels > 0) out[type] = (out[type] ?? 0) + levels;
  }
  return out;
}

export function computeBuildOptions(
  sys: BuildOptionSystem,
  committed: Record<string, number>,
): BuildOption[] {
  const effective = effectiveCounts(sys.buildings, committed);
  const remainingIndustry = sys.generalSpace - industryLandUsed(effective);

  return Object.keys(BUILDING_TYPES).map((buildingType) => {
    const def = BUILDING_TYPES[buildingType];
    const labour = def.labour ?? { unskilled: 0, skill1: 0, skill2: 0 };
    const isExtractor = GOOD_TIER_BY_KEY[buildingType] === 0 && def.resource !== undefined;

    let maxLevels: number;
    let blocked: BuildOptionBlockReason | null = null;
    if (isExtractor && def.resource !== undefined) {
      const remaining = sys.slotCap[def.resource] - extractorsOnResource(effective, def.resource);
      maxLevels = Math.max(0, Math.floor(remaining));
      if (maxLevels === 0) blocked = "no_deposit_slots";
    } else {
      const cost = effectiveSpaceCost(buildingType);
      // Housing bills to people land ALONE; every other type bills to industry land alone — the
      // two budgets are disjoint and never bound each other (the build rule's separation).
      let space: number;
      if (buildingType === HOUSING_TYPE) {
        const housingUsed = (effective[HOUSING_TYPE] ?? 0) * cost;
        space = sys.habitableSpace - housingUsed;
      } else {
        space = remainingIndustry;
      }
      maxLevels = cost > 0 ? Math.max(0, Math.floor(space / cost)) : 0;
      if (maxLevels === 0) blocked = "no_space";
    }

    // Staffing estimate for the level being considered: the system once the queue + this level land.
    const drawsLabour = labour.unskilled > 0 || labour.skill1 > 0 || labour.skill2 > 0;
    let estStaffing = 1;
    if (drawsLabour) {
      const next = { ...effective, [buildingType]: (effective[buildingType] ?? 0) + 1 };
      const state = labourStateFromParts(labourParts(next), sys.population);
      estStaffing = Math.min(
        state.labourFulfil,
        labour.skill1 > 0 ? state.skill1Fulfil : 1,
        labour.skill2 > 0 ? state.skill2Fulfil : 1,
      );
    }

    return {
      buildingType,
      maxLevels,
      blocked: maxLevels === 0 ? blocked : null,
      workPerLevel: workCostPerLevel(buildingType),
      labourAdded: { unskilled: labour.unskilled, skill1: labour.skill1, skill2: labour.skill2 },
      estStaffing,
    };
  });
}
