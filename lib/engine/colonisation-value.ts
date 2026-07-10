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
import type { ResourceType } from "@/lib/types/game";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { GOOD_NAMES } from "@/lib/constants/goods";
import { BUILDING_TYPES } from "@/lib/constants/industry";

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
