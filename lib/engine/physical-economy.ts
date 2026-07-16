/**
 * Pure physical-economy primitives — zero DB dependency.
 *
 * Civilian consumption derives from a demand basis: the flat per-capita baseline
 * plus additive per-grade baskets weighted by skilled work performed. The
 * per-good production/consumption snapshot shape is shared by the live tick and
 * the read service so there is one source of truth.
 * Production itself is capacity-driven and lives in `industry.ts`.
 */
import {
  GOOD_CONSUMPTION,
  SKILL1_CONSUMPTION,
  SKILL2_CONSUMPTION,
} from "@/lib/constants/physical-economy";

/**
 * Civilian demand basis for one system: headcount plus skilled work performed.
 * Technicians/engineers are jobs being worked (bounded by built jobs, academy
 * licence, and population — computeLabourAllocation), not a population stratum;
 * a hub that loses its industry sheds the discretionary demand with it.
 */
export interface CivilianDemandBasis {
  population: number;
  /** People working skill-1 (technician) heads. */
  technicians: number;
  /** People working skill-2 (engineer) heads. */
  engineers: number;
}

/** The three additive terms of consumptionRate, separated for display. */
export interface ConsumptionBreakdown {
  base: number;
  technicians: number;
  engineers: number;
}

/** consumptionRate split into its per-capita baseline and per-grade basket terms. */
export function consumptionBreakdown(goodId: string, basis: CivilianDemandBasis): ConsumptionBreakdown {
  return {
    base: (GOOD_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.population),
    technicians: (SKILL1_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.technicians),
    engineers: (SKILL2_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.engineers),
  };
}

/**
 * Civilian consumption rate: per-capita baseline + additive per-grade baskets.
 * Sums the same terms as consumptionBreakdown but stays allocation-free — it
 * runs per (good, system) on the tick hot path; the breakdown object is for
 * the display read path only.
 */
export function consumptionRate(goodId: string, basis: CivilianDemandBasis): number {
  return (
    (GOOD_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.population) +
    (SKILL1_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.technicians) +
    (SKILL2_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.engineers)
  );
}

/** Per-good production/consumption snapshot for one system — the read-service shape. */
export interface SubstrateGoodRate {
  goodId: string;
  production: number;
  consumption: number;
}
