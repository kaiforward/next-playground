import { getWorld } from "@/lib/world/store";
import { buildingsBySystem } from "@/lib/services/world-index";
import { ServiceError } from "@/lib/services/errors";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import { demandFootprint } from "@/lib/constants/market-economy";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import { consumptionBreakdown } from "@/lib/engine/physical-economy";
import { isEconomicallyActive } from "@/lib/engine/control";
import { GOODS } from "@/lib/constants/goods";
import type { SystemPopulationData } from "@/lib/types/api";

/**
 * Dynamic population & social state for one system — population, popCap, unrest,
 * a strike flag, and the demand footprint. Unlike the substrate read, these
 * fields change every economy tick, so the hook (`useSystemPopulation`) is
 * tick-invalidated.
 */
export function getSystemPopulation(systemId: string): SystemPopulationData {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError("System not found.", 404);
  if (!isEconomicallyActive(system.control)) return { visibility: "unknown" };

  const buildings: Record<string, number> = buildingsBySystem().get(systemId) ?? {};
  const basis = computeSystemLabourSnapshot(buildings, system.population).basis;

  // Full consumption footprint (already filtered to consumed goods, demand-sorted).
  const demand = demandFootprint(basis).map((e) => ({
    goodId: e.goodId,
    goodName: GOODS[e.goodId]?.name ?? e.goodId,
    demandRate: e.civilianDemandRate,
    breakdown: consumptionBreakdown(e.goodId, basis),
  }));

  return {
    visibility: "visible",
    population: system.population,
    popCap: system.popCap,
    unrest: system.unrest,
    striking: system.unrest >= STRIKE_PARAMS.threshold,
    demand,
  };
}
