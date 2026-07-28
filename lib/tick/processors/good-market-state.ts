/**
 * Shared per-system market-state derivation for the directed-logistics matcher and
 * the directed-build planner. Given one system's buildings/population/yields and its
 * market rows, produce the engine's GoodMarketState[]: per good, current stock, the
 * days-of-supply price anchor (targetStock), and total demand (civilian consumption +
 * industrial input draw). One definition so both processors read markets identically.
 */
import type { ResourceVector } from "@/lib/types/game";
import { marketBandForRow } from "@/lib/engine/market-pricing";
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
    goods.push({
      goodId: m.goodId,
      stock: m.stock,
      targetStock: band.targetStock,
      demand: civ + industrial,
      // An explicit zero is a completed assessment and must remain a sink. Capacity is
      // only a legacy-save fallback while the persisted rate is genuinely absent.
      production: m.realizedProductionRate ?? (prodByKey.get(m.goodId) ?? 0),
      capacityProduction: prodByKey.get(m.goodId) ?? 0,
      satisfaction: m.satisfaction,
      productionSuppressed: m.productionSuppressed,
      squeezePulses: m.squeezePulses,
      proposalPulses: m.proposalPulses,
      logisticsFundingBound: m.logisticsFundingBound,
    });
  }
  return goods;
}
