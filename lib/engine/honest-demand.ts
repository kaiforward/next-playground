/**
 * The two honest demand figures, per system, per good. One module so the logistics read,
 * the planner, the market seeder and the production brake cannot diverge on what a world
 * actually wants.
 *
 * **Use** — what this world's industry draws when it runs: civilian want at full rate plus,
 * for each good whose recipe consumes it, that consumer's staffing-gated capacity scaled by
 * the strike/maintenance suppression the economy applied. It moves only as buildings,
 * population and strike state move, which is what makes it safe for every *warehousing*
 * quantity (targets, donor floors, consumer/producer classification) — a warehouse target
 * that followed the momentary state of the yard it stocks would drain and refill forever.
 *
 * **Draw** — how urgently the world needs a delivery right now: the same sum with each
 * consumer's term additionally gated by that consumer's own output brake and its live event
 * production multiplier. A factory stopped by its own full yard should not head the import
 * queue. Only the matcher's severity weight reads it.
 *
 * Neither figure applies an input gate: a scarce input must not deflate its own demand
 * signal, or rationing spirals into starvation. Neither is the pricing `demandRate`, which
 * is capacity-based and floored, and belongs to pricing alone.
 *
 * Both are single sums over `GOOD_RECIPE_CONSUMERS` — a consumer's brake needs only its own
 * use figure, capacity and storage, so there is no topological evaluation pass here.
 */
import type { ResourceVector } from "@/lib/types/game";
import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";
import { GOOD_NAMES } from "@/lib/constants/goods";
import { capacityGoodRates, inputDemandFromProduction } from "@/lib/engine/industry";

/** One good's use figure, split so the Logistics tab can render the industrial half alone. */
export interface UseRate {
  /** Population want at full rate — per-capita baseline plus the skilled grades' baskets. */
  civilian: number;
  /** Local factories' recipe draw on this good, staffing- and strike-gated. */
  industrial: number;
  /** civilian + industrial — the figure every warehousing quantity is denominated in. */
  total: number;
}

export interface HonestDemandInput {
  buildings: Record<string, number>;
  population: number;
  yields: ResourceVector;
  /** Strike × maintenance scalar the economy applied this cycle, ∈ (0,1]. */
  productionSuppress: number;
  /**
   * Precomputed `capacityGoodRates(buildings, population, yields)` when the caller already holds
   * it. The capacity scan is the dominant cost of both figures, and every tick-path caller has
   * already run it for the same system — passing it in keeps the scan at once per system.
   */
  rates?: SubstrateGoodRate[];
}

export interface DrawRateInput extends HonestDemandInput {
  /** Each consumer good's own live production-brake ceiling ∈ [0,1], at its current stock. */
  brakeCeilingOf: (goodId: string) => number;
  /** Each consumer good's live event production multiplier (clamp 0.1–3.0); absent ⇒ 1. */
  productionMultOf: (goodId: string) => number;
}

/**
 * A multiplicative gate from a persisted field or a caller accessor. Non-finite reads as
 * ungated rather than as zero — a corrupt scalar must never silently erase a real need —
 * and negatives clamp to 0. Keeps both figures finite, which the persisted use figure
 * requires of the save file.
 */
function gate(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return value > 0 ? value : 0;
}

/**
 * Per-good civilian want and the staffing-gated, strike-scaled capacity each good's own
 * industry runs at — the steady draw both figures are built from.
 */
function steadyRates(input: HonestDemandInput): {
  civilianByGood: Map<string, number>;
  steadyByGood: Map<string, number>;
} {
  const suppress = gate(input.productionSuppress);
  const rates = input.rates ?? capacityGoodRates(input.buildings, input.population, input.yields);
  const civilianByGood = new Map<string, number>();
  const steadyByGood = new Map<string, number>();
  for (const rate of rates) {
    civilianByGood.set(rate.goodId, rate.consumption);
    steadyByGood.set(rate.goodId, rate.production * suppress);
  }
  return { civilianByGood, steadyByGood };
}

/** THE USE FIGURE, per good. `industrial` is exposed separately for the Logistics tab. */
export function useRatesByGood(input: HonestDemandInput): Map<string, UseRate> {
  const { civilianByGood, steadyByGood } = steadyRates(input);
  const out = new Map<string, UseRate>();
  for (const goodId of GOOD_NAMES) {
    const civilian = civilianByGood.get(goodId) ?? 0;
    const industrial = inputDemandFromProduction(goodId, steadyByGood);
    out.set(goodId, { civilian, industrial, total: civilian + industrial });
  }
  return out;
}

/** THE DRAW FIGURE, per good. Single sum over `GOOD_RECIPE_CONSUMERS` — no topological pass. */
export function drawRatesByGood(input: DrawRateInput): Map<string, number> {
  const { civilianByGood, steadyByGood } = steadyRates(input);
  // Each gate belongs to the CONSUMING good, so applying it to that good's own entry in the
  // steady map is the same per-consumer application the recipe sum would do term by term.
  const wouldDrawByGood = new Map<string, number>();
  for (const [goodId, steady] of steadyByGood) {
    wouldDrawByGood.set(
      goodId,
      steady * gate(input.brakeCeilingOf(goodId)) * gate(input.productionMultOf(goodId)),
    );
  }
  const out = new Map<string, number>();
  for (const goodId of GOOD_NAMES) {
    out.set(goodId, (civilianByGood.get(goodId) ?? 0) + inputDemandFromProduction(goodId, wouldDrawByGood));
  }
  return out;
}
