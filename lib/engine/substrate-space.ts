import type { BodyArchetype } from "@/lib/constants/bodies";
import type { ResourceVector } from "@/lib/types/game";
import { RESOURCE_TYPES, emptyResourceVector } from "./resources";
import { QUALITY_BANDS, SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";
import type { QualityBand } from "@/lib/constants/substrate-gen";
import type { QualityBandId, ResourceType } from "@/lib/types/game";
import type { RNG } from "./universe-gen";

export interface BodyPartition {
  availableSpace: number;
  generalSpace: number;
  habitableSpace: number;
  slots: ResourceVector;       // available extractor slots per resource
  depositSpace: ResourceVector;
}

export function partitionBody(arch: BodyArchetype, size: number, rng: RNG): BodyPartition {
  const availableSpace = SUBSTRATE_GEN.SPACE_PER_SIZE * Math.max(0, size);
  const w = emptyResourceVector();
  for (const r of RESOURCE_TYPES) w[r] = arch.resourceBase[r];
  let general = arch.generalWeight;
  // Rare volatility: spike one positive-weight resource BEFORE normalising.
  if (rng() < SUBSTRATE_GEN.VOLATILITY_CHANCE) {
    const present = RESOURCE_TYPES.filter((r) => w[r] > 0);
    if (present.length > 0) {
      const pick = present[Math.floor(rng() * present.length)];
      w[pick] *= SUBSTRATE_GEN.VOLATILITY_SPIKE;
    }
  }
  let total = general;
  for (const r of RESOURCE_TYPES) total += w[r];
  const depositSpace = emptyResourceVector();
  const slots = emptyResourceVector();
  if (total > 0) {
    for (const r of RESOURCE_TYPES) {
      depositSpace[r] = (w[r] / total) * availableSpace;
      slots[r] = depositSpace[r] / SUBSTRATE_GEN.DEPOSIT_SLOT_FOOTPRINT;
    }
    general = (general / total) * availableSpace;
  } else {
    general = availableSpace;
  }
  return {
    availableSpace,
    generalSpace: general,
    habitableSpace: arch.habitableFraction * general,
    slots,
    depositSpace,
  };
}

export function rollQualityBand(rng: RNG): { band: QualityBandId; multiplier: number } {
  const total = QUALITY_BANDS.reduce((s, b) => s + b.weight, 0);
  let roll = rng() * total;
  let chosen: QualityBand = QUALITY_BANDS[QUALITY_BANDS.length - 1];
  for (const b of QUALITY_BANDS) { roll -= b.weight; if (roll <= 0) { chosen = b; break; } }
  return { band: chosen.id, multiplier: chosen.min + rng() * (chosen.max - chosen.min) };
}

export function bandForMultiplier(mult: number): QualityBandId {
  for (const b of QUALITY_BANDS) if (mult <= b.max) return b.id;
  return QUALITY_BANDS[QUALITY_BANDS.length - 1].id;
}

const BAND_ADJECTIVE: Record<QualityBandId, string> = {
  poor: "Marginal", average: "Modest", good: "Rich", rich: "Bountiful",
};
const RESOURCE_NOUN: Record<ResourceType, string> = {
  gas: "gas pocket", minerals: "mineral seam", ore: "ore body", biomass: "biomass bloom",
  arable: "arable belt", water: "ice/water reserve", radioactive: "radioactive lode",
};
/** Generic, generated deposit name — band × resource. Replaces the v1 named-modifier catalog. */
export function depositDisplayName(resource: ResourceType, band: QualityBandId): string {
  return `${BAND_ADJECTIVE[band]} ${RESOURCE_NOUN[resource]}`;
}
