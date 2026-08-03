/**
 * Shared per-system market-state derivation for the directed-logistics matcher and
 * the directed-build planner. Given one system's buildings/population/yields and its
 * market rows, produce the engine's GoodMarketState[]: per good, current stock, the cycles-of-supply
 * warehousing target the deficit test measures against (logisticsTarget), the donor floor an
 * ordinary source stops at (donorReserve), the price anchor (targetStock), and total demand
 * (civilian consumption + industrial input draw). One definition so both processors read markets
 * identically.
 *
 * The stock figures are NOT interchangeable. `targetStock` divides by the row's `demandRate`, which
 * floors at `MIN_DEMAND` — a divide-by-zero guard on *pricing* — so below that floor it describes the
 * guard rather than anything consumed locally. `logisticsTarget` and `donorReserve` divide by real
 * demand: both sides of a match are denominated in what the system actually uses, and the anchor
 * reaches logistics only as `surplusDrawable`'s degenerate `<= 0` guard.
 */
import type { ResourceVector } from "@/lib/types/game";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { GOODS } from "@/lib/constants/goods";
import { capacityGoodRates, inputDemandFromProduction } from "@/lib/engine/industry";
import type { GoodMarketState } from "@/lib/engine/directed-logistics";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";

/** Minimal per-system shape both processors derive market state from. */
export interface MarketStateSource {
  buildings: Record<string, number>;
  population: number;
  yields: ResourceVector;
  markets: MarketRowForLogistics[];
}

export function toGoodMarketStates(row: MarketStateSource): GoodMarketState[] {
  const rates = capacityGoodRates(row.buildings, row.population, row.yields);
  const consByKey = new Map(rates.map((r) => [r.goodId, r.consumption]));
  const prodByKey = new Map(rates.map((r) => [r.goodId, r.production]));

  const goods: GoodMarketState[] = [];
  for (const m of row.markets) {
    const band = marketBandForRow(m, GOODS[m.goodId]);
    const civ = consByKey.get(m.goodId) ?? 0;
    const industrial = inputDemandFromProduction(m.goodId, prodByKey);
    const demand = civ + industrial;
    goods.push({
      goodId: m.goodId,
      stock: m.stock,
      targetStock: band.targetStock,
      // Cycles of the demand this system actually has. Both carry `anchorMult` so an event that
      // shifts a market's anchor moves the warehousing target and the donor floor together.
      logisticsTarget: DIRECTED_LOGISTICS.WAREHOUSE_COVER * Math.max(0, demand) * m.anchorMult,
      donorReserve: DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * Math.max(0, demand) * m.anchorMult,
      demand,
      civilianDemand: civ,
      // An explicit zero is a completed assessment and must remain a sink. Capacity is
      // only a legacy-save fallback while the persisted rate is genuinely absent.
      production: m.realizedProductionRate ?? (prodByKey.get(m.goodId) ?? 0),
      capacityProduction: prodByKey.get(m.goodId) ?? 0,
      satisfaction: m.satisfaction,
      productionSuppressed: m.productionSuppressed,
      squeezeCycles: m.squeezeCycles,
      proposalCycles: m.proposalCycles,
      logisticsFundingBound: m.logisticsFundingBound,
    });
  }
  return goods;
}
