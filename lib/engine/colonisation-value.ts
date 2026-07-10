/**
 * Pure colony valuation — the expand-vs-build ROI numerator
 * (docs/planned/economy-colonisation-cost.md §3). Zero I/O.
 *
 * A colony's value sits on the same demand-rate axis as a build's served deficit, so the planner
 * can rank "establish this colony" against "build this factory" on one pool:
 *
 *   Value(c) = U(c) + L(c) · (σ_floor + (1 − σ_floor) · σ)
 *
 * - U(c) — unblocking value: unmet demand the colony's deposits unblock, traced down each blocked
 *   good's recipe chain to the missing deposits that gate it (split fractionally across a good's
 *   gating missing deposits). Coefficient-free — already in demand-rate units.
 * - L(c) — land option value: LAND_PREMIUM·habitableSpace + small general-space + deposit-richness
 *   weights. Forward-looking; independent of any current deficit.
 * - σ — faction territory saturation in [0,1]: built housing pop-cap ÷ habitable-potential pop-cap.
 */
import type { ResourceType, ResourceVector } from "@/lib/types/game";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { GOOD_NAMES } from "@/lib/constants/goods";
import { RESOURCE_TYPES } from "@/lib/engine/resources";
import { housingPopCap } from "@/lib/engine/industry";
import {
  BUILDING_TYPES,
  HOUSING_TYPE,
  POP_CENTRE_DENSITY,
  effectiveSpaceCost,
} from "@/lib/constants/industry";
import { clamp } from "@/lib/utils/math";

/**
 * good id → the tier-0 deposit resources it transitively needs. A tier-0 good's closure is its own
 * single resource (`BUILDING_TYPES[good].resource`); a tier-1+ good's is the union of its recipe
 * inputs' closures. Derived once from the (acyclic) recipe graph, so runtime scoring stays cheap.
 */
export const RESOURCE_CLOSURE: Readonly<Record<string, readonly ResourceType[]>> = (() => {
  const memo = new Map<string, ReadonlySet<ResourceType>>();
  const resolve = (goodId: string): ReadonlySet<ResourceType> => {
    const cached = memo.get(goodId);
    if (cached) return cached;
    const out = new Set<ResourceType>();
    const recipe = GOOD_RECIPES[goodId];
    if (recipe) {
      for (const input of Object.keys(recipe)) for (const r of resolve(input)) out.add(r);
    } else {
      const resource = BUILDING_TYPES[goodId]?.resource;
      if (resource) out.add(resource);
    }
    memo.set(goodId, out);
    return out;
  };
  const result: Record<string, readonly ResourceType[]> = {};
  for (const good of GOOD_NAMES) result[good] = [...resolve(good)];
  return result;
})();

/** A developed system's state needed for the faction-level aggregates (σ, missing resources). */
export interface FactionSystemState {
  buildings: Record<string, number>;
  habitableSpace: number;
  slotCap: ResourceVector;
}

/**
 * Resources the faction has NO deposit slots for across its developed systems — the binary
 * "can't make it at all" set. A colony supplying one of these unblocks the goods that need it.
 */
export function factionMissingResources(developed: FactionSystemState[]): Set<ResourceType> {
  const missing = new Set<ResourceType>(RESOURCE_TYPES);
  for (const s of developed) {
    for (const r of RESOURCE_TYPES) if (s.slotCap[r] > 0) missing.delete(r);
  }
  return missing;
}

/**
 * Faction territory saturation σ ∈ [0,1]: built housing pop-cap ÷ habitable-potential pop-cap
 * across developed systems. Low when there is lots of unbuilt habitable land; 1 when built out.
 * Zero potential (no habitable land) reads as fully saturated (1) — there is no room to fill.
 */
export function factionSaturation(developed: FactionSystemState[]): number {
  const housingCost = effectiveSpaceCost(HOUSING_TYPE);
  let built = 0;
  let potential = 0;
  for (const s of developed) {
    built += housingPopCap(s.buildings);
    if (housingCost > 0) {
      potential += (Math.max(0, s.habitableSpace) / housingCost) * POP_CENTRE_DENSITY;
    }
  }
  if (potential <= 0) return 1;
  return clamp(built / potential, 0, 1);
}
