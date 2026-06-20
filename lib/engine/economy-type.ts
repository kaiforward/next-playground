/**
 * Economy-type classifier — maps a system's effective deposit potential
 * (slotCap[r] × yieldMult[r], the extractor capacity weighted by deposit
 * quality) + population to one of the six `EconomyType` labels.
 *
 * Display-only: it drives UI economy badges and `Region.dominantEconomy`.
 * Nothing in the economy tick reads it — production and consumption derive
 * from the physical substrate directly. Thresholds are tuned via the simulator.
 */
import type { EconomyType, ResourceVector } from "@/lib/types/game";
import { RESOURCE_TYPES, emptyResourceVector } from "./resources";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function deriveEconomyTypeLabel(
  slotCap: ResourceVector,
  yieldMult: ResourceVector,
  population: number,
): EconomyType {
  // Effective deposit potential: extractor capacity weighted by deposit quality.
  const effective = emptyResourceVector();
  for (const type of RESOURCE_TYPES) effective[type] = slotCap[type] * yieldMult[type];

  const total = RESOURCE_TYPES.reduce((sum, type) => sum + effective[type], 0);
  if (total <= 0) return "extraction";

  const foodShare = (effective.arable + effective.biomass) / total;
  const rawShare =
    (effective.ore + effective.minerals + effective.gas + effective.radioactive) / total;
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
