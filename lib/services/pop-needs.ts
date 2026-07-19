import { computePopNeeds } from "@/lib/engine/pop-needs";
import { marketsBySystem } from "@/lib/services/world-index";
import { GOODS } from "@/lib/constants/goods";
import type { CivilianDemandBasis } from "@/lib/engine/physical-economy";
import type { PopNeedData } from "@/lib/types/api";

/**
 * Pressure-sorted pop needs for one system, goodName-resolved for the client —
 * the shared read behind the Population tab's needs ledger and the Industry
 * readout's `popNeeds` (strip chip + per-row pop-short markers). Callers pass
 * the demand basis they already hold (a labour snapshot's `basis`, or the
 * industry readout's `labourAllocation`) so the labour pass isn't recomputed.
 */
export function systemPopNeeds(systemId: string, basis: CivilianDemandBasis): PopNeedData[] {
  return computePopNeeds(basis, marketsBySystem().get(systemId) ?? []).map((n) => ({
    ...n,
    goodName: GOODS[n.goodId]?.name ?? n.goodId,
  }));
}
