/**
 * Creation of a system's market rows — the single shape both world-gen and colonisation use.
 *
 * Only a system that is actually inhabited has a market. An unclaimed rock holds no goods: nobody
 * grew the food, nobody shipped it, and nothing there consumes it. World-gen therefore builds rows
 * for its developed systems alone, and a colony gets its rows when it is founded — EMPTY, filled by
 * the endowment its founder sends with the seed population.
 */
import type { ResourceVector } from "@/lib/types/game";
import type { WorldMarket } from "@/lib/world/types";
import { GOODS } from "@/lib/constants/goods";
import { getInitialStock, civilianDemandRateForGood } from "@/lib/constants/market-economy";
import { computeSystemLabourSnapshot, buildingStorageForGood } from "@/lib/engine/industry";
import { useRatesByGood } from "@/lib/engine/honest-demand";

export interface SystemMarketSeed {
  systemId: string;
  buildings: Record<string, number>;
  yields: ResourceVector;
  /** Per-resource extraction-work efficiency, threaded alongside `yields` into the seeded honest
   *  use rate — absent (a fixture predating this field) reads neutral 1.0, matching
   *  `useRatesByGood`'s own default. */
  extractionEff?: ResourceVector;
  population: number;
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
  // The use figure every warehousing quantity is denominated in, at full production — a system
  // becoming inhabited has no strike behind it. A founding colony has no industry, so this is its
  // population's civilian want alone. Seeding it (rather than leaving the row to the first
  // population cycle) is what makes an empty colony a deficit sink its founder can ship to.
  const useRates = useRatesByGood({
    buildings: seed.buildings,
    population: seed.population,
    yields: seed.yields,
    extractionEff: seed.extractionEff,
    productionSuppress: 1,
  });
  return Object.keys(GOODS).map((goodId) => {
    const storageCapacity = buildingStorageForGood(seed.buildings, goodId);
    const stock = seed.seedStock
      ? getInitialStock(seed.buildings, seed.yields, seed.population, goodId)
      : 0;
    const honestUseRate = useRates.get(goodId)?.total ?? 0;
    // Guard: JSON.stringify silently turns NaN/Infinity into null, which would break the
    // save/load round-trip — clamp defensively. The use figure is the exception: a corrupt seed
    // leaves it ABSENT so the first read recomputes live, never 0 — a seeded 0 would make the
    // founding row un-sinkable and fully drawable at once, defeating what the seeding is for.
    return {
      systemId: seed.systemId,
      goodId,
      stock: Number.isFinite(stock) ? stock : 0,
      anchorMult: 1,
      demandRate: civilianDemandRateForGood(goodId, basis),
      ...(Number.isFinite(honestUseRate) ? { honestUseRate: Math.max(0, honestUseRate) } : {}),
      storageCapacity: Number.isFinite(storageCapacity) ? storageCapacity : 0,
      satisfaction: 1,
      squeezeCycles: 0,
      proposalCycles: 0,
    };
  });
}
