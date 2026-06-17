/**
 * Derived economy-type SHIM (economy-simulation SP1 Part 1).
 *
 * Economy type used to be derived from trait affinities. Those are gone — the
 * economic signal now comes from a system's physical substrate. This single
 * function maps the aggregate resource vector + population to one of the six
 * legacy `EconomyType` labels, so `getInitialStock`, `ECONOMY_PRODUCTION/
 * CONSUMPTION`, the economy tick, and `Region.dominantEconomy` keep working
 * unchanged. DELETED in SP1 Part 2 when production/consumption derive from
 * bodies + population directly. Thresholds are tuned via the simulator.
 */
import type { EconomyType, ResourceVector } from "@/lib/types/game";
import { RESOURCE_TYPES } from "./resources";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function deriveEconomyTypeLabel(
  aggregate: ResourceVector,
  population: number,
): EconomyType {
  const total = RESOURCE_TYPES.reduce((sum, type) => sum + aggregate[type], 0);
  if (total <= 0) return "extraction";

  const foodShare = (aggregate.arable + aggregate.biomass) / total;
  const rawShare =
    (aggregate.ore + aggregate.minerals + aggregate.gas + aggregate.radioactive) / total;
  const popNorm = clamp01(population / SUBSTRATE_GEN.ECON_POP_HIGH);

  // Populous systems become developed economies regardless of raw base.
  if (popNorm >= SUBSTRATE_GEN.ECON_POP_HIGH_FRAC) {
    if (rawShare >= SUBSTRATE_GEN.ECON_RAW_DOMINANT) return "industrial";
    if (foodShare < SUBSTRATE_GEN.ECON_FOOD_DOMINANT && rawShare < SUBSTRATE_GEN.ECON_RAW_MIXED) {
      return "tech";
    }
    return "core";
  }

  // Sparse/mid population: identity follows the dominant resource.
  if (foodShare >= SUBSTRATE_GEN.ECON_FOOD_DOMINANT) return "agricultural";
  if (rawShare >= SUBSTRATE_GEN.ECON_RAW_DOMINANT) return "extraction";

  // Mixed raw base, neither food- nor raw-dominant → refinery.
  return "refinery";
}
