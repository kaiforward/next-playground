/**
 * Shared per-system market-state derivation for the directed-logistics matcher and
 * the directed-build planner. Given one system's buildings/population/yields and its
 * market rows, produce the engine's GoodMarketState[]: per good, current stock, the cycles-of-supply
 * warehousing target the deficit test measures against (logisticsTarget), the donor floor an
 * ordinary source stops at (donorReserve), and the two demand figures. One definition so both
 * processors read markets identically.
 *
 * `demand` is the USE figure — what this system's population and industry draw when running. It
 * moves only as buildings, population and strike state move, which is what every warehousing
 * quantity here requires: a target that followed the momentary state of the yard it stocks would
 * drain and refill forever. `drawDemand` is the DRAW figure — the same want further gated by each
 * consuming factory's own output brake and live event multipliers, i.e. how urgently a delivery is
 * needed right now. Only the matcher's severity weight reads it.
 *
 * Everything here divides by REAL demand — deliberately not the row's `demandRate`, which floors at
 * `MIN_DEMAND` (a divide-by-zero guard on *pricing*) and below that floor describes the guard rather
 * than anything consumed locally. One anchor-derived quantity is read deliberately, and only one:
 * `anchorMult` scales the warehousing target and the donor floor together (an anchor-shifting event
 * moves both) and rides the brake knee's use term. The draw figure's brake measures each consumer's
 * stock against the same warehouse knee (`brakeKnee` — use figure and capacity) the economy
 * actually brakes production with — urgency mirrors the brake as applied. The pricing
 * `demandRate` itself reaches nothing here.
 */
import type { ResourceVector } from "@/lib/types/game";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { ECONOMY_CONSTANTS, ECONOMY_SIM_PARAMS } from "@/lib/constants/economy";
import { GOODS } from "@/lib/constants/goods";
import { capacityGoodRates } from "@/lib/engine/industry";
import { drawRatesByGood, useRatesByGood } from "@/lib/engine/honest-demand";
import type { UseRate } from "@/lib/engine/honest-demand";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { brakeKnee, productionCeiling } from "@/lib/engine/tick";
import type { GoodMarketState } from "@/lib/engine/directed-logistics";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";

/**
 * Which brake the draw figure's `brakeCeilingOf` reads. `"live"` (the default and the only value
 * the live game ever uses) is the warehouse knee the economy actually brakes production with;
 * `"anchor"` pins it to the retired anchor-based ceiling — a committed harness override for the
 * stage-gate's third A/B arm, so the brake's direct effect and its logistics-urgency ripple are
 * attributable separately. It rides `runWorldTick`'s opts channel exactly as the cadence override
 * does, and reaches nothing but the draw figure.
 */
export type DrawBrakeCeiling = "live" | "anchor";

/**
 * The retired anchor brake, kept ONLY as the third-arm pin: full rate to the price anchor, linear
 * taper to 0 at BRAKE_RAMP × anchor (the geometry the warehouse knee replaced — its hold cover
 * equalled BRAKE_RAMP at retirement). A measurement arm, never a gameplay path.
 */
function anchorCeiling(stock: number, targetStock: number): number {
  if (targetStock <= 0) return 0;
  const end = targetStock * ECONOMY_CONSTANTS.BRAKE_RAMP;
  if (stock <= targetStock) return 1;
  if (stock >= end) return 0;
  return (end - stock) / (end - targetStock);
}

/** Minimal per-system shape both processors derive market state from. */
export interface MarketStateSource {
  buildings: Record<string, number>;
  population: number;
  yields: ResourceVector;
  markets: MarketRowForLogistics[];
}

export function toGoodMarketStates(
  row: MarketStateSource,
  opts?: { withDraw?: boolean; drawBrakeCeiling?: DrawBrakeCeiling },
): GoodMarketState[] {
  const rates = capacityGoodRates(row.buildings, row.population, row.yields);
  const consByKey = new Map(rates.map((r) => [r.goodId, r.consumption]));
  const prodByKey = new Map(rates.map((r) => [r.goodId, r.production]));

  // The strike × maintenance scalar is a property of the system, so every row that carries it
  // carries the same value; rows written before it existed read as unsuppressed.
  const suppressRow = row.markets.find((m) => typeof m.productionSuppressRate === "number");
  const productionSuppress = suppressRow?.productionSuppressRate ?? 1;

  // Only a row with no persisted use figure needs the recompute, so it is paid for lazily.
  let useRates: Map<string, UseRate> | undefined;
  const recomputedUseRate = (goodId: string): number => {
    useRates ??= useRatesByGood({
      buildings: row.buildings,
      population: row.population,
      yields: row.yields,
      productionSuppress,
      rates,
    });
    return useRates.get(goodId)?.total ?? 0;
  };
  // A missing or corrupt use figure recomputes live — it must never read as 0, which would make
  // the row an un-sinkable market and a fully-drawable donor at the same time (and here, a
  // zero-knee brake). One resolution feeds the brake pass and the published `demand` alike.
  const useRateOf = (m: MarketRowForLogistics): number =>
    typeof m.honestUseRate === "number" && Number.isFinite(m.honestUseRate)
      ? m.honestUseRate
      : recomputedUseRate(m.goodId);

  // The draw figure has exactly one reader — the matcher's severity weight — so only the logistics
  // caller pays for the per-market brake pass and the second recipe sum behind it.
  let drawRates: Map<string, number> | undefined;
  if (opts?.withDraw) {
    // Each good's own output brake at its own current stock, plus its live event multiplier — the
    // two gates that separate "wants this eventually" from "could use this right now". A good with
    // no row here reads as unbraked: no row means no stock and no yard, which is not a stopped
    // factory.
    const pinToAnchor = opts.drawBrakeCeiling === "anchor";
    const brakeByGood = new Map<string, number>();
    const multByGood = new Map<string, number>();
    for (const m of row.markets) {
      if (pinToAnchor) {
        brakeByGood.set(
          m.goodId,
          anchorCeiling(m.stock, marketBandForRow(m, GOODS[m.goodId]).targetStock),
        );
      } else {
        const knee = brakeKnee(
          {
            useRate: useRateOf(m),
            capacityProduction: prodByKey.get(m.goodId) ?? 0,
            anchorMult: m.anchorMult,
          },
          ECONOMY_SIM_PARAMS,
        );
        brakeByGood.set(m.goodId, productionCeiling(m.stock, knee));
      }
      multByGood.set(m.goodId, m.productionMult ?? 1);
    }
    drawRates = drawRatesByGood({
      buildings: row.buildings,
      population: row.population,
      yields: row.yields,
      productionSuppress,
      rates,
      brakeCeilingOf: (goodId) => brakeByGood.get(goodId) ?? 1,
      productionMultOf: (goodId) => multByGood.get(goodId) ?? 1,
    });
  }

  const goods: GoodMarketState[] = [];
  for (const m of row.markets) {
    const civ = consByKey.get(m.goodId) ?? 0;
    const demand = useRateOf(m);
    goods.push({
      goodId: m.goodId,
      stock: m.stock,
      // Cycles of the demand this system actually has. Both carry `anchorMult` so an event that
      // shifts a market's anchor moves the warehousing target and the donor floor together.
      logisticsTarget: DIRECTED_LOGISTICS.WAREHOUSE_COVER * Math.max(0, demand) * m.anchorMult,
      donorReserve: DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * Math.max(0, demand) * m.anchorMult,
      demand,
      // A good with no draw entry keeps its standing want as its urgency rather than sinking to
      // the back of the import queue; callers that never read urgency get the same fallback.
      drawDemand: drawRates?.get(m.goodId) ?? demand,
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
