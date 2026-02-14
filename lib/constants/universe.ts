import type { EconomyType } from "@/lib/types/game";

/**
 * Per-good production rates by economy type.
 * Rate = units of supply generated per tick. Higher = faster replenishment.
 */
export const ECONOMY_PRODUCTION: Record<EconomyType, Record<string, number>> = {
  agricultural: { food: 5, textiles: 4 },
  extraction:   { ore: 4, water: 5 },
  refinery:     { fuel: 3, metals: 3, chemicals: 2 },
  industrial:   { machinery: 2, weapons: 1 },
  tech:         { electronics: 2, medicine: 2 },
  core:         { luxuries: 1 },
};

/**
 * Per-good consumption rates by economy type.
 * Rate = units of supply consumed per tick. Higher = faster depletion.
 */
export const ECONOMY_CONSUMPTION: Record<EconomyType, Record<string, number>> = {
  agricultural: { water: 4, machinery: 1, chemicals: 3, medicine: 1 },
  extraction:   { food: 3, fuel: 3, machinery: 1, textiles: 2 },
  refinery:     { ore: 4, water: 3 },
  industrial:   { metals: 3, electronics: 2, chemicals: 2, fuel: 2 },
  tech:         { metals: 2, chemicals: 2, luxuries: 1 },
  core:         { food: 3, textiles: 2, electronics: 2, medicine: 2, weapons: 1 },
};

// ── Helper functions ─────────────────────────────────────────────

/** Get the list of goods produced by an economy type. */
export function getProducedGoods(econ: EconomyType): string[] {
  return Object.keys(ECONOMY_PRODUCTION[econ] ?? {});
}

/** Get the list of goods consumed by an economy type. */
export function getConsumedGoods(econ: EconomyType): string[] {
  return Object.keys(ECONOMY_CONSUMPTION[econ] ?? {});
}

/** Get the production rate for a specific good at an economy type, or undefined if not produced. */
export function getProductionRate(econ: EconomyType, goodId: string): number | undefined {
  return ECONOMY_PRODUCTION[econ]?.[goodId];
}

/** Get the consumption rate for a specific good at an economy type, or undefined if not consumed. */
export function getConsumptionRate(econ: EconomyType, goodId: string): number | undefined {
  return ECONOMY_CONSUMPTION[econ]?.[goodId];
}
