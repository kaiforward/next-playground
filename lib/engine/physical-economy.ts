/**
 * Pure physical-economy rates — zero DB dependency.
 *
 * A system's production and consumption for a good derive from its physical
 * substrate: the aggregate resource vector and population. The same function
 * feeds the live tick, the simulator, and the read service so there is one
 * source of truth for the formula.
 */
import type { ResourceVector } from "@/lib/types/game";
import { GOOD_NAMES } from "@/lib/constants/goods";
import {
  GOOD_PRODUCTION,
  GOOD_CONSUMPTION,
  LABOUR_HALF_POP,
} from "@/lib/constants/physical-economy";

/** Production + consumption rate for one good at one system. */
export interface PhysicalRates {
  production: number;
  consumption: number;
}

/**
 * Normalized, soft-saturating labour scalar in [0, 1). Zero at no population,
 * 0.5 at LABOUR_HALF_POP, asymptotic to 1. A fixed per-system value while
 * population is static.
 */
export function labourFactor(population: number): number {
  if (population <= 0) return 0;
  return population / (population + LABOUR_HALF_POP);
}

/** Population-scaled consumption rate for a good: perCapitaNeed × population. */
export function consumptionRate(goodId: string, population: number): number {
  const need = GOOD_CONSUMPTION[goodId] ?? 0;
  return need * Math.max(0, population);
}

/**
 * Physical production + consumption rates for a good at a system.
 *   production  = coeff × labour × (resource-driven ? aggregate[resource] : 1)
 *   consumption = perCapitaNeed × population
 * Unknown goods yield zero on both axes.
 */
export function physicalRates(
  goodId: string,
  aggregate: ResourceVector,
  population: number,
): PhysicalRates {
  const labour = labourFactor(population);

  const driver = GOOD_PRODUCTION[goodId];
  const production = driver
    ? driver.coeff * labour * (driver.resource ? aggregate[driver.resource] : 1)
    : 0;

  const consumption = consumptionRate(goodId, population);

  return { production, consumption };
}

/** Per-good production/consumption snapshot for one system — the read-service shape. */
export interface SubstrateGoodRate {
  goodId: string;
  production: number;
  consumption: number;
}

/** Production + consumption for every good at a system, in canonical good order. */
export function substrateGoodRates(
  aggregate: ResourceVector,
  population: number,
): SubstrateGoodRate[] {
  return GOOD_NAMES.map((goodId) => {
    const { production, consumption } = physicalRates(goodId, aggregate, population);
    return { goodId, production, consumption };
  });
}
