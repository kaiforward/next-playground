/**
 * Pure physical-economy primitives — zero DB dependency.
 *
 * Consumption for a good derives from population (perCapitaNeed × population)
 * and the per-good production/consumption snapshot shape are shared by the live
 * tick, the simulator, and the read service so there is one source of truth.
 * Production itself is capacity-driven and lives in `industry.ts`.
 */
import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";

/** Population-scaled consumption rate for a good: perCapitaNeed × population. */
export function consumptionRate(goodId: string, population: number): number {
  const need = GOOD_CONSUMPTION[goodId] ?? 0;
  return need * Math.max(0, population);
}

/** Per-good production/consumption snapshot for one system — the read-service shape. */
export interface SubstrateGoodRate {
  goodId: string;
  production: number;
  consumption: number;
}
