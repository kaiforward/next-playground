/**
 * Read-side per-good pop-needs snapshot — the display projection of the exact
 * signal the unrest spine integrates. Satisfaction is the consume-direction
 * self-limiting factor on the market band (what the economy pulse applies as
 * the consumption gate); pressure is the same demand-share × gap² term
 * `dissatisfaction()` sums. Pure — callers pass market rows and a demand basis.
 */
import { consumptionBreakdown, consumptionRate, type CivilianDemandBasis, type ConsumptionBreakdown } from "@/lib/engine/physical-economy";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { selfLimitingFactor } from "@/lib/engine/tick";
import { GOOD_CONSUMPTION, SKILL1_CONSUMPTION, SKILL2_CONSUMPTION } from "@/lib/constants/physical-economy";
import { GOODS } from "@/lib/constants/goods";

export interface PopNeed {
  goodId: string;
  /** Civilian want (unfloored consumptionRate — NOT the MIN_DEMAND-floored pricing figure). */
  want: number;
  /** [0,1] — the consume gate at current stock; 1 = fully met. */
  satisfaction: number;
  /** want × satisfaction. */
  delivered: number;
  /** demandShare × (1 − satisfaction)² — this good's term in the system's dissatisfaction sum. */
  pressure: number;
  breakdown: ConsumptionBreakdown;
}

/** The market-row fields needed to place stock on its band. */
export interface PopNeedsMarketRow {
  goodId: string;
  stock: number;
  demandRate: number;
  storageCapacity: number;
  anchorMult: number;
}

/** Every good either tier of the basis consumes (union of the three basket catalogues). */
function consumedGoodIds(): string[] {
  const ids = new Set<string>([
    ...Object.keys(GOOD_CONSUMPTION),
    ...Object.keys(SKILL1_CONSUMPTION),
    ...Object.keys(SKILL2_CONSUMPTION),
  ]);
  return [...ids].filter((id) => GOODS[id] !== undefined);
}

/**
 * Per-good needs for one system, pressure-sorted descending (ties by want).
 * A wanted good with no market row reads satisfaction 0 (nothing to draw from).
 */
export function computePopNeeds(basis: CivilianDemandBasis, markets: PopNeedsMarketRow[]): PopNeed[] {
  const rowByGood = new Map(markets.map((m) => [m.goodId, m]));
  const wanted = consumedGoodIds()
    .map((goodId) => ({ goodId, want: consumptionRate(goodId, basis) }))
    .filter((g) => g.want > 0);
  const totalWant = wanted.reduce((s, g) => s + g.want, 0);
  if (totalWant <= 0) return [];

  return wanted
    .map(({ goodId, want }) => {
      const row = rowByGood.get(goodId);
      let satisfaction = 0;
      if (row) {
        const band = marketBandForRow(row, GOODS[goodId]);
        satisfaction = selfLimitingFactor(row.stock, band.minStock, band.targetStock, "consume");
      }
      const gap = 1 - satisfaction;
      return {
        goodId,
        want,
        satisfaction,
        delivered: want * satisfaction,
        pressure: (want / totalWant) * gap * gap,
        breakdown: consumptionBreakdown(goodId, basis),
      };
    })
    .sort((a, b) => b.pressure - a.pressure || b.want - a.want);
}
