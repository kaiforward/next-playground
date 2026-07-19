import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import { computePopNeeds } from "@/lib/engine/pop-needs";
import { marketsBySystem } from "@/lib/services/world-index";
import { GOODS } from "@/lib/constants/goods";
import type { PopNeedData } from "@/lib/types/api";

/**
 * Pressure-sorted pop needs for one system, goodName-resolved for the client —
 * the shared read behind the Population tab's needs ledger and the Industry
 * readout's `popNeeds` (strip chip + per-row pop-short markers).
 */
export function systemPopNeeds(
  systemId: string,
  buildings: Record<string, number>,
  population: number,
): PopNeedData[] {
  const basis = computeSystemLabourSnapshot(buildings, population).basis;
  return computePopNeeds(basis, marketsBySystem().get(systemId) ?? []).map((n) => ({
    ...n,
    goodName: GOODS[n.goodId]?.name ?? n.goodId,
  }));
}
