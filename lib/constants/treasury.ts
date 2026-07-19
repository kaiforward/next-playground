/**
 * Faction treasury constants. ALL values here are ECONOMY_SCALE-invariant by
 * definition (money never rides S): heads, building levels, and construction
 * work points are unscaled counts, and the two S-scaled tax bases (realized
 * production, logistics work) are divided by the scale at collection.
 *
 * Rate magnitudes are harness-calibrated (`npm run simulate` — early-game
 * solvency and no runaway hoards are the acceptance bar), not hand-derived.
 */
import { GOODS, GOOD_NAMES } from "@/lib/constants/goods";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import type { GovernmentType, TaxLevel } from "@/lib/types/game";

export const TREASURY = {
  /** Money collected per weighted employed head per reference month, before the tax-level multiplier. */
  HEADS_TAX_PER_MONTH: 0.01,
  /** Per-head weights by labour grade — skilled cores out-earn frontier headcount. */
  HEADS_WEIGHTS: { unskilled: 1, technicians: 3, engineers: 9 },
  /** Share of reference value collected per realized unit (at S=1), before the tax-level multiplier. */
  PRODUCTION_TAX_RATE: 0.05,
  /** A processed good's reference value never falls below this share of its own base price. */
  REFERENCE_VALUE_FLOOR_SHARE: 0.25,
  /** Monthly upkeep per unit of build-work embodied in standing building levels. */
  MAINTENANCE_RATE_PER_WORK: 0.016,
  /** Money per construction point actually absorbed by the queue. */
  CONSTRUCTION_RATE_PER_WORK: 4,
  /** Money per unit of logistics work-budget actually consumed (S-normalised at accrual). */
  LOGISTICS_RATE_PER_WORK: 0.4,
  /** The maintenance slider's floor — the 50-100% range charges only flow (recoverable). */
  MAINTENANCE_SLIDER_FLOOR: 0.5,
} as const;

/** Rate multiplier applied to BOTH income lines by the faction's tax stance. */
export const TAX_LEVEL_RATE_MULT: Record<TaxLevel, number> = {
  very_low: 0.5,
  low: 0.75,
  normal: 1,
  high: 1.3,
  very_high: 1.6,
};

/** Proportional pressure fed into the per-system unrest integrator (consumed by the population processor). */
export const TAX_LEVEL_UNREST_PRESSURE: Record<TaxLevel, number> = {
  very_low: 0,
  low: 0.02,
  normal: 0.05,
  high: 0.1,
  very_high: 0.18,
};

/** Government-flavoured default tax stance (tax is internal policy — the government axis). */
export const DEFAULT_TAX_LEVEL: Record<GovernmentType, TaxLevel> = {
  federation: "normal",
  corporate: "low",
  authoritarian: "high",
  frontier: "low",
  cooperative: "normal",
  technocratic: "normal",
  militarist: "high",
  theocratic: "normal",
};

/**
 * Fixed per-good assessed values for the production tax (a cadastral tax).
 * Value-added-aware: a processed good is valued at its base price NET of its
 * inputs' base prices (floored), so deep chains aren't taxed as turnover —
 * ore is not taxed again inside alloys inside machinery. Tier-0 goods have no
 * recipe and keep their full base price.
 */
function buildReferenceValues(): Record<string, number> {
  const values: Record<string, number> = {};
  for (const goodId of GOOD_NAMES) {
    const def = GOODS[goodId];
    const recipe = GOOD_RECIPES[goodId];
    let inputCost = 0;
    if (recipe) {
      for (const [inputId, perOutput] of Object.entries(recipe)) {
        inputCost += (GOODS[inputId]?.basePrice ?? 0) * perOutput;
      }
    }
    values[goodId] = Math.max(
      def.basePrice - inputCost,
      TREASURY.REFERENCE_VALUE_FLOOR_SHARE * def.basePrice,
    );
  }
  return values;
}

export const REFERENCE_VALUE: Record<string, number> = buildReferenceValues();
