/**
 * Creation of a system's market rows — the single shape both world-gen and colonisation use.
 *
 * Only a system that is actually inhabited has a market. An unclaimed rock holds no goods: nobody
 * grew the food, nobody shipped it, and nothing there consumes it. World-gen therefore builds rows
 * for its developed systems alone, and a colony gets its rows when it is founded — EMPTY, filled by
 * the endowment its founder sends with the seed population.
 */
import type { GovernmentType, ResourceVector } from "@/lib/types/game";
import type { WorldMarket } from "@/lib/world/types";
import { GOODS } from "@/lib/constants/goods";
import { getInitialStock, civilianDemandRateForGood } from "@/lib/constants/market-economy";
import { computeSystemLabourSnapshot, facilityStorageForGood } from "@/lib/engine/industry";

export interface SystemMarketSeed {
  systemId: string;
  buildings: Record<string, number>;
  yields: ResourceVector;
  population: number;
  governmentType: GovernmentType;
  /**
   * `true` stocks the warehouses from the system's own production/consumption balance — world-gen's
   * starting worlds, which are assumed to have been trading for generations. `false` opens every
   * good at zero, which is what a system that has just been settled actually holds.
   */
  seedStock: boolean;
}

/** One row per good for a system that has become inhabited. */
export function createSystemMarkets(seed: SystemMarketSeed): WorldMarket[] {
  const basis = computeSystemLabourSnapshot(seed.buildings, seed.population).basis;
  return Object.keys(GOODS).map((goodId) => {
    const storageCapacity = facilityStorageForGood(seed.buildings, goodId);
    const stock = seed.seedStock
      ? getInitialStock(seed.buildings, seed.yields, seed.population, goodId)
      : 0;
    // Guard: JSON.stringify silently turns NaN/Infinity into null, which would break the
    // save/load round-trip — clamp defensively.
    return {
      systemId: seed.systemId,
      goodId,
      stock: Number.isFinite(stock) ? stock : 0,
      anchorMult: 1,
      demandRate: civilianDemandRateForGood(goodId, basis),
      storageCapacity: Number.isFinite(storageCapacity) ? storageCapacity : 0,
      satisfaction: 1,
      squeezePulses: 0,
      proposalPulses: 0,
    };
  });
}
