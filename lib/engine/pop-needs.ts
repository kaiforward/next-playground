/**
 * Read-side per-good pop-needs snapshot — the display projection of the signal
 * the unrest spine integrates. It reads the economy cycle's persisted
 * per-good satisfaction (delivered ÷ demanded) instead of recomputing a
 * stock position — the display and the sim cannot diverge, and the post-tick
 * boundary bias is gone. The stored measure is taken against total civilian
 * demand; rationing is pro-rata, so the delivered fraction is identical for
 * every civilian drawer.
 * Pressure mirrors the necessity-weighted share × gap² shape of the `dissatisfaction()` sum, weighted
 * by unfloored civilian want × GOOD_NECESSITY (the cycle's own shares fold in demand floors and
 * modifiers, so magnitudes can differ slightly). Pure — callers pass market rows and a demand basis.
 */
import { consumptionBreakdown, consumptionRate, type CivilianDemandBasis, type ConsumptionBreakdown } from "@/lib/engine/physical-economy";
import { GOOD_CONSUMPTION, GOOD_NECESSITY, SKILL1_CONSUMPTION, SKILL2_CONSUMPTION } from "@/lib/constants/physical-economy";
import { GOODS } from "@/lib/constants/goods";

export interface PopNeed {
  goodId: string;
  /** Civilian want (unfloored consumptionRate — NOT the MIN_DEMAND-floored pricing figure). */
  want: number;
  /** [0,1] — the delivered fraction the last economy cycle applied; 1 = fully met. */
  satisfaction: number;
  /** want × satisfaction. */
  delivered: number;
  /** necessityWeightedShare × (1 − satisfaction)² — this good's term in the system's dissatisfaction sum. */
  pressure: number;
  breakdown: ConsumptionBreakdown;
}

/** The market-row fields the needs read consumes. */
export interface PopNeedsMarketRow {
  goodId: string;
  /** Persisted consumption satisfaction from the last economy cycle (missing ⇒ 1). */
  satisfaction?: number;
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
  const totalWeight = wanted.reduce((s, g) => s + g.want * (GOOD_NECESSITY[g.goodId] ?? 0), 0);

  return wanted
    .map(({ goodId, want }) => {
      const row = rowByGood.get(goodId);
      const satisfaction = row ? Math.max(0, Math.min(1, row.satisfaction ?? 1)) : 0;
      const gap = 1 - satisfaction;
      const weight = want * (GOOD_NECESSITY[goodId] ?? 0);
      return {
        goodId,
        want,
        satisfaction,
        delivered: want * satisfaction,
        pressure: totalWeight > 0 ? (weight / totalWeight) * gap * gap : 0,
        breakdown: consumptionBreakdown(goodId, basis),
      };
    })
    .sort((a, b) => b.pressure - a.pressure || b.want - a.want);
}
